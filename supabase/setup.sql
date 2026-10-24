-- =====================================================================================
-- Mineiro Lanche · setup completo do banco (Supabase)
-- Gerado por scripts/montar-setup.mjs a partir de supabase/migrations/20261008000001_schema.sql, supabase/migrations/20261008000002_rls.sql, supabase/migrations/20261008000003_rpc.sql, supabase/migrations/20261016000001_taxa_entrega.sql, supabase/migrations/20261017000001_motoboy.sql, supabase/migrations/20261017000002_confirmar_entrega_ja_entregue.sql, supabase/migrations/20261018023009_cotacao_entrega.sql, supabase/migrations/20261018031024_destino_entrega_e_limpeza.sql, supabase/migrations/20261018181746_gestao_usuarios_painel.sql, supabase/migrations/20261018185421_pagamentos_mercado_pago.sql, supabase/migrations/20261019024838_controle_entregadores.sql, supabase/migrations/20261019032841_historico_entregas_painel.sql, supabase/migrations/20261019034930_totais_taxas_entregadores.sql, supabase/migrations/20261019123043_viagens_rotas_entregadores.sql, supabase/migrations/20261020145407_pagamentos_permissoes_backend.sql, supabase/migrations/20261020203000_gestao_produtos.sql, supabase/migrations/20261020213000_estoque_categoria.sql, supabase/migrations/20261021001305_pagamento_na_entrega.sql, supabase/migrations/20261021001941_sinalizacao_pagamento_entrega_motoboy.sql, supabase/migrations/20261021003931_email_opcional_e_troco.sql, supabase/migrations/20261022193306_despacho_automatico_individual.sql, supabase/migrations/20261024023500_motoboy_pegar_pedidos.sql, supabase/seed.sql.
-- Não edite à mão: mude as migrations ou o CONFIG e rode
--   node scripts/gerar-seed.mjs && node scripts/montar-setup.mjs
--
-- Como aplicar: Dashboard do Supabase → SQL Editor → New query → colar este arquivo inteiro → Run.
-- (Se o editor avisar de "operações destrutivas", são os drop ... if exists que recriam policies
--  e gatilhos; pode confirmar.)
-- Idempotente: rodar de novo não dá erro nem duplica dados, policies ou tabelas no Realtime.
-- Roda numa transação só: se algo falhar, nada fica pela metade.
-- Depois: dê acesso ao painel (e ao motoboy) com os comandos comentados no fim do arquivo.
-- =====================================================================================

begin;

-- ============ supabase/migrations/20261008000001_schema.sql ============

-- Mineiro Lanche · 0001 · tabelas, checks, índices e gatilho de atualizado_em.
-- Contrato: docs/CONTRATO-API.md. Idempotente (if not exists / or replace): pode rodar de novo sem erro.
-- Compatível com o Postgres do Supabase (15 e 17).

-- ================= validação dos horários da loja =================
-- {"0": null | ["HH:MM","HH:MM"], ..., "6": ...}; 0 = domingo, igual ao CONFIG.horarios
create or replace function public.horarios_validos(p_h jsonb)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_h) = 'object' and not exists (
    select 1
    from jsonb_each(p_h) e
    where e.key !~ '^[0-6]$'
       or case jsonb_typeof(e.value)
            when 'null' then false
            when 'array' then not (
              jsonb_array_length(e.value) = 2
              and coalesce((e.value ->> 0) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
              and coalesce((e.value ->> 1) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false))
            else true
          end
  )
$$;

-- ================= tabelas =================

-- cardápio (gerado do CONFIG por scripts/gerar-seed.mjs)
-- preco null = "Preço a confirmar": aparece no cardápio, mas o criar_pedido recusa (produto_invalido)
create table if not exists public.produtos (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  categoria text not null check (char_length(categoria) between 1 and 40),
  nome text not null check (char_length(nome) between 1 and 120),
  preco numeric(10, 2) check (preco >= 0),
  tipo text not null check (tipo in ('lanche', 'combo', 'porcao', 'bebida')),
  foto text check (foto is null or char_length(foto) <= 120),
  ingredientes text[] not null default '{}',
  ordem int not null default 0,
  ativo boolean not null default true,
  esgotado_dia date
);
-- upgrade da versão de 08/10/2026 (preco era not null): rodar de novo não muda nada
alter table public.produtos alter column preco drop not null;

create table if not exists public.adicionais (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  nome text not null check (char_length(nome) between 1 and 60),
  preco numeric(10, 2) not null check (preco >= 0),
  ativo boolean not null default true
);

-- linha única (id = 1)
create table if not exists public.loja (
  id int primary key default 1 check (id = 1),
  modo text not null default 'auto' check (modo in ('auto', 'aberta', 'fechada')),
  aceita_fechada boolean not null default false,
  combo_preco numeric(10, 2) not null default 14.90 check (combo_preco >= 0),
  horarios jsonb not null default '{}'::jsonb check (public.horarios_validos(horarios)),
  atualizado_em timestamptz not null default now()
);

-- quem já pediu (base para CRM); telefone só com dígitos
create table if not exists public.clientes (
  telefone text primary key check (telefone ~ '^[0-9]{10,11}$'),
  nome text not null check (char_length(nome) between 1 and 80),
  endereco text not null default '' check (char_length(endereco) <= 200),
  referencia text not null default '' check (char_length(referencia) <= 120),
  pedidos int not null default 0 check (pedidos >= 0),
  primeiro_pedido_em timestamptz not null default now(),
  ultimo_pedido_em timestamptz not null default now()
);

-- itens em jsonb no formato do contrato do painel; total sempre calculado pelo servidor
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  token uuid not null unique default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  origem text not null default 'cardapio' check (origem in ('cardapio', 'qrcode', 'exemplo')),
  mesa text check (mesa is null or char_length(mesa) between 1 and 10),
  cliente_nome text not null check (char_length(cliente_nome) between 2 and 80),
  -- vazio só em pedido de exemplo (equipe)
  cliente_telefone text not null check (cliente_telefone ~ '^([0-9]{10,11})?$'),
  modo text not null check (modo in ('entrega', 'retirada', 'local')),
  endereco text not null default '' check (char_length(endereco) <= 200),
  referencia text not null default '' check (char_length(referencia) <= 120),
  pagamento text check (pagamento is null or char_length(pagamento) between 1 and 30),
  troco text not null default '' check (char_length(troco) <= 40),
  obs text not null default '' check (char_length(obs) <= 300),
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  total numeric(10, 2) not null check (total >= 0),
  status text not null default 'novo' check (status in ('novo', 'preparo', 'pronto', 'rota', 'entregue', 'cancelado')),
  historico jsonb not null default '[]'::jsonb check (jsonb_typeof(historico) = 'array'),
  atualizado_em timestamptz not null default now(),
  -- uuid gerado pelo navegador a cada envio novo: reenvio devolve o mesmo pedido
  idempotencia uuid unique
);

-- quem acessa o painel (o usuário é criado no Auth do Supabase)
create table if not exists public.equipe (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default ''
);

-- ================= índices =================
create index if not exists produtos_ordem_idx on public.produtos (ordem);
-- painel: últimas 48 h
create index if not exists pedidos_criado_em_idx on public.pedidos (criado_em desc);
-- quadro: só os que ainda estão andando
create index if not exists pedidos_ativos_idx on public.pedidos (criado_em) where status in ('novo', 'preparo', 'pronto', 'rota');
-- limite de pedidos por telefone em 10 min
create index if not exists pedidos_telefone_idx on public.pedidos (cliente_telefone, criado_em desc);

-- ================= atualizado_em =================
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists loja_atualizado_em on public.loja;
create trigger loja_atualizado_em before update on public.loja
  for each row execute function public.tocar_atualizado_em();

drop trigger if exists pedidos_atualizado_em on public.pedidos;
create trigger pedidos_atualizado_em before update on public.pedidos
  for each row execute function public.tocar_atualizado_em();

-- ============ supabase/migrations/20261008000002_rls.sql ============

-- Mineiro Lanche · 0002 · equipe, RLS, privilégios e Realtime.
-- Regra: nenhuma escrita direta nas tabelas; tudo passa pelas funções do 0003.
-- Idempotente: as policies são recriadas (drop if exists + create) e a publicação é conferida antes.

-- ================= equipe =================
-- security definer: lê equipe sem depender do RLS (e sem dar select em equipe ao anon)
create or replace function public.is_equipe()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.equipe where user_id = auth.uid())
$$;

-- o Supabase dá execute em toda função nova a anon e authenticated: tira e libera só o necessário
revoke all on function public.is_equipe() from public, anon, authenticated;
grant execute on function public.is_equipe() to anon, authenticated;
revoke all on function public.horarios_validos(jsonb) from public, anon, authenticated;
revoke all on function public.tocar_atualizado_em() from public, anon, authenticated;

-- ================= RLS =================
alter table public.produtos enable row level security;
alter table public.adicionais enable row level security;
alter table public.loja enable row level security;
alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
alter table public.equipe enable row level security;

-- privilégios: só leitura, e só onde o contrato deixa
revoke all on table public.produtos, public.adicionais, public.loja, public.clientes, public.pedidos, public.equipe
  from public, anon, authenticated;
grant select on table public.produtos, public.adicionais, public.loja to anon, authenticated;
grant select on table public.clientes, public.pedidos, public.equipe to authenticated;

do $$
declare
  v_seq text := pg_get_serial_sequence('public.pedidos', 'numero');
begin
  if v_seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', v_seq);
  end if;
end;
$$;

-- cardápio e loja: leitura pública
drop policy if exists produtos_leitura on public.produtos;
create policy produtos_leitura on public.produtos for select to anon, authenticated using (true);

drop policy if exists adicionais_leitura on public.adicionais;
create policy adicionais_leitura on public.adicionais for select to anon, authenticated using (true);

drop policy if exists loja_leitura on public.loja;
create policy loja_leitura on public.loja for select to anon, authenticated using (true);

-- pedidos e clientes: só a equipe
drop policy if exists pedidos_equipe on public.pedidos;
create policy pedidos_equipe on public.pedidos for select to authenticated using ((select public.is_equipe()));

drop policy if exists clientes_equipe on public.clientes;
create policy clientes_equipe on public.clientes for select to authenticated using ((select public.is_equipe()));

-- equipe: cada um vê só a própria linha
drop policy if exists equipe_propria on public.equipe;
create policy equipe_propria on public.equipe for select to authenticated using (user_id = (select auth.uid()));

-- ================= Realtime =================
-- pedidos (painel), produtos (esgotado) e loja (aberta/fechada); só adiciona o que ainda não está na publicação
do $$
declare
  v_tabela text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_tabela in array array['pedidos', 'produtos', 'loja'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabela);
    end if;
  end loop;
end;
$$;

-- ============ supabase/migrations/20261008000003_rpc.sql ============

-- Mineiro Lanche · 0003 · funções (RPC) chamadas pelo front com supabase.rpc(nome, args).
-- Todas security definer com search_path fixo. Erros de regra: raise exception '<codigo>' using errcode = 'P0001'
-- (o texto é só o código; o front traduz). Contrato: docs/CONTRATO-API.md.
-- Preço, resumo e normalização são espelho do core.js (ML.precos.item): o total do navegador nunca é usado.

-- ================= utilidades =================

-- dia de operação: vira às 4h de São Paulo (mesmo corte do DIA_OP_OFFSET do painel)
create or replace function public.dia_operacional(p_quando timestamptz default now())
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ((p_quando at time zone 'America/Sao_Paulo') - interval '4 hours')::date
$$;

-- data ISO 8601 em UTC com milissegundos (como o toISOString do navegador)
create or replace function public.data_iso(p timestamptz)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+00:00'
$$;

-- igual ao String.prototype.trim do navegador (espaços Unicode inclusive)
create or replace function public.aparar(p text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select regexp_replace(p,
    '^[\s   -     　﻿]+|[\s   -     　﻿]+$',
    '', 'g')
$$;

-- toLowerCase sem depender da collation do banco (acentos do português garantidos)
create or replace function public.minusculas(p text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select translate(lower(p), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'áàâãäéèêëíìîïóòôõöúùûüçñ')
$$;

-- texto de um campo jsonb: ausente/null → ''; string ou número → aparado; outro tipo ou acima do limite → dados_invalidos
create or replace function public.campo_texto(p jsonb, p_max int)
returns text
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '';
  end if;
  if jsonb_typeof(p) not in ('string', 'number') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v := public.aparar(p #>> '{}');
  if char_length(v) > p_max then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- inteiro de um campo jsonb entre p_min e p_max; ausente/null → p_padrao
create or replace function public.campo_inteiro(p jsonb, p_min int, p_max int, p_padrao int)
returns int
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return p_padrao;
  end if;
  if jsonb_typeof(p) <> 'number' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v := (p #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  return v::int;
end;
$$;

-- ================= horário (America/Sao_Paulo) =================

-- turno ["19:00","01:00"] em minutos {abre, fecha}; fecha passa de 1440 quando atravessa a meia-noite
create or replace function public.turno_minutos(p jsonb)
returns int[]
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_abre int;
  v_fecha int;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2 then
    return null;
  end if;
  v_abre := split_part(p ->> 0, ':', 1)::int * 60 + split_part(p ->> 0, ':', 2)::int;
  v_fecha := split_part(p ->> 1, ':', 1)::int * 60 + split_part(p ->> 1, ':', 2)::int;
  if v_fecha <= v_abre then
    v_fecha := v_fecha + 1440;
  end if;
  return array[v_abre, v_fecha];
end;
$$;

-- aberto pelo turno de hoje ou pela sobra de madrugada do turno de ontem (como ML.horario.situacaoNo)
create or replace function public.horario_aberto(p_horarios jsonb, p_quando timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_quando at time zone 'America/Sao_Paulo';
  v_dia int := extract(dow from v_local)::int;
  v_min int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_hoje int[] := public.turno_minutos(p_horarios -> v_dia::text);
  v_ontem int[] := public.turno_minutos(p_horarios -> ((v_dia + 6) % 7)::text);
begin
  if v_hoje is not null and v_min >= v_hoje[1] and v_min < v_hoje[2] then
    return true;
  end if;
  if v_ontem is not null and v_ontem[2] > 1440 and v_min < v_ontem[2] - 1440 then
    return true;
  end if;
  return false;
end;
$$;

-- aberta = modo 'aberta', ou modo 'auto' dentro do turno; sem linha da loja = fechada
create or replace function public.loja_aberta(p_quando timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case l.modo
             when 'aberta' then true
             when 'fechada' then false
             else public.horario_aberto(l.horarios, p_quando)
           end
    from public.loja l
    where l.id = 1
  ), false)
$$;

-- bloco "loja" do estado_cardapio e do definir_loja
create or replace function public.loja_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('modo', l.modo, 'aceitaFechada', l.aceita_fechada, 'comboPreco', l.combo_preco, 'horarios', l.horarios)
  from public.loja l
  where l.id = 1
$$;

-- ================= resumo e formato do pedido =================

-- mesmo texto do resumo() do core.js, a partir do item já normalizado
-- ex.: "Sem cebola roxa · Prensado · Combo +R$14,90 (Guaraná) · + Bacon"
create or replace function public.resumo_item(p_item jsonb, p_combo_preco numeric)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_partes text[] := '{}';
  v_removidos text;
  v_refri text := coalesce(p_item #>> '{combo,refri}', '');
  v_adicional jsonb;
  v_qtd int;
begin
  if p_item ->> 'tipo' in ('lanche', 'combo') then
    select string_agg(r.valor, ', ' order by r.n) into v_removidos
    from jsonb_array_elements_text(coalesce(p_item -> 'removidos', '[]'::jsonb)) with ordinality as r(valor, n);
    if (p_item -> 'completo') = 'false'::jsonb and coalesce(v_removidos, '') <> '' then
      v_partes := array_append(v_partes, 'Sem ' || public.minusculas(v_removidos));
    else
      v_partes := array_append(v_partes, 'Completo');
    end if;
    v_partes := array_append(v_partes, case when (p_item -> 'prensado') = 'true'::jsonb then 'Prensado' else 'Não prensado' end);
  end if;
  if (p_item #> '{combo,ativo}') = 'true'::jsonb then
    v_partes := array_append(v_partes,
      'Combo +R$' || replace(round(p_combo_preco, 2)::text, '.', ',') || case when v_refri <> '' then ' (' || v_refri || ')' else '' end);
  end if;
  for v_adicional in
    select a.valor from jsonb_array_elements(coalesce(p_item -> 'adicionais', '[]'::jsonb)) with ordinality as a(valor, n) order by a.n
  loop
    v_qtd := (v_adicional ->> 'qtd')::int;
    v_partes := array_append(v_partes, '+ ' || case when v_qtd > 1 then v_qtd || '× ' else '' end || (v_adicional ->> 'nome'));
  end loop;
  if coalesce(p_item ->> 'sabor', '') <> '' then
    v_partes := array_append(v_partes, p_item ->> 'sabor');
  end if;
  return array_to_string(v_partes, ' · ');
end;
$$;

-- pedido no formato do contrato do painel, mais token e mesa
create or replace function public.pedido_json(p public.pedidos)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'token', p.token,
    'criadoEm', public.data_iso(p.criado_em),
    'origem', p.origem,
    'mesa', p.mesa,
    'cliente', jsonb_build_object('nome', p.cliente_nome, 'telefone', p.cliente_telefone),
    'modo', p.modo,
    'endereco', p.endereco,
    'referencia', p.referencia,
    'pagamento', p.pagamento,
    'troco', p.troco,
    'obs', p.obs,
    'itens', p.itens,
    'total', p.total,
    'status', p.status,
    'historico', p.historico
  )
$$;

-- ================= criar_pedido (anon, authenticated) =================
create or replace function public.criar_pedido(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe boolean := public.is_equipe();
  v_agora timestamptz := date_trunc('milliseconds', now());
  v_idem uuid;
  v_existente public.pedidos;
  v_cliente jsonb;
  v_nome text;
  v_tel text;
  v_origem text;
  v_modo text;
  v_endereco text;
  v_referencia text;
  v_pagamento text;
  v_troco text;
  v_obs text;
  v_mesa text;
  v_loja public.loja;
  v_dia date := public.dia_operacional(now());
  v_entrada jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_removidos text[];
  v_prensado boolean;
  v_combo boolean;
  v_refri text;
  v_sabor text;
  v_adicionais jsonb;
  v_ids_adicionais text[];
  v_entrada_ad jsonb;
  v_adicional public.adicionais;
  v_qtd_ad int;
  v_unit numeric;
  v_sub numeric;
  v_item jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_pedido public.pedidos;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 65536 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- cliente
  v_cliente := p -> 'cliente';
  if v_cliente is null or jsonb_typeof(v_cliente) <> 'object' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_nome := public.campo_texto(v_cliente -> 'nome', 80);
  v_tel := regexp_replace(public.campo_texto(v_cliente -> 'telefone', 40), '[^0-9]', '', 'g');

  -- idempotência: o mesmo envio (queda de rede, clique duplo) devolve o pedido já gravado,
  -- antes de qualquer outra regra e sem contar no limite
  if p ? 'idempotencia' and jsonb_typeof(p -> 'idempotencia') <> 'null' then
    if jsonb_typeof(p -> 'idempotencia') <> 'string'
       or (p ->> 'idempotencia') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_idem := (p ->> 'idempotencia')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:idempotencia:' || v_idem::text, 0));
    select * into v_existente from public.pedidos where idempotencia = v_idem;
    if found then
      -- só devolve para quem mandou o mesmo telefone
      if v_existente.cliente_telefone <> v_tel then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      return public.pedido_json(v_existente);
    end if;
  end if;

  -- campos do pedido
  if char_length(v_nome) < 2 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_origem := coalesce(nullif(public.campo_texto(p -> 'origem', 20), ''), 'cardapio');
  if v_origem not in ('cardapio', 'qrcode', 'exemplo') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if v_origem = 'exemplo' and not v_equipe then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  -- telefone: 10 ou 11 dígitos (pedido de exemplo da equipe pode vir sem)
  if v_tel !~ '^[0-9]{10,11}$' and not (v_origem = 'exemplo' and v_tel = '') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_modo := public.campo_texto(p -> 'modo', 20);
  if v_modo not in ('entrega', 'retirada', 'local') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_endereco := public.campo_texto(p -> 'endereco', 200);
  if v_modo = 'entrega' and char_length(v_endereco) < 5 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_referencia := public.campo_texto(p -> 'referencia', 120);
  v_pagamento := nullif(public.campo_texto(p -> 'pagamento', 30), '');
  v_troco := public.campo_texto(p -> 'troco', 40);
  v_obs := public.campo_texto(p -> 'obs', 300);
  v_mesa := nullif(public.campo_texto(p -> 'mesa', 10), '');
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'itens') not between 1 and 30 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- loja e limite por telefone (a equipe ignora os dois)
  select * into v_loja from public.loja where id = 1;
  if not found then
    raise exception 'loja_fechada' using errcode = 'P0001';
  end if;
  if not v_equipe then
    if not public.loja_aberta(now()) and not v_loja.aceita_fechada then
      raise exception 'loja_fechada' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:telefone:' || v_tel, 0));
    if (select count(*) from public.pedidos
        where cliente_telefone = v_tel and criado_em > now() - interval '10 minutes') >= 5 then
      raise exception 'muitos_pedidos' using errcode = 'P0001';
    end if;
  end if;

  -- itens: preço e nome sempre do banco
  for v_entrada in
    select e.valor from jsonb_array_elements(p -> 'itens') with ordinality as e(valor, n) order by e.n
  loop
    if jsonb_typeof(v_entrada) <> 'object' or jsonb_typeof(v_entrada -> 'produtoId') is distinct from 'string' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    select * into v_prod from public.produtos where id = v_entrada ->> 'produtoId';
    -- preco null = "Preço a confirmar": está no cardápio, mas ainda não se vende pelo site (nem pela equipe)
    if not found or not v_prod.ativo or v_prod.preco is null then
      raise exception 'produto_invalido' using errcode = 'P0001';
    end if;
    if v_prod.esgotado_dia = v_dia then
      raise exception 'produto_esgotado' using errcode = 'P0001';
    end if;
    v_qtd := public.campo_inteiro(v_entrada -> 'qtd', 1, 20, 1);

    -- removidos: só os que estão nos ingredientes, sem repetir, em ordem (como o sort() do navegador);
    -- completo = true descarta a lista, como no core.js
    if jsonb_typeof(v_entrada -> 'removidos') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_removidos := '{}';
    if jsonb_typeof(v_entrada -> 'removidos') = 'array' and (v_entrada -> 'completo') is distinct from 'true'::jsonb then
      if jsonb_array_length(v_entrada -> 'removidos') > 50 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(r.valor order by r.valor collate "C"), '{}') into v_removidos
      from (
        select distinct x.valor #>> '{}' as valor
        from jsonb_array_elements(v_entrada -> 'removidos') as x(valor)
        where jsonb_typeof(x.valor) = 'string'
      ) r
      where r.valor = any (v_prod.ingredientes);
    end if;

    -- prensado: só lanche e combo (nos outros tipos vira false, como no core.js; não muda preço)
    v_prensado := v_prod.tipo in ('lanche', 'combo') and coalesce((v_entrada -> 'prensado') = 'true'::jsonb, false);

    -- vira combo: só lanche
    if jsonb_typeof(v_entrada -> 'combo') not in ('object', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_combo := false;
    v_refri := '';
    if (v_entrada #> '{combo,ativo}') = 'true'::jsonb then
      if v_prod.tipo <> 'lanche' then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      v_combo := true;
      v_refri := public.campo_texto(v_entrada #> '{combo,refri}', 40);
    end if;

    v_sabor := public.campo_texto(v_entrada -> 'sabor', 40);

    -- adicionais: só lanche e combo, id ativo, qtd de 1 a 5, na ordem em que vieram
    v_unit := v_prod.preco + case when v_combo then v_loja.combo_preco else 0 end;
    v_adicionais := '[]'::jsonb;
    v_ids_adicionais := '{}';
    if jsonb_typeof(v_entrada -> 'adicionais') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_entrada -> 'adicionais') = 'array' and jsonb_array_length(v_entrada -> 'adicionais') > 0 then
      if v_prod.tipo not in ('lanche', 'combo') then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      if jsonb_array_length(v_entrada -> 'adicionais') > 20 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      for v_entrada_ad in
        select a.valor from jsonb_array_elements(v_entrada -> 'adicionais') with ordinality as a(valor, n) order by a.n
      loop
        if jsonb_typeof(v_entrada_ad) <> 'object' or jsonb_typeof(v_entrada_ad -> 'id') is distinct from 'string' then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        if (v_entrada_ad ->> 'id') = any (v_ids_adicionais) then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        v_ids_adicionais := array_append(v_ids_adicionais, v_entrada_ad ->> 'id');
        select * into v_adicional from public.adicionais where id = v_entrada_ad ->> 'id';
        if not found or not v_adicional.ativo then
          raise exception 'produto_invalido' using errcode = 'P0001';
        end if;
        v_qtd_ad := public.campo_inteiro(v_entrada_ad -> 'qtd', 1, 5, 1);
        v_unit := v_unit + v_adicional.preco * v_qtd_ad;
        v_adicionais := v_adicionais || jsonb_build_array(jsonb_build_object(
          'id', v_adicional.id, 'nome', v_adicional.nome, 'qtd', v_qtd_ad, 'preco', v_adicional.preco));
      end loop;
    end if;

    -- precoUnit = preco + combo + Σ adicional × qtd; subtotal = precoUnit × qtd
    v_unit := round(v_unit, 2);
    v_sub := round(v_unit * v_qtd, 2);
    v_total := v_total + v_sub;
    v_item := jsonb_build_object(
      'produtoId', v_prod.id,
      'nome', v_prod.nome,
      'categoria', v_prod.categoria,
      'tipo', v_prod.tipo,
      'precoBase', v_prod.preco,
      'precoUnit', v_unit,
      'qtd', v_qtd,
      'completo', cardinality(v_removidos) = 0,
      'removidos', to_jsonb(v_removidos),
      'prensado', v_prensado,
      'combo', jsonb_build_object('ativo', v_combo, 'refri', v_refri),
      'adicionais', v_adicionais,
      'sabor', v_sabor
    );
    v_item := v_item || jsonb_build_object('resumo', public.resumo_item(v_item, v_loja.combo_preco), 'subtotal', v_sub);
    v_itens := v_itens || jsonb_build_array(v_item);
  end loop;

  insert into public.pedidos (
    criado_em, origem, mesa, cliente_nome, cliente_telefone, modo, endereco, referencia,
    pagamento, troco, obs, itens, total, status, historico, idempotencia
  ) values (
    v_agora, v_origem, v_mesa, v_nome, v_tel, v_modo, v_endereco, v_referencia,
    v_pagamento, v_troco, v_obs, v_itens, round(v_total, 2), 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'em', public.data_iso(v_agora))), v_idem
  )
  returning * into v_pedido;

  -- registro de clientes (pedido de exemplo não entra)
  if v_origem <> 'exemplo' then
    insert into public.clientes as c (telefone, nome, endereco, referencia, pedidos, primeiro_pedido_em, ultimo_pedido_em)
    values (
      v_tel, v_nome,
      case when v_modo = 'entrega' then v_endereco else '' end,
      case when v_modo = 'entrega' then v_referencia else '' end,
      1, v_agora, v_agora
    )
    on conflict (telefone) do update set
      nome = excluded.nome,
      endereco = case when v_modo = 'entrega' then excluded.endereco else c.endereco end,
      referencia = case when v_modo = 'entrega' then excluded.referencia else c.referencia end,
      pedidos = c.pedidos + 1,
      ultimo_pedido_em = excluded.ultimo_pedido_em;
  end if;

  return public.pedido_json(v_pedido);
end;
$$;

-- ================= acompanhar_pedido (anon, authenticated) =================
-- só o necessário para a tela "Acompanhe seu pedido": sem nome, telefone nem endereço
create or replace function public.acompanhar_pedido(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'numero', p.numero,
    'criadoEm', public.data_iso(p.criado_em),
    'status', p.status,
    'historico', p.historico,
    'modo', p.modo,
    'total', p.total,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', i.valor -> 'nome', 'qtd', i.valor -> 'qtd', 'resumo', i.valor -> 'resumo',
                                          'subtotal', i.valor -> 'subtotal') order by i.n)
      from jsonb_array_elements(p.itens) with ordinality as i(valor, n)
    ), '[]'::jsonb)
  )
  from public.pedidos p
  where p.token = p_token
$$;

-- ================= estado_cardapio (anon, authenticated) =================
-- o front aplica sobre o CONFIG: esgotados do dia, inativos, preços (null = "Preço a confirmar") e loja
create or replace function public.estado_cardapio()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (select public.dia_operacional(now()) as dia)
  select jsonb_build_object(
    'diaOperacional', to_char(d.dia, 'YYYY-MM-DD'),
    'esgotados', coalesce((select jsonb_agg(pr.id order by pr.ordem, pr.id) from public.produtos pr where pr.esgotado_dia = d.dia), '[]'::jsonb),
    'inativos', coalesce((select jsonb_agg(pr.id order by pr.ordem, pr.id) from public.produtos pr where not pr.ativo), '[]'::jsonb),
    'precos', coalesce((select jsonb_object_agg(pr.id, pr.preco) from public.produtos pr), '{}'::jsonb),
    'adicionais', coalesce((select jsonb_object_agg(a.id, a.preco) from public.adicionais a where a.ativo), '{}'::jsonb),
    'loja', public.loja_json()
  )
  from d
$$;

-- ================= funções da equipe (sem_permissao para quem não está em equipe) =================

