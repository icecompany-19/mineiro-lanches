-- Aplicar somente NO PROJETO DE HOMOLOGAÇÃO, depois do deploy das Edge Functions.
-- No Vault do Supabase, cadastrar pela interface (sem commitar valores):
-- mineiro_mp_api_url = https://<ref-do-projeto>.supabase.co
-- mineiro_mp_service_key = credencial service_role DESSE projeto
-- Nenhum valor é escrito neste arquivo ou enviado para o navegador.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('mineiro-mp-reconciliar','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='mineiro_mp_api_url')||'/functions/v1/mercado-pago',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='mineiro_mp_service_key')),
    body := '{"acao":"reconciliar"}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);

-- Conferir execução sem exibir cabeçalhos/segredos:
-- select jobid,status,start_time,end_time from cron.job_run_details order by start_time desc limit 10;
-- select id,status_code,timed_out,error_msg from net._http_response order by id desc limit 10;
-- Reverter somente a rotina: select cron.unschedule('mineiro-mp-reconciliar');
