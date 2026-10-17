-- Motoboy (migration 20261017000001): tabela motoboys, is_motoboy, entregas_em_rota e confirmar_entrega.
-- O motoboy lê o QR da comanda e a leitura já marca o pedido como entregue. Ele não é da equipe: não lê pedidos,
-- clientes nem equipe, não muda status pela API e só enxerga as entregas em rota do dia, sem itens e sem token.
-- 42501 = sem privilégio (o PostgREST devolve 401/403). Dentro de $$...$$ o psql não troca :'variavel': por isso format().
begin;
\ir _ajuda.sql

\set outro 00000000-0000-4000-8000-000000000004
\set efemero 00000000-0000-4000-8000-000000000005

-- ajudantes deste teste
-- cria um pedido de entrega (gran-burger, 2,5 km → taxa 7,00) e devolve o id; p_extra sobrescreve campos (modo, endereço...)
create function pg_temp.pedir(p_tel text, p_nome text, p_extra jsonb default '{}') returns text language sql as $$
  select criar_pedido(pg_temp.pedido('[{"produtoId":"gran-burger"}]', pg_temp.cliente(p_tel, p_nome)
    || '{"modo":"entrega","endereco":"Rua da Entrega, 10","referencia":"Portão azul","obs":"Sem cebola","distanciaKm":2.5}'::jsonb
    || p_extra)) ->> 'id'
$$;
-- caminho do pedido no histórico: status1>status2>...
create function pg_temp.fluxo(p_id text) returns text language sql as $$
  select string_agg(h ->> 'status', '>' order by n) from pedidos p, jsonb_array_elements(p.historico) with ordinality x(h, n) where p.id = p_id::uuid
$$;
-- quem fez cada passo do histórico ("-" = evento sem "por"): -,-,motoboy
create function pg_temp.quem(p_id text) returns text language sql as $$
  select string_agg(coalesce(h ->> 'por', '-'), ',' order by n) from pedidos p, jsonb_array_elements(p.historico) with ordinality x(h, n) where p.id = p_id::uuid
$$;
-- o id aparece na lista devolvida por entregas_em_rota?
create function pg_temp.tem(p_lista jsonb, p_id text) returns boolean language sql as $$
  select coalesce(bool_or(e ->> 'id' = p_id), false) from jsonb_array_elements(p_lista) e
$$;
create function pg_temp.chaves(p jsonb) returns text language sql as $$
  select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(p) k
$$;

update motoboys set ativo = true where user_id = :'moto';
-- pedidos de outras sessões que estejam em rota hoje estragariam a contagem das listas (a transação desfaz tudo no fim)
update pedidos set status = 'entregue' where status = 'rota';

-- ================= a tabela =================
select pg_temp.igual(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'motoboys'),
  'user_id:uuid:NO,nome:text:NO,ativo:boolean:NO', 'motoboys: user_id, nome e ativo, todos not null');
insert into auth.users (id, email) values (:'outro', 'outro-moto@teste.local');
insert into motoboys (user_id) values (:'outro');
select pg_temp.ok((select nome = '' and ativo from motoboys where user_id = :'outro'), 'motoboys: nome vazio e ativo por padrão');
select pg_temp.igual(pg_temp.erro(format($$insert into motoboys (user_id) values (%L)$$, :'estranho')), '23503',
  'motoboys: user_id precisa existir em auth.users');
select pg_temp.igual(pg_temp.erro(format($$insert into motoboys (user_id) values (%L)$$, :'outro')), '23505', 'motoboys: um usuário, uma linha');

