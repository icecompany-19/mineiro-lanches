-- criar_pedido: preço e resumo do servidor (espelho do core.js), normalização das opções e validação da entrada.
-- Roda como anon (o cliente do cardápio). Loja aberta (o _ajuda.sql deixa assim).
begin;
\ir _ajuda.sql
select pg_temp.sou(null);
set local role anon;

-- ================= preço e resumo =================

-- exemplo do contrato
select criar_pedido(pg_temp.pedido(
  jsonb_build_array(pg_temp.item('gran-bacon-onion', '{"completo":false,"removidos":["Cebola roxa"],"prensado":true,"combo":{"ativo":true,"refri":"Guaraná"},"adicionais":[{"id":"bacon","qtd":1}]}')),
  pg_temp.cliente('11900000001') || '{"modo":"entrega","endereco":"Rua X, 10"}')) as contrato \gset
select pg_temp.igual(:'contrato'::jsonb #>> '{itens,0,resumo}', 'Sem cebola roxa · Prensado · Combo +R$14,90 (Guaraná) · + Bacon', 'resumo igual ao exemplo do contrato');
select pg_temp.igual(:'contrato'::jsonb #>> '{itens,0,precoUnit}', '57.30', 'precoUnit = 34,90 + combo 14,90 + bacon 7,50');
select pg_temp.igual(:'contrato'::jsonb ->> 'total', '57.30', 'total 57,30');
select pg_temp.ok(:'contrato'::jsonb #> '{itens,0}' = '{"produtoId":"gran-bacon-onion","nome":"Gran Bacon Onion","categoria":"artesanais","tipo":"lanche","precoBase":34.90,"precoUnit":57.30,"qtd":1,"completo":false,"removidos":["Cebola roxa"],"prensado":true,"combo":{"ativo":true,"refri":"Guaraná"},"adicionais":[{"id":"bacon","nome":"Bacon","qtd":1,"preco":7.50}],"sabor":"","resumo":"Sem cebola roxa · Prensado · Combo +R$14,90 (Guaraná) · + Bacon","subtotal":57.30}'::jsonb,
  'item exatamente no formato do contrato (nome, categoria, tipo e preços do banco)');
select pg_temp.ok(jsonb_typeof(:'contrato'::jsonb -> 'total') = 'number' and jsonb_typeof(:'contrato'::jsonb -> 'numero') = 'number'
                  and jsonb_typeof(:'contrato'::jsonb #> '{itens,0,precoUnit}') = 'number' and jsonb_typeof(:'contrato'::jsonb #> '{itens,0,subtotal}') = 'number',
  'números saem como números JSON');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'contrato'::jsonb) k)
                  = array['cliente','criadoEm','distanciaKm','endereco','historico','id','itens','mesa','modo','numero','obs','origem','pagamento','referencia','status','taxaEntrega','token','total','troco'],
  'saída com as chaves do contrato do painel + token e mesa');
select pg_temp.ok(:'contrato'::jsonb @> '{"status":"novo","origem":"cardapio","mesa":null,"pagamento":null,"troco":"","obs":"","modo":"entrega","endereco":"Rua X, 10","cliente":{"nome":"Cliente Teste","telefone":"11900000001"}}',
  'status novo, origem cardapio, pagamento null, textos vazios como ""');
select pg_temp.ok(jsonb_array_length(:'contrato'::jsonb -> 'historico') = 1
                  and :'contrato'::jsonb #>> '{historico,0,status}' = 'novo'
                  and :'contrato'::jsonb #>> '{historico,0,em}' = :'contrato'::jsonb ->> 'criadoEm'
                  and (:'contrato'::jsonb ->> 'criadoEm') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$',
  'historico = [{status: novo, em: criadoEm}], data ISO com milissegundos');

-- preço adulterado: tudo que o navegador manda de preço e nome é ignorado
select criar_pedido(pg_temp.pedido(
  '[{"produtoId":"gran-burger","qtd":2,"precoBase":0.01,"precoUnit":0.01,"subtotal":0.01,"nome":"Grátis","resumo":"de graça","tipo":"bebida",
     "adicionais":[{"id":"bacon","qtd":2,"preco":0,"nome":"Ouro"}],"combo":{"ativo":true,"refri":"Coca"}}]',
  pg_temp.cliente('11900000002') || '{"total":0.01}')) as adult \gset
