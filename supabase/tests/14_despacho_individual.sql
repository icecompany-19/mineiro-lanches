begin;
\ir _ajuda.sql
\set moto 46000000-0000-4000-8000-000000000003
\set outro 46000000-0000-4000-8000-000000000004
insert into auth.users(id,email) values(:'moto','despacho-moto@teste.local'),(:'outro','despacho-outro@teste.local');
insert into motoboys(user_id,nome) values(:'moto','Moto despacho'),(:'outro','Outro despacho');
update entrega_rotas_config set modo='desligado',regras='{}',despacho_individual_ativo=false,
  cron_ativo=true,job_url='https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/planejar-entregas' where id=1;
update loja set entrega_origem=entrega_origem-'confirmadaEm',cotacao_ativa=false,pagamentos_ativos=false where id=1;
insert into entregadores_disponibilidade(user_id,situacao,desde) values(:'moto','na_loja',now()-interval '10 minutes');
select versao as cv from entrega_rotas_config where id=1 \gset
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select configurar_despacho_entregas(true,%L)',:'cv')),'sem_permissao','motoboy não muda a configuração global');
select pg_temp.igual(pg_temp.erro('select processar_despacho_individual()'),'42501','navegador não executa motor privado');
reset role;
select pg_temp.sou(:'equipe'); set local role authenticated;
select configurar_despacho_entregas(true,:'cv') as cfg \gset
select pg_temp.ok((:'cfg'::jsonb->>'despachoIndividualAtivo')::boolean and :'cfg'::jsonb->>'modo'='desligado','despacho liga sem preparar rotas, GPS ou limites comerciais');
select pg_temp.igual(:'cfg'::jsonb->>'prazoReservaSeg','300','prazo técnico inicial de reserva é cinco minutos');
select pg_temp.ok(not (:'cfg'::jsonb ? 'job_token' or :'cfg'::jsonb ? 'jobToken'),'configuração não devolve segredo do job');
select pg_temp.igual(pg_temp.erro(format('select configurar_despacho_entregas(true,%L)',:'cv')),'versao_alterada','configuração concorrente não sobrescreve versão atual');
reset role;
select pg_temp.igual(estado_entregador_rotas(:'moto')->>'declarado','fora','presença anterior à ativação não é herdada');

create temp table pedidos_despacho as
select n,(pg_temp.novo('[{"produtoId":"gran-burger"}]',jsonb_build_object('modo','entrega','endereco','Rua Despacho, '||n,'distanciaKm',2))->>'id')::uuid id
from generate_series(1,4) n;
select id as p1 from pedidos_despacho where n=1 \gset
select id as p2 from pedidos_despacho where n=2 \gset
select id as p3 from pedidos_despacho where n=3 \gset
select id as p4 from pedidos_despacho where n=4 \gset
select mudar_status(id,'preparo') from pedidos_despacho;
select mudar_status(id,'pronto') from pedidos_despacho;
update pedidos p set entrega_destino=null,entrega_destino_ate=null,
  historico=jsonb_set(p.historico,array[(jsonb_array_length(p.historico)-1)::text,'em'],to_jsonb(public.data_iso(now()-make_interval(mins=>10-t.n))))
  from pedidos_despacho t where p.id=t.id;