-- ================= pedidos de partida =================
-- criados pelo cliente; o andamento vem da equipe (mudar_status) ou, nos casos que a tela não gera, de update direto
select pg_temp.pedir('11900000090', 'Davi Entrega') as ea_id \gset
select pg_temp.pedir('11900000091', 'Eva Rota') as ea2_id \gset
select pg_temp.pedir('11900000088', 'Fábio Rota') as ea3_id \gset
select pg_temp.pedir('11900000092', 'Gil Preparo') as eb_id \gset
select pg_temp.pedir('11900000093', 'Hugo Pronto') as ec_id \gset
select pg_temp.pedir('11900000094', 'Iara Nova') as ed_id \gset
select pg_temp.pedir('11900000095', 'Jonas Cancelado') as ee_id \gset
select pg_temp.pedir('11900000096', 'Kátia Entregue') as ef_id \gset
select pg_temp.pedir('11900000097', 'Lia Antiga') as eg_id \gset
select pg_temp.pedir('11900000098', 'Leo Local', '{"modo":"local","endereco":"","referencia":"","distanciaKm":null}') as lp_id \gset
select pg_temp.pedir('11900000099', 'Rui Retirada', '{"modo":"retirada","endereco":"","referencia":"","distanciaKm":null}') as rt_id \gset
select pg_temp.pedir('11900000089', 'Lara Local', '{"modo":"local","endereco":"","referencia":"","distanciaKm":null}') as lr_id \gset

select pg_temp.sou(:'equipe');
set local role authenticated;
select mudar_status(:'ea_id', 'preparo');
select mudar_status(:'ea_id', 'rota');
select mudar_status(:'ea2_id', 'preparo');
select mudar_status(:'ea2_id', 'rota');
select mudar_status(:'ea3_id', 'preparo');
select mudar_status(:'ea3_id', 'rota');
select mudar_status(:'eb_id', 'preparo');
select mudar_status(:'ee_id', 'cancelado', 'teste');
select mudar_status(:'ef_id', 'preparo');
select mudar_status(:'ef_id', 'rota');
select mudar_status(:'ef_id', 'entregue');
select mudar_status(:'lp_id', 'preparo');
select mudar_status(:'lp_id', 'pronto');
reset role;
-- entrega em "pronto" só existe se alguém mexeu no banco (a tela manda entrega de preparo para rota)
update pedidos set status = 'pronto' where id = :'ec_id';
-- local em "rota": também não nasce pela tela
update pedidos set status = 'rota' where id = :'lr_id';
-- preso em "rota" desde antes de hoje (os pedidos velhos que ninguém marcou como entregues)
update pedidos set status = 'rota', criado_em = now() - interval '2 days' where id = :'eg_id';
select pg_temp.igual(pg_temp.fluxo(:'ea_id'), 'novo>preparo>rota', 'partida: ea em rota, histórico novo>preparo>rota');
select pg_temp.igual(pg_temp.fluxo(:'eb_id'), 'novo>preparo', 'partida: eb em preparo');
select pg_temp.igual(pg_temp.fluxo(:'ec_id'), 'novo', 'partida: ec em pronto, histórico só com o novo');

-- ================= is_motoboy e is_equipe (internas; quem chama vem do JWT) =================
select pg_temp.sou(:'moto');
select pg_temp.ok(is_motoboy() and not is_equipe(), 'motoboy: is_motoboy() = true e is_equipe() = false');
select pg_temp.sou(:'equipe');
select pg_temp.ok(is_equipe() and not is_motoboy(), 'equipe: is_equipe() = true e is_motoboy() = false');
select pg_temp.sou(:'estranho');
select pg_temp.ok(not is_motoboy() and not is_equipe(), 'logado de fora: nem motoboy nem equipe');
select pg_temp.sou(null);
select pg_temp.ok(not is_motoboy(), 'anon: is_motoboy() = false');

