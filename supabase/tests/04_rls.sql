-- RLS e privilégios: anon não lê pedidos, clientes e equipe e não escreve em nada; authenticated fora da equipe
-- não lê pedidos nem clientes; a equipe lê, mas também não escreve direto (tudo por RPC).
-- 42501 = sem privilégio (o PostgREST devolve 401/403).
begin;
\ir _ajuda.sql

-- um pedido e um cliente para existir o que ler
select criar_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', pg_temp.cliente('11900000070'))) ->> 'id' as pid \gset

-- ================= anon =================
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual((select count(*) from produtos)::text, '56', 'anon lê os 56 produtos');
select pg_temp.igual((select count(*) from adicionais)::text, '5', 'anon lê os adicionais');
select pg_temp.igual((select count(*) from loja)::text, '1', 'anon lê a loja');
select pg_temp.igual(pg_temp.erro('select * from pedidos'), '42501', 'anon não lê pedidos');
select pg_temp.igual(pg_temp.erro('select * from clientes'), '42501', 'anon não lê clientes');
select pg_temp.igual(pg_temp.erro('select * from equipe'), '42501', 'anon não lê equipe');
select pg_temp.igual(pg_temp.erro($$insert into produtos (id, categoria, nome, preco, tipo) values ('x', 'c', 'X', 1, 'lanche')$$), '42501', 'anon não insere produto');
select pg_temp.igual(pg_temp.erro($$update produtos set preco = 0.01$$), '42501', 'anon não muda preço');
select pg_temp.igual(pg_temp.erro($$update produtos set esgotado_dia = current_date$$), '42501', 'anon não esgota produto');
select pg_temp.igual(pg_temp.erro($$delete from produtos$$), '42501', 'anon não apaga produto');
select pg_temp.igual(pg_temp.erro($$insert into adicionais (id, nome, preco) values ('x', 'X', 0)$$), '42501', 'anon não insere adicional');
select pg_temp.igual(pg_temp.erro($$update adicionais set preco = 0$$), '42501', 'anon não muda adicional');
select pg_temp.igual(pg_temp.erro($$delete from adicionais$$), '42501', 'anon não apaga adicional');
select pg_temp.igual(pg_temp.erro($$update loja set modo = 'aberta'$$), '42501', 'anon não abre a loja');
select pg_temp.igual(pg_temp.erro($$delete from loja$$), '42501', 'anon não apaga a loja');
select pg_temp.igual(pg_temp.erro($$insert into pedidos (cliente_nome, cliente_telefone, modo, itens, total) values ('Ana', '11900000071', 'local', '[]', 0)$$), '42501', 'anon não insere pedido direto');
select pg_temp.igual(pg_temp.erro(format($$update pedidos set total = 0 where id = %L$$, :'pid')), '42501', 'anon não muda pedido');
select pg_temp.igual(pg_temp.erro($$delete from pedidos$$), '42501', 'anon não apaga pedido');
select pg_temp.igual(pg_temp.erro($$insert into clientes (telefone, nome) values ('11900000071', 'Ana')$$), '42501', 'anon não insere cliente');
select pg_temp.igual(pg_temp.erro($$delete from clientes$$), '42501', 'anon não apaga cliente');
select pg_temp.igual(pg_temp.erro(format($$insert into equipe (user_id) values (%L)$$, :'estranho')), '42501', 'anon não se põe na equipe');
select pg_temp.igual(pg_temp.erro($$truncate pedidos$$), '42501', 'anon não esvazia pedidos');
select pg_temp.igual(pg_temp.erro($$select nextval(pg_get_serial_sequence('pedidos', 'numero'))$$), '42501', 'anon não gasta números de pedido');
select pg_temp.ok(not is_equipe(), 'anon: is_equipe() = false');
-- funções da equipe e internas
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'preparo')$$, :'pid')), '42501', 'anon não chama mudar_status');
select pg_temp.igual(pg_temp.erro($$select marcar_esgotado('gran-burger', true)$$), '42501', 'anon não chama marcar_esgotado');
select pg_temp.igual(pg_temp.erro($$select definir_loja('fechada')$$), '42501', 'anon não chama definir_loja');
select pg_temp.igual(pg_temp.erro($$select remover_testes()$$), '42501', 'anon não chama remover_testes');
select pg_temp.igual(pg_temp.erro($$select resumo_item('{}', 14.90)$$), '42501', 'anon não chama funções internas (resumo_item)');
select pg_temp.igual(pg_temp.erro($$select horario_aberto('{}')$$), '42501', 'anon não chama funções internas (horario_aberto)');
reset role;