select pg_temp.igual(:'adult'::jsonb ->> 'total', '111.60', 'preço adulterado ignorado: (25,90 + 14,90 + 2 × 7,50) × 2 = 111,60');
select pg_temp.ok(:'adult'::jsonb #> '{itens,0}' @> '{"nome":"Gran Burger","tipo":"lanche","precoBase":25.90,"precoUnit":55.80,"subtotal":111.60,"adicionais":[{"id":"bacon","nome":"Bacon","qtd":2,"preco":7.50}]}',
  'preço adulterado: nome, tipo, precoUnit, subtotal e adicional vêm do banco');
select pg_temp.igual(:'adult'::jsonb #>> '{itens,0,resumo}', 'Completo · Não prensado · Combo +R$14,90 (Coca) · + 2× Bacon', 'resumo do servidor, não o do navegador');

-- vários itens: subtotal = precoUnit × qtd; total = soma
select criar_pedido(pg_temp.pedido(jsonb_build_array(
  pg_temp.item('x-burguer', '{"qtd":3,"adicionais":[{"id":"queijo","qtd":1},{"id":"catupiry","qtd":5}]}'),
  pg_temp.item('refri-lata', '{"qtd":4,"sabor":"  Guaraná  "}'),
  pg_temp.item('porcao-batata'),
  pg_temp.item('combo-diluvio', '{"prensado":true,"adicionais":[{"id":"doritos","qtd":1}]}')),
  pg_temp.cliente('11900000003'))) as varios \gset
select pg_temp.ok((:'varios'::jsonb #> '{itens,0}') @> '{"precoUnit":61.90,"subtotal":185.70,"qtd":3}', 'x-burguer: 16,90 + queijo 7,50 + 5 × catupiry 7,50 = 61,90; × 3 = 185,70');
select pg_temp.igual(:'varios'::jsonb #>> '{itens,0,resumo}', 'Completo · Não prensado · + Queijo · + 5× Catupiry', 'resumo com adicionais na ordem enviada e "5× "');
select pg_temp.ok((:'varios'::jsonb #> '{itens,1}') @> '{"precoUnit":8.00,"subtotal":32.00,"sabor":"Guaraná","resumo":"Guaraná","prensado":false}', 'bebida: 4 × 8,00, sabor aparado, resumo = sabor');
select pg_temp.ok((:'varios'::jsonb #> '{itens,2}') @> '{"subtotal":39.90,"resumo":"","completo":true}', 'porção: resumo vazio');
select pg_temp.ok((:'varios'::jsonb #> '{itens,3}') @> '{"precoUnit":57.40,"prensado":true,"resumo":"Completo · Prensado · + Doritos"}', 'combo do cardápio: prensado e adicional valem');
select pg_temp.igual(:'varios'::jsonb ->> 'total', '315.00', 'total = 185,70 + 32,00 + 39,90 + 57,40');

-- ================= combo só em lanche =================
select pg_temp.ok(pg_temp.um('x-salada', '{"combo":{"ativo":true,"refri":""}}') @> '{"precoUnit":34.80,"combo":{"ativo":true,"refri":""},"resumo":"Completo · Não prensado · Combo +R$14,90"}',
  'combo em lanche: +14,90, sem refri não mostra parênteses');
select pg_temp.ok(pg_temp.um('x-salada', '{"combo":{"ativo":true,"refri":"  Fanta Uva  "}}') @> '{"combo":{"ativo":true,"refri":"Fanta Uva"}}', 'refri aparado');
select pg_temp.ok(pg_temp.um('x-salada', '{"combo":{"ativo":false,"refri":"Coca"}}') @> '{"precoUnit":19.90,"combo":{"ativo":false,"refri":""}}', 'combo desligado: sem preço e sem refri');
select pg_temp.ok(pg_temp.um('x-salada', '{"combo":null}') @> '{"combo":{"ativo":false,"refri":""}}', 'combo null = desligado');
select pg_temp.igual(pg_temp.erro_item('combo-gran-burger', '{"combo":{"ativo":true,"refri":"Coca"}}'), 'produto_invalido', 'combo em item do tipo combo: produto_invalido');
select pg_temp.igual(pg_temp.erro_item('agua', '{"combo":{"ativo":true}}'), 'produto_invalido', 'combo em bebida: produto_invalido');
select pg_temp.igual(pg_temp.erro_item('porcao-onion', '{"combo":{"ativo":true}}'), 'produto_invalido', 'combo em porção: produto_invalido');
select pg_temp.igual(pg_temp.erro_item('x-salada', jsonb_build_object('combo', jsonb_build_object('ativo', true, 'refri', repeat('r', 41)))), 'dados_invalidos', 'refri com 41 caracteres: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-salada', '{"combo":true}'), 'dados_invalidos', 'combo que não é objeto: dados_invalidos');

-- ================= prensado: lanche e combo =================
select pg_temp.ok(pg_temp.um('agua', '{"prensado":true}') @> '{"prensado":false,"resumo":""}', 'prensado em bebida é descartado');
select pg_temp.ok(pg_temp.um('porcao-onion', '{"prensado":true}') @> '{"prensado":false,"resumo":""}', 'prensado em porção é descartado');
select pg_temp.ok(pg_temp.um('combo-x-frango', '{"prensado":true}') @> '{"prensado":true,"precoUnit":39.90,"resumo":"Completo · Prensado"}', 'prensado em combo vale e não muda o preço');
select pg_temp.ok(pg_temp.um('dog-medio', '{"prensado":"sim"}') @> '{"prensado":false}', 'prensado só com true de verdade');

-- ================= adicionais: lanche e combo =================
select pg_temp.igual(pg_temp.erro_item('porcao-onion', '{"adicionais":[{"id":"bacon","qtd":1}]}'), 'produto_invalido', 'adicional em porção: produto_invalido');
select pg_temp.igual(pg_temp.erro_item('refri-lata', '{"adicionais":[{"id":"bacon","qtd":1}]}'), 'produto_invalido', 'adicional em bebida: produto_invalido');
select pg_temp.ok(pg_temp.um('refri-lata', '{"adicionais":[]}') @> '{"adicionais":[]}', 'lista vazia de adicionais em bebida passa');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"cebola","qtd":1}]}'), 'produto_invalido', 'adicional inexistente: produto_invalido');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"bacon","qtd":0}]}'), 'dados_invalidos', 'adicional com qtd 0: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"bacon","qtd":6}]}'), 'dados_invalidos', 'adicional com qtd 6: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"bacon","qtd":1.5}]}'), 'dados_invalidos', 'adicional com qtd fracionada: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"bacon","qtd":"2"}]}'), 'dados_invalidos', 'adicional com qtd em texto: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"bacon","qtd":1},{"id":"bacon","qtd":1}]}'), 'dados_invalidos', 'adicional repetido: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":{"bacon":1}}'), 'dados_invalidos', 'adicionais como objeto (formato da sacola): dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"qtd":1}]}'), 'dados_invalidos', 'adicional sem id: dados_invalidos');
select pg_temp.ok(pg_temp.um('x-burguer', '{"adicionais":[{"id":"pizza"}]}') @> '{"precoUnit":24.40,"adicionais":[{"id":"pizza","qtd":1}]}', 'adicional sem qtd = 1');
select pg_temp.ok(pg_temp.um('x-burguer', '{"adicionais":[{"id":"bacon","qtd":5},{"id":"doritos","qtd":5},{"id":"queijo","qtd":5},{"id":"catupiry","qtd":5},{"id":"pizza","qtd":5}]}')
                  @> '{"precoUnit":204.40}', 'cinco adicionais × 5: 16,90 + 25 × 7,50 = 204,40');