update pedidos set entrega_planejamento_pausado=true where id=:'p4';
select taxa_entrega::text as taxa,total::text as total from pedidos where id=:'p1' \gset
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config))->>'reservadas','0','pedido aguarda declaração atual de presença');
select pg_temp.igual(pg_temp.erro('select iniciar_planejamento_entregas(null,''incorreto'')'),'sem_permissao','token inválido não executa despacho');
select pg_temp.sou(:'moto'); select definir_disponibilidade_entregador('na_loja');
select pg_temp.ok((estado_entregador_rotas(:'moto')->>'elegivel')::boolean,'mesma situação na_loja renova declaração anterior à ativação');
select pg_temp.sou(:'outro'); select definir_disponibilidade_entregador('na_loja');
-- Simula declarações em transações sucessivas sem sleeps no teste.
update entrega_rotas_config set despacho_ativado_em=now()-interval '1 minute';
update entregadores_disponibilidade set desde=now()-interval '20 seconds' where user_id=:'moto';
update entregadores_disponibilidade set desde=now()-interval '10 seconds' where user_id=:'outro';
update entregadores_comunicacao set ultima_em=now()-interval '1 hour' where user_id in (:'moto',:'outro');
select pg_temp.ok((estado_entregador_rotas(:'moto')->>'elegivel')::boolean,'turno explícito continua elegível com celular em espera');
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config)) as despacho \gset
select pg_temp.igual(:'despacho'::jsonb->>'reservadas','2','cada entregador disponível recebe um pedido sem usar mapas');
select pg_temp.igual((select motoboy_id::text from entregas_operacao where pedido_id=:'p1'),:'moto','pedido mais antigo vai a quem espera há mais tempo');
select pg_temp.igual((select count(*) from entrega_viagens_paradas s join entrega_viagens v on v.id=s.viagem_id where v.tipo_despacho='individual' and s.ativa)::text,'2','cada saída individual tem uma parada');
select pg_temp.ok((select bool_and(segundos is null and metros is null and ultima_entrega_seg is null and geometria is null and origem='{}') from entrega_viagens where tipo_despacho='individual'),'nenhuma origem, distância ou tempo fictício é criado');
select pg_temp.ok((select bool_and(status='pronto') from pedidos where id in (:'p1',:'p2')),'reserva automática não registra saída física');
select pg_temp.ok(not exists(select 1 from entregas_operacao where pedido_id in (:'p3',:'p4')),'pedidos sem entregador e pausados conservam a fila');
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config))->>'reservadas','0','job repetido não duplica viagens nem atribuições');
select pg_temp.igual((select sum(creditos_reservados) from entrega_rotas_execucoes)::text,'0','despacho individual não consome créditos de mapas');
select id as viagem1,versao as v1 from entrega_viagens where motoboy_id=:'moto' and estado='reservada' \gset
select id as viagem2,versao as v2 from entrega_viagens where motoboy_id=:'outro' and estado='reservada' \gset
select atribuicao as a1 from entregas_operacao where pedido_id=:'p1' \gset
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.igual(minha_operacao_rotas()#>>'{viagem,tipoDespacho}','individual','DTO próprio identifica despacho sem mapas');
select pg_temp.igual(minha_operacao_rotas()#>>'{viagem,metros}',null,'DTO preserva distância desconhecida como null');
select pg_temp.igual(pg_temp.erro(format('select iniciar_viagem_entrega(%L,%L)',:'viagem1',:'v1')),'carregamento_pendente','saída exige versão persistida e reconhecida');
select reconhecer_carregamento_viagem(:'viagem1',:'v1');
select iniciar_viagem_entrega(:'viagem1',:'v1');
select pg_temp.igual(pg_temp.erro(format('select retornar_viagem_entrega(%L,%L)',:'viagem1',:'v1')),'entregas_pendentes','retorno continua bloqueado antes das baixas sincronizadas');
reset role;
update entrega_viagens set reserva_ate=now()-interval '1 second' where id=:'viagem1';
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config))->>'expiradas','0','prazo técnico nunca desfaz viagem que já saiu');
select pg_temp.sou(:'moto'); set local role authenticated;
select confirmar_entrega_offline(:'p1',gen_random_uuid(),:'a1',now());
select pg_temp.igual(minha_operacao_rotas()#>>'{viagem,estado}','retornando','conclusão inicia retorno, sem liberar motoboy na rua');
select retornar_viagem_entrega(:'viagem1',:'v1');
reset role;
select pg_temp.ok((estado_entregador_rotas(:'moto')->>'elegivel')::boolean,'retorno explícito libera próximo despacho');
select pg_temp.igual((select taxa_entrega::text from pedidos where id=:'p1'),:'taxa','despacho preserva a taxa aceita');
select pg_temp.igual((select total::text from pedidos where id=:'p1'),:'total','despacho preserva o valor do pedido');
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config));
select pg_temp.ok(exists(select 1 from entregas_operacao where pedido_id=:'p3' and motoboy_id=:'moto'),'pedido que aguardava entra após retorno');

