-- Reproduz Supabase remoto sem DML implícito a service_role (o stub local concede mais).
begin;
\ir _ajuda.sql
revoke all on public.pedidos,public.loja,public.equipe from service_role;
\ir ../migrations/20261020145407_pagamentos_permissoes_backend.sql
select pg_temp.ok(has_table_privilege('service_role','public.pedidos','SELECT'),'backend lê o pedido sem depender de privilégios padrão');
select pg_temp.ok(has_column_privilege('service_role','public.pedidos','pagamento_online','UPDATE'),'backend atualiza estado financeiro');
select pg_temp.ok(not has_column_privilege('service_role','public.pedidos','status','UPDATE'),'correção não concede alteração do status operacional');
select pg_temp.ok(not has_table_privilege('anon','public.pedidos','SELECT'),'correção não expõe pedidos ao público');
update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=true;
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as pedido \gset
select (:'pedido'::jsonb->>'token') as token \gset
set local role service_role;
select preparar_pagamento_mp(:'token','teste@example.com',true) as pagamento \gset
select pg_temp.igual(:'pagamento'::jsonb->>'criar','true','helper invoker reserva cobrança com privilégios remotos mínimos');
select registrar_pagamento_mp((:'pagamento'::jsonb->>'id')::uuid,'ORDTST012345678901234567890999','aprovado',now(),null,'processed','accredited') as registrado \gset
select pg_temp.igual(:'registrado'::jsonb->>'estado','aprovado','helper invoker persiste confirmação com privilégios mínimos');
reset role;
rollback;
