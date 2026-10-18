-- Cotação privada emitida pelo backend. A flag só é ativada após validar os provedores.
alter table public.loja add column if not exists cotacao_ativa boolean not null default false;
alter table public.loja add column if not exists entrega_origem jsonb not null
  default '{"lat":-23.5409777,"lon":-46.312935,"perfil":"driving"}'::jsonb;
alter table public.pedidos add column if not exists cotacao_entrega_id uuid;

create table if not exists public.entrega_cache (
  chave text primary key check (chave ~ '^[a-f0-9]{64}$'),
  localizacao jsonb not null,
  local_valida_ate timestamptz not null,
  distancia_km numeric(6,3) check (distancia_km > 0 and distancia_km <= 100),
  rota_valida_ate timestamptz,
  origem jsonb not null,
  fonte_rota text,
  atualizado_em timestamptz not null default now()
);
create index if not exists entrega_cache_expira on public.entrega_cache(local_valida_ate);
create table if not exists public.cotacoes_entrega (
  id uuid primary key default gen_random_uuid(),
  endereco text not null check (char_length(endereco) between 5 and 200),
  distancia_km numeric(6,3) not null check (distancia_km > 0 and distancia_km <= 100),
  taxa_km numeric(10,2) not null check (taxa_km >= 0),
  taxa_fixa numeric(10,2) not null check (taxa_fixa >= 0),
  origem jsonb not null,
  fonte text not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '15 minutes')
);
create index if not exists cotacoes_entrega_expira on public.cotacoes_entrega(expira_em);
create table if not exists public.entrega_travas (
  chave text primary key, dono uuid not null, ate timestamptz not null
);
create table if not exists public.entrega_limites (
  chave text primary key, quantidade integer not null, ate timestamptz not null
);
create index if not exists entrega_limites_expira on public.entrega_limites(ate);
create table if not exists public.entrega_eventos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  codigo text not null, fonte text not null default '', duracao_ms integer not null
);
create index if not exists entrega_eventos_criado on public.entrega_eventos(criado_em);

alter table public.entrega_cache enable row level security;
alter table public.cotacoes_entrega enable row level security;
alter table public.entrega_travas enable row level security;
alter table public.entrega_limites enable row level security;
alter table public.entrega_eventos enable row level security;
revoke all on public.entrega_cache, public.cotacoes_entrega, public.entrega_travas,
  public.entrega_limites, public.entrega_eventos from public, anon, authenticated;
grant all on public.entrega_cache, public.cotacoes_entrega, public.entrega_travas,
  public.entrega_limites, public.entrega_eventos to service_role;
grant usage, select on sequence public.entrega_eventos_id_seq to service_role;
revoke all on sequence public.entrega_eventos_id_seq from public,anon,authenticated;

-- Contadores e trava compartilhados entre todas as instâncias do backend.
create or replace function public.reservar_entrega(p_chave text, p_cliente text, p_dono uuid)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_n integer; v_bucket text;
begin
  if p_chave !~ '^[a-f0-9]{64}$' or p_cliente !~ '^[a-f0-9]{64}$' or p_dono is null then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  insert into public.entrega_travas values (p_chave,p_dono,now()+interval '90 seconds')
  on conflict (chave) do update set dono=excluded.dono, ate=excluded.ate
    where entrega_travas.ate < now();
  if not found then return false; end if;
  v_bucket := 'ip:' || p_cliente || ':' || floor(extract(epoch from now())/600)::text;
  insert into public.entrega_limites values (v_bucket,1,now()+interval '20 minutes')
  on conflict(chave) do update set quantidade=entrega_limites.quantidade+1 returning quantidade into v_n;
  if v_n > 30 then raise exception 'muitas_cotacoes' using errcode='P0001'; end if;
  v_bucket := 'global:' || (now() at time zone 'UTC')::date::text;
  insert into public.entrega_limites values (v_bucket,1,now()+interval '2 days')
  on conflict(chave) do update set quantidade=entrega_limites.quantidade+1 returning quantidade into v_n;
  if v_n > 1000 then raise exception 'muitas_cotacoes' using errcode='P0001'; end if;
  delete from public.entrega_limites where ate < now();
  delete from public.entrega_travas where ate < now();
  delete from public.entrega_cache where local_valida_ate < now()-interval '1 day';
  delete from public.cotacoes_entrega where expira_em < now()-interval '7 days';
  delete from public.entrega_eventos where criado_em < now()-interval '7 days';
  return true;
end $$;
revoke all on function public.reservar_entrega(text,text,uuid) from public,anon,authenticated;
grant execute on function public.reservar_entrega(text,text,uuid) to service_role;