-- Carga reconhecida não pode manter uma reserva órfã para sempre.
select pg_temp.sou(:'outro'); select reconhecer_carregamento_viagem(:'viagem2',:'v2');
update entrega_viagens set reserva_ate=now()-interval '1 second' where id=:'viagem2';
select pg_temp.igual(pg_temp.erro(format('select iniciar_viagem_entrega(%L,%L)',:'viagem2',:'v2')),'reserva_expirada','saída com prazo vencido não antecipa o job de limpeza');
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config)) as expiracao \gset
select pg_temp.igual(:'expiracao'::jsonb->>'expiradas','1','reserva sem saída expira mesmo reconhecida');
select pg_temp.ok((select estado='cancelada' and versao<>:'v2'::uuid and carregada_versao is null from entrega_viagens where id=:'viagem2'),'expiração invalida versão e carga antigas');
select pg_temp.igual(estado_entregador_rotas(:'outro')->>'situacao','pausado','entregador que não saiu precisa reafirmar disponibilidade');
select pg_temp.ok(not exists(select 1 from entregas_operacao where pedido_id=:'p2'),'expiração devolve pedido à fila sem reserva repetida para o mesmo motoboy');
select pg_temp.ok(exists(select 1 from entrega_rotas_eventos where viagem_id=:'viagem2' and tipo='reserva_expirada' and dados->>'carregada'='true'),'expiração registra causa e carga anterior na auditoria');
select pg_temp.igual(pg_temp.erro(format('select iniciar_viagem_entrega(%L,%L)',:'viagem2',:'v2')),'versao_alterada','celular com versão antiga não inicia viagem desfeita');
select definir_disponibilidade_entregador('na_loja');
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config));
select pg_temp.ok(exists(select 1 from entregas_operacao where pedido_id=:'p2' and motoboy_id=:'outro'),'nova presença permite reprocessamento seguro do pedido');

-- Desligar mantém viagens e ainda permite limpar reservas sem saída pelo job.
select pg_temp.sou(:'equipe');
select versao as cv from entrega_rotas_config \gset
select configurar_despacho_entregas(false,:'cv',30,300);
select pg_temp.ok(not (estado_entregador_rotas(:'outro')->>'elegivel')::boolean,'motoboy com viagem permanece ocupado após desligar');
delete from auth.users where id=:'outro';
select pg_temp.ok(exists(select 1 from entrega_viagens where tipo_despacho='individual' and estado='reservada' and motoboy_id is null),'exclusão administrativa conserva viagem para liberação segura');
update entrega_viagens set reserva_ate=now()-interval '1 second' where tipo_despacho='individual' and estado='reservada';
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config))->>'expiradas','2','job limpa reservas com cadastro removido mesmo com ambos modos desligados');
select pg_temp.ok(not exists(select 1 from entrega_viagens where tipo_despacho='individual' and estado='reservada'),'desativação não deixa reservas sem saída presas');
select pg_temp.ok(not has_table_privilege('authenticated','entrega_viagens','select') and not has_table_privilege('anon','entrega_rotas_config','select'),'RLS e tabelas privadas permanecem sem acesso direto');

-- Roteirização anterior mantém suas condições, com janela apenas quando agrupada.
update loja set entrega_origem=entrega_origem||jsonb_build_object('confirmadaEm',public.data_iso(now()));
select versao as cv from entrega_rotas_config \gset
select configurar_rotas('automatico','{"maxPedidos":2,"esperaMin":8,"trajetoMin":20,"desvioMin":4,"paradaMin":1}',1000,:'cv');
select pg_temp.sou(:'moto'); select definir_disponibilidade_entregador('na_loja');
update entregadores_comunicacao set ultima_em=now()-interval '3 minutes' where user_id=:'moto';
select pg_temp.ok(not (estado_entregador_rotas(:'moto')->>'elegivel')::boolean,'modo por percurso conserva exigência anterior de comunicação recente');
update entregadores_comunicacao set ultima_em=now() where user_id=:'moto';
update pedidos set entrega_planejamento_pausado=true where id in (:'p2',:'p3');
update pedidos set entrega_planejamento_pausado=false,entrega_destino='{"lat":-23.54,"lon":-46.31}',entrega_destino_ate=now()+interval '1 day',
  historico=jsonb_set(historico,array[(jsonb_array_length(historico)-1)::text,'em'],to_jsonb(public.data_iso(now()))) where id=:'p4';
