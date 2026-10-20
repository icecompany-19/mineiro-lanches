-- Branch de homologação: flag desligada; não altera pagamentos de pedidos antigos.
alter table public.loja add column if not exists pagamentos_ativos boolean not null default false;
alter table public.pedidos add column if not exists pagamento_online text
  check(pagamento_online in ('pendente','aprovado','recusado','cancelado','reembolsado','parcialmente_reembolsado','em_disputa','revisao'));
alter table public.pedidos add column if not exists pagamento_em timestamptz;

create table if not exists public.pagamentos_mp (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references public.pedidos(id) on delete restrict,
  email text not null check(char_length(email)<=254),
  total numeric(10,2) not null check(total>0),
  order_id text unique,
  checkout_url text,
  estado text not null default 'pendente' check(estado in ('pendente','aprovado','recusado','cancelado','reembolsado','parcialmente_reembolsado','em_disputa','revisao')),
  status_mp text,
  detalhe_mp text,
  versao_mp timestamptz,
  criado_em timestamptz not null default now(),
  ultima_consulta timestamptz,
  criando_ate timestamptz,
  reembolso_solicitado_em timestamptz,
  reembolso_autor uuid
);
create index if not exists pagamentos_mp_consulta on public.pagamentos_mp(ultima_consulta nulls first,criado_em) where order_id is not null;
create table if not exists public.pagamentos_mp_eventos (
  id bigint generated always as identity primary key,
  pagamento_id uuid not null references public.pagamentos_mp(id) on delete restrict,
  estado text not null,
  status_mp text not null,
  detalhe_mp text not null,
  versao_mp timestamptz not null,
  recebido_em timestamptz not null default now(),
  unique(pagamento_id,versao_mp,estado)
);
alter table public.pagamentos_mp enable row level security;
alter table public.pagamentos_mp_eventos enable row level security;
revoke all on public.pagamentos_mp,public.pagamentos_mp_eventos from public,anon,authenticated;
grant all on public.pagamentos_mp,public.pagamentos_mp_eventos to service_role;
revoke all on sequence public.pagamentos_mp_eventos_id_seq from public,anon,authenticated;
grant usage,select on sequence public.pagamentos_mp_eventos_id_seq to service_role;

-- A flag determina a exigência no INSERT, independentemente do navegador. Não reclassifica o histórico.
create or replace function public.proteger_pagamento_pedido()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.pagamento_online:=null;
    new.pagamento_em:=null;
    if new.origem<>'exemplo' and (select pagamentos_ativos from public.loja where id=1) then
      if new.total<=0 or (new.modo='entrega' and new.taxa_entrega is null) then
        raise exception 'pagamento_valor_invalido' using errcode='P0001';
      end if;
      new.pagamento_online:='pendente';
      new.pagamento:='Mercado Pago';
      new.troco:='';
    end if;
  elsif new.status is distinct from old.status and new.status not in ('novo','cancelado')
    and old.pagamento_online is not null and new.pagamento_online is distinct from 'aprovado' then
    raise exception 'pagamento_pendente' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function public.proteger_pagamento_pedido() from public,anon,authenticated;
drop trigger if exists pedidos_proteger_pagamento on public.pedidos;
create trigger pedidos_proteger_pagamento before insert or update on public.pedidos
for each row execute function public.proteger_pagamento_pedido();

