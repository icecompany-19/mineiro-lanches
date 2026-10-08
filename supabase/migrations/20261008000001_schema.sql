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
