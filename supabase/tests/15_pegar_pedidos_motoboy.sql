begin;
\ir _ajuda.sql
\set moto 46000000-0000-4000-8000-000000000005
\set outro 46000000-0000-4000-8000-000000000006
insert into auth.users(id,email) values(:'moto','pegar-moto@teste.local'),(:'outro','pegar-outro@teste.local');
insert into motoboys(user_id,nome) values(:'moto','Moto fila'),(:'outro','Outro fila');
update entrega_rotas_config set modo='desligado',regras='{}',despacho_individual_ativo=true,despacho_ativado_em=now()-interval '1 minute',
  prazo_reserva_seg=300,cron_ativo=true,job_url='https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/planejar-entregas' where id=1;
update loja set cotacao_ativa=false,pagamentos_ativos=false where id=1;
-- Outros pedidos prontos do banco local não entram nas contagens deste teste.
update pedidos set entrega_planejamento_pausado=true where status='pronto';
update pedidos set status='novo' where status='preparo' and modo='entrega';

create temp table fila as
select n,(pg_temp.novo('[{"produtoId":"gran-burger"}]',jsonb_build_object('modo','entrega','endereco','Rua da Fila, '||n,'distanciaKm',2))->>'id')::uuid id
from generate_series(1,5) n;
select id as p1 from fila where n=1 \gset
select id as p2 from fila where n=2 \gset
select id as p3 from fila where n=3 \gset
select id as p4 from fila where n=4 \gset
select id as p5 from fila where n=5 \gset
select pg_temp.sou(:'equipe');
select mudar_status(id,'preparo') from fila;
select mudar_status(id,'pronto') from fila where n<>4;
update pedidos p set historico=jsonb_set(p.historico,array[(jsonb_array_length(p.historico)-1)::text,'em'],to_jsonb(public.data_iso(now()-make_interval(mins=>10-t.n))))
  from fila t where p.id=t.id and t.n<>4;
update pedidos set entrega_planejamento_pausado=true where id=:'p5';
select taxa_entrega::text as taxa,total::text as total from pedidos where id=:'p1' \gset

-- Acesso: só o motoboy ativo consulta e pega.
select pg_temp.sou(null); set local role anon;
select pg_temp.igual(pg_temp.erro('select pedidos_disponiveis_entrega()'),'42501','anônimo não lista a fila');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p1')),'42501','anônimo não pega pedido');
reset role;
select pg_temp.sou(:'equipe'); set local role authenticated;
select pg_temp.igual(pg_temp.erro('select pedidos_disponiveis_entrega()'),'sem_permissao','equipe usa o painel, não a fila do motoboy');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p1')),'sem_permissao','equipe não pega pedido pela tela do motoboy');
select pg_temp.igual(pg_temp.erro('select motivo_pegar_pedido(auth.uid())'),'42501','helper do motivo é privado');
reset role;

-- Lista: prontos sem entregador, do mais antigo ao mais novo, sem dados pessoais.
select pg_temp.sou(:'moto'); set local role authenticated;
select pedidos_disponiveis_entrega() as fila1 \gset
select pg_temp.igual((select string_agg(x->>'id',',' order by o) from jsonb_array_elements(:'fila1'::jsonb->'pedidos') with ordinality a(x,o)),
  :'p1'||','||:'p2'||','||:'p3','lista mostra todos os prontos sem entregador, do mais antigo ao mais novo');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(:'fila1'::jsonb->'pedidos') x where x->>'id' in (:'p4',:'p5')),'pedido em preparo e pedido pausado pela equipe ficam fora');
select pg_temp.igual(:'fila1'::jsonb->>'emPreparo','1','informa quantos pedidos de entrega ainda estão em preparo');
select pg_temp.ok((select bool_and(not (x ? 'nome' or x ? 'telefone' or x ? 'itens' or x ? 'cliente')) from jsonb_array_elements(:'fila1'::jsonb->'pedidos') x),'fila não expõe nome, telefone nem itens de outros clientes');
select pg_temp.igual(:'fila1'::jsonb->>'motivo','entregador_indisponivel','fora do turno o motoboy vê a fila mas ainda não pega');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p2')),'entregador_indisponivel','pegar exige turno começado na loja');
select definir_disponibilidade_entregador('na_loja');
select pg_temp.igual(pedidos_disponiveis_entrega()->>'motivo',null,'disponível na loja pode pegar');
reset role;
update entrega_rotas_config set despacho_individual_ativo=false where id=1;
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p2')),'despacho_desligado','com o despacho pausado no painel a equipe atribui');
reset role;
update entrega_rotas_config set despacho_individual_ativo=true where id=1;

