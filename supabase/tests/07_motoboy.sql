-- Contrato operacional: atribuição, isolamento, saída, confirmação offline e baixa manual auditada.
begin;
\ir _ajuda.sql
\set outro 00000000-0000-4000-8000-000000000004
insert into auth.users(id,email) values(:'outro','outro-moto@teste.local') on conflict do nothing;
insert into motoboys(user_id,nome) values(:'outro','Outro entregador') on conflict(user_id) do update set ativo=true;
update motoboys set ativo=true where user_id=:'moto';
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Teste, 1","distanciaKm":2.5}') ->> 'id' as p1 \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Teste, 2","distanciaKm":2.5}') ->> 'id' as p2 \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Teste, 3","distanciaKm":2.5}') ->> 'id' as p3 \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Teste, 4","distanciaKm":2.5}') ->> 'id' as p4 \gset
select pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Teste, 5","distanciaKm":2.5}') ->> 'id' as p5 \gset
select gen_random_uuid() as evento1,gen_random_uuid() as evento2,gen_random_uuid() as evento3 \gset

-- Privilégios, RLS e isolamento.
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in ('entregas_operacao'::regclass,'entregas_eventos'::regclass,'entregadores_comunicacao'::regclass)), 'RLS nas três tabelas operacionais');
select pg_temp.ok(not has_table_privilege('authenticated','entregas_operacao','select') and not has_table_privilege('anon','entregas_eventos','select'),'tabelas operacionais privadas');
select pg_temp.ok(not has_function_privilege('anon','confirmar_entrega_offline(uuid,uuid,uuid,timestamptz)','execute'),'anon sem confirmação offline');
select pg_temp.ok(not has_function_privilege('authenticated','acompanhar_entrega_operacao()','execute'),'trigger não é API pública');
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select painel_entregadores(1)'),'sem_permissao','usuário externo sem painel');
select pg_temp.igual(pg_temp.erro('select minhas_entregas()'),'sem_permissao','usuário externo sem lista');
reset role;
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select painel_entregadores(1)'),'sem_permissao','motoboy não ganha painel');
select pg_temp.igual(pg_temp.erro(format('select atribuir_entrega(%L,%L)',:'p1',:'moto')),'sem_permissao','motoboy não atribui pedidos');
select pg_temp.igual(pg_temp.erro(format('select baixar_entrega_manual(%L,%L)',:'p1','teste')),'sem_permissao','motoboy não dá baixa manual');
select pg_temp.igual((select count(*) from pedidos)::text,'0','motoboy não lê pedidos diretamente');
select pg_temp.igual((select count(*) from clientes)::text,'0','motoboy não lê clientes');
select pg_temp.igual(pg_temp.erro('select count(*) from entregas_eventos'),'42501','motoboy não lê auditoria diretamente');
reset role;

select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select atribuir_entrega(%L,%L)',:'p1',:'moto')),'transicao_invalida','pedido novo não sai antes do aceite');
select mudar_status(:'p1','preparo');
select mudar_status(:'p2','preparo');
select mudar_status(:'p3','preparo');
select mudar_status(:'p4','preparo');
select mudar_status(:'p5','preparo');
select atribuir_entrega(:'p1',:'moto');
select atribuir_entrega(:'p2',:'outro',true);
select atribuir_entrega(:'p3',:'moto',true);
select atribuir_entrega(:'p4',:'moto',true);
select atribuir_entrega(:'p5',:'outro');
reset role;
select atribuicao as a1 from entregas_operacao where pedido_id=:'p1' \gset
select atribuicao as a3 from entregas_operacao where pedido_id=:'p3' \gset
select atribuicao as a4 from entregas_operacao where pedido_id=:'p4' \gset
select pg_temp.ok((select saiu_em is null and atribuido_por=:'equipe' from entregas_operacao where pedido_id=:'p1'),'atribuição registra autor sem inventar saída');
select pg_temp.ok((select saiu_em is not null from entregas_operacao where pedido_id=:'p2'),'saída registrada com a atribuição');
select pg_temp.sou(:'moto');
set local role authenticated;
select minhas_entregas() as lista \gset
select pg_temp.igual(jsonb_array_length(:'lista'::jsonb)::text,'3','lista contém só as três atribuições próprias abertas');
select pg_temp.ok(:'lista'::jsonb @> jsonb_build_array(jsonb_build_object('id',:'p1','atribuicao',:'a1')),'lista inclui versão da atribuição');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(:'lista'::jsonb) p where p ? 'token' or p ? 'itens'),'lista sem token e itens');
select pg_temp.igual(pg_temp.erro(format('select consultar_entrega_motoboy(%L)',:'p2')),'nao_atribuido','QR de outro entregador é recusado');
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega(%L)',:'p2')),'nao_atribuido','RPC antiga também protege atribuição');
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega_offline(%L,%L,%L,now())',:'p1',:'evento1',:'a1')),'entrega_nao_iniciada','confirmar antes da saída é recusado');
reset role;
select pg_temp.ok((select ultima_em=now() from entregadores_comunicacao where user_id=:'moto'),'última comunicação vem do servidor');