-- ================= anon =================
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro('select entregas_em_rota()'), '42501', 'anon não chama entregas_em_rota');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'ea_id')), '42501', 'anon não chama confirmar_entrega');
select pg_temp.igual(pg_temp.erro($$select confirmar_entrega(null)$$), '42501', 'anon não chama confirmar_entrega nem com id null');
select pg_temp.igual(pg_temp.erro('select is_motoboy()'), '42501', 'anon não chama is_motoboy (interna)');
select pg_temp.igual(pg_temp.erro('select entrega_json(p) from pedidos p'), '42501', 'anon não chama entrega_json (interna)');
select pg_temp.igual(pg_temp.erro('select * from motoboys'), '42501', 'anon não lê motoboys');
select pg_temp.igual(pg_temp.erro(format($$insert into motoboys (user_id) values (%L)$$, :'estranho')), '42501', 'anon não se põe como motoboy');
select pg_temp.igual(pg_temp.erro('update motoboys set ativo = true'), '42501', 'anon não muda motoboys');
select pg_temp.igual(pg_temp.erro('delete from motoboys'), '42501', 'anon não apaga motoboys');
reset role;
select pg_temp.igual((select status from pedidos where id = :'ea_id'), 'rota', 'anon não entregou nada');

-- ================= logado de fora (nem equipe nem motoboy) =================
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select entregas_em_rota()'), 'sem_permissao', 'logado de fora: entregas_em_rota → sem_permissao');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'ea_id')), 'sem_permissao', 'logado de fora: confirmar_entrega → sem_permissao');
select pg_temp.igual(pg_temp.erro($$select confirmar_entrega(null)$$), 'sem_permissao', 'logado de fora: a permissão vem antes da validação (id null)');
select pg_temp.igual(pg_temp.erro($$select confirmar_entrega('00000000-0000-4000-8000-00000000abcd')$$), 'sem_permissao',
  'logado de fora não descobre se o pedido existe (sem_permissao, não nao_encontrado)');
select pg_temp.igual(pg_temp.erro('select is_motoboy()'), '42501', 'logado de fora não chama is_motoboy (interna)');
select pg_temp.igual(pg_temp.erro('select entrega_json(p) from pedidos p'), '42501', 'logado de fora não chama entrega_json (interna)');
select pg_temp.igual((select count(*) from motoboys)::text, '0', 'logado de fora não vê motoboys');
select pg_temp.igual(pg_temp.erro(format($$insert into motoboys (user_id) values (%L)$$, :'estranho')), '42501', 'logado de fora não se põe como motoboy pela API');
reset role;
select pg_temp.igual((select status from pedidos where id = :'ea_id'), 'rota', 'logado de fora não entregou nada');

-- ================= equipe: não é motoboy, mas também confirma =================
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual((select count(*) from motoboys)::text, '0', 'equipe não lê motoboys (cada um só a própria linha, e só se ativo)');
select pg_temp.igual(pg_temp.erro($$update motoboys set ativo = false$$), '42501', 'equipe não muda motoboys pela API');
select pg_temp.ok(pg_temp.erro('select entregas_em_rota()') is null, 'equipe também lê entregas_em_rota');
reset role;

-- ================= motoboy: o que ele NÃO pode =================
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual((select count(*) from pedidos)::text, '0', 'motoboy não lê pedidos');
select pg_temp.igual((select count(*) from clientes)::text, '0', 'motoboy não lê clientes');
select pg_temp.igual((select count(*) from equipe)::text, '0', 'motoboy não lê equipe');
select pg_temp.igual((select count(*) from produtos)::text, '56', 'motoboy lê o cardápio como qualquer logado');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'entregue')$$, :'ea_id')), 'sem_permissao', 'motoboy não chama mudar_status');
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L, 'cancelado', 'teste')$$, :'ea_id')), 'sem_permissao', 'motoboy não cancela pedido');
select pg_temp.igual(pg_temp.erro($$select definir_loja('fechada')$$), 'sem_permissao', 'motoboy não chama definir_loja');
select pg_temp.igual(pg_temp.erro($$select marcar_esgotado('gran-burger', true)$$), 'sem_permissao', 'motoboy não chama marcar_esgotado');
select pg_temp.igual(pg_temp.erro($$select remover_testes()$$), 'sem_permissao', 'motoboy não chama remover_testes');
select pg_temp.igual(pg_temp.erro_pedido(pg_temp.pedido('[{"produtoId":"agua"}]', '{"origem":"exemplo","cliente":{"nome":"Ana (exemplo)","telefone":""}}')),
  'sem_permissao', 'motoboy não cria pedido de exemplo (não é equipe)');
