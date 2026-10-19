-- Viagens: reserva de pedidos prontos, carregamento reconhecido, saída e retorno.
-- Instala desligado. Limites da operação são informados pela equipe antes da ativação.
alter table public.pedidos add column if not exists entrega_planejamento_pausado boolean not null default false;
create table if not exists public.entrega_rotas_config (
  id smallint primary key default 1 check(id=1),
  modo text not null default 'desligado' check(modo in ('desligado','assistido','automatico')),
  regras jsonb not null default '{}',
  versao uuid not null default gen_random_uuid(),
  limite_creditos_dia integer not null default 1000 check(limite_creditos_dia between 20 and 100000),
  job_url text,
  job_token text not null default (gen_random_uuid()::text||gen_random_uuid()::text),
  cron_ativo boolean not null default false,
  alterado_em timestamptz not null default now(),
  alterado_por uuid references auth.users(id) on delete set null
);
insert into public.entrega_rotas_config(id) values(1) on conflict do nothing;
create table if not exists public.entregadores_disponibilidade (
  user_id uuid primary key references auth.users(id) on delete cascade,
  situacao text not null check(situacao in ('na_loja','pausado','fora')),
  desde timestamptz not null default now(),
  autor uuid references auth.users(id) on delete set null,
  motivo text
);
create table if not exists public.entrega_rotas_execucoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  autor uuid references auth.users(id) on delete set null,
  automatica boolean not null default false,
  estado text not null default 'calculando' check(estado in ('calculando','concluida','erro')),
  entrada jsonb not null,
  impedidos jsonb not null default '[]',
  erro text,
  creditos_reservados integer not null default 0
);
create index if not exists entrega_rotas_execucoes_tempo on public.entrega_rotas_execucoes(criado_em);
create table if not exists public.entrega_rotas_planos (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references public.entrega_rotas_execucoes(id) on delete cascade,
  motoboy_id uuid references auth.users(id) on delete set null,
  config_versao uuid not null,
  estado text not null default 'aberto' check(estado in ('aberto','reservado','vencido','desfeito')),
  criado_em timestamptz not null default now(),
  valido_ate timestamptz not null,
  dados jsonb not null
);
create index if not exists entrega_rotas_planos_estado on public.entrega_rotas_planos(estado,valido_ate);
create index if not exists entrega_rotas_planos_execucao on public.entrega_rotas_planos(execucao_id);
create table if not exists public.entrega_viagens (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid unique references public.entrega_rotas_planos(id) on delete set null,
  motoboy_id uuid references auth.users(id) on delete set null,
  motoboy_nome text not null,
  versao uuid not null default gen_random_uuid(),
  estado text not null default 'reservada' check(estado in ('reservada','em_rota','retornando','encerrada','cancelada')),
  criada_em timestamptz not null default now(),
  criada_por uuid references auth.users(id) on delete set null,
  automatica boolean not null default false,
  origem jsonb not null,
  regras jsonb not null,
  geometria jsonb,
  geometria_ate timestamptz,
  segundos integer not null check(segundos>=0),
  metros integer not null check(metros>=0),
  ultima_entrega_seg integer not null check(ultima_entrega_seg>=0),
  carregada_versao uuid,
  carregada_em timestamptz,
  revisao_pendente boolean not null default false,
  saiu_em timestamptz,
  retornou_em timestamptz,
  encerrada_por uuid references auth.users(id) on delete set null,
  motivo text
);
create unique index if not exists entrega_viagens_motoboy_ativa on public.entrega_viagens(motoboy_id)
  where estado in ('reservada','em_rota','retornando') and motoboy_id is not null;
