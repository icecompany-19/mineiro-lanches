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