-- novo→preparo; preparo→pronto (retirada/local) ou →rota (entrega); pronto|rota→entregue;
-- não final→cancelado com motivo (1 a 200). Pedido de exemplo aceita qualquer transição.
create or replace function public.mudar_status(p_id uuid, p_status text, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos;
  v_motivo text := public.aparar(coalesce(p_motivo, ''));
  v_ok boolean;
  v_evento jsonb;
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_id is null or p_status is null or p_status not in ('novo', 'preparo', 'pronto', 'rota', 'entregue', 'cancelado') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if char_length(v_motivo) > 200 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  select * into v_pedido from public.pedidos where id = p_id for update;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  if v_pedido.origem = 'exemplo' then
    v_ok := true;
  else
    v_ok := case
      when p_status = 'cancelado' then v_pedido.status in ('novo', 'preparo', 'pronto', 'rota')
      when v_pedido.status = 'novo' then p_status = 'preparo'
      when v_pedido.status = 'preparo' then p_status = case when v_pedido.modo = 'entrega' then 'rota' else 'pronto' end
      when v_pedido.status in ('pronto', 'rota') then p_status = 'entregue'
      else false
    end;
  end if;
  if not v_ok then
    raise exception 'transicao_invalida' using errcode = 'P0001';
  end if;
  if p_status = 'cancelado' and v_motivo = '' and v_pedido.origem <> 'exemplo' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_evento := jsonb_build_object('status', p_status, 'em', public.data_iso(now()));
  if v_motivo <> '' then
    v_evento := v_evento || jsonb_build_object('motivo', v_motivo);
  end if;
  update public.pedidos
     set status = p_status, historico = historico || jsonb_build_array(v_evento)
   where id = p_id
  returning * into v_pedido;
  return public.pedido_json(v_pedido);
end;
$$;

-- esgotado vale só no dia de operação (volta sozinho às 4h)
create or replace function public.marcar_esgotado(p_produto text, p_esgotado boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_produto is null or p_esgotado is null then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  update public.produtos
     set esgotado_dia = case when p_esgotado then public.dia_operacional(now()) end
   where id = p_produto;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
end;
$$;

-- modo manual da loja: 'auto' segue o horário; 'aberta' ou 'fechada' é decisão do painel
create or replace function public.definir_loja(p_modo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_modo is null or p_modo not in ('auto', 'aberta', 'fechada') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  update public.loja set modo = p_modo where id = 1;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  return public.loja_json();
end;
$$;

-- apaga só os pedidos de exemplo; devolve quantos saíram
create or replace function public.remover_testes()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_qtd int;
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  delete from public.pedidos where origem = 'exemplo';
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- ================= privilégios das funções =================
-- o Supabase dá execute em toda função nova a anon e authenticated: tira de todas e libera uma a uma
revoke all on function
  public.dia_operacional(timestamptz),
  public.data_iso(timestamptz),
  public.aparar(text),
  public.minusculas(text),
  public.campo_texto(jsonb, int),
  public.campo_inteiro(jsonb, int, int, int),
  public.turno_minutos(jsonb),
  public.horario_aberto(jsonb, timestamptz),
  public.loja_aberta(timestamptz),
  public.loja_json(),
  public.resumo_item(jsonb, numeric),
  public.pedido_json(public.pedidos),
  public.criar_pedido(jsonb),
  public.acompanhar_pedido(uuid),
  public.estado_cardapio(),
  public.mudar_status(uuid, text, text),
  public.marcar_esgotado(text, boolean),
  public.definir_loja(text),
  public.remover_testes()
from public, anon, authenticated;

-- cliente (cardápio, checkout e acompanhamento)
grant execute on function
  public.dia_operacional(timestamptz),
  public.loja_aberta(timestamptz),
  public.criar_pedido(jsonb),
  public.acompanhar_pedido(uuid),
  public.estado_cardapio()
to anon, authenticated;

-- painel (precisa de login; dentro, is_equipe() decide)
grant execute on function
  public.mudar_status(uuid, text, text),
  public.marcar_esgotado(text, boolean),
  public.definir_loja(text),
  public.remover_testes()
to authenticated;

-- ============ supabase/migrations/20261016000001_taxa_entrega.sql ============

-- Mineiro Lanche · 0004 · taxa de entrega por distância (km rodado, arredondado para cima, x taxa_km + taxa_fixa).
-- Combinado com o dono em 16/10/2026: "a quantidade de km de distância mais 4 reais, sempre arredondando para cima".
-- O navegador calcula a rota e manda distanciaKm; o banco refaz a conta e grava a taxa no pedido (e no total).
-- Sem distância (falha da consulta de endereço) a taxa fica null = "a combinar", como antes.

alter table public.loja add column if not exists taxa_km numeric(10, 2) not null default 1.00 check (taxa_km >= 0);
alter table public.loja add column if not exists taxa_fixa numeric(10, 2) not null default 4.00 check (taxa_fixa >= 0);
alter table public.pedidos add column if not exists distancia_km numeric(6, 3) check (distancia_km is null or (distancia_km > 0 and distancia_km <= 100));
alter table public.pedidos add column if not exists taxa_entrega numeric(10, 2) check (taxa_entrega is null or taxa_entrega >= 0);

-- ================= funções que mudam de formato =================

create or replace function public.loja_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('modo', l.modo, 'aceitaFechada', l.aceita_fechada, 'comboPreco', l.combo_preco,
    'taxaKm', l.taxa_km, 'taxaFixa', l.taxa_fixa, 'horarios', l.horarios)
  from public.loja l
  where l.id = 1
$$;

create or replace function public.pedido_json(p public.pedidos)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'token', p.token,
    'criadoEm', public.data_iso(p.criado_em),
    'origem', p.origem,
    'mesa', p.mesa,
    'cliente', jsonb_build_object('nome', p.cliente_nome, 'telefone', p.cliente_telefone),
    'modo', p.modo,
    'endereco', p.endereco,
    'referencia', p.referencia,
    'pagamento', p.pagamento,
    'troco', p.troco,
    'obs', p.obs,
    'itens', p.itens,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'status', p.status,
    'historico', p.historico
  )
$$;

create or replace function public.acompanhar_pedido(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'numero', p.numero,
    'criadoEm', public.data_iso(p.criado_em),
    'status', p.status,
    'historico', p.historico,
    'modo', p.modo,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', i.valor -> 'nome', 'qtd', i.valor -> 'qtd', 'resumo', i.valor -> 'resumo',
                                          'subtotal', i.valor -> 'subtotal') order by i.n)
      from jsonb_array_elements(p.itens) with ordinality as i(valor, n)
    ), '[]'::jsonb)
  )
  from public.pedidos p
  where p.token = p_token
$$;

create or replace function public.criar_pedido(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe boolean := public.is_equipe();
  v_agora timestamptz := date_trunc('milliseconds', now());
  v_idem uuid;
  v_existente public.pedidos;
  v_cliente jsonb;
  v_nome text;
  v_tel text;
  v_origem text;
  v_modo text;
  v_endereco text;
  v_referencia text;
  v_pagamento text;
  v_troco text;
  v_obs text;
  v_mesa text;
  v_loja public.loja;
  v_dia date := public.dia_operacional(now());
  v_entrada jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_removidos text[];
  v_prensado boolean;
  v_combo boolean;
  v_refri text;
  v_sabor text;
  v_adicionais jsonb;
  v_ids_adicionais text[];
  v_entrada_ad jsonb;
  v_adicional public.adicionais;
  v_qtd_ad int;
  v_unit numeric;
  v_sub numeric;
  v_item jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_dist numeric;
  v_taxa numeric;
  v_pedido public.pedidos;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 65536 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- cliente
  v_cliente := p -> 'cliente';
  if v_cliente is null or jsonb_typeof(v_cliente) <> 'object' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_nome := public.campo_texto(v_cliente -> 'nome', 80);
  v_tel := regexp_replace(public.campo_texto(v_cliente -> 'telefone', 40), '[^0-9]', '', 'g');

  -- idempotência: o mesmo envio (queda de rede, clique duplo) devolve o pedido já gravado,
  -- antes de qualquer outra regra e sem contar no limite
  if p ? 'idempotencia' and jsonb_typeof(p -> 'idempotencia') <> 'null' then
    if jsonb_typeof(p -> 'idempotencia') <> 'string'
       or (p ->> 'idempotencia') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_idem := (p ->> 'idempotencia')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:idempotencia:' || v_idem::text, 0));
    select * into v_existente from public.pedidos where idempotencia = v_idem;
    if found then
      -- só devolve para quem mandou o mesmo telefone
      if v_existente.cliente_telefone <> v_tel then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      return public.pedido_json(v_existente);
    end if;
  end if;

  -- campos do pedido
  if char_length(v_nome) < 2 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_origem := coalesce(nullif(public.campo_texto(p -> 'origem', 20), ''), 'cardapio');
  if v_origem not in ('cardapio', 'qrcode', 'exemplo') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if v_origem = 'exemplo' and not v_equipe then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  -- telefone: 10 ou 11 dígitos (pedido de exemplo da equipe pode vir sem)
  if v_tel !~ '^[0-9]{10,11}$' and not (v_origem = 'exemplo' and v_tel = '') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_modo := public.campo_texto(p -> 'modo', 20);
  if v_modo not in ('entrega', 'retirada', 'local') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_endereco := public.campo_texto(p -> 'endereco', 200);
  if v_modo = 'entrega' and char_length(v_endereco) < 5 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  -- distância da entrega (km pela rota, informada pelo navegador): de 0 a 100 km, 3 casas.
  -- Fora da entrega ou sem a distância, a taxa fica null = "a combinar" (o painel mostra assim)
  if p ? 'distanciaKm' and jsonb_typeof(p -> 'distanciaKm') not in ('number', 'null') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_dist := null;
  if v_modo = 'entrega' and jsonb_typeof(p -> 'distanciaKm') = 'number' then
    v_dist := round((p ->> 'distanciaKm')::numeric, 3);
    if v_dist <= 0 or v_dist > 100 then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
  end if;
  v_referencia := public.campo_texto(p -> 'referencia', 120);
  v_pagamento := nullif(public.campo_texto(p -> 'pagamento', 30), '');
  v_troco := public.campo_texto(p -> 'troco', 40);
  v_obs := public.campo_texto(p -> 'obs', 300);
  v_mesa := nullif(public.campo_texto(p -> 'mesa', 10), '');
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'itens') not between 1 and 30 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- loja e limite por telefone (a equipe ignora os dois)
  select * into v_loja from public.loja where id = 1;
  if not found then
    raise exception 'loja_fechada' using errcode = 'P0001';
  end if;
  if not v_equipe then
    if not public.loja_aberta(now()) and not v_loja.aceita_fechada then
      raise exception 'loja_fechada' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:telefone:' || v_tel, 0));
    if (select count(*) from public.pedidos
        where cliente_telefone = v_tel and criado_em > now() - interval '10 minutes') >= 5 then
      raise exception 'muitos_pedidos' using errcode = 'P0001';
    end if;
  end if;

  -- itens: preço e nome sempre do banco
  for v_entrada in
    select e.valor from jsonb_array_elements(p -> 'itens') with ordinality as e(valor, n) order by e.n
  loop
    if jsonb_typeof(v_entrada) <> 'object' or jsonb_typeof(v_entrada -> 'produtoId') is distinct from 'string' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    select * into v_prod from public.produtos where id = v_entrada ->> 'produtoId';
    -- preco null = "Preço a confirmar": está no cardápio, mas ainda não se vende pelo site (nem pela equipe)
    if not found or not v_prod.ativo or v_prod.preco is null then
      raise exception 'produto_invalido' using errcode = 'P0001';
    end if;
    if v_prod.esgotado_dia = v_dia then
      raise exception 'produto_esgotado' using errcode = 'P0001';
    end if;
    v_qtd := public.campo_inteiro(v_entrada -> 'qtd', 1, 20, 1);

    -- removidos: só os que estão nos ingredientes, sem repetir, em ordem (como o sort() do navegador);
    -- completo = true descarta a lista, como no core.js
    if jsonb_typeof(v_entrada -> 'removidos') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_removidos := '{}';
    if jsonb_typeof(v_entrada -> 'removidos') = 'array' and (v_entrada -> 'completo') is distinct from 'true'::jsonb then
      if jsonb_array_length(v_entrada -> 'removidos') > 50 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(r.valor order by r.valor collate "C"), '{}') into v_removidos
      from (
        select distinct x.valor #>> '{}' as valor
        from jsonb_array_elements(v_entrada -> 'removidos') as x(valor)
        where jsonb_typeof(x.valor) = 'string'
      ) r
      where r.valor = any (v_prod.ingredientes);
    end if;

    -- prensado: só lanche e combo (nos outros tipos vira false, como no core.js; não muda preço)
    v_prensado := v_prod.tipo in ('lanche', 'combo') and coalesce((v_entrada -> 'prensado') = 'true'::jsonb, false);

    -- vira combo: só lanche
    if jsonb_typeof(v_entrada -> 'combo') not in ('object', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_combo := false;
    v_refri := '';
    if (v_entrada #> '{combo,ativo}') = 'true'::jsonb then
      if v_prod.tipo <> 'lanche' then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      v_combo := true;
      v_refri := public.campo_texto(v_entrada #> '{combo,refri}', 40);
    end if;

    v_sabor := public.campo_texto(v_entrada -> 'sabor', 40);

    -- adicionais: só lanche e combo, id ativo, qtd de 1 a 5, na ordem em que vieram
    v_unit := v_prod.preco + case when v_combo then v_loja.combo_preco else 0 end;
    v_adicionais := '[]'::jsonb;
    v_ids_adicionais := '{}';
    if jsonb_typeof(v_entrada -> 'adicionais') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_entrada -> 'adicionais') = 'array' and jsonb_array_length(v_entrada -> 'adicionais') > 0 then
      if v_prod.tipo not in ('lanche', 'combo') then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      if jsonb_array_length(v_entrada -> 'adicionais') > 20 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      for v_entrada_ad in
        select a.valor from jsonb_array_elements(v_entrada -> 'adicionais') with ordinality as a(valor, n) order by a.n
      loop
        if jsonb_typeof(v_entrada_ad) <> 'object' or jsonb_typeof(v_entrada_ad -> 'id') is distinct from 'string' then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        if (v_entrada_ad ->> 'id') = any (v_ids_adicionais) then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        v_ids_adicionais := array_append(v_ids_adicionais, v_entrada_ad ->> 'id');
        select * into v_adicional from public.adicionais where id = v_entrada_ad ->> 'id';
        if not found or not v_adicional.ativo then
          raise exception 'produto_invalido' using errcode = 'P0001';
        end if;
        v_qtd_ad := public.campo_inteiro(v_entrada_ad -> 'qtd', 1, 5, 1);
        v_unit := v_unit + v_adicional.preco * v_qtd_ad;
        v_adicionais := v_adicionais || jsonb_build_array(jsonb_build_object(
          'id', v_adicional.id, 'nome', v_adicional.nome, 'qtd', v_qtd_ad, 'preco', v_adicional.preco));
      end loop;
    end if;

    -- precoUnit = preco + combo + Σ adicional × qtd; subtotal = precoUnit × qtd
    v_unit := round(v_unit, 2);
    v_sub := round(v_unit * v_qtd, 2);
    v_total := v_total + v_sub;
    v_item := jsonb_build_object(
      'produtoId', v_prod.id,
      'nome', v_prod.nome,
      'categoria', v_prod.categoria,
      'tipo', v_prod.tipo,
      'precoBase', v_prod.preco,
      'precoUnit', v_unit,
      'qtd', v_qtd,
      'completo', cardinality(v_removidos) = 0,
      'removidos', to_jsonb(v_removidos),
      'prensado', v_prensado,
      'combo', jsonb_build_object('ativo', v_combo, 'refri', v_refri),
      'adicionais', v_adicionais,
      'sabor', v_sabor
    );
    v_item := v_item || jsonb_build_object('resumo', public.resumo_item(v_item, v_loja.combo_preco), 'subtotal', v_sub);
    v_itens := v_itens || jsonb_build_array(v_item);
  end loop;

  -- taxa de entrega: km cobrados (sempre para cima) x taxa_km + taxa_fixa; entra no total
  if v_dist is not null then
    v_taxa := round(ceil(v_dist) * v_loja.taxa_km + v_loja.taxa_fixa, 2);
    v_total := v_total + v_taxa;
  end if;

  insert into public.pedidos (
    criado_em, origem, mesa, cliente_nome, cliente_telefone, modo, endereco, referencia,
    pagamento, troco, obs, itens, total, distancia_km, taxa_entrega, status, historico, idempotencia
  ) values (
    v_agora, v_origem, v_mesa, v_nome, v_tel, v_modo, v_endereco, v_referencia,
    v_pagamento, v_troco, v_obs, v_itens, round(v_total, 2), v_dist, v_taxa, 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'em', public.data_iso(v_agora))), v_idem
  )
  returning * into v_pedido;

  -- registro de clientes (pedido de exemplo não entra)
  if v_origem <> 'exemplo' then
    insert into public.clientes as c (telefone, nome, endereco, referencia, pedidos, primeiro_pedido_em, ultimo_pedido_em)
    values (
      v_tel, v_nome,
      case when v_modo = 'entrega' then v_endereco else '' end,
      case when v_modo = 'entrega' then v_referencia else '' end,
      1, v_agora, v_agora
    )
    on conflict (telefone) do update set
      nome = excluded.nome,
      endereco = case when v_modo = 'entrega' then excluded.endereco else c.endereco end,
      referencia = case when v_modo = 'entrega' then excluded.referencia else c.referencia end,
      pedidos = c.pedidos + 1,
      ultimo_pedido_em = excluded.ultimo_pedido_em;
  end if;

  return public.pedido_json(v_pedido);
end;
$$;

-- ============ supabase/migrations/20261017000001_motoboy.sql ============

-- Mineiro Lanche · 0005 · motoboy: tabela própria, leitura das entregas em rota e confirmação de entrega.
-- Decisão do dono em 17/10/2026: o motoboy lê o QR da comanda e a leitura já marca o pedido como entregue.
-- O motoboy NUNCA entra na tabela equipe (daria o painel inteiro e os dados de todos os clientes): tem tabela própria e
-- enxerga só os pedidos de entrega em rota do dia, sem itens e sem token. Contrato: docs/CONTRATO-API.md.
-- Só aditiva e idempotente: tabela e funções novas, nada do que já existe muda.
-- Reversão: drop function if exists public.confirmar_entrega(uuid), public.entregas_em_rota(), public.entrega_json(public.pedidos), public.is_motoboy();
--           drop table if exists public.motoboys;

-- ================= motoboys =================
-- quem pode confirmar entregas (o usuário é criado no Auth do Supabase); ativo = false corta o acesso sem apagar a linha
create table if not exists public.motoboys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  ativo boolean not null default true
);

alter table public.motoboys enable row level security;

-- o Supabase dá todos os privilégios em tabela nova a anon e authenticated: tira e libera só a leitura da própria linha
revoke all on table public.motoboys from public, anon, authenticated;
grant select on table public.motoboys to authenticated;

-- a tela do motoboy checa o acesso com from('motoboys').select('user_id').eq('user_id', id).maybeSingle(),
-- igual ao painel faz com equipe; motoboy desativado não enxerga nem a própria linha
drop policy if exists motoboys_proprio on public.motoboys;
create policy motoboys_proprio on public.motoboys for select to authenticated
  using (user_id = (select auth.uid()) and ativo);

-- ================= funções internas =================

-- motoboy ativo (security definer: lê motoboys sem depender do RLS). Interna: sem grant a anon nem authenticated
create or replace function public.is_motoboy()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.motoboys where user_id = auth.uid() and ativo)
$$;

-- o que o motoboy vê de um pedido: o necessário para entregar e nada mais (sem itens, sem token, sem histórico).
-- saiuEm = quando foi para a rota; entregueEm = quando foi entregue (do histórico; null se ainda não houve)
create or replace function public.entrega_json(p public.pedidos)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'status', p.status,
    'cliente', jsonb_build_object('nome', p.cliente_nome, 'telefone', p.cliente_telefone),
    'endereco', p.endereco,
    'referencia', p.referencia,
    'obs', p.obs,
    'total', p.total,
    'taxaEntrega', p.taxa_entrega,
    'distanciaKm', p.distancia_km,
    'saiuEm', (select e.valor ->> 'em' from jsonb_array_elements(p.historico) with ordinality as e(valor, n)
               where e.valor ->> 'status' = 'rota' order by e.n desc limit 1),
    'entregueEm', (select e.valor ->> 'em' from jsonb_array_elements(p.historico) with ordinality as e(valor, n)
                   where e.valor ->> 'status' = 'entregue' order by e.n desc limit 1)
  )
$$;

-- ================= funções do motoboy (e da equipe) =================

-- lista das entregas em rota do dia de operação (mesmo corte de 4h do dia_operacional): só modo = 'entrega' e status = 'rota'.
-- Pedido preso em 'rota' de um dia anterior fica de fora. Mais antigo primeiro.
create or replace function public.entregas_em_rota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dia date := public.dia_operacional(now());
begin
  if not (public.is_motoboy() or public.is_equipe()) then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(public.entrega_json(p) order by p.criado_em, p.numero)
    from public.pedidos p
    where p.modo = 'entrega'
      and p.status = 'rota'
      and public.dia_operacional(p.criado_em) = v_dia
  ), '[]'::jsonb);
end;
$$;

-- confirma a entrega de um pedido: { ok, jaEntregue, pedido } (pedido = o mesmo recorte de entregas_em_rota).
-- preparo grava rota e depois entregue; pronto e rota gravam só entregue; os eventos do histórico levam "por"
-- ('motoboy' ou 'equipe'; quem está nas duas tabelas conta como motoboy, porque esta é a função da tela do motoboy).
-- Pedido já entregue devolve jaEntregue = true sem gravar nada (ler o QR duas vezes não é erro e não mexe no histórico).
-- Erros: sem_permissao, dados_invalidos (id null), nao_encontrado, nao_e_entrega (retirada ou local),
-- pedido_cancelado, transicao_invalida (pedido ainda novo, que a equipe nem aceitou)
create or replace function public.confirmar_entrega(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_por text;
  v_pedido public.pedidos;
  v_em text := public.data_iso(now());
  v_eventos jsonb := '[]'::jsonb;
begin
  if public.is_motoboy() then
    v_por := 'motoboy';
  elsif public.is_equipe() then
    v_por := 'equipe';
  else
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  select * into v_pedido from public.pedidos where id = p_id for update;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  if v_pedido.modo <> 'entrega' then
    raise exception 'nao_e_entrega' using errcode = 'P0001';
  end if;
  if v_pedido.status = 'entregue' then
    return jsonb_build_object('ok', true, 'jaEntregue', true, 'pedido', public.entrega_json(v_pedido));
  end if;
  if v_pedido.status = 'cancelado' then
    raise exception 'pedido_cancelado' using errcode = 'P0001';
  end if;
  if v_pedido.status = 'novo' then
    raise exception 'transicao_invalida' using errcode = 'P0001';
  end if;
  -- preparo → rota → entregue: registra o passo que faltou, para o histórico (e a tela do cliente) continuarem em ordem
  if v_pedido.status = 'preparo' then
    v_eventos := jsonb_build_array(jsonb_build_object('status', 'rota', 'em', v_em, 'por', v_por));
  end if;
  v_eventos := v_eventos || jsonb_build_array(jsonb_build_object('status', 'entregue', 'em', v_em, 'por', v_por));
  update public.pedidos
     set status = 'entregue', historico = historico || v_eventos
   where id = p_id
  returning * into v_pedido;
  return jsonb_build_object('ok', true, 'jaEntregue', false, 'pedido', public.entrega_json(v_pedido));
end;
$$;

-- ================= privilégios das funções =================
-- o Supabase dá execute em toda função nova a anon e authenticated: tira de todas e libera só as duas do motoboy,
-- só para quem está logado (dentro, is_motoboy() ou is_equipe() decide)
revoke all on function
  public.is_motoboy(),
  public.entrega_json(public.pedidos),
  public.entregas_em_rota(),
  public.confirmar_entrega(uuid)
from public, anon, authenticated;

grant execute on function
  public.entregas_em_rota(),
  public.confirmar_entrega(uuid)
to authenticated;

notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261017000002_confirmar_entrega_ja_entregue.sql ============

-- Mineiro Lanche · 0006 · confirmar_entrega: no caminho "já entregue", só { id, numero, status }.
-- Revisão de segurança de 17/10/2026 (docs/PLANO-FASE-3.md §8): confirmar_entrega não recorta o dia de operação, então um
-- motoboy com o id de um pedido antigo (já entregue) via nome, telefone e endereço do cliente. Ler o QR de novo continua
-- respondendo jaEntregue = true, sem erro e sem gravar nada, mas o pedido volta só com id, numero e status.
-- Só aditiva e idempotente: create or replace da mesma função, mesma assinatura e mesmos privilégios.
-- Reversão: reaplicar a confirmar_entrega de supabase/migrations/20261017000001_motoboy.sql.

-- confirma a entrega de um pedido: { ok, jaEntregue, pedido }. Quando grava, pedido = o mesmo recorte de entregas_em_rota;
-- quando já estava entregue, pedido = { id, numero, status }, sem dados do cliente.
-- preparo grava rota e depois entregue; pronto e rota gravam só entregue; os eventos do histórico levam "por"
-- ('motoboy' ou 'equipe'; quem está nas duas tabelas conta como motoboy, porque esta é a função da tela do motoboy).
-- Pedido já entregue devolve jaEntregue = true sem gravar nada (ler o QR duas vezes não é erro e não mexe no histórico).
-- Erros: sem_permissao, dados_invalidos (id null), nao_encontrado, nao_e_entrega (retirada ou local),
-- pedido_cancelado, transicao_invalida (pedido ainda novo, que a equipe nem aceitou)
create or replace function public.confirmar_entrega(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_por text;
  v_pedido public.pedidos;
  v_em text := public.data_iso(now());
  v_eventos jsonb := '[]'::jsonb;
begin
  if public.is_motoboy() then
    v_por := 'motoboy';
  elsif public.is_equipe() then
    v_por := 'equipe';
  else
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  select * into v_pedido from public.pedidos where id = p_id for update;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  if v_pedido.modo <> 'entrega' then
    raise exception 'nao_e_entrega' using errcode = 'P0001';
  end if;
  if v_pedido.status = 'entregue' then
    return jsonb_build_object('ok', true, 'jaEntregue', true,
      'pedido', jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status));
  end if;
  if v_pedido.status = 'cancelado' then
    raise exception 'pedido_cancelado' using errcode = 'P0001';
  end if;
  if v_pedido.status = 'novo' then
    raise exception 'transicao_invalida' using errcode = 'P0001';
  end if;
  -- preparo → rota → entregue: registra o passo que faltou, para o histórico (e a tela do cliente) continuarem em ordem
  if v_pedido.status = 'preparo' then
    v_eventos := jsonb_build_array(jsonb_build_object('status', 'rota', 'em', v_em, 'por', v_por));
  end if;
  v_eventos := v_eventos || jsonb_build_array(jsonb_build_object('status', 'entregue', 'em', v_em, 'por', v_por));
  update public.pedidos
     set status = 'entregue', historico = historico || v_eventos
   where id = p_id
  returning * into v_pedido;
  return jsonb_build_object('ok', true, 'jaEntregue', false, 'pedido', public.entrega_json(v_pedido));
end;
$$;

-- o create or replace mantém os privilégios; repetidos aqui para a migration valer sozinha (só quem está logado executa)
revoke all on function public.confirmar_entrega(uuid) from public, anon, authenticated;
grant execute on function public.confirmar_entrega(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261018023009_cotacao_entrega.sql ============

-- Cotação privada emitida pelo backend. A flag só é ativada após validar os provedores.
alter table public.loja add column if not exists cotacao_ativa boolean not null default false;
alter table public.loja add column if not exists entrega_origem jsonb not null
  default '{"lat":-23.5409777,"lon":-46.312935,"perfil":"driving"}'::jsonb;
alter table public.pedidos add column if not exists cotacao_entrega_id uuid;

create table if not exists public.entrega_cache (
  chave text primary key check (chave ~ '^[a-f0-9]{64}$'),
  localizacao jsonb not null,
  local_valida_ate timestamptz not null,
  distancia_km numeric(6,3) check (distancia_km > 0 and distancia_km <= 100),
  rota_valida_ate timestamptz,
  origem jsonb not null,
  fonte_rota text,
  atualizado_em timestamptz not null default now()
);
create index if not exists entrega_cache_expira on public.entrega_cache(local_valida_ate);
create table if not exists public.cotacoes_entrega (
  id uuid primary key default gen_random_uuid(),
  endereco text not null check (char_length(endereco) between 5 and 200),
  distancia_km numeric(6,3) not null check (distancia_km > 0 and distancia_km <= 100),
  taxa_km numeric(10,2) not null check (taxa_km >= 0),
  taxa_fixa numeric(10,2) not null check (taxa_fixa >= 0),
  origem jsonb not null,
  fonte text not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '15 minutes')
);
create index if not exists cotacoes_entrega_expira on public.cotacoes_entrega(expira_em);
create table if not exists public.entrega_travas (
  chave text primary key, dono uuid not null, ate timestamptz not null
);
create table if not exists public.entrega_limites (
  chave text primary key, quantidade integer not null, ate timestamptz not null
);
create index if not exists entrega_limites_expira on public.entrega_limites(ate);
create table if not exists public.entrega_eventos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  codigo text not null, fonte text not null default '', duracao_ms integer not null
);
create index if not exists entrega_eventos_criado on public.entrega_eventos(criado_em);

alter table public.entrega_cache enable row level security;
alter table public.cotacoes_entrega enable row level security;
alter table public.entrega_travas enable row level security;
alter table public.entrega_limites enable row level security;
alter table public.entrega_eventos enable row level security;
revoke all on public.entrega_cache, public.cotacoes_entrega, public.entrega_travas,
  public.entrega_limites, public.entrega_eventos from public, anon, authenticated;
grant all on public.entrega_cache, public.cotacoes_entrega, public.entrega_travas,
  public.entrega_limites, public.entrega_eventos to service_role;
grant usage, select on sequence public.entrega_eventos_id_seq to service_role;
revoke all on sequence public.entrega_eventos_id_seq from public,anon,authenticated;

-- Contadores e trava compartilhados entre todas as instâncias do backend.
create or replace function public.reservar_entrega(p_chave text, p_cliente text, p_dono uuid)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_n integer; v_bucket text;
begin
  if p_chave !~ '^[a-f0-9]{64}$' or p_cliente !~ '^[a-f0-9]{64}$' or p_dono is null then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  insert into public.entrega_travas values (p_chave,p_dono,now()+interval '90 seconds')
  on conflict (chave) do update set dono=excluded.dono, ate=excluded.ate
    where entrega_travas.ate < now();
  if not found then return false; end if;
  v_bucket := 'ip:' || p_cliente || ':' || floor(extract(epoch from now())/600)::text;
  insert into public.entrega_limites values (v_bucket,1,now()+interval '20 minutes')
  on conflict(chave) do update set quantidade=entrega_limites.quantidade+1 returning quantidade into v_n;
  if v_n > 30 then raise exception 'muitas_cotacoes' using errcode='P0001'; end if;
  v_bucket := 'global:' || (now() at time zone 'UTC')::date::text;
  insert into public.entrega_limites values (v_bucket,1,now()+interval '2 days')
  on conflict(chave) do update set quantidade=entrega_limites.quantidade+1 returning quantidade into v_n;
  if v_n > 1000 then raise exception 'muitas_cotacoes' using errcode='P0001'; end if;
  delete from public.entrega_limites where ate < now();
  delete from public.entrega_travas where ate < now();
  delete from public.entrega_cache where local_valida_ate < now()-interval '1 day';
  delete from public.cotacoes_entrega where expira_em < now()-interval '7 days';
  delete from public.entrega_eventos where criado_em < now()-interval '7 days';
  return true;
end $$;
revoke all on function public.reservar_entrega(text,text,uuid) from public,anon,authenticated;
grant execute on function public.reservar_entrega(text,text,uuid) to service_role;