-- ================= authenticated fora da equipe =================
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.ok(not is_equipe(), 'logado fora da equipe: is_equipe() = false');
select pg_temp.igual((select count(*) from pedidos)::text, '0', 'logado fora da equipe não vê pedidos');
select pg_temp.igual((select count(*) from clientes)::text, '0', 'logado fora da equipe não vê clientes');
select pg_temp.igual((select count(*) from equipe)::text, '0', 'logado fora da equipe não vê a equipe');
select pg_temp.igual((select count(*) from produtos)::text, '56', 'logado fora da equipe lê o cardápio');
select pg_temp.igual(pg_temp.erro($$update produtos set preco = 0.01$$), '42501', 'logado fora da equipe não muda preço');
select pg_temp.igual(pg_temp.erro($$update loja set modo = 'fechada'$$), '42501', 'logado fora da equipe não muda a loja');
select pg_temp.igual(pg_temp.erro(format($$insert into equipe (user_id) values (%L)$$, :'estranho')), '42501', 'logado fora da equipe não se põe na equipe');
select pg_temp.igual(pg_temp.erro($$delete from pedidos$$), '42501', 'logado fora da equipe não apaga pedidos');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'preparo')$$, :'pid')), 'sem_permissao', 'logado fora da equipe: mudar_status → sem_permissao');
select pg_temp.igual(pg_temp.erro($$select marcar_esgotado('gran-burger', true)$$), 'sem_permissao', 'logado fora da equipe: marcar_esgotado → sem_permissao');
select pg_temp.igual(pg_temp.erro($$select definir_loja('fechada')$$), 'sem_permissao', 'logado fora da equipe: definir_loja → sem_permissao');
select pg_temp.igual(pg_temp.erro($$select remover_testes()$$), 'sem_permissao', 'logado fora da equipe: remover_testes → sem_permissao');
select pg_temp.igual(pg_temp.erro($$select pedido_json(p) from pedidos p$$), '42501', 'logado fora da equipe não chama funções internas (pedido_json)');
reset role;

-- ================= equipe =================
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.ok(is_equipe(), 'equipe: is_equipe() = true');
select pg_temp.ok((select count(*) from pedidos where id = :'pid') = 1, 'equipe lê pedidos');
select pg_temp.ok((select count(*) from clientes where telefone = '11900000070') = 1, 'equipe lê clientes');
select pg_temp.igual((select string_agg(user_id::text, ',') from equipe), :'equipe', 'equipe vê só a própria linha');
select pg_temp.igual(pg_temp.erro(format($$update pedidos set status = 'entregue' where id = %L$$, :'pid')), '42501', 'equipe não muda pedido direto (só por RPC)');
select pg_temp.igual(pg_temp.erro($$update produtos set esgotado_dia = current_date$$), '42501', 'equipe não esgota direto (só por RPC)');
select pg_temp.igual(pg_temp.erro($$delete from pedidos$$), '42501', 'equipe não apaga direto');
select pg_temp.igual(pg_temp.erro(format($$insert into equipe (user_id) values (%L)$$, :'estranho')), '42501', 'equipe não põe outros na equipe pela API');
reset role;

rollback;
