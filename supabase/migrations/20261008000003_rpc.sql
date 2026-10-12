-- Mineiro Lanche · 0003 · funções (RPC) chamadas pelo front com supabase.rpc(nome, args).
-- Todas security definer com search_path fixo. Erros de regra: raise exception '<codigo>' using errcode = 'P0001'
-- (o texto é só o código; o front traduz). Contrato: docs/CONTRATO-API.md.
-- Preço, resumo e normalização são espelho do core.js (ML.precos.item): o total do navegador nunca é usado.

-- ================= utilidades =================

-- dia de operação: vira às 4h de São Paulo (mesmo corte do DIA_OP_OFFSET do painel)
create or replace function public.dia_operacional(p_quando timestamptz default now())
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ((p_quando at time zone 'America/Sao_Paulo') - interval '4 hours')::date
$$;

-- data ISO 8601 em UTC com milissegundos (como o toISOString do navegador)
create or replace function public.data_iso(p timestamptz)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+00:00'
$$;

-- igual ao String.prototype.trim do navegador (espaços Unicode inclusive)
create or replace function public.aparar(p text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select regexp_replace(p,
    '^[\s   -     　﻿]+|[\s   -     　﻿]+$',
    '', 'g')
$$;

-- toLowerCase sem depender da collation do banco (acentos do português garantidos)
create or replace function public.minusculas(p text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select translate(lower(p), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'áàâãäéèêëíìîïóòôõöúùûüçñ')
$$;

-- texto de um campo jsonb: ausente/null → ''; string ou número → aparado; outro tipo ou acima do limite → dados_invalidos
create or replace function public.campo_texto(p jsonb, p_max int)
returns text
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '';
  end if;
  if jsonb_typeof(p) not in ('string', 'number') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v := public.aparar(p #>> '{}');
  if char_length(v) > p_max then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- inteiro de um campo jsonb entre p_min e p_max; ausente/null → p_padrao
create or replace function public.campo_inteiro(p jsonb, p_min int, p_max int, p_padrao int)
returns int
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return p_padrao;
  end if;
  if jsonb_typeof(p) <> 'number' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v := (p #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  return v::int;
end;
$$;

-- ================= horário (America/Sao_Paulo) =================

-- turno ["19:00","01:00"] em minutos {abre, fecha}; fecha passa de 1440 quando atravessa a meia-noite
create or replace function public.turno_minutos(p jsonb)
returns int[]
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_abre int;
  v_fecha int;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2 then
    return null;
  end if;
  v_abre := split_part(p ->> 0, ':', 1)::int * 60 + split_part(p ->> 0, ':', 2)::int;
  v_fecha := split_part(p ->> 1, ':', 1)::int * 60 + split_part(p ->> 1, ':', 2)::int;
  if v_fecha <= v_abre then
    v_fecha := v_fecha + 1440;
  end if;
  return array[v_abre, v_fecha];
end;
$$;

-- aberto pelo turno de hoje ou pela sobra de madrugada do turno de ontem (como ML.horario.situacaoNo)
create or replace function public.horario_aberto(p_horarios jsonb, p_quando timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_quando at time zone 'America/Sao_Paulo';
  v_dia int := extract(dow from v_local)::int;
  v_min int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_hoje int[] := public.turno_minutos(p_horarios -> v_dia::text);
  v_ontem int[] := public.turno_minutos(p_horarios -> ((v_dia + 6) % 7)::text);
begin
  if v_hoje is not null and v_min >= v_hoje[1] and v_min < v_hoje[2] then
    return true;
  end if;
  if v_ontem is not null and v_ontem[2] > 1440 and v_min < v_ontem[2] - 1440 then
    return true;
  end if;
  return false;
end;
$$;

-- aberta = modo 'aberta', ou modo 'auto' dentro do turno; sem linha da loja = fechada
create or replace function public.loja_aberta(p_quando timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case l.modo
             when 'aberta' then true
             when 'fechada' then false
             else public.horario_aberto(l.horarios, p_quando)
           end
    from public.loja l
    where l.id = 1
  ), false)
$$;

-- bloco "loja" do estado_cardapio e do definir_loja
create or replace function public.loja_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('modo', l.modo, 'aceitaFechada', l.aceita_fechada, 'comboPreco', l.combo_preco, 'horarios', l.horarios)
  from public.loja l
  where l.id = 1
$$;

-- ================= resumo e formato do pedido =================

-- mesmo texto do resumo() do core.js, a partir do item já normalizado
-- ex.: "Sem cebola roxa · Prensado · Combo +R$14,90 (Guaraná) · + Bacon"
create or replace function public.resumo_item(p_item jsonb, p_combo_preco numeric)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_partes text[] := '{}';
  v_removidos text;
  v_refri text := coalesce(p_item #>> '{combo,refri}', '');
  v_adicional jsonb;
  v_qtd int;
begin
  if p_item ->> 'tipo' in ('lanche', 'combo') then
    select string_agg(r.valor, ', ' order by r.n) into v_removidos
    from jsonb_array_elements_text(coalesce(p_item -> 'removidos', '[]'::jsonb)) with ordinality as r(valor, n);
    if (p_item -> 'completo') = 'false'::jsonb and coalesce(v_removidos, '') <> '' then
      v_partes := array_append(v_partes, 'Sem ' || public.minusculas(v_removidos));
    else
      v_partes := array_append(v_partes, 'Completo');
    end if;
    v_partes := array_append(v_partes, case when (p_item -> 'prensado') = 'true'::jsonb then 'Prensado' else 'Não prensado' end);
  end if;
  if (p_item #> '{combo,ativo}') = 'true'::jsonb then
    v_partes := array_append(v_partes,
      'Combo +R$' || replace(round(p_combo_preco, 2)::text, '.', ',') || case when v_refri <> '' then ' (' || v_refri || ')' else '' end);
  end if;
  for v_adicional in
    select a.valor from jsonb_array_elements(coalesce(p_item -> 'adicionais', '[]'::jsonb)) with ordinality as a(valor, n) order by a.n
  loop
    v_qtd := (v_adicional ->> 'qtd')::int;
    v_partes := array_append(v_partes, '+ ' || case when v_qtd > 1 then v_qtd || '× ' else '' end || (v_adicional ->> 'nome'));
  end loop;
  if coalesce(p_item ->> 'sabor', '') <> '' then
    v_partes := array_append(v_partes, p_item ->> 'sabor');
  end if;
  return array_to_string(v_partes, ' · ');
end;
$$;

-- pedido no formato do contrato do painel, mais token e mesa
create or replace function public.pedido_json(p public.pedidos)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'token', p.token,
    'criadoEm', public.data_iso(p.criado_em),
    'origem', p.origem,
    'mesa', p.mesa,
    'cliente', jsonb_build_object('nome', p.cliente_nome, 'telefone', p.cliente_telefone),
    'modo', p.modo,
    'endereco', p.endereco,
    'referencia', p.referencia,
    'pagamento', p.pagamento,
    'troco', p.troco,
    'obs', p.obs,
    'itens', p.itens,
    'total', p.total,
    'status', p.status,
    'historico', p.historico
  )
$$;

-- ================= criar_pedido (anon, authenticated) =================
create or replace function public.criar_pedido(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe boolean := public.is_equipe();
  v_agora timestamptz := date_trunc('milliseconds', now());
  v_idem uuid;
  v_existente public.pedidos;
  v_cliente jsonb;
  v_nome text;
  v_tel text;
  v_origem text;
  v_modo text;
  v_endereco text;
  v_referencia text;
  v_pagamento text;
  v_troco text;
  v_obs text;
  v_mesa text;
  v_loja public.loja;
  v_dia date := public.dia_operacional(now());
  v_entrada jsonb;
  v_prod public.produtos;
  v_qtd int;
  v_removidos text[];
  v_prensado boolean;
  v_combo boolean;
  v_refri text;
  v_sabor text;
  v_adicionais jsonb;
  v_ids_adicionais text[];
  v_entrada_ad jsonb;
  v_adicional public.adicionais;
  v_qtd_ad int;
  v_unit numeric;
  v_sub numeric;
  v_item jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_pedido public.pedidos;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 65536 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- cliente
  v_cliente := p -> 'cliente';
  if v_cliente is null or jsonb_typeof(v_cliente) <> 'object' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_nome := public.campo_texto(v_cliente -> 'nome', 80);
  v_tel := regexp_replace(public.campo_texto(v_cliente -> 'telefone', 40), '[^0-9]', '', 'g');

  -- idempotência: o mesmo envio (queda de rede, clique duplo) devolve o pedido já gravado,
  -- antes de qualquer outra regra e sem contar no limite
  if p ? 'idempotencia' and jsonb_typeof(p -> 'idempotencia') <> 'null' then
    if jsonb_typeof(p -> 'idempotencia') <> 'string'
       or (p ->> 'idempotencia') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_idem := (p ->> 'idempotencia')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:idempotencia:' || v_idem::text, 0));
    select * into v_existente from public.pedidos where idempotencia = v_idem;
    if found then
      -- só devolve para quem mandou o mesmo telefone
      if v_existente.cliente_telefone <> v_tel then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      return public.pedido_json(v_existente);
    end if;
  end if;

  -- campos do pedido
  if char_length(v_nome) < 2 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_origem := coalesce(nullif(public.campo_texto(p -> 'origem', 20), ''), 'cardapio');
  if v_origem not in ('cardapio', 'qrcode', 'exemplo') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if v_origem = 'exemplo' and not v_equipe then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  -- telefone: 10 ou 11 dígitos (pedido de exemplo da equipe pode vir sem)
  if v_tel !~ '^[0-9]{10,11}$' and not (v_origem = 'exemplo' and v_tel = '') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_modo := public.campo_texto(p -> 'modo', 20);
  if v_modo not in ('entrega', 'retirada', 'local') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_endereco := public.campo_texto(p -> 'endereco', 200);
  if v_modo = 'entrega' and char_length(v_endereco) < 5 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_referencia := public.campo_texto(p -> 'referencia', 120);
  v_pagamento := nullif(public.campo_texto(p -> 'pagamento', 30), '');
  v_troco := public.campo_texto(p -> 'troco', 40);
  v_obs := public.campo_texto(p -> 'obs', 300);
  v_mesa := nullif(public.campo_texto(p -> 'mesa', 10), '');
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'itens') not between 1 and 30 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;

  -- loja e limite por telefone (a equipe ignora os dois)
  select * into v_loja from public.loja where id = 1;
  if not found then
    raise exception 'loja_fechada' using errcode = 'P0001';
  end if;
  if not v_equipe then
    if not public.loja_aberta(now()) and not v_loja.aceita_fechada then
      raise exception 'loja_fechada' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mineiro:telefone:' || v_tel, 0));
    if (select count(*) from public.pedidos
        where cliente_telefone = v_tel and criado_em > now() - interval '10 minutes') >= 5 then
      raise exception 'muitos_pedidos' using errcode = 'P0001';
    end if;
  end if;

  -- itens: preço e nome sempre do banco
  for v_entrada in
    select e.valor from jsonb_array_elements(p -> 'itens') with ordinality as e(valor, n) order by e.n
  loop
    if jsonb_typeof(v_entrada) <> 'object' or jsonb_typeof(v_entrada -> 'produtoId') is distinct from 'string' then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    select * into v_prod from public.produtos where id = v_entrada ->> 'produtoId';
    -- preco null = "Preço a confirmar": está no cardápio, mas ainda não se vende pelo site (nem pela equipe)
    if not found or not v_prod.ativo or v_prod.preco is null then
      raise exception 'produto_invalido' using errcode = 'P0001';
    end if;
    if v_prod.esgotado_dia = v_dia then
      raise exception 'produto_esgotado' using errcode = 'P0001';
    end if;
    v_qtd := public.campo_inteiro(v_entrada -> 'qtd', 1, 20, 1);

    -- removidos: só os que estão nos ingredientes, sem repetir, em ordem (como o sort() do navegador);
    -- completo = true descarta a lista, como no core.js
    if jsonb_typeof(v_entrada -> 'removidos') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_removidos := '{}';
    if jsonb_typeof(v_entrada -> 'removidos') = 'array' and (v_entrada -> 'completo') is distinct from 'true'::jsonb then
      if jsonb_array_length(v_entrada -> 'removidos') > 50 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(r.valor order by r.valor collate "C"), '{}') into v_removidos
      from (
        select distinct x.valor #>> '{}' as valor
        from jsonb_array_elements(v_entrada -> 'removidos') as x(valor)
        where jsonb_typeof(x.valor) = 'string'
      ) r
      where r.valor = any (v_prod.ingredientes);
    end if;

    -- prensado: só lanche e combo (nos outros tipos vira false, como no core.js; não muda preço)
    v_prensado := v_prod.tipo in ('lanche', 'combo') and coalesce((v_entrada -> 'prensado') = 'true'::jsonb, false);

    -- vira combo: só lanche
    if jsonb_typeof(v_entrada -> 'combo') not in ('object', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    v_combo := false;
    v_refri := '';
    if (v_entrada #> '{combo,ativo}') = 'true'::jsonb then
      if v_prod.tipo <> 'lanche' then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      v_combo := true;
      v_refri := public.campo_texto(v_entrada #> '{combo,refri}', 40);
    end if;

    v_sabor := public.campo_texto(v_entrada -> 'sabor', 40);

    -- adicionais: só lanche e combo, id ativo, qtd de 1 a 5, na ordem em que vieram
    v_unit := v_prod.preco + case when v_combo then v_loja.combo_preco else 0 end;
    v_adicionais := '[]'::jsonb;
    v_ids_adicionais := '{}';
    if jsonb_typeof(v_entrada -> 'adicionais') not in ('array', 'null') then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_entrada -> 'adicionais') = 'array' and jsonb_array_length(v_entrada -> 'adicionais') > 0 then
      if v_prod.tipo not in ('lanche', 'combo') then
        raise exception 'produto_invalido' using errcode = 'P0001';
      end if;
      if jsonb_array_length(v_entrada -> 'adicionais') > 20 then
        raise exception 'dados_invalidos' using errcode = 'P0001';
      end if;
      for v_entrada_ad in
        select a.valor from jsonb_array_elements(v_entrada -> 'adicionais') with ordinality as a(valor, n) order by a.n
      loop
        if jsonb_typeof(v_entrada_ad) <> 'object' or jsonb_typeof(v_entrada_ad -> 'id') is distinct from 'string' then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        if (v_entrada_ad ->> 'id') = any (v_ids_adicionais) then
          raise exception 'dados_invalidos' using errcode = 'P0001';
        end if;
        v_ids_adicionais := array_append(v_ids_adicionais, v_entrada_ad ->> 'id');
        select * into v_adicional from public.adicionais where id = v_entrada_ad ->> 'id';
        if not found or not v_adicional.ativo then
          raise exception 'produto_invalido' using errcode = 'P0001';
        end if;
        v_qtd_ad := public.campo_inteiro(v_entrada_ad -> 'qtd', 1, 5, 1);
        v_unit := v_unit + v_adicional.preco * v_qtd_ad;
        v_adicionais := v_adicionais || jsonb_build_array(jsonb_build_object(
          'id', v_adicional.id, 'nome', v_adicional.nome, 'qtd', v_qtd_ad, 'preco', v_adicional.preco));
      end loop;
    end if;

    -- precoUnit = preco + combo + Σ adicional × qtd; subtotal = precoUnit × qtd
    v_unit := round(v_unit, 2);
    v_sub := round(v_unit * v_qtd, 2);
    v_total := v_total + v_sub;
    v_item := jsonb_build_object(
      'produtoId', v_prod.id,
      'nome', v_prod.nome,
      'categoria', v_prod.categoria,
      'tipo', v_prod.tipo,
      'precoBase', v_prod.preco,
      'precoUnit', v_unit,
      'qtd', v_qtd,
      'completo', cardinality(v_removidos) = 0,
      'removidos', to_jsonb(v_removidos),
      'prensado', v_prensado,
      'combo', jsonb_build_object('ativo', v_combo, 'refri', v_refri),
      'adicionais', v_adicionais,
      'sabor', v_sabor
    );
    v_item := v_item || jsonb_build_object('resumo', public.resumo_item(v_item, v_loja.combo_preco), 'subtotal', v_sub);
    v_itens := v_itens || jsonb_build_array(v_item);
  end loop;

  insert into public.pedidos (
    criado_em, origem, mesa, cliente_nome, cliente_telefone, modo, endereco, referencia,
    pagamento, troco, obs, itens, total, status, historico, idempotencia
  ) values (
    v_agora, v_origem, v_mesa, v_nome, v_tel, v_modo, v_endereco, v_referencia,
    v_pagamento, v_troco, v_obs, v_itens, round(v_total, 2), 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'em', public.data_iso(v_agora))), v_idem
  )
  returning * into v_pedido;

  -- registro de clientes (pedido de exemplo não entra)
  if v_origem <> 'exemplo' then
    insert into public.clientes as c (telefone, nome, endereco, referencia, pedidos, primeiro_pedido_em, ultimo_pedido_em)
    values (
      v_tel, v_nome,
      case when v_modo = 'entrega' then v_endereco else '' end,
      case when v_modo = 'entrega' then v_referencia else '' end,
      1, v_agora, v_agora
    )
    on conflict (telefone) do update set
      nome = excluded.nome,
      endereco = case when v_modo = 'entrega' then excluded.endereco else c.endereco end,
      referencia = case when v_modo = 'entrega' then excluded.referencia else c.referencia end,
      pedidos = c.pedidos + 1,
      ultimo_pedido_em = excluded.ultimo_pedido_em;
  end if;

  return public.pedido_json(v_pedido);
end;
$$;

-- ================= acompanhar_pedido (anon, authenticated) =================
-- só o necessário para a tela "Acompanhe seu pedido": sem nome, telefone nem endereço
create or replace function public.acompanhar_pedido(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'numero', p.numero,
    'criadoEm', public.data_iso(p.criado_em),
    'status', p.status,
    'historico', p.historico,
    'modo', p.modo,
    'total', p.total,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', i.valor -> 'nome', 'qtd', i.valor -> 'qtd', 'resumo', i.valor -> 'resumo',
                                          'subtotal', i.valor -> 'subtotal') order by i.n)
      from jsonb_array_elements(p.itens) with ordinality as i(valor, n)
    ), '[]'::jsonb)
  )
  from public.pedidos p
  where p.token = p_token