create or replace function public.emitir_cotacao_entrega(p_endereco text, p_km numeric, p_origem jsonb, p_fonte text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_loja public.loja; v_q public.cotacoes_entrega;
begin
  select * into v_loja from public.loja where id=1 for share;
  if v_loja.entrega_origem is distinct from p_origem then
    raise exception 'cotacao_expirada' using errcode='P0001';
  end if;
  insert into public.cotacoes_entrega(endereco,distancia_km,taxa_km,taxa_fixa,origem,fonte)
  values (btrim(p_endereco),round(p_km,3),v_loja.taxa_km,v_loja.taxa_fixa,p_origem,p_fonte) returning * into v_q;
  return jsonb_build_object('id',v_q.id,'distanciaKm',v_q.distancia_km,
    'taxa',round(ceil(v_q.distancia_km)*v_q.taxa_km+v_q.taxa_fixa,2),'expiraEm',v_q.expira_em,'estado','ok');
end $$;
revoke all on function public.emitir_cotacao_entrega(text,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.emitir_cotacao_entrega(text,numeric,jsonb,text) to service_role;

create or replace function public.loja_json()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('modo',l.modo,'aceitaFechada',l.aceita_fechada,'comboPreco',l.combo_preco,
    'taxaKm',l.taxa_km,'taxaFixa',l.taxa_fixa,'horarios',l.horarios,'cotacaoAtiva',l.cotacao_ativa)
  from public.loja l where l.id=1
$$;

-- Métricas sem dados pessoais, acessíveis somente à equipe.
create or replace function public.resumo_entregas()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  return (select coalesce(jsonb_object_agg(codigo,n),'{}'::jsonb) from
    (select codigo,count(*) n from public.entrega_eventos where criado_em>now()-interval '24 hours' group by codigo) s);
end $$;
revoke all on function public.resumo_entregas() from public,anon;
grant execute on function public.resumo_entregas() to authenticated;

create or replace function public.definir_origem_entrega(p_lat double precision,p_lon double precision)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  if p_lat is null or p_lon is null or p_lat not between -34 and 6 or p_lon not between -74 and -34 then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  update public.loja set entrega_origem=jsonb_build_object('lat',p_lat,'lon',p_lon,'perfil','driving','confirmadaEm',public.data_iso(now())) where id=1;
end $$;
revoke all on function public.definir_origem_entrega(double precision,double precision) from public,anon;
grant execute on function public.definir_origem_entrega(double precision,double precision) to authenticated;

-- Mesmo contrato de criação, com a distância obtida da cotação privada.
create or replace function public.criar_pedido(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe boolean := public.is_equipe();
  v_agora timestamptz := date_trunc('milliseconds', now());
  v_idem uuid;
  v_existente public.pedidos;
  v_cliente jsonb;
  v_nome text;
  v_tel text;
  v_origem text;
  v_modo text;
  v_endereco text;
  v_referencia text;
  v_pagamento text;
  v_troco text;
  v_obs text;
  v_mesa text;
  v_loja public.loja;
  v_cotacao public.cotacoes_entrega;
  v_dia date := public.dia_operacional(now());
  v_entrada jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_removidos text[];
  v_prensado boolean;
  v_combo boolean;
  v_refri text;
  v_sabor text;
  v_adicionais jsonb;
  v_ids_adicionais text[];
  v_entrada_ad jsonb;
  v_adicional public.adicionais;
  v_qtd_ad int;
  v_unit numeric;
  v_sub numeric;
  v_item jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_dist numeric;
  v_taxa numeric;
  v_pedido public.pedidos;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 65536 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- cliente
  v_cliente := p -> 'cliente';
  if v_cliente is null or jsonb_typeof(v_cliente) <> 'object' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_nome := public.campo_texto(v_cliente -> 'nome', 80);
  v_tel := regexp_replace(public.campo_texto(v_cliente -> 'telefone', 40), '[^0-9]', '', 'g');

  -- idempotência: o mesmo envio (queda de rede, clique duplo) devolve o pedido já gravado,
  -- antes de qualquer outra regra e sem contar no limite
  if p ? 'idempotencia' and jsonb_typeof(p -> 'idempotencia') <> 'null' then
    if jsonb_typeof(p -> 'idempotencia') <> 'string'
       or (p ->> 'idempotencia') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_idem := (p ->> 'idempotencia')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:idempotencia:' || v_idem::text, 0));
    select * into v_existente from public.pedidos where idempotencia = v_idem;
    if found then
      -- só devolve para quem mandou o mesmo telefone
      if v_existente.cliente_telefone <> v_tel then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      return public.pedido_json(v_existente);
    end if;
  end if;

  -- campos do pedido
  if char_length(v_nome) < 2 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_origem := coalesce(nullif(public.campo_texto(p -> 'origem', 20), ''), 'cardapio');
  if v_origem not in ('cardapio', 'qrcode', 'exemplo') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if v_origem = 'exemplo' and not v_equipe then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  -- telefone: 10 ou 11 dígitos (pedido de exemplo da equipe pode vir sem)
  if v_tel !~ '^[0-9]{10,11}$' and not (v_origem = 'exemplo' and v_tel = '') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_modo := public.campo_texto(p -> 'modo', 20);
  if v_modo not in ('entrega', 'retirada', 'local') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_endereco := public.campo_texto(p -> 'endereco', 200);
  if v_modo = 'entrega' and char_length(v_endereco) < 5 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  -- distância da entrega (km pela rota, informada pelo navegador): de 0 a 100 km, 3 casas.
  -- Fora da entrega ou sem a distância, a taxa fica null = "a combinar" (o painel mostra assim)
  if p ? 'distanciaKm' and jsonb_typeof(p -> 'distanciaKm') not in ('number', 'null') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_dist := null;
  if v_modo = 'entrega' and jsonb_typeof(p -> 'distanciaKm') = 'number' then
    v_dist := round((p ->> 'distanciaKm')::numeric, 3);
    if v_dist <= 0 or v_dist > 100 then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
  end if;
  v_referencia := public.campo_texto(p -> 'referencia', 120);
  v_pagamento := nullif(public.campo_texto(p -> 'pagamento', 30), '');
  v_troco := public.campo_texto(p -> 'troco', 40);
  v_obs := public.campo_texto(p -> 'obs', 300);
  v_mesa := nullif(public.campo_texto(p -> 'mesa', 10), '');
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'itens') not between 1 and 30 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- loja e limite por telefone (a equipe ignora os dois)
  select * into v_loja from public.loja where id = 1;
  if not found then
    raise exception 'loja_fechada' using errcode = 'P0001';
  end if;
  -- Cotação obrigatória para novas entregas; idempotência e pedidos antigos continuam preservados.
  if v_modo = 'entrega' and v_loja.cotacao_ativa and v_origem <> 'exemplo' then
    if jsonb_typeof(p->'cotacaoId') is distinct from 'string'
       or (p->>'cotacaoId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'cotacao_necessaria' using errcode='P0001';
    end if;
    select * into v_cotacao from public.cotacoes_entrega where id=(p->>'cotacaoId')::uuid;
    if not found then raise exception 'cotacao_necessaria' using errcode='P0001'; end if;
    if v_cotacao.expira_em <= now() or v_cotacao.origem is distinct from v_loja.entrega_origem
       or v_cotacao.taxa_km <> v_loja.taxa_km or v_cotacao.taxa_fixa <> v_loja.taxa_fixa then
      raise exception 'cotacao_expirada' using errcode='P0001';
    end if;
    if lower(regexp_replace(btrim(v_cotacao.endereco),'\s+',' ','g')) <>
       lower(regexp_replace(btrim(v_endereco),'\s+',' ','g')) then
      raise exception 'cotacao_endereco_divergente' using errcode='P0001';
    end if;
    v_dist := v_cotacao.distancia_km;
  end if;
  if not v_equipe then
    if not public.loja_aberta(now()) and not v_loja.aceita_fechada then
      raise exception 'loja_fechada' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:telefone:' || v_tel, 0));
    if (select count(*) from public.pedidos
        where cliente_telefone = v_tel and criado_em > now() - interval '10 minutes') >= 5 then
      raise exception 'muitos_pedidos' using errcode = 'P0001';
    end if;
  end if;

  -- itens: preço e nome sempre do banco
  for v_entrada in
    select e.valor from jsonb_array_elements(p -> 'itens') with ordinality as e(valor, n) order by e.n
  loop
    if jsonb_typeof(v_entrada) <> 'object' or jsonb_typeof(v_entrada -> 'produtoId') is distinct from 'string' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    select * into v_prod from public.produtos where id = v_entrada ->> 'produtoId';
    -- preco null = "Preço a confirmar": está no cardápio, mas ainda não se vende pelo site (nem pela equipe)
    if not found or not v_prod.ativo or v_prod.preco is null then
      raise exception 'produto_invalido' using errcode = 'P0001';
    end if;
    if v_prod.esgotado_dia = v_dia then
      raise exception 'produto_esgotado' using errcode = 'P0001';
    end if;
    v_qtd := public.campo_inteiro(v_entrada -> 'qtd', 1, 20, 1);

    -- removidos: só os que estão nos ingredientes, sem repetir, em ordem (como o sort() do navegador);
    -- completo = true descarta a lista, como no core.js
    if jsonb_typeof(v_entrada -> 'removidos') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_removidos := '{}';
    if jsonb_typeof(v_entrada -> 'removidos') = 'array' and (v_entrada -> 'completo') is distinct from 'true'::jsonb then
      if jsonb_array_length(v_entrada -> 'removidos') > 50 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(r.valor order by r.valor collate "C"), '{}') into v_removidos
      from (
        select distinct x.valor #>> '{}' as valor
        from jsonb_array_elements(v_entrada -> 'removidos') as x(valor)
        where jsonb_typeof(x.valor) = 'string'
      ) r
      where r.valor = any (v_prod.ingredientes);
    end if;

    -- prensado: só lanche e combo (nos outros tipos vira false, como no core.js; não muda preço)
    v_prensado := v_prod.tipo in ('lanche', 'combo') and coalesce((v_entrada -> 'prensado') = 'true'::jsonb, false);

    -- vira combo: só lanche
    if jsonb_typeof(v_entrada -> 'combo') not in ('object', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_combo := false;
    v_refri := '';
    if (v_entrada #> '{combo,ativo}') = 'true'::jsonb then
      if v_prod.tipo <> 'lanche' then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      v_combo := true;
      v_refri := public.campo_texto(v_entrada #> '{combo,refri}', 40);
    end if;

    v_sabor := public.campo_texto(v_entrada -> 'sabor', 40);

    -- adicionais: só lanche e combo, id ativo, qtd de 1 a 5, na ordem em que vieram
    v_unit := v_prod.preco + case when v_combo then v_loja.combo_preco else 0 end;
    v_adicionais := '[]'::jsonb;
    v_ids_adicionais := '{}';
    if jsonb_typeof(v_entrada -> 'adicionais') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_entrada -> 'adicionais') = 'array' and jsonb_array_length(v_entrada -> 'adicionais') > 0 then
      if v_prod.tipo not in ('lanche', 'combo') then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      if jsonb_array_length(v_entrada -> 'adicionais') > 20 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      for v_entrada_ad in
        select a.valor from jsonb_array_elements(v_entrada -> 'adicionais') with ordinality as a(valor, n) order by a.n
      loop
        if jsonb_typeof(v_entrada_ad) <> 'object' or jsonb_typeof(v_entrada_ad -> 'id') is distinct from 'string' then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        if (v_entrada_ad ->> 'id') = any (v_ids_adicionais) then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        v_ids_adicionais := array_append(v_ids_adicionais, v_entrada_ad ->> 'id');
        select * into v_adicional from public.adicionais where id = v_entrada_ad ->> 'id';
        if not found or not v_adicional.ativo then
          raise exception 'produto_invalido' using errcode = 'P0001';
        end if;
        v_qtd_ad := public.campo_inteiro(v_entrada_ad -> 'qtd', 1, 5, 1);
        v_unit := v_unit + v_adicional.preco * v_qtd_ad;
        v_adicionais := v_adicionais || jsonb_build_array(jsonb_build_object(
          'id', v_adicional.id, 'nome', v_adicional.nome, 'qtd', v_qtd_ad, 'preco', v_adicional.preco));
      end loop;
    end if;

    -- precoUnit = preco + combo + Σ adicional × qtd; subtotal = precoUnit × qtd
    v_unit := round(v_unit, 2);
    v_sub := round(v_unit * v_qtd, 2);
    v_total := v_total + v_sub;
    v_item := jsonb_build_object(
      'produtoId', v_prod.id,
      'nome', v_prod.nome,
      'categoria', v_prod.categoria,
      'tipo', v_prod.tipo,
      'precoBase', v_prod.preco,
      'precoUnit', v_unit,
      'qtd', v_qtd,
      'completo', cardinality(v_removidos) = 0,
      'removidos', to_jsonb(v_removidos),
      'prensado', v_prensado,
      'combo', jsonb_build_object('ativo', v_combo, 'refri', v_refri),
      'adicionais', v_adicionais,
      'sabor', v_sabor
    );
    v_item := v_item || jsonb_build_object('resumo', public.resumo_item(v_item, v_loja.combo_preco), 'subtotal', v_sub);
    v_itens := v_itens || jsonb_build_array(v_item);
  end loop;

  -- taxa de entrega: km cobrados (sempre para cima) x taxa_km + taxa_fixa; entra no total
  if v_dist is not null then
    v_taxa := round(ceil(v_dist) * v_loja.taxa_km + v_loja.taxa_fixa, 2);
    v_total := v_total + v_taxa;
  end if;

  insert into public.pedidos (
    criado_em, origem, mesa, cliente_nome, cliente_telefone, modo, endereco, referencia,
    pagamento, troco, obs, itens, total, distancia_km, taxa_entrega, status, historico, idempotencia, cotacao_entrega_id
  ) values (
    v_agora, v_origem, v_mesa, v_nome, v_tel, v_modo, v_endereco, v_referencia,
    v_pagamento, v_troco, v_obs, v_itens, round(v_total, 2), v_dist, v_taxa, 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'em', public.data_iso(v_agora))), v_idem, v_cotacao.id
  )
  returning * into v_pedido;

  -- registro de clientes (pedido de exemplo não entra)
  if v_origem <> 'exemplo' then
    insert into public.clientes as c (telefone, nome, endereco, referencia, pedidos, primeiro_pedido_em, ultimo_pedido_em)
    values (
      v_tel, v_nome,
      case when v_modo = 'entrega' then v_endereco else '' end,
      case when v_modo = 'entrega' then v_referencia else '' end,
      1, v_agora, v_agora
    )
    on conflict (telefone) do update set
      nome = excluded.nome,
      endereco = case when v_modo = 'entrega' then excluded.endereco else c.endereco end,
      referencia = case when v_modo = 'entrega' then excluded.referencia else c.referencia end,
      pedidos = c.pedidos + 1,
      ultimo_pedido_em = excluded.ultimo_pedido_em;
  end if;

  return public.pedido_json(v_pedido);
end;
$$;

notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261018031024_destino_entrega_e_limpeza.sql ============

-- O ponto usado na rota acompanha o pedido e expira junto da fonte de localização.
alter table public.cotacoes_entrega add column if not exists destino jsonb;
alter table public.cotacoes_entrega add column if not exists destino_ate timestamptz;
alter table public.pedidos add column if not exists entrega_destino jsonb;
alter table public.pedidos add column if not exists entrega_destino_ate timestamptz;
create index if not exists pedidos_destino_expira on public.pedidos(entrega_destino_ate) where entrega_destino is not null;

drop function if exists public.emitir_cotacao_entrega(text,numeric,jsonb,text);
create or replace function public.emitir_cotacao_entrega(p_endereco text,p_km numeric,p_origem jsonb,p_fonte text,p_destino jsonb,p_destino_ate timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_loja public.loja; v_q public.cotacoes_entrega;
begin
  if jsonb_typeof(p_destino) is distinct from 'object' or jsonb_typeof(p_destino->'lat') is distinct from 'number'
     or jsonb_typeof(p_destino->'lon') is distinct from 'number' or p_destino_ate is null or p_destino_ate<=now()
     or p_destino_ate>now()+interval '31 days' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
  if (p_destino->>'lat')::numeric not between -90 and 90 or (p_destino->>'lon')::numeric not between -180 and 180
     or ((p_destino->>'lat')::numeric=0 and (p_destino->>'lon')::numeric=0) then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  select * into v_loja from public.loja where id=1 for share;
  if v_loja.entrega_origem is distinct from p_origem then raise exception 'cotacao_expirada' using errcode='P0001'; end if;
  insert into public.cotacoes_entrega(endereco,distancia_km,taxa_km,taxa_fixa,origem,fonte,destino,destino_ate,expira_em)
  values (btrim(p_endereco),round(p_km,3),v_loja.taxa_km,v_loja.taxa_fixa,p_origem,p_fonte,p_destino,p_destino_ate,
    least(now()+interval '15 minutes',p_destino_ate)) returning * into v_q;
  return jsonb_build_object('id',v_q.id,'distanciaKm',v_q.distancia_km,
    'taxa',round(ceil(v_q.distancia_km)*v_q.taxa_km+v_q.taxa_fixa,2),'expiraEm',v_q.expira_em,'estado','ok');
end $$;
revoke all on function public.emitir_cotacao_entrega(text,numeric,jsonb,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.emitir_cotacao_entrega(text,numeric,jsonb,text,jsonb,timestamptz) to service_role;

create or replace function public.limpar_dados_entrega()
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  delete from public.entrega_cache where local_valida_ate<=now();
  update public.cotacoes_entrega set destino=null where destino is not null and destino_ate<=now();
  update public.pedidos set entrega_destino=null,entrega_destino_ate=null
    where entrega_destino is not null and entrega_destino_ate<=now();
  delete from public.cotacoes_entrega where expira_em<now()-interval '7 days';
  delete from public.entrega_eventos where criado_em<now()-interval '7 days';
  delete from public.entrega_limites where ate<now();
  delete from public.entrega_travas where ate<now();
end $$;
revoke all on function public.limpar_dados_entrega() from public,anon,authenticated;
grant execute on function public.limpar_dados_entrega() to service_role;

-- Supabase gerencia o pg_cron. O Postgres mínimo dos testes locais pode não ter a extensão instalada.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('mineiro-entrega-limpeza','15 * * * *','select public.limpar_dados_entrega();');
  end if;
end $$;

create or replace function public.pedido_json(p public.pedidos)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'token', p.token,
    'criadoEm', public.data_iso(p.criado_em),
    'origem', p.origem,
    'mesa', p.mesa,
    'cliente', jsonb_build_object('nome', p.cliente_nome, 'telefone', p.cliente_telefone),
    'modo', p.modo,
    'endereco', p.endereco,
    'referencia', p.referencia,
    'pagamento', p.pagamento,
    'troco', p.troco,
    'obs', p.obs,
    'itens', p.itens,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'status', p.status,
    'historico', p.historico
  ) || case when p.entrega_destino is null then '{}'::jsonb else jsonb_build_object('entregaDestino',p.entrega_destino) end
$$;


create or replace function public.criar_pedido(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe boolean := public.is_equipe();
  v_agora timestamptz := date_trunc('milliseconds', now());
  v_idem uuid;
  v_existente public.pedidos;
  v_cliente jsonb;
  v_nome text;
  v_tel text;
  v_origem text;
  v_modo text;
  v_endereco text;
  v_referencia text;
  v_pagamento text;
  v_troco text;
  v_obs text;
  v_mesa text;
  v_loja public.loja;
  v_cotacao public.cotacoes_entrega;
  v_dia date := public.dia_operacional(now());
  v_entrada jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_removidos text[];
  v_prensado boolean;
  v_combo boolean;
  v_refri text;
  v_sabor text;
  v_adicionais jsonb;
  v_ids_adicionais text[];
  v_entrada_ad jsonb;
  v_adicional public.adicionais;
  v_qtd_ad int;
  v_unit numeric;
  v_sub numeric;
  v_item jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_dist numeric;
  v_taxa numeric;
  v_pedido public.pedidos;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 65536 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- cliente
  v_cliente := p -> 'cliente';
  if v_cliente is null or jsonb_typeof(v_cliente) <> 'object' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_nome := public.campo_texto(v_cliente -> 'nome', 80);
  v_tel := regexp_replace(public.campo_texto(v_cliente -> 'telefone', 40), '[^0-9]', '', 'g');

  -- idempotência: o mesmo envio (queda de rede, clique duplo) devolve o pedido já gravado,
  -- antes de qualquer outra regra e sem contar no limite
  if p ? 'idempotencia' and jsonb_typeof(p -> 'idempotencia') <> 'null' then
    if jsonb_typeof(p -> 'idempotencia') <> 'string'
       or (p ->> 'idempotencia') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_idem := (p ->> 'idempotencia')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:idempotencia:' || v_idem::text, 0));
    select * into v_existente from public.pedidos where idempotencia = v_idem;
    if found then
      -- só devolve para quem mandou o mesmo telefone
      if v_existente.cliente_telefone <> v_tel then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      return public.pedido_json(v_existente);
    end if;
  end if;

  -- campos do pedido
  if char_length(v_nome) < 2 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_origem := coalesce(nullif(public.campo_texto(p -> 'origem', 20), ''), 'cardapio');
  if v_origem not in ('cardapio', 'qrcode', 'exemplo') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if v_origem = 'exemplo' and not v_equipe then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  -- telefone: 10 ou 11 dígitos (pedido de exemplo da equipe pode vir sem)
  if v_tel !~ '^[0-9]{10,11}$' and not (v_origem = 'exemplo' and v_tel = '') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_modo := public.campo_texto(p -> 'modo', 20);
  if v_modo not in ('entrega', 'retirada', 'local') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_endereco := public.campo_texto(p -> 'endereco', 200);
  if v_modo = 'entrega' and char_length(v_endereco) < 5 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  -- distância da entrega (km pela rota, informada pelo navegador): de 0 a 100 km, 3 casas.
  -- Fora da entrega ou sem a distância, a taxa fica null = "a combinar" (o painel mostra assim)
  if p ? 'distanciaKm' and jsonb_typeof(p -> 'distanciaKm') not in ('number', 'null') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_dist := null;
  if v_modo = 'entrega' and jsonb_typeof(p -> 'distanciaKm') = 'number' then
    v_dist := round((p ->> 'distanciaKm')::numeric, 3);
    if v_dist <= 0 or v_dist > 100 then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
  end if;
  v_referencia := public.campo_texto(p -> 'referencia', 120);
  v_pagamento := nullif(public.campo_texto(p -> 'pagamento', 30), '');
  v_troco := public.campo_texto(p -> 'troco', 40);
  v_obs := public.campo_texto(p -> 'obs', 300);
  v_mesa := nullif(public.campo_texto(p -> 'mesa', 10), '');
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'itens') not between 1 and 30 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- loja e limite por telefone (a equipe ignora os dois)
  select * into v_loja from public.loja where id = 1;
  if not found then
    raise exception 'loja_fechada' using errcode = 'P0001';
  end if;
  -- Cotação obrigatória para novas entregas; idempotência e pedidos antigos continuam preservados.
  if v_modo = 'entrega' and v_loja.cotacao_ativa and v_origem <> 'exemplo' then
    if jsonb_typeof(p->'cotacaoId') is distinct from 'string'
       or (p->>'cotacaoId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'cotacao_necessaria' using errcode='P0001';
    end if;
    select * into v_cotacao from public.cotacoes_entrega where id=(p->>'cotacaoId')::uuid;
    if not found then raise exception 'cotacao_necessaria' using errcode='P0001'; end if;
    if v_cotacao.expira_em <= now() or v_cotacao.origem is distinct from v_loja.entrega_origem
       or v_cotacao.taxa_km <> v_loja.taxa_km or v_cotacao.taxa_fixa <> v_loja.taxa_fixa then
      raise exception 'cotacao_expirada' using errcode='P0001';
    end if;
    if lower(regexp_replace(btrim(v_cotacao.endereco),'\s+',' ','g')) <>
       lower(regexp_replace(btrim(v_endereco),'\s+',' ','g')) then
      raise exception 'cotacao_endereco_divergente' using errcode='P0001';
    end if;
    if v_cotacao.destino is null or v_cotacao.destino_ate<=now() then
      raise exception 'cotacao_expirada' using errcode='P0001';
    end if;
    v_dist := v_cotacao.distancia_km;
  end if;
  if not v_equipe then
    if not public.loja_aberta(now()) and not v_loja.aceita_fechada then
      raise exception 'loja_fechada' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:telefone:' || v_tel, 0));
    if (select count(*) from public.pedidos
        where cliente_telefone = v_tel and criado_em > now() - interval '10 minutes') >= 5 then
      raise exception 'muitos_pedidos' using errcode = 'P0001';
    end if;
  end if;

  -- itens: preço e nome sempre do banco
  for v_entrada in
    select e.valor from jsonb_array_elements(p -> 'itens') with ordinality as e(valor, n) order by e.n
  loop
    if jsonb_typeof(v_entrada) <> 'object' or jsonb_typeof(v_entrada -> 'produtoId') is distinct from 'string' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    select * into v_prod from public.produtos where id = v_entrada ->> 'produtoId';
    -- preco null = "Preço a confirmar": está no cardápio, mas ainda não se vende pelo site (nem pela equipe)
    if not found or not v_prod.ativo or v_prod.preco is null then
      raise exception 'produto_invalido' using errcode = 'P0001';
    end if;
    if v_prod.esgotado_dia = v_dia then
      raise exception 'produto_esgotado' using errcode = 'P0001';
    end if;
    v_qtd := public.campo_inteiro(v_entrada -> 'qtd', 1, 20, 1);

    -- removidos: só os que estão nos ingredientes, sem repetir, em ordem (como o sort() do navegador);
    -- completo = true descarta a lista, como no core.js
    if jsonb_typeof(v_entrada -> 'removidos') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_removidos := '{}';
    if jsonb_typeof(v_entrada -> 'removidos') = 'array' and (v_entrada -> 'completo') is distinct from 'true'::jsonb then
      if jsonb_array_length(v_entrada -> 'removidos') > 50 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(r.valor order by r.valor collate "C"), '{}') into v_removidos
      from (
        select distinct x.valor #>> '{}' as valor
        from jsonb_array_elements(v_entrada -> 'removidos') as x(valor)
        where jsonb_typeof(x.valor) = 'string'
      ) r
      where r.valor = any (v_prod.ingredientes);
    end if;

    -- prensado: só lanche e combo (nos outros tipos vira false, como no core.js; não muda preço)
    v_prensado := v_prod.tipo in ('lanche', 'combo') and coalesce((v_entrada -> 'prensado') = 'true'::jsonb, false);

    -- vira combo: só lanche
    if jsonb_typeof(v_entrada -> 'combo') not in ('object', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_combo := false;
    v_refri := '';
    if (v_entrada #> '{combo,ativo}') = 'true'::jsonb then
      if v_prod.tipo <> 'lanche' then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      v_combo := true;
      v_refri := public.campo_texto(v_entrada #> '{combo,refri}', 40);
    end if;

    v_sabor := public.campo_texto(v_entrada -> 'sabor', 40);

    -- adicionais: só lanche e combo, id ativo, qtd de 1 a 5, na ordem em que vieram
    v_unit := v_prod.preco + case when v_combo then v_loja.combo_preco else 0 end;
    v_adicionais := '[]'::jsonb;
    v_ids_adicionais := '{}';
    if jsonb_typeof(v_entrada -> 'adicionais') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_entrada -> 'adicionais') = 'array' and jsonb_array_length(v_entrada -> 'adicionais') > 0 then
      if v_prod.tipo not in ('lanche', 'combo') then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      if jsonb_array_length(v_entrada -> 'adicionais') > 20 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      for v_entrada_ad in
        select a.valor from jsonb_array_elements(v_entrada -> 'adicionais') with ordinality as a(valor, n) order by a.n
      loop
        if jsonb_typeof(v_entrada_ad) <> 'object' or jsonb_typeof(v_entrada_ad -> 'id') is distinct from 'string' then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        if (v_entrada_ad ->> 'id') = any (v_ids_adicionais) then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        v_ids_adicionais := array_append(v_ids_adicionais, v_entrada_ad ->> 'id');
        select * into v_adicional from public.adicionais where id = v_entrada_ad ->> 'id';
        if not found or not v_adicional.ativo then
          raise exception 'produto_invalido' using errcode = 'P0001';
        end if;
        v_qtd_ad := public.campo_inteiro(v_entrada_ad -> 'qtd', 1, 5, 1);
        v_unit := v_unit + v_adicional.preco * v_qtd_ad;
        v_adicionais := v_adicionais || jsonb_build_array(jsonb_build_object(
          'id', v_adicional.id, 'nome', v_adicional.nome, 'qtd', v_qtd_ad, 'preco', v_adicional.preco));
      end loop;
    end if;

    -- precoUnit = preco + combo + Σ adicional × qtd; subtotal = precoUnit × qtd
    v_unit := round(v_unit, 2);
    v_sub := round(v_unit * v_qtd, 2);
    v_total := v_total + v_sub;
    v_item := jsonb_build_object(
      'produtoId', v_prod.id,
      'nome', v_prod.nome,
      'categoria', v_prod.categoria,
      'tipo', v_prod.tipo,
      'precoBase', v_prod.preco,
      'precoUnit', v_unit,
      'qtd', v_qtd,
      'completo', cardinality(v_removidos) = 0,
      'removidos', to_jsonb(v_removidos),
      'prensado', v_prensado,
      'combo', jsonb_build_object('ativo', v_combo, 'refri', v_refri),
      'adicionais', v_adicionais,
      'sabor', v_sabor
    );
    v_item := v_item || jsonb_build_object('resumo', public.resumo_item(v_item, v_loja.combo_preco), 'subtotal', v_sub);
    v_itens := v_itens || jsonb_build_array(v_item);
  end loop;

  -- taxa de entrega: km cobrados (sempre para cima) x taxa_km + taxa_fixa; entra no total
  if v_dist is not null then
    v_taxa := round(ceil(v_dist) * v_loja.taxa_km + v_loja.taxa_fixa, 2);
    v_total := v_total + v_taxa;
  end if;

  insert into public.pedidos (
    criado_em, origem, mesa, cliente_nome, cliente_telefone, modo, endereco, referencia,
    pagamento, troco, obs, itens, total, distancia_km, taxa_entrega, status, historico, idempotencia, cotacao_entrega_id, entrega_destino, entrega_destino_ate
  ) values (
    v_agora, v_origem, v_mesa, v_nome, v_tel, v_modo, v_endereco, v_referencia,
    v_pagamento, v_troco, v_obs, v_itens, round(v_total, 2), v_dist, v_taxa, 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'em', public.data_iso(v_agora))), v_idem, v_cotacao.id, v_cotacao.destino, v_cotacao.destino_ate
  )
  returning * into v_pedido;

  -- registro de clientes (pedido de exemplo não entra)
  if v_origem <> 'exemplo' then
    insert into public.clientes as c (telefone, nome, endereco, referencia, pedidos, primeiro_pedido_em, ultimo_pedido_em)
    values (
      v_tel, v_nome,
      case when v_modo = 'entrega' then v_endereco else '' end,
      case when v_modo = 'entrega' then v_referencia else '' end,
      1, v_agora, v_agora
    )
    on conflict (telefone) do update set
      nome = excluded.nome,
      endereco = case when v_modo = 'entrega' then excluded.endereco else c.endereco end,
      referencia = case when v_modo = 'entrega' then excluded.referencia else c.referencia end,
      pedidos = c.pedidos + 1,
      ultimo_pedido_em = excluded.ultimo_pedido_em;
  end if;

  return public.pedido_json(v_pedido);
end;
$$;

notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261018181746_gestao_usuarios_painel.sql ============

-- Cadastro administrativo privado; equipe e motoboys continuam sendo as portas de acesso existentes.
create table if not exists public.usuarios_painel (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check(char_length(btrim(nome)) between 2 and 80),
  email text not null unique check(email=lower(btrim(email))),
  perfil text not null check(perfil in ('admin','equipe','motoboy')),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.usuarios_painel_eventos (
  id bigint generated always as identity primary key,
  autor uuid not null,
  alvo uuid not null,
  acao text not null check(acao in ('criar','editar','senha')),
  perfil text,
  ativo boolean,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_painel enable row level security;
alter table public.usuarios_painel_eventos enable row level security;
revoke all on public.usuarios_painel,public.usuarios_painel_eventos from public,anon,authenticated;
grant all on public.usuarios_painel,public.usuarios_painel_eventos to service_role;
revoke all on sequence public.usuarios_painel_eventos_id_seq from public,anon,authenticated;
grant usage,select on sequence public.usuarios_painel_eventos_id_seq to service_role;

-- A implantação existente tem um único membro da equipe: ele mantém o controle da loja.
-- Não concede administração indiscriminadamente quando há vários membros preexistentes.
insert into public.usuarios_painel(user_id,nome,email,perfil,ativo)
select e.user_id,coalesce(nullif(btrim(e.nome),''),'Responsável'),lower(u.email),
  case when (select count(*) from public.equipe)=1 then 'admin' else 'equipe' end,true
from public.equipe e join auth.users u on u.id=e.user_id
on conflict(user_id) do nothing;
insert into public.usuarios_painel(user_id,nome,email,perfil,ativo)
select m.user_id,coalesce(nullif(btrim(m.nome),''),'Entregador'),lower(u.email),'motoboy',m.ativo
from public.motoboys m join auth.users u on u.id=m.user_id
on conflict(user_id) do nothing;

-- Somente o backend chama esta função. Verifica o administrador novamente dentro da trava,
-- inclusive se ele foi desativado enquanto outra requisição estava em andamento.
create or replace function public.gerir_acesso_usuario(p_autor uuid,p_id uuid,p_nome text,p_email text,p_perfil text,p_ativo boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_antes public.usuarios_painel; v_novo public.usuarios_painel;
begin
  perform pg_advisory_xact_lock(hashtextextended('mineiro:gestao-usuarios',0));
  if not exists(select 1 from public.usuarios_painel u join public.equipe e on e.user_id=u.user_id
    where u.user_id=p_autor and u.ativo and u.perfil='admin') then
    raise exception 'sem_permissao' using errcode='P0001';
  end if;
  if p_id is null or p_nome is null or char_length(btrim(p_nome)) not between 2 and 80
     or p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_perfil is null or p_perfil not in ('admin','equipe','motoboy') or p_ativo is null then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  select * into v_antes from public.usuarios_painel where user_id=p_id;
  if p_id=p_autor and (p_perfil<>'admin' or not p_ativo) then
    raise exception 'proprio_acesso_protegido' using errcode='P0001';
  end if;
  if v_antes.user_id is not null and v_antes.email<>lower(btrim(p_email)) then
    raise exception 'email_nao_alteravel' using errcode='P0001';
  end if;
  insert into public.usuarios_painel(user_id,nome,email,perfil,ativo)
  values(p_id,btrim(p_nome),lower(btrim(p_email)),p_perfil,p_ativo)
  on conflict(user_id) do update set nome=excluded.nome,perfil=excluded.perfil,ativo=excluded.ativo,atualizado_em=now()
  returning * into v_novo;
  if p_ativo and p_perfil in ('admin','equipe') then
    insert into public.equipe(user_id,nome) values(p_id,btrim(p_nome)) on conflict(user_id) do update set nome=excluded.nome;
    delete from public.motoboys where user_id=p_id;
  else
    delete from public.equipe where user_id=p_id;
    if p_perfil='motoboy' then
      insert into public.motoboys(user_id,nome,ativo) values(p_id,btrim(p_nome),p_ativo)
      on conflict(user_id) do update set nome=excluded.nome,ativo=excluded.ativo;
    else delete from public.motoboys where user_id=p_id;
    end if;
  end if;
  insert into public.usuarios_painel_eventos(autor,alvo,acao,perfil,ativo)
  values(p_autor,p_id,case when v_antes.user_id is null then 'criar' else 'editar' end,p_perfil,p_ativo);
  return jsonb_build_object('user_id',v_novo.user_id,'nome',v_novo.nome,'email',v_novo.email,'perfil',v_novo.perfil,'ativo',v_novo.ativo);
end $$;
revoke all on function public.gerir_acesso_usuario(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.gerir_acesso_usuario(uuid,uuid,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';

-- ============ supabase/migrations/20261018185421_pagamentos_mercado_pago.sql ============

-- Branch de homologação: flag desligada; não altera pagamentos de pedidos antigos.
alter table public.loja add column if not exists pagamentos_ativos boolean not null default false;
alter table public.pedidos add column if not exists pagamento_online text
  check(pagamento_online in ('pendente','aprovado','recusado','cancelado','reembolsado','parcialmente_reembolsado','em_disputa','revisao'));
alter table public.pedidos add column if not exists pagamento_em timestamptz;

create table if not exists public.pagamentos_mp (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references public.pedidos(id) on delete restrict,
  email text not null check(char_length(email)<=254),
  total numeric(10,2) not null check(total>0),
  order_id text unique,
  checkout_url text,
  estado text not null default 'pendente' check(estado in ('pendente','aprovado','recusado','cancelado','reembolsado','parcialmente_reembolsado','em_disputa','revisao')),
  status_mp text,
  detalhe_mp text,
  versao_mp timestamptz,
  criado_em timestamptz not null default now(),
  ultima_consulta timestamptz,
  criando_ate timestamptz,
  reembolso_solicitado_em timestamptz,
  reembolso_autor uuid
);
create index if not exists pagamentos_mp_consulta on public.pagamentos_mp(ultima_consulta nulls first,criado_em) where order_id is not null;
create table if not exists public.pagamentos_mp_eventos (
  id bigint generated always as identity primary key,
  pagamento_id uuid not null references public.pagamentos_mp(id) on delete restrict,
  estado text not null,
  status_mp text not null,
  detalhe_mp text not null,
  versao_mp timestamptz not null,
  recebido_em timestamptz not null default now(),
  unique(pagamento_id,versao_mp,estado)
);
alter table public.pagamentos_mp enable row level security;
alter table public.pagamentos_mp_eventos enable row level security;
revoke all on public.pagamentos_mp,public.pagamentos_mp_eventos from public,anon,authenticated;
grant all on public.pagamentos_mp,public.pagamentos_mp_eventos to service_role;
revoke all on sequence public.pagamentos_mp_eventos_id_seq from public,anon,authenticated;
grant usage,select on sequence public.pagamentos_mp_eventos_id_seq to service_role;

-- A flag determina a exigência no INSERT, independentemente do navegador. Não reclassifica o histórico.
create or replace function public.proteger_pagamento_pedido()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.pagamento_online:=null;
    new.pagamento_em:=null;
    if new.origem<>'exemplo' and (select pagamentos_ativos from public.loja where id=1) then
      if new.total<=0 or (new.modo='entrega' and new.taxa_entrega is null) then
        raise exception 'pagamento_valor_invalido' using errcode='P0001';
      end if;
      new.pagamento_online:='pendente';
      new.pagamento:='Mercado Pago';
      new.troco:='';
    end if;
  elsif new.status is distinct from old.status and new.status not in ('novo','cancelado')
    and old.pagamento_online is not null and new.pagamento_online is distinct from 'aprovado' then
    raise exception 'pagamento_pendente' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function public.proteger_pagamento_pedido() from public,anon,authenticated;
drop trigger if exists pedidos_proteger_pagamento on public.pedidos;
create trigger pedidos_proteger_pagamento before insert or update on public.pedidos
for each row execute function public.proteger_pagamento_pedido();

-- Helpers invoker, exclusivos do backend. Nunca expõem dados da conta, e-mail ou cobrança via anon.
create or replace function public.preparar_pagamento_mp(p_token uuid,p_email text default null,p_iniciar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_p public.pedidos; v_m public.pagamentos_mp; v_criar boolean:=false; v_consultar boolean:=false;
begin
  select * into v_p from public.pedidos where token=p_token for update;
  if not found or v_p.pagamento_online is null then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where pedido_id=v_p.id for update;
  if v_m.id is null and p_iniciar then
    if v_p.status<>'novo' or v_p.pagamento_online<>'pendente' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
    if p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'email_invalido' using errcode='P0001';
    end if;
    insert into public.pagamentos_mp(pedido_id,email,total) values(v_p.id,lower(btrim(p_email)),v_p.total) returning * into v_m;
  end if;
  if v_m.id is null then return jsonb_build_object('estado',v_p.pagamento_online,'pedido_status',v_p.status); end if;
  if p_iniciar and v_p.status='cancelado' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
  if v_m.order_id is null and p_iniciar and coalesce(v_m.criando_ate,'-infinity')<now() then
    update public.pagamentos_mp set criando_ate=now()+interval '30 seconds' where id=v_m.id returning * into v_m;
    v_criar:=true;
  end if;
  if v_m.order_id is not null and coalesce(v_m.ultima_consulta,'-infinity')<now()-interval '8 seconds' then
    update public.pagamentos_mp set ultima_consulta=now() where id=v_m.id;
    v_consultar:=true;
  end if;
  return to_jsonb(v_m)||jsonb_build_object('token',v_p.token,'numero',v_p.numero,'itens',v_p.itens,'taxaEntrega',v_p.taxa_entrega,'pedido_status',v_p.status,'criar',v_criar,'consultar',v_consultar);
end $$;

create or replace function public.registrar_pagamento_mp(p_id uuid,p_order_id text,p_estado text,p_em timestamptz,p_checkout text,p_status text,p_detalhe text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_m public.pagamentos_mp; v_p public.pedidos;
begin
  -- Mesma ordem de travas do preparador: pedido antes de pagamento.
  select p.* into v_p from public.pedidos p join public.pagamentos_mp m on m.pedido_id=p.id where m.id=p_id for update of p;
  if not found then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where id=p_id for update;
  if p_order_id is null or p_order_id !~ '^ORD[A-Za-z0-9]{10,80}$' or
    (v_m.order_id is not null and v_m.order_id<>p_order_id) or p_em is null or p_em>now()+interval '5 minutes'
    or p_estado is null or p_estado not in ('pendente','aprovado','recusado','cancelado','reembolsado','parcialmente_reembolsado','em_disputa','revisao')
    or p_status is null or length(p_status)>80 or p_detalhe is null or length(p_detalhe)>100
    or (p_checkout is not null and p_checkout !~ '^https://www\.mercadopago\.com\.br/checkout/') then
    raise exception 'pagamento_divergente' using errcode='P0001';
  end if;
  update public.pagamentos_mp set order_id=p_order_id,checkout_url=coalesce(p_checkout,checkout_url),criando_ate=null,ultima_consulta=now() where id=p_id;
  -- Reentregas e consultas que chegaram fora de ordem não desfazem uma aprovação/estorno.
  if v_m.versao_mp is not null and p_em<=v_m.versao_mp then return jsonb_build_object('estado',v_m.estado); end if;
  if v_m.estado in ('aprovado','reembolsado','parcialmente_reembolsado','em_disputa') and p_estado in ('pendente','recusado','cancelado') then
    return jsonb_build_object('estado',v_m.estado);
  end if;
  if v_m.estado in ('reembolsado','parcialmente_reembolsado','em_disputa') and p_estado='aprovado' then
    return jsonb_build_object('estado',v_m.estado);
  end if;
  update public.pagamentos_mp set estado=p_estado,status_mp=p_status,detalhe_mp=p_detalhe,versao_mp=p_em where id=p_id;
  insert into public.pagamentos_mp_eventos(pagamento_id,estado,status_mp,detalhe_mp,versao_mp)
    values(p_id,p_estado,p_status,p_detalhe,p_em) on conflict do nothing;
  update public.pedidos set pagamento_online=p_estado,pagamento_em=p_em where id=v_p.id;
  return jsonb_build_object('estado',p_estado);
end $$;

create or replace function public.autorizar_reembolso_mp(p_autor uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_m public.pagamentos_mp;
begin
  if not exists(select 1 from public.usuarios_painel u join public.equipe e on e.user_id=u.user_id
    where u.user_id=p_autor and u.ativo and u.perfil='admin') then raise exception 'sem_permissao' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where pedido_id=p_id for update;
  if not found or v_m.estado<>'aprovado' or v_m.order_id is null then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
  if not exists(select 1 from public.pedidos where id=p_id and status='cancelado') then
    raise exception 'cancele_antes_de_estornar' using errcode='P0001'; end if;
  update public.pagamentos_mp set reembolso_solicitado_em=coalesce(reembolso_solicitado_em,now()),reembolso_autor=coalesce(reembolso_autor,p_autor)
    where id=v_m.id returning * into v_m;
  return to_jsonb(v_m);
end $$;
revoke all on function public.preparar_pagamento_mp(uuid,text,boolean),public.registrar_pagamento_mp(uuid,text,text,timestamptz,text,text,text),public.autorizar_reembolso_mp(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preparar_pagamento_mp(uuid,text,boolean),public.registrar_pagamento_mp(uuid,text,text,timestamptz,text,text,text),public.autorizar_reembolso_mp(uuid,uuid) to service_role;

-- Reserva antes da chamada externa: um recurso com falha não bloqueia a recuperação dos demais.
create or replace function public.reservar_conciliacao_mp()
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_resultado jsonb;
begin
  with candidatos as (
    select id from public.pagamentos_mp
    where order_id is not null and coalesce(ultima_consulta,'-infinity')<now()-interval '1 minute'
    order by ultima_consulta nulls first,criado_em limit 12 for update skip locked
  ), reservados as (
    update public.pagamentos_mp m set ultima_consulta=now() from candidatos c where m.id=c.id returning m.*
  ) select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_resultado from reservados r;
  return v_resultado;
end $$;
revoke all on function public.reservar_conciliacao_mp() from public,anon,authenticated;
grant execute on function public.reservar_conciliacao_mp() to service_role;

create or replace function public.loja_json()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('modo',l.modo,'aceitaFechada',l.aceita_fechada,'comboPreco',l.combo_preco,
    'taxaKm',l.taxa_km,'taxaFixa',l.taxa_fixa,'horarios',l.horarios,'cotacaoAtiva',l.cotacao_ativa,'pagamentosAtivos',l.pagamentos_ativos)
  from public.loja l where l.id=1
$$;

create or replace function public.pedido_json(p public.pedidos)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'token', p.token,
    'criadoEm', public.data_iso(p.criado_em),
    'origem', p.origem,
    'mesa', p.mesa,
    'cliente', jsonb_build_object('nome', p.cliente_nome, 'telefone', p.cliente_telefone),
    'modo', p.modo,
    'endereco', p.endereco,
    'referencia', p.referencia,
    'pagamento', p.pagamento,
    'pagamentoOnline', p.pagamento_online,
    'pagamentoEm', p.pagamento_em,
    'troco', p.troco,
    'obs', p.obs,
    'itens', p.itens,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'status', p.status,
    'historico', p.historico
  ) || case when p.entrega_destino is null then '{}'::jsonb else jsonb_build_object('entregaDestino',p.entrega_destino) end
$$;



create or replace function public.acompanhar_pedido(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'numero', p.numero,
    'criadoEm', public.data_iso(p.criado_em),
    'status', p.status,
    'pagamentoOnline', p.pagamento_online,
    'pagamentoEm', p.pagamento_em,
    'historico', p.historico,
    'modo', p.modo,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', i.valor -> 'nome', 'qtd', i.valor -> 'qtd', 'resumo', i.valor -> 'resumo',
                                          'subtotal', i.valor -> 'subtotal') order by i.n)
      from jsonb_array_elements(p.itens) with ordinality as i(valor, n)
    ), '[]'::jsonb)
  )
  from public.pedidos p
  where p.token = p_token
$$;


notify pgrst,'reload schema';

-- ============ supabase/migrations/20261019024838_controle_entregadores.sql ============

-- Controle operacional. Pedidos antigos permanecem intactos; atribuições e auditoria são aditivas.
create table if not exists public.entregas_operacao (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  atribuicao uuid not null default gen_random_uuid(),
  motoboy_id uuid references auth.users(id) on delete set null,
  motoboy_nome text not null,
  atribuido_em timestamptz not null default now(),
  atribuido_por uuid references auth.users(id) on delete set null,
  saiu_em timestamptz,
  confirmado_em timestamptz,
  recebido_em timestamptz,
  encerrado_por uuid references auth.users(id) on delete set null,
  encerramento text check (encerramento in ('motoboy','manual','cancelado')),
  motivo text,
  horario_inconsistente boolean not null default false
);
create index if not exists entregas_operacao_motoboy on public.entregas_operacao(motoboy_id, recebido_em);
create index if not exists entregas_operacao_atribuido_por on public.entregas_operacao(atribuido_por);
create index if not exists entregas_operacao_encerrado_por on public.entregas_operacao(encerrado_por);
create table if not exists public.entregas_eventos (
  evento_id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  autor uuid references auth.users(id) on delete set null,
  tipo text not null,
  recebido_em timestamptz not null default now(),
  dados jsonb not null default '{}'
);
create index if not exists entregas_eventos_pedido on public.entregas_eventos(pedido_id, recebido_em);
create index if not exists entregas_eventos_autor on public.entregas_eventos(autor);
create table if not exists public.entregadores_comunicacao (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ultima_em timestamptz not null default now()
);
alter table public.entregas_operacao enable row level security;
alter table public.entregas_eventos enable row level security;
alter table public.entregadores_comunicacao enable row level security;
-- Só RPCs autorizadas acessam essas tabelas; o motoboy nunca ganha acesso ao painel.
revoke all on public.entregas_operacao, public.entregas_eventos, public.entregadores_comunicacao from public, anon, authenticated;

create or replace function public.comunicar_entregador() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  insert into public.entregadores_comunicacao(user_id) values(auth.uid())
  on conflict(user_id) do update set ultima_em=now();
  return jsonb_build_object('em',public.data_iso(now()));
end $$;

create or replace function public.atribuir_entrega(p_id uuid, p_motoboy uuid, p_sair boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao; n text;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('preparo','pronto','rota') then raise exception 'transicao_invalida'; end if;
  select nome into n from public.motoboys where user_id=p_motoboy and ativo;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id;
  if e.encerramento is not null then raise exception 'transicao_invalida'; end if;
  -- Reatribuição só antes da saída: evita trocar de motoboy enquanto há uma confirmação offline.
  if e.motoboy_id is distinct from p_motoboy and e.saiu_em is not null then raise exception 'entrega_em_andamento'; end if;
  if e.pedido_id is null or e.motoboy_id is distinct from p_motoboy then
    insert into public.entregas_operacao(pedido_id,motoboy_id,motoboy_nome,atribuido_por,saiu_em)
    values(p_id,p_motoboy,n,auth.uid(),case when p.status='rota' then
      coalesce((public.entrega_json(p)->>'saiuEm')::timestamptz,now()) end)
    on conflict(pedido_id) do update set motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,
      atribuicao=gen_random_uuid(),atribuido_em=now(),atribuido_por=auth.uid();
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados)
    values(p_id,auth.uid(),'atribuicao',jsonb_build_object('motoboy',p_motoboy,'nome',n));
  end if;
  if coalesce(p_sair,false) and p.status<>'rota' then
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(
      jsonb_build_object('status','rota','em',public.data_iso(now()),'autor',auth.uid())) where id=p_id;
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- Todas as formas de alterar um pedido (quadro, cancelamento e RPC do entregador) mantêm o controle em acordo.
create or replace function public.acompanhar_entrega_operacao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.entregas_operacao; h jsonb; m text; tipo text;
begin
  if new.status=old.status then return new; end if;
  select * into e from public.entregas_operacao where pedido_id=new.id for update;
  h:=new.historico->-1;
  if not found then
    if new.modo='entrega' and new.status='entregue' and new.origem<>'exemplo' then
      m:=nullif(btrim(h->>'motivo'),'');
      if m is null or length(m)>200 then raise exception 'motivo_obrigatorio'; end if;
      insert into public.entregas_eventos(pedido_id,autor,tipo,dados)
      values(new.id,auth.uid(),'manual',jsonb_build_object('motivo',m));
    end if;
    return new;
  end if;
  if new.status='rota' then
    update public.entregas_operacao set saiu_em=coalesce(saiu_em,now()) where pedido_id=new.id;
    insert into public.entregas_eventos(pedido_id,autor,tipo) values(new.id,auth.uid(),'saida');
  elsif new.status in ('entregue','cancelado') then
    tipo:=case when new.status='cancelado' then 'cancelado' when h->>'por'='motoboy' then 'motoboy' else 'manual' end;
    m:=nullif(btrim(h->>'motivo'),'');
    if tipo='manual' and (m is null or length(m)>200) then raise exception 'motivo_obrigatorio'; end if;
    update public.entregas_operacao set recebido_em=now(),encerrado_por=auth.uid(),encerramento=tipo,motivo=m
    where pedido_id=new.id;
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados)
    values(new.id,auth.uid(),tipo,jsonb_build_object('motivo',m));
  end if;
  return new;
end $$;
drop trigger if exists pedidos_entregas_operacao on public.pedidos;
create trigger pedidos_entregas_operacao after update of status on public.pedidos
for each row execute function public.acompanhar_entrega_operacao();

create or replace function public.minhas_entregas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return coalesce((select jsonb_agg(public.entrega_json(p)||jsonb_build_object(
    'atribuicao',e.atribuicao,'atribuidoEm',public.data_iso(e.atribuido_em)) order by e.atribuido_em)
    from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
    where e.motoboy_id=auth.uid() and e.encerramento is null and p.status in ('preparo','pronto','rota')), '[]');
end $$;

create or replace function public.confirmar_entrega_offline(p_id uuid,p_evento uuid,p_atribuicao uuid,p_confirmado_em timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao; anterior public.entregas_eventos; inconsistente boolean;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_id is null or p_evento is null or p_confirmado_em is null then raise exception 'dados_invalidos'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id for update;
  if e.pedido_id is null or e.motoboy_id is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if e.atribuicao is distinct from p_atribuicao then raise exception 'atribuicao_alterada'; end if;
  select * into anterior from public.entregas_eventos where evento_id=p_evento;
  if found and (anterior.pedido_id<>p_id or anterior.autor is distinct from auth.uid()) then raise exception 'dados_invalidos'; end if;
  perform public.comunicar_entregador();
  if p.status='cancelado' then raise exception 'pedido_cancelado'; end if;
  if p.status='entregue' then
    insert into public.entregas_eventos(evento_id,pedido_id,autor,tipo,dados)
    values(p_evento,p_id,auth.uid(),'confirmacao_posterior',jsonb_build_object('confirmadoEm',p_confirmado_em))
    on conflict(evento_id) do nothing;
    return jsonb_build_object('ok',true,'jaEntregue',true,'pedido',jsonb_build_object('id',p.id,'numero',p.numero,'status',p.status));
  end if;
  if p.status<>'rota' or e.saiu_em is null then raise exception 'entrega_nao_iniciada'; end if;
  inconsistente:=p_confirmado_em<e.saiu_em or p_confirmado_em>now()+interval '5 minutes';
  update public.entregas_operacao set confirmado_em=p_confirmado_em,horario_inconsistente=inconsistente where pedido_id=p_id;
  update public.pedidos set status='entregue',historico=historico||jsonb_build_array(jsonb_build_object(
    'status','entregue','em',public.data_iso(now()),'por','motoboy','autor',auth.uid(),
    'confirmadoEm',public.data_iso(p_confirmado_em),'evento',p_evento)) where id=p_id returning * into p;
  insert into public.entregas_eventos(evento_id,pedido_id,autor,tipo,dados)
  values(p_evento,p_id,auth.uid(),'confirmacao',jsonb_build_object('confirmadoEm',p_confirmado_em,'horarioInconsistente',inconsistente));
  return jsonb_build_object('ok',true,'jaEntregue',false,'pedido',public.entrega_json(p));
end $$;

create or replace function public.consultar_entrega_motoboy(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id and motoboy_id=auth.uid();
  if not found then raise exception 'nao_atribuido'; end if;
  select * into p from public.pedidos where id=p_id;
  if p.status='cancelado' then raise exception 'pedido_cancelado'; end if;
  if p.status='entregue' then
    return jsonb_build_object('id',p.id,'numero',p.numero,'status',p.status,'atribuicao',e.atribuicao);
  end if;
  return public.entrega_json(p)||jsonb_build_object('atribuicao',e.atribuicao);
end $$;

-- Um cancelamento encontrado no retorno exige conferência explícita e fica auditado; nunca vira entrega.
create or replace function public.reconhecer_cancelamento_entrega(p_id uuid,p_evento uuid,p_atribuicao uuid,p_confirmado_em timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao; anterior public.entregas_eventos;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_evento is null or p_confirmado_em is null then raise exception 'dados_invalidos'; end if;
  select * into p from public.pedidos where id=p_id for update;
  select * into e from public.entregas_operacao where pedido_id=p_id for update;
  if e.motoboy_id is distinct from auth.uid() or e.atribuicao is distinct from p_atribuicao then raise exception 'nao_atribuido'; end if;
  if p.status is distinct from 'cancelado' then raise exception 'transicao_invalida'; end if;
  select * into anterior from public.entregas_eventos where evento_id=p_evento;
  if found and (anterior.pedido_id<>p_id or anterior.autor is distinct from auth.uid()) then raise exception 'dados_invalidos'; end if;
  insert into public.entregas_eventos(evento_id,pedido_id,autor,tipo,dados)
  values(p_evento,p_id,auth.uid(),'cancelamento_conferido',jsonb_build_object('confirmadoEm',p_confirmado_em))
  on conflict(evento_id) do nothing;
  return jsonb_build_object('ok',true,'ocorrencia',true,'evento',p_evento);
end $$;

create or replace function public.baixar_entrega_manual(p_id uuid,p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if nullif(btrim(p_motivo),'') is null or length(btrim(p_motivo))>200 then raise exception 'motivo_obrigatorio'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('rota','entregue') then raise exception 'transicao_invalida'; end if;
  if p.status='entregue' then return jsonb_build_object('ok',true,'jaEntregue',true); end if;
  -- Também cobre pedidos antigos ainda sem atribuição, conservando o responsável e o motivo no histórico.
  update public.pedidos set status='entregue',historico=historico||jsonb_build_array(jsonb_build_object(
    'status','entregue','em',public.data_iso(now()),'por','equipe','autor',auth.uid(),'motivo',btrim(p_motivo))) where id=p_id;
  return jsonb_build_object('ok',true);
end $$;

-- Fechar a porta antiga para pedidos de outros entregadores, mantendo a resposta e a URL das comandas.
create or replace function public.confirmar_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.entregas_operacao;
begin
  if public.is_equipe() and not public.is_motoboy() then raise exception 'motivo_obrigatorio'; end if;
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id;
  return public.confirmar_entrega_offline(p_id,gen_random_uuid(),e.atribuicao,now());
end $$;
create or replace function public.entregas_em_rota() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin return public.minhas_entregas(); end $$;

create or replace function public.painel_entregadores(p_dias integer default 1) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare inicio timestamptz; r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select jsonb_build_object('servidorEm',public.data_iso(now()),'inicio',public.data_iso(inicio),
    'entregadores',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'ultimaEm',c.ultima_em) order by m.nome)
      from public.motoboys m left join public.entregadores_comunicacao c on c.user_id=m.user_id),'[]'),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'status',p.status,
      'motoboyId',e.motoboy_id,'motoboyNome',e.motoboy_nome,'atribuicao',e.atribuicao,'atribuidoEm',e.atribuido_em,
      'saiuEm',coalesce(e.saiu_em,(public.entrega_json(p)->>'saiuEm')::timestamptz),
      'confirmadoEm',e.confirmado_em,'recebidoEm',coalesce(e.recebido_em,f.recebido_em),
      'encerramento',coalesce(e.encerramento,case when f.evento_id is not null then 'manual' end),
      'responsavel',coalesce(e.encerrado_por,f.autor),'motivo',coalesce(e.motivo,f.dados->>'motivo'),
      'horarioInconsistente',e.horario_inconsistente) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      left join lateral (select x.* from public.entregas_eventos x where x.pedido_id=p.id and x.tipo='manual'
        and e.pedido_id is null order by x.recebido_em desc limit 1) f on true
      where p.modo='entrega' and p.origem<>'exemplo' and (p.status in ('preparo','pronto','rota') or coalesce(e.recebido_em,f.recebido_em)>=inicio)), '[]')) into r;
  return r;
end $$;

create or replace function public.historico_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tipo',e.tipo,'em',e.recebido_em,
    'responsavel',coalesce(u.nome,e.autor::text,'Usuário removido'),'dados',e.dados) order by e.recebido_em,e.evento_id)
    from public.entregas_eventos e left join public.usuarios_painel u on u.user_id=e.autor where e.pedido_id=p_id),'[]');
