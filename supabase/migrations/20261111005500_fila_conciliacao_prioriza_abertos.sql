-- Pedido 0383 (10/11): pago às 21:37, liberado às 21:49. A conciliação consultava 12 pagamentos por minuto
-- na ordem da última consulta, sem olhar o estado; com 148 registros, um pagamento novo esperava a fila
-- inteira dos já encerrados (cerca de 12 minutos, crescendo a cada pedido).
-- Agora quem ainda pode mudar a qualquer momento (pendente, recusado, em revisão) passa na frente, a cada
-- minuto; os encerrados continuam sendo conferidos (estorno, contestação) nas vagas que sobram.
create or replace function public.reservar_conciliacao_mp()
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_resultado jsonb;
begin
  with candidatos as (
    select id from public.pagamentos_mp
    where order_id is not null and coalesce(ultima_consulta,'-infinity')<now()-interval '1 minute'
    order by (estado in ('pendente','recusado','revisao')) desc,ultima_consulta nulls first,criado_em
    limit 12 for update skip locked
  ), reservados as (
    update public.pagamentos_mp m set ultima_consulta=now() from candidatos c where m.id=c.id returning m.*
  ) select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_resultado from reservados r;
  return v_resultado;
end $$;
revoke all on function public.reservar_conciliacao_mp() from public,anon,authenticated;
grant execute on function public.reservar_conciliacao_mp() to service_role;