-- Reatribuição antes da saída invalida a versão anterior. Depois da saída, não há troca silenciosa.
select pg_temp.sou(:'equipe');
set local role authenticated;
select atribuir_entrega(:'p1',:'outro');
select atribuir_entrega(:'p1',:'moto',true);
select pg_temp.igual(pg_temp.erro(format('select atribuir_entrega(%L,%L)',:'p1',:'outro')),'entrega_em_andamento','não troca responsável depois da saída');
reset role;
select atribuicao as a1nova from entregas_operacao where pedido_id=:'p1' \gset
select pg_temp.ok(:'a1nova'<>:'a1','reatribuição cria nova versão');
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega_offline(%L,%L,%L,now())',:'p1',:'evento1',:'a1')),'atribuicao_alterada','fila antiga não sobrescreve reatribuição');
select confirmar_entrega_offline(:'p1',:'evento1',:'a1nova',now()) as confirmou \gset
select pg_temp.ok(:'confirmou'::jsonb @> '{"ok":true,"jaEntregue":false}','confirmação reconhecida pelo servidor');
select confirmar_entrega_offline(:'p1',:'evento1',:'a1nova',now()) as repetiu \gset
select pg_temp.ok(:'repetiu'::jsonb @> '{"ok":true,"jaEntregue":true}','reenvio do mesmo evento é idempotente');
select pg_temp.ok(not (:'repetiu'::jsonb->'pedido' ? 'cliente'),'reenvio sem dados pessoais');
select pg_temp.ok(not (consultar_entrega_motoboy(:'p1')->>'cliente' is not null),'consulta de entrega concluída não expõe dados pessoais');
reset role;
select pg_temp.igual((select status from pedidos where id=:'p1'),'entregue','status entregue apenas após reconhecimento');
select pg_temp.igual((select jsonb_array_length(historico) from pedidos where id=:'p1')::text,'4','um evento entregue no histórico');
select pg_temp.igual((select count(*) from entregas_eventos where evento_id=:'evento1')::text,'1','evento único na auditoria');
select pg_temp.ok((select confirmado_em=now() and recebido_em=now() and encerrado_por=:'moto' and encerramento='motoboy' from entregas_operacao where pedido_id=:'p1'),'horários e responsável registrados separadamente');

-- Baixa manual preservada quando chega confirmação offline posterior.
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select baixar_entrega_manual(%L,%L)',:'p3','   ')),'motivo_obrigatorio','baixa exige motivo');
select pg_temp.igual(pg_temp.erro(format('select mudar_status(%L,%L)',:'p3','entregue')),'motivo_obrigatorio','quadro antigo não contorna motivo');
select baixar_entrega_manual(:'p3','Conferido no retorno com o motoboy');
reset role;
select to_jsonb(e)::text as antes from entregas_operacao e where pedido_id=:'p3' \gset
select historico::text as hantes from pedidos where id=:'p3' \gset
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega_offline(:'p3',:'evento2',:'a3',now()-interval '1 minute') as posterior \gset
select pg_temp.ok(:'posterior'::jsonb @> '{"ok":true,"jaEntregue":true}','confirmação posterior recebe reconhecimento');
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega_offline(%L,%L,%L,now())',:'p4',:'evento1',:'a4')),'dados_invalidos','evento não pode ser reutilizado em outro pedido');
reset role;
select pg_temp.igual((select to_jsonb(e)::text from entregas_operacao e where pedido_id=:'p3'),:'antes','sincronização não sobrescreve baixa manual');
select pg_temp.igual((select historico::text from pedidos where id=:'p3'),:'hantes','sincronização posterior não muda histórico do pedido');
select pg_temp.ok(exists(select 1 from entregas_eventos where evento_id=:'evento2' and tipo='confirmacao_posterior'),'confirmação posterior fica auditada');

-- Relógio incorreto fica sinalizado; cancelamento e desativação não podem ser contornados.
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega_offline(:'p4',:'evento3',:'a4',now()+interval '1 day');
reset role;
select pg_temp.ok((select horario_inconsistente from entregas_operacao where pedido_id=:'p4'),'horário futuro sinalizado e excluído da média');
select pg_temp.sou(:'equipe');
set local role authenticated;
select painel_entregadores(7) as painel \gset
select pg_temp.ok(:'painel'::jsonb ? 'entregadores' and :'painel'::jsonb ? 'pedidos','painel traz entregadores e pedidos');
select pg_temp.igual(pg_temp.erro('select painel_entregadores(365)'),'dados_invalidos','período limitado');
select pg_temp.ok(jsonb_array_length(historico_entrega(:'p3'))>=3,'equipe consulta auditoria com responsável e motivo');
select mudar_status(:'p2','cancelado','Cliente cancelou');
reset role;
select pg_temp.ok((select encerramento='cancelado' and motivo='Cliente cancelou' from entregas_operacao where pedido_id=:'p2'),'cancelamento sincroniza controle operacional');
select atribuicao as a2 from entregas_operacao where pedido_id=:'p2' \gset
select gen_random_uuid() as evento_cancelado \gset
select pg_temp.sou(:'outro');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega(%L)',:'p2')),'pedido_cancelado','QR não conclui pedido cancelado');
select pg_temp.ok(reconhecer_cancelamento_entrega(:'p2',:'evento_cancelado',:'a2',now())->>'ok'='true','conferência do cancelamento reconhecida pelo servidor');
select pg_temp.ok(reconhecer_cancelamento_entrega(:'p2',:'evento_cancelado',:'a2',now())->>'ok'='true','conferência do cancelamento idempotente');
reset role;
select pg_temp.igual((select status from pedidos where id=:'p2'),'cancelado','conferência não converte cancelamento em entrega');
select pg_temp.igual((select count(*) from entregas_eventos where evento_id=:'evento_cancelado')::text,'1','conferência de cancelamento fica auditada uma vez');
update motoboys set ativo=false where user_id=:'moto';
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select minhas_entregas()'),'sem_permissao','desativação corta lista');
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega(%L)',:'p1')),'sem_permissao','desativação corta confirmações');
select pg_temp.igual((select count(*) from motoboys)::text,'0','desativado não lê nem a própria linha');
reset role;
rollback;