end $$;

revoke all on function public.comunicar_entregador(),public.atribuir_entrega(uuid,uuid,boolean),
  public.acompanhar_entrega_operacao(),public.minhas_entregas(),public.confirmar_entrega_offline(uuid,uuid,uuid,timestamptz),
  public.baixar_entrega_manual(uuid,text),public.painel_entregadores(integer),public.historico_entrega(uuid),
  public.confirmar_entrega(uuid),public.entregas_em_rota(),public.consultar_entrega_motoboy(uuid),
  public.reconhecer_cancelamento_entrega(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.comunicar_entregador(),public.atribuir_entrega(uuid,uuid,boolean),
  public.minhas_entregas(),public.confirmar_entrega_offline(uuid,uuid,uuid,timestamptz),
  public.baixar_entrega_manual(uuid,text),public.painel_entregadores(integer),public.historico_entrega(uuid),
  public.confirmar_entrega(uuid),public.entregas_em_rota(),public.consultar_entrega_motoboy(uuid),
  public.reconhecer_cancelamento_entrega(uuid,uuid,uuid,timestamptz) to authenticated;
notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261019032841_historico_entregas_painel.sql ============

-- Inclui conclusões anteriores ao controle individual, sem regravar nem atribuir pedidos históricos.
-- A consulta continua exclusiva da equipe; o histórico anterior fica fora das médias por entregador.
create or replace function public.painel_entregadores(p_dias integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inicio timestamptz; r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select jsonb_build_object('servidorEm',public.data_iso(now()),'inicio',public.data_iso(inicio),
    'entregadores',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'ultimaEm',c.ultima_em) order by m.nome)
      from public.motoboys m left join public.entregadores_comunicacao c on c.user_id=m.user_id),'[]'),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'status',p.status,
      'motoboyId',e.motoboy_id,'motoboyNome',e.motoboy_nome,'atribuicao',e.atribuicao,'atribuidoEm',e.atribuido_em,
      'saiuEm',coalesce(e.saiu_em,(public.entrega_json(p)->>'saiuEm')::timestamptz),
      'confirmadoEm',e.confirmado_em,'recebidoEm',coalesce(e.recebido_em,f.recebido_em,h.concluido_em),
      'encerramento',coalesce(e.encerramento,case when f.evento_id is not null then 'manual' when h.concluido_em is not null then 'anterior' end),
      'legado',e.pedido_id is null and f.evento_id is null and p.status='entregue' and h.concluido_em is not null,
      'responsavel',coalesce(e.encerrado_por,f.autor),'motivo',coalesce(e.motivo,f.dados->>'motivo'),
      'horarioInconsistente',e.horario_inconsistente) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      left join lateral (select x.* from public.entregas_eventos x where x.pedido_id=p.id and x.tipo='manual'
        and e.pedido_id is null order by x.recebido_em desc limit 1) f on true
      left join lateral (select max((x->>'em')::timestamptz) as concluido_em
        from jsonb_array_elements(p.historico) x where x->>'status'='entregue' and e.pedido_id is null) h on true
      where p.modo='entrega' and p.origem<>'exemplo' and (p.status in ('preparo','pronto','rota')
        or coalesce(e.recebido_em,f.recebido_em,case when p.status='entregue' then h.concluido_em end)>=inicio)), '[]')) into r;
  return r;
end $$;
revoke all on function public.painel_entregadores(integer) from public,anon;
grant execute on function public.painel_entregadores(integer) to authenticated;
notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261019034930_totais_taxas_entregadores.sql ============

-- Totais das taxas cobradas nos pedidos; não altera cobrança, conclusão ou atribuição.
-- Helper privado compartilhado pela equipe e pelo resumo do próprio entregador.
create or replace function public.taxas_entregador(p_motoboy uuid, p_inicio timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'concluidas',coalesce(sum(p.taxa_entrega) filter (where p.status='entregue'),0),
    'emAberto',coalesce(sum(p.taxa_entrega) filter (where p.status in ('preparo','pronto','rota')),0),
    'qtdConcluidas',count(*) filter (where p.status='entregue'),
    'qtdEmAberto',count(*) filter (where p.status in ('preparo','pronto','rota')),
    'semTaxaConcluidas',count(*) filter (where p.status='entregue' and p.taxa_entrega is null),
    'semTaxaEmAberto',count(*) filter (where p.status in ('preparo','pronto','rota') and p.taxa_entrega is null))
  from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
  where e.motoboy_id=p_motoboy and p.modo='entrega' and p.origem<>'exemplo'
    and (p.status in ('preparo','pronto','rota') or
      (p.status='entregue' and e.recebido_em>=p_inicio and e.recebido_em<=now()))
$$;
revoke all on function public.taxas_entregador(uuid,timestamptz) from public,anon,authenticated;

-- Sem parâmetro de usuário: o motoboy nunca consulta valores de outro entregador.
create or replace function public.minhas_taxas_entrega(p_dias integer default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare inicio timestamptz;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  return jsonb_build_object('dias',p_dias,'inicio',public.data_iso(inicio),'servidorEm',public.data_iso(now()),
    'taxas',public.taxas_entregador(auth.uid(),inicio));
end $$;
revoke all on function public.minhas_taxas_entrega(integer) from public,anon;
grant execute on function public.minhas_taxas_entrega(integer) to authenticated;

create or replace function public.painel_entregadores(p_dias integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inicio timestamptz; r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select jsonb_build_object('servidorEm',public.data_iso(now()),'inicio',public.data_iso(inicio),
    'entregadores',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,
      'ultimaEm',c.ultima_em,'taxas',public.taxas_entregador(m.user_id,inicio)) order by m.nome)
      from public.motoboys m left join public.entregadores_comunicacao c on c.user_id=m.user_id),'[]'),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'status',p.status,
      'motoboyId',e.motoboy_id,'motoboyNome',e.motoboy_nome,'atribuicao',e.atribuicao,'atribuidoEm',e.atribuido_em,
      'taxaEntrega',p.taxa_entrega,
      'saiuEm',coalesce(e.saiu_em,(public.entrega_json(p)->>'saiuEm')::timestamptz),
      'confirmadoEm',e.confirmado_em,'recebidoEm',coalesce(e.recebido_em,f.recebido_em,h.concluido_em),
      'encerramento',coalesce(e.encerramento,case when f.evento_id is not null then 'manual' when h.concluido_em is not null then 'anterior' end),
      'legado',e.pedido_id is null and f.evento_id is null and p.status='entregue' and h.concluido_em is not null,
      'responsavel',coalesce(e.encerrado_por,f.autor),'motivo',coalesce(e.motivo,f.dados->>'motivo'),
      'horarioInconsistente',e.horario_inconsistente) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      left join lateral (select x.* from public.entregas_eventos x where x.pedido_id=p.id and x.tipo='manual'
        and e.pedido_id is null order by x.recebido_em desc limit 1) f on true
      left join lateral (select max((x->>'em')::timestamptz) as concluido_em
        from jsonb_array_elements(p.historico) x where x->>'status'='entregue' and e.pedido_id is null) h on true
      where p.modo='entrega' and p.origem<>'exemplo' and (p.status in ('preparo','pronto','rota')
        or coalesce(e.recebido_em,f.recebido_em,case when p.status='entregue' then h.concluido_em end)>=inicio)), '[]')) into r;
  return r;
end $$;
revoke all on function public.painel_entregadores(integer) from public,anon;
grant execute on function public.painel_entregadores(integer) to authenticated;
notify pgrst, 'reload schema';

-- ============ supabase/migrations/20261019123043_viagens_rotas_entregadores.sql ============