reset role;
update adicionais set ativo = false where id = 'pizza';
set local role anon;
select pg_temp.igual(pg_temp.erro_item('x-burguer', '{"adicionais":[{"id":"pizza","qtd":1}]}'), 'produto_invalido', 'adicional inativo: produto_invalido');

-- ================= removidos: só os ingredientes, ordenados =================
select pg_temp.ok(pg_temp.um('gran-bacon-onion', '{"completo":false,"removidos":["Tomate em rodelas","Abacaxi","Bacon em fatias","Cebola roxa","2 onion rings","Tomate em rodelas","Bacon"]}')
                  @> '{"completo":false,"removidos":["2 onion rings","Bacon em fatias","Cebola roxa","Tomate em rodelas"],"resumo":"Sem 2 onion rings, bacon em fatias, cebola roxa, tomate em rodelas · Não prensado"}',
  'removidos fora dos ingredientes descartados (Abacaxi; Bacon, que aqui é "Bacon em fatias"), sem repetir e em ordem');
select pg_temp.ok(pg_temp.um('gran-big-tudo', '{"completo":false,"removidos":["Requeijão","Batata palha"]}')
                  @> '{"removidos":["Batata palha","Requeijão"],"resumo":"Sem batata palha, requeijão · Não prensado"}',
  'resumo em minúsculas com acento');
