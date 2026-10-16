-- criar_pedido: taxa de entrega por distância (km da rota, sempre para cima, x taxa_km + taxa_fixa) entra no total.
-- O navegador manda distanciaKm; o banco refaz a conta e grava distancia_km e taxa_entrega. Roda como anon, loja aberta.
begin;
\ir _ajuda.sql
select pg_temp.sou(null);
set local role anon;

-- 10 km = 10 x 1,00 + 4,00 = R$ 14,00 (exemplo do dono: "10km + 4 reais")
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')),
  pg_temp.cliente('11900006001') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":10}')) as p10 \gset
select pg_temp.igual(:'p10'::jsonb ->> 'taxaEntrega', '14.00', '10 km: taxa 14,00');
select pg_temp.igual(:'p10'::jsonb ->> 'total', '29.90', '10 km: total = dog-max 15,90 + taxa 14,00');
select pg_temp.igual(:'p10'::jsonb ->> 'distanciaKm', '10.000', 'distância guardada com 3 casas');

-- sempre para cima: 3,2 km cobra 4 km (8,00); 3,0 km cobra 3 km (7,00); 0,4 km cobra 1 km (5,00); 3,001 cobra 4 km (8,00)
select pg_temp.igual((criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006002') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":3.2}')) ->> 'taxaEntrega'), '8.00', '3,2 km arredonda para 4 km: 8,00');
select pg_temp.igual((criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006003') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":3}')) ->> 'taxaEntrega'), '7.00', '3 km exatos: 7,00');
select pg_temp.igual((criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006004') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":0.4}')) ->> 'taxaEntrega'), '5.00', '0,4 km vira 1 km: 5,00');
select pg_temp.igual((criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006005') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":3.001}')) ->> 'taxaEntrega'), '8.00', '3,001 km vira 4 km: 8,00');
select pg_temp.igual((criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006006') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":3.0004}')) ->> 'taxaEntrega'), '7.00', '3,0004 km (menos de 1 m) fica em 3 km: 7,00');

-- sem distância (falha da consulta de endereço): taxa a combinar (null) e total só dos itens
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006007') || '{"modo":"entrega","endereco":"Rua X, 10"}')) as sem \gset
select pg_temp.ok(:'sem'::jsonb -> 'taxaEntrega' = 'null'::jsonb and :'sem'::jsonb -> 'distanciaKm' = 'null'::jsonb, 'sem distanciaKm: taxa e distância null (a combinar)');
select pg_temp.igual(:'sem'::jsonb ->> 'total', '15.90', 'sem distanciaKm: total só dos itens');
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006008') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":null}')) as nulo \gset
select pg_temp.ok(:'nulo'::jsonb -> 'taxaEntrega' = 'null'::jsonb, 'distanciaKm null: a combinar');

-- comer no local não paga entrega, mesmo que o navegador mande a distância
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006009') || '{"modo":"local","distanciaKm":5}')) as loc \gset
select pg_temp.ok(:'loc'::jsonb -> 'taxaEntrega' = 'null'::jsonb and :'loc'::jsonb ->> 'total' = '15.90', 'comer no local: sem taxa, total só dos itens');

-- entrada inválida
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006010') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":0}')), 'dados_invalidos', 'distância 0: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006011') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":-2}')), 'dados_invalidos', 'distância negativa: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006012') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":100.5}')), 'dados_invalidos', 'distância acima de 100 km: dados_invalidos');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006013') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":"5"}')), 'dados_invalidos', 'distância em texto: dados_invalidos');

-- a taxa e o total adulterados no navegador são ignorados: vale a conta do banco
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006014') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":2,"taxaEntrega":0,"total":1}')) as adu \gset
select pg_temp.igual(:'adu'::jsonb ->> 'taxaEntrega', '6.00', 'taxa adulterada ignorada: 2 km = 6,00');
select pg_temp.igual(:'adu'::jsonb ->> 'total', '21.90', 'total adulterado ignorado: 15,90 + 6,00');

-- taxa_km e taxa_fixa vêm da loja (CONFIG): mudando, a conta muda
reset role;
update loja set taxa_km = 1.50, taxa_fixa = 5.00;
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual((criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')), pg_temp.cliente('11900006015') || '{"modo":"entrega","endereco":"Rua X, 10","distanciaKm":3.2}')) ->> 'taxaEntrega'), '11.00', 'taxa_km 1,50 e fixa 5,00: 4 km = 11,00');
reset role;

-- acompanhar_pedido devolve a taxa (e continua sem nome, telefone nem endereço)
select pg_temp.sou(null);
set local role anon;
select (:'p10'::jsonb ->> 'token')::uuid as tok \gset
select pg_temp.ok(acompanhar_pedido(:'tok') @> '{"taxaEntrega":14.00,"distanciaKm":10.000}'::jsonb, 'acompanhar_pedido traz taxaEntrega e distanciaKm');
select pg_temp.ok(not (acompanhar_pedido(:'tok') ? 'endereco') and not (acompanhar_pedido(:'tok') ? 'cliente'), 'acompanhar_pedido continua sem endereço nem cliente');
reset role;

-- estado_cardapio traz a regra da taxa para o navegador
select pg_temp.sou(null);
set local role anon;
select pg_temp.ok((estado_cardapio() #> '{loja,taxaKm}') is not null and (estado_cardapio() #> '{loja,taxaFixa}') is not null, 'estado_cardapio: loja com taxaKm e taxaFixa');
reset role;
rollback;
