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
