-- Estrutura depois do setup.sql (o testar-sql.sh --do-zero aplica duas vezes): dados, RLS, privilégios e funções.
begin;
\ir _ajuda.sql

-- seed (CONFIG do core.js)
select pg_temp.igual((select count(*) from produtos)::text, '56', 'seed: 56 produtos');
select pg_temp.igual(
  (select string_agg(tipo || '=' || n, ',' order by tipo) from (select tipo, count(*) n from produtos group by tipo) t),
  'bebida=8,combo=11,lanche=35,porcao=2', 'seed: 35 lanches, 11 combos, 2 porções, 8 bebidas');
select pg_temp.igual((select count(*) from adicionais where preco = 7.50)::text, '5', 'seed: 5 adicionais a R$ 7,50');
select pg_temp.igual((select count(*) from loja)::text, '1', 'seed: uma linha de loja');
select pg_temp.ok((select combo_preco = 14.90 and horarios = '{"0":["19:00","01:00"],"1":["19:00","00:00"],"2":["19:00","00:00"],"3":null,"4":["19:00","00:00"],"5":["19:00","01:00"],"6":["19:00","01:00"]}'::jsonb from loja),
  'seed: loja com combo 14,90 e horários do CONFIG (seg/ter/qui 19h–0h e sex/sáb/dom 19h–1h, quarta fechada)');
select pg_temp.igual((select string_agg(id, ',' order by ordem) from (select id, ordem from produtos order by ordem limit 3) t),
  'gran-burger,gran-burger-bacon,gran-salada', 'seed: ordem do CONFIG');
select pg_temp.ok((select ingredientes = array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']
                   and categoria = 'artesanais' and preco = 34.90 and foto = 'gran-bacon-onion' from produtos where id = 'gran-bacon-onion'),
  'seed: ingredientes = ing do CONFIG, com categoria, preço e foto');
select pg_temp.ok((select foto is null and ingredientes = '{}' and nome = 'Porção de batata turbinada' and preco = 39.90 from produtos where id = 'porcao-batata'),
  'seed: sem foto e sem ing ficam null e {} (porção turbinada, mesmo id e preço)');

-- "Preço a confirmar": preco null no CONFIG vai null para o banco (o criar_pedido recusa; 02 e 05)
select pg_temp.ok((select is_nullable = 'YES' from information_schema.columns
                   where table_schema = 'public' and table_name = 'produtos' and column_name = 'preco'), 'produtos.preco aceita null');
select pg_temp.ok((select preco = 34.90 and ativo and tipo = 'lanche' and categoria = 'hotdog' and nome = 'Hot Dog CBO Turbo'
                   and 'Mussarela gratinada' = any (ingredientes) from produtos where id = 'dog-cbo-turbo'),
  'seed: Hot Dog CBO Turbo ativo, no hot dog, por 34,90');
select pg_temp.ok(not exists (select 1 from produtos where preco is null), 'seed: todos os produtos têm preço confirmado');
select pg_temp.igual(pg_temp.erro($$update produtos set preco = -0.01 where id = 'gran-burger'$$), '23514', 'check: preço negativo continua recusado');

-- seed de novo: não mexe em esgotado, o CONFIG manda no ativo (quem saiu e voltou é reativado; quem saiu fica
-- inativo), loja só horarios e combo_preco
update produtos set esgotado_dia = dia_operacional(), ativo = false, preco = 1 where id = 'gran-burger';
update produtos set preco = 30 where id = 'dog-cbo-turbo';
update adicionais set ativo = false, preco = 1 where id = 'bacon';
update loja set modo = 'fechada', aceita_fechada = true, combo_preco = 1, horarios = '{}';
insert into produtos (id, categoria, nome, preco, tipo, ordem) values ('saiu-do-config', 'artesanais', 'Antigo', 10, 'lanche', 99);
insert into adicionais (id, nome, preco) values ('saiu-do-config', 'Antigo', 7.50);
\ir ../seed.sql
select pg_temp.ok((select preco = 25.90 and esgotado_dia = dia_operacional() from produtos where id = 'gran-burger'),
  'seed repetido: volta o preço e preserva esgotado_dia');
select pg_temp.ok((select ativo from produtos where id = 'gran-burger'), 'seed repetido: produto que voltou ao CONFIG fica ativo de novo');
select pg_temp.ok((select preco = 34.90 from produtos where id = 'dog-cbo-turbo'), 'seed repetido: preço 34,90 do CONFIG vale por cima do banco');
select pg_temp.ok((select ativo and preco = 7.50 from adicionais where id = 'bacon'), 'seed repetido: adicional que voltou ao CONFIG fica ativo de novo');
select pg_temp.ok((select not ativo from produtos where id = 'saiu-do-config'), 'seed repetido: produto fora do CONFIG fica inativo');
select pg_temp.ok((select not ativo from adicionais where id = 'saiu-do-config'), 'seed repetido: adicional fora do CONFIG fica inativo');
select pg_temp.ok((select modo = 'fechada' and aceita_fechada and combo_preco = 14.90 and horarios ? '5' from loja),
  'seed repetido: loja preserva modo e aceita_fechada, atualiza combo_preco e horarios');
select pg_temp.igual((select count(*) from produtos)::text, '57', 'seed repetido: não duplica produtos');
select pg_temp.igual((select count(*) from adicionais)::text, '6', 'seed repetido: não duplica adicionais');

