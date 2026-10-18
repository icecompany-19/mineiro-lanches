begin;
\ir _ajuda.sql
-- Histórico continua operável depois da ativação.
select pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')),'{"modo":"entrega","endereco":"Rua Antiga, 10"}') as antigo \gset
update loja set cotacao_ativa=true;
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  '{"modo":"entrega","endereco":"Rua Cotada, 100","distanciaKm":0.001}')),'cotacao_necessaria','distância do cliente não substitui cotação');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  '{"modo":"entrega","endereco":"Rua Cotada, 100","cotacaoId":"invalido"}')),'cotacao_necessaria','UUID inválido tem erro recuperável');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  '{"modo":"entrega","endereco":"Rua Cotada, 100","cotacaoId":"00000000-0000-4000-8000-999999999999"}')),'cotacao_necessaria','cotação inexistente recusada');
select pg_temp.ok((pg_temp.novo(jsonb_build_array(pg_temp.item('x-burguer')))->>'taxaEntrega') is null,'retirada continua sem taxa');
select pg_temp.igual(pg_temp.erro($q$select * from cotacoes_entrega$q$),'42501','anon não lê cotações');
select pg_temp.igual(pg_temp.erro($q$select emitir_cotacao_entrega('Rua X, 1',1,'{}','fake')$q$),'42501','anon não emite cotações');
select pg_temp.igual(pg_temp.erro($q$select * from entrega_cache$q$),'42501','anon não enumera localizações');
reset role;
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in ('entrega_cache'::regclass,'cotacoes_entrega'::regclass,'entrega_travas'::regclass,'entrega_limites'::regclass,'entrega_eventos'::regclass)),'tabelas privadas têm RLS');
set local role service_role;
select emitir_cotacao_entrega('Rua Cotada, 100',3.2,(select entrega_origem from loja where id=1),'teste') as q \gset
select pg_temp.igual(:'q'::jsonb->>'taxa','8.00','backend calcula a taxa da cotação');
select pg_temp.ok(reservar_entrega(repeat('a',64),repeat('b',64),'00000000-0000-4000-8000-000000000101'),'backend reserva endereço');
select pg_temp.ok(not reservar_entrega(repeat('a',64),repeat('b',64),'00000000-0000-4000-8000-000000000102'),'segunda instância não consulta o mesmo endereço em paralelo');
reset role;
select pg_temp.sou(null);
set local role anon;
select pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),pg_temp.cliente('11900008001') ||
  jsonb_build_object('modo','entrega','endereco','Rua Cotada, 100','cotacaoId',:'q'::jsonb->>'id','distanciaKm',0.001,
    'idempotencia','00000000-0000-4000-8000-000000000801')) as entrada \gset
select criar_pedido(:'entrada') as aceito \gset
select pg_temp.igual(:'aceito'::jsonb->>'distanciaKm','3.200','servidor ignora distância adulterada e usa cotação');
select pg_temp.igual(:'aceito'::jsonb->>'taxaEntrega','8.00','pedido grava taxa da cotação');
select pg_temp.igual(:'aceito'::jsonb->>'total','24.90','total inclui entrega');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  jsonb_build_object('modo','entrega','endereco','Outra Rua, 100','cotacaoId',:'q'::jsonb->>'id'))),
  'cotacao_endereco_divergente','cotação não serve para outro endereço');
reset role;
select pg_temp.ok((select cotacao_entrega_id=(:'q'::jsonb->>'id')::uuid from pedidos where id=(:'aceito'::jsonb->>'id')::uuid),'pedido vinculado à cotação');
update cotacoes_entrega set expira_em=now()-interval '1 second';
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(criar_pedido(:'entrada')->>'id',:'aceito'::jsonb->>'id','repetição recupera pedido mesmo com cotação vencida');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  jsonb_build_object('modo','entrega','endereco','Rua Cotada, 100','cotacaoId',:'q'::jsonb->>'id'))),'cotacao_expirada','nova entrega não aceita cotação vencida');
reset role;
update cotacoes_entrega set expira_em=now()+interval '10 minutes';
update loja set taxa_fixa=5;
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  jsonb_build_object('modo','entrega','endereco','Rua Cotada, 100','cotacaoId',:'q'::jsonb->>'id'))),'cotacao_expirada','mudança da taxa exige nova confirmação');
reset role;
update loja set taxa_fixa=4,entrega_origem=jsonb_set(entrega_origem,'{lat}','-23.55');
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('x-burguer')),
  jsonb_build_object('modo','entrega','endereco','Rua Cotada, 100','cotacaoId',:'q'::jsonb->>'id'))),'cotacao_expirada','mudança da origem invalida a cotação');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro($q$select * from cotacoes_entrega$q$),'42501','equipe não lê cotações pela Data API');
select pg_temp.ok(resumo_entregas() is not null,'equipe acessa métricas sem dados pessoais');
select mudar_status((:'antigo'::jsonb->>'id')::uuid,'preparo',null);
reset role;
select pg_temp.igual((select status from pedidos where id=(:'antigo'::jsonb->>'id')::uuid),'preparo','histórico sem taxa continua mudando de status');
select definir_origem_entrega(-23.54,-46.31);
reset role;
select pg_temp.ok((select entrega_origem->>'lat'='-23.54' from loja where id=1),'equipe confirma a origem da rota');
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.igual(pg_temp.erro($q$select resumo_entregas()$q$),'sem_permissao','usuário fora da equipe não acessa métricas');
select pg_temp.igual(pg_temp.erro($q$select definir_origem_entrega(-23.54,-46.31)$q$),'sem_permissao','usuário fora da equipe não altera origem');
rollback;