-- Pega o segundo da fila: cria a própria saída, ainda na loja.
select pg_temp.sou(:'moto'); set local role authenticated;
select pegar_pedido_entrega(:'p2') as pego \gset
select pg_temp.igual(:'pego'::jsonb#>>'{viagem,estado}','reservada','pedido pego fica reservado, sem registrar saída');
select pg_temp.igual(:'pego'::jsonb#>>'{viagem,tipoDespacho}','individual','mesmo ciclo da saída individual');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(entregas_em_rota()) x where x->>'id'=:'p2' and x->>'versaoViagem'=:'pego'::jsonb#>>'{viagem,versao}'),'pedido pego entra nas entregas do motoboy com a versão da saída');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pedidos_disponiveis_entrega()->'pedidos') x where x->>'id'=:'p2'),'pedido pego sai da fila');
reset role;
select id as viagem,versao as v1,reserva_ate as r1 from entrega_viagens where motoboy_id=:'moto' and estado='reservada' \gset
select pg_temp.ok((select not automatica and criada_por=:'moto'::uuid and origem='{}' and segundos is null and metros is null from entrega_viagens where id=:'viagem'),'saída escolhida pelo motoboy não inventa distância, tempo nem origem');
select pg_temp.ok((select status='pronto' from pedidos where id=:'p2'),'pegar não muda o status do pedido');
select pg_temp.ok(exists(select 1 from entregas_eventos where pedido_id=:'p2' and tipo='atribuicao' and autor=:'moto'::uuid and dados->>'origem'='motoboy_pegou'),'auditoria registra quem pegou');

-- Disputa: o outro motoboy não leva o mesmo pedido.
select pg_temp.sou(:'outro'); select definir_disponibilidade_entregador('na_loja'); set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p2')),'pedido_indisponivel','segundo motoboy no mesmo pedido é recusado');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p4')),'pedido_indisponivel','pedido em preparo não pode ser pego');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p5')),'pedido_indisponivel','pedido pausado pela equipe não pode ser pego');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',gen_random_uuid())),'nao_encontrado','pedido inexistente');
reset role;
select pg_temp.igual((select motoboy_id::text from entregas_operacao where pedido_id=:'p2'),:'moto','vínculo do primeiro motoboy é preservado');

-- Pega mais um antes de sair: a saída muda de versão e precisa ser carregada de novo.
select pg_temp.sou(:'moto'); set local role authenticated;
select pegar_pedido_entrega(:'p1');
reset role;
select versao as v2 from entrega_viagens where id=:'viagem' \gset
select pg_temp.ok(:'v2'::uuid<>:'v1'::uuid and (select carregada_versao is null and reserva_ate>=:'r1'::timestamptz from entrega_viagens where id=:'viagem'),'pedido acrescentado troca a versão, exige nova carga e não encurta a reserva');
select pg_temp.igual((select string_agg(pedido_id::text||':'||ordem,',' order by ordem) from entrega_viagens_paradas where viagem_id=:'viagem'),:'p2'||':1,'||:'p1'||':2','pedido acrescentado entra no fim da sequência');
select pg_temp.ok(exists(select 1 from entrega_rotas_eventos where viagem_id=:'viagem' and tipo='pedido_acrescentado' and dados->>'pedido'=:'p1'),'auditoria registra o pedido acrescentado');
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select reconhecer_carregamento_viagem(%L,%L)',:'viagem',:'v1')),'versao_alterada','celular com a saída antiga não reconhece a carga');
select reconhecer_carregamento_viagem(:'viagem',:'v2');
select pg_temp.igual(pg_temp.erro(format('select iniciar_viagem_entrega(%L,%L)',:'viagem',:'v1')),'versao_alterada','saída antiga não leva só parte dos pedidos');
select iniciar_viagem_entrega(:'viagem',:'v2');
reset role;
select pg_temp.ok((select bool_and(status='rota') from pedidos where id in (:'p1',:'p2')),'saída registra todos os pedidos pegos');

-- Depois da saída a fila fica só para consulta.
select pg_temp.sou(:'moto'); set local role authenticated;
select pg_temp.igual(pedidos_disponiveis_entrega()->>'motivo','entrega_em_andamento','na rua não pega outro');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pedidos_disponiveis_entrega()->'pedidos') x where x->>'id'=:'p3'),'fila continua visível para consulta até o retorno');
select pg_temp.igual(pg_temp.erro(format('select pegar_pedido_entrega(%L)',:'p3')),'entrega_em_andamento','pegar depois da saída é recusado');
reset role;

-- Outro motoboy pega o restante; o job não duplica nem troca vínculos.
select pg_temp.sou(:'outro'); set local role authenticated;
select pegar_pedido_entrega(:'p3');
reset role;
select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config)) as job \gset
select pg_temp.igual(:'job'::jsonb->>'reservadas','0','job não reserva de novo pedidos já pegos');
select pg_temp.igual((select count(*)::text from entrega_viagens where motoboy_id=:'outro' and estado='reservada'),'1','uma saída aberta por motoboy');

-- Limite técnico de seis paradas e reserva vencida.
select id as viagem_outro from entrega_viagens where motoboy_id=:'outro' and estado='reservada' \gset
update entrega_viagens_paradas set ordem=6 where viagem_id=:'viagem_outro';
select pg_temp.sou(:'outro'); set local role authenticated;
select pg_temp.igual(pedidos_disponiveis_entrega()->>'motivo','limite_viagem','saída com seis pedidos não aceita outro');
reset role;
update entrega_viagens_paradas set ordem=1 where viagem_id=:'viagem_outro';
update entrega_viagens set reserva_ate=now()-interval '1 second' where id=:'viagem_outro';
select pg_temp.sou(:'outro'); set local role authenticated;
select pg_temp.igual(pedidos_disponiveis_entrega()->>'motivo','reserva_expirada','reserva vencida não recebe pedido novo');
reset role;
select pg_temp.igual(iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config))->>'expiradas','1','job libera reserva vencida de pedido pego');
select pg_temp.ok(not exists(select 1 from entregas_operacao where pedido_id=:'p3'),'pedido da reserva vencida volta para a fila');
select pg_temp.igual(estado_entregador_rotas(:'outro')->>'situacao','pausado','quem não saiu precisa reafirmar disponibilidade');

select pg_temp.igual((select taxa_entrega::text from pedidos where id=:'p1'),:'taxa','pegar preserva a taxa aceita');
select pg_temp.igual((select total::text from pedidos where id=:'p1'),:'total','pegar preserva o valor do pedido');
select pg_temp.ok(not has_table_privilege('authenticated','entregas_operacao','select') and not has_table_privilege('authenticated','entrega_viagens','select'),'tabelas continuam privadas');
rollback;
