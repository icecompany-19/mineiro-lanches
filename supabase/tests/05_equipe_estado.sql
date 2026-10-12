-- Funções da equipe (mudar_status, marcar_esgotado, definir_loja, remover_testes), estado_cardapio e acompanhar_pedido.
begin;
\ir _ajuda.sql

-- pedidos de partida, feitos pelo cliente (anon)
select pg_temp.sou(null);
set local role anon;
select criar_pedido(pg_temp.pedido('[{"produtoId":"gran-burger","qtd":1}]', pg_temp.cliente('11900000080', 'Carla Sigilo') || '{"modo":"entrega","endereco":"Rua Secreta, 99"}')) as ent \gset
select criar_pedido(pg_temp.pedido('[{"produtoId":"x-salada","qtd":2,"prensado":true}]', pg_temp.cliente('11900000081') || '{"modo":"local"}')) as ret \gset
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000082') || '{"modo":"local","mesa":"4"}')) as loc \gset
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000083'))) as canc \gset
reset role;
select :'ent'::jsonb ->> 'id' as ent_id, :'ret'::jsonb ->> 'id' as ret_id, :'loc'::jsonb ->> 'id' as loc_id, :'canc'::jsonb ->> 'id' as canc_id,
       :'ent'::jsonb ->> 'token' as ent_token \gset

select pg_temp.sou(:'equipe');
set local role authenticated;

-- ================= mudar_status =================
-- entrega: novo → preparo → rota → entregue
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'pronto')$$, :'ent_id')), 'transicao_invalida', 'novo → pronto: transicao_invalida');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'entregue')$$, :'ent_id')), 'transicao_invalida', 'novo → entregue: transicao_invalida');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'novo')$$, :'ent_id')), 'transicao_invalida', 'novo → novo: transicao_invalida');
select mudar_status(:'ent_id', 'preparo') as r \gset
select pg_temp.ok(:'r'::jsonb ->> 'status' = 'preparo' and jsonb_array_length(:'r'::jsonb -> 'historico') = 2
                  and :'r'::jsonb #>> '{historico,1,status}' = 'preparo' and not (:'r'::jsonb #> '{historico,1}' ? 'motivo'),
  'novo → preparo: status muda e o histórico cresce (sem motivo)');
select pg_temp.ok((:'r'::jsonb - 'status' - 'historico') = (:'ent'::jsonb - 'status' - 'historico'), 'mudar_status devolve o pedido_json completo');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'pronto')$$, :'ent_id')), 'transicao_invalida', 'entrega: preparo → pronto: transicao_invalida');
select pg_temp.igual(mudar_status(:'ent_id', 'rota') ->> 'status', 'rota', 'entrega: preparo → rota');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'preparo')$$, :'ent_id')), 'transicao_invalida', 'rota → preparo: transicao_invalida');
select mudar_status(:'ent_id', 'entregue') as r \gset
select pg_temp.ok(:'r'::jsonb ->> 'status' = 'entregue'
                  and (select array_agg(h ->> 'status' order by n) from jsonb_array_elements(:'r'::jsonb -> 'historico') with ordinality x(h, n)) = array['novo', 'preparo', 'rota', 'entregue'],
  'rota → entregue; histórico novo, preparo, rota, entregue');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'cancelado', 'tarde demais')$$, :'ent_id')), 'transicao_invalida', 'entregue → cancelado: transicao_invalida (status final)');
-- local (comer no truck): preparo → pronto → entregue
select pg_temp.igual(mudar_status(:'ret_id', 'preparo') ->> 'status', 'preparo', 'local: novo → preparo');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'rota')$$, :'ret_id')), 'transicao_invalida', 'local: preparo → rota: transicao_invalida');
select pg_temp.igual(mudar_status(:'ret_id', 'pronto') ->> 'status', 'pronto', 'local: preparo → pronto');
select pg_temp.igual(mudar_status(:'ret_id', 'entregue') ->> 'status', 'entregue', 'local: pronto → entregue');
-- local: preparo → pronto; cancelar com motivo
select pg_temp.igual(mudar_status(:'loc_id', 'preparo') ->> 'status', 'preparo', 'local: novo → preparo');
select pg_temp.igual(mudar_status(:'loc_id', 'pronto') ->> 'status', 'pronto', 'local: preparo → pronto');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'cancelado')$$, :'loc_id')), 'dados_invalidos', 'cancelar sem motivo: dados_invalidos');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'cancelado', '   ')$$, :'loc_id')), 'dados_invalidos', 'cancelar com motivo em branco: dados_invalidos');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'cancelado', %L)$$, :'loc_id', repeat('m', 201))), 'dados_invalidos', 'motivo com 201 caracteres: dados_invalidos');
select mudar_status(:'loc_id', 'cancelado', '  Cliente desistiu  ') as r \gset
select pg_temp.ok(:'r'::jsonb ->> 'status' = 'cancelado' and jsonb_array_length(:'r'::jsonb -> 'historico') = 4
                  and :'r'::jsonb #> '{historico,3}' @> '{"status":"cancelado","motivo":"Cliente desistiu"}',
  'pronto → cancelado com motivo (aparado) no histórico');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'preparo')$$, :'loc_id')), 'transicao_invalida', 'cancelado → preparo: transicao_invalida');