select pg_temp.ok(pg_temp.um('gran-burger', '{"completo":false,"removidos":["Abacaxi"]}') @> '{"completo":true,"removidos":[],"resumo":"Completo · Não prensado"}',
  'só removidos inválidos: completo');
select pg_temp.ok(pg_temp.um('gran-burger', '{"completo":true,"removidos":["Queijo"]}') @> '{"completo":true,"removidos":[]}', 'completo = true descarta os removidos (como o core.js)');
select pg_temp.ok(pg_temp.novo(jsonb_build_array(pg_temp.item('gran-burger', '{"removidos":["Queijo"]}') - 'completo')) #> '{itens,0}'
                  @> '{"completo":false,"removidos":["Queijo"],"resumo":"Sem queijo · Não prensado"}', 'sem o campo completo, valem os removidos');
select pg_temp.ok(pg_temp.um('agua', '{"completo":false,"removidos":["Gelo"]}') @> '{"completo":true,"removidos":[],"resumo":""}', 'removidos em bebida: nada');
select pg_temp.ok(pg_temp.um('gran-burger', '{"completo":false,"removidos":["queijo"]}') @> '{"removidos":[]}', 'removido precisa bater exatamente com o ingrediente');
select pg_temp.igual(pg_temp.erro_item('gran-burger', '{"completo":false,"removidos":"Queijo"}'), 'dados_invalidos', 'removidos que não é lista: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('gran-burger', jsonb_build_object('completo', false, 'removidos', (select jsonb_agg('Queijo'::text) from generate_series(1, 51)))),
  'dados_invalidos', 'mais de 50 removidos: dados_invalidos');

-- ================= qtd =================
select pg_temp.ok(pg_temp.um('refri-dolly', '{"qtd":20}') @> '{"qtd":20,"precoUnit":4.50,"subtotal":90.00}', 'qtd 20: subtotal 90,00');
select pg_temp.ok(pg_temp.um('refri-dolly', '{"qtd":null}') @> '{"qtd":1}', 'qtd ausente = 1');
select pg_temp.igual(pg_temp.erro_item('refri-dolly', '{"qtd":0}'), 'dados_invalidos', 'qtd 0: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('refri-dolly', '{"qtd":21}'), 'dados_invalidos', 'qtd 21: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('refri-dolly', '{"qtd":-1}'), 'dados_invalidos', 'qtd negativa: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('refri-dolly', '{"qtd":1.5}'), 'dados_invalidos', 'qtd fracionada: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('refri-dolly', '{"qtd":"2"}'), 'dados_invalidos', 'qtd em texto: dados_invalidos');

-- ================= sabor =================
select pg_temp.ok(pg_temp.um('suco-lata', jsonb_build_object('sabor', repeat('s', 40))) @> jsonb_build_object('sabor', repeat('s', 40)), 'sabor com 40 caracteres passa');
select pg_temp.igual(pg_temp.erro_item('suco-lata', jsonb_build_object('sabor', repeat('s', 41))), 'dados_invalidos', 'sabor com 41 caracteres: dados_invalidos');

-- ================= itens e produtos =================
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[]', pg_temp.cliente(pg_temp.tel_novo()))), 'dados_invalidos', 'sem itens: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido((select jsonb_agg(pg_temp.item('agua')) from generate_series(1, 31)), pg_temp.cliente(pg_temp.tel_novo()))),
  'dados_invalidos', '31 linhas: dados_invalidos');
select pg_temp.ok(jsonb_array_length(pg_temp.novo((select jsonb_agg(pg_temp.item('agua')) from generate_series(1, 30))) -> 'itens') = 30, '30 linhas passam');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('{"produtoId":"agua"}', pg_temp.cliente(pg_temp.tel_novo()))), 'dados_invalidos', 'itens que não é lista: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('["agua"]', pg_temp.cliente(pg_temp.tel_novo()))), 'dados_invalidos', 'item que não é objeto: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"qtd":1}]', pg_temp.cliente(pg_temp.tel_novo()))), 'dados_invalidos', 'item sem produtoId: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.cliente(pg_temp.tel_novo()) || '{"modo":"local"}'), 'dados_invalidos', 'sem o campo itens: dados_invalidos');
select pg_temp.igual(pg_temp.erro_item('pizza-calabresa'), 'produto_invalido', 'produto inexistente: produto_invalido');
reset role;
update produtos set ativo = false where id = 'gran-egg';
set local role anon;
select pg_temp.igual(pg_temp.erro_item('gran-egg'), 'produto_invalido', 'produto inativo: produto_invalido');

