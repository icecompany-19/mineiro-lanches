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
