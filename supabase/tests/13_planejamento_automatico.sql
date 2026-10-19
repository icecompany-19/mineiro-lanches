begin;
\ir _ajuda.sql
\set moto 44000000-0000-4000-8000-000000000003
\set outro 44000000-0000-4000-8000-000000000004
insert into auth.users(id,email) values(:'moto','automatico-moto@teste.local'),(:'outro','automatico-outro@teste.local');
insert into motoboys(user_id,nome) values(:'moto','Moto automático'),(:'outro','Outro automático');
update loja set entrega_origem=entrega_origem||jsonb_build_object('confirmadaEm',public.data_iso(now())) where id=1;
update entrega_rotas_config set cron_ativo=true,job_url='https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/planejar-entregas' where id=1;
select versao as cv from entrega_rotas_config where id=1 \gset
select pg_temp.sou(:'equipe');
select configurar_rotas('automatico','{"maxPedidos":2,"esperaMin":8,"trajetoMin":20,"desvioMin":4,"paradaMin":1}',20,:'cv');
select pg_temp.sou(:'moto'); select definir_disponibilidade_entregador('na_loja');
select pg_temp.sou(:'outro'); select definir_disponibilidade_entregador('na_loja');
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Automática, 1","distanciaKm":2}') ->> 'id' as p1 \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Automática, 2","distanciaKm":2}') ->> 'id' as p2 \gset
select pg_temp.sou(:'equipe');
select mudar_status(:'p1','preparo');select mudar_status(:'p1','pronto');
select conferir_destino_pedido(:'p1',-23.54,-46.31,'Entrada conferida com o endereço');
select pg_temp.ok((select entrega_destino->>'fonte'='equipe' and entrega_destino_ate=now()+interval '30 days' and taxa_entrega=6.00 from pedidos where id=:'p1'),'conferência atualiza o ponto sem recalcular a taxa já aceita');
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1)) as ctx \gset
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1))->>'estado','calculando','lease evita dois cálculos externos simultâneos');
select pg_temp.igual((select count(*) from entrega_rotas_execucoes)::text,'1','tentativa concorrente não reserva orçamento duplicado');
select concluir_planejamento_entregas((:'ctx'::jsonb->>'id')::uuid,jsonb_build_array(jsonb_build_object(
  'motoboyId',:'moto','segundos',240,'metros',1200,'ultimaEntregaSeg',60,
  'paradas',jsonb_build_array(jsonb_build_object('id',:'p1','chegadaSeg',60)),
  'geometria','{"type":"MultiLineString","coordinates":[[[-46.31,-23.54],[-46.311,-23.541]]]}'::jsonb))) as resultado \gset
select pg_temp.igual(:'resultado'::jsonb->>'reservadas','1','agendador reserva automaticamente um conjunto elegível');
select id as viagem,versao as vv from entrega_viagens where motoboy_id=:'moto' and estado='reservada' \gset
select pg_temp.ok((select automatica and criada_por is null and saiu_em is null from entrega_viagens where id=:'viagem'),'automação identifica origem do vínculo e aguarda saída real');
select pg_temp.ok((select status='pronto' from pedidos where id=:'p1'),'reserva automática mantém pedido pronto até a saída');
select pg_temp.igual(pg_temp.erro(format('select conferir_destino_pedido(%L,-23.54,-46.31,%L)',:'p1','Mudança')),'pedido_em_viagem','localização de carga reservada exige desfazer e replanejar');
select mudar_status(:'p2','preparo');select mudar_status(:'p2','pronto');select conferir_destino_pedido(:'p2',-23.541,-46.311,'Endereço conferido');
update entrega_rotas_execucoes set criado_em=now()-interval '6 seconds',creditos_reservados=20;
select pg_temp.igual(pg_temp.erro('select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1))'),'orcamento_rotas_esgotado','orçamento é conferido antes de usar mapas');
update entregadores_comunicacao set ultima_em=now()-interval '3 minutes' where user_id=:'outro';
select pg_temp.ok(not (estado_entregador_rotas(:'outro')->>'elegivel')::boolean,'falta de comunicação recente bloqueia nova atribuição');
update entregadores_comunicacao set ultima_em=now() where user_id=:'outro';
update entregadores_disponibilidade set desde=now()-interval '1 day' where user_id=:'outro';
select pg_temp.igual(estado_entregador_rotas(:'outro')->>'declarado','fora','declaração do turno anterior não vira presença no novo dia');
select pg_temp.sou(:'outro');select definir_disponibilidade_entregador('na_loja');
select pg_temp.ok((estado_entregador_rotas(:'outro')->>'elegivel')::boolean,'nova declaração confirma disponibilidade neste turno');
select pg_temp.sou(:'equipe');select mudar_status(:'p1','cancelado','Cancelado antes da saída');
select pg_temp.igual((select estado from entrega_viagens where id=:'viagem'),'cancelada','cancelamento de toda carga encerra reserva sem inventar saída');
select pg_temp.igual((select count(*) from entrega_viagens_paradas where viagem_id=:'viagem' and ativa)::text,'0','cancelamento libera reserva dos pedidos');
select pg_temp.igual(taxas_entregador(:'moto',now()-interval '1 day')->>'concluidas','0','pedido cancelado não entra nas taxas concluídas');
select pg_temp.ok(not has_function_privilege('authenticated','concluir_planejamento_entregas(uuid,jsonb,jsonb,jsonb,text)','execute'),'navegador não publica propostas em nome do servidor');
update entrega_rotas_execucoes set criado_em=now()-interval '6 seconds',creditos_reservados=0;
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1),jsonb_build_array(:'p2')) as corrida \gset
update pedidos set referencia='Corrigida durante o cálculo' where id=:'p2';
select concluir_planejamento_entregas((:'corrida'::jsonb->>'id')::uuid,jsonb_build_array(jsonb_build_object(
  'motoboyId',:'outro','segundos',240,'metros',1200,'ultimaEntregaSeg',60,
  'paradas',jsonb_build_array(jsonb_build_object('id',:'p2','chegadaSeg',60)),
  'geometria','{"type":"MultiLineString","coordinates":[[[-46.31,-23.54],[-46.311,-23.541]]]}'::jsonb))) as descartada \gset
select pg_temp.igual(:'descartada'::jsonb->>'reservadas','0','alteração durante cálculo automático não deixa reserva parcial');
select pg_temp.ok((select impedidos @> jsonb_build_array(jsonb_build_object('id',:'p2','motivo','revalidacao_falhou'))
  from entrega_rotas_execucoes where id=(:'corrida'::jsonb->>'id')::uuid),'painel recebe pendência quando uma reserva automática perde a revalidação');
rollback;
