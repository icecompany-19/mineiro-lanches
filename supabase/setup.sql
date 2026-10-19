-- =====================================================================================
-- Mineiro Lanche · setup completo do banco (Supabase)
-- Gerado por scripts/montar-setup.mjs a partir de supabase/migrations/20261008000001_schema.sql, supabase/migrations/20261008000002_rls.sql, supabase/migrations/20261008000003_rpc.sql, supabase/migrations/20261016000001_taxa_entrega.sql, supabase/migrations/20261017000001_motoboy.sql, supabase/migrations/20261017000002_confirmar_entrega_ja_entregue.sql, supabase/migrations/20261018023009_cotacao_entrega.sql, supabase/migrations/20261018031024_destino_entrega_e_limpeza.sql, supabase/migrations/20261018181746_gestao_usuarios_painel.sql, supabase/migrations/20261019024838_controle_entregadores.sql, supabase/migrations/20261019032841_historico_entregas_painel.sql, supabase/migrations/20261019034930_totais_taxas_entregadores.sql, supabase/seed.sql.
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

-- ============ supabase/seed.sql ============

-- Cardápio do Mineiro Lanche: gerado por scripts/gerar-seed.mjs a partir do CONFIG de src/core.js. Não edite à mão.
-- 56 produtos e 5 adicionais. Idempotente: atualiza nome, preço, categoria, ordem,
-- ingredientes, tipo e foto pelo id, sem mexer em esgotado_dia. O CONFIG manda no ativo: quem está nele fica
-- ativo (um item que saiu e voltou é reativado); quem saiu fica inativo.
-- Preço null = "Preço a confirmar" (o criar_pedido recusa): nenhum.

insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem) values
  ('gran-burger', 'artesanais', 'Gran Burger', 25.90, 'lanche', 'gran-burger', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 1),
  ('gran-burger-bacon', 'artesanais', 'Gran Burger Bacon', 33.40, 'lanche', 'gran-burger-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon']::text[], 2),
  ('gran-salada', 'artesanais', 'Gran Salada', 26.90, 'lanche', 'gran-salada', array['Maionese grill', 'Cheddar cremoso', 'Mussarela', 'Barbecue', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 3),
  ('gran-egg', 'artesanais', 'Gran Egg', 30.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 4),
  ('gran-bacon', 'artesanais', 'Gran Bacon', 31.90, 'lanche', null, array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon em tiras', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 5),
  ('gran-egg-bacon', 'artesanais', 'Gran Egg Bacon', 33.90, 'lanche', 'gran-egg-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 6),
  ('gran-big-tudo', 'artesanais', 'Gran Big Tudo', 34.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 7),
  ('gran-black', 'artesanais', 'Gran Black', 35.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 8),
  ('gran-big-mineiro', 'artesanais', 'Gran Big Mineiro', 36.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Presunto', 'Azeite e sal']::text[], 9),
  ('gran-chicken', 'artesanais', 'Gran Chicken', 24.90, 'lanche', 'gran-chicken', array['Cheddar', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 10),
  ('gran-bacon-onion', 'artesanais', 'Gran Bacon Onion', 34.90, 'lanche', 'gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 11),
  ('gran-crispy', 'artesanais', 'Gran Crispy', 27.90, 'lanche', 'gran-crispy', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Cebola caramelizada', 'Cebola crispy']::text[], 12),
  ('x-burguer', 'tradicionais', 'X-Burguer', 16.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 13),
  ('x-salada', 'tradicionais', 'X-Salada', 19.90, 'lanche', 'x-salada', array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 14),
  ('mega-x-salada-egg', 'tradicionais', 'Mega X-Salada Egg', 21.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo']::text[], 15),
  ('ultra-x-salada-bacon', 'tradicionais', 'Ultra X-Salada Bacon', 23.90, 'lanche', 'ultra-x-salada-bacon', array['Cheddar cremoso', 'Mussarela', 'Bacon', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 16),
  ('exagerado-x-salada-egg-bacon', 'tradicionais', 'Exagerado X-Salada Egg Bacon', 27.90, 'lanche', 'exagerado-x-salada-egg-bacon', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon', 'Ovo', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 17),
  ('big-tudo', 'tradicionais', 'Big Tudo', 28.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon', 'Batata palha']::text[], 18),
  ('black-master', 'tradicionais', 'Black Master', 29.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon']::text[], 19),
  ('big-mineiro', 'tradicionais', 'Big Mineiro', 30.90, 'lanche', 'big-mineiro', array['Mussarela', 'Presunto', 'Ovo', 'Bacon', 'Maionese', 'Barbecue', 'Batata palha', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 20),
  ('dog-medio', 'hotdog', 'Hot Dog Médio', 13.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 21),
  ('dog-medio-frango', 'hotdog', 'Hot Dog Médio Frango', 19.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 22),
  ('dog-max', 'hotdog', 'Hot Dog Max', 15.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 23),
  ('dog-max-frango', 'hotdog', 'Hot Dog Max Frango', 21.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 24),
  ('dog-super', 'hotdog', 'Hot Dog Super', 18.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 25),
  ('dog-super-frango', 'hotdog', 'Hot Dog Super Frango', 24.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 26),
  ('dog-doritos', 'hotdog', 'Dog com Doritos', 23.90, 'lanche', 'dog-doritos', array['Doritos', 'Cheddar']::text[], 27),
  ('dog-pizza', 'hotdog', 'Hot Dog Pizza', 26.40, 'lanche', 'dog-pizza', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry', 'Queijo gratinado', 'Orégano']::text[], 28),
  ('dog-cbo-turbo', 'hotdog', 'Hot Dog CBO Turbo', 34.90, 'lanche', 'dog-cbo-turbo', array['Maionese', 'Ketchup', 'Alface', 'Azeite e sal', 'Purê de batata', 'Batata palha', 'Cheddar', 'Catupiry', 'Mussarela gratinada', 'Bacon']::text[], 29),
  ('carne-maluca', 'baguetes', 'Carne Maluca', 26.90, 'lanche', null, array['Maionese', 'Barbecue', 'Milho', 'Batata palha', 'Vinagrete com cebola', 'Purê', 'Requeijão', 'Cheddar']::text[], 30),
  ('x-frango', 'baguetes', 'X-Frango', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 31),
  ('x-frango-egg-bacon', 'baguetes', 'X-Frango Egg Bacon', 29.90, 'lanche', null, array['Queijo', 'Purê', 'Ovo', 'Bacon', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 32),
  ('x-calabresa', 'baguetes', 'X-Calabresa', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 33),
  ('x-churrasco', 'baguetes', 'X-Churrasco', 28.90, 'lanche', 'x-churrasco', array['Maionese', 'Barbecue', 'Vinagrete', 'Mussarela', 'Purê de batata', 'Batata palha', 'Cheddar', 'Requeijão']::text[], 34),
  ('americano', 'baguetes', 'Americano', 21.90, 'lanche', null, array['Maionese', 'Mussarela', 'Presunto', 'Ovo', 'Tomate', 'Alface', 'Azeite e sal']::text[], 35),
  ('combo-diluvio', 'combos', 'Combo Dilúvio', 49.90, 'combo', 'combo-diluvio', array['Piscininha de cheddar', 'Farofinha de bacon']::text[], 36),
  ('combo-casal', 'combos', 'Combo Casal', 99.90, 'combo', 'combo-casal', '{}'::text[], 37),
  ('gran-bacon-coca-maionese', 'combos', 'Gran Bacon + Coca 350 ml + Maionese da casa', 42.90, 'combo', 'gran-bacon-maionese', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 38),
  ('combo-2-dog-doritos', 'combos', 'Combo 2 Hot Dog com Doritos', 57.80, 'combo', 'combo-2-dog-doritos', array['Doritos', 'Cheddar']::text[], 39),
  ('combo-gran-burger', 'combos', 'Combo Gran Burger', 39.90, 'combo', null, array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue']::text[], 40),
  ('combo-gran-bacon', 'combos', 'Combo Gran Bacon', 45.90, 'combo', null, array['Mussarela', 'Cheddar', 'Bacon', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate']::text[], 41),
  ('combo-gran-salada', 'combos', 'Combo Gran Salada', 42.90, 'combo', null, array['Mussarela', 'Cheddar', 'Alface americano', 'Tomate', 'Cebola roxa', 'Maionese', 'Barbecue']::text[], 42),
  ('combo-gran-bacon-onion', 'combos', 'Combo Gran Bacon Onion', 48.90, 'combo', 'combo-gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 43),
  ('combo-hot-dog-max', 'combos', 'Combo Hot Dog Max', 29.90, 'combo', null, array['Alface', 'Purê', 'Batata palha', 'Ketchup', 'Cheddar', 'Catupiry']::text[], 44),
  ('combo-x-frango', 'combos', 'Combo X-Frango', 39.90, 'combo', null, array['Mussarela', 'Maionese', 'Barbecue', 'Vinagrete', 'Purê', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 45),
  ('combo-gran-chicken', 'combos', 'Combo Gran Chicken', 38.90, 'combo', null, array['Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 46),
  ('porcao-batata', 'porcoes', 'Porção de batata turbinada', 39.90, 'porcao', null, '{}'::text[], 47),
  ('porcao-onion', 'porcoes', 'Porção de onion', 14.90, 'porcao', null, '{}'::text[], 48),
  ('refri-lata', 'bebidas', 'Refrigerante lata', 8.00, 'bebida', null, '{}'::text[], 49),
  ('refri-600', 'bebidas', 'Refrigerante 600 ml', 12.00, 'bebida', null, '{}'::text[], 50),
  ('refri-1l', 'bebidas', 'Refrigerante 1 litro', 14.00, 'bebida', null, '{}'::text[], 51),
  ('refri-dolly', 'bebidas', 'Refrigerante Dolly', 4.50, 'bebida', null, '{}'::text[], 52),
  ('suco-lata', 'bebidas', 'Suco lata', 7.00, 'bebida', null, '{}'::text[], 53),
  ('suco-1l', 'bebidas', 'Suco 1 litro', 11.00, 'bebida', null, '{}'::text[], 54),
  ('agua', 'bebidas', 'Água', 4.00, 'bebida', null, '{}'::text[], 55),
  ('h2o', 'bebidas', 'H2O', 8.00, 'bebida', null, '{}'::text[], 56)
on conflict (id) do update set
  categoria = excluded.categoria,
  nome = excluded.nome,
  preco = excluded.preco,
  tipo = excluded.tipo,
  foto = excluded.foto,
  ingredientes = excluded.ingredientes,
  ordem = excluded.ordem,
  ativo = true;

-- o que saiu do CONFIG fica inativo (pedidos antigos continuam apontando para ele)
update public.produtos set ativo = false
where ativo and id not in ('gran-burger', 'gran-burger-bacon', 'gran-salada', 'gran-egg', 'gran-bacon', 'gran-egg-bacon', 'gran-big-tudo', 'gran-black', 'gran-big-mineiro', 'gran-chicken', 'gran-bacon-onion', 'gran-crispy', 'x-burguer', 'x-salada', 'mega-x-salada-egg', 'ultra-x-salada-bacon', 'exagerado-x-salada-egg-bacon', 'big-tudo', 'black-master', 'big-mineiro', 'dog-medio', 'dog-medio-frango', 'dog-max', 'dog-max-frango', 'dog-super', 'dog-super-frango', 'dog-doritos', 'dog-pizza', 'dog-cbo-turbo', 'carne-maluca', 'x-frango', 'x-frango-egg-bacon', 'x-calabresa', 'x-churrasco', 'americano', 'combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos', 'combo-gran-burger', 'combo-gran-bacon', 'combo-gran-salada', 'combo-gran-bacon-onion', 'combo-hot-dog-max', 'combo-x-frango', 'combo-gran-chicken', 'porcao-batata', 'porcao-onion', 'refri-lata', 'refri-600', 'refri-1l', 'refri-dolly', 'suco-lata', 'suco-1l', 'agua', 'h2o');

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
