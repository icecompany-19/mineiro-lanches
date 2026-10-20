begin;
\ir _ajuda.sql
\set moto 42000000-0000-4000-8000-000000000003
\set outro 42000000-0000-4000-8000-000000000004
insert into auth.users(id,email) values(:'moto','viagem-moto@teste.local'),(:'outro','viagem-outro@teste.local');
insert into motoboys(user_id,nome) values(:'moto','Moto viagens'),(:'outro','Outro viagens');
update loja set entrega_origem=entrega_origem||jsonb_build_object('confirmadaEm',public.data_iso(now())) where id=1;
select versao as cfgversao from entrega_rotas_config where id=1 \gset
select pg_temp.sou(:'equipe'); set local role authenticated;
select configurar_rotas('assistido','{"maxPedidos":3,"esperaMin":10,"trajetoMin":30,"desvioMin":5,"paradaMin":1}',1000,:'cfgversao') as cfg \gset
select pg_temp.ok(not (:'cfg'::jsonb ? 'job_token' or :'cfg'::jsonb ? 'jobToken'),'configuração nunca devolve token do agendador');
select pg_temp.igual(pg_temp.erro('select iniciar_planejamento_entregas(null)'),'42501','contexto do servidor não é RPC da equipe');
reset role;
select pg_temp.sou(:'moto'); set local role authenticated;
select definir_disponibilidade_entregador('na_loja');
select pg_temp.igual(minha_operacao_rotas()#>>'{entregador,declarado}','na_loja','motoboy declara presença na loja');
select pg_temp.igual(pg_temp.erro('select painel_rotas_entregas()'),'sem_permissao','motoboy não vê planejamento dos demais');
select pg_temp.igual(pg_temp.erro(format('select definir_disponibilidade_entregador(%L,%L)', 'na_loja',:'outro')),'sem_permissao','motoboy não altera disponibilidade alheia');
reset role;
select pg_temp.sou(:'outro'); select definir_disponibilidade_entregador('na_loja');

create temp table pedidos_viagem as
select n,(pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Viagens, 10","distanciaKm":2}') ->> 'id')::uuid as id
from generate_series(1,4) n;
update pedidos p set entrega_destino=jsonb_build_object('lat',-23.5409+t.n*0.001,'lon',-46.3129),entrega_destino_ate=now()+interval '30 days'
  from pedidos_viagem t where p.id=t.id;
select pg_temp.sou(:'equipe');
select mudar_status(id,'preparo') from pedidos_viagem;
select mudar_status(id,'pronto') from pedidos_viagem;
select jsonb_agg(id order by n) as ids from pedidos_viagem where n<=2 \gset
select id as p1 from pedidos_viagem where n=1 \gset
select id as p2 from pedidos_viagem where n=2 \gset
select id as p3 from pedidos_viagem where n=3 \gset
select id as p4 from pedidos_viagem where n=4 \gset

create function pg_temp.prever(p_autor uuid,p_moto uuid,p_ids jsonb) returns uuid language plpgsql as $$
declare c jsonb; proposta jsonb; plano uuid;
begin
  update entrega_rotas_execucoes set criado_em=now()-interval '6 seconds' where estado<>'calculando';
  c:=iniciar_planejamento_entregas(p_autor,null,p_ids);
  if c->>'estado'<>'calcular' then raise exception 'fixture sem contexto: %',c; end if;
  proposta:=jsonb_build_object('motoboyId',p_moto,'segundos',600,'metros',2500,'ultimaEntregaSeg',jsonb_array_length(p_ids)*60,
    'paradas',(select jsonb_agg(jsonb_build_object('id',x,'chegadaSeg',a.n*60) order by a.n) from jsonb_array_elements_text(p_ids) with ordinality a(x,n)),
    'geometria','{"type":"MultiLineString","coordinates":[[[-46.3129,-23.5409],[-46.3129,-23.5399]]]}'::jsonb);
  perform concluir_planejamento_entregas((c->>'id')::uuid,jsonb_build_array(proposta),'[]');
  select id into plano from entrega_rotas_planos where execucao_id=(c->>'id')::uuid;
  return plano;
end $$;
select pg_temp.prever(:'equipe',:'moto',:'ids') as plano \gset
select pg_temp.igual((select count(*) from entregas_operacao where pedido_id in (:'p1',:'p2'))::text,'0','sugestão não atribui pedidos');
set local role authenticated;
select reservar_viagem_entrega(:'plano') as reserva \gset
select :'reserva'::jsonb->>'id' as viagem \gset
select pg_temp.igual(reservar_viagem_entrega(:'plano')->>'id',:'viagem','repetir reserva devolve a mesma viagem');
reset role;
select versao as versao from entrega_viagens where id=:'viagem' \gset
select atribuicao as a1 from entregas_operacao where pedido_id=:'p1' \gset
select atribuicao as a2 from entregas_operacao where pedido_id=:'p2' \gset
select pg_temp.ok((select bool_and(status='pronto') from pedidos where id in (:'p1',:'p2')),'reserva não antecipa saída');
select pg_temp.igual((select count(*) from entrega_viagens_paradas where viagem_id=:'viagem')::text,'2','reserva liga o conjunto uma única vez');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select iniciar_viagem_entrega(%L,%L)',:'viagem',:'versao')),'carregamento_pendente','saída exige reconhecimento do carregamento');
select pg_temp.igual(pg_temp.erro(format('select atribuir_entrega(%L,%L,true)',:'p1',:'moto')),'pedido_em_viagem','saída individual não fragmenta uma viagem');
reset role;
select pg_temp.sou(:'outro'); set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select reconhecer_carregamento_viagem(%L,%L)',:'viagem',:'versao')),'nao_atribuido','outro motoboy não reconhece carga');
select pg_temp.ok(minha_operacao_rotas()->'viagem'='null'::jsonb,'consulta própria não expõe a viagem alheia');
reset role;
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.ok(minhas_entregas() @> jsonb_build_array(jsonb_build_object('id',:'p1','ordemViagem',1,'versaoViagem',:'versao')),'lista própria recebe ordem e versão da viagem');
select reconhecer_carregamento_viagem(:'viagem',:'versao');
select iniciar_viagem_entrega(:'viagem',:'versao');
select pg_temp.ok((iniciar_viagem_entrega(:'viagem',:'versao')->>'jaIniciada')::boolean,'repetir saída não regrava a operação');
reset role;
select pg_temp.ok((select bool_and(status='rota') from pedidos where id in (:'p1',:'p2')),'saída marca todos os pedidos atomicamente');
select pg_temp.igual((select count(*) from entrega_rotas_eventos where viagem_id=:'viagem' and tipo='saida')::text,'1','uma saída na auditoria');
select pg_temp.sou(:'equipe'); set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select desfazer_viagem_entrega(%L,%L,%L)',:'viagem',:'versao','Ajuste')),'entrega_em_andamento','viagem saída não é desfeita');
reset role;
select pg_temp.sou(:'moto'); set local role authenticated;
select confirmar_entrega_offline(:'p1',gen_random_uuid(),:'a1',now());
select pg_temp.igual(pg_temp.erro(format('select retornar_viagem_entrega(%L,%L)',:'viagem',:'versao')),'entregas_pendentes','retorno exige conferência das entregas abertas');
reset role;
select pg_temp.sou(:'equipe'); select baixar_entrega_manual(:'p2','Conferido no retorno');
select to_jsonb(e)::text as baixa from entregas_operacao e where pedido_id=:'p2' \gset
select pg_temp.sou(:'moto'); set local role authenticated;
select confirmar_entrega_offline(:'p2',gen_random_uuid(),:'a2',now());
select pg_temp.igual(minha_operacao_rotas()#>>'{viagem,estado}','retornando','última entrega concluída indica retorno, não disponibilidade');
select retornar_viagem_entrega(:'viagem',:'versao');
select pg_temp.ok((minha_operacao_rotas()#>>'{entregador,elegivel}')::boolean,'retorno explícito permite uma nova viagem');
reset role;
select pg_temp.igual((select to_jsonb(e)::text from entregas_operacao e where pedido_id=:'p2'),:'baixa','envio posterior preserva baixa manual também dentro da viagem');
update entrega_viagens set estado='retornando' where id=:'viagem';
update motoboys set ativo=false where user_id=:'moto';
select pg_temp.sou(:'equipe');set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select retornar_viagem_entrega(%L,%L)',:'viagem',:'versao')),'motivo_obrigatorio','equipe precisa justificar retorno de cadastro desativado');
select retornar_viagem_entrega(:'viagem',:'versao','Retorno conferido antes de encerrar o acesso');
reset role;
select pg_temp.ok((select estado='encerrada' from entrega_viagens where id=:'viagem') and
  (select situacao='fora' from entregadores_disponibilidade where user_id=:'moto'),'equipe encerra viagem de cadastro inativo sem torná-lo disponível');

select pg_temp.prever(:'equipe',:'outro',jsonb_build_array(:'p3')) as plano3 \gset
select pg_temp.sou(:'equipe'); select reservar_viagem_entrega(:'plano3') ->> 'id' as viagem3 \gset
select versao as v3 from entrega_viagens where id=:'viagem3' \gset
select desfazer_viagem_entrega(:'viagem3',:'v3','Separar pedido para outra saída');
select pg_temp.ok((select status='pronto' and entrega_planejamento_pausado from pedidos where id=:'p3'),'desfazer mantém pedido pronto e pausa seleção automática');
select pg_temp.igual((select count(*) from entregas_operacao where pedido_id=:'p3')::text,'0','desfazer libera atribuição sem apagar o pedido');
select pg_temp.igual((select count(*) from entregas_eventos where pedido_id=:'p3' and tipo='viagem_desfeita')::text,'1','correção conserva autor e motivo no histórico');
update entrega_rotas_execucoes set criado_em=now()-interval '6 seconds';
update entrega_rotas_config set modo='automatico' where id=1;
update pedidos set entrega_planejamento_pausado=true where id=:'p4';
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1))->>'estado','sem_pedidos','automação respeita pedidos pausados pela equipe');
select pg_temp.igual(pg_temp.erro('select iniciar_planejamento_entregas(null,''incorreto'')'),'sem_permissao','token inválido não aciona o planejador');
select pg_temp.sou(:'equipe'); select liberar_planejamento_pedidos(jsonb_build_array(:'p4'));
select pg_temp.ok((select not entrega_planejamento_pausado from pedidos where id=:'p4'),'liberação explícita devolve o pedido à seleção');
select pg_temp.prever(:'equipe',:'outro',jsonb_build_array(:'p4')) as plano4 \gset
update pedidos set referencia='Endereço foi corrigido após o cálculo' where id=:'p4';
select pg_temp.igual(pg_temp.erro(format('select reservar_viagem_entrega(%L)',:'plano4')),'pedido_alterado','alteração de dados invalida proposta anterior');
select pg_temp.igual((select count(*) from entregas_operacao where pedido_id=:'p4')::text,'0','proposta inválida não deixa atribuição parcial');
select pg_temp.ok(not has_function_privilege('anon','minha_operacao_rotas()','execute') and
  not has_table_privilege('authenticated','entrega_rotas_config','select'),'anônimo e acesso direto não expõem viagens ou secrets');
rollback;