-- ================= "Preço a confirmar" (preco null): está no cardápio, mas não se vende pelo site =================
select pg_temp.ok(pg_temp.um('dog-cbo-turbo') @> '{"precoBase":34.90,"precoUnit":34.90,"subtotal":34.90}', 'CBO Turbo custa 34,90 no pedido');
reset role;
update produtos set preco = null where id = 'dog-cbo-turbo'; -- cenário de teste: produto que perdeu o preço
set local role anon;
select pg_temp.igual(pg_temp.erro_item('dog-cbo-turbo'), 'produto_invalido', 'item sem preço (CBO Turbo): produto_invalido');
select pg_temp.igual(pg_temp.erro_item('dog-cbo-turbo', '{"qtd":2,"prensado":true,"combo":{"ativo":true,"refri":"Coca"},"adicionais":[{"id":"bacon","qtd":1}],"precoUnit":30,"subtotal":60}'),
  'produto_invalido', 'item sem preço com combo, adicional e preço mandado pelo navegador: produto_invalido');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('agua'), pg_temp.item('dog-cbo-turbo')), pg_temp.cliente('11900000030'))),
  'produto_invalido', 'um item sem preço recusa o pedido inteiro');
reset role;
select pg_temp.ok(not exists (select 1 from pedidos where cliente_telefone = '11900000030') and not exists (select 1 from clientes where telefone = '11900000030'),
  'pedido recusado por item sem preço não grava pedido nem cliente');
update produtos set preco = null where id = 'x-burguer';
set local role anon;
select pg_temp.igual(pg_temp.erro_item('x-burguer'), 'produto_invalido', 'produto que perdeu o preço no banco: produto_invalido');
reset role;
update produtos set preco = 16.90 where id = 'x-burguer';
set local role anon;
select pg_temp.ok(pg_temp.um('x-burguer') @> '{"precoUnit":16.90}', 'com preço de novo, volta a ser vendido');

