begin;
\ir _ajuda.sql
update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=false;
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as legado \gset
select pg_temp.ok((:'legado'::jsonb->>'pagamentoOnline') is null,'pedido anterior permanece no pagamento legado');
update loja set pagamentos_ativos=true;
set local role anon;
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')),'{"pagamento":"Dinheiro","pagamentoOnline":"aprovado"}') as pedido \gset
select pg_temp.igual(:'pedido'::jsonb->>'pagamentoOnline','pendente','browser não declara pagamento aprovado nem escolhe dinheiro');
select pg_temp.igual(pg_temp.erro('select * from pagamentos_mp'),'42501','anônimo não lê pagamentos privados');
select pg_temp.igual(pg_temp.erro('select preparar_pagamento_mp(null,null,true)'),'42501','anônimo não chama helpers de backend');
reset role;
select (:'pedido'::jsonb->>'id') as pid,(:'pedido'::jsonb->>'token') as token \gset
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select mudar_status(%L,%L)',:'pid','preparo')),'pagamento_pendente','cozinha bloqueada antes do pagamento');
select pg_temp.igual(pg_temp.erro('select * from pagamentos_mp_eventos'),'42501','equipe não lê auditoria financeira diretamente');
select pg_temp.igual(pg_temp.erro('select registrar_pagamento_mp(null,null,null,null,null,null,null)'),'42501','sessão autenticada não aprova pelo helper');
reset role;
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega(%L)',:'pid')),'nao_atribuido','motoboy não confirma pedido sem atribuição');
reset role;
set local role service_role;
select preparar_pagamento_mp(:'token','teste@example.com',true) as pagamento \gset
select pg_temp.igual(:'pagamento'::jsonb->>'total',:'pedido'::jsonb->>'total','valor vem do servidor');
select pg_temp.igual(:'pagamento'::jsonb->>'criar','true','primeiro envio obtém reserva de criação');
select preparar_pagamento_mp(:'token','outro@example.com',true) as repetido \gset
select pg_temp.igual(:'repetido'::jsonb->>'criar','false','clique simultâneo não cria segunda cobrança');
select pg_temp.igual(:'repetido'::jsonb->>'id',:'pagamento'::jsonb->>'id','tentativas usam a mesma chave de idempotência');
select pg_temp.igual(:'repetido'::jsonb->>'email','teste@example.com','reenvio não muda o payload de cobrança');
select pg_temp.igual(pg_temp.erro(format('update pedidos set status=%L where id=%L','preparo',:'pid')),'pagamento_pendente','gatilho também protege uma mudança direta do backend');
select registrar_pagamento_mp((:'pagamento'::jsonb->>'id')::uuid,'ORDTST012345678901234567890123','aprovado',now()-interval '10 seconds','https://www.mercadopago.com.br/checkout/v1/redirect','processed','accredited');
select registrar_pagamento_mp((:'pagamento'::jsonb->>'id')::uuid,'ORDTST012345678901234567890123','pendente',now()-interval '20 seconds',null,'created','created');
select pg_temp.igual((select pagamento_online from pedidos where id=:'pid'),'aprovado','notificação antiga não desfaz aprovação');
select registrar_pagamento_mp((:'pagamento'::jsonb->>'id')::uuid,'ORDTST012345678901234567890123','aprovado',now()-interval '10 seconds',null,'processed','accredited');
select pg_temp.ok((select count(*)=1 from pagamentos_mp_eventos where pagamento_id=(:'pagamento'::jsonb->>'id')::uuid),'reenvio não duplica evento financeiro');
select pg_temp.igual(preparar_pagamento_mp(:'token',null,false)->>'consultar','false','consultas públicas repetidas usam estado persistido sem chamar o provedor');
select pg_temp.igual(pg_temp.erro(format('select registrar_pagamento_mp(%L,%L,%L,now(),null,%L,%L)',(:'pagamento'::jsonb->>'id'),'ORDTST212345678901234567890123','aprovado','processed','accredited')),'pagamento_divergente','não substitui order já vinculada ao pagamento');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select mudar_status(:'pid','preparo');
select pg_temp.igual((select status from pedidos where id=:'pid'),'preparo','cozinha liberada após aprovação');
select mudar_status(:'pid','cancelado','Cliente desistiu');
reset role;
insert into usuarios_painel(user_id,nome,email,perfil,ativo) values(:'equipe','Admin teste','equipe@teste.local','admin',true)
on conflict(user_id) do update set perfil='admin',ativo=true;
set local role service_role;
select pg_temp.igual(pg_temp.erro(format('select autorizar_reembolso_mp(%L,%L)',:'moto',:'pid')),'sem_permissao','motoboy não estorna');
select pg_temp.ok((autorizar_reembolso_mp(:'equipe',:'pid')->>'reembolso_autor')=:'equipe','admin solicita estorno com auditoria');
select registrar_pagamento_mp((:'pagamento'::jsonb->>'id')::uuid,'ORDTST012345678901234567890123','reembolsado',now()-interval '5 seconds',null,'refunded','refunded');
select registrar_pagamento_mp((:'pagamento'::jsonb->>'id')::uuid,'ORDTST012345678901234567890123','aprovado',now()-interval '1 second',null,'processed','accredited');
select pg_temp.igual((select pagamento_online from pedidos where id=:'pid'),'reembolsado','estorno não volta a ser pagamento aprovado');
select pg_temp.igual((select status from pedidos where id=:'pid'),'cancelado','financeiro não reabre pedido cancelado');
reset role;
-- Simula confirmação tardia sem ressuscitar pedido cancelado.
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as tardio \gset
select preparar_pagamento_mp((:'tardio'::jsonb->>'token')::uuid,'teste@example.com',true) as tarde_mp \gset
update pedidos set status='cancelado' where id=(:'tardio'::jsonb->>'id')::uuid;
select registrar_pagamento_mp((:'tarde_mp'::jsonb->>'id')::uuid,'ORDTST112345678901234567890123','aprovado',now(),null,'processed','accredited');
select pg_temp.ok((select status='cancelado' and pagamento_online='aprovado' from pedidos where id=(:'tardio'::jsonb->>'id')::uuid),'aprovação tardia fica visível para estorno sem reabrir pedido');
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as ainda_pendente \gset
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),pg_temp.cliente(pg_temp.tel_novo())||'{"modo":"entrega","endereco":"Rua teste 12","distanciaKm":null}')),'pagamento_valor_invalido','pagamento ativo não aceita entrega sem taxa');
update loja set pagamentos_ativos=false;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format('select mudar_status(%L,%L)',(:'ainda_pendente'::jsonb->>'id'),'preparo')),'pagamento_pendente','desligar flag não libera preparo de pedido online pendente');
reset role;
select pg_temp.igual((select pagamento_online from pedidos where id=:'pid'),'reembolsado','desligar flag não perde registros existentes');
select pg_temp.igual(acompanhar_pedido(:'token')->>'pagamentoOnline','reembolsado','acompanhamento mostra estado recebido do backend');
select pg_temp.ok(not (acompanhar_pedido(:'token')?'email') and not (acompanhar_pedido(:'token')?'checkout_url'),'acompanhamento não vaza e-mail ou identificadores privados');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),'{"modo":"entrega","endereco":"Rua teste 12","distanciaKm":null}')) ,null,'legado continua funcional com a flag desligada');
rollback;