-- RLS e Realtime
select pg_temp.ok((select bool_and(relrowsecurity) and count(*) = 7 from pg_class
                   where oid in ('produtos'::regclass, 'adicionais'::regclass, 'loja'::regclass, 'clientes'::regclass, 'pedidos'::regclass, 'equipe'::regclass, 'motoboys'::regclass)),
  'RLS ligado nas 7 tabelas');
select pg_temp.igual((select string_agg(tablename || ':' || policyname, ',' order by tablename) from pg_policies where schemaname = 'public'),
  'adicionais:adicionais_leitura,clientes:clientes_equipe,equipe:equipe_propria,loja:loja_leitura,motoboys:motoboys_proprio,pedidos:pedidos_equipe,produtos:produtos_leitura',
  '7 policies, sem duplicar');
select pg_temp.igual((select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
  'loja,pedidos,produtos', 'Realtime: loja, pedidos e produtos (uma vez cada)');

-- privilégios nas tabelas
select pg_temp.ok(not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT'),
  'anon e authenticated sem insert/update/delete/truncate em nenhuma tabela');
select pg_temp.ok(not has_table_privilege('anon', 'pedidos', 'select') and not has_table_privilege('anon', 'clientes', 'select')
                  and not has_table_privilege('anon', 'equipe', 'select') and not has_table_privilege('anon', 'motoboys', 'select'),
  'anon sem select em pedidos, clientes, equipe e motoboys');
select pg_temp.ok(has_table_privilege('authenticated', 'motoboys', 'select') and not has_table_privilege('authenticated', 'motoboys', 'insert')
                  and not has_table_privilege('authenticated', 'motoboys', 'update') and not has_table_privilege('authenticated', 'motoboys', 'delete'),
  'authenticated só com select em motoboys (a policy deixa ler só a própria linha ativa)');
select pg_temp.ok(has_table_privilege('anon', 'produtos', 'select') and has_table_privilege('anon', 'adicionais', 'select')
                  and has_table_privilege('anon', 'loja', 'select'), 'anon com select em produtos, adicionais e loja');
select pg_temp.ok(not has_sequence_privilege('anon', pg_get_serial_sequence('pedidos', 'numero'), 'usage'), 'anon sem acesso à sequência do número');

-- funções
select pg_temp.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and ((not p.prosecdef and p.proname not in ('reservar_entrega','emitir_cotacao_entrega'))
      or not coalesce('search_path=public, pg_temp' = any (p.proconfig), false))),
  'RPCs têm search_path fixo; helpers de entrega mantêm privilégios do backend');
select pg_temp.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.grantee = 0),
  'nenhuma função executável por PUBLIC');
select pg_temp.ok((select bool_and(has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'))
                   from unnest(array['criar_pedido(jsonb)', 'acompanhar_pedido(uuid)', 'estado_cardapio()', 'dia_operacional(timestamptz)',
                                     'loja_aberta(timestamptz)', 'is_equipe()']) f),
  'anon e authenticated executam as funções do cliente');
select pg_temp.ok((select bool_and(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'))
                   from unnest(array['mudar_status(uuid,text,text)', 'marcar_esgotado(text,boolean)', 'definir_loja(text)', 'remover_testes()']) f),
  'funções da equipe: só authenticated (dentro, is_equipe() decide)');
select pg_temp.ok((select bool_and(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'))
                   from unnest(array['entregas_em_rota()', 'confirmar_entrega(uuid)']) f),
  'funções do motoboy: só authenticated (dentro, is_motoboy() ou is_equipe() decide)');
select pg_temp.ok((select bool_and(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'))
                   from unnest(array['pedido_json(pedidos)', 'resumo_item(jsonb,numeric)', 'loja_json()', 'horario_aberto(jsonb,timestamptz)',
                                     'turno_minutos(jsonb)', 'campo_texto(jsonb,integer)', 'campo_inteiro(jsonb,integer,integer,integer)',
                                     'aparar(text)', 'minusculas(text)', 'data_iso(timestamptz)', 'horarios_validos(jsonb)', 'tocar_atualizado_em()',
                                     'is_motoboy()', 'entrega_json(pedidos)']) f),
  'funções internas fechadas para anon e authenticated');

-- checks
select pg_temp.igual(pg_temp.erro($$update loja set horarios = '{"7":null}'$$), '23514', 'check: horarios com dia 7 recusado');
select pg_temp.igual(pg_temp.erro($$update loja set horarios = '{"1":["19:00","24:00"]}'$$), '23514', 'check: hora 24:00 recusada');
select pg_temp.igual(pg_temp.erro($$update loja set horarios = '{"1":["19:00"]}'$$), '23514', 'check: turno sem fim recusado');
select pg_temp.igual(pg_temp.erro($$insert into loja (id) values (2)$$), '23514', 'check: loja só tem a linha 1');
select pg_temp.igual(pg_temp.erro($$update produtos set tipo = 'pizza' where id = 'gran-burger'$$), '23514', 'check: tipo de produto');

-- atualizado_em
update loja set atualizado_em = '2000-01-01' where id = 1;
select pg_temp.ok((select atualizado_em = now() from loja), 'gatilho: atualizado_em da loja vai para now() a cada update');

rollback;