$$;

-- ================= estado_cardapio (anon, authenticated) =================
-- o front aplica sobre o CONFIG: esgotados do dia, inativos, preços (null = "Preço a confirmar") e loja
create or replace function public.estado_cardapio()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (select public.dia_operacional(now()) as dia)
  select jsonb_build_object(
    'diaOperacional', to_char(d.dia, 'YYYY-MM-DD'),
    'esgotados', coalesce((select jsonb_agg(pr.id order by pr.ordem, pr.id) from public.produtos pr where pr.esgotado_dia = d.dia), '[]'::jsonb),
    'inativos', coalesce((select jsonb_agg(pr.id order by pr.ordem, pr.id) from public.produtos pr where not pr.ativo), '[]'::jsonb),
    'precos', coalesce((select jsonb_object_agg(pr.id, pr.preco) from public.produtos pr), '{}'::jsonb),
    'adicionais', coalesce((select jsonb_object_agg(a.id, a.preco) from public.adicionais a where a.ativo), '{}'::jsonb),
    'loja', public.loja_json()
  )
  from d
$$;

-- ================= funções da equipe (sem_permissao para quem não está em equipe) =================

-- novo→preparo; preparo→pronto (retirada/local) ou →rota (entrega); pronto|rota→entregue;
-- não final→cancelado com motivo (1 a 200). Pedido de exemplo aceita qualquer transição.
create or replace function public.mudar_status(p_id uuid, p_status text, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos;
  v_motivo text := public.aparar(coalesce(p_motivo, ''));
  v_ok boolean;
  v_evento jsonb;
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_id is null or p_status is null or p_status not in ('novo', 'preparo', 'pronto', 'rota', 'entregue', 'cancelado') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  if char_length(v_motivo) > 200 then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  select * into v_pedido from public.pedidos where id = p_id for update;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  if v_pedido.origem = 'exemplo' then
    v_ok := true;
  else
    v_ok := case
      when p_status = 'cancelado' then v_pedido.status in ('novo', 'preparo', 'pronto', 'rota')
      when v_pedido.status = 'novo' then p_status = 'preparo'
      when v_pedido.status = 'preparo' then p_status = case when v_pedido.modo = 'entrega' then 'rota' else 'pronto' end
      when v_pedido.status in ('pronto', 'rota') then p_status = 'entregue'
      else false
    end;
  end if;
  if not v_ok then
    raise exception 'transicao_invalida' using errcode = 'P0001';
  end if;
  if p_status = 'cancelado' and v_motivo = '' and v_pedido.origem <> 'exemplo' then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_evento := jsonb_build_object('status', p_status, 'em', public.data_iso(now()));
  if v_motivo <> '' then
    v_evento := v_evento || jsonb_build_object('motivo', v_motivo);
  end if;
  update public.pedidos
     set status = p_status, historico = historico || jsonb_build_array(v_evento)
   where id = p_id
  returning * into v_pedido;
  return public.pedido_json(v_pedido);
end;
$$;

-- esgotado vale só no dia de operação (volta sozinho às 4h)
create or replace function public.marcar_esgotado(p_produto text, p_esgotado boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_produto is null or p_esgotado is null then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  update public.produtos
     set esgotado_dia = case when p_esgotado then public.dia_operacional(now()) end
   where id = p_produto;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
end;
$$;

-- modo manual da loja: 'auto' segue o horário; 'aberta' ou 'fechada' é decisão do painel
create or replace function public.definir_loja(p_modo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_modo is null or p_modo not in ('auto', 'aberta', 'fechada') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  update public.loja set modo = p_modo where id = 1;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  return public.loja_json();
end;
$$;

-- apaga só os pedidos de exemplo; devolve quantos saíram
create or replace function public.remover_testes()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_qtd int;
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  delete from public.pedidos where origem = 'exemplo';
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- ================= privilégios das funções =================
-- o Supabase dá execute em toda função nova a anon e authenticated: tira de todas e libera uma a uma
revoke all on function
  public.dia_operacional(timestamptz),
  public.data_iso(timestamptz),
  public.aparar(text),
  public.minusculas(text),
  public.campo_texto(jsonb, int),
  public.campo_inteiro(jsonb, int, int, int),
  public.turno_minutos(jsonb),
  public.horario_aberto(jsonb, timestamptz),
  public.loja_aberta(timestamptz),
  public.loja_json(),
  public.resumo_item(jsonb, numeric),
  public.pedido_json(public.pedidos),
  public.criar_pedido(jsonb),
  public.acompanhar_pedido(uuid),
  public.estado_cardapio(),
  public.mudar_status(uuid, text, text),
  public.marcar_esgotado(text, boolean),
  public.definir_loja(text),
  public.remover_testes()
from public, anon, authenticated;

-- cliente (cardápio, checkout e acompanhamento)
grant execute on function
  public.dia_operacional(timestamptz),
  public.loja_aberta(timestamptz),
  public.criar_pedido(jsonb),
  public.acompanhar_pedido(uuid),
  public.estado_cardapio()
to anon, authenticated;

-- painel (precisa de login; dentro, is_equipe() decide)
grant execute on function
  public.mudar_status(uuid, text, text),
  public.marcar_esgotado(text, boolean),
  public.definir_loja(text),
  public.remover_testes()
to authenticated;
