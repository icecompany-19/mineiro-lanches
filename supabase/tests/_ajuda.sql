-- Ajudantes dos testes SQL. Cada teste faz "begin; \ir _ajuda.sql ... rollback;": nada fica gravado.
-- pg_temp.ok(cond, msg)            falha se cond não for true
-- pg_temp.igual(atual, esperado)   compara como texto e mostra os dois quando falha
-- pg_temp.erro(sql)                roda o comando e devolve o código: o texto do erro de regra (P0001), o SQLSTATE
--                                  dos outros (42501 = sem privilégio) ou null quando passou
-- pg_temp.erro_pedido(p)           o mesmo para criar_pedido(p)
-- pg_temp.sou(uuid)                quem chama: null = anon; uuid = authenticated com esse sub (use set local role junto)
-- pg_temp.item(id, extra) / pg_temp.pedido(itens, extra) / pg_temp.cliente(tel, nome)   montam a entrada do criar_pedido
-- pg_temp.novo(itens, extra) / pg_temp.um(id, extra) / pg_temp.erro_item(id, extra)     criam com telefone novo a cada chamada
set client_min_messages = notice;

\set equipe 00000000-0000-4000-8000-000000000001
\set moto 00000000-0000-4000-8000-000000000003
\set estranho 00000000-0000-4000-8000-0000000000ff

create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALHOU: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end;
$$;

create function pg_temp.igual(p_atual text, p_esperado text, p_msg text) returns void language plpgsql as $$
begin
  if p_atual is distinct from p_esperado then
    raise exception 'FALHOU: % (veio %, esperado %)', p_msg, coalesce(p_atual, 'null'), coalesce(p_esperado, 'null');
  end if;
  raise notice 'ok - %', p_msg;
end;
$$;

create function pg_temp.erro(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- código do erro do criar_pedido(p) (como pg_temp.erro, sem montar SQL)
create function pg_temp.erro_pedido(p jsonb) returns text language plpgsql as $$
begin
  perform criar_pedido(p);
  return null;
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end;
$$;

create function pg_temp.sou(p_sub uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_sub is null then '{"role":"anon"}' else json_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
$$;

create function pg_temp.item(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('produtoId', p_id, 'qtd', 1, 'completo', true, 'removidos', '[]'::jsonb, 'prensado', false,
                            'combo', jsonb_build_object('ativo', false, 'refri', ''), 'adicionais', '[]'::jsonb, 'sabor', '') || p_extra;
$$;

-- telefones de teste: 119000xxxxx (apagados no começo de cada teste, dentro da transação)
create function pg_temp.pedido(p_itens jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('cliente', jsonb_build_object('nome', 'Cliente Teste', 'telefone', '11900000000'),
                            'modo', 'local', 'endereco', '', 'referencia', '', 'pagamento', null, 'troco', '', 'obs', '',
                            'origem', 'cardapio', 'mesa', null, 'itens', p_itens) || p_extra;
$$;

create function pg_temp.cliente(p_tel text, p_nome text default 'Cliente Teste') returns jsonb language sql as $$
  select jsonb_build_object('cliente', jsonb_build_object('nome', p_nome, 'telefone', p_tel));
$$;

-- telefone novo a cada chamada (11900000101, 11900000102...), para não cair no limite de 5 por telefone
create function pg_temp.tel_novo() returns text language sql as $$
  select '119000' || lpad(set_config('teste.n', (coalesce(nullif(current_setting('teste.n', true), ''), '100')::int + 1)::text, true), 5, '0');
$$;

-- cria um pedido com telefone novo
create function pg_temp.novo(p_itens jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select criar_pedido(pg_temp.pedido(p_itens, pg_temp.cliente(pg_temp.tel_novo()) || p_extra));
$$;

-- um item só: devolve o item como o servidor gravou
create function pg_temp.um(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.novo(jsonb_build_array(pg_temp.item(p_id, p_extra))) #> '{itens,0}';
$$;

-- código do erro de um pedido com um item só
create function pg_temp.erro_item(p_id text, p_extra jsonb default '{}') returns text language sql as $$
  select pg_temp.erro_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item(p_id, p_extra)), pg_temp.cliente(pg_temp.tel_novo())));
$$;

-- ponto de partida igual para todos: loja aberta, nada esgotado, tudo ativo, usuário de teste na equipe e motoboy de teste cadastrado
delete from pedidos where cliente_telefone like '119000%' or origem = 'exemplo';
delete from clientes where telefone like '119000%';
update loja set modo = 'aberta', aceita_fechada = false, combo_preco = 14.90;
update produtos set esgotado_dia = null, ativo = true;
update adicionais set ativo = true;
insert into equipe (user_id, nome) values (:'equipe', 'Equipe teste') on conflict do nothing;
insert into auth.users (id, email) values (:'moto', 'moto@teste.local') on conflict do nothing;
insert into motoboys (user_id, nome) values (:'moto', 'Motoboy teste') on conflict do nothing;
