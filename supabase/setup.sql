-- =====================================================================================
-- Mineiro Lanche · setup completo do banco (Supabase)
-- Gerado por scripts/montar-setup.mjs a partir de supabase/migrations/20261008000001_schema.sql, supabase/migrations/20261008000002_rls.sql, supabase/migrations/20261008000003_rpc.sql, supabase/seed.sql.
-- Não edite à mão: mude as migrations ou o CONFIG e rode
--   node scripts/gerar-seed.mjs && node scripts/montar-setup.mjs
--
-- Como aplicar: Dashboard do Supabase → SQL Editor → New query → colar este arquivo inteiro → Run.
-- (Se o editor avisar de "operações destrutivas", são os drop ... if exists que recriam policies
--  e gatilhos; pode confirmar.)
-- Idempotente: rodar de novo não dá erro nem duplica dados, policies ou tabelas no Realtime.
-- Roda numa transação só: se algo falhar, nada fica pela metade.
-- Depois: dê acesso ao painel com o comando comentado no fim do arquivo.
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
create table if not exists public.produtos (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  categoria text not null check (char_length(categoria) between 1 and 40),
  nome text not null check (char_length(nome) between 1 and 120),
  preco numeric(10, 2) not null check (preco >= 0),
  tipo text not null check (tipo in ('lanche', 'combo', 'porcao', 'bebida')),
  foto text check (foto is null or char_length(foto) <= 120),
  ingredientes text[] not null default '{}',
  ordem int not null default 0,
  ativo boolean not null default true,
  esgotado_dia date
);

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
    if not found or not v_prod.ativo then
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
-- o front aplica sobre o CONFIG: esgotados do dia, inativos, preços e loja
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

-- ============ supabase/seed.sql ============

-- Cardápio do Mineiro Lanche: gerado por scripts/gerar-seed.mjs a partir do CONFIG de src/core.js. Não edite à mão.
-- 55 produtos e 5 adicionais. Idempotente: atualiza nome, preço, categoria, ordem,
-- ingredientes, tipo e foto pelo id, sem mexer em esgotado_dia. O CONFIG manda no ativo: quem está nele fica
-- ativo (um item que saiu e voltou é reativado); quem saiu fica inativo.

insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem) values
  ('gran-burger', 'artesanais', 'Gran Burger', 25.90, 'lanche', 'gran-burger', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 1),
  ('gran-burger-bacon', 'artesanais', 'Gran Burger Bacon', 33.40, 'lanche', 'gran-burger-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon']::text[], 2),
  ('gran-salada', 'artesanais', 'Gran Salada', 26.90, 'lanche', 'gran-salada', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 3),
  ('gran-egg', 'artesanais', 'Gran Egg', 30.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 4),
  ('gran-bacon', 'artesanais', 'Gran Bacon', 31.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 5),
  ('gran-egg-bacon', 'artesanais', 'Gran Egg Bacon', 33.90, 'lanche', 'gran-egg-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 6),
  ('gran-big-tudo', 'artesanais', 'Gran Big Tudo', 34.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 7),
  ('gran-black', 'artesanais', 'Gran Black', 35.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 8),
  ('gran-big-mineiro', 'artesanais', 'Gran Big Mineiro', 36.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Presunto', 'Azeite e sal']::text[], 9),
  ('gran-chicken', 'artesanais', 'Gran Chicken', 24.90, 'lanche', 'gran-chicken', array['Cheddar', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 10),
  ('gran-bacon-onion', 'artesanais', 'Gran Bacon Onion', 34.90, 'lanche', 'gran-bacon-onion', array['Maionese', 'Barbecue', '3 onion rings', 'Cheddar cremoso', 'Mussarela', 'Bacon', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 11),
  ('gran-crispy', 'artesanais', 'Gran Crispy', 27.90, 'lanche', 'gran-crispy', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Cebola caramelizada', 'Cebola crispy']::text[], 12),
  ('x-burguer', 'tradicionais', 'X-Burguer', 16.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 13),
  ('x-salada', 'tradicionais', 'X-Salada', 19.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal']::text[], 14),
  ('mega-x-salada-egg', 'tradicionais', 'Mega X-Salada Egg', 21.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo']::text[], 15),
  ('ultra-x-salada-bacon', 'tradicionais', 'Ultra X-Salada Bacon', 23.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Bacon']::text[], 16),
  ('exagerado-x-salada-egg-bacon', 'tradicionais', 'Exagerado X-Salada Egg Bacon', 27.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo', 'Bacon']::text[], 17),
  ('big-tudo', 'tradicionais', 'Big Tudo', 28.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon', 'Batata palha']::text[], 18),
  ('black-master', 'tradicionais', 'Black Master', 29.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon']::text[], 19),
  ('big-mineiro', 'tradicionais', 'Big Mineiro', 30.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Presunto', 'Bacon', 'Batata palha']::text[], 20),
  ('dog-medio', 'hotdog', 'Hot Dog Médio', 13.90, 'lanche', null, array['Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 21),
  ('dog-medio-frango', 'hotdog', 'Hot Dog Médio Frango', 19.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 22),
  ('dog-max', 'hotdog', 'Hot Dog Max', 15.90, 'lanche', null, array['Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 23),
  ('dog-max-frango', 'hotdog', 'Hot Dog Max Frango', 21.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 24),
  ('dog-super', 'hotdog', 'Hot Dog Super', 18.90, 'lanche', null, array['Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 25),
  ('dog-super-frango', 'hotdog', 'Hot Dog Super Frango', 24.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 26),
  ('dog-doritos', 'hotdog', 'Dog com Doritos', 23.90, 'lanche', 'dog-doritos', array['Doritos', 'Cheddar']::text[], 27),
  ('dog-pizza', 'hotdog', 'Hot Dog Pizza', 26.40, 'lanche', 'dog-pizza', array['Queijo gratinado', 'Azeitona', 'Orégano']::text[], 28),
  ('carne-maluca', 'baguetes', 'Carne Maluca', 26.90, 'lanche', null, array['Maionese', 'Barbecue', 'Milho', 'Batata palha', 'Vinagrete com cebola', 'Purê', 'Requeijão', 'Cheddar']::text[], 29),
  ('x-frango', 'baguetes', 'X-Frango', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 30),
  ('x-frango-egg-bacon', 'baguetes', 'X-Frango Egg Bacon', 29.90, 'lanche', null, array['Queijo', 'Purê', 'Ovo', 'Bacon', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 31),
  ('x-calabresa', 'baguetes', 'X-Calabresa', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 32),
  ('x-churrasco', 'baguetes', 'X-Churrasco', 28.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 33),
  ('americano', 'baguetes', 'Americano', 21.90, 'lanche', null, array['Maionese', 'Mussarela', 'Presunto', 'Ovo', 'Tomate', 'Alface', 'Azeite e sal']::text[], 34),
  ('combo-diluvio', 'combos', 'Combo Dilúvio', 49.90, 'combo', 'combo-diluvio', array['Piscininha de cheddar', 'Farofinha de bacon']::text[], 35),
  ('combo-casal', 'combos', 'Combo Casal', 99.90, 'combo', 'combo-casal', '{}'::text[], 36),
  ('gran-bacon-coca-maionese', 'combos', 'Gran Bacon + Coca 350 ml + Maionese da casa', 42.90, 'combo', 'gran-bacon-maionese', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 37),
  ('combo-2-dog-doritos', 'combos', 'Combo 2 Hot Dog com Doritos', 57.80, 'combo', 'combo-2-dog-doritos', array['Doritos', 'Cheddar']::text[], 38),
  ('combo-gran-burger', 'combos', 'Combo Gran Burger', 39.90, 'combo', null, array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue']::text[], 39),
  ('combo-gran-bacon', 'combos', 'Combo Gran Bacon', 45.90, 'combo', null, array['Mussarela', 'Cheddar', 'Bacon', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate']::text[], 40),
  ('combo-gran-salada', 'combos', 'Combo Gran Salada', 42.90, 'combo', null, array['Mussarela', 'Cheddar', 'Alface americano', 'Tomate', 'Cebola roxa', 'Maionese', 'Barbecue']::text[], 41),
  ('combo-gran-bacon-onion', 'combos', 'Combo Gran Bacon Onion', 48.90, 'combo', null, array['Maionese', 'Barbecue', 'Mussarela', 'Cheddar', 'Bacon', '3 onion rings']::text[], 42),
  ('combo-hot-dog-max', 'combos', 'Combo Hot Dog Max', 29.90, 'combo', null, array['Alface', 'Purê', 'Batata palha', 'Ketchup', 'Cheddar', 'Catupiri']::text[], 43),
  ('combo-x-frango', 'combos', 'Combo X-Frango', 39.90, 'combo', null, array['Mussarela', 'Maionese', 'Barbecue', 'Vinagrete', 'Purê', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 44),
  ('combo-gran-chicken', 'combos', 'Combo Gran Chicken', 38.90, 'combo', null, array['Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 45),
  ('porcao-batata', 'porcoes', 'Porção de batata', 39.90, 'porcao', null, '{}'::text[], 46),
  ('porcao-onion', 'porcoes', 'Porção de onion', 14.90, 'porcao', null, '{}'::text[], 47),
  ('refri-lata', 'bebidas', 'Refrigerante lata', 8.00, 'bebida', null, '{}'::text[], 48),
  ('refri-600', 'bebidas', 'Refrigerante 600 ml', 12.00, 'bebida', null, '{}'::text[], 49),
  ('refri-1l', 'bebidas', 'Refrigerante 1 litro', 14.00, 'bebida', null, '{}'::text[], 50),
  ('refri-dolly', 'bebidas', 'Refrigerante Dolly', 4.50, 'bebida', null, '{}'::text[], 51),
  ('suco-lata', 'bebidas', 'Suco lata', 7.00, 'bebida', null, '{}'::text[], 52),
  ('suco-1l', 'bebidas', 'Suco 1 litro', 11.00, 'bebida', null, '{}'::text[], 53),
  ('agua', 'bebidas', 'Água', 4.00, 'bebida', null, '{}'::text[], 54),
  ('h2o', 'bebidas', 'H2O', 8.00, 'bebida', null, '{}'::text[], 55)
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
where ativo and id not in ('gran-burger', 'gran-burger-bacon', 'gran-salada', 'gran-egg', 'gran-bacon', 'gran-egg-bacon', 'gran-big-tudo', 'gran-black', 'gran-big-mineiro', 'gran-chicken', 'gran-bacon-onion', 'gran-crispy', 'x-burguer', 'x-salada', 'mega-x-salada-egg', 'ultra-x-salada-bacon', 'exagerado-x-salada-egg-bacon', 'big-tudo', 'black-master', 'big-mineiro', 'dog-medio', 'dog-medio-frango', 'dog-max', 'dog-max-frango', 'dog-super', 'dog-super-frango', 'dog-doritos', 'dog-pizza', 'carne-maluca', 'x-frango', 'x-frango-egg-bacon', 'x-calabresa', 'x-churrasco', 'americano', 'combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos', 'combo-gran-burger', 'combo-gran-bacon', 'combo-gran-salada', 'combo-gran-bacon-onion', 'combo-hot-dog-max', 'combo-x-frango', 'combo-gran-chicken', 'porcao-batata', 'porcao-onion', 'refri-lata', 'refri-600', 'refri-1l', 'refri-dolly', 'suco-lata', 'suco-1l', 'agua', 'h2o');

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

-- loja: cria se não existir; depois só horarios e combo_preco vêm do CONFIG (modo e aceita_fechada são do painel)
insert into public.loja (id, modo, aceita_fechada, combo_preco, horarios)
values (1, 'auto', false, 14.90, '{"0":null,"1":["19:00","00:00"],"2":["19:00","00:00"],"3":["19:00","00:00"],"4":["19:00","00:00"],"5":["19:00","01:00"],"6":["19:00","01:00"]}'::jsonb)
on conflict (id) do update set
  horarios = excluded.horarios,
  combo_preco = excluded.combo_preco;

-- o PostgREST recarrega o schema (funções novas aparecem na API na hora)
notify pgrst, 'reload schema';

commit;

-- =====================================================================================
-- Acesso ao painel: crie o usuário em Authentication → Users (e-mail e senha) e rode,
-- trocando EMAIL_AQUI pelo e-mail dele:
--
-- insert into equipe (user_id, nome) select id, 'Dono' from auth.users where email = 'EMAIL_AQUI' on conflict do nothing;
-- =====================================================================================
