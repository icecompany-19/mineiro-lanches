-- Inclui o estado online para não orientar cobrança local de um pedido já pago.
create or replace function public.entrega_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.entrega_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em)
$$;
revoke all on function public.entrega_json(public.pedidos) from public;
grant execute on function public.entrega_json(public.pedidos) to anon,authenticated,service_role;
notify pgrst,'reload schema';
