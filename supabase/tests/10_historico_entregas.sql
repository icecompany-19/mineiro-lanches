-- Histórico anterior entra na consulta por conclusão, sem atribuição inventada nem alteração dos pedidos.
begin;
\ir _ajuda.sql
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Legado, 1","distanciaKm":2}') ->> 'id' as antigo \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Legado, 2","distanciaKm":2}') ->> 'id' as sete \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Manual, 3","distanciaKm":2}') ->> 'id' as manual \gset
select pg_temp.sou(:'equipe');
select mudar_status(:'antigo','preparo'); select mudar_status(:'antigo','rota'); select baixar_entrega_manual(:'antigo','Preparação de histórico anterior');
select mudar_status(:'sete','preparo'); select mudar_status(:'sete','rota'); select baixar_entrega_manual(:'sete','Preparação de histórico anterior');
select mudar_status(:'manual','preparo'); select mudar_status(:'manual','rota'); select baixar_entrega_manual(:'manual','Baixa atual');
-- Representa o formato gravado antes da implantação. Só fixtures locais; tudo sofre rollback.
delete from entregas_eventos where pedido_id in (:'antigo',:'sete');
update pedidos set criado_em=now()-interval '40 days',historico=jsonb_build_array(
  jsonb_build_object('status','rota','em',public.data_iso(now()-interval '1 hour')),
  jsonb_build_object('status','entregue','em',public.data_iso(now()),'por','motoboy')) where id=:'antigo';
update pedidos set criado_em=now()-interval '10 days',historico=jsonb_build_array(
  jsonb_build_object('status','rota','em',public.data_iso(now()-interval '5 days 1 hour')),
  jsonb_build_object('status','entregue','em',public.data_iso(now()-interval '5 days'),'por','motoboy')) where id=:'sete';
select to_jsonb(p)::text as antes from pedidos p where id=:'antigo' \gset
set local role authenticated;
select painel_entregadores(1) as hoje \gset
select painel_entregadores(7) as semana \gset
select pg_temp.ok(:'hoje'::jsonb->'pedidos' @> jsonb_build_array(jsonb_build_object('id',:'antigo','legado',true,'encerramento','anterior')),'histórico anterior entra pelo horário da conclusão, mesmo criado fora do período');
select pg_temp.ok(not (:'hoje'::jsonb->'pedidos' @> jsonb_build_array(jsonb_build_object('id',:'sete'))),'conclusão de cinco dias atrás não entra em hoje');
select pg_temp.ok(:'semana'::jsonb->'pedidos' @> jsonb_build_array(jsonb_build_object('id',:'sete','legado',true)),'período de sete dias inclui conclusão anterior');
select pg_temp.ok(:'hoje'::jsonb->'pedidos' @> jsonb_build_array(jsonb_build_object('id',:'manual','legado',false,'encerramento','manual')),'baixa atual não vira histórico anterior');
select pg_temp.ok((select p->>'motoboyId' is null and p->>'atribuicao' is null and p->>'confirmadoEm' is null from jsonb_array_elements(:'hoje'::jsonb->'pedidos') p where p->>'id'=:'antigo'),'não inventa entregador, atribuição nem horário de aparelho');
select pg_temp.ok((select not(p ? 'token' or p ? 'telefone' or p ? 'endereco' or p ? 'historico') from jsonb_array_elements(:'hoje'::jsonb->'pedidos') p where p->>'id'=:'antigo'),'histórico mantém recorte mínimo da central');
reset role;
select pg_temp.igual((select to_jsonb(p)::text from pedidos p where id=:'antigo'),:'antes','consulta não altera o pedido original');
select pg_temp.igual((select count(*) from entregas_operacao where pedido_id in (:'antigo',:'sete'))::text,'0','consulta não cria atribuições retroativas');
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.igual(pg_temp.erro('select painel_entregadores(7)'),'sem_permissao','motoboy continua sem acesso ao histórico geral');
reset role;
select pg_temp.ok(not has_function_privilege('anon','painel_entregadores(integer)','execute'),'anon continua sem acesso à central');
rollback;