-- Helpers invoker, exclusivos do backend. Nunca expõem dados da conta, e-mail ou cobrança via anon.
create or replace function public.preparar_pagamento_mp(p_token uuid,p_email text default null,p_iniciar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_p public.pedidos; v_m public.pagamentos_mp; v_criar boolean:=false; v_consultar boolean:=false;
begin
  select * into v_p from public.pedidos where token=p_token for update;
  if not found or v_p.pagamento_online is null then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where pedido_id=v_p.id for update;
  if v_m.id is null and p_iniciar then
    if v_p.status<>'novo' or v_p.pagamento_online<>'pendente' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
    if p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'email_invalido' using errcode='P0001';
    end if;
    insert into public.pagamentos_mp(pedido_id,email,total) values(v_p.id,lower(btrim(p_email)),v_p.total) returning * into v_m;
  end if;
  if v_m.id is null then return jsonb_build_object('estado',v_p.pagamento_online,'pedido_status',v_p.status); end if;
  if p_iniciar and v_p.status='cancelado' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
  if v_m.order_id is null and p_iniciar and coalesce(v_m.criando_ate,'-infinity')<now() then
    update public.pagamentos_mp set criando_ate=now()+interval '30 seconds' where id=v_m.id returning * into v_m;
    v_criar:=true;
  end if;
  if v_m.order_id is not null and coalesce(v_m.ultima_consulta,'-infinity')<now()-interval '8 seconds' then
    update public.pagamentos_mp set ultima_consulta=now() where id=v_m.id;
    v_consultar:=true;
  end if;
  return to_jsonb(v_m)||jsonb_build_object('token',v_p.token,'numero',v_p.numero,'itens',v_p.itens,'taxaEntrega',v_p.taxa_entrega,'pedido_status',v_p.status,'criar',v_criar,'consultar',v_consultar);
end $$;

create or replace function public.registrar_pagamento_mp(p_id uuid,p_order_id text,p_estado text,p_em timestamptz,p_checkout text,p_status text,p_detalhe text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_m public.pagamentos_mp; v_p public.pedidos;
begin
  -- Mesma ordem de travas do preparador: pedido antes de pagamento.
  select p.* into v_p from public.pedidos p join public.pagamentos_mp m on m.pedido_id=p.id where m.id=p_id for update of p;
  if not found then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where id=p_id for update;
  if p_order_id is null or p_order_id !~ '^ORD[A-Za-z0-9]{10,80}$' or
    (v_m.order_id is not null and v_m.order_id<>p_order_id) or p_em is null or p_em>now()+interval '5 minutes'
    or p_estado is null or p_estado not in ('pendente','aprovado','recusado','cancelado','reembolsado','parcialmente_reembolsado','em_disputa','revisao')
    or p_status is null or length(p_status)>80 or p_detalhe is null or length(p_detalhe)>100
    or (p_checkout is not null and p_checkout !~ '^https://www\.mercadopago\.com\.br/checkout/') then
    raise exception 'pagamento_divergente' using errcode='P0001';
  end if;
  update public.pagamentos_mp set order_id=p_order_id,checkout_url=coalesce(p_checkout,checkout_url),criando_ate=null,ultima_consulta=now() where id=p_id;
  -- Reentregas e consultas que chegaram fora de ordem não desfazem uma aprovação/estorno.
  if v_m.versao_mp is not null and p_em<=v_m.versao_mp then return jsonb_build_object('estado',v_m.estado); end if;
  if v_m.estado in ('aprovado','reembolsado','parcialmente_reembolsado','em_disputa') and p_estado in ('pendente','recusado','cancelado') then
    return jsonb_build_object('estado',v_m.estado);
  end if;
  if v_m.estado in ('reembolsado','parcialmente_reembolsado','em_disputa') and p_estado='aprovado' then
    return jsonb_build_object('estado',v_m.estado);
  end if;
  update public.pagamentos_mp set estado=p_estado,status_mp=p_status,detalhe_mp=p_detalhe,versao_mp=p_em where id=p_id;
  insert into public.pagamentos_mp_eventos(pagamento_id,estado,status_mp,detalhe_mp,versao_mp)
    values(p_id,p_estado,p_status,p_detalhe,p_em) on conflict do nothing;
  update public.pedidos set pagamento_online=p_estado,pagamento_em=p_em where id=v_p.id;
  return jsonb_build_object('estado',p_estado);
end $$;

create or replace function public.autorizar_reembolso_mp(p_autor uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_m public.pagamentos_mp;
begin
  if not exists(select 1 from public.usuarios_painel u join public.equipe e on e.user_id=u.user_id
    where u.user_id=p_autor and u.ativo and u.perfil='admin') then raise exception 'sem_permissao' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where pedido_id=p_id for update;
  if not found or v_m.estado<>'aprovado' or v_m.order_id is null then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
  if not exists(select 1 from public.pedidos where id=p_id and status='cancelado') then
    raise exception 'cancele_antes_de_estornar' using errcode='P0001'; end if;
  update public.pagamentos_mp set reembolso_solicitado_em=coalesce(reembolso_solicitado_em,now()),reembolso_autor=coalesce(reembolso_autor,p_autor)
    where id=v_m.id returning * into v_m;
  return to_jsonb(v_m);
end $$;
revoke all on function public.preparar_pagamento_mp(uuid,text,boolean),public.registrar_pagamento_mp(uuid,text,text,timestamptz,text,text,text),public.autorizar_reembolso_mp(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preparar_pagamento_mp(uuid,text,boolean),public.registrar_pagamento_mp(uuid,text,text,timestamptz,text,text,text),public.autorizar_reembolso_mp(uuid,uuid) to service_role;

-- Reserva antes da chamada externa: um recurso com falha não bloqueia a recuperação dos demais.
create or replace function public.reservar_conciliacao_mp()
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_resultado jsonb;
begin
  with candidatos as (
    select id from public.pagamentos_mp
    where order_id is not null and coalesce(ultima_consulta,'-infinity')<now()-interval '1 minute'
    order by ultima_consulta nulls first,criado_em limit 12 for update skip locked
  ), reservados as (
    update public.pagamentos_mp m set ultima_consulta=now() from candidatos c where m.id=c.id returning m.*
  ) select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_resultado from reservados r;
  return v_resultado;
end $$;
revoke all on function public.reservar_conciliacao_mp() from public,anon,authenticated;
grant execute on function public.reservar_conciliacao_mp() to service_role;

create or replace function public.loja_json()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('modo',l.modo,'aceitaFechada',l.aceita_fechada,'comboPreco',l.combo_preco,
    'taxaKm',l.taxa_km,'taxaFixa',l.taxa_fixa,'horarios',l.horarios,'cotacaoAtiva',l.cotacao_ativa,'pagamentosAtivos',l.pagamentos_ativos)
  from public.loja l where l.id=1
$$;

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
    'pagamentoOnline', p.pagamento_online,
    'pagamentoEm', p.pagamento_em,
    'troco', p.troco,
    'obs', p.obs,
    'itens', p.itens,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'status', p.status,
    'historico', p.historico
  ) || case when p.entrega_destino is null then '{}'::jsonb else jsonb_build_object('entregaDestino',p.entrega_destino) end
$$;



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
    'pagamentoOnline', p.pagamento_online,
    'pagamentoEm', p.pagamento_em,
    'historico', p.historico,
    'modo', p.modo,
    'total', p.total,
    'distanciaKm', p.distancia_km,
    'taxaEntrega', p.taxa_entrega,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', i.valor -> 'nome', 'qtd', i.valor -> 'qtd', 'resumo', i.valor -> 'resumo',
                                          'subtotal', i.valor -> 'subtotal') order by i.n)
      from jsonb_array_elements(p.itens) with ordinality as i(valor, n)
    ), '[]'::jsonb)
  )
  from public.pedidos p
  where p.token = p_token
$$;


notify pgrst,'reload schema';
