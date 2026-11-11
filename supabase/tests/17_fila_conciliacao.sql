begin;
\ir _ajuda.sql
-- Pedido 0383 (10/11): pago às 21:37 e liberado só às 21:49, porque a conciliação percorria todos os
-- pagamentos já encerrados antes de voltar ao que estava em aberto.
update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=true;
delete from pagamentos_mp;
insert into pagamentos_mp (pedido_id,email,total,order_id,estado,ultima_consulta)
select (pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')))->>'id')::uuid,'teste@example.com',16.90,
  'ORDTST0000000000000000000000'||lpad(n::text,2,'0'),
  case when n=14 then 'pendente' else 'aprovado' end,
  case when n=14 then now()-interval '2 minutes' else now()-interval '10 minutes' end
from generate_series(1,14) n;
set local role service_role;
select reservar_conciliacao_mp() as lote \gset
reset role;
select pg_temp.igual(jsonb_array_length(:'lote'::jsonb)::text,'12','lote continua limitado a 12 consultas');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(:'lote'::jsonb) r where r->>'estado'='pendente'),
  'pagamento em aberto passa na frente dos já encerrados');
select pg_temp.igual((select count(*) from pagamentos_mp where ultima_consulta<now()-interval '1 minute')::text,'2',
  'encerrados que não couberam ficam para a próxima rodada');
set local role service_role;
select reservar_conciliacao_mp() as seguinte \gset
reset role;
select pg_temp.igual(jsonb_array_length(:'seguinte'::jsonb)::text,'2','rodada seguinte consulta os encerrados que sobraram');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(:'seguinte'::jsonb) r where r->>'estado'='pendente'),
  'em aberto respeita o intervalo de um minuto entre consultas');
rollback;