create table if not exists public.entrega_viagens_paradas (
  viagem_id uuid not null references public.entrega_viagens(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  ordem integer not null check(ordem between 1 and 6),
  atribuicao uuid not null,
  chegada_seg integer not null check(chegada_seg>=0),
  ativa boolean not null default true,
  primary key(viagem_id,pedido_id), unique(viagem_id,ordem)
);
create unique index if not exists entrega_viagens_pedido_ativo on public.entrega_viagens_paradas(pedido_id) where ativa;
create table if not exists public.entrega_rotas_eventos (
  id uuid primary key default gen_random_uuid(),
  viagem_id uuid references public.entrega_viagens(id) on delete cascade,
  motoboy_id uuid references auth.users(id) on delete set null,
  autor uuid references auth.users(id) on delete set null,
  tipo text not null,
  criado_em timestamptz not null default now(),
  dados jsonb not null default '{}'
);
create index if not exists entrega_rotas_eventos_viagem on public.entrega_rotas_eventos(viagem_id,criado_em);
create index if not exists entrega_rotas_eventos_motoboy on public.entrega_rotas_eventos(motoboy_id);
create table if not exists public.entrega_rotas_cache (
  chave text primary key,
  matriz jsonb not null,
  valido_ate timestamptz not null
);
alter table public.entrega_rotas_config enable row level security;
alter table public.entregadores_disponibilidade enable row level security;
alter table public.entrega_rotas_execucoes enable row level security;
alter table public.entrega_rotas_planos enable row level security;
alter table public.entrega_viagens enable row level security;
alter table public.entrega_viagens_paradas enable row level security;
alter table public.entrega_rotas_eventos enable row level security;
alter table public.entrega_rotas_cache enable row level security;
revoke all on public.entrega_rotas_config,public.entregadores_disponibilidade,public.entrega_rotas_execucoes,
  public.entrega_rotas_planos,public.entrega_viagens,public.entrega_viagens_paradas,public.entrega_rotas_eventos,
  public.entrega_rotas_cache from public,anon,authenticated;

create or replace function public.rotas_regras_validas(r jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(r)<>'object' or not (r ?& array['maxPedidos','esperaMin','trajetoMin','desvioMin','paradaMin']) then return false; end if;
  if exists(select 1 from unnest(array['maxPedidos','esperaMin','trajetoMin','desvioMin','paradaMin']) k
    where jsonb_typeof(r->k)<>'number') then return false; end if;
  return (r->>'maxPedidos')::numeric between 1 and 6 and (r->>'maxPedidos')::numeric=trunc((r->>'maxPedidos')::numeric)
    and (r->>'esperaMin')::numeric between 1 and 120 and (r->>'trajetoMin')::numeric between 1 and 180
    and (r->>'desvioMin')::numeric between 0 and 120 and (r->>'paradaMin')::numeric between 0 and 15;
exception when others then return false;
end $$;
revoke all on function public.rotas_regras_validas(jsonb) from public,anon,authenticated;

create or replace function public.rotas_config_json() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('modo',c.modo,'regras',c.regras,'versao',c.versao,'limiteCreditosDia',c.limite_creditos_dia,
    'automacaoDisponivel',c.cron_ativo and c.job_url is not null,'origemConfirmada',l.entrega_origem ? 'confirmadaEm',
    'origem',l.entrega_origem,'configurada',public.rotas_regras_validas(c.regras))
  from public.entrega_rotas_config c cross join public.loja l where c.id=1 and l.id=1
$$;
revoke all on function public.rotas_config_json() from public,anon,authenticated;

create or replace function public.configurar_rotas(p_modo text,p_regras jsonb,p_limite integer default 1000,p_versao uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_modo is null or p_modo not in ('desligado','assistido','automatico') or p_limite is null or p_limite not between 20 and 100000
    or p_regras is null or (p_modo<>'desligado' and not public.rotas_regras_validas(p_regras)) then raise exception 'dados_invalidos'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_versao is distinct from c.versao then raise exception 'versao_alterada'; end if;
  if p_modo='automatico' and (not c.cron_ativo or c.job_url is null) then raise exception 'automacao_indisponivel'; end if;
  if p_modo<>'desligado' and not (select entrega_origem ? 'confirmadaEm' from public.loja where id=1) then raise exception 'origem_nao_confirmada'; end if;
  update public.entrega_rotas_config set modo=p_modo,regras=p_regras,limite_creditos_dia=p_limite,
    versao=gen_random_uuid(),alterado_em=now(),alterado_por=auth.uid() where id=1;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  insert into public.entrega_rotas_eventos(autor,tipo,dados) values(auth.uid(),'configuracao',jsonb_build_object('modo',p_modo,'regras',p_regras));
  if p_modo='automatico' then perform public.disparar_planejador_entregas(); end if;
  return public.rotas_config_json();
end $$;
revoke all on function public.configurar_rotas(text,jsonb,integer,uuid) from public,anon;
grant execute on function public.configurar_rotas(text,jsonb,integer,uuid) to authenticated;

create or replace function public.estado_entregador_rotas(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'declarado',coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) then d.situacao end,'fora'),
    'disponivelDesde',d.desde,'ultimaEm',c.ultima_em,'viagemId',v.id,
    'qtdAbertas',(select count(*) from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),
    'situacao',case when v.id is not null then v.estado else coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) then d.situacao end,'fora') end,
    'elegivel',coalesce(m.ativo and d.situacao='na_loja' and public.dia_operacional(d.desde)=public.dia_operacional(now()) and c.ultima_em>=now()-interval '2 minutes' and v.id is null and not exists(
      select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
      where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),false))
  from public.motoboys m left join public.entregadores_disponibilidade d on d.user_id=m.user_id
    left join public.entregadores_comunicacao c on c.user_id=m.user_id
    left join public.entrega_viagens v on v.motoboy_id=m.user_id and v.estado in ('reservada','em_rota','retornando')
  where m.user_id=p_id
$$;
revoke all on function public.estado_entregador_rotas(uuid) from public,anon,authenticated;