select pg_temp.igual(mudar_status(:'canc_id', 'cancelado', repeat('m', 200)) ->> 'status', 'cancelado', 'novo → cancelado com motivo de 200 caracteres');
-- erros de entrada
select pg_temp.igual(pg_temp.erro($$select mudar_status('00000000-0000-4000-8000-00000000abcd', 'preparo')$$), 'nao_encontrado', 'pedido inexistente: nao_encontrado');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'voando')$$, :'ret_id')), 'dados_invalidos', 'status desconhecido: dados_invalidos');
select pg_temp.igual(pg_temp.erro($$select mudar_status(null, 'preparo')$$), 'dados_invalidos', 'id null: dados_invalidos');
select pg_temp.ok((select atualizado_em = now() from pedidos where id = :'ret_id'), 'mudar_status atualiza atualizado_em');

-- pedido de exemplo (só a equipe cria; sem telefone; aceita qualquer transição; não entra em clientes)
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', '{"origem":"exemplo","cliente":{"nome":"Ana (exemplo)","telefone":""}}')) as ex \gset
select :'ex'::jsonb ->> 'id' as ex_id \gset
select pg_temp.ok(:'ex'::jsonb @> '{"origem":"exemplo","cliente":{"telefone":""}}', 'equipe cria pedido de exemplo sem telefone');
select pg_temp.igual(mudar_status(:'ex_id', 'entregue') ->> 'status', 'entregue', 'exemplo: novo → entregue direto');
select pg_temp.igual(mudar_status(:'ex_id', 'novo') ->> 'status', 'novo', 'exemplo: entregue → novo');
select pg_temp.igual(mudar_status(:'ex_id', 'cancelado') ->> 'status', 'cancelado', 'exemplo: cancela sem motivo');
select pg_temp.igual(jsonb_array_length(mudar_status(:'ex_id', 'preparo') -> 'historico')::text, '5', 'exemplo: histórico continua crescendo');
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', '{"origem":"exemplo","cliente":{"nome":"Bruno (exemplo)","telefone":"11900000084"}}')) is not null as x \gset

-- ================= remover_testes =================
select pg_temp.igual(remover_testes()::text, '2', 'remover_testes apaga os 2 pedidos de exemplo');
select pg_temp.igual((select count(*) from pedidos where origem = 'exemplo')::text, '0', 'nenhum exemplo sobrou');
select pg_temp.ok((select count(*) from pedidos where id in (:'ent_id', :'ret_id', :'loc_id', :'canc_id')) = 4, 'pedidos de verdade continuam');
select pg_temp.ok(not exists (select 1 from clientes where telefone = '11900000084'), 'exemplo não entra em clientes');
select pg_temp.igual(remover_testes()::text, '0', 'remover_testes de novo: 0');

-- ================= marcar_esgotado e estado_cardapio =================
select marcar_esgotado('gran-crispy', true);
reset role;
select pg_temp.ok((select esgotado_dia = dia_operacional() from produtos where id = 'gran-crispy'), 'marcar_esgotado grava esgotado_dia = dia_operacional()');
update produtos set ativo = false where id = 'combo-casal';
update adicionais set ativo = false where id = 'pizza';
update produtos set esgotado_dia = dia_operacional() - 1 where id = 'gran-chicken';
select pg_temp.sou(null);
set local role anon;
select estado_cardapio() as e \gset
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'e'::jsonb) k) = array['adicionais', 'diaOperacional', 'esgotados', 'inativos', 'loja', 'precos'],
  'estado_cardapio com as chaves do contrato');
