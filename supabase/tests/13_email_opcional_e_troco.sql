begin;
\ir _ajuda.sql
update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=true;
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as online \gset
select preparar_pagamento_mp((:'online'::jsonb->>'token')::uuid,null,true) as mp \gset
select pg_temp.igual(:'mp'::jsonb->>'email','','checkout sem e-mail não inventa identidade');
select pg_temp.igual(:'mp'::jsonb->>'criar','true','checkout sem e-mail obtém reserva');
select pg_temp.igual(preparar_pagamento_mp((:'online'::jsonb->>'token')::uuid,'depois@example.com',true)->>'id',:'mp'::jsonb->>'id','reenvio preserva pagamento e idempotência');
select pg_temp.igual((select email from pagamentos_mp where id=(:'mp'::jsonb->>'id')::uuid),'','reenvio não altera payload já reservado');
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as invalido \gset
select pg_temp.igual(pg_temp.erro(format('select preparar_pagamento_mp(%L,%L,true)',:'invalido'::jsonb->>'token','nao-e-email')),'email_invalido','e-mail informado incorretamente continua inválido');
set local role anon;
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),pg_temp.cliente(pg_temp.tel_novo())||'{"pagamento":"Dinheiro na entrega"}')),'troco_necessario','dinheiro exige resposta sobre troco também no servidor');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),pg_temp.cliente(pg_temp.tel_novo())||'{"pagamento":"Dinheiro na entrega","troco":"1e3"}')),'troco_invalido','texto que não é valor decimal não vira troco');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),pg_temp.cliente(pg_temp.tel_novo())||'{"pagamento":"Dinheiro na retirada","troco":"16,90"}')),'troco_invalido','troco para o próprio total não é troco');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),pg_temp.cliente(pg_temp.tel_novo())||'{"modo":"entrega","endereco":"Rua Teste 12","distanciaKm":2.5,"pagamento":"Dinheiro na entrega","troco":"20,00"}')),'troco_invalido','troco é validado contra total com taxa, não apenas itens');
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')),'{"modo":"entrega","endereco":"Rua Teste 12","distanciaKm":2.5,"pagamento":"Dinheiro na entrega","troco":"100,00"}') as dinheiro \gset
select pg_temp.igual(:'dinheiro'::jsonb->>'pagamentoNaEntrega','true','dinheiro libera fluxo sem aprovação online');
select pg_temp.ok((:'dinheiro'::jsonb->>'pagamentoOnline') is null,'dinheiro não vira pagamento online aprovado');
select pg_temp.igual(acompanhar_pedido((:'dinheiro'::jsonb->>'token')::uuid)->>'troco','100,00','acompanhamento público preserva troco');
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')),'{"pagamento":"Dinheiro na retirada","troco":"Sem troco"}') as exato \gset
select pg_temp.igual(:'exato'::jsonb->>'troco','Sem troco','não precisa de troco é resposta explícita');
reset role;
select pg_temp.igual((select entrega_json(p)->>'troco' from pedidos p where id=(:'dinheiro'::jsonb->>'id')::uuid),'100,00','motoboy recebe troco pelo contrato existente');
select pg_temp.igual((select entrega_json(p)->>'pagamento' from pedidos p where id=(:'dinheiro'::jsonb->>'id')::uuid),'Dinheiro na entrega','motoboy recebe forma de pagamento');
select pg_temp.sou(:'equipe');
set local role authenticated;
select mudar_status((:'dinheiro'::jsonb->>'id')::uuid,'preparo');
select pg_temp.ok((confirmar_pagamento_entrega((:'dinheiro'::jsonb->>'id')::uuid)->>'pagamentoRecebidoEm') is not null,'recebimento continua separado do troco e preparo');
rollback;
