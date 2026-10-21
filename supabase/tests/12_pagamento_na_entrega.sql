begin;
\ir _ajuda.sql
update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=true;
set local role anon;
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')),'{"pagamento":"Pagamento na entrega"}') as cod \gset
select pg_temp.igual(:'cod'::jsonb->>'pagamentoNaEntrega','true','cliente escolhe pagamento na entrega');
select pg_temp.ok((:'cod'::jsonb->>'pagamentoOnline') is null,'na entrega não é falso pagamento online aprovado');
select pg_temp.igual(pg_temp.erro('select confirmar_pagamento_entrega(null)'),'42501','cliente não declara recebimento');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select mudar_status((:'cod'::jsonb->>'id')::uuid,'preparo');
select pg_temp.ok((confirmar_pagamento_entrega((:'cod'::jsonb->>'id')::uuid)->>'pagamentoRecebidoEm') is not null,'equipe registra recebimento separado');
select pg_temp.ok((select pagamento_online is null from pedidos where id=(:'cod'::jsonb->>'id')::uuid),'recebimento local continua separado do Mercado Pago');
select pg_temp.igual(pg_temp.erro('select autorizar_pagamento_entrega_mp(null,null,false)'),'42501','conversão com checkout é exclusiva do backend');
reset role;
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer'))) as online \gset
select preparar_pagamento_mp((:'online'::jsonb->>'token')::uuid,'teste@example.com',true) as mp \gset
select registrar_pagamento_mp((:'mp'::jsonb->>'id')::uuid,'ORDCOD012345678901234567890123','pendente',now()-interval '2 seconds',null,'created','created');
select autorizar_pagamento_entrega_mp(:'equipe',(:'online'::jsonb->>'id')::uuid,false);
select pg_temp.igual(pg_temp.erro(format('select preparar_pagamento_mp(%L,null,true)',:'online'::jsonb->>'token')),'pagamento_encerrado','conversão bloqueia novo checkout simultâneo');
select pg_temp.igual(pg_temp.erro(format('select autorizar_pagamento_entrega_mp(%L,%L,true)',:'equipe',:'online'::jsonb->>'id')),'pagamento_online_ativo','não libera cobrança online ainda ativa');
select registrar_pagamento_mp((:'mp'::jsonb->>'id')::uuid,'ORDCOD012345678901234567890123','cancelado',now()-interval '1 seconds',null,'canceled','canceled');
select autorizar_pagamento_entrega_mp(:'equipe',(:'online'::jsonb->>'id')::uuid,true);
select pg_temp.ok((select pagamento_na_entrega and pagamento_online is null from pedidos where id=(:'online'::jsonb->>'id')::uuid),'checkout cancelado permite conversão auditada');
select pg_temp.ok((select count(*)=1 from pagamentos_mp where pedido_id=(:'online'::jsonb->>'id')::uuid),'vínculo financeiro anterior é preservado');
select registrar_pagamento_mp((:'mp'::jsonb->>'id')::uuid,'ORDCOD012345678901234567890123','cancelado',now(),null,'canceled','canceled');
select pg_temp.ok((select pagamento_na_entrega and pagamento_online is null from pedidos where id=(:'online'::jsonb->>'id')::uuid),'reconciliação não volta a bloquear pagamento na entrega');
rollback;