update entrega_rotas_execucoes set criado_em=now()-interval '6 seconds';
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config))->>'estado','aguarde','janela de agrupamento aguarda pedido recém-pronto no modo automático por percurso');
update pedidos set historico=jsonb_set(historico,array[(jsonb_array_length(historico)-1)::text,'em'],to_jsonb(public.data_iso(now()-interval '31 seconds'))) where id=:'p4';
update pedidos set entrega_planejamento_pausado=false,entrega_destino='{"lat":-23.541,"lon":-46.311}',entrega_destino_ate=now()+interval '1 day',
  historico=jsonb_set(historico,array[(jsonb_array_length(historico)-1)::text,'em'],to_jsonb(public.data_iso(now()))) where id=:'p2';
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config)) as agrupado \gset
select pg_temp.igual(:'agrupado'::jsonb->>'estado','calcular','fim da janela mantém cálculo real de percursos existente');
select pg_temp.igual(jsonb_array_length(:'agrupado'::jsonb->'pedidos')::text,'2','fim da janela inclui também pedido que acabou de ficar pronto');

-- Simula uma atribuição manual de pedido posterior enquanto o cursor processa
-- o primeiro: a gravação não altera pedidos, apenas entregas_operacao.
\set corrida_a 46000000-0000-4000-8000-000000000021
\set corrida_b 46000000-0000-4000-8000-000000000022
\set manual 46000000-0000-4000-8000-000000000023
insert into auth.users(id,email) values(:'corrida_a','corrida-a@teste.local'),(:'corrida_b','corrida-b@teste.local'),(:'manual','corrida-manual@teste.local');
insert into motoboys(user_id,nome) values(:'corrida_a','Corrida A'),(:'corrida_b','Corrida B'),(:'manual','Escolha manual');
update pedidos set entrega_planejamento_pausado=true where id in (select id from pedidos_despacho);
select versao as cv from entrega_rotas_config \gset
select pg_temp.sou(:'equipe'); select configurar_despacho_entregas(true,:'cv');
insert into entregadores_disponibilidade(user_id,situacao) values(:'corrida_a','na_loja'),(:'corrida_b','na_loja');
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Corrida, 1","distanciaKm":2}')->>'id' as corrida_p1 \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Corrida, 2","distanciaKm":2}')->>'id' as corrida_p2 \gset
select mudar_status(:'corrida_p1','preparo');select mudar_status(:'corrida_p1','pronto');
select mudar_status(:'corrida_p2','preparo');select mudar_status(:'corrida_p2','pronto');
update pedidos set historico=jsonb_set(historico,array[(jsonb_array_length(historico)-1)::text,'em'],to_jsonb(public.data_iso(now()-interval '1 minute'))) where id=:'corrida_p1';
select set_config('teste.corrida.primeiro',:'corrida_p1',true),set_config('teste.corrida.segundo',:'corrida_p2',true),set_config('teste.corrida.manual',:'manual',true);
create function pg_temp.atribuir_durante_cursor() returns trigger language plpgsql as $$
begin
  if new.pedido_id=current_setting('teste.corrida.primeiro')::uuid then
    perform public.atribuir_entrega(current_setting('teste.corrida.segundo')::uuid,current_setting('teste.corrida.manual')::uuid,false);
  end if;
  return new;
end $$;
create trigger teste_atribuicao_durante_cursor before insert on entregas_operacao for each row execute function pg_temp.atribuir_durante_cursor();
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config));
select pg_temp.igual((select motoboy_id::text from entregas_operacao where pedido_id=:'corrida_p2'),:'manual','cursor não sobrescreve atribuição manual ocorrida após sua abertura');
select pg_temp.ok(not exists(select 1 from entrega_viagens_paradas where pedido_id=:'corrida_p2' and ativa),'pedido atribuído manualmente não recebe viagem órfã');
rollback;