create or replace function public.definir_disponibilidade_entregador(p_situacao text,p_motoboy uuid default null,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare alvo uuid:=coalesce(p_motoboy,auth.uid()); anterior public.entregadores_disponibilidade;
begin
  if not public.is_equipe() and (not public.is_motoboy() or alvo is distinct from auth.uid()) then raise exception 'sem_permissao'; end if;
  if alvo is null or p_situacao is null or p_situacao not in ('na_loja','pausado','fora') then raise exception 'dados_invalidos'; end if;
  if alvo is distinct from auth.uid() and (nullif(btrim(p_motivo),'') is null or length(p_motivo)>200) then raise exception 'motivo_obrigatorio'; end if;
  perform 1 from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if exists(select 1 from public.entrega_viagens where motoboy_id=alvo and estado in ('reservada','em_rota','retornando')) then
    raise exception 'entregador_em_viagem'; end if;
  if p_situacao='na_loja' and exists(select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
    where e.motoboy_id=alvo and e.encerramento is null and p.status in ('preparo','pronto','rota')) then raise exception 'entregas_pendentes'; end if;
  select * into anterior from public.entregadores_disponibilidade where user_id=alvo;
  if anterior.situacao is distinct from p_situacao or public.dia_operacional(anterior.desde) is distinct from public.dia_operacional(now()) then
    insert into public.entregadores_disponibilidade(user_id,situacao,autor,motivo) values(alvo,p_situacao,auth.uid(),nullif(btrim(p_motivo),''))
      on conflict(user_id) do update set situacao=excluded.situacao,desde=now(),autor=excluded.autor,motivo=excluded.motivo;
    insert into public.entrega_rotas_eventos(motoboy_id,autor,tipo,dados) values(alvo,auth.uid(),'disponibilidade',
      jsonb_build_object('situacao',p_situacao,'motivo',nullif(btrim(p_motivo),'')));
  end if;
  if alvo=auth.uid() then perform public.comunicar_entregador(); end if;
  if p_situacao='na_loja' then perform public.disparar_planejador_entregas(); end if;
  return public.estado_entregador_rotas(alvo);
end $$;
revoke all on function public.definir_disponibilidade_entregador(text,uuid,text) from public,anon;
grant execute on function public.definir_disponibilidade_entregador(text,uuid,text) to authenticated;

-- Somente a Edge Function autenticada cria execuções. O token do cron nunca sai em uma RPC do navegador.
create or replace function public.iniciar_planejamento_entregas(p_autor uuid,p_token text default null,
  p_pedidos jsonb default null,p_ordem_fixa boolean default false,p_verificar boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config; origem jsonb; pedidos jsonb; entregadores jsonb; entrada jsonb; cache_chave text;
  id_exec uuid; usados integer; custo integer; n integer; matriz jsonb; inicio timestamptz;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if p_autor is null then
    if p_token is null or p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
    if not coalesce(p_verificar,false) and c.modo<>'automatico' then return jsonb_build_object('estado','desligado'); end if;
  elsif not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_autor is null and p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
  if p_autor is null and not coalesce(p_verificar,false) and c.modo<>'automatico' then return jsonb_build_object('estado','desligado'); end if;
  if exists(select 1 from public.entrega_rotas_execucoes where estado='calculando' and criado_em>now()-interval '2 minutes') then
    return jsonb_build_object('estado','calculando'); end if;
  if exists(select 1 from public.entrega_rotas_execucoes where criado_em>now()-interval '5 seconds') then
    return jsonb_build_object('estado','aguarde'); end if;
  select entrega_origem into origem from public.loja where id=1;
  if not coalesce(p_verificar,false) and (c.modo='desligado' or not public.rotas_regras_validas(c.regras)) then raise exception 'configuracao_rotas_pendente'; end if;
  if not coalesce(p_verificar,false) and not (origem ? 'confirmadaEm') then raise exception 'origem_nao_confirmada'; end if;
  if p_pedidos is not null and (jsonb_typeof(p_pedidos)<>'array' or jsonb_array_length(p_pedidos) not between 1 and 6
    or (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_pedidos) x)) then raise exception 'dados_invalidos'; end if;
  inicio:=(public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select coalesce(jsonb_agg(e||jsonb_build_object('qtdConcluidas',public.taxas_entregador(m.user_id,inicio)->'qtdConcluidas') order by m.user_id),'[]')
    into entregadores from public.motoboys m cross join lateral (select public.estado_entregador_rotas(m.user_id) e) s
    where (e->>'elegivel')::boolean is true;
  select coalesce(jsonb_agg(x.dados order by x.ordem,x.pronto,x.id),'[]') into pedidos from (
    select p.id,h.pronto,case when p_pedidos is null then 0 else (select a.n::integer from jsonb_array_elements_text(p_pedidos) with ordinality a(v,n) where v=p.id::text) end as ordem,
      jsonb_build_object('id',p.id,'numero',p.numero,'ponto',p.entrega_destino,'pontoAte',p.entrega_destino_ate,
        'prontoEm',public.data_iso(h.pronto),'versao',md5(to_jsonb(p)::text)) as dados
    from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      cross join lateral (select max((x->>'em')::timestamptz) as pronto from jsonb_array_elements(p.historico) x where x->>'status'='pronto') h
    where p.modo='entrega' and p.origem<>'exemplo' and p.status='pronto' and h.pronto is not null
      and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
      and p.entrega_destino is not null and p.entrega_destino_ate>now()
      and (not p.entrega_planejamento_pausado or (p_pedidos is not null and p_autor is not null))
      and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      and (p_pedidos is null or p_pedidos ? p.id::text)
    order by ordem,h.pronto,p.id limit 12) x;
  n:=jsonb_array_length(pedidos);
  if not coalesce(p_verificar,false) then
    if p_pedidos is not null and n<>jsonb_array_length(p_pedidos) then raise exception 'pedido_alterado'; end if;
    if n=0 then return jsonb_build_object('estado','sem_pedidos'); end if;
    if jsonb_array_length(entregadores)=0 then return jsonb_build_object('estado','sem_entregador'); end if;
  end if;
  cache_chave:=case when not coalesce(p_verificar,false) then md5(jsonb_build_object('origem',origem,'pontos',
    (select jsonb_agg(x->'ponto' order by a.n) from jsonb_array_elements(pedidos) with ordinality a(x,n)),'modelo','drive-approximated-v1')::text) end;
  select x.matriz into matriz from public.entrega_rotas_cache x where x.chave=cache_chave and x.valido_ate>now();
  -- Reserva conservadora, por tentativa: orçamento interno estimado, não saldo da conta do provedor.
  custo:=case when coalesce(p_verificar,false) then 12 else (case when matriz is null then (n+1)*least(n+1,10) else 0 end)+4*n end;
  select coalesce(sum(creditos_reservados),0) into usados from public.entrega_rotas_execucoes where criado_em>=inicio;
  if usados+custo>c.limite_creditos_dia then raise exception 'orcamento_rotas_esgotado'; end if;
  entrada:=jsonb_build_object('origem',origem,'regras',c.regras,'configVersao',c.versao,'pedidos',pedidos,
    'entregadores',entregadores,'ordemFixa',coalesce(p_ordem_fixa,false),'cacheChave',cache_chave,'verificacao',coalesce(p_verificar,false),
    'agora',public.data_iso(now()));
  insert into public.entrega_rotas_execucoes(autor,automatica,entrada,creditos_reservados)
    values(p_autor,p_autor is null and not coalesce(p_verificar,false),entrada,custo) returning id into id_exec;
  return entrada||jsonb_build_object('id',id_exec,'estado','calcular','matriz',matriz);
end $$;
revoke all on function public.iniciar_planejamento_entregas(uuid,text,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.iniciar_planejamento_entregas(uuid,text,jsonb,boolean,boolean) to service_role;

create or replace function public.viagem_entrega_json(v public.entrega_viagens) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',v.id,'motoboyId',v.motoboy_id,'motoboyNome',v.motoboy_nome,'versao',v.versao,'estado',v.estado,
    'criadaEm',v.criada_em,'automatica',v.automatica,'carregadaVersao',v.carregada_versao,'carregadaEm',v.carregada_em,
    'revisaoPendente',v.revisao_pendente,'saiuEm',v.saiu_em,'origem',v.origem,
    'segundos',v.segundos,'metros',v.metros,'ultimaEntregaSeg',v.ultima_entrega_seg,
    'geometriaAte',v.geometria_ate,
    'geometria',case when v.geometria_ate>now() and not v.revisao_pendente then v.geometria end,
    'paradas',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,
      'endereco',p.endereco,'status',p.status,'ordem',s.ordem,'atribuicao',s.atribuicao,'chegadaSeg',s.chegada_seg,
      'ponto',case when p.entrega_destino_ate>now() then p.entrega_destino end,'pontoAte',p.entrega_destino_ate) order by s.ordem)
      from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id where s.viagem_id=v.id),'[]'))
$$;
revoke all on function public.viagem_entrega_json(public.entrega_viagens) from public,anon,authenticated;

