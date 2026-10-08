-- criar_pedido: loja aberta/fechada (aceita_fechada, modos manuais), esgotado no dia de operação,
-- limite de 5 pedidos em 10 min por telefone e idempotência.
begin;
\ir _ajuda.sql

-- ================= loja =================
update loja set modo = 'fechada';
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro_item('agua'), 'loja_fechada', 'modo fechada e aceita_fechada = false: loja_fechada');
reset role;
update loja set aceita_fechada = true;
set local role anon;
select pg_temp.ok(pg_temp.erro_item('agua') is null, 'loja fechada com aceita_fechada = true: aceita');
reset role;
update loja set aceita_fechada = false, modo = 'auto', horarios = '{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null,"6":null}';
set local role anon;
select pg_temp.igual(pg_temp.erro_item('agua'), 'loja_fechada', 'modo auto fora do horário: loja_fechada');
reset role;
update loja set horarios = '{"0":["00:00","00:00"],"1":["00:00","00:00"],"2":["00:00","00:00"],"3":["00:00","00:00"],"4":["00:00","00:00"],"5":["00:00","00:00"],"6":["00:00","00:00"]}';
set local role anon;
select pg_temp.ok(pg_temp.erro_item('agua') is null, 'modo auto dentro do horário: aceita');
reset role;
update loja set modo = 'aberta', horarios = '{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null,"6":null}';
set local role anon;
select pg_temp.ok(pg_temp.erro_item('agua') is null, 'modo aberta fora do horário: aceita');
reset role;
update loja set modo = 'fechada';
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.igual(pg_temp.erro_item('agua'), 'loja_fechada', 'logado fora da equipe também respeita a loja fechada');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.ok(pg_temp.erro_item('agua') is null, 'equipe ignora a loja fechada');
reset role;
update loja set modo = 'aberta';

-- ================= esgotado no dia de operação =================
update produtos set esgotado_dia = dia_operacional() where id = 'gran-crispy';
update produtos set esgotado_dia = dia_operacional() - 1 where id = 'gran-chicken';
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro_item('gran-crispy'), 'produto_esgotado', 'esgotado hoje: produto_esgotado');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('agua'), pg_temp.item('gran-crispy')), pg_temp.cliente(pg_temp.tel_novo()))),
  'produto_esgotado', 'um item esgotado recusa o pedido inteiro');
select pg_temp.ok(pg_temp.erro_item('gran-chicken') is null, 'esgotado ontem já não vale (expira sozinho)');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro_item('gran-crispy'), 'produto_esgotado', 'nem a equipe pede item esgotado');
reset role;
-- virada das 4h: marcado às 23h de quinta, ainda esgotado às 03:59 de sexta, livre às 04:00
select pg_temp.ok(dia_operacional('2026-10-08 23:00-03') = dia_operacional('2026-10-09 03:59-03')
                  and dia_operacional('2026-10-08 23:00-03') <> dia_operacional('2026-10-09 04:00-03'),
  'esgotado marcado às 23h vale até 03:59 e cai às 04:00');
update produtos set esgotado_dia = null;

-- ================= limite: 5 pedidos do mesmo telefone em 10 min =================
select pg_temp.sou(null);
set local role anon;
select count(*) as n from (select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000050'))) from generate_series(1, 5)) t \gset
select pg_temp.igual(:'n', '5', 'cinco pedidos do mesmo telefone passam');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000050'))), 'muitos_pedidos', 'o sexto em 10 min: muitos_pedidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('(11) 90000-0050'))), 'muitos_pedidos', 'o mesmo telefone formatado também conta');
select pg_temp.ok(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000051'))) is null, 'outro telefone passa');
reset role;
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000050'))), 'muitos_pedidos', 'logado fora da equipe também tem limite');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.ok(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000050'))) is null, 'equipe não tem limite');
reset role;
update pedidos set criado_em = now() - interval '10 minutes 1 second' where cliente_telefone = '11900000050';
select pg_temp.sou(null);
set local role anon;
select pg_temp.ok(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000050'))) is null, 'passados 10 min, o telefone volta a pedir');
reset role;

-- ================= idempotência =================
select pg_temp.sou(null);
set local role anon;
select criar_pedido(pg_temp.pedido('[{"produtoId":"x-burguer","qtd":2}]', pg_temp.cliente('11900000060') || '{"idempotencia":"a0000000-0000-4000-8000-000000000001"}')) as primeiro \gset
select criar_pedido(pg_temp.pedido('[{"produtoId":"x-burguer","qtd":2}]', pg_temp.cliente('11900000060') || '{"idempotencia":"a0000000-0000-4000-8000-000000000001"}')) as segundo \gset
select pg_temp.ok(:'primeiro'::jsonb = :'segundo'::jsonb, 'mesmo uuid: devolve o mesmo pedido (id, número, token)');
reset role;
select pg_temp.igual((select count(*) from pedidos where idempotencia = 'a0000000-0000-4000-8000-000000000001')::text, '1', 'mesmo uuid: só um pedido gravado');
select pg_temp.igual((select pedidos from clientes where telefone = '11900000060')::text, '1', 'mesmo uuid: clientes conta um pedido só');
set local role anon;
-- mais 4 pedidos novos (total 5), depois reenvios do primeiro: não contam nem são barrados
select count(*) as n from (select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000060'))) from generate_series(1, 4)) t \gset
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000060'))), 'muitos_pedidos', 'reenvio não contou: chegou ao limite só no 6.º pedido novo');
select pg_temp.ok(criar_pedido(pg_temp.pedido('[{"produtoId":"x-burguer","qtd":2}]', pg_temp.cliente('11900000060') || '{"idempotencia":"a0000000-0000-4000-8000-000000000001"}'))
                  = :'primeiro'::jsonb, 'reenvio depois do limite ainda devolve o pedido');
reset role;
update loja set modo = 'fechada';
update produtos set esgotado_dia = dia_operacional() where id = 'x-burguer';
set local role anon;
select pg_temp.ok(criar_pedido(pg_temp.pedido('[{"produtoId":"x-burguer","qtd":2}]', pg_temp.cliente('11900000060') || '{"idempotencia":"a0000000-0000-4000-8000-000000000001"}'))
                  = :'primeiro'::jsonb, 'reenvio com a loja fechada e o item esgotado ainda devolve o pedido');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000061') || '{"idempotencia":"a0000000-0000-4000-8000-000000000001"}')),
  'dados_invalidos', 'mesmo uuid com outro telefone: dados_invalidos (não entrega pedido alheio)');
reset role;
update loja set modo = 'aberta';
update produtos set esgotado_dia = null;
set local role anon;
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"idempotencia":"nao-e-uuid"}')), 'dados_invalidos', 'idempotencia que não é uuid: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"idempotencia":123}')), 'dados_invalidos', 'idempotencia numérica: dados_invalidos');
select pg_temp.ok(pg_temp.novo('[{"produtoId":"agua"}]', '{"idempotencia":null}') is not null, 'idempotencia null: pedido normal');
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000062') || '{"idempotencia":"a0000000-0000-4000-8000-000000000002"}')) ->> 'id' as id2 \gset
select pg_temp.ok(:'id2' <> (:'primeiro'::jsonb ->> 'id'), 'uuid diferente: pedido diferente');
reset role;

rollback;