select pg_temp.igual(:'e'::jsonb ->> 'diaOperacional', dia_operacional()::text, 'estado_cardapio: diaOperacional');
select pg_temp.ok(:'e'::jsonb -> 'esgotados' = '["gran-crispy"]', 'estado_cardapio: só o esgotado de hoje (o de ontem já caiu)');
select pg_temp.ok(:'e'::jsonb -> 'inativos' = '["combo-casal"]', 'estado_cardapio: inativos');
select pg_temp.ok((select count(*) from jsonb_object_keys(:'e'::jsonb -> 'precos')) = 56 and :'e'::jsonb #> '{precos,gran-burger}' = '25.90'::jsonb
                  and jsonb_typeof(:'e'::jsonb #> '{precos,gran-burger}') = 'number', 'estado_cardapio: preço dos 56 produtos, como número');
select pg_temp.ok((:'e'::jsonb -> 'precos') ? 'dog-cbo-turbo' and jsonb_typeof(:'e'::jsonb #> '{precos,dog-cbo-turbo}') = 'null'
                  and not (:'e'::jsonb -> 'inativos') ? 'dog-cbo-turbo', 'estado_cardapio: item sem preço vem com preço null (e ativo)');
select pg_temp.ok(:'e'::jsonb -> 'adicionais' = '{"bacon":7.50,"catupiry":7.50,"doritos":7.50,"queijo":7.50}', 'estado_cardapio: adicionais ativos com preço');
select pg_temp.ok(:'e'::jsonb -> 'loja' = jsonb_build_object('modo', 'aberta', 'aceitaFechada', false, 'comboPreco', 14.90, 'horarios', (select horarios from loja)),
  'estado_cardapio: bloco loja');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select marcar_esgotado('gran-crispy', false);
select pg_temp.ok(estado_cardapio() -> 'esgotados' = '[]', 'desmarcar esgotado: some da lista');
-- item sem preço: o painel esgota e libera normalmente, mas nem a equipe pede
select marcar_esgotado('dog-cbo-turbo', true);
select pg_temp.ok(estado_cardapio() -> 'esgotados' = '["dog-cbo-turbo"]', 'marcar_esgotado em item sem preço');
select marcar_esgotado('dog-cbo-turbo', false);
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"dog-cbo-turbo"}]', '{"origem":"exemplo","cliente":{"nome":"Ana (exemplo)","telefone":""}}')),
  'produto_invalido', 'equipe também não pede item sem preço (produto_invalido)');
select pg_temp.igual(pg_temp.erro($$select marcar_esgotado('nao-existe', true)$$), 'nao_encontrado', 'marcar_esgotado de produto inexistente: nao_encontrado');
select pg_temp.igual(pg_temp.erro($$select marcar_esgotado('gran-crispy', null)$$), 'dados_invalidos', 'marcar_esgotado com null: dados_invalidos');

-- ================= definir_loja =================
select pg_temp.ok(definir_loja('fechada') @> '{"modo":"fechada","aceitaFechada":false,"comboPreco":14.90}', 'definir_loja devolve o bloco loja');
select pg_temp.ok(not loja_aberta(), 'definir_loja(fechada) fecha');
select pg_temp.igual(definir_loja('auto') ->> 'modo', 'auto', 'definir_loja(auto)');
select pg_temp.igual(definir_loja('aberta') ->> 'modo', 'aberta', 'definir_loja(aberta)');
select pg_temp.ok(loja_aberta(), 'definir_loja(aberta) abre');
select pg_temp.igual(pg_temp.erro($$select definir_loja('meio-aberta')$$), 'dados_invalidos', 'definir_loja com modo desconhecido: dados_invalidos');
select pg_temp.igual(pg_temp.erro($$select definir_loja(null)$$), 'dados_invalidos', 'definir_loja(null): dados_invalidos');
reset role;

-- ================= acompanhar_pedido (cliente, só com o token) =================
select pg_temp.sou(null);
set local role anon;
select acompanhar_pedido(:'ent_token') as a \gset
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'a'::jsonb) k) = array['criadoEm', 'historico', 'itens', 'modo', 'numero', 'status', 'total'],
  'acompanhar_pedido: só numero, criadoEm, status, historico, modo, total e itens');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'a'::jsonb #> '{itens,0}') k) = array['nome', 'qtd', 'resumo', 'subtotal'],
  'acompanhar_pedido: itens só com nome, qtd, resumo e subtotal');
select pg_temp.ok(:'a'::text not like '%Carla%' and :'a'::text not like '%11900000080%' and :'a'::text not like '%Secreta%',
  'acompanhar_pedido não devolve nome, telefone nem endereço');
select pg_temp.ok(:'a'::jsonb @> '{"status":"entregue","modo":"entrega","total":25.90,"itens":[{"nome":"Gran Burger","qtd":1,"subtotal":25.90,"resumo":"Completo · Não prensado"}]}'
                  and jsonb_array_length(:'a'::jsonb -> 'historico') = 4, 'acompanhar_pedido mostra o status atual e o histórico');
select pg_temp.ok(acompanhar_pedido('00000000-0000-4000-8000-00000000abcd') is null, 'token inexistente: null');
select pg_temp.ok(acompanhar_pedido(null) is null, 'token null: null');
reset role;

rollback;