create or replace function public.plano_entrega_json(v public.entrega_rotas_planos) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',v.id,'motoboyId',v.motoboy_id,'motoboyNome',m.nome,'validoAte',v.valido_ate,
    'segundos',v.dados->'segundos','metros',v.dados->'metros','ultimaEntregaSeg',v.dados->'ultimaEntregaSeg',
    'origem',v.dados->'origem','urgente',v.dados->'urgente','geometria',case when (v.dados->>'geometriaAte')::timestamptz>now() then v.dados->'geometria' end,
    'paradas',(select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'endereco',p.endereco,
      'ordem',n,'chegadaSeg',x->'chegadaSeg','ponto',case when p.entrega_destino_ate>now() then p.entrega_destino end) order by n)
      from jsonb_array_elements(v.dados->'paradas') with ordinality a(x,n) join public.pedidos p on p.id=(x->>'id')::uuid))
  from public.motoboys m where m.user_id=v.motoboy_id
$$;
revoke all on function public.plano_entrega_json(public.entrega_rotas_planos) from public,anon,authenticated;

-- Todos os caminhos de reserva usam a mesma ordem de travas: configuração, pedidos, motoboy, plano.
create or replace function public.reservar_plano_entregas(p_id uuid,p_autor uuid,p_motoboy uuid default null,p_automatica boolean default false) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; plano public.entrega_rotas_planos; pedido public.pedidos; alvo uuid;
  viagem uuid; moto_nome text; parada_entrada jsonb; snap jsonb; n integer:=0; atrib uuid; existente uuid;
begin
  select * into c from public.entrega_rotas_config where id=1 for update;
  select * into plano from public.entrega_rotas_planos where id=p_id;
  if not found then raise exception 'nao_encontrado'; end if;
  select id into existente from public.entrega_viagens where plano_id=p_id;
  if existente is not null then return existente; end if;
  if plano.estado<>'aberto' or plano.valido_ate<=now() or plano.config_versao<>c.versao or c.modo='desligado'
    or (p_automatica and c.modo<>'automatico') then raise exception 'plano_expirado'; end if;
  if plano.dados->'origem' is distinct from (select entrega_origem from public.loja where id=1) then raise exception 'plano_expirado'; end if;
  for pedido in select p.* from public.pedidos p join jsonb_array_elements(plano.dados->'paradas') s on p.id=(s->>'id')::uuid
    order by p.id for update of p loop
    select x into snap from jsonb_array_elements(plano.dados->'pedidos') x where x->>'id'=pedido.id::text;
    if pedido.status<>'pronto' or pedido.modo<>'entrega' or snap->>'versao' is distinct from md5(to_jsonb(pedido)::text)
      or (p_automatica and pedido.entrega_planejamento_pausado)
      or pedido.entrega_destino is null or pedido.entrega_destino_ate<=now()
      or exists(select 1 from public.entregas_operacao where pedido_id=pedido.id and (motoboy_id is not null or saiu_em is not null or encerramento is not null))
      or exists(select 1 from public.entrega_viagens_paradas where pedido_id=pedido.id and ativa) then raise exception 'pedido_alterado'; end if;
    n:=n+1;
  end loop;
  if n<1 or n<>jsonb_array_length(plano.dados->'paradas') or n>(c.regras->>'maxPedidos')::integer then raise exception 'pedido_alterado'; end if;
  alvo:=coalesce(p_motoboy,plano.motoboy_id);
  select nome into moto_nome from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if not coalesce((public.estado_entregador_rotas(alvo)->>'elegivel')::boolean,false) then raise exception 'entregador_indisponivel'; end if;
  select * into plano from public.entrega_rotas_planos where id=p_id for update;
  if plano.estado<>'aberto' or plano.valido_ate<=now() then raise exception 'plano_expirado'; end if;
  insert into public.entrega_viagens(plano_id,motoboy_id,motoboy_nome,criada_por,automatica,origem,regras,geometria,geometria_ate,segundos,metros,ultima_entrega_seg)
    values(plano.id,alvo,moto_nome,p_autor,p_automatica,plano.dados->'origem',c.regras,plano.dados->'geometria',
      (plano.dados->>'geometriaAte')::timestamptz,(plano.dados->>'segundos')::integer,(plano.dados->>'metros')::integer,
      (plano.dados->>'ultimaEntregaSeg')::integer) returning id into viagem;
  n:=0;
  for parada_entrada in select x from jsonb_array_elements(plano.dados->'paradas') x loop
    n:=n+1; atrib:=gen_random_uuid();
    update public.pedidos set entrega_planejamento_pausado=false where id=(parada_entrada->>'id')::uuid and entrega_planejamento_pausado;
    insert into public.entregas_operacao(pedido_id,atribuicao,motoboy_id,motoboy_nome,atribuido_por)
      values((parada_entrada->>'id')::uuid,atrib,alvo,moto_nome,p_autor) on conflict(pedido_id) do update set
      atribuicao=excluded.atribuicao,motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,atribuido_em=now(),atribuido_por=excluded.atribuido_por;
    insert into public.entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,chegada_seg)
      values(viagem,(parada_entrada->>'id')::uuid,n,atrib,(parada_entrada->>'chegadaSeg')::integer);
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values((parada_entrada->>'id')::uuid,p_autor,'atribuicao',
      jsonb_build_object('motoboy',alvo,'nome',moto_nome,'viagem',viagem,'origem',case when p_automatica then 'planejamento_automatico' else 'planejamento_equipe' end));
  end loop;
  update public.entrega_rotas_planos set estado='reservado',dados=dados-'pedidos'-'geometria' where id=p_id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo) values(viagem,alvo,p_autor,'reserva');
  return viagem;
end $$;
revoke all on function public.reservar_plano_entregas(uuid,uuid,uuid,boolean) from public,anon,authenticated;