-- Viagens: reserva de pedidos prontos, carregamento reconhecido, saída e retorno.
-- Instala desligado. Limites da operação são informados pela equipe antes da ativação.
alter table public.pedidos add column if not exists entrega_planejamento_pausado boolean not null default false;
create table if not exists public.entrega_rotas_config (
  id smallint primary key default 1 check(id=1),
  modo text not null default 'desligado' check(modo in ('desligado','assistido','automatico')),
  regras jsonb not null default '{}',
  versao uuid not null default gen_random_uuid(),
  limite_creditos_dia integer not null default 1000 check(limite_creditos_dia between 20 and 100000),
  job_url text,
  job_token text not null default (gen_random_uuid()::text||gen_random_uuid()::text),
  cron_ativo boolean not null default false,
  alterado_em timestamptz not null default now(),
  alterado_por uuid references auth.users(id) on delete set null
);
insert into public.entrega_rotas_config(id) values(1) on conflict do nothing;
create table if not exists public.entregadores_disponibilidade (
  user_id uuid primary key references auth.users(id) on delete cascade,
  situacao text not null check(situacao in ('na_loja','pausado','fora')),
  desde timestamptz not null default now(),
  autor uuid references auth.users(id) on delete set null,
  motivo text
);
create table if not exists public.entrega_rotas_execucoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  autor uuid references auth.users(id) on delete set null,
  automatica boolean not null default false,
  estado text not null default 'calculando' check(estado in ('calculando','concluida','erro')),
  entrada jsonb not null,
  impedidos jsonb not null default '[]',
  erro text,
  creditos_reservados integer not null default 0
);
create index if not exists entrega_rotas_execucoes_tempo on public.entrega_rotas_execucoes(criado_em);
create table if not exists public.entrega_rotas_planos (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references public.entrega_rotas_execucoes(id) on delete cascade,
  motoboy_id uuid references auth.users(id) on delete set null,
  config_versao uuid not null,
  estado text not null default 'aberto' check(estado in ('aberto','reservado','vencido','desfeito')),
  criado_em timestamptz not null default now(),
  valido_ate timestamptz not null,
  dados jsonb not null
);
create index if not exists entrega_rotas_planos_estado on public.entrega_rotas_planos(estado,valido_ate);
create index if not exists entrega_rotas_planos_execucao on public.entrega_rotas_planos(execucao_id);
create table if not exists public.entrega_viagens (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid unique references public.entrega_rotas_planos(id) on delete set null,
  motoboy_id uuid references auth.users(id) on delete set null,
  motoboy_nome text not null,
  versao uuid not null default gen_random_uuid(),
  estado text not null default 'reservada' check(estado in ('reservada','em_rota','retornando','encerrada','cancelada')),
  criada_em timestamptz not null default now(),
  criada_por uuid references auth.users(id) on delete set null,
  automatica boolean not null default false,
  origem jsonb not null,
  regras jsonb not null,
  geometria jsonb,
  geometria_ate timestamptz,
  segundos integer not null check(segundos>=0),
  metros integer not null check(metros>=0),
  ultima_entrega_seg integer not null check(ultima_entrega_seg>=0),
  carregada_versao uuid,
  carregada_em timestamptz,
  revisao_pendente boolean not null default false,
  saiu_em timestamptz,
  retornou_em timestamptz,
  encerrada_por uuid references auth.users(id) on delete set null,
  motivo text
);
create unique index if not exists entrega_viagens_motoboy_ativa on public.entrega_viagens(motoboy_id)
  where estado in ('reservada','em_rota','retornando') and motoboy_id is not null;
create table if not exists public.entrega_viagens_paradas (
  viagem_id uuid not null references public.entrega_viagens(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  ordem integer not null check(ordem between 1 and 6),
  atribuicao uuid not null,
  chegada_seg integer not null check(chegada_seg>=0),
  ativa boolean not null default true,
  primary key(viagem_id,pedido_id), unique(viagem_id,ordem)
);
create unique index if not exists entrega_viagens_pedido_ativo on public.entrega_viagens_paradas(pedido_id) where ativa;
create table if not exists public.entrega_rotas_eventos (
  id uuid primary key default gen_random_uuid(),
  viagem_id uuid references public.entrega_viagens(id) on delete cascade,
  motoboy_id uuid references auth.users(id) on delete set null,
  autor uuid references auth.users(id) on delete set null,
  tipo text not null,
  criado_em timestamptz not null default now(),
  dados jsonb not null default '{}'
);
create index if not exists entrega_rotas_eventos_viagem on public.entrega_rotas_eventos(viagem_id,criado_em);
create index if not exists entrega_rotas_eventos_motoboy on public.entrega_rotas_eventos(motoboy_id);
create table if not exists public.entrega_rotas_cache (
  chave text primary key,
  matriz jsonb not null,
  valido_ate timestamptz not null
);
alter table public.entrega_rotas_config enable row level security;
alter table public.entregadores_disponibilidade enable row level security;
alter table public.entrega_rotas_execucoes enable row level security;
alter table public.entrega_rotas_planos enable row level security;
alter table public.entrega_viagens enable row level security;
alter table public.entrega_viagens_paradas enable row level security;
alter table public.entrega_rotas_eventos enable row level security;
alter table public.entrega_rotas_cache enable row level security;
revoke all on public.entrega_rotas_config,public.entregadores_disponibilidade,public.entrega_rotas_execucoes,
  public.entrega_rotas_planos,public.entrega_viagens,public.entrega_viagens_paradas,public.entrega_rotas_eventos,
  public.entrega_rotas_cache from public,anon,authenticated;

create or replace function public.rotas_regras_validas(r jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(r)<>'object' or not (r ?& array['maxPedidos','esperaMin','trajetoMin','desvioMin','paradaMin']) then return false; end if;
  if exists(select 1 from unnest(array['maxPedidos','esperaMin','trajetoMin','desvioMin','paradaMin']) k
    where jsonb_typeof(r->k)<>'number') then return false; end if;
  return (r->>'maxPedidos')::numeric between 1 and 6 and (r->>'maxPedidos')::numeric=trunc((r->>'maxPedidos')::numeric)
    and (r->>'esperaMin')::numeric between 1 and 120 and (r->>'trajetoMin')::numeric between 1 and 180
    and (r->>'desvioMin')::numeric between 0 and 120 and (r->>'paradaMin')::numeric between 0 and 15;
exception when others then return false;
end $$;
revoke all on function public.rotas_regras_validas(jsonb) from public,anon,authenticated;

create or replace function public.rotas_config_json() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('modo',c.modo,'regras',c.regras,'versao',c.versao,'limiteCreditosDia',c.limite_creditos_dia,
    'automacaoDisponivel',c.cron_ativo and c.job_url is not null,'origemConfirmada',l.entrega_origem ? 'confirmadaEm',
    'origem',l.entrega_origem,'configurada',public.rotas_regras_validas(c.regras))
  from public.entrega_rotas_config c cross join public.loja l where c.id=1 and l.id=1
$$;
revoke all on function public.rotas_config_json() from public,anon,authenticated;

create or replace function public.configurar_rotas(p_modo text,p_regras jsonb,p_limite integer default 1000,p_versao uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_modo is null or p_modo not in ('desligado','assistido','automatico') or p_limite is null or p_limite not between 20 and 100000
    or p_regras is null or (p_modo<>'desligado' and not public.rotas_regras_validas(p_regras)) then raise exception 'dados_invalidos'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_versao is distinct from c.versao then raise exception 'versao_alterada'; end if;
  if p_modo='automatico' and (not c.cron_ativo or c.job_url is null) then raise exception 'automacao_indisponivel'; end if;
  if p_modo<>'desligado' and not (select entrega_origem ? 'confirmadaEm' from public.loja where id=1) then raise exception 'origem_nao_confirmada'; end if;
  update public.entrega_rotas_config set modo=p_modo,regras=p_regras,limite_creditos_dia=p_limite,
    versao=gen_random_uuid(),alterado_em=now(),alterado_por=auth.uid() where id=1;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  insert into public.entrega_rotas_eventos(autor,tipo,dados) values(auth.uid(),'configuracao',jsonb_build_object('modo',p_modo,'regras',p_regras));
  if p_modo='automatico' then perform public.disparar_planejador_entregas(); end if;
  return public.rotas_config_json();
end $$;
revoke all on function public.configurar_rotas(text,jsonb,integer,uuid) from public,anon;
grant execute on function public.configurar_rotas(text,jsonb,integer,uuid) to authenticated;

create or replace function public.estado_entregador_rotas(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'declarado',coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) then d.situacao end,'fora'),
    'disponivelDesde',d.desde,'ultimaEm',c.ultima_em,'viagemId',v.id,
    'qtdAbertas',(select count(*) from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),
    'situacao',case when v.id is not null then v.estado else coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) then d.situacao end,'fora') end,
    'elegivel',coalesce(m.ativo and d.situacao='na_loja' and public.dia_operacional(d.desde)=public.dia_operacional(now()) and c.ultima_em>=now()-interval '2 minutes' and v.id is null and not exists(
      select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
      where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),false))
  from public.motoboys m left join public.entregadores_disponibilidade d on d.user_id=m.user_id
    left join public.entregadores_comunicacao c on c.user_id=m.user_id
    left join public.entrega_viagens v on v.motoboy_id=m.user_id and v.estado in ('reservada','em_rota','retornando')
  where m.user_id=p_id
$$;
revoke all on function public.estado_entregador_rotas(uuid) from public,anon,authenticated;

create or replace function public.definir_disponibilidade_entregador(p_situacao text,p_motoboy uuid default null,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare alvo uuid:=coalesce(p_motoboy,auth.uid()); anterior public.entregadores_disponibilidade;
begin
  if not public.is_equipe() and (not public.is_motoboy() or alvo is distinct from auth.uid()) then raise exception 'sem_permissao'; end if;
  if alvo is null or p_situacao is null or p_situacao not in ('na_loja','pausado','fora') then raise exception 'dados_invalidos'; end if;
  if alvo is distinct from auth.uid() and (nullif(btrim(p_motivo),'') is null or length(p_motivo)>200) then raise exception 'motivo_obrigatorio'; end if;
  perform 1 from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if exists(select 1 from public.entrega_viagens where motoboy_id=alvo and estado in ('reservada','em_rota','retornando')) then
    raise exception 'entregador_em_viagem'; end if;
  if p_situacao='na_loja' and exists(select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
    where e.motoboy_id=alvo and e.encerramento is null and p.status in ('preparo','pronto','rota')) then raise exception 'entregas_pendentes'; end if;
  select * into anterior from public.entregadores_disponibilidade where user_id=alvo;
  if anterior.situacao is distinct from p_situacao or public.dia_operacional(anterior.desde) is distinct from public.dia_operacional(now()) then
    insert into public.entregadores_disponibilidade(user_id,situacao,autor,motivo) values(alvo,p_situacao,auth.uid(),nullif(btrim(p_motivo),''))
      on conflict(user_id) do update set situacao=excluded.situacao,desde=now(),autor=excluded.autor,motivo=excluded.motivo;
    insert into public.entrega_rotas_eventos(motoboy_id,autor,tipo,dados) values(alvo,auth.uid(),'disponibilidade',
      jsonb_build_object('situacao',p_situacao,'motivo',nullif(btrim(p_motivo),'')));
  end if;
  if alvo=auth.uid() then perform public.comunicar_entregador(); end if;
  if p_situacao='na_loja' then perform public.disparar_planejador_entregas(); end if;
  return public.estado_entregador_rotas(alvo);
end $$;
revoke all on function public.definir_disponibilidade_entregador(text,uuid,text) from public,anon;
grant execute on function public.definir_disponibilidade_entregador(text,uuid,text) to authenticated;

-- Somente a Edge Function autenticada cria execuções. O token do cron nunca sai em uma RPC do navegador.
create or replace function public.iniciar_planejamento_entregas(p_autor uuid,p_token text default null,
  p_pedidos jsonb default null,p_ordem_fixa boolean default false,p_verificar boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config; origem jsonb; pedidos jsonb; entregadores jsonb; entrada jsonb; cache_chave text;
  id_exec uuid; usados integer; custo integer; n integer; matriz jsonb; inicio timestamptz;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if p_autor is null then
    if p_token is null or p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
    if not coalesce(p_verificar,false) and c.modo<>'automatico' then return jsonb_build_object('estado','desligado'); end if;
  elsif not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_autor is null and p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
  if p_autor is null and not coalesce(p_verificar,false) and c.modo<>'automatico' then return jsonb_build_object('estado','desligado'); end if;
  if exists(select 1 from public.entrega_rotas_execucoes where estado='calculando' and criado_em>now()-interval '2 minutes') then
    return jsonb_build_object('estado','calculando'); end if;
  if exists(select 1 from public.entrega_rotas_execucoes where criado_em>now()-interval '5 seconds') then
    return jsonb_build_object('estado','aguarde'); end if;
  select entrega_origem into origem from public.loja where id=1;
  if not coalesce(p_verificar,false) and (c.modo='desligado' or not public.rotas_regras_validas(c.regras)) then raise exception 'configuracao_rotas_pendente'; end if;
  if not coalesce(p_verificar,false) and not (origem ? 'confirmadaEm') then raise exception 'origem_nao_confirmada'; end if;
  if p_pedidos is not null and (jsonb_typeof(p_pedidos)<>'array' or jsonb_array_length(p_pedidos) not between 1 and 6
    or (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_pedidos) x)) then raise exception 'dados_invalidos'; end if;
  inicio:=(public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select coalesce(jsonb_agg(e||jsonb_build_object('qtdConcluidas',public.taxas_entregador(m.user_id,inicio)->'qtdConcluidas') order by m.user_id),'[]')
    into entregadores from public.motoboys m cross join lateral (select public.estado_entregador_rotas(m.user_id) e) s
    where (e->>'elegivel')::boolean is true;
  select coalesce(jsonb_agg(x.dados order by x.ordem,x.pronto,x.id),'[]') into pedidos from (
    select p.id,h.pronto,case when p_pedidos is null then 0 else (select a.n::integer from jsonb_array_elements_text(p_pedidos) with ordinality a(v,n) where v=p.id::text) end as ordem,
      jsonb_build_object('id',p.id,'numero',p.numero,'ponto',p.entrega_destino,'pontoAte',p.entrega_destino_ate,
        'prontoEm',public.data_iso(h.pronto),'versao',md5(to_jsonb(p)::text)) as dados
    from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      cross join lateral (select max((x->>'em')::timestamptz) as pronto from jsonb_array_elements(p.historico) x where x->>'status'='pronto') h
    where p.modo='entrega' and p.origem<>'exemplo' and p.status='pronto' and h.pronto is not null
      and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
      and p.entrega_destino is not null and p.entrega_destino_ate>now()
      and (not p.entrega_planejamento_pausado or (p_pedidos is not null and p_autor is not null))
      and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      and (p_pedidos is null or p_pedidos ? p.id::text)
    order by ordem,h.pronto,p.id limit 12) x;
  n:=jsonb_array_length(pedidos);
  if not coalesce(p_verificar,false) then
    if p_pedidos is not null and n<>jsonb_array_length(p_pedidos) then raise exception 'pedido_alterado'; end if;
    if n=0 then return jsonb_build_object('estado','sem_pedidos'); end if;
    if jsonb_array_length(entregadores)=0 then return jsonb_build_object('estado','sem_entregador'); end if;
  end if;
  cache_chave:=case when not coalesce(p_verificar,false) then md5(jsonb_build_object('origem',origem,'pontos',
    (select jsonb_agg(x->'ponto' order by a.n) from jsonb_array_elements(pedidos) with ordinality a(x,n)),'modelo','drive-approximated-v1')::text) end;
  select x.matriz into matriz from public.entrega_rotas_cache x where x.chave=cache_chave and x.valido_ate>now();
  -- Reserva conservadora, por tentativa: orçamento interno estimado, não saldo da conta do provedor.
  custo:=case when coalesce(p_verificar,false) then 12 else (case when matriz is null then (n+1)*least(n+1,10) else 0 end)+4*n end;
  select coalesce(sum(creditos_reservados),0) into usados from public.entrega_rotas_execucoes where criado_em>=inicio;
  if usados+custo>c.limite_creditos_dia then raise exception 'orcamento_rotas_esgotado'; end if;
  entrada:=jsonb_build_object('origem',origem,'regras',c.regras,'configVersao',c.versao,'pedidos',pedidos,
    'entregadores',entregadores,'ordemFixa',coalesce(p_ordem_fixa,false),'cacheChave',cache_chave,'verificacao',coalesce(p_verificar,false),
    'agora',public.data_iso(now()));
  insert into public.entrega_rotas_execucoes(autor,automatica,entrada,creditos_reservados)
    values(p_autor,p_autor is null and not coalesce(p_verificar,false),entrada,custo) returning id into id_exec;
  return entrada||jsonb_build_object('id',id_exec,'estado','calcular','matriz',matriz);
end $$;
revoke all on function public.iniciar_planejamento_entregas(uuid,text,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.iniciar_planejamento_entregas(uuid,text,jsonb,boolean,boolean) to service_role;

create or replace function public.viagem_entrega_json(v public.entrega_viagens) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',v.id,'motoboyId',v.motoboy_id,'motoboyNome',v.motoboy_nome,'versao',v.versao,'estado',v.estado,
    'criadaEm',v.criada_em,'automatica',v.automatica,'carregadaVersao',v.carregada_versao,'carregadaEm',v.carregada_em,
    'revisaoPendente',v.revisao_pendente,'saiuEm',v.saiu_em,'origem',v.origem,
    'segundos',v.segundos,'metros',v.metros,'ultimaEntregaSeg',v.ultima_entrega_seg,
    'geometriaAte',v.geometria_ate,
    'geometria',case when v.geometria_ate>now() and not v.revisao_pendente then v.geometria end,
    'paradas',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,
      'endereco',p.endereco,'status',p.status,'ordem',s.ordem,'atribuicao',s.atribuicao,'chegadaSeg',s.chegada_seg,
      'ponto',case when p.entrega_destino_ate>now() then p.entrega_destino end,'pontoAte',p.entrega_destino_ate) order by s.ordem)
      from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id where s.viagem_id=v.id),'[]'))
$$;
revoke all on function public.viagem_entrega_json(public.entrega_viagens) from public,anon,authenticated;

create or replace function public.plano_entrega_json(v public.entrega_rotas_planos) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',v.id,'motoboyId',v.motoboy_id,'motoboyNome',m.nome,'validoAte',v.valido_ate,
    'segundos',v.dados->'segundos','metros',v.dados->'metros','ultimaEntregaSeg',v.dados->'ultimaEntregaSeg',
    'origem',v.dados->'origem','urgente',v.dados->'urgente','geometria',case when (v.dados->>'geometriaAte')::timestamptz>now() then v.dados->'geometria' end,
    'paradas',(select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'endereco',p.endereco,
      'ordem',n,'chegadaSeg',x->'chegadaSeg','ponto',case when p.entrega_destino_ate>now() then p.entrega_destino end) order by n)
      from jsonb_array_elements(v.dados->'paradas') with ordinality a(x,n) join public.pedidos p on p.id=(x->>'id')::uuid))
  from public.motoboys m where m.user_id=v.motoboy_id
$$;
revoke all on function public.plano_entrega_json(public.entrega_rotas_planos) from public,anon,authenticated;

-- Todos os caminhos de reserva usam a mesma ordem de travas: configuração, pedidos, motoboy, plano.
create or replace function public.reservar_plano_entregas(p_id uuid,p_autor uuid,p_motoboy uuid default null,p_automatica boolean default false) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; plano public.entrega_rotas_planos; pedido public.pedidos; alvo uuid;
  viagem uuid; moto_nome text; parada_entrada jsonb; snap jsonb; n integer:=0; atrib uuid; existente uuid;
begin
  select * into c from public.entrega_rotas_config where id=1 for update;
  select * into plano from public.entrega_rotas_planos where id=p_id;
  if not found then raise exception 'nao_encontrado'; end if;
  select id into existente from public.entrega_viagens where plano_id=p_id;
  if existente is not null then return existente; end if;
  if plano.estado<>'aberto' or plano.valido_ate<=now() or plano.config_versao<>c.versao or c.modo='desligado'
    or (p_automatica and c.modo<>'automatico') then raise exception 'plano_expirado'; end if;
  if plano.dados->'origem' is distinct from (select entrega_origem from public.loja where id=1) then raise exception 'plano_expirado'; end if;
  for pedido in select p.* from public.pedidos p join jsonb_array_elements(plano.dados->'paradas') s on p.id=(s->>'id')::uuid
    order by p.id for update of p loop
    select x into snap from jsonb_array_elements(plano.dados->'pedidos') x where x->>'id'=pedido.id::text;
    if pedido.status<>'pronto' or pedido.modo<>'entrega' or snap->>'versao' is distinct from md5(to_jsonb(pedido)::text)
      or (p_automatica and pedido.entrega_planejamento_pausado)
      or pedido.entrega_destino is null or pedido.entrega_destino_ate<=now()
      or exists(select 1 from public.entregas_operacao where pedido_id=pedido.id and (motoboy_id is not null or saiu_em is not null or encerramento is not null))
      or exists(select 1 from public.entrega_viagens_paradas where pedido_id=pedido.id and ativa) then raise exception 'pedido_alterado'; end if;
    n:=n+1;
  end loop;
  if n<1 or n<>jsonb_array_length(plano.dados->'paradas') or n>(c.regras->>'maxPedidos')::integer then raise exception 'pedido_alterado'; end if;
  alvo:=coalesce(p_motoboy,plano.motoboy_id);
  select nome into moto_nome from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if not coalesce((public.estado_entregador_rotas(alvo)->>'elegivel')::boolean,false) then raise exception 'entregador_indisponivel'; end if;
  select * into plano from public.entrega_rotas_planos where id=p_id for update;
  if plano.estado<>'aberto' or plano.valido_ate<=now() then raise exception 'plano_expirado'; end if;
  insert into public.entrega_viagens(plano_id,motoboy_id,motoboy_nome,criada_por,automatica,origem,regras,geometria,geometria_ate,segundos,metros,ultima_entrega_seg)
    values(plano.id,alvo,moto_nome,p_autor,p_automatica,plano.dados->'origem',c.regras,plano.dados->'geometria',
      (plano.dados->>'geometriaAte')::timestamptz,(plano.dados->>'segundos')::integer,(plano.dados->>'metros')::integer,
      (plano.dados->>'ultimaEntregaSeg')::integer) returning id into viagem;
  n:=0;
  for parada_entrada in select x from jsonb_array_elements(plano.dados->'paradas') x loop
    n:=n+1; atrib:=gen_random_uuid();
    update public.pedidos set entrega_planejamento_pausado=false where id=(parada_entrada->>'id')::uuid and entrega_planejamento_pausado;
    insert into public.entregas_operacao(pedido_id,atribuicao,motoboy_id,motoboy_nome,atribuido_por)
      values((parada_entrada->>'id')::uuid,atrib,alvo,moto_nome,p_autor) on conflict(pedido_id) do update set
      atribuicao=excluded.atribuicao,motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,atribuido_em=now(),atribuido_por=excluded.atribuido_por;
    insert into public.entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,chegada_seg)
      values(viagem,(parada_entrada->>'id')::uuid,n,atrib,(parada_entrada->>'chegadaSeg')::integer);
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values((parada_entrada->>'id')::uuid,p_autor,'atribuicao',
      jsonb_build_object('motoboy',alvo,'nome',moto_nome,'viagem',viagem,'origem',case when p_automatica then 'planejamento_automatico' else 'planejamento_equipe' end));
  end loop;
  update public.entrega_rotas_planos set estado='reservado',dados=dados-'pedidos'-'geometria' where id=p_id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo) values(viagem,alvo,p_autor,'reserva');
  return viagem;
end $$;
revoke all on function public.reservar_plano_entregas(uuid,uuid,uuid,boolean) from public,anon,authenticated;