create or replace function public.emitir_cotacao_entrega(p_endereco text, p_km numeric, p_origem jsonb, p_fonte text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_loja public.loja; v_q public.cotacoes_entrega;
begin
  select * into v_loja from public.loja where id=1 for share;
  if v_loja.entrega_origem is distinct from p_origem then
    raise exception 'cotacao_expirada' using errcode='P0001';
  end if;
  insert into public.cotacoes_entrega(endereco,distancia_km,taxa_km,taxa_fixa,origem,fonte)
  values (btrim(p_endereco),round(p_km,3),v_loja.taxa_km,v_loja.taxa_fixa,p_origem,p_fonte) returning * into v_q;
  return jsonb_build_object('id',v_q.id,'distanciaKm',v_q.distancia_km,
    'taxa',round(ceil(v_q.distancia_km)*v_q.taxa_km+v_q.taxa_fixa,2),'expiraEm',v_q.expira_em,'estado','ok');
end $$;
revoke all on function public.emitir_cotacao_entrega(text,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.emitir_cotacao_entrega(text,numeric,jsonb,text) to service_role;

create or replace function public.loja_json()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('modo',l.modo,'aceitaFechada',l.aceita_fechada,'comboPreco',l.combo_preco,
    'taxaKm',l.taxa_km,'taxaFixa',l.taxa_fixa,'horarios',l.horarios,'cotacaoAtiva',l.cotacao_ativa)
  from public.loja l where l.id=1
$$;

-- Métricas sem dados pessoais, acessíveis somente à equipe.
create or replace function public.resumo_entregas()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  return (select coalesce(jsonb_object_agg(codigo,n),'{}'::jsonb) from
    (select codigo,count(*) n from public.entrega_eventos where criado_em>now()-interval '24 hours' group by codigo) s);
end $$;
revoke all on function public.resumo_entregas() from public,anon;
grant execute on function public.resumo_entregas() to authenticated;

create or replace function public.definir_origem_entrega(p_lat double precision,p_lon double precision)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  if p_lat is null or p_lon is null or p_lat not between -34 and 6 or p_lon not between -74 and -34 then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  update public.loja set entrega_origem=jsonb_build_object('lat',p_lat,'lon',p_lon,'perfil','driving','confirmadaEm',public.data_iso(now())) where id=1;
end $$;
revoke all on function public.definir_origem_entrega(double precision,double precision) from public,anon;
grant execute on function public.definir_origem_entrega(double precision,double precision) to authenticated;

-- Mesmo contrato de criação, com a distância obtida da cotação privada.
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
  v_cotacao public.cotacoes_entrega;
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
  v_dist numeric;
  v_taxa numeric;
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
  -- distância da entrega (km pela rota, informada pelo navegador): de 0 a 100 km, 3 casas.
  -- Fora da entrega ou sem a distância, a taxa fica null = "a combinar" (o painel mostra assim)
  if p ? 'distanciaKm' and jsonb_typeof(p -> 'distanciaKm') not in ('number', 'null') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  v_dist := null;
  if v_modo = 'entrega' and jsonb_typeof(p -> 'distanciaKm') = 'number' then
    v_dist := round((p ->> 'distanciaKm')::numeric, 3);
    if v_dist <= 0 or v_dist > 100 then
      raise exception 'dados_invalidos' using errcode = 'P0001';
    end if;
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
  -- Cotação obrigatória para novas entregas; idempotência e pedidos antigos continuam preservados.
  if v_modo = 'entrega' and v_loja.cotacao_ativa and v_origem <> 'exemplo' then
    if jsonb_typeof(p->'cotacaoId') is distinct from 'string'
       or (p->>'cotacaoId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'cotacao_necessaria' using errcode='P0001';
    end if;
    select * into v_cotacao from public.cotacoes_entrega where id=(p->>'cotacaoId')::uuid;
    if not found then raise exception 'cotacao_necessaria' using errcode='P0001'; end if;
    if v_cotacao.expira_em <= now() or v_cotacao.origem is distinct from v_loja.entrega_origem
       or v_cotacao.taxa_km <> v_loja.taxa_km or v_cotacao.taxa_fixa <> v_loja.taxa_fixa then
      raise exception 'cotacao_expirada' using errcode='P0001';
    end if;
    if lower(regexp_replace(btrim(v_cotacao.endereco),'\s+',' ','g')) <>
       lower(regexp_replace(btrim(v_endereco),'\s+',' ','g')) then
      raise exception 'cotacao_endereco_divergente' using errcode='P0001';
    end if;
    v_dist := v_cotacao.distancia_km;
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

  -- taxa de entrega: km cobrados (sempre para cima) x taxa_km + taxa_fixa; entra no total
  if v_dist is not null then
    v_taxa := round(ceil(v_dist) * v_loja.taxa_km + v_loja.taxa_fixa, 2);
    v_total := v_total + v_taxa;
  end if;

  insert into public.pedidos (
    criado_em, origem, mesa, cliente_nome, cliente_telefone, modo, endereco, referencia,
    pagamento, troco, obs, itens, total, distancia_km, taxa_entrega, status, historico, idempotencia, cotacao_entrega_id
  ) values (
    v_agora, v_origem, v_mesa, v_nome, v_tel, v_modo, v_endereco, v_referencia,
    v_pagamento, v_troco, v_obs, v_itens, round(v_total, 2), v_dist, v_taxa, 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'em', public.data_iso(v_agora))), v_idem, v_cotacao.id
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

notify pgrst, 'reload schema';