create or replace function public.reservar_viagem_entrega(p_plano uuid,p_motoboy uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare id_viagem uuid;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  id_viagem:=public.reservar_plano_entregas(p_plano,auth.uid(),p_motoboy,false);
  return jsonb_build_object('ok',true,'id',id_viagem);
end $$;
revoke all on function public.reservar_viagem_entrega(uuid,uuid) from public,anon;
grant execute on function public.reservar_viagem_entrega(uuid,uuid) to authenticated;

create or replace function public.concluir_planejamento_entregas(p_execucao uuid,p_planos jsonb default '[]',
  p_impedidos jsonb default '[]',p_matriz jsonb default null,p_erro text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ex public.entrega_rotas_execucoes; c public.entrega_rotas_config; proposta jsonb; snapshots jsonb;
  plano uuid; viagem uuid; quantidade integer:=0; reservadas integer:=0; ate timestamptz; dados jsonb;
begin
  select * into ex from public.entrega_rotas_execucoes where id=p_execucao for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if ex.estado<>'calculando' then return jsonb_build_object('estado',ex.estado,'id',ex.id); end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_erro is not null then
    update public.entrega_rotas_execucoes set estado='erro',erro=left(p_erro,80),entrada=jsonb_build_object('configVersao',ex.entrada->'configVersao') where id=ex.id;
    return jsonb_build_object('estado','erro');
  end if;
  if ex.criado_em<now()-interval '2 minutes' or ex.entrada->>'configVersao' is distinct from c.versao::text then
    update public.entrega_rotas_execucoes set estado='erro',erro='plano_expirado',entrada='{}' where id=ex.id;
    return jsonb_build_object('estado','expirado');
  end if;
  if jsonb_typeof(p_planos)<>'array' or jsonb_array_length(p_planos)>12 or length(p_planos::text)>2000000
    or jsonb_typeof(p_impedidos)<>'array' then raise exception 'dados_invalidos'; end if;
  if (select count(*)<>count(distinct s->>'id') from jsonb_array_elements(p_planos) v cross join jsonb_array_elements(v->'paradas') s)
    or (select count(*)<>count(distinct v->>'motoboyId') from jsonb_array_elements(p_planos) v) then raise exception 'dados_invalidos'; end if;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  for proposta in select v from jsonb_array_elements(p_planos) v loop
    if jsonb_typeof(proposta->'paradas')<>'array' or jsonb_array_length(proposta->'paradas') not between 1 and (c.regras->>'maxPedidos')::integer
      or not exists(select 1 from jsonb_array_elements(ex.entrada->'entregadores') m where m->>'id'=proposta->>'motoboyId')
      or jsonb_typeof(proposta->'geometria')<>'object' or proposta->'geometria'->>'type'<>'MultiLineString'
      or (proposta->>'segundos')::numeric not between 0 and 86400 or (proposta->>'metros')::numeric not between 0 and 700000
      or (proposta->>'ultimaEntregaSeg')::numeric not between 0 and ((c.regras->>'trajetoMin')::numeric*60) then raise exception 'dados_invalidos'; end if;
    select jsonb_agg(s order by n),min((s->>'pontoAte')::timestamptz) into snapshots,ate
      from jsonb_array_elements(proposta->'paradas') with ordinality a(v,n)
      join jsonb_array_elements(ex.entrada->'pedidos') s on s->>'id'=v->>'id';
    if jsonb_array_length(snapshots) is distinct from jsonb_array_length(proposta->'paradas') or ate<=now() then raise exception 'pedido_alterado'; end if;
    dados:=proposta||jsonb_build_object('origem',ex.entrada->'origem','pedidos',snapshots,'geometriaAte',ate);
    insert into public.entrega_rotas_planos(execucao_id,motoboy_id,config_versao,valido_ate,dados)
      values(ex.id,(proposta->>'motoboyId')::uuid,c.versao,least(now()+interval '90 seconds',ate),dados) returning id into plano;
    quantidade:=quantidade+1;
    if ex.automatica and c.modo='automatico' then
      begin
        viagem:=public.reservar_plano_entregas(plano,null,null,true);
        reservadas:=reservadas+1;
      exception when others then
        -- Revalidação pode perder a corrida para a equipe. Não duplica nem desfaz outra atribuição.
        update public.entrega_rotas_planos set estado='vencido' where id=plano;
        insert into public.entrega_rotas_eventos(tipo,dados) values('reserva_descartada',jsonb_build_object('plano',plano,'codigo',sqlstate));
        p_impedidos:=p_impedidos||(select jsonb_agg(jsonb_build_object('id',s->>'id','motivo','revalidacao_falhou'))
          from jsonb_array_elements(proposta->'paradas') s);
      end;
    end if;
  end loop;
  if p_matriz is not null and ex.entrada->>'cacheChave' is not null and jsonb_typeof(p_matriz)='array' then
    select least(now()+interval '15 minutes',min((s->>'pontoAte')::timestamptz)) into ate from jsonb_array_elements(ex.entrada->'pedidos') s;
    insert into public.entrega_rotas_cache(chave,matriz,valido_ate) values(ex.entrada->>'cacheChave',p_matriz,ate)
      on conflict(chave) do update set matriz=excluded.matriz,valido_ate=excluded.valido_ate;
  end if;
  update public.entrega_rotas_execucoes set estado='concluida',impedidos=p_impedidos,
    entrada=jsonb_build_object('configVersao',ex.entrada->'configVersao','verificacao',ex.entrada->'verificacao',
      'quantidade',jsonb_array_length(ex.entrada->'pedidos')) where id=ex.id;
  return jsonb_build_object('estado','concluida','planos',quantidade,'reservadas',reservadas,'verificacao',ex.entrada->'verificacao');
end $$;
revoke all on function public.concluir_planejamento_entregas(uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.concluir_planejamento_entregas(uuid,jsonb,jsonb,jsonb,text) to service_role;

create or replace function public.reconhecer_carregamento_viagem(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found or v.motoboy_id is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if v.versao is distinct from p_versao or v.revisao_pendente then raise exception 'versao_alterada'; end if;
  if v.estado<>'reservada' then raise exception 'transicao_invalida'; end if;
  update public.entrega_viagens set carregada_versao=versao,carregada_em=now() where id=p_id;
  perform public.comunicar_entregador();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.reconhecer_carregamento_viagem(uuid,uuid) from public,anon;
grant execute on function public.reconhecer_carregamento_viagem(uuid,uuid) to authenticated;

create or replace function public.iniciar_viagem_entrega(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid; pedido_linha public.pedidos;
begin
  if not public.is_equipe() and not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  if not public.is_equipe() and alvo is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  perform 1 from public.motoboys where user_id=alvo and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado in ('em_rota','retornando','encerrada') then return jsonb_build_object('ok',true,'jaIniciada',true); end if;
  if v.estado<>'reservada' then raise exception 'transicao_invalida'; end if;
  if v.revisao_pendente then raise exception 'viagem_requer_revisao'; end if;
  if v.carregada_versao is distinct from v.versao then raise exception 'carregamento_pendente'; end if;
  if v.origem is distinct from (select entrega_origem from public.loja where id=1) then raise exception 'origem_alterada'; end if;
  if exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    join public.entregas_operacao e on e.pedido_id=p.id where s.viagem_id=v.id and
      (not s.ativa or p.status<>'pronto' or e.atribuicao<>s.atribuicao or e.motoboy_id is distinct from alvo or e.saiu_em is not null
        or p.entrega_destino is null or p.entrega_destino_ate<=now())) then raise exception 'pedido_alterado'; end if;
  for pedido_linha in select p.* from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=v.id order by p.id loop
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(jsonb_build_object(
      'status','rota','em',public.data_iso(now()),'autor',auth.uid(),'viagem',v.id)) where id=pedido_linha.id;
  end loop;
  update public.entrega_viagens set estado='em_rota',saiu_em=now() where id=v.id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo) values(v.id,alvo,auth.uid(),'saida');
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.iniciar_viagem_entrega(uuid,uuid) from public,anon;
grant execute on function public.iniciar_viagem_entrega(uuid,uuid) to authenticated;

create or replace function public.desfazer_viagem_entrega(p_id uuid,p_versao uuid,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if nullif(btrim(p_motivo),'') is null or length(p_motivo)>200 then raise exception 'motivo_obrigatorio'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  perform 1 from public.motoboys where user_id=alvo for update;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.estado='cancelada' then return jsonb_build_object('ok',true,'jaDesfeita',true); end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado<>'reservada' or v.saiu_em is not null then raise exception 'entrega_em_andamento'; end if;
  insert into public.entregas_eventos(pedido_id,autor,tipo,dados) select s.pedido_id,auth.uid(),'viagem_desfeita',
    jsonb_build_object('viagem',v.id,'motivo',btrim(p_motivo)) from public.entrega_viagens_paradas s where s.viagem_id=v.id;
  delete from public.entregas_operacao e using public.entrega_viagens_paradas s
    where s.viagem_id=v.id and e.pedido_id=s.pedido_id and e.saiu_em is null and e.encerramento is null;
  update public.pedidos p set entrega_planejamento_pausado=true from public.entrega_viagens_paradas s
    where s.viagem_id=v.id and p.id=s.pedido_id and p.status='pronto';
  update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
  update public.entrega_viagens set estado='cancelada',versao=gen_random_uuid(),encerrada_por=auth.uid(),motivo=btrim(p_motivo) where id=v.id;
  update public.entrega_rotas_planos set estado='desfeito' where id=v.plano_id;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(v.id,alvo,auth.uid(),'desfeita',jsonb_build_object('motivo',btrim(p_motivo)));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.desfazer_viagem_entrega(uuid,uuid,text) from public,anon;
grant execute on function public.desfazer_viagem_entrega(uuid,uuid,text) to authenticated;

create or replace function public.retornar_viagem_entrega(p_id uuid,p_versao uuid,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens; alvo uuid; cadastro_ativo boolean;
begin
  if not public.is_equipe() and not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select motoboy_id into alvo from public.entrega_viagens where id=p_id;
  if not public.is_equipe() and alvo is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if alvo is distinct from auth.uid() and (not public.is_equipe() or nullif(btrim(p_motivo),'') is null or length(p_motivo)>200) then raise exception 'motivo_obrigatorio'; end if;
  perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id where s.viagem_id=p_id order by p.id for update of p;
  select ativo into cadastro_ativo from public.motoboys where user_id=alvo for update;
  if not found or (not cadastro_ativo and not public.is_equipe()) then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if v.versao is distinct from p_versao then raise exception 'versao_alterada'; end if;
  if v.estado='encerrada' then return jsonb_build_object('ok',true,'jaRetornada',true); end if;
  if v.estado not in ('em_rota','retornando') then raise exception 'transicao_invalida'; end if;
  if exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    where s.viagem_id=v.id and p.status not in ('entregue','cancelado')) then raise exception 'entregas_pendentes'; end if;
  update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
  update public.entrega_viagens set estado='encerrada',retornou_em=now(),encerrada_por=auth.uid(),motivo=nullif(btrim(p_motivo),'') where id=v.id;
  insert into public.entregadores_disponibilidade(user_id,situacao,autor,motivo) values(alvo,case when cadastro_ativo then 'na_loja' else 'fora' end,auth.uid(),nullif(btrim(p_motivo),''))
    on conflict(user_id) do update set situacao=excluded.situacao,desde=now(),autor=excluded.autor,motivo=excluded.motivo;
  insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(v.id,alvo,auth.uid(),'retorno',jsonb_build_object('motivo',nullif(btrim(p_motivo),'')));
  if alvo=auth.uid() then perform public.comunicar_entregador(); end if;
  perform public.disparar_planejador_entregas();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.retornar_viagem_entrega(uuid,uuid,text) from public,anon;
grant execute on function public.retornar_viagem_entrega(uuid,uuid,text) to authenticated;

create or replace function public.acompanhar_parada_viagem() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens;
begin
  if new.status=old.status or new.status not in ('entregue','cancelado') then return new; end if;
  select v1.* into v from public.entrega_viagens v1 join public.entrega_viagens_paradas s on s.viagem_id=v1.id
    where s.pedido_id=new.id and s.ativa for update of v1;
  if not found then return new; end if;
  if v.estado='reservada' then
    update public.entrega_viagens set revisao_pendente=true,versao=gen_random_uuid(),carregada_versao=null where id=v.id;
    if not exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
      where s.viagem_id=v.id and p.status not in ('entregue','cancelado')) then
      update public.entrega_viagens set estado='cancelada',motivo='Pedidos encerrados antes da saída' where id=v.id;
      update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
    end if;
  elsif v.estado='em_rota' and not exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    where s.viagem_id=v.id and p.status not in ('entregue','cancelado')) then
    update public.entrega_viagens set estado='retornando' where id=v.id;
  end if;
  return new;
end $$;
revoke all on function public.acompanhar_parada_viagem() from public,anon,authenticated;
drop trigger if exists pedidos_viagens_paradas on public.pedidos;
create trigger pedidos_viagens_paradas after update of status on public.pedidos for each row execute function public.acompanhar_parada_viagem();

create or replace function public.painel_rotas_entregas() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  select jsonb_build_object('servidorEm',public.data_iso(now()),'config',public.rotas_config_json(),
    'entregadores',coalesce((select jsonb_agg(public.estado_entregador_rotas(user_id) order by nome) from public.motoboys),'[]'),
    'planos',coalesce((select jsonb_agg(public.plano_entrega_json(p) order by p.criado_em,p.id) from public.entrega_rotas_planos p
      where p.estado='aberto' and p.valido_ate>now()),'[]'),
    'viagens',coalesce((select jsonb_agg(public.viagem_entrega_json(v) order by v.criada_em) from public.entrega_viagens v
      where v.estado in ('reservada','em_rota','retornando')),'[]'),
    'prontos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'endereco',p.endereco,
      'prontoEm',(select max(x->>'em') from jsonb_array_elements(p.historico) x where x->>'status'='pronto'),
      'pausado',p.entrega_planejamento_pausado,
      'pontoValido',p.entrega_destino is not null and p.entrega_destino_ate>now()) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id where p.modo='entrega' and p.status='pronto'
      and p.origem<>'exemplo' and e.motoboy_id is null and e.encerramento is null and not exists(
        select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)),'[]'),
    'ultimaExecucao',(select jsonb_build_object('estado',e.estado,'em',e.criado_em,'erro',e.erro,'impedidos',e.impedidos,
      'verificacao',e.entrada->'verificacao') from public.entrega_rotas_execucoes e order by e.criado_em desc limit 1),
    'creditosEstimadosHoje',(select coalesce(sum(creditos_reservados),0) from public.entrega_rotas_execucoes where criado_em>=
      (public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo')) into r;
  return r;
end $$;
revoke all on function public.painel_rotas_entregas() from public,anon;
grant execute on function public.painel_rotas_entregas() to authenticated;

create or replace function public.minha_operacao_rotas() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return jsonb_build_object('servidorEm',public.data_iso(now()),'entregador',public.estado_entregador_rotas(auth.uid()),
    'modo',(select modo from public.entrega_rotas_config where id=1),
    'viagem',(select public.viagem_entrega_json(v) from public.entrega_viagens v where motoboy_id=auth.uid() and estado in ('reservada','em_rota','retornando')));
end $$;
revoke all on function public.minha_operacao_rotas() from public,anon;
grant execute on function public.minha_operacao_rotas() to authenticated;

create or replace function public.minhas_entregas() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return coalesce((select jsonb_agg(public.entrega_json(p)||jsonb_build_object(
    'atribuicao',e.atribuicao,'atribuidoEm',public.data_iso(e.atribuido_em),
    'viagemId',s.viagem_id,'ordemViagem',s.ordem,'versaoViagem',v.versao) order by v.criada_em nulls last,s.ordem,e.atribuido_em)
    from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
      left join public.entrega_viagens_paradas s on s.pedido_id=p.id and s.ativa
      left join public.entrega_viagens v on v.id=s.viagem_id
    where e.motoboy_id=auth.uid() and e.encerramento is null and p.status in ('preparo','pronto','rota')),'[]');
end $$;

-- Fluxo novo permite registrar a prontidão. Saída individual antiga continua como recuperação operacional;
-- pedidos reservados em viagem saem somente pela operação atômica da viagem.
create or replace function public.mudar_status(p_id uuid,p_status text,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos; motivo text:=public.aparar(coalesce(p_motivo,'')); ok boolean; evento jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  if p_id is null or p_status is null or p_status not in ('novo','preparo','pronto','rota','entregue','cancelado') or length(motivo)>200 then
    raise exception 'dados_invalidos' using errcode='P0001'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  if p_status in ('rota','entregue') and exists(select 1 from public.entrega_viagens_paradas where pedido_id=p_id and ativa) then
    raise exception 'pedido_em_viagem'; end if;
  if p.origem='exemplo' then ok:=true;
  else ok:=case when p_status='cancelado' then p.status in ('novo','preparo','pronto','rota')
    when p.status='novo' then p_status='preparo'
    when p.status='preparo' then p_status='pronto' or (p.modo='entrega' and p_status='rota')
    when p.status='pronto' then p_status=case when p.modo='entrega' then 'rota' else 'entregue' end
    when p.status='rota' then p_status='entregue' else false end; end if;
  if not ok then raise exception 'transicao_invalida' using errcode='P0001'; end if;
  if p_status='cancelado' and motivo='' and p.origem<>'exemplo' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
  evento:=jsonb_build_object('status',p_status,'em',public.data_iso(now()));
  if motivo<>'' then evento:=evento||jsonb_build_object('motivo',motivo); end if;
  update public.pedidos set status=p_status,historico=historico||jsonb_build_array(evento) where id=p_id returning * into p;
  if p_status='pronto' and p.modo='entrega' then perform public.disparar_planejador_entregas(); end if;
  return public.pedido_json(p);
end $$;
revoke all on function public.mudar_status(uuid,text,text) from public,anon;
grant execute on function public.mudar_status(uuid,text,text) to authenticated;

create or replace function public.atribuir_entrega(p_id uuid,p_motoboy uuid,p_sair boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos; e public.entregas_operacao; n text;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('preparo','pronto','rota') then raise exception 'transicao_invalida'; end if;
  select nome into n from public.motoboys where user_id=p_motoboy and ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  if exists(select 1 from public.entrega_viagens_paradas where pedido_id=p_id and ativa) then raise exception 'pedido_em_viagem'; end if;
  if exists(select 1 from public.entrega_viagens where motoboy_id=p_motoboy and estado in ('reservada','em_rota','retornando')) then raise exception 'entregador_em_viagem'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id;
  if e.encerramento is not null then raise exception 'transicao_invalida'; end if;
  if e.motoboy_id is distinct from p_motoboy and e.saiu_em is not null then raise exception 'entrega_em_andamento'; end if;
  if e.pedido_id is null or e.motoboy_id is distinct from p_motoboy then
    insert into public.entregas_operacao(pedido_id,motoboy_id,motoboy_nome,atribuido_por,saiu_em)
      values(p_id,p_motoboy,n,auth.uid(),case when p.status='rota' then coalesce((public.entrega_json(p)->>'saiuEm')::timestamptz,now()) end)
      on conflict(pedido_id) do update set motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,
        atribuicao=gen_random_uuid(),atribuido_em=now(),atribuido_por=auth.uid();
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values(p_id,auth.uid(),'atribuicao',jsonb_build_object('motoboy',p_motoboy,'nome',n));
  end if;
  if coalesce(p_sair,false) and p.status<>'rota' then
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(jsonb_build_object('status','rota','em',public.data_iso(now()),'autor',auth.uid())) where id=p_id;
  end if;
  update public.pedidos set entrega_planejamento_pausado=false where id=p_id and entrega_planejamento_pausado;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.atribuir_entrega(uuid,uuid,boolean) from public,anon;
grant execute on function public.atribuir_entrega(uuid,uuid,boolean) to authenticated;

create or replace function public.liberar_planejamento_pedidos(p_ids jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pedido_linha public.pedidos; n integer:=0;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids) not between 1 and 12
    or (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_ids) x) then raise exception 'dados_invalidos'; end if;
  for pedido_linha in select p.* from public.pedidos p join jsonb_array_elements_text(p_ids) x on p.id=x::uuid order by p.id for update of p loop
    if pedido_linha.status<>'pronto' or pedido_linha.modo<>'entrega' or exists(select 1 from public.entrega_viagens_paradas where pedido_id=pedido_linha.id and ativa) then raise exception 'pedido_alterado'; end if;
    n:=n+1;
    update public.pedidos set entrega_planejamento_pausado=false where id=pedido_linha.id;
    insert into public.entregas_eventos(pedido_id,autor,tipo) values(pedido_linha.id,auth.uid(),'planejamento_liberado');
  end loop;
  if n<>jsonb_array_length(p_ids) then raise exception 'dados_invalidos'; end if;
  perform public.disparar_planejador_entregas();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.liberar_planejamento_pedidos(jsonb) from public,anon;
grant execute on function public.liberar_planejamento_pedidos(jsonb) to authenticated;

create or replace function public.conferir_destino_pedido(p_id uuid,p_lat double precision,p_lon double precision,p_motivo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_lat is null or p_lon is null or not (p_lat between -34 and 6) or not (p_lon between -74 and -34) then raise exception 'dados_invalidos'; end if;
  if nullif(btrim(p_motivo),'') is null or length(p_motivo)>200 then raise exception 'motivo_obrigatorio'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('preparo','pronto') or exists(select 1 from public.entregas_operacao where pedido_id=p_id and saiu_em is not null)
    or exists(select 1 from public.entrega_viagens_paradas where pedido_id=p_id and ativa) then raise exception 'pedido_em_viagem'; end if;
  update public.pedidos set entrega_destino=jsonb_build_object('lat',p_lat,'lon',p_lon,'fonte','equipe','confirmado',true),
    entrega_destino_ate=now()+interval '30 days' where id=p_id;
  insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values(p_id,auth.uid(),'destino_conferido',jsonb_build_object('motivo',btrim(p_motivo)));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.conferir_destino_pedido(uuid,double precision,double precision,text) from public,anon;
grant execute on function public.conferir_destino_pedido(uuid,double precision,double precision,text) to authenticated;

-- Uma chamada de cron com capacidade limitada, sem guardar service_role no banco.
create or replace function public.disparar_planejador_entregas(p_verificar boolean default false) returns bigint
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; requisicao bigint;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if c.job_url is null or (c.modo<>'automatico' and not p_verificar)
    or c.job_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/planejar-entregas$'
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  select net.http_post(url:=c.job_url,body:=jsonb_build_object('tokenJob',c.job_token,'acao',case when p_verificar then 'verificar' else 'automatico' end),
    headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=90000) into requisicao;
  return requisicao;
end $$;
revoke all on function public.disparar_planejador_entregas(boolean) from public,anon,authenticated;

create or replace function public.limpar_planejamento_entregas() returns void
language plpgsql security invoker set search_path='' as $$
begin
  delete from public.entrega_rotas_cache where valido_ate<=now();
  update public.entrega_viagens set geometria=null,geometria_ate=null where geometria_ate<=now() and geometria is not null;
  update public.entrega_rotas_planos set estado=case when estado='aberto' then 'vencido' else estado end,
    dados=dados-'pedidos'-'geometria' where valido_ate<=now() and (dados ? 'pedidos' or dados ? 'geometria');
  update public.entrega_rotas_execucoes set estado='erro',erro='execucao_interrompida',entrada='{}'
    where estado='calculando' and criado_em<now()-interval '2 minutes';
  delete from public.entrega_rotas_execucoes where criado_em<now()-interval '7 days';
end $$;
revoke all on function public.limpar_planejamento_entregas() from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('mineiro-planejar-entregas','* * * * *','select public.disparar_planejador_entregas();');
    perform cron.schedule('mineiro-limpar-planejamento','25 * * * *','select public.limpar_planejamento_entregas();');
    update public.entrega_rotas_config set cron_ativo=true where id=1;
  end if;
end $$;

create index if not exists entrega_rotas_config_autor on public.entrega_rotas_config(alterado_por);
create index if not exists entregadores_disponibilidade_autor on public.entregadores_disponibilidade(autor);
create index if not exists entrega_rotas_execucoes_autor on public.entrega_rotas_execucoes(autor);
create index if not exists entrega_rotas_planos_motoboy on public.entrega_rotas_planos(motoboy_id);
create index if not exists entrega_viagens_motoboy on public.entrega_viagens(motoboy_id);
create index if not exists entrega_viagens_criada_por on public.entrega_viagens(criada_por);
create index if not exists entrega_viagens_encerrada_por on public.entrega_viagens(encerrada_por);
create index if not exists entrega_viagens_paradas_pedido on public.entrega_viagens_paradas(pedido_id);
create index if not exists entrega_rotas_eventos_autor on public.entrega_rotas_eventos(autor);
notify pgrst,'reload schema';
