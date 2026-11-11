-- A conciliação respondia HTTP 503 em todas as rodadas: 28 cobranças que expiraram sem nenhuma tentativa de
-- pagamento (pedidos 0094 a 0349) deixaram de ser devolvidas pela consulta do Mercado Pago depois de cerca de
-- dois dias, e voltavam à fila para falhar de novo. Order cancelada ou expirada é estado final no Mercado Pago:
-- não há o que conferir. Sair da fila libera as vagas e faz o 503 voltar a significar falha de verdade.
-- Aprovados, estornados e contestados continuam na fila (estorno e contestação mudam depois).
create or replace function public.reservar_conciliacao_mp()
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_resultado jsonb;
begin
  with candidatos as (
    select id from public.pagamentos_mp
    where order_id is not null and estado<>'cancelado' and coalesce(ultima_consulta,'-infinity')<now()-interval '1 minute'
    order by (estado in ('pendente','recusado','revisao')) desc,ultima_consulta nulls first,criado_em
    limit 12 for update skip locked
  ), reservados as (
    update public.pagamentos_mp m set ultima_consulta=now() from candidatos c where m.id=c.id returning m.*
  ) select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_resultado from reservados r;
  return v_resultado;
end $$;
revoke all on function public.reservar_conciliacao_mp() from public,anon,authenticated;
grant execute on function public.reservar_conciliacao_mp() to service_role;