create or replace function public.reservar_viagem_entrega(p_plano uuid,p_motoboy uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare id_viagem uuid;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  id_viagem:=public.reservar_plano_entregas(p_plano,auth.uid(),p_motoboy,false);
  return jsonb_build_object('ok',true,'id',id_viagem);
end $$;
revoke all on function public.reservar_viagem_entrega(uuid,uuid) from public,anon;
grant execute on function public.reservar_viagem_entrega(uuid,uuid) to authenticated;

create or replace function public.concluir_planejamento_entregas(p_execucao uuid,p_planos jsonb default '[]',
  p_impedidos jsonb default '[]',p_matriz jsonb default null,p_erro text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ex public.entrega_rotas_execucoes; c public.entrega_rotas_config; proposta jsonb; snapshots jsonb;
  plano uuid; viagem uuid; quantidade integer:=0; reservadas integer:=0; ate timestamptz; dados jsonb;
begin
  select * into ex from public.entrega_rotas_execucoes where id=p_execucao for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if ex.estado<>'calculando' then return jsonb_build_object('estado',ex.estado,'id',ex.id); end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_erro is not null then
    update public.entrega_rotas_execucoes set estado='erro',erro=left(p_erro,80),entrada=jsonb_build_object('configVersao',ex.entrada->'configVersao') where id=ex.id;
    return jsonb_build_object('estado','erro');
  end if;
  if ex.criado_em<now()-interval '2 minutes' or ex.entrada->>'configVersao' is distinct from c.versao::text then
    update public.entrega_rotas_execucoes set estado='erro',erro='plano_expirado',entrada='{}' where id=ex.id;
    return jsonb_build_object('estado','expirado');
  end if;
  if jsonb_typeof(p_planos)<>'array' or jsonb_array_length(p_planos)>12 or length(p_planos::text)>2000000
    or jsonb_typeof(p_impedidos)<>'array' then raise exception 'dados_invalidos'; end if;
  if (select count(*)<>count(distinct s->>'id') from jsonb_array_elements(p_planos) v cross join jsonb_array_elements(v->'paradas') s)
    or (select count(*)<>count(distinct v->>'motoboyId') from jsonb_array_elements(p_planos) v) then raise exception 'dados_invalidos'; end if;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  for proposta in select v from jsonb_array_elements(p_planos) v loop
    if jsonb_typeof(proposta->'paradas')<>'array' or jsonb_array_length(proposta->'paradas') not between 1 and (c.regras->>'maxPedidos')::integer
      or not exists(select 1 from jsonb_array_elements(ex.entrada->'entregadores') m where m->>'id'=proposta->>'motoboyId')
      or jsonb_typeof(proposta->'geometria')<>'object' or proposta->'geometria'->>'type'<>'MultiLineString'
      or (proposta->>'segundos')::numeric not between 0 and 86400 or (proposta->>'metros')::numeric not between 0 and 700000
      or (proposta->>'ultimaEntregaSeg')::numeric not between 0 and ((c.regras->>'trajetoMin')::numeric*60) then raise exception 'dados_invalidos'; end if;
    select jsonb_agg(s order by n),min((s->>'pontoAte')::timestamptz) into snapshots,ate
      from jsonb_array_elements(proposta->'paradas') with ordinality a(v,n)
      join jsonb_array_elements(ex.entrada->'pedidos') s on s->>'id'=v->>'id';
    if jsonb_array_length(snapshots) is distinct from jsonb_array_length(proposta->'paradas') or ate<=now() then raise exception 'pedido_alterado'; end if;
    dados:=proposta||jsonb_build_object('origem',ex.entrada->'origem','pedidos',snapshots,'geometriaAte',ate);
    insert into public.entrega_rotas_planos(execucao_id,motoboy_id,config_versao,valido_ate,dados)
      values(ex.id,(proposta->>'motoboyId')::uuid,c.versao,least(now()+interval '90 seconds',ate),dados) returning id into plano;
    quantidade:=quantidade+1;
    if ex.automatica and c.modo='automatico' then
      begin
        viagem:=public.reservar_plano_entregas(plano,null,null,true);
        reservadas:=reservadas+1;
      exception when others then
        -- Revalidação pode perder a corrida para a equipe. Não duplica nem desfaz outra atribuição.
        update public.entrega_rotas_planos set estado='vencido' where id=plano;
        insert into public.entrega_rotas_eventos(tipo,dados) values('reserva_descartada',jsonb_build_object('plano',plano,'codigo',sqlstate));
        p_impedidos:=p_impedidos||(select jsonb_agg(jsonb_build_object('id',s->>'id','motivo','revalidacao_falhou'))
          from jsonb_array_elements(proposta->'paradas') s);
      end;
    end if;
  end loop;
  if p_matriz is not null and ex.entrada->>'cacheChave' is not null and jsonb_typeof(p_matriz)='array' then
    select least(now()+interval '15 minutes',min((s->>'pontoAte')::timestamptz)) into ate from jsonb_array_elements(ex.entrada->'pedidos') s;
    insert into public.entrega_rotas_cache(chave,matriz,valido_ate) values(ex.entrada->>'cacheChave',p_matriz,ate)
      on conflict(chave) do update set matriz=excluded.matriz,valido_ate=excluded.valido_ate;
  end if;
  update public.entrega_rotas_execucoes set estado='concluida',impedidos=p_impedidos,
    entrada=jsonb_build_object('configVersao',ex.entrada->'configVersao','verificacao',ex.entrada->'verificacao',
      'quantidade',jsonb_array_length(ex.entrada->'pedidos')) where id=ex.id;
  return jsonb_build_object('estado','concluida','planos',quantidade,'reservadas',reservadas,'verificacao',ex.entrada->'verificacao');
end $$;
revoke all on function public.concluir_planejamento_entregas(uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.concluir_planejamento_entregas(uuid,jsonb,jsonb,jsonb,text) to service_role;

create or replace function public.reconhecer_carregamento_viagem(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found or v.motoboy_id is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if v.versao is distinct from p_versao or v.revisao_pendente then raise exception 'versao_alterada'; end if;
  if v.estado<>'reservada' then raise exception 'transicao_invalida'; end if;
  update public.entrega_viagens set carregada_versao=versao,carregada_em=now() where id=p_id;
  perform public.comunicar_entregador();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.reconhecer_carregamento_viagem(uuid,uuid) from public,anon;
grant execute on function public.reconhecer_carregamento_viagem(uuid,uuid) to authenticated;

create or replace function public.iniciar_viagem_entrega(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid; pedido_linha public.pedidos;
begin
  if not public.is_equipe() and not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  if not public.is_equipe() and alvo is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  perform 1 from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado in ('em_rota','retornando','encerrada') then return jsonb_build_object('ok',true,'jaIniciada',true); end if;
  if v.estado<>'reservada' then raise exception 'transicao_invalida'; end if;
  if v.revisao_pendente then raise exception 'viagem_requer_revisao'; end if;
  if v.carregada_versao is distinct from v.versao then raise exception 'carregamento_pendente'; end if;
  if v.origem is distinct from (select entrega_origem from public.loja where id=1) then raise exception 'origem_alterada'; end if;
  if exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    join public.entregas_operacao e on e.pedido_id=p.id where s.viagem_id=v.id and
      (not s.ativa or p.status<>'pronto' or e.atribuicao<>s.atribuicao or e.motoboy_id is distinct from alvo or e.saiu_em is not null
        or p.entrega_destino is null or p.entrega_destino_ate<=now())) then raise exception 'pedido_alterado'; end if;
  for pedido_linha in select p.* from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=v.id order by p.id loop
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(jsonb_build_object(
      'status','rota','em',public.data_iso(now()),'autor',auth.uid(),'viagem',v.id)) where id=pedido_linha.id;
  end loop;
  update public.entrega_viagens set estado='em_rota',saiu_em=now() where id=v.id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo) values(v.id,alvo,auth.uid(),'saida');
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.iniciar_viagem_entrega(uuid,uuid) from public,anon;
grant execute on function public.iniciar_viagem_entrega(uuid,uuid) to authenticated;

create or replace function public.desfazer_viagem_entrega(p_id uuid,p_versao uuid,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if nullif(btrim(p_motivo),'') is null or length(p_motivo)>200 then raise exception 'motivo_obrigatorio'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  perform 1 from public.motoboys where user_id=alvo for update;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.estado='cancelada' then return jsonb_build_object('ok',true,'jaDesfeita',true); end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado<>'reservada' or v.saiu_em is not null then raise exception 'entrega_em_andamento'; end if;
  insert into public.entregas_eventos(pedido_id,autor,tipo,dados) select s.pedido_id,auth.uid(),'viagem_desfeita',
    jsonb_build_object('viagem',v.id,'motivo',btrim(p_motivo)) from public.entrega_viagens_paradas s where s.viagem_id=v.id;
  delete from public.entregas_operacao e using public.entrega_viagens_paradas s
    where s.viagem_id=v.id and e.pedido_id=s.pedido_id and e.saiu_em is null and e.encerramento is null;
  update public.pedidos p set entrega_planejamento_pausado=true from public.entrega_viagens_paradas s
    where s.viagem_id=v.id and p.id=s.pedido_id and p.status='pronto';
  update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
  update public.entrega_viagens set estado='cancelada',versao=gen_random_uuid(),encerrada_por=auth.uid(),motivo=btrim(p_motivo) where id=v.id;
  update public.entrega_rotas_planos set estado='desfeito' where id=v.plano_id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(v.id,alvo,auth.uid(),'desfeita',jsonb_build_object('motivo',btrim(p_motivo)));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.desfazer_viagem_entrega(uuid,uuid,text) from public,anon;
grant execute on function public.desfazer_viagem_entrega(uuid,uuid,text) to authenticated;

create or replace function public.retornar_viagem_entrega(p_id uuid,p_versao uuid,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid; cadastro_ativo boolean;
begin
  if not public.is_equipe() and not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  if not public.is_equipe() and alvo is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if alvo is distinct from auth.uid() and (not public.is_equipe() or nullif(btrim(p_motivo),'') is null or length(p_motivo)>200) then raise exception 'motivo_obrigatorio'; end if;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  select ativo into cadastro_ativo from public.motoboys where user_id=alvo for update;
  if not found or (not cadastro_ativo and not public.is_equipe()) then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado='encerrada' then return jsonb_build_object('ok',true,'jaRetornada',true); end if;
  if v.estado not in ('em_rota','retornando') then raise exception 'transicao_invalida'; end if;
  if exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    where s.viagem_id=v.id and p.status not in ('entregue','cancelado')) then raise exception 'entregas_pendentes'; end if;
  update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
  update public.entrega_viagens set estado='encerrada',retornou_em=now(),encerrada_por=auth.uid(),motivo=nullif(btrim(p_motivo),'') where id=v.id;
  insert into public.entregadores_disponibilidade(user_id,situacao,autor,motivo) values(alvo,case when cadastro_ativo then 'na_loja' else 'fora' end,auth.uid(),nullif(btrim(p_motivo),''))
    on conflict(user_id) do update set situacao=excluded.situacao,desde=now(),autor=excluded.autor,motivo=excluded.motivo;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(v.id,alvo,auth.uid(),'retorno',jsonb_build_object('motivo',nullif(btrim(p_motivo),'')));
  if alvo=auth.uid() then perform public.comunicar_entregador(); end if;
  perform public.disparar_planejador_entregas();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.retornar_viagem_entrega(uuid,uuid,text) from public,anon;
grant execute on function public.retornar_viagem_entrega(uuid,uuid,text) to authenticated;

create or replace function public.acompanhar_parada_viagem() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens;
begin
  if new.status=old.status or new.status not in ('entregue','cancelado') then return new; end if;
  select v1.* into v from public.entrega_viagens v1 join public.entrega_viagens_paradas s on s.viagem_id=v1.id
    where s.pedido_id=new.id and s.ativa for update of v1;
  if not found then return new; end if;
  if v.estado='reservada' then
    update public.entrega_viagens set revisao_pendente=true,versao=gen_random_uuid(),carregada_versao=null where id=v.id;
    if not exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
      where s.viagem_id=v.id and p.status not in ('entregue','cancelado')) then
      update public.entrega_viagens set estado='cancelada',motivo='Pedidos encerrados antes da saída' where id=v.id;
      update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
    end if;
  elsif v.estado='em_rota' and not exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    where s.viagem_id=v.id and p.status not in ('entregue','cancelado')) then
    update public.entrega_viagens set estado='retornando' where id=v.id;
  end if;
  return new;
end $$;
revoke all on function public.acompanhar_parada_viagem() from public,anon,authenticated;
drop trigger if exists pedidos_viagens_paradas on public.pedidos;
create trigger pedidos_viagens_paradas after update of status on public.pedidos for each row execute function public.acompanhar_parada_viagem();

create or replace function public.painel_rotas_entregas() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  select jsonb_build_object('servidorEm',public.data_iso(now()),'config',public.rotas_config_json(),
    'entregadores',coalesce((select jsonb_agg(public.estado_entregador_rotas(user_id) order by nome) from public.motoboys),'[]'),
    'planos',coalesce((select jsonb_agg(public.plano_entrega_json(p) order by p.criado_em,p.id) from public.entrega_rotas_planos p
      where p.estado='aberto' and p.valido_ate>now()),'[]'),
    'viagens',coalesce((select jsonb_agg(public.viagem_entrega_json(v) order by v.criada_em) from public.entrega_viagens v
      where v.estado in ('reservada','em_rota','retornando')),'[]'),
    'prontos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'endereco',p.endereco,
      'prontoEm',(select max(x->>'em') from jsonb_array_elements(p.historico) x where x->>'status'='pronto'),
      'pausado',p.entrega_planejamento_pausado,
      'pontoValido',p.entrega_destino is not null and p.entrega_destino_ate>now()) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id where p.modo='entrega' and p.status='pronto'
      and p.origem<>'exemplo' and e.motoboy_id is null and e.encerramento is null and not exists(
        select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)),'[]'),
    'ultimaExecucao',(select jsonb_build_object('estado',e.estado,'em',e.criado_em,'erro',e.erro,'impedidos',e.impedidos,
      'verificacao',e.entrada->'verificacao') from public.entrega_rotas_execucoes e order by e.criado_em desc limit 1),
    'creditosEstimadosHoje',(select coalesce(sum(creditos_reservados),0) from public.entrega_rotas_execucoes where criado_em>=
      (public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo')) into r;
  return r;
end $$;
revoke all on function public.painel_rotas_entregas() from public,anon;
grant execute on function public.painel_rotas_entregas() to authenticated;

create or replace function public.minha_operacao_rotas() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return jsonb_build_object('servidorEm',public.data_iso(now()),'entregador',public.estado_entregador_rotas(auth.uid()),
    'modo',(select modo from public.entrega_rotas_config where id=1),
    'viagem',(select public.viagem_entrega_json(v) from public.entrega_viagens v where motoboy_id=auth.uid() and estado in ('reservada','em_rota','retornando')));
end $$;
revoke all on function public.minha_operacao_rotas() from public,anon;
grant execute on function public.minha_operacao_rotas() to authenticated;

create or replace function public.minhas_entregas() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return coalesce((select jsonb_agg(public.entrega_json(p)||jsonb_build_object(
    'atribuicao',e.atribuicao,'atribuidoEm',public.data_iso(e.atribuido_em),
    'viagemId',s.viagem_id,'ordemViagem',s.ordem,'versaoViagem',v.versao) order by v.criada_em nulls last,s.ordem,e.atribuido_em)
    from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
      left join public.entrega_viagens_paradas s on s.pedido_id=p.id and s.ativa
      left join public.entrega_viagens v on v.id=s.viagem_id
    where e.motoboy_id=auth.uid() and e.encerramento is null and p.status in ('preparo','pronto','rota')),'[]');
end $$;

-- Fluxo novo permite registrar a prontidão. Saída individual antiga continua como recuperação operacional;
-- pedidos reservados em viagem saem somente pela operação atômica da viagem.
create or replace function public.mudar_status(p_id uuid,p_status text,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos; motivo text:=public.aparar(coalesce(p_motivo,'')); ok boolean; evento jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  if p_id is null or p_status is null or p_status not in ('novo','preparo','pronto','rota','entregue','cancelado') or length(motivo)>200 then
    raise exception 'dados_invalidos' using errcode='P0001'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  if p_status in ('rota','entregue') and exists(select 1 from public.entrega_viagens_paradas where pedido_id=p_id and ativa) then
    raise exception 'pedido_em_viagem'; end if;
  if p.origem='exemplo' then ok:=true;
  else ok:=case when p_status='cancelado' then p.status in ('novo','preparo','pronto','rota')
    when p.status='novo' then p_status='preparo'
    when p.status='preparo' then p_status='pronto' or (p.modo='entrega' and p_status='rota')
    when p.status='pronto' then p_status=case when p.modo='entrega' then 'rota' else 'entregue' end
    when p.status='rota' then p_status='entregue' else false end; end if;
  if not ok then raise exception 'transicao_invalida' using errcode='P0001'; end if;
  if p_status='cancelado' and motivo='' and p.origem<>'exemplo' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
  evento:=jsonb_build_object('status',p_status,'em',public.data_iso(now()));
  if motivo<>'' then evento:=evento||jsonb_build_object('motivo',motivo); end if;
  update public.pedidos set status=p_status,historico=historico||jsonb_build_array(evento) where id=p_id returning * into p;
  if p_status='pronto' and p.modo='entrega' then perform public.disparar_planejador_entregas(); end if;
  return public.pedido_json(p);
end $$;
revoke all on function public.mudar_status(uuid,text,text) from public,anon;
grant execute on function public.mudar_status(uuid,text,text) to authenticated;

create or replace function public.atribuir_entrega(p_id uuid,p_motoboy uuid,p_sair boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos; e public.entregas_operacao; n text;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('preparo','pronto','rota') then raise exception 'transicao_invalida'; end if;
  select nome into n from public.motoboys where user_id=p_motoboy and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if exists(select 1 from public.entrega_viagens_paradas where pedido_id=p_id and ativa) then raise exception 'pedido_em_viagem'; end if;
  if exists(select 1 from public.entrega_viagens where motoboy_id=p_motoboy and estado in ('reservada','em_rota','retornando')) then raise exception 'entregador_em_viagem'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id;
  if e.encerramento is not null then raise exception 'transicao_invalida'; end if;
  if e.motoboy_id is distinct from p_motoboy and e.saiu_em is not null then raise exception 'entrega_em_andamento'; end if;
  if e.pedido_id is null or e.motoboy_id is distinct from p_motoboy then
    insert into public.entregas_operacao(pedido_id,motoboy_id,motoboy_nome,atribuido_por,saiu_em)
      values(p_id,p_motoboy,n,auth.uid(),case when p.status='rota' then coalesce((public.entrega_json(p)->>'saiuEm')::timestamptz,now()) end)
      on conflict(pedido_id) do update set motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,
        atribuicao=gen_random_uuid(),atribuido_em=now(),atribuido_por=auth.uid();
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values(p_id,auth.uid(),'atribuicao',jsonb_build_object('motoboy',p_motoboy,'nome',n));
  end if;
  if coalesce(p_sair,false) and p.status<>'rota' then
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(jsonb_build_object('status','rota','em',public.data_iso(now()),'autor',auth.uid())) where id=p_id;
  end if;
  update public.pedidos set entrega_planejamento_pausado=false where id=p_id and entrega_planejamento_pausado;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.atribuir_entrega(uuid,uuid,boolean) from public,anon;
grant execute on function public.atribuir_entrega(uuid,uuid,boolean) to authenticated;

create or replace function public.liberar_planejamento_pedidos(p_ids jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pedido_linha public.pedidos; n integer:=0;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids) not between 1 and 12
    or (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_ids) x) then raise exception 'dados_invalidos'; end if;
  for pedido_linha in select p.* from public.pedidos p join jsonb_array_elements_text(p_ids) x on p.id=x::uuid order by p.id for update of p loop
    if pedido_linha.status<>'pronto' or pedido_linha.modo<>'entrega' or exists(select 1 from public.entrega_viagens_paradas where pedido_id=pedido_linha.id and ativa) then raise exception 'pedido_alterado'; end if;
    n:=n+1;
    update public.pedidos set entrega_planejamento_pausado=false where id=pedido_linha.id;
    insert into public.entregas_eventos(pedido_id,autor,tipo) values(pedido_linha.id,auth.uid(),'planejamento_liberado');
  end loop;
  if n<>jsonb_array_length(p_ids) then raise exception 'dados_invalidos'; end if;
  perform public.disparar_planejador_entregas();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.liberar_planejamento_pedidos(jsonb) from public,anon;
grant execute on function public.liberar_planejamento_pedidos(jsonb) to authenticated;

create or replace function public.conferir_destino_pedido(p_id uuid,p_lat double precision,p_lon double precision,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_lat is null or p_lon is null or not (p_lat between -34 and 6) or not (p_lon between -74 and -34) then raise exception 'dados_invalidos'; end if;
  if nullif(btrim(p_motivo),'') is null or length(p_motivo)>200 then raise exception 'motivo_obrigatorio'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('preparo','pronto') or exists(select 1 from public.entregas_operacao where pedido_id=p_id and saiu_em is not null)
    or exists(select 1 from public.entrega_viagens_paradas where pedido_id=p_id and ativa) then raise exception 'pedido_em_viagem'; end if;
  update public.pedidos set entrega_destino=jsonb_build_object('lat',p_lat,'lon',p_lon,'fonte','equipe','confirmado',true),
    entrega_destino_ate=now()+interval '30 days' where id=p_id;
  insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values(p_id,auth.uid(),'destino_conferido',jsonb_build_object('motivo',btrim(p_motivo)));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.conferir_destino_pedido(uuid,double precision,double precision,text) from public,anon;
grant execute on function public.conferir_destino_pedido(uuid,double precision,double precision,text) to authenticated;

-- Uma chamada de cron com capacidade limitada, sem guardar service_role no banco.
create or replace function public.disparar_planejador_entregas(p_verificar boolean default false) returns bigint
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; requisicao bigint;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if c.job_url is null or (c.modo<>'automatico' and not p_verificar)
    or c.job_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/planejar-entregas$'
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  select net.http_post(url:=c.job_url,body:=jsonb_build_object('tokenJob',c.job_token,'acao',case when p_verificar then 'verificar' else 'automatico' end),
    headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=90000) into requisicao;
  return requisicao;
end $$;
revoke all on function public.disparar_planejador_entregas(boolean) from public,anon,authenticated;

create or replace function public.limpar_planejamento_entregas() returns void
language plpgsql security invoker set search_path='' as $$
begin
  delete from public.entrega_rotas_cache where valido_ate<=now();
  update public.entrega_viagens set geometria=null,geometria_ate=null where geometria_ate<=now() and geometria is not null;
  update public.entrega_rotas_planos set estado=case when estado='aberto' then 'vencido' else estado end,
    dados=dados-'pedidos'-'geometria' where valido_ate<=now() and (dados ? 'pedidos' or dados ? 'geometria');
  update public.entrega_rotas_execucoes set estado='erro',erro='execucao_interrompida',entrada='{}'
    where estado='calculando' and criado_em<now()-interval '2 minutes';
  delete from public.entrega_rotas_execucoes where criado_em<now()-interval '7 days';
end $$;
revoke all on function public.limpar_planejamento_entregas() from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('mineiro-planejar-entregas','* * * * *','select public.disparar_planejador_entregas();');
    perform cron.schedule('mineiro-limpar-planejamento','25 * * * *','select public.limpar_planejamento_entregas();');
    update public.entrega_rotas_config set cron_ativo=true where id=1;
  end if;
end $$;

create index if not exists entrega_rotas_config_autor on public.entrega_rotas_config(alterado_por);
create index if not exists entregadores_disponibilidade_autor on public.entregadores_disponibilidade(autor);
create index if not exists entrega_rotas_execucoes_autor on public.entrega_rotas_execucoes(autor);
create index if not exists entrega_rotas_planos_motoboy on public.entrega_rotas_planos(motoboy_id);
create index if not exists entrega_viagens_motoboy on public.entrega_viagens(motoboy_id);
create index if not exists entrega_viagens_criada_por on public.entrega_viagens(criada_por);
create index if not exists entrega_viagens_encerrada_por on public.entrega_viagens(encerrada_por);
create index if not exists entrega_viagens_paradas_pedido on public.entrega_viagens_paradas(pedido_id);
create index if not exists entrega_rotas_eventos_autor on public.entrega_rotas_eventos(autor);
notify pgrst,'reload schema';

-- ============ supabase/migrations/20261020145407_pagamentos_permissoes_backend.sql ============

-- Helpers financeiros são SECURITY INVOKER: BYPASSRLS não concede privilégios SQL.
-- O ambiente Supabase remoto pode não conceder DML a service_role por padrão.
-- Sem ampliar os privilégios de anon/authenticated nem liberar edição do status operacional.
grant select on public.pedidos,public.loja,public.equipe to service_role;
grant update(pagamento_online,pagamento_em) on public.pedidos to service_role;
notify pgrst,'reload schema';

-- ============ supabase/migrations/20261020203000_gestao_produtos.sql ============

-- Catálogo persistente; alterações do painel sobrevivem ao seed e a novos deploys.
create table if not exists public.categorias_produtos (
  id text primary key check(id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  label text not null check(char_length(label) between 1 and 80),
  icone text not null default 'burger',
  descricao text not null default '',
  ordem int not null default 0
);
alter table public.categorias_produtos enable row level security;
revoke all on public.categorias_produtos from public,anon,authenticated;
grant select on public.categorias_produtos to anon,authenticated;
grant all on public.categorias_produtos to service_role;
drop policy if exists categorias_produtos_leitura on public.categorias_produtos;
create policy categorias_produtos_leitura on public.categorias_produtos for select to anon,authenticated using(true);
alter table public.produtos add column if not exists detalhes jsonb not null default '{}';
alter table public.produtos add column if not exists editado_painel boolean not null default false;
alter table public.produtos add column if not exists atualizado_em timestamptz not null default now();
insert into public.categorias_produtos(id,label,icone,descricao,ordem)
select id,label,icone,"desc",ordem from jsonb_to_recordset('[{"id":"testes","label":"Teste de pagamento","icone":"sacola","desc":"Item temporário para validar o pagamento online","ordem":0},{"id":"artesanais","label":"Artesanais","icone":"burger","desc":"Hambúrguer artesanal de 200 g","ordem":1},{"id":"tradicionais","label":"Tradicionais","icone":"burger","desc":"Os clássicos da chapa","ordem":2},{"id":"hotdog","label":"Hot dog","icone":"hotdog","desc":"Salsicha Perdigão · Dog Bacon ou Dog Pizza: qualquer dog com o adicional Bacon ou Pizza","ordem":3},{"id":"baguetes","label":"Baguetes","icone":"baguete","desc":"Na baguete, do jeito mineiro","ordem":4},{"id":"combos","label":"Combos","icone":"combo","desc":"Lanche, batata e bebida","ordem":5},{"id":"porcoes","label":"Porções","icone":"batata","desc":"Pra dividir","ordem":6},{"id":"bebidas","label":"Bebidas","icone":"lata","desc":"Geladas","ordem":7}]'::jsonb) as c(id text,label text,icone text,"desc" text,ordem int)
on conflict(id) do nothing;
update public.produtos p set detalhes=d.detalhes from jsonb_to_recordset('[{"id":"teste-pagamento","detalhes":{"base":"Somente validação do pagamento. Não é um alimento. Selecione retirada no local.","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-burger","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-burger-bacon","detalhes":{"base":"Gran Burger com bacon","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-salada","detalhes":{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-egg","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-bacon","detalhes":{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-egg-bacon","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-big-tudo","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-black","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-big-mineiro","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-chicken","detalhes":{"base":"Pão de brioche e hambúrguer de frango empanado","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-bacon-onion","detalhes":{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-crispy","detalhes":{"base":"Pão de brioche e hambúrguer 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-burguer","detalhes":{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-salada","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"mega-x-salada-egg","detalhes":{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"ultra-x-salada-bacon","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"exagerado-x-salada-egg-bacon","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"big-tudo","detalhes":{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"black-master","detalhes":{"base":"Pão australiano e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"big-mineiro","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-medio","detalhes":{"base":"Pão médio e 1 salsicha Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-medio-frango","detalhes":{"base":"Pão e 1 salsicha","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-max","detalhes":{"base":"Pão médio e 2 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-max-frango","detalhes":{"base":"Pão e 2 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-super","detalhes":{"base":"Pão médio e 3 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-super-frango","detalhes":{"base":"Pão e 3 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-doritos","detalhes":{"base":"O hot dog com Doritos da casa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-pizza","detalhes":{"base":"Hot Dog Super (3 salsichas Perdigão) com o adicional Pizza","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-cbo-turbo","detalhes":{"base":"Pão de dog e 3 salsichas Perdigão","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"carne-maluca","detalhes":{"base":"Baguete e carne desfiada","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-frango","detalhes":{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-frango-egg-bacon","detalhes":{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-calabresa","detalhes":{"base":"Baguete e calabresa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-churrasco","detalhes":{"base":"Pão de baguete e contra-filé","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"americano","detalhes":{"base":"Baguete","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"combo-diluvio","detalhes":{"base":"","nota":"Pergunte pelo WhatsApp quantos lanches vêm.","inclui":["Gran Burgers na piscininha de cheddar","Farofinha de bacon","140 g de batata frita","Refrigerante lata 350 ml (qualquer um)"],"sabor":false,"escolheRefri":true}},{"id":"combo-casal","detalhes":{"base":"","nota":"Na foto: 2 lanches e batata com calabresa, cheddar, maionese e cebola crispy. Pergunte pelo WhatsApp quais lanches vêm.","inclui":["2 lanches","Porção de batata"],"sabor":false,"escolheRefri":false}},{"id":"gran-bacon-coca-maionese","detalhes":{"base":"","nota":"","inclui":["Gran Bacon","Coca-Cola 350 ml","Maionese artesanal da casa"],"sabor":false,"escolheRefri":false}},{"id":"combo-2-dog-doritos","detalhes":{"base":"","nota":"","inclui":["2 Hot Dog com Doritos","Coca-Cola 600 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-burger","detalhes":{"base":"","nota":"","inclui":["Gran Burger (brioche, 200 g de carne angus, mussarela, cheddar, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-bacon","detalhes":{"base":"","nota":"","inclui":["Gran Bacon (brioche, 200 g de carne angus, mussarela, cheddar, bacon, maionese, barbecue, alface americano e tomate)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-salada","detalhes":{"base":"","nota":"","inclui":["Gran Salada (brioche, 200 g de carne angus, mussarela, cheddar, alface americano, tomate, cebola roxa, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-bacon-onion","detalhes":{"base":"","nota":"","inclui":["Gran Bacon Onion (angus 200 g, maionese grill, barbecue, cheddar cremoso, bacon em fatias, 2 onion rings, alface americana, tomate em rodelas e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-hot-dog-max","detalhes":{"base":"","nota":"","inclui":["Hot dog médio com 2 salsichas, alface, purê, batata palha, ketchup, cheddar e catupiry","250 g de batata frita","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-x-frango","detalhes":{"base":"","nota":"","inclui":["X-Frango na baguete (filé de frango, mussarela, maionese, barbecue, vinagrete, purê, batata palha, cheddar e catupiry)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-chicken","detalhes":{"base":"","nota":"","inclui":["Gran Chicken (brioche, frango empanado, maionese, barbecue, alface americano, tomate e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"porcao-batata","detalhes":{"base":"","nota":"","inclui":["500 g de batata frita","Cheddar cremoso","Bacon","Requeijão","Calabresa","Alho-poró"],"sabor":false,"escolheRefri":false}},{"id":"porcao-onion","detalhes":{"base":"","nota":"","inclui":["6 onion rings"],"sabor":false,"escolheRefri":false}},{"id":"refri-lata","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"refri-600","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"refri-1l","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"refri-dolly","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"suco-lata","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"suco-1l","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"agua","detalhes":{"base":"","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"h2o","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}}]'::jsonb) as d(id text,detalhes jsonb) where p.id=d.id and not p.editado_painel and p.detalhes='{}'::jsonb;
-- Categorias legadas desconhecidas também permanecem visíveis.
insert into public.categorias_produtos(id,label,ordem)
select distinct categoria,categoria,100 from public.produtos on conflict(id) do nothing;

create table if not exists public.produtos_eventos (
  id bigint generated always as identity primary key,
  produto_id text not null references public.produtos(id),
  autor uuid not null,
  antes jsonb,
  depois jsonb not null,
  criado_em timestamptz not null default now()
);
alter table public.produtos_eventos enable row level security;
revoke all on public.produtos_eventos from public,anon,authenticated;
grant select on public.produtos_eventos to authenticated;
grant all on public.produtos_eventos to service_role;
grant usage,select on sequence public.produtos_eventos_id_seq to service_role;
drop policy if exists produtos_eventos_equipe on public.produtos_eventos;
create policy produtos_eventos_equipe on public.produtos_eventos for select to authenticated using((select public.is_equipe()));

create or replace function public.catalogo_json()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'categorias',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'icone',c.icone,'desc',c.descricao) order by c.ordem,c.id) from public.categorias_produtos c),'[]'::jsonb),
  'produtos',coalesce((select jsonb_agg(to_jsonb(p) order by p.ordem,p.id) from public.produtos p),'[]'::jsonb)
)
$$;
revoke all on function public.catalogo_json() from public,anon,authenticated;
grant execute on function public.catalogo_json() to anon,authenticated,service_role;

-- Mantém o contrato anterior (preços, esgotados, loja), acrescentando o catálogo completo.
create or replace function public.estado_cardapio()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with d as(select public.dia_operacional(now()) as dia)
select jsonb_build_object(
 'diaOperacional',to_char(d.dia,'YYYY-MM-DD'),
 'esgotados',coalesce((select jsonb_agg(p.id order by p.ordem,p.id) from public.produtos p where p.esgotado_dia=d.dia),'[]'::jsonb),
 'inativos',coalesce((select jsonb_agg(p.id order by p.ordem,p.id) from public.produtos p where not p.ativo),'[]'::jsonb),
 'precos',coalesce((select jsonb_object_agg(p.id,p.preco) from public.produtos p),'{}'::jsonb),
 'adicionais',coalesce((select jsonb_object_agg(a.id,a.preco) from public.adicionais a where a.ativo),'{}'::jsonb),
 'catalogo',public.catalogo_json(),'loja',public.loja_json()) from d
$$;