-- ================= cliente, modo e textos =================
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo(), 'A'))), 'dados_invalidos', 'nome com 1 caractere: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo(), '   A   '))), 'dados_invalidos', 'nome aparado antes de contar');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo(), repeat('n', 81)))), 'dados_invalidos', 'nome com 81 caracteres: dados_invalidos');
select pg_temp.ok(pg_temp.novo('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo(), '  ' || repeat('n', 80) || ' ')) #>> '{cliente,nome}' = repeat('n', 80), 'nome com 80 caracteres passa, aparado');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('119000001'))), 'dados_invalidos', 'telefone com 9 dígitos: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('119000000001'))), 'dados_invalidos', 'telefone com 12 dígitos: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(''))), 'dados_invalidos', 'telefone vazio: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', '{"cliente":{"nome":"Ana"}}')), 'dados_invalidos', 'sem telefone: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', '{"cliente":"Ana"}')), 'dados_invalidos', 'cliente que não é objeto: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]') - 'cliente'), 'dados_invalidos', 'sem cliente: dados_invalidos');
select pg_temp.igual(pg_temp.novo('[{"produtoId":"agua"}]', pg_temp.cliente('(11) 90000-0004')) #>> '{cliente,telefone}', '11900000004', 'telefone formatado vira só dígitos');
select pg_temp.igual(pg_temp.novo('[{"produtoId":"agua"}]', pg_temp.cliente('1140000000')) #>> '{cliente,telefone}', '1140000000', 'telefone fixo com 10 dígitos passa');
select pg_temp.igual(pg_temp.erro_pedido('[]'), 'dados_invalidos', 'entrada que não é objeto: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(null), 'dados_invalidos', 'entrada null: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"modo":"delivery"}')), 'dados_invalidos', 'modo desconhecido: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo())) - 'modo'), 'dados_invalidos', 'sem modo: dados_invalidos');
select pg_temp.igual(pg_temp.novo('[{"produtoId":"agua"}]', '{"modo":"local","mesa":" 3 "}') ->> 'mesa', '3', 'modo local com mesa');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"modo":"entrega"}')), 'dados_invalidos', 'entrega sem endereço: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"modo":"entrega","endereco":"  Rua  "}')), 'dados_invalidos', 'entrega com endereço de 3 caracteres: dados_invalidos');
select pg_temp.igual(pg_temp.novo('[{"produtoId":"agua"}]', '{"modo":"entrega","endereco":"Rua 1"}') ->> 'endereco', 'Rua 1', 'endereço com 5 caracteres passa');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || jsonb_build_object('modo', 'entrega', 'endereco', repeat('e', 201)))), 'dados_invalidos', 'endereço com 201: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || jsonb_build_object('referencia', repeat('r', 121)))), 'dados_invalidos', 'referência com 121: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || jsonb_build_object('obs', repeat('o', 301)))), 'dados_invalidos', 'obs com 301: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || jsonb_build_object('troco', repeat('t', 41)))), 'dados_invalidos', 'troco com 41: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || jsonb_build_object('pagamento', repeat('p', 31)))), 'dados_invalidos', 'pagamento com 31: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || jsonb_build_object('mesa', repeat('m', 11)))), 'dados_invalidos', 'mesa com 11: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"obs":{"x":1}}')), 'dados_invalidos', 'obs que não é texto: dados_invalidos');
select pg_temp.ok(pg_temp.novo('[{"produtoId":"agua"}]', jsonb_build_object('modo', 'entrega', 'endereco', repeat('e', 200), 'referencia', repeat('r', 120), 'obs', repeat('o', 300),
                                                                         'troco', repeat('t', 40), 'pagamento', repeat('p', 30), 'mesa', repeat('m', 10)))
                  @> jsonb_build_object('endereco', repeat('e', 200), 'referencia', repeat('r', 120), 'obs', repeat('o', 300), 'troco', repeat('t', 40), 'pagamento', repeat('p', 30), 'mesa', repeat('m', 10)),
  'textos no limite passam (200, 120, 300, 40, 30, 10)');
select pg_temp.ok(pg_temp.novo('[{"produtoId":"agua"}]', '{"pagamento":"  ","mesa":"","troco":" 50 ","obs":" sem gelo "}') @> '{"pagamento":null,"mesa":null,"troco":"50","obs":"sem gelo"}',
  'pagamento e mesa vazios viram null; textos aparados');

-- ================= origem =================
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"origem":"exemplo"}')), 'sem_permissao', 'origem exemplo fora da equipe: sem_permissao');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente(pg_temp.tel_novo()) || '{"origem":"site"}')), 'dados_invalidos', 'origem desconhecida: dados_invalidos');
select pg_temp.igual(pg_temp.novo('[{"produtoId":"agua"}]', '{"origem":null}') ->> 'origem', 'cardapio', 'sem origem: cardapio');
select pg_temp.igual(pg_temp.novo('[{"produtoId":"agua"}]', '{"origem":"qrcode","modo":"local","mesa":"7"}') ->> 'origem', 'qrcode', 'origem qrcode');

-- ================= clientes (upsert) =================
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000020', 'Bia') || '{"modo":"entrega","endereco":"Rua A, 1","referencia":"Casa azul"}')) is not null as x \gset
-- 'retirada' continua aceito pelo RPC (D7); só não aparece no front. Este é o caso que mantém a cobertura.
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000020', 'Beatriz') || '{"modo":"retirada"}')) is not null as x \gset
reset role;
select pg_temp.ok((select nome = 'Beatriz' and endereco = 'Rua A, 1' and referencia = 'Casa azul' and pedidos = 2 from clientes where telefone = '11900000020'),
  'clientes: upsert por telefone, conta pedidos, nome novo, endereço mantido na retirada');
set local role anon;
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000020', 'Beatriz') || '{"modo":"entrega","endereco":"Rua B, 2"}')) is not null as x \gset
reset role;
select pg_temp.ok((select endereco = 'Rua B, 2' and referencia = '' and pedidos = 3 and primeiro_pedido_em <= ultimo_pedido_em from clientes where telefone = '11900000020'),
  'clientes: entrega nova atualiza o endereço');
select pg_temp.igual((select count(*) from pedidos where cliente_telefone = '11900000020')::text, '3', 'os três pedidos gravados');

rollback;