select pg_temp.igual(pg_temp.erro(format($$update pedidos set status = 'entregue' where id = %L$$, :'ea_id')), '42501', 'motoboy não muda pedido direto (só por confirmar_entrega)');
select pg_temp.igual(pg_temp.erro($$insert into pedidos (cliente_nome, cliente_telefone, modo, itens, total) values ('Ana', '11900000071', 'entrega', '[]', 0)$$), '42501', 'motoboy não insere pedido direto');
select pg_temp.igual(pg_temp.erro('delete from pedidos'), '42501', 'motoboy não apaga pedido');
select pg_temp.igual(pg_temp.erro($$update clientes set nome = 'x'$$), '42501', 'motoboy não muda clientes');
select pg_temp.igual(pg_temp.erro(format($$insert into equipe (user_id) values (%L)$$, :'moto')), '42501', 'motoboy não se põe na equipe pela API');
select pg_temp.igual(pg_temp.erro($$update produtos set preco = 0.01$$), '42501', 'motoboy não muda preço');
select pg_temp.igual(pg_temp.erro($$update loja set modo = 'fechada'$$), '42501', 'motoboy não muda a loja');
select pg_temp.igual(pg_temp.erro($$update motoboys set nome = 'x'$$), '42501', 'motoboy não muda a própria linha pela API');
select pg_temp.igual(pg_temp.erro(format($$insert into motoboys (user_id) values (%L)$$, :'estranho')), '42501', 'motoboy não cadastra outro motoboy');
select pg_temp.igual(pg_temp.erro('delete from motoboys'), '42501', 'motoboy não apaga motoboys');
select pg_temp.igual(pg_temp.erro('select is_motoboy()'), '42501', 'motoboy não chama is_motoboy direto (interna)');
select pg_temp.igual(pg_temp.erro('select entrega_json(p) from pedidos p'), '42501', 'motoboy não chama entrega_json direto (interna)');

-- ================= motoboy: o que ele PODE ler =================
-- a própria linha de motoboys, e só ela (existe outra, a do "outro")
select pg_temp.igual((select string_agg(user_id::text, ',') from motoboys), :'moto', 'motoboy lê só a própria linha de motoboys');
select pg_temp.ok((select nome = 'Motoboy teste' and ativo from motoboys where user_id = :'moto'), 'motoboy lê o próprio nome e ativo');
-- o que a tela faz: from('motoboys').select('user_id').eq('user_id', id).maybeSingle()
select pg_temp.ok((select count(*) from motoboys where user_id = :'moto') = 1 and (select count(*) from motoboys where user_id = :'outro') = 0,
  'checagem de acesso da tela: vê a própria linha, não a dos outros');
select entregas_em_rota() as lista \gset
reset role;

-- ================= entregas_em_rota =================
select pg_temp.ok(jsonb_typeof(:'lista'::jsonb) = 'array' and jsonb_array_length(:'lista'::jsonb) = 3
                  and (select array_agg(e ->> 'id' order by n) from jsonb_array_elements(:'lista'::jsonb) with ordinality x(e, n)) = array[:'ea_id', :'ea2_id', :'ea3_id'],
  'entregas_em_rota: só entrega em rota de hoje, mais antiga primeiro (não entram preparo, pronto, novo, cancelado, entregue, local, retirada nem o preso de dias atrás)');
select pg_temp.igual(pg_temp.chaves(:'lista'::jsonb -> 0), 'cliente,distanciaKm,endereco,entregueEm,id,numero,obs,referencia,saiuEm,status,taxaEntrega,total',
  'entregas_em_rota: chaves exatas (sem itens, sem token, sem histórico)');