create or replace function public.salvar_produto(p_dados jsonb,p_versao timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare anterior public.produtos; novo public.produtos; ident text; valor numeric; det jsonb; foto_val text;
begin
 if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
 if p_dados is null or jsonb_typeof(p_dados)<>'object' or octet_length(p_dados::text)>30000 then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 ident:=p_dados->>'id';
 if ident is null or ident !~ '^[a-z0-9][a-z0-9-]{0,59}$' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('produto:'||ident,0));
 select * into anterior from public.produtos where id=ident for update;
 if (anterior.id is not null and (p_versao is null or p_versao<>anterior.atualizado_em)) or (anterior.id is null and p_versao is not null) then
   raise exception 'produto_alterado' using errcode='P0001';
 end if;
 if jsonb_typeof(p_dados->'nome') is distinct from 'string' or char_length(btrim(p_dados->>'nome')) not between 1 and 120
   or not exists(select 1 from public.categorias_produtos where id=p_dados->>'categoria')
   or coalesce(p_dados->>'tipo','') not in ('lanche','combo','porcao','bebida')
   or jsonb_typeof(p_dados->'ativo') is distinct from 'boolean'
   or jsonb_typeof(p_dados->'ingredientes') is distinct from 'array'
   or jsonb_typeof(p_dados->'detalhes') is distinct from 'object'
   or jsonb_typeof(p_dados->'ordem') is distinct from 'number' then
   raise exception 'dados_invalidos' using errcode='P0001';
 end if;
 if not (p_dados ? 'preco') or jsonb_typeof(p_dados->'preco') not in ('null','number') then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 valor:=(p_dados->>'preco')::numeric;
 if valor<0 or valor>99999.99 or valor<>round(valor,2) or (p_dados->>'ordem')::numeric not between 0 and 100000
   or (p_dados->>'ordem')::numeric<>trunc((p_dados->>'ordem')::numeric) then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 foto_val:=nullif(p_dados->>'foto','');
 if foto_val is not null then
   if foto_val ~ '^uploads/[a-f0-9-]{36}\.webp$' then
     -- Upload precisa existir; arquivos imutáveis preservam fotos de outros produtos.
     if to_regclass('storage.objects') is not null then
       if not exists(select 1 from storage.objects where bucket_id='produtos-fotos' and name=foto_val) then raise exception 'foto_invalida' using errcode='P0001'; end if;
     end if;
   elsif foto_val !~ '^[a-z0-9][a-z0-9-]{0,59}$' or (foto_val is distinct from anterior.foto and not exists(select 1 from public.produtos where foto=foto_val)) then
     raise exception 'foto_invalida' using errcode='P0001';
   end if;
 end if;
 det:=p_dados->'detalhes';
 if jsonb_typeof(det->'base') is distinct from 'string' or char_length(det->>'base')>500
   or jsonb_typeof(det->'nota') is distinct from 'string' or char_length(det->>'nota')>500
   or jsonb_typeof(det->'inclui') is distinct from 'array'
   or jsonb_typeof(det->'sabor') is distinct from 'boolean'
   or jsonb_typeof(det->'escolheRefri') is distinct from 'boolean' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 if jsonb_array_length(p_dados->'ingredientes')>40 or jsonb_array_length(det->'inclui')>40 or exists(
   select 1 from jsonb_array_elements((p_dados->'ingredientes')||(det->'inclui')) a(v)
   where jsonb_typeof(v)<>'string' or char_length(btrim(v#>>'{}')) not between 1 and 200
 ) then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 -- Ignora qualquer chave extra: o cliente não consegue alterar campos operacionais.
 det:=jsonb_build_object('base',btrim(det->>'base'),'nota',btrim(det->>'nota'),'inclui',det->'inclui','sabor',det->'sabor','escolheRefri',det->'escolheRefri');
 insert into public.produtos(id,categoria,nome,preco,tipo,foto,ingredientes,ordem,ativo,detalhes,editado_painel,atualizado_em)
 values(ident,p_dados->>'categoria',btrim(p_dados->>'nome'),valor,p_dados->>'tipo',foto_val,
   array(select jsonb_array_elements_text(p_dados->'ingredientes')),(p_dados->>'ordem')::int,(p_dados->>'ativo')::boolean,det,true,clock_timestamp())
 on conflict(id) do update set categoria=excluded.categoria,nome=excluded.nome,preco=excluded.preco,tipo=excluded.tipo,foto=excluded.foto,
   ingredientes=excluded.ingredientes,ordem=excluded.ordem,ativo=excluded.ativo,detalhes=excluded.detalhes,editado_painel=true,atualizado_em=excluded.atualizado_em
 returning * into novo;
 insert into public.produtos_eventos(produto_id,autor,antes,depois) values(ident,auth.uid(),case when anterior.id is null then null else to_jsonb(anterior) end,to_jsonb(novo));
 return to_jsonb(novo);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'dados_invalidos' using errcode='P0001';
end $$;
revoke all on function public.salvar_produto(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.salvar_produto(jsonb,timestamptz) to authenticated;

-- Storage existe no Supabase hospedado. O Postgres local de testes não instala esse serviço.
do $storage$
begin
 if to_regclass('storage.buckets') is not null then
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('produtos-fotos','produtos-fotos',true,2097152,array['image/webp']) on conflict(id) do nothing;
   execute 'drop policy if exists produtos_fotos_inserir on storage.objects';
   execute $policy$create policy produtos_fotos_inserir on storage.objects for insert to authenticated
    with check(bucket_id='produtos-fotos' and (select public.is_equipe()) and name ~ '^uploads/[a-f0-9-]{36}\.webp$')$policy$;
   execute 'drop policy if exists produtos_fotos_equipe_leitura on storage.objects';
   execute $policy$create policy produtos_fotos_equipe_leitura on storage.objects for select to authenticated
    using(bucket_id='produtos-fotos' and (select public.is_equipe()))$policy$;
   execute 'drop policy if exists produtos_fotos_limpar on storage.objects';
   execute $policy$create policy produtos_fotos_limpar on storage.objects for delete to authenticated
    using(bucket_id='produtos-fotos' and (select public.is_equipe()) and not exists(select 1 from public.produtos p where p.foto=name))$policy$;
 end if;
end $storage$;
notify pgrst,'reload schema';

create or replace function public.atualizar_versao_produto()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin new.atualizado_em:=clock_timestamp(); return new; end $$;
revoke all on function public.atualizar_versao_produto() from public,anon,authenticated;
drop trigger if exists produtos_versao on public.produtos;
create trigger produtos_versao before update on public.produtos for each row execute function public.atualizar_versao_produto();

-- ============ supabase/migrations/20261020213000_estoque_categoria.sql ============

-- Mantém o controle em lote por categoria na nova tela de produtos, em uma só transação.
create or replace function public.marcar_categoria_esgotada(p_categoria text,p_esgotado boolean)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare quantidade integer;
begin
 if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
 if p_categoria is null or p_esgotado is null or not exists(select 1 from public.categorias_produtos where id=p_categoria) then
   raise exception 'dados_invalidos' using errcode='P0001';
 end if;
 update public.produtos set esgotado_dia=case when p_esgotado then public.dia_operacional(now()) end
 where categoria=p_categoria and ativo;
 get diagnostics quantidade=row_count;
 return quantidade;
end $$;
revoke all on function public.marcar_categoria_esgotada(text,boolean) from public,anon,authenticated;
grant execute on function public.marcar_categoria_esgotada(text,boolean) to authenticated;
notify pgrst,'reload schema';

-- ============ supabase/migrations/20261021001305_pagamento_na_entrega.sql ============

-- Pagamento na entrega é a receber, nunca uma aprovação fictícia do Mercado Pago.
alter table public.pedidos add column if not exists pagamento_na_entrega boolean not null default false;
alter table public.pedidos add column if not exists pagamento_entrega_recebido_em timestamptz;
alter table public.pedidos add column if not exists pagamento_entrega_convertendo boolean not null default false;
create or replace function public.proteger_pagamento_pedido()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.pagamento_online:=null;
    new.pagamento_em:=null;
    new.pagamento_na_entrega:=new.origem<>'exemplo' and coalesce(new.pagamento='Pagamento na entrega',false);
    new.pagamento_entrega_recebido_em:=null;
    new.pagamento_entrega_convertendo:=false;
    if new.origem<>'exemplo' and (select pagamentos_ativos from public.loja where id=1) then
      if new.total<=0 or (new.modo='entrega' and new.taxa_entrega is null) then
        raise exception 'pagamento_valor_invalido' using errcode='P0001';
      end if;
      if not new.pagamento_na_entrega then
      new.pagamento_online:='pendente';
      new.pagamento:='Mercado Pago';
      new.troco:='';
      end if;
    end if;
  else
    if new.pagamento_na_entrega and new.pagamento_online in ('pendente','recusado','cancelado') then new.pagamento_online:=null; end if;
  if new.status is distinct from old.status and new.status not in ('novo','cancelado')
    and old.pagamento_online is not null and new.pagamento_online is distinct from 'aprovado' then
    raise exception 'pagamento_pendente' using errcode='P0001';
  end if;
  end if;
  return new;
end $$;
revoke all on function public.proteger_pagamento_pedido() from public,anon,authenticated;
drop trigger if exists pedidos_proteger_pagamento on public.pedidos;
create trigger pedidos_proteger_pagamento before insert or update on public.pedidos
for each row execute function public.proteger_pagamento_pedido();


do $$ begin
 if to_regprocedure('public.preparar_pagamento_mp_online(uuid,text,boolean)') is null then
 alter function public.preparar_pagamento_mp(uuid,text,boolean) rename to preparar_pagamento_mp_online;
 end if;
end $$;
create or replace function public.preparar_pagamento_mp(p_token uuid,p_email text default null,p_iniciar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.pedidos;
begin
 select * into p from public.pedidos where token=p_token for update;
 if not found then raise exception 'nao_encontrado'; end if;
 if p.pagamento_na_entrega or p.pagamento_entrega_convertendo then
   if p_iniciar then raise exception 'pagamento_encerrado'; end if;
   return jsonb_build_object('estado',case when p.pagamento_entrega_convertendo then 'alterando' else 'na_entrega' end,'pedido_status',p.status);
 end if;
 return public.preparar_pagamento_mp_online(p_token,p_email,p_iniciar);
end $$;
revoke all on function public.preparar_pagamento_mp(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.preparar_pagamento_mp(uuid,text,boolean) to service_role;

create or replace function public.autorizar_pagamento_entrega_mp(p_autor uuid,p_id uuid,p_finalizar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.pedidos; m public.pagamentos_mp;
begin
 if not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
 select * into p from public.pedidos where id=p_id for update;
 if not found then raise exception 'nao_encontrado'; end if;
 if p.status in ('cancelado','entregue') or p.pagamento_online in ('aprovado','reembolsado','parcialmente_reembolsado','em_disputa') then raise exception 'pagamento_encerrado'; end if;
 if p.pagamento_na_entrega then return jsonb_build_object('naEntrega',true); end if;
 select * into m from public.pagamentos_mp where pedido_id=p_id for update;
 if m.criando_ate>now() then raise exception 'pagamento_em_criacao'; end if;
 if m.estado in ('aprovado','reembolsado','parcialmente_reembolsado','em_disputa') then raise exception 'pagamento_encerrado'; end if;
 if p_finalizar then
   if m.order_id is not null and m.estado<>'cancelado' then raise exception 'pagamento_online_ativo'; end if;
   update public.pedidos set pagamento_na_entrega=true,pagamento='Pagamento na entrega',pagamento_online=null,
     pagamento_em=clock_timestamp(),pagamento_entrega_convertendo=false,
     historico=historico||jsonb_build_array(jsonb_build_object('status',status,'em',public.data_iso(now()),'autor',p_autor,'evento','pagamento_na_entrega','motivo','Pagamento alterado para receber na entrega; checkout online encerrado.')) where id=p_id;
   return jsonb_build_object('naEntrega',true);
 end if;
 update public.pedidos set pagamento_entrega_convertendo=true where id=p_id;
 return case when m.id is null then jsonb_build_object('semCheckout',true) else to_jsonb(m) end;
end $$;
revoke all on function public.autorizar_pagamento_entrega_mp(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.autorizar_pagamento_entrega_mp(uuid,uuid,boolean) to service_role;

create or replace function public.confirmar_pagamento_entrega(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.pedidos;
begin
 if not public.is_equipe() then raise exception 'sem_permissao'; end if;
 select * into p from public.pedidos where id=p_id for update;
 if not found then raise exception 'nao_encontrado'; end if;
 if not p.pagamento_na_entrega or p.status='cancelado' or p.pagamento_online is not null then raise exception 'pagamento_encerrado'; end if;
 if p.pagamento_entrega_recebido_em is null then
 update public.pedidos set pagamento_entrega_recebido_em=clock_timestamp(),pagamento_em=clock_timestamp(),
 historico=historico||jsonb_build_array(jsonb_build_object('status',status,'em',public.data_iso(now()),'autor',auth.uid(),'evento','pagamento_recebido','motivo','Equipe confirmou o recebimento do pagamento na entrega.')) where id=p_id returning * into p;
 end if;
 return public.pedido_json(p);
end $$;
revoke all on function public.confirmar_pagamento_entrega(uuid) from public,anon,authenticated;
grant execute on function public.confirmar_pagamento_entrega(uuid) to authenticated;

do $$ begin if to_regprocedure('public.pedido_json_sem_entrega(public.pedidos)') is null then alter function public.pedido_json(public.pedidos) rename to pedido_json_sem_entrega; end if; end $$;
create or replace function public.pedido_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.pedido_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em)
$$;
revoke all on function public.pedido_json(public.pedidos) from public;
grant execute on function public.pedido_json(public.pedidos) to anon,authenticated,service_role;

do $$ begin if to_regprocedure('public.entrega_json_sem_entrega(public.pedidos)') is null then alter function public.entrega_json(public.pedidos) rename to entrega_json_sem_entrega; end if; end $$;
create or replace function public.entrega_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.entrega_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em)
$$;
revoke all on function public.entrega_json(public.pedidos) from public;
grant execute on function public.entrega_json(public.pedidos) to anon,authenticated,service_role;

do $$ begin if to_regprocedure('public.acompanhar_pedido_sem_entrega(uuid)') is null then alter function public.acompanhar_pedido(uuid) rename to acompanhar_pedido_sem_entrega; end if; end $$;
create or replace function public.acompanhar_pedido(p_token uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select public.acompanhar_pedido_sem_entrega(p_token) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em) from public.pedidos p where p.token=p_token
$$;
revoke all on function public.acompanhar_pedido(uuid) from public;
grant execute on function public.acompanhar_pedido(uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';
create or replace function public.liberar_reserva_pagamento_entrega_mp(p_autor uuid,p_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
 update public.pedidos set pagamento_entrega_convertendo=false where id=p_id and not pagamento_na_entrega;
end $$;
revoke all on function public.liberar_reserva_pagamento_entrega_mp(uuid,uuid) from public,anon,authenticated;
grant execute on function public.liberar_reserva_pagamento_entrega_mp(uuid,uuid) to service_role;

-- ============ supabase/migrations/20261021001941_sinalizacao_pagamento_entrega_motoboy.sql ============

-- Inclui o estado online para não orientar cobrança local de um pedido já pago.
create or replace function public.entrega_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.entrega_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em)
$$;
revoke all on function public.entrega_json(public.pedidos) from public;
grant execute on function public.entrega_json(public.pedidos) to anon,authenticated,service_role;
notify pgrst,'reload schema';

-- ============ supabase/migrations/20261021003931_email_opcional_e_troco.sql ============

-- E-mail opcional na abertura do checkout; vazio significa não informado, sem identidade fictícia.
create or replace function public.preparar_pagamento_mp_online(p_token uuid,p_email text default null,p_iniciar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_p public.pedidos; v_m public.pagamentos_mp; v_criar boolean:=false; v_consultar boolean:=false;
begin
  select * into v_p from public.pedidos where token=p_token for update;
  if not found or v_p.pagamento_online is null then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where pedido_id=v_p.id for update;
  if v_m.id is null and p_iniciar then
    if v_p.status<>'novo' or v_p.pagamento_online<>'pendente' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
    p_email:=nullif(btrim(p_email),'');
    if p_email is not null and (char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'email_invalido' using errcode='P0001';
    end if;
    insert into public.pagamentos_mp(pedido_id,email,total) values(v_p.id,coalesce(lower(p_email),''),v_p.total) returning * into v_m;
  end if;
  if v_m.id is null then return jsonb_build_object('estado',v_p.pagamento_online,'pedido_status',v_p.status); end if;
  if p_iniciar and v_p.status='cancelado' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
  if v_m.order_id is null and p_iniciar and coalesce(v_m.criando_ate,'-infinity')<now() then
    update public.pagamentos_mp set criando_ate=now()+interval '30 seconds' where id=v_m.id returning * into v_m;
    v_criar:=true;
  end if;
  if v_m.order_id is not null and coalesce(v_m.ultima_consulta,'-infinity')<now()-interval '8 seconds' then
    update public.pagamentos_mp set ultima_consulta=now() where id=v_m.id;
    v_consultar:=true;
  end if;
  return to_jsonb(v_m)||jsonb_build_object('token',v_p.token,'numero',v_p.numero,'itens',v_p.itens,'taxaEntrega',v_p.taxa_entrega,'pedido_status',v_p.status,'criar',v_criar,'consultar',v_consultar);
end $$;

revoke all on function public.preparar_pagamento_mp_online(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.preparar_pagamento_mp_online(uuid,text,boolean) to service_role;

-- A forma e o troco usam os campos existentes, preservando pedidos e clientes anteriores.
create or replace function public.proteger_pagamento_pedido()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.pagamento_online:=null;
    new.pagamento_em:=null;
    new.pagamento_na_entrega:=new.origem<>'exemplo' and coalesce(new.pagamento in ('Pagamento na entrega','Dinheiro na entrega','Dinheiro na retirada','Cartão na entrega','Cartão na retirada','Pix na entrega','Pix na retirada'),false);
    new.pagamento_entrega_recebido_em:=null;
    new.pagamento_entrega_convertendo:=false;
    if new.origem<>'exemplo' and (select pagamentos_ativos from public.loja where id=1) then
      if new.total<=0 or (new.modo='entrega' and new.taxa_entrega is null) then
        raise exception 'pagamento_valor_invalido' using errcode='P0001';
      end if;
      if not new.pagamento_na_entrega then
      new.pagamento_online:='pendente';
      new.pagamento:='Mercado Pago';
      new.troco:='';
      end if;
    end if;
  else
    if new.pagamento_na_entrega and new.pagamento_online in ('pendente','recusado','cancelado') then new.pagamento_online:=null; end if;
  if new.status is distinct from old.status and new.status not in ('novo','cancelado')
    and old.pagamento_online is not null and new.pagamento_online is distinct from 'aprovado' then
    raise exception 'pagamento_pendente' using errcode='P0001';
  end if;
  end if;
  if new.pagamento_na_entrega and new.pagamento in ('Dinheiro na entrega','Dinheiro na retirada') then
    if tg_op='INSERT' or new.pagamento is distinct from old.pagamento or new.troco is distinct from old.troco then
      if new.troco is null or new.troco='' then raise exception 'troco_necessario' using errcode='P0001'; end if;
      if new.troco<>'Sem troco' then
        if new.troco !~ '^[0-9]{1,7},[0-9]{2}$' then raise exception 'troco_invalido' using errcode='P0001'; end if;
        if replace(new.troco,',','.')::numeric<=new.total then raise exception 'troco_invalido' using errcode='P0001'; end if;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.proteger_pagamento_pedido() from public,anon,authenticated;
drop trigger if exists pedidos_proteger_pagamento on public.pedidos;
create trigger pedidos_proteger_pagamento before insert or update on public.pedidos
for each row execute function public.proteger_pagamento_pedido();

create or replace function public.entrega_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.entrega_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em,'pagamento',p.pagamento,'troco',p.troco)
$$;
revoke all on function public.entrega_json(public.pedidos) from public;
grant execute on function public.entrega_json(public.pedidos) to anon,authenticated,service_role;

create or replace function public.acompanhar_pedido(p_token uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select public.acompanhar_pedido_sem_entrega(p_token) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em,'pagamento',p.pagamento,'troco',p.troco) from public.pedidos p where p.token=p_token
$$;
revoke all on function public.acompanhar_pedido(uuid) from public;
grant execute on function public.acompanhar_pedido(uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';

-- ============ supabase/migrations/20261022193306_despacho_automatico_individual.sql ============

-- Despacho individual sem mapas no mesmo ciclo de viagens. Instala desligado.
-- Não altera preços, pagamentos, taxas, pedidos históricos ou presença dos usuários.
alter table public.entrega_rotas_config
  add column if not exists despacho_individual_ativo boolean not null default false,
  add column if not exists despacho_ativado_em timestamptz,
  add column if not exists janela_agrupamento_seg integer not null default 0 check(janela_agrupamento_seg between 0 and 120),
  add column if not exists prazo_reserva_seg integer not null default 300 check(prazo_reserva_seg between 60 and 1800);
alter table public.entrega_viagens
  add column if not exists tipo_despacho text not null default 'rotas' check(tipo_despacho in ('rotas','individual')),
  add column if not exists reserva_ate timestamptz,
  alter column segundos drop not null,
  alter column metros drop not null,
  alter column ultima_entrega_seg drop not null;
alter table public.entrega_viagens_paradas alter column chegada_seg drop not null;
alter table public.entrega_viagens drop constraint if exists entrega_viagens_metricas_por_tipo;
alter table public.entrega_viagens add constraint entrega_viagens_metricas_por_tipo check (
  (tipo_despacho='rotas' and segundos is not null and metros is not null and ultima_entrega_seg is not null)
  or (tipo_despacho='individual' and segundos is null and metros is null and ultima_entrega_seg is null and geometria is null and reserva_ate is not null));
create index if not exists entrega_viagens_reserva_prazo on public.entrega_viagens(reserva_ate)
  where tipo_despacho='individual' and estado='reservada';

create or replace function public.rotas_config_json() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('modo',c.modo,'despachoIndividualAtivo',c.despacho_individual_ativo,'despachoAtivadoEm',c.despacho_ativado_em,
    'janelaAgrupamentoSeg',c.janela_agrupamento_seg,'prazoReservaSeg',c.prazo_reserva_seg,'regras',c.regras,'versao',c.versao,'limiteCreditosDia',c.limite_creditos_dia,
    'automacaoDisponivel',c.cron_ativo and c.job_url is not null,'origemConfirmada',l.entrega_origem ? 'confirmadaEm',
    'origem',l.entrega_origem,'configurada',public.rotas_regras_validas(c.regras))
  from public.entrega_rotas_config c cross join public.loja l where c.id=1 and l.id=1
$$;
revoke all on function public.rotas_config_json() from public,anon,authenticated;

create or replace function public.estado_entregador_rotas(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'declarado',coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) and (not cfg.despacho_individual_ativo or d.desde>=cfg.despacho_ativado_em) then d.situacao end,'fora'),
    'disponivelDesde',d.desde,'ultimaEm',c.ultima_em,'viagemId',v.id,
    'qtdAbertas',(select count(*) from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),
    'situacao',case when v.id is not null then v.estado else coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) and (not cfg.despacho_individual_ativo or d.desde>=cfg.despacho_ativado_em) then d.situacao end,'fora') end,
    'elegivel',coalesce(m.ativo and d.situacao='na_loja' and public.dia_operacional(d.desde)=public.dia_operacional(now()) and (not cfg.despacho_individual_ativo or d.desde>=cfg.despacho_ativado_em) and (cfg.despacho_individual_ativo or c.ultima_em>=now()-interval '2 minutes') and v.id is null and not exists(
      select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
      where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),false))
  from public.motoboys m cross join public.entrega_rotas_config cfg left join public.entregadores_disponibilidade d on d.user_id=m.user_id
    left join public.entregadores_comunicacao c on c.user_id=m.user_id
    left join public.entrega_viagens v on v.motoboy_id=m.user_id and v.estado in ('reservada','em_rota','retornando')
  where m.user_id=p_id and cfg.id=1
$$;
revoke all on function public.estado_entregador_rotas(uuid) from public,anon,authenticated;

create or replace function public.definir_disponibilidade_entregador(p_situacao text,p_motoboy uuid default null,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare alvo uuid:=coalesce(p_motoboy,auth.uid()); anterior public.entregadores_disponibilidade;
begin
  if not public.is_equipe() and (not public.is_motoboy() or alvo is distinct from auth.uid()) then raise exception 'sem_permissao'; end if;
  if alvo is null or p_situacao is null or p_situacao not in ('na_loja','pausado','fora') then raise exception 'dados_invalidos'; end if;
  if alvo is distinct from auth.uid() and (nullif(btrim(p_motivo),'') is null or length(p_motivo)>200) then raise exception 'motivo_obrigatorio'; end if;
  perform 1 from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if exists(select 1 from public.entrega_viagens where motoboy_id=alvo and estado in ('reservada','em_rota','retornando')) then
    raise exception 'entregador_em_viagem'; end if;
  if p_situacao='na_loja' and exists(select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
    where e.motoboy_id=alvo and e.encerramento is null and p.status in ('preparo','pronto','rota')) then raise exception 'entregas_pendentes'; end if;
  select * into anterior from public.entregadores_disponibilidade where user_id=alvo;
  if anterior.situacao is distinct from p_situacao or public.dia_operacional(anterior.desde) is distinct from public.dia_operacional(now())
    or exists(select 1 from public.entrega_rotas_config where id=1 and despacho_individual_ativo and (anterior.desde is null or anterior.desde<despacho_ativado_em)) then
    insert into public.entregadores_disponibilidade(user_id,situacao,autor,motivo) values(alvo,p_situacao,auth.uid(),nullif(btrim(p_motivo),''))
      on conflict(user_id) do update set situacao=excluded.situacao,desde=now(),autor=excluded.autor,motivo=excluded.motivo;
    insert into public.entrega_rotas_eventos(motoboy_id,autor,tipo,dados) values(alvo,auth.uid(),'disponibilidade',
      jsonb_build_object('situacao',p_situacao,'motivo',nullif(btrim(p_motivo),'')));
  end if;
  if alvo=auth.uid() then perform public.comunicar_entregador(); end if;
  if p_situacao='na_loja' then perform public.disparar_planejador_entregas(); end if;
  return public.estado_entregador_rotas(alvo);
end $$;
revoke all on function public.definir_disponibilidade_entregador(text,uuid,text) from public,anon;
grant execute on function public.definir_disponibilidade_entregador(text,uuid,text) to authenticated;

create or replace function public.configurar_despacho_entregas(p_ativo boolean,p_versao uuid,
  p_janela_agrupamento_seg integer default 0,p_prazo_reserva_seg integer default 300) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_ativo is null or p_janela_agrupamento_seg is null or p_janela_agrupamento_seg not between 0 and 120
    or p_prazo_reserva_seg is null or p_prazo_reserva_seg not between 60 and 1800 then raise exception 'dados_invalidos'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_versao is distinct from c.versao then raise exception 'versao_alterada'; end if;
  if p_ativo and (not c.cron_ativo or c.job_url is null
    or c.job_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/planejar-entregas$') then raise exception 'automacao_indisponivel'; end if;
  update public.entrega_rotas_config set despacho_individual_ativo=p_ativo,
    despacho_ativado_em=case when p_ativo and not c.despacho_individual_ativo then now() else despacho_ativado_em end,
    modo=case when p_ativo then 'desligado' else modo end,
    janela_agrupamento_seg=p_janela_agrupamento_seg,prazo_reserva_seg=p_prazo_reserva_seg,
    versao=gen_random_uuid(),alterado_em=now(),alterado_por=auth.uid() where id=1;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  insert into public.entrega_rotas_eventos(autor,tipo,dados) values(auth.uid(),'configuracao_despacho',
    jsonb_build_object('ativo',p_ativo,'janelaAgrupamentoSeg',p_janela_agrupamento_seg,'prazoReservaSeg',p_prazo_reserva_seg));
  perform public.disparar_planejador_entregas();
  return public.rotas_config_json();
end $$;
revoke all on function public.configurar_despacho_entregas(boolean,uuid,integer,integer) from public,anon;
grant execute on function public.configurar_despacho_entregas(boolean,uuid,integer,integer) to authenticated;

-- Executado apenas no job assíncrono. A ordem de travas acompanha reserva/saída:
-- configuração, pedidos em ordem, cadastro do motoboy, viagem.
create or replace function public.processar_despacho_individual() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; v public.entrega_viagens; candidato public.pedidos;
  alvo uuid; nome text; viagem uuid; atrib uuid; reservadas integer:=0; expiradas integer:=0; inicio timestamptz;
begin
  select * into c from public.entrega_rotas_config where id=1 for update;
  for v in select * from public.entrega_viagens where tipo_despacho='individual' and estado='reservada'
    and reserva_ate<=now() order by id loop
    perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id
      where s.viagem_id=v.id order by p.id for update of p;
    perform 1 from public.motoboys where user_id=v.motoboy_id for update;
    select * into v from public.entrega_viagens where id=v.id for update;
    if v.estado<>'reservada' or v.saiu_em is not null or v.reserva_ate>now() then continue; end if;
    if exists(select 1 from public.entrega_viagens_paradas s join public.entregas_operacao e on e.pedido_id=s.pedido_id
      where s.viagem_id=v.id and (e.saiu_em is not null or e.atribuicao<>s.atribuicao)) then continue; end if;
    insert into public.entregas_eventos(pedido_id,tipo,dados)
      select s.pedido_id,'reserva_expirada',jsonb_build_object('viagem',v.id,'motoboy',v.motoboy_id)
      from public.entrega_viagens_paradas s where s.viagem_id=v.id;
    delete from public.entregas_operacao e using public.entrega_viagens_paradas s
      where s.viagem_id=v.id and e.pedido_id=s.pedido_id and e.atribuicao=s.atribuicao
      and e.saiu_em is null and e.encerramento is null;
    update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
    update public.entrega_viagens set estado='cancelada',versao=gen_random_uuid(),carregada_versao=null,
      motivo='Reserva expirou antes da saída' where id=v.id;
    if v.motoboy_id is not null then
      insert into public.entregadores_disponibilidade(user_id,situacao,motivo)
        values(v.motoboy_id,'pausado','Reserva expirou antes da saída; confirme disponibilidade novamente')
        on conflict(user_id) do update set situacao='pausado',desde=now(),autor=null,motivo=excluded.motivo;
    end if;
    insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,tipo,dados)
      values(v.id,v.motoboy_id,'reserva_expirada',jsonb_build_object('carregada',v.carregada_versao is not null,'pausaEntregador',v.motoboy_id is not null));
    expiradas:=expiradas+1;
  end loop;
  if c.despacho_individual_ativo then
    inicio:=(public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
    for candidato in select p.* from public.pedidos p
      left join public.entregas_operacao e on e.pedido_id=p.id
      cross join lateral (select max((h->>'em')::timestamptz) pronto from jsonb_array_elements(p.historico) h where h->>'status'='pronto') h
      where p.modo='entrega' and p.status='pronto' and p.origem<>'exemplo' and h.pronto is not null
        and not p.entrega_planejamento_pausado and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
        and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      order by h.pronto,p.id limit 12 for update of p skip locked loop
      -- O cursor conserva seu snapshot. Releia o vínculo depois de obter a trava:
      -- uma atribuição manual de um pedido ainda não visitado pode ter ocorrido.
      if not exists(select 1 from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
        where p.id=candidato.id and p.status='pronto' and p.modo='entrega' and not p.entrega_planejamento_pausado
          and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
          and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)) then continue; end if;
      select m.user_id,m.nome into alvo,nome from public.motoboys m
        join public.entregadores_disponibilidade d on d.user_id=m.user_id
        where coalesce((public.estado_entregador_rotas(m.user_id)->>'elegivel')::boolean,false)
        order by d.desde,(public.taxas_entregador(m.user_id,inicio)->>'qtdConcluidas')::integer,m.user_id
        limit 1 for update of m skip locked;
      if not found then exit; end if;
      if not coalesce((public.estado_entregador_rotas(alvo)->>'elegivel')::boolean,false) then continue; end if;
      atrib:=gen_random_uuid();
      insert into public.entrega_viagens(motoboy_id,motoboy_nome,automatica,origem,regras,segundos,metros,ultima_entrega_seg,tipo_despacho,reserva_ate)
        values(alvo,nome,true,'{}',jsonb_build_object('maxPedidos',1),null,null,null,'individual',now()+make_interval(secs=>c.prazo_reserva_seg))
        returning id into viagem;
      insert into public.entregas_operacao(pedido_id,atribuicao,motoboy_id,motoboy_nome)
        values(candidato.id,atrib,alvo,nome) on conflict(pedido_id) do update set atribuicao=excluded.atribuicao,
        motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,atribuido_em=now(),atribuido_por=null
        where public.entregas_operacao.motoboy_id is null and public.entregas_operacao.saiu_em is null
          and public.entregas_operacao.encerramento is null;
      if not found then raise exception 'pedido_alterado'; end if;
      insert into public.entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,chegada_seg)
        values(viagem,candidato.id,1,atrib,null);
      insert into public.entregas_eventos(pedido_id,tipo,dados) values(candidato.id,'atribuicao',
        jsonb_build_object('motoboy',alvo,'nome',nome,'viagem',viagem,'origem','despacho_individual_automatico'));
      insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,tipo,dados)
        values(viagem,alvo,'reserva',jsonb_build_object('tipoDespacho','individual','reservaAte',now()+make_interval(secs=>c.prazo_reserva_seg)));
      reservadas:=reservadas+1;
    end loop;
  end if;
  if reservadas+expiradas>0 then
    insert into public.entrega_rotas_execucoes(automatica,estado,entrada,creditos_reservados)
      values(true,'concluida',jsonb_build_object('tipoDespacho','individual','reservadas',reservadas,'expiradas',expiradas),0);
  end if;
  return jsonb_build_object('estado','concluida','tipoDespacho','individual','planos',0,'reservadas',reservadas,'expiradas',expiradas);
end $$;
revoke all on function public.processar_despacho_individual() from public,anon,authenticated;

create or replace function public.iniciar_planejamento_entregas(p_autor uuid,p_token text default null,
  p_pedidos jsonb default null,p_ordem_fixa boolean default false,p_verificar boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config; origem jsonb; pedidos jsonb; entregadores jsonb; entrada jsonb; cache_chave text;
  resultado jsonb; id_exec uuid; usados integer; custo integer; n integer; matriz jsonb; inicio timestamptz;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if p_autor is null then
    if p_token is null or p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
    if not coalesce(p_verificar,false) and c.modo<>'automatico' and not c.despacho_individual_ativo
      and not exists(select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada') then return jsonb_build_object('estado','desligado'); end if;
  elsif not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_autor is null and p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
  if p_autor is null and not coalesce(p_verificar,false) and c.modo<>'automatico' and not c.despacho_individual_ativo
      and not exists(select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada') then return jsonb_build_object('estado','desligado'); end if;
  if not coalesce(p_verificar,false) and (c.despacho_individual_ativo or exists(
    select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada')) then
    if p_pedidos is not null then raise exception 'dados_invalidos'; end if;
    resultado:=public.processar_despacho_individual();
    if c.despacho_individual_ativo or c.modo<>'automatico' then return resultado; end if;
  end if;
  if exists(select 1 from public.entrega_rotas_execucoes where estado='calculando' and criado_em>now()-interval '2 minutes') then
    return jsonb_build_object('estado','calculando'); end if;
  if exists(select 1 from public.entrega_rotas_execucoes where criado_em>now()-interval '5 seconds') then
    return jsonb_build_object('estado','aguarde'); end if;
  select entrega_origem into origem from public.loja where id=1;
  if not coalesce(p_verificar,false) and (c.modo='desligado' or not public.rotas_regras_validas(c.regras)) then raise exception 'configuracao_rotas_pendente'; end if;
  if not coalesce(p_verificar,false) and not (origem ? 'confirmadaEm') then raise exception 'origem_nao_confirmada'; end if;
  if p_pedidos is not null and (jsonb_typeof(p_pedidos)<>'array' or jsonb_array_length(p_pedidos) not between 1 and 6
    or (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_pedidos) x)) then raise exception 'dados_invalidos'; end if;
  inicio:=(public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select coalesce(jsonb_agg(e||jsonb_build_object('qtdConcluidas',public.taxas_entregador(m.user_id,inicio)->'qtdConcluidas') order by m.user_id),'[]')
    into entregadores from public.motoboys m cross join lateral (select public.estado_entregador_rotas(m.user_id) e) s
    where (e->>'elegivel')::boolean is true;
  select coalesce(jsonb_agg(x.dados order by x.ordem,x.pronto,x.id),'[]') into pedidos from (
    select p.id,h.pronto,case when p_pedidos is null then 0 else (select a.n::integer from jsonb_array_elements_text(p_pedidos) with ordinality a(v,n) where v=p.id::text) end as ordem,
      jsonb_build_object('id',p.id,'numero',p.numero,'ponto',p.entrega_destino,'pontoAte',p.entrega_destino_ate,
        'prontoEm',public.data_iso(h.pronto),'versao',md5(to_jsonb(p)::text)) as dados
    from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      cross join lateral (select max((x->>'em')::timestamptz) as pronto from jsonb_array_elements(p.historico) x where x->>'status'='pronto') h
    where p.modo='entrega' and p.origem<>'exemplo' and p.status='pronto' and h.pronto is not null
      and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
      and p.entrega_destino is not null and p.entrega_destino_ate>now()
      and (not p.entrega_planejamento_pausado or (p_pedidos is not null and p_autor is not null))
      and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      and (p_pedidos is null or p_pedidos ? p.id::text)
    order by ordem,h.pronto,p.id limit 12) x;
  n:=jsonb_array_length(pedidos);
  if not coalesce(p_verificar,false) then
    if p_pedidos is not null and n<>jsonb_array_length(p_pedidos) then raise exception 'pedido_alterado'; end if;
    if n=0 then return jsonb_build_object('estado','sem_pedidos'); end if;
    if jsonb_array_length(entregadores)=0 then return jsonb_build_object('estado','sem_entregador'); end if;
    -- Espera o mais antigo para reunir os pedidos já prontos, inclusive os recentes.
    -- A janela só vale para reserva automática com agrupamento por percurso.
    if p_autor is null and (c.regras->>'maxPedidos')::integer>1 and c.janela_agrupamento_seg>0
      and (select min((p->>'prontoEm')::timestamptz) from jsonb_array_elements(pedidos) p)
        >now()-make_interval(secs=>c.janela_agrupamento_seg) then
      return jsonb_build_object('estado','aguarde','motivo','janela_agrupamento');
    end if;
  end if;
  cache_chave:=case when not coalesce(p_verificar,false) then md5(jsonb_build_object('origem',origem,'pontos',
    (select jsonb_agg(x->'ponto' order by a.n) from jsonb_array_elements(pedidos) with ordinality a(x,n)),'modelo','drive-approximated-v1')::text) end;
  select x.matriz into matriz from public.entrega_rotas_cache x where x.chave=cache_chave and x.valido_ate>now();
  -- Reserva conservadora, por tentativa: orçamento interno estimado, não saldo da conta do provedor.
  custo:=case when coalesce(p_verificar,false) then 12 else (case when matriz is null then (n+1)*least(n+1,10) else 0 end)+4*n end;
  select coalesce(sum(creditos_reservados),0) into usados from public.entrega_rotas_execucoes where criado_em>=inicio;
  if usados+custo>c.limite_creditos_dia then raise exception 'orcamento_rotas_esgotado'; end if;
  entrada:=jsonb_build_object('origem',origem,'regras',c.regras,'configVersao',c.versao,'pedidos',pedidos,
    'entregadores',entregadores,'ordemFixa',coalesce(p_ordem_fixa,false),'cacheChave',cache_chave,'verificacao',coalesce(p_verificar,false),
    'agora',public.data_iso(now()));
  insert into public.entrega_rotas_execucoes(autor,automatica,entrada,creditos_reservados)
    values(p_autor,p_autor is null and not coalesce(p_verificar,false),entrada,custo) returning id into id_exec;
  return entrada||jsonb_build_object('id',id_exec,'estado','calcular','matriz',matriz);
end $$;
revoke all on function public.iniciar_planejamento_entregas(uuid,text,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.iniciar_planejamento_entregas(uuid,text,jsonb,boolean,boolean) to service_role;

create or replace function public.configurar_rotas(p_modo text,p_regras jsonb,p_limite integer default 1000,p_versao uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_modo is null or p_modo not in ('desligado','assistido','automatico') or p_limite is null or p_limite not between 20 and 100000
    or p_regras is null or (p_modo<>'desligado' and not public.rotas_regras_validas(p_regras)) then raise exception 'dados_invalidos'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_versao is distinct from c.versao then raise exception 'versao_alterada'; end if;
  if p_modo='automatico' and (not c.cron_ativo or c.job_url is null) then raise exception 'automacao_indisponivel'; end if;
  if p_modo<>'desligado' and not (select entrega_origem ? 'confirmadaEm' from public.loja where id=1) then raise exception 'origem_nao_confirmada'; end if;
  update public.entrega_rotas_config set modo=p_modo,regras=p_regras,limite_creditos_dia=p_limite,
    despacho_individual_ativo=case when p_modo<>'desligado' then false else despacho_individual_ativo end,
    versao=gen_random_uuid(),alterado_em=now(),alterado_por=auth.uid() where id=1;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  insert into public.entrega_rotas_eventos(autor,tipo,dados) values(auth.uid(),'configuracao',jsonb_build_object('modo',p_modo,'regras',p_regras));
  if p_modo='automatico' then perform public.disparar_planejador_entregas(); end if;
  return public.rotas_config_json();
end $$;
revoke all on function public.configurar_rotas(text,jsonb,integer,uuid) from public,anon;
grant execute on function public.configurar_rotas(text,jsonb,integer,uuid) to authenticated;

create or replace function public.viagem_entrega_json(v public.entrega_viagens) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',v.id,'motoboyId',v.motoboy_id,'motoboyNome',v.motoboy_nome,'versao',v.versao,'estado',v.estado,
    'tipoDespacho',v.tipo_despacho,'reservaAte',v.reserva_ate,'criadaEm',v.criada_em,'automatica',v.automatica,'carregadaVersao',v.carregada_versao,'carregadaEm',v.carregada_em,
    'revisaoPendente',v.revisao_pendente,'saiuEm',v.saiu_em,'origem',v.origem,
    'segundos',v.segundos,'metros',v.metros,'ultimaEntregaSeg',v.ultima_entrega_seg,
    'geometriaAte',v.geometria_ate,
    'geometria',case when v.geometria_ate>now() and not v.revisao_pendente then v.geometria end,
    'paradas',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,
      'endereco',p.endereco,'status',p.status,'ordem',s.ordem,'atribuicao',s.atribuicao,'chegadaSeg',s.chegada_seg,
      'ponto',case when p.entrega_destino_ate>now() then p.entrega_destino end,'pontoAte',p.entrega_destino_ate) order by s.ordem)
      from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id where s.viagem_id=v.id),'[]'))
$$;
revoke all on function public.viagem_entrega_json(public.entrega_viagens) from public,anon,authenticated;

create or replace function public.reconhecer_carregamento_viagem(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found or v.motoboy_id is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if v.versao is distinct from p_versao or v.revisao_pendente then raise exception 'versao_alterada'; end if;
  if v.tipo_despacho='individual' and v.reserva_ate<=now() then raise exception 'reserva_expirada'; end if;
  if v.estado<>'reservada' then raise exception 'transicao_invalida'; end if;
  update public.entrega_viagens set carregada_versao=versao,carregada_em=now() where id=p_id;
  perform public.comunicar_entregador();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.reconhecer_carregamento_viagem(uuid,uuid) from public,anon;
grant execute on function public.reconhecer_carregamento_viagem(uuid,uuid) to authenticated;

create or replace function public.iniciar_viagem_entrega(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid; pedido_linha public.pedidos;
begin
  if not public.is_equipe() and not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  if not public.is_equipe() and alvo is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  perform 1 from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado in ('em_rota','retornando','encerrada') then return jsonb_build_object('ok',true,'jaIniciada',true); end if;
  if v.estado<>'reservada' then raise exception 'transicao_invalida'; end if;
  if v.tipo_despacho='individual' and v.reserva_ate<=now() then raise exception 'reserva_expirada'; end if;
  if v.revisao_pendente then raise exception 'viagem_requer_revisao'; end if;
  if v.carregada_versao is distinct from v.versao then raise exception 'carregamento_pendente'; end if;
  if v.tipo_despacho='rotas' and v.origem is distinct from (select entrega_origem from public.loja where id=1) then raise exception 'origem_alterada'; end if;
  if exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    join public.entregas_operacao e on e.pedido_id=p.id where s.viagem_id=v.id and
      (not s.ativa or p.status<>'pronto' or e.atribuicao<>s.atribuicao or e.motoboy_id is distinct from alvo or e.saiu_em is not null
        or (v.tipo_despacho='rotas' and (p.entrega_destino is null or p.entrega_destino_ate<=now())))) then raise exception 'pedido_alterado'; end if;
  for pedido_linha in select p.* from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=v.id order by p.id loop
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(jsonb_build_object(
      'status','rota','em',public.data_iso(now()),'autor',auth.uid(),'viagem',v.id)) where id=pedido_linha.id;
  end loop;
  update public.entrega_viagens set estado='em_rota',saiu_em=now() where id=v.id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo) values(v.id,alvo,auth.uid(),'saida');
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.iniciar_viagem_entrega(uuid,uuid) from public,anon;
grant execute on function public.iniciar_viagem_entrega(uuid,uuid) to authenticated;

create or replace function public.minha_operacao_rotas() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return jsonb_build_object('servidorEm',public.data_iso(now()),'entregador',public.estado_entregador_rotas(auth.uid()),
    'modo',(select modo from public.entrega_rotas_config where id=1),
    'despachoIndividualAtivo',(select despacho_individual_ativo from public.entrega_rotas_config where id=1),
    'janelaAgrupamentoSeg',(select janela_agrupamento_seg from public.entrega_rotas_config where id=1),
    'viagem',(select public.viagem_entrega_json(v) from public.entrega_viagens v where motoboy_id=auth.uid() and estado in ('reservada','em_rota','retornando')));
end $$;
revoke all on function public.minha_operacao_rotas() from public,anon;
grant execute on function public.minha_operacao_rotas() to authenticated;

create or replace function public.disparar_planejador_entregas(p_verificar boolean default false) returns bigint
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; requisicao bigint;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if c.job_url is null or (c.modo<>'automatico' and not c.despacho_individual_ativo and not p_verificar
      and not exists(select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada'))
    or c.job_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/planejar-entregas$'
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  select net.http_post(url:=c.job_url,body:=jsonb_build_object('tokenJob',c.job_token,'acao',case when p_verificar then 'verificar' else 'automatico' end),
    headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=90000) into requisicao;
  return requisicao;
end $$;
revoke all on function public.disparar_planejador_entregas(boolean) from public,anon,authenticated;

notify pgrst,'reload schema';

-- ============ supabase/migrations/20261024023500_motoboy_pegar_pedidos.sql ============

-- Fila da loja na tela do motoboy: pedidos prontos sem entregador e "pegar" outro antes da saída.
-- Aditiva. Não altera preços, taxas, pagamentos, presença nem pedidos históricos. Reutiliza o ciclo das viagens
-- individuais (reserva → carregamento reconhecido → saída → retorno), o prazo de reserva e as travas do despacho.
-- Depois da saída a fila fica só para consulta; outro pedido só depois do retorno explícito à loja.

-- Por que o motoboy não pode pegar pedido agora (null quando pode). Lido depois das travas por pegar_pedido_entrega.
create or replace function public.motivo_pegar_pedido(p_motoboy uuid) returns text
language sql stable security invoker set search_path='' as $$
  select case
    when not exists(select 1 from public.motoboys m where m.user_id=p_motoboy and m.ativo) then 'entregador_inativo'
    when not c.despacho_individual_ativo then 'despacho_desligado'
    when v.estado in ('em_rota','retornando') then 'entrega_em_andamento'
    when v.id is not null and v.tipo_despacho<>'individual' then 'entregador_em_viagem'
    when v.id is not null and v.revisao_pendente then 'viagem_requer_revisao'
    when v.id is not null and v.reserva_ate<=now() then 'reserva_expirada'
    -- entrega_viagens_paradas.ordem vai de 1 a 6: limite técnico já existente por saída.
    when v.id is not null and (select coalesce(max(s.ordem),0) from public.entrega_viagens_paradas s where s.viagem_id=v.id)>=6 then 'limite_viagem'
    when v.id is null and not coalesce((public.estado_entregador_rotas(p_motoboy)->>'elegivel')::boolean,false) then 'entregador_indisponivel'
  end
  from public.entrega_rotas_config c
    left join public.entrega_viagens v on v.motoboy_id=p_motoboy and v.estado in ('reservada','em_rota','retornando')
  where c.id=1
$$;
revoke all on function public.motivo_pegar_pedido(uuid) from public,anon,authenticated;

-- Pedidos prontos sem entregador, do mais antigo ao mais recente. Recorte mínimo: sem nome, telefone nem itens.
create or replace function public.pedidos_disponiveis_entrega() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return jsonb_build_object('servidorEm',public.data_iso(now()),'motivo',public.motivo_pegar_pedido(auth.uid()),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'numero',x.numero,'endereco',x.endereco,
        'prontoEm',public.data_iso(x.pronto),'cobrarNaEntrega',x.cobrar) order by x.pronto nulls last,x.id) from (
      select p.id,p.numero,p.endereco,h.pronto,
        coalesce(p.pagamento_na_entrega and p.pagamento_entrega_recebido_em is null and p.pagamento_online is distinct from 'aprovado',false) cobrar
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
        cross join lateral (select max((x->>'em')::timestamptz) pronto from jsonb_array_elements(p.historico) x where x->>'status'='pronto') h
      where p.modo='entrega' and p.status='pronto' and p.origem<>'exemplo' and not p.entrega_planejamento_pausado
        and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
        and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      order by h.pronto nulls last,p.id limit 30) x),'[]'),
    'emPreparo',(select count(*) from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      where p.modo='entrega' and p.status='preparo' and p.origem<>'exemplo' and e.motoboy_id is null));
end $$;
revoke all on function public.pedidos_disponiveis_entrega() from public,anon;
grant execute on function public.pedidos_disponiveis_entrega() to authenticated;

-- Pega um pedido da fila: cria a reserva individual ou acrescenta à reserva ainda na loja. A versão muda,
-- então a saída exige carregar de novo no celular. Dois motoboys no mesmo pedido: só o primeiro leva.
create or replace function public.pegar_pedido_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config; v public.entrega_viagens; p public.pedidos; e public.entregas_operacao;
  nome text; motivo text; viagem uuid; atrib uuid:=gen_random_uuid(); ordem integer:=1; prazo timestamptz;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_id is null then raise exception 'dados_invalidos'; end if;
  -- Mesma ordem de travas da reserva, saída e expiração: pedidos por id, cadastro do motoboy, viagem.
  perform 1 from public.pedidos x where x.id=p_id or x.id in (select s.pedido_id from public.entrega_viagens_paradas s
    join public.entrega_viagens v1 on v1.id=s.viagem_id where v1.motoboy_id=auth.uid() and v1.estado='reservada')
    order by x.id for update;
  select m.nome into nome from public.motoboys m where m.user_id=auth.uid() and m.ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens x where x.motoboy_id=auth.uid() and x.estado in ('reservada','em_rota','retornando') for update;
  -- Relê depois das travas: outro motoboy, a equipe ou o job podem ter mudado o pedido no meio.
  select * into p from public.pedidos x where x.id=p_id;
  if not found or p.modo<>'entrega' or p.origem='exemplo' then raise exception 'nao_encontrado'; end if;
  select * into e from public.entregas_operacao x where x.pedido_id=p_id;
  if p.status<>'pronto' or p.entrega_planejamento_pausado or e.motoboy_id is not null or e.saiu_em is not null
    or e.encerramento is not null or exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p_id and s.ativa) then
    raise exception 'pedido_indisponivel'; end if;
  motivo:=public.motivo_pegar_pedido(auth.uid());
  if motivo is not null then raise exception '%',motivo; end if;
  select * into c from public.entrega_rotas_config where id=1;
  prazo:=now()+make_interval(secs=>c.prazo_reserva_seg);
  if v.id is null then
    insert into public.entrega_viagens(motoboy_id,motoboy_nome,criada_por,automatica,origem,regras,segundos,metros,ultima_entrega_seg,tipo_despacho,reserva_ate)
      values(auth.uid(),nome,auth.uid(),false,'{}',jsonb_build_object('maxPedidos',1),null,null,null,'individual',prazo)
      returning id into viagem;
    insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(viagem,auth.uid(),auth.uid(),'reserva',
      jsonb_build_object('tipoDespacho','individual','reservaAte',prazo,'origem','motoboy','pedido',p_id));
  else
    viagem:=v.id;
    select coalesce(max(s.ordem),0)+1 into ordem from public.entrega_viagens_paradas s where s.viagem_id=v.id;
    prazo:=greatest(v.reserva_ate,prazo);
    update public.entrega_viagens set versao=gen_random_uuid(),carregada_versao=null,
      regras=jsonb_build_object('maxPedidos',ordem),reserva_ate=prazo where id=v.id;
    insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(viagem,auth.uid(),auth.uid(),'pedido_acrescentado',
      jsonb_build_object('pedido',p_id,'ordem',ordem,'reservaAte',prazo));
  end if;
  insert into public.entregas_operacao(pedido_id,atribuicao,motoboy_id,motoboy_nome,atribuido_por)
    values(p_id,atrib,auth.uid(),nome,auth.uid()) on conflict(pedido_id) do update set atribuicao=excluded.atribuicao,
    motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,atribuido_em=now(),atribuido_por=excluded.atribuido_por
    where public.entregas_operacao.motoboy_id is null and public.entregas_operacao.saiu_em is null
      and public.entregas_operacao.encerramento is null;
  if not found then raise exception 'pedido_indisponivel'; end if;
  insert into public.entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,chegada_seg) values(viagem,p_id,ordem,atrib,null);
  insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values(p_id,auth.uid(),'atribuicao',
    jsonb_build_object('motoboy',auth.uid(),'nome',nome,'viagem',viagem,'origem','motoboy_pegou'));
  perform public.comunicar_entregador();
  return jsonb_build_object('ok',true,'viagem',(select public.viagem_entrega_json(x) from public.entrega_viagens x where x.id=viagem));
end $$;
revoke all on function public.pegar_pedido_entrega(uuid) from public,anon;
grant execute on function public.pegar_pedido_entrega(uuid) to authenticated;

notify pgrst,'reload schema';

-- ============ supabase/seed.sql ============

-- Cardápio do Mineiro Lanche: gerado por scripts/gerar-seed.mjs a partir do CONFIG de src/core.js. Não edite à mão.
-- 57 produtos e 5 adicionais. Idempotente: atualiza nome, preço, categoria, ordem,
-- ingredientes, tipo e foto pelo id, sem mexer em esgotado_dia. O CONFIG manda no ativo: quem está nele fica
-- ativo (um item que saiu e voltou é reativado); quem saiu fica inativo. Itens editados/criados
-- no painel são preservados integralmente, inclusive disponibilidade, preço e categoria.
-- Preço null = "Preço a confirmar" (o criar_pedido recusa): nenhum.

insert into public.categorias_produtos (id, label, icone, descricao, ordem) values
  ('testes', 'Teste de pagamento', 'sacola', 'Item temporário para validar o pagamento online', 0),
  ('artesanais', 'Artesanais', 'burger', 'Hambúrguer artesanal de 200 g', 1),
  ('tradicionais', 'Tradicionais', 'burger', 'Os clássicos da chapa', 2),
  ('hotdog', 'Hot dog', 'hotdog', 'Salsicha Perdigão · Dog Bacon ou Dog Pizza: qualquer dog com o adicional Bacon ou Pizza', 3),
  ('baguetes', 'Baguetes', 'baguete', 'Na baguete, do jeito mineiro', 4),
  ('combos', 'Combos', 'combo', 'Lanche, batata e bebida', 5),
  ('porcoes', 'Porções', 'batata', 'Pra dividir', 6),
  ('bebidas', 'Bebidas', 'lata', 'Geladas', 7)
on conflict (id) do nothing;

insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem, detalhes) values
  ('teste-pagamento', 'testes', 'Teste de pagamento (temporário)', 1.00, 'porcao', null, '{}'::text[], 1, '{"base":"Somente validação do pagamento. Não é um alimento. Selecione retirada no local.","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-burger', 'artesanais', 'Gran Burger', 25.90, 'lanche', 'gran-burger', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 2, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-burger-bacon', 'artesanais', 'Gran Burger Bacon', 33.40, 'lanche', 'gran-burger-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon']::text[], 3, '{"base":"Gran Burger com bacon","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-salada', 'artesanais', 'Gran Salada', 26.90, 'lanche', 'gran-salada', array['Maionese grill', 'Cheddar cremoso', 'Mussarela', 'Barbecue', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 4, '{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-egg', 'artesanais', 'Gran Egg', 30.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 5, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-bacon', 'artesanais', 'Gran Bacon', 31.90, 'lanche', null, array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon em tiras', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 6, '{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-egg-bacon', 'artesanais', 'Gran Egg Bacon', 33.90, 'lanche', 'gran-egg-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 7, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-big-tudo', 'artesanais', 'Gran Big Tudo', 34.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 8, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-black', 'artesanais', 'Gran Black', 35.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 9, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-big-mineiro', 'artesanais', 'Gran Big Mineiro', 36.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Presunto', 'Azeite e sal']::text[], 10, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-chicken', 'artesanais', 'Gran Chicken', 24.90, 'lanche', 'gran-chicken', array['Cheddar', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 11, '{"base":"Pão de brioche e hambúrguer de frango empanado","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-bacon-onion', 'artesanais', 'Gran Bacon Onion', 34.90, 'lanche', 'gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 12, '{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-crispy', 'artesanais', 'Gran Crispy', 27.90, 'lanche', 'gran-crispy', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Cebola caramelizada', 'Cebola crispy']::text[], 13, '{"base":"Pão de brioche e hambúrguer 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-burguer', 'tradicionais', 'X-Burguer', 16.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 14, '{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-salada', 'tradicionais', 'X-Salada', 19.90, 'lanche', 'x-salada', array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 15, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('mega-x-salada-egg', 'tradicionais', 'Mega X-Salada Egg', 21.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo']::text[], 16, '{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('ultra-x-salada-bacon', 'tradicionais', 'Ultra X-Salada Bacon', 23.90, 'lanche', 'ultra-x-salada-bacon', array['Cheddar cremoso', 'Mussarela', 'Bacon', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 17, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('exagerado-x-salada-egg-bacon', 'tradicionais', 'Exagerado X-Salada Egg Bacon', 27.90, 'lanche', 'exagerado-x-salada-egg-bacon', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon', 'Ovo', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 18, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('big-tudo', 'tradicionais', 'Big Tudo', 28.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon', 'Batata palha']::text[], 19, '{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('black-master', 'tradicionais', 'Black Master', 29.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon']::text[], 20, '{"base":"Pão australiano e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('big-mineiro', 'tradicionais', 'Big Mineiro', 30.90, 'lanche', 'big-mineiro', array['Mussarela', 'Presunto', 'Ovo', 'Bacon', 'Maionese', 'Barbecue', 'Batata palha', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 21, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-medio', 'hotdog', 'Hot Dog Médio', 13.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 22, '{"base":"Pão médio e 1 salsicha Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-medio-frango', 'hotdog', 'Hot Dog Médio Frango', 19.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 23, '{"base":"Pão e 1 salsicha","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-max', 'hotdog', 'Hot Dog Max', 15.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 24, '{"base":"Pão médio e 2 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-max-frango', 'hotdog', 'Hot Dog Max Frango', 21.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 25, '{"base":"Pão e 2 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-super', 'hotdog', 'Hot Dog Super', 18.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 26, '{"base":"Pão médio e 3 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-super-frango', 'hotdog', 'Hot Dog Super Frango', 24.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 27, '{"base":"Pão e 3 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-doritos', 'hotdog', 'Dog com Doritos', 23.90, 'lanche', 'dog-doritos', array['Doritos', 'Cheddar']::text[], 28, '{"base":"O hot dog com Doritos da casa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-pizza', 'hotdog', 'Hot Dog Pizza', 26.40, 'lanche', 'dog-pizza', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry', 'Queijo gratinado', 'Orégano']::text[], 29, '{"base":"Hot Dog Super (3 salsichas Perdigão) com o adicional Pizza","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-cbo-turbo', 'hotdog', 'Hot Dog CBO Turbo', 34.90, 'lanche', 'dog-cbo-turbo', array['Maionese', 'Ketchup', 'Alface', 'Azeite e sal', 'Purê de batata', 'Batata palha', 'Cheddar', 'Catupiry', 'Mussarela gratinada', 'Bacon']::text[], 30, '{"base":"Pão de dog e 3 salsichas Perdigão","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('carne-maluca', 'baguetes', 'Carne Maluca', 26.90, 'lanche', null, array['Maionese', 'Barbecue', 'Milho', 'Batata palha', 'Vinagrete com cebola', 'Purê', 'Requeijão', 'Cheddar']::text[], 31, '{"base":"Baguete e carne desfiada","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-frango', 'baguetes', 'X-Frango', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 32, '{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-frango-egg-bacon', 'baguetes', 'X-Frango Egg Bacon', 29.90, 'lanche', null, array['Queijo', 'Purê', 'Ovo', 'Bacon', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 33, '{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-calabresa', 'baguetes', 'X-Calabresa', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 34, '{"base":"Baguete e calabresa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-churrasco', 'baguetes', 'X-Churrasco', 28.90, 'lanche', 'x-churrasco', array['Maionese', 'Barbecue', 'Vinagrete', 'Mussarela', 'Purê de batata', 'Batata palha', 'Cheddar', 'Requeijão']::text[], 35, '{"base":"Pão de baguete e contra-filé","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('americano', 'baguetes', 'Americano', 21.90, 'lanche', null, array['Maionese', 'Mussarela', 'Presunto', 'Ovo', 'Tomate', 'Alface', 'Azeite e sal']::text[], 36, '{"base":"Baguete","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-diluvio', 'combos', 'Combo Dilúvio', 49.90, 'combo', 'combo-diluvio', array['Piscininha de cheddar', 'Farofinha de bacon']::text[], 37, '{"base":"","nota":"Pergunte pelo WhatsApp quantos lanches vêm.","inclui":["Gran Burgers na piscininha de cheddar","Farofinha de bacon","140 g de batata frita","Refrigerante lata 350 ml (qualquer um)"],"sabor":false,"escolheRefri":true}'::jsonb),
  ('combo-casal', 'combos', 'Combo Casal', 99.90, 'combo', 'combo-casal', '{}'::text[], 38, '{"base":"","nota":"Na foto: 2 lanches e batata com calabresa, cheddar, maionese e cebola crispy. Pergunte pelo WhatsApp quais lanches vêm.","inclui":["2 lanches","Porção de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-bacon-coca-maionese', 'combos', 'Gran Bacon + Coca 350 ml + Maionese da casa', 42.90, 'combo', 'gran-bacon-maionese', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 39, '{"base":"","nota":"","inclui":["Gran Bacon","Coca-Cola 350 ml","Maionese artesanal da casa"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-2-dog-doritos', 'combos', 'Combo 2 Hot Dog com Doritos', 57.80, 'combo', 'combo-2-dog-doritos', array['Doritos', 'Cheddar']::text[], 40, '{"base":"","nota":"","inclui":["2 Hot Dog com Doritos","Coca-Cola 600 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-burger', 'combos', 'Combo Gran Burger', 39.90, 'combo', null, array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue']::text[], 41, '{"base":"","nota":"","inclui":["Gran Burger (brioche, 200 g de carne angus, mussarela, cheddar, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-bacon', 'combos', 'Combo Gran Bacon', 45.90, 'combo', null, array['Mussarela', 'Cheddar', 'Bacon', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate']::text[], 42, '{"base":"","nota":"","inclui":["Gran Bacon (brioche, 200 g de carne angus, mussarela, cheddar, bacon, maionese, barbecue, alface americano e tomate)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-salada', 'combos', 'Combo Gran Salada', 42.90, 'combo', null, array['Mussarela', 'Cheddar', 'Alface americano', 'Tomate', 'Cebola roxa', 'Maionese', 'Barbecue']::text[], 43, '{"base":"","nota":"","inclui":["Gran Salada (brioche, 200 g de carne angus, mussarela, cheddar, alface americano, tomate, cebola roxa, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-bacon-onion', 'combos', 'Combo Gran Bacon Onion', 48.90, 'combo', 'combo-gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 44, '{"base":"","nota":"","inclui":["Gran Bacon Onion (angus 200 g, maionese grill, barbecue, cheddar cremoso, bacon em fatias, 2 onion rings, alface americana, tomate em rodelas e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-hot-dog-max', 'combos', 'Combo Hot Dog Max', 29.90, 'combo', null, array['Alface', 'Purê', 'Batata palha', 'Ketchup', 'Cheddar', 'Catupiry']::text[], 45, '{"base":"","nota":"","inclui":["Hot dog médio com 2 salsichas, alface, purê, batata palha, ketchup, cheddar e catupiry","250 g de batata frita","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-x-frango', 'combos', 'Combo X-Frango', 39.90, 'combo', null, array['Mussarela', 'Maionese', 'Barbecue', 'Vinagrete', 'Purê', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 46, '{"base":"","nota":"","inclui":["X-Frango na baguete (filé de frango, mussarela, maionese, barbecue, vinagrete, purê, batata palha, cheddar e catupiry)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-chicken', 'combos', 'Combo Gran Chicken', 38.90, 'combo', null, array['Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 47, '{"base":"","nota":"","inclui":["Gran Chicken (brioche, frango empanado, maionese, barbecue, alface americano, tomate e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('porcao-batata', 'porcoes', 'Porção de batata turbinada', 39.90, 'porcao', null, '{}'::text[], 48, '{"base":"","nota":"","inclui":["500 g de batata frita","Cheddar cremoso","Bacon","Requeijão","Calabresa","Alho-poró"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('porcao-onion', 'porcoes', 'Porção de onion', 14.90, 'porcao', null, '{}'::text[], 49, '{"base":"","nota":"","inclui":["6 onion rings"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('refri-lata', 'bebidas', 'Refrigerante lata', 8.00, 'bebida', null, '{}'::text[], 50, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('refri-600', 'bebidas', 'Refrigerante 600 ml', 12.00, 'bebida', null, '{}'::text[], 51, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('refri-1l', 'bebidas', 'Refrigerante 1 litro', 14.00, 'bebida', null, '{}'::text[], 52, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('refri-dolly', 'bebidas', 'Refrigerante Dolly', 4.50, 'bebida', null, '{}'::text[], 53, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('suco-lata', 'bebidas', 'Suco lata', 7.00, 'bebida', null, '{}'::text[], 54, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('suco-1l', 'bebidas', 'Suco 1 litro', 11.00, 'bebida', null, '{}'::text[], 55, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('agua', 'bebidas', 'Água', 4.00, 'bebida', null, '{}'::text[], 56, '{"base":"","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('h2o', 'bebidas', 'H2O', 8.00, 'bebida', null, '{}'::text[], 57, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb)
on conflict (id) do update set
  categoria = excluded.categoria,
  nome = excluded.nome,
  preco = excluded.preco,
  tipo = excluded.tipo,
  foto = excluded.foto,
  ingredientes = excluded.ingredientes,
  detalhes = excluded.detalhes,
  ordem = excluded.ordem,
  ativo = true
where not public.produtos.editado_painel;

-- o que saiu do CONFIG fica inativo (pedidos antigos continuam apontando para ele)
update public.produtos set ativo = false
where ativo and not editado_painel and id not in ('teste-pagamento', 'gran-burger', 'gran-burger-bacon', 'gran-salada', 'gran-egg', 'gran-bacon', 'gran-egg-bacon', 'gran-big-tudo', 'gran-black', 'gran-big-mineiro', 'gran-chicken', 'gran-bacon-onion', 'gran-crispy', 'x-burguer', 'x-salada', 'mega-x-salada-egg', 'ultra-x-salada-bacon', 'exagerado-x-salada-egg-bacon', 'big-tudo', 'black-master', 'big-mineiro', 'dog-medio', 'dog-medio-frango', 'dog-max', 'dog-max-frango', 'dog-super', 'dog-super-frango', 'dog-doritos', 'dog-pizza', 'dog-cbo-turbo', 'carne-maluca', 'x-frango', 'x-frango-egg-bacon', 'x-calabresa', 'x-churrasco', 'americano', 'combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos', 'combo-gran-burger', 'combo-gran-bacon', 'combo-gran-salada', 'combo-gran-bacon-onion', 'combo-hot-dog-max', 'combo-x-frango', 'combo-gran-chicken', 'porcao-batata', 'porcao-onion', 'refri-lata', 'refri-600', 'refri-1l', 'refri-dolly', 'suco-lata', 'suco-1l', 'agua', 'h2o');

insert into public.adicionais (id, nome, preco) values
  ('catupiry', 'Catupiry', 7.50),
  ('bacon', 'Bacon', 7.50),
  ('doritos', 'Doritos', 7.50),
  ('queijo', 'Queijo', 7.50),
  ('pizza', 'Pizza', 7.50)
on conflict (id) do update set
  nome = excluded.nome,
  preco = excluded.preco,
  ativo = true;

update public.adicionais set ativo = false
where ativo and id not in ('catupiry', 'bacon', 'doritos', 'queijo', 'pizza');

-- loja: cria se não existir; depois só horarios, combo_preco e taxa de entrega vêm do CONFIG (modo e aceita_fechada são do painel)
insert into public.loja (id, modo, aceita_fechada, combo_preco, taxa_km, taxa_fixa, horarios)
values (1, 'auto', false, 14.90, 1.00, 4.00, '{"0":["19:00","01:00"],"1":["19:00","00:00"],"2":["19:00","00:00"],"3":null,"4":["19:00","00:00"],"5":["19:00","01:00"],"6":["19:00","01:00"]}'::jsonb)
on conflict (id) do update set
  horarios = excluded.horarios,
  combo_preco = excluded.combo_preco,
  taxa_km = excluded.taxa_km,
  taxa_fixa = excluded.taxa_fixa;

-- o PostgREST recarrega o schema (funções novas aparecem na API na hora)
notify pgrst, 'reload schema';

commit;

-- =====================================================================================
-- Acesso ao painel: crie o usuário em Authentication → Users (e-mail e senha) e rode,
-- trocando EMAIL_AQUI pelo e-mail dele:
--
-- insert into equipe (user_id, nome) select id, 'Dono' from auth.users where email = 'EMAIL_AQUI' on conflict do nothing;
-- insert into usuarios_painel(user_id,nome,email,perfil,ativo)
-- select id,'Dono',lower(email),'admin',true from auth.users where email='EMAIL_AQUI'
-- on conflict(user_id) do update set perfil='admin',ativo=true;
-- Depois, use Painel > Usuários para cadastrar/liberar equipe e motoboys sem abrir o Supabase.
--
-- Acesso do motoboy (tela /motoboy/): crie o usuário em Authentication → Users (e-mail e senha, Auto Confirm) e rode,
-- trocando EMAIL_AQUI pelo e-mail dele. O motoboy NÃO entra na equipe: ele só enxerga suas próprias atribuições abertas.
-- Para cortar o acesso sem apagar o usuário: update public.motoboys set ativo = false where user_id = (select id from auth.users where email = 'EMAIL_AQUI');
--
-- insert into public.motoboys (user_id, nome) select id, 'Motoboy' from auth.users where email = 'EMAIL_AQUI' on conflict do nothing;
-- =====================================================================================