select pg_temp.igual(pg_temp.chaves(:'lista'::jsonb #> '{0,cliente}'), 'nome,telefone', 'entregas_em_rota: cliente só com nome e telefone');
select pg_temp.ok((:'lista'::jsonb -> 0) @> '{"status":"rota","cliente":{"nome":"Davi Entrega","telefone":"11900000090"},"endereco":"Rua da Entrega, 10","referencia":"Portão azul","obs":"Sem cebola","distanciaKm":2.5,"taxaEntrega":7}'
                  and (:'lista'::jsonb #>> '{0,id}') = :'ea_id'
                  and (:'lista'::jsonb #> '{0,numero}') = to_jsonb((select numero from pedidos where id = :'ea_id'))
                  and (:'lista'::jsonb #> '{0,total}') = to_jsonb((select total from pedidos where id = :'ea_id')),
  'entregas_em_rota: nome, telefone, endereço, referência, obs, total, taxa e km do pedido');
select pg_temp.ok((select total > taxa_entrega and taxa_entrega = 7 from pedidos where id = :'ea_id'), 'o total do pedido de teste inclui a taxa de 7,00 (2,5 km → 3 km × 1,00 + 4,00)');
select pg_temp.ok(jsonb_typeof(:'lista'::jsonb #> '{0,total}') = 'number' and jsonb_typeof(:'lista'::jsonb #> '{0,numero}') = 'number'
                  and jsonb_typeof(:'lista'::jsonb #> '{0,taxaEntrega}') = 'number', 'entregas_em_rota: números saem como números JSON');
select pg_temp.ok(position((select token::text from pedidos where id = :'ea_id') in :'lista') = 0, 'entregas_em_rota: o token do pedido não aparece em lugar nenhum');
select pg_temp.ok(:'lista' not like '%gran-burger%' and :'lista' not like '%Gran Burger%', 'entregas_em_rota: sem itens do pedido');
select pg_temp.ok((:'lista'::jsonb #>> '{0,saiuEm}') = (select h ->> 'em' from pedidos p, jsonb_array_elements(p.historico) h where p.id = :'ea_id' and h ->> 'status' = 'rota')
                  and jsonb_typeof(:'lista'::jsonb #> '{0,entregueEm}') = 'null', 'entregas_em_rota: saiuEm vem do histórico e entregueEm é null enquanto não entregou');
-- cada filtro isolado: mexe só no motivo da exclusão e o pedido entra na lista
update pedidos set criado_em = now() where id = :'eg_id';
select pg_temp.sou(:'moto');
set local role authenticated;
select entregas_em_rota() as lista2 \gset
reset role;
select pg_temp.ok(jsonb_array_length(:'lista2'::jsonb) = 4 and pg_temp.tem(:'lista2'::jsonb, :'eg_id'), 'entregas_em_rota: o preso de dias atrás só ficava de fora pela data (hoje ele entra)');
update pedidos set criado_em = now() - interval '2 days' where id = :'eg_id';
update pedidos set modo = 'entrega' where id = :'lr_id';
select pg_temp.sou(:'moto');
set local role authenticated;
select entregas_em_rota() as lista3 \gset
reset role;
select pg_temp.ok(jsonb_array_length(:'lista3'::jsonb) = 4 and pg_temp.tem(:'lista3'::jsonb, :'lr_id') and not pg_temp.tem(:'lista3'::jsonb, :'eg_id'),
  'entregas_em_rota: o local em rota só ficava de fora pelo modo (como entrega ele entra)');
update pedidos set modo = 'local' where id = :'lr_id';
-- sem entregas em rota: lista vazia, não erro
update pedidos set status = 'preparo' where status = 'rota' and modo = 'entrega';
select pg_temp.sou(:'moto');
set local role authenticated;
select entregas_em_rota() as vazia \gset
reset role;
select pg_temp.ok(:'vazia'::jsonb = '[]'::jsonb, 'entregas_em_rota: sem entrega em rota devolve []');
update pedidos set status = 'rota' where id in (:'ea_id', :'ea2_id', :'ea3_id', :'eg_id');

-- ================= confirmar_entrega: rota → entregue =================
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega(:'ea_id') as r1 \gset
reset role;
select pg_temp.igual(pg_temp.chaves(:'r1'::jsonb), 'jaEntregue,ok,pedido', 'confirmar_entrega devolve { ok, jaEntregue, pedido }');
select pg_temp.ok(:'r1'::jsonb @> '{"ok":true,"jaEntregue":false}', 'rota → entregue: ok = true e jaEntregue = false');
select pg_temp.igual(pg_temp.chaves(:'r1'::jsonb -> 'pedido'), 'cliente,distanciaKm,endereco,entregueEm,id,numero,obs,referencia,saiuEm,status,taxaEntrega,total',
  'confirmar_entrega: pedido com as mesmas chaves da lista (sem itens, sem token)');
select pg_temp.ok(position((select token::text from pedidos where id = :'ea_id') in :'r1') = 0, 'confirmar_entrega: o token do pedido não aparece no retorno');
select pg_temp.ok((:'r1'::jsonb #>> '{pedido,id}') = :'ea_id' and (:'r1'::jsonb #>> '{pedido,status}') = 'entregue'
                  and (:'r1'::jsonb #> '{pedido,cliente}') = '{"nome":"Davi Entrega","telefone":"11900000090"}', 'confirmar_entrega: pedido entregue, com nome e telefone do cliente');
select pg_temp.igual((select status from pedidos where id = :'ea_id'), 'entregue', 'rota → entregue: o pedido ficou entregue no banco');
select pg_temp.igual(pg_temp.fluxo(:'ea_id'), 'novo>preparo>rota>entregue', 'rota → entregue: um evento a mais no histórico');
select pg_temp.igual(pg_temp.quem(:'ea_id'), '-,-,-,motoboy', 'rota → entregue: o evento novo leva por = motoboy');
select pg_temp.ok((select h ->> 'em' from pedidos p, jsonb_array_elements(p.historico) with ordinality x(h, n) where p.id = :'ea_id' and n = 4)
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}[+]00:00$', 'rota → entregue: o "em" tem o formato do data_iso');
select pg_temp.ok((:'r1'::jsonb #>> '{pedido,entregueEm}') = (select h ->> 'em' from pedidos p, jsonb_array_elements(p.historico) with ordinality x(h, n) where p.id = :'ea_id' and n = 4)
                  and (:'r1'::jsonb #>> '{pedido,saiuEm}') = (select h ->> 'em' from pedidos p, jsonb_array_elements(p.historico) with ordinality x(h, n) where p.id = :'ea_id' and n = 3),
  'confirmar_entrega: saiuEm e entregueEm vêm do histórico');
select pg_temp.ok((select atualizado_em = now() from pedidos where id = :'ea_id'), 'rota → entregue: atualiza atualizado_em');

-- ler de novo: "já estava entregue", sem erro, sem update
alter table pedidos disable trigger pedidos_atualizado_em;
update pedidos set atualizado_em = '2000-01-01' where id = :'ea_id';
alter table pedidos enable trigger pedidos_atualizado_em;
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega(:'ea_id') as r2 \gset
reset role;
select pg_temp.ok(:'r2'::jsonb @> '{"ok":true,"jaEntregue":true}' and (:'r2'::jsonb #>> '{pedido,status}') = 'entregue', 'segunda leitura: jaEntregue = true, sem erro');
select pg_temp.igual(pg_temp.chaves(:'r2'::jsonb -> 'pedido'), 'cliente,distanciaKm,endereco,entregueEm,id,numero,obs,referencia,saiuEm,status,taxaEntrega,total', 'segunda leitura: pedido com as mesmas chaves');
select pg_temp.igual(pg_temp.fluxo(:'ea_id'), 'novo>preparo>rota>entregue', 'segunda leitura: o histórico não cresce');
select pg_temp.igual(pg_temp.quem(:'ea_id'), '-,-,-,motoboy', 'segunda leitura: nenhum evento novo');
select pg_temp.ok((select atualizado_em = '2000-01-01' from pedidos where id = :'ea_id'), 'segunda leitura: sem update (atualizado_em intacto)');
select pg_temp.ok((:'r2'::jsonb #>> '{pedido,entregueEm}') = (:'r1'::jsonb #>> '{pedido,entregueEm}'), 'segunda leitura: entregueEm continua o da primeira');
-- pedido que a equipe já tinha entregue também responde jaEntregue
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega(:'ef_id') as r2b \gset
reset role;
select pg_temp.ok(:'r2b'::jsonb @> '{"ok":true,"jaEntregue":true}' and pg_temp.fluxo(:'ef_id') = 'novo>preparo>rota>entregue' and pg_temp.quem(:'ef_id') = '-,-,-,-',
  'entregue pela equipe: o motoboy lendo o QR recebe jaEntregue = true e o histórico não muda');

-- ================= confirmar_entrega: preparo → entregue (grava rota e entregue) =================
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega(:'eb_id') as r3 \gset
reset role;
select pg_temp.ok(:'r3'::jsonb @> '{"ok":true,"jaEntregue":false}' and (:'r3'::jsonb #>> '{pedido,status}') = 'entregue', 'preparo → entregue: ok = true e jaEntregue = false');
select pg_temp.igual(pg_temp.fluxo(:'eb_id'), 'novo>preparo>rota>entregue', 'preparo → entregue: grava os passos rota e entregue');
select pg_temp.igual(pg_temp.quem(:'eb_id'), '-,-,motoboy,motoboy', 'preparo → entregue: os dois eventos novos levam por = motoboy');
select pg_temp.ok((:'r3'::jsonb #>> '{pedido,saiuEm}') is not null and (:'r3'::jsonb #>> '{pedido,saiuEm}') <= (:'r3'::jsonb #>> '{pedido,entregueEm}'),
  'preparo → entregue: saiuEm preenchido e não depois de entregueEm');

-- ================= confirmar_entrega: pronto → entregue =================
select pg_temp.sou(:'moto');
set local role authenticated;
select confirmar_entrega(:'ec_id') as r4 \gset
reset role;
select pg_temp.ok(:'r4'::jsonb @> '{"ok":true,"jaEntregue":false}' and (:'r4'::jsonb #>> '{pedido,status}') = 'entregue', 'pronto → entregue: ok = true e jaEntregue = false');
select pg_temp.igual(pg_temp.fluxo(:'ec_id'), 'novo>entregue', 'pronto → entregue: grava só o entregue (nenhum passo de rota inventado)');
select pg_temp.igual(pg_temp.quem(:'ec_id'), '-,motoboy', 'pronto → entregue: o evento novo leva por = motoboy');
select pg_temp.ok(jsonb_typeof(:'r4'::jsonb #> '{pedido,saiuEm}') = 'null', 'pronto → entregue: saiuEm null (nunca foi para a rota)');

-- ================= confirmar_entrega: o que recusa =================
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'ed_id')), 'transicao_invalida', 'pedido novo (a equipe nem aceitou): transicao_invalida');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'ee_id')), 'pedido_cancelado', 'pedido cancelado: pedido_cancelado');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'lp_id')), 'nao_e_entrega', 'pedido local: nao_e_entrega');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'rt_id')), 'nao_e_entrega', 'pedido de retirada: nao_e_entrega');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'lr_id')), 'nao_e_entrega', 'local mesmo em rota: nao_e_entrega');
select pg_temp.igual(pg_temp.erro($$select confirmar_entrega('00000000-0000-4000-8000-00000000abcd')$$), 'nao_encontrado', 'id inexistente: nao_encontrado');
select pg_temp.igual(pg_temp.erro($$select confirmar_entrega(null)$$), 'dados_invalidos', 'id null: dados_invalidos');
reset role;
select pg_temp.ok((select status from pedidos where id = :'ed_id') = 'novo' and pg_temp.fluxo(:'ed_id') = 'novo', 'recusado: o pedido novo continua novo, histórico igual');
select pg_temp.ok((select status from pedidos where id = :'ee_id') = 'cancelado' and pg_temp.fluxo(:'ee_id') = 'novo>cancelado', 'recusado: o cancelado continua cancelado, histórico igual');
select pg_temp.ok((select status from pedidos where id = :'lp_id') = 'pronto' and pg_temp.fluxo(:'lp_id') = 'novo>preparo>pronto', 'recusado: o local continua pronto, histórico igual');
select pg_temp.ok((select status from pedidos where id = :'rt_id') = 'novo' and (select status from pedidos where id = :'lr_id') = 'rota', 'recusado: retirada e local em rota ficam como estavam');

-- ================= motoboy desativado =================
update motoboys set ativo = false where user_id = :'moto';
select pg_temp.sou(:'moto');
select pg_temp.ok(not is_motoboy(), 'ativo = false: is_motoboy() = false');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select entregas_em_rota()'), 'sem_permissao', 'ativo = false: entregas_em_rota → sem_permissao');
select pg_temp.igual(pg_temp.erro(format($$select confirmar_entrega(%L)$$, :'ea2_id')), 'sem_permissao', 'ativo = false: confirmar_entrega → sem_permissao');
select pg_temp.igual((select count(*) from motoboys)::text, '0', 'ativo = false: não enxerga nem a própria linha (a tela mostra "Sem acesso")');
reset role;
select pg_temp.ok((select status from pedidos where id = :'ea2_id') = 'rota' and (select ativo is false and nome = 'Motoboy teste' from motoboys where user_id = :'moto'),
  'ativo = false: nada foi entregue e a linha continua lá (corta o acesso sem apagar)');
-- voltou a ficar ativo: volta o acesso
update motoboys set ativo = true where user_id = :'moto';
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.ok(pg_temp.erro('select entregas_em_rota()') is null and (select count(*) from motoboys) = 1, 'ativo = true de novo: volta o acesso');
reset role;

-- ================= equipe confirmando =================
select pg_temp.sou(:'equipe');
set local role authenticated;
select confirmar_entrega(:'ea3_id') as r5 \gset
reset role;
select pg_temp.ok(:'r5'::jsonb @> '{"ok":true,"jaEntregue":false}' and (:'r5'::jsonb #>> '{pedido,status}') = 'entregue', 'equipe também confirma: rota → entregue');
select pg_temp.igual(pg_temp.quem(:'ea3_id'), '-,-,-,equipe', 'equipe confirma: o evento novo leva por = equipe');
select pg_temp.igual(pg_temp.fluxo(:'ea3_id'), 'novo>preparo>rota>entregue', 'equipe confirma: um evento a mais no histórico');
-- quem está nas duas tabelas conta como motoboy (a função é a da tela do motoboy)
insert into motoboys (user_id, nome) values (:'equipe', 'Dono');
select pg_temp.sou(:'equipe');
set local role authenticated;
select confirmar_entrega(:'ea2_id') as r6 \gset
reset role;
select pg_temp.igual(pg_temp.quem(:'ea2_id'), '-,-,-,motoboy', 'equipe que também é motoboy: o evento leva por = motoboy');

-- ================= o usuário some do Auth, a linha some junto =================
insert into auth.users (id, email) values (:'efemero', 'efemero@teste.local');
insert into motoboys (user_id, nome) values (:'efemero', 'Efêmero');
delete from auth.users where id = :'efemero';
select pg_temp.ok(not exists (select 1 from motoboys where user_id = :'efemero'), 'apagar o usuário do Auth apaga a linha de motoboys (on delete cascade)');

rollback;
