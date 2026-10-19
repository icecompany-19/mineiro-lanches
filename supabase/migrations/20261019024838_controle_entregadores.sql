-- Controle operacional. Pedidos antigos permanecem intactos; atribuições e auditoria são aditivas.
create table if not exists public.entregas_operacao (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  atribuicao uuid not null default gen_random_uuid(),
  motoboy_id uuid references auth.users(id) on delete set null,
  motoboy_nome text not null,
  atribuido_em timestamptz not null default now(),
  atribuido_por uuid references auth.users(id) on delete set null,
  saiu_em timestamptz,
  confirmado_em timestamptz,
  recebido_em timestamptz,
  encerrado_por uuid references auth.users(id) on delete set null,
  encerramento text check (encerramento in ('motoboy','manual','cancelado')),
  motivo text,
  horario_inconsistente boolean not null default false
);
create index if not exists entregas_operacao_motoboy on public.entregas_operacao(motoboy_id, recebido_em);
create index if not exists entregas_operacao_atribuido_por on public.entregas_operacao(atribuido_por);
create index if not exists entregas_operacao_encerrado_por on public.entregas_operacao(encerrado_por);
create table if not exists public.entregas_eventos (
  evento_id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  autor uuid references auth.users(id) on delete set null,
  tipo text not null,
  recebido_em timestamptz not null default now(),
  dados jsonb not null default '{}'
);
create index if not exists entregas_eventos_pedido on public.entregas_eventos(pedido_id, recebido_em);
create index if not exists entregas_eventos_autor on public.entregas_eventos(autor);
create table if not exists public.entregadores_comunicacao (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ultima_em timestamptz not null default now()
);
alter table public.entregas_operacao enable row level security;
alter table public.entregas_eventos enable row level security;
alter table public.entregadores_comunicacao enable row level security;
-- Só RPCs autorizadas acessam essas tabelas; o motoboy nunca ganha acesso ao painel.
revoke all on public.entregas_operacao, public.entregas_eventos, public.entregadores_comunicacao from public, anon, authenticated;

create or replace function public.comunicar_entregador() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  insert into public.entregadores_comunicacao(user_id) values(auth.uid())
  on conflict(user_id) do update set ultima_em=now();
  return jsonb_build_object('em',public.data_iso(now()));
end $$;

create or replace function public.atribuir_entrega(p_id uuid, p_motoboy uuid, p_sair boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao; n text;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('preparo','pronto','rota') then raise exception 'transicao_invalida'; end if;
  select nome into n from public.motoboys where user_id=p_motoboy and ativo;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id;
  if e.encerramento is not null then raise exception 'transicao_invalida'; end if;
  -- Reatribuição só antes da saída: evita trocar de motoboy enquanto há uma confirmação offline.
  if e.motoboy_id is distinct from p_motoboy and e.saiu_em is not null then raise exception 'entrega_em_andamento'; end if;
  if e.pedido_id is null or e.motoboy_id is distinct from p_motoboy then
    insert into public.entregas_operacao(pedido_id,motoboy_id,motoboy_nome,atribuido_por,saiu_em)
    values(p_id,p_motoboy,n,auth.uid(),case when p.status='rota' then
      coalesce((public.entrega_json(p)->>'saiuEm')::timestamptz,now()) end)
    on conflict(pedido_id) do update set motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,
      atribuicao=gen_random_uuid(),atribuido_em=now(),atribuido_por=auth.uid();
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados)
    values(p_id,auth.uid(),'atribuicao',jsonb_build_object('motoboy',p_motoboy,'nome',n));
  end if;
  if coalesce(p_sair,false) and p.status<>'rota' then
    update public.pedidos set status='rota',historico=historico||jsonb_build_array(
      jsonb_build_object('status','rota','em',public.data_iso(now()),'autor',auth.uid())) where id=p_id;
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- Todas as formas de alterar um pedido (quadro, cancelamento e RPC do entregador) mantêm o controle em acordo.
create or replace function public.acompanhar_entrega_operacao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.entregas_operacao; h jsonb; m text; tipo text;
begin
  if new.status=old.status then return new; end if;
  select * into e from public.entregas_operacao where pedido_id=new.id for update;
  h:=new.historico->-1;
  if not found then
    if new.modo='entrega' and new.status='entregue' and new.origem<>'exemplo' then
      m:=nullif(btrim(h->>'motivo'),'');
      if m is null or length(m)>200 then raise exception 'motivo_obrigatorio'; end if;
      insert into public.entregas_eventos(pedido_id,autor,tipo,dados)
      values(new.id,auth.uid(),'manual',jsonb_build_object('motivo',m));
    end if;
    return new;
  end if;
  if new.status='rota' then
    update public.entregas_operacao set saiu_em=coalesce(saiu_em,now()) where pedido_id=new.id;
    insert into public.entregas_eventos(pedido_id,autor,tipo) values(new.id,auth.uid(),'saida');
  elsif new.status in ('entregue','cancelado') then
    tipo:=case when new.status='cancelado' then 'cancelado' when h->>'por'='motoboy' then 'motoboy' else 'manual' end;
    m:=nullif(btrim(h->>'motivo'),'');
    if tipo='manual' and (m is null or length(m)>200) then raise exception 'motivo_obrigatorio'; end if;
    update public.entregas_operacao set recebido_em=now(),encerrado_por=auth.uid(),encerramento=tipo,motivo=m
    where pedido_id=new.id;
    insert into public.entregas_eventos(pedido_id,autor,tipo,dados)
    values(new.id,auth.uid(),tipo,jsonb_build_object('motivo',m));
  end if;
  return new;
end $$;
drop trigger if exists pedidos_entregas_operacao on public.pedidos;
create trigger pedidos_entregas_operacao after update of status on public.pedidos
for each row execute function public.acompanhar_entrega_operacao();

create or replace function public.minhas_entregas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return coalesce((select jsonb_agg(public.entrega_json(p)||jsonb_build_object(
    'atribuicao',e.atribuicao,'atribuidoEm',public.data_iso(e.atribuido_em)) order by e.atribuido_em)
    from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
    where e.motoboy_id=auth.uid() and e.encerramento is null and p.status in ('preparo','pronto','rota')), '[]');
end $$;

create or replace function public.confirmar_entrega_offline(p_id uuid,p_evento uuid,p_atribuicao uuid,p_confirmado_em timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao; anterior public.entregas_eventos; inconsistente boolean;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_id is null or p_evento is null or p_confirmado_em is null then raise exception 'dados_invalidos'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id for update;
  if e.pedido_id is null or e.motoboy_id is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if e.atribuicao is distinct from p_atribuicao then raise exception 'atribuicao_alterada'; end if;
  select * into anterior from public.entregas_eventos where evento_id=p_evento;
  if found and (anterior.pedido_id<>p_id or anterior.autor is distinct from auth.uid()) then raise exception 'dados_invalidos'; end if;
  perform public.comunicar_entregador();
  if p.status='cancelado' then raise exception 'pedido_cancelado'; end if;
  if p.status='entregue' then
    insert into public.entregas_eventos(evento_id,pedido_id,autor,tipo,dados)
    values(p_evento,p_id,auth.uid(),'confirmacao_posterior',jsonb_build_object('confirmadoEm',p_confirmado_em))
    on conflict(evento_id) do nothing;
    return jsonb_build_object('ok',true,'jaEntregue',true,'pedido',jsonb_build_object('id',p.id,'numero',p.numero,'status',p.status));
  end if;
  if p.status<>'rota' or e.saiu_em is null then raise exception 'entrega_nao_iniciada'; end if;
  inconsistente:=p_confirmado_em<e.saiu_em or p_confirmado_em>now()+interval '5 minutes';
  update public.entregas_operacao set confirmado_em=p_confirmado_em,horario_inconsistente=inconsistente where pedido_id=p_id;
  update public.pedidos set status='entregue',historico=historico||jsonb_build_array(jsonb_build_object(
    'status','entregue','em',public.data_iso(now()),'por','motoboy','autor',auth.uid(),
    'confirmadoEm',public.data_iso(p_confirmado_em),'evento',p_evento)) where id=p_id returning * into p;
  insert into public.entregas_eventos(evento_id,pedido_id,autor,tipo,dados)
  values(p_evento,p_id,auth.uid(),'confirmacao',jsonb_build_object('confirmadoEm',p_confirmado_em,'horarioInconsistente',inconsistente));
  return jsonb_build_object('ok',true,'jaEntregue',false,'pedido',public.entrega_json(p));
end $$;

create or replace function public.consultar_entrega_motoboy(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id and motoboy_id=auth.uid();
  if not found then raise exception 'nao_atribuido'; end if;
  select * into p from public.pedidos where id=p_id;
  if p.status='cancelado' then raise exception 'pedido_cancelado'; end if;
  if p.status='entregue' then
    return jsonb_build_object('id',p.id,'numero',p.numero,'status',p.status,'atribuicao',e.atribuicao);
  end if;
  return public.entrega_json(p)||jsonb_build_object('atribuicao',e.atribuicao);
end $$;

-- Um cancelamento encontrado no retorno exige conferência explícita e fica auditado; nunca vira entrega.
create or replace function public.reconhecer_cancelamento_entrega(p_id uuid,p_evento uuid,p_atribuicao uuid,p_confirmado_em timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; e public.entregas_operacao; anterior public.entregas_eventos;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_evento is null or p_confirmado_em is null then raise exception 'dados_invalidos'; end if;
  select * into p from public.pedidos where id=p_id for update;
  select * into e from public.entregas_operacao where pedido_id=p_id for update;
  if e.motoboy_id is distinct from auth.uid() or e.atribuicao is distinct from p_atribuicao then raise exception 'nao_atribuido'; end if;
  if p.status is distinct from 'cancelado' then raise exception 'transicao_invalida'; end if;
  select * into anterior from public.entregas_eventos where evento_id=p_evento;
  if found and (anterior.pedido_id<>p_id or anterior.autor is distinct from auth.uid()) then raise exception 'dados_invalidos'; end if;
  insert into public.entregas_eventos(evento_id,pedido_id,autor,tipo,dados)
  values(p_evento,p_id,auth.uid(),'cancelamento_conferido',jsonb_build_object('confirmadoEm',p_confirmado_em))
  on conflict(evento_id) do nothing;
  return jsonb_build_object('ok',true,'ocorrencia',true,'evento',p_evento);
end $$;

create or replace function public.baixar_entrega_manual(p_id uuid,p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if nullif(btrim(p_motivo),'') is null or length(btrim(p_motivo))>200 then raise exception 'motivo_obrigatorio'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado'; end if;
  if p.modo<>'entrega' or p.status not in ('rota','entregue') then raise exception 'transicao_invalida'; end if;
  if p.status='entregue' then return jsonb_build_object('ok',true,'jaEntregue',true); end if;
  -- Também cobre pedidos antigos ainda sem atribuição, conservando o responsável e o motivo no histórico.
  update public.pedidos set status='entregue',historico=historico||jsonb_build_array(jsonb_build_object(
    'status','entregue','em',public.data_iso(now()),'por','equipe','autor',auth.uid(),'motivo',btrim(p_motivo))) where id=p_id;
  return jsonb_build_object('ok',true);
end $$;

-- Fechar a porta antiga para pedidos de outros entregadores, mantendo a resposta e a URL das comandas.
create or replace function public.confirmar_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.entregas_operacao;
begin
  if public.is_equipe() and not public.is_motoboy() then raise exception 'motivo_obrigatorio'; end if;
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into e from public.entregas_operacao where pedido_id=p_id;
  return public.confirmar_entrega_offline(p_id,gen_random_uuid(),e.atribuicao,now());
end $$;
create or replace function public.entregas_em_rota() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin return public.minhas_entregas(); end $$;

create or replace function public.painel_entregadores(p_dias integer default 1) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare inicio timestamptz; r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select jsonb_build_object('servidorEm',public.data_iso(now()),'inicio',public.data_iso(inicio),
    'entregadores',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'ultimaEm',c.ultima_em) order by m.nome)
      from public.motoboys m left join public.entregadores_comunicacao c on c.user_id=m.user_id),'[]'),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'status',p.status,
      'motoboyId',e.motoboy_id,'motoboyNome',e.motoboy_nome,'atribuicao',e.atribuicao,'atribuidoEm',e.atribuido_em,
      'saiuEm',coalesce(e.saiu_em,(public.entrega_json(p)->>'saiuEm')::timestamptz),
      'confirmadoEm',e.confirmado_em,'recebidoEm',coalesce(e.recebido_em,f.recebido_em),
      'encerramento',coalesce(e.encerramento,case when f.evento_id is not null then 'manual' end),
      'responsavel',coalesce(e.encerrado_por,f.autor),'motivo',coalesce(e.motivo,f.dados->>'motivo'),
      'horarioInconsistente',e.horario_inconsistente) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      left join lateral (select x.* from public.entregas_eventos x where x.pedido_id=p.id and x.tipo='manual'
        and e.pedido_id is null order by x.recebido_em desc limit 1) f on true
      where p.modo='entrega' and p.origem<>'exemplo' and (p.status in ('preparo','pronto','rota') or coalesce(e.recebido_em,f.recebido_em)>=inicio)), '[]')) into r;
  return r;
end $$;

create or replace function public.historico_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tipo',e.tipo,'em',e.recebido_em,
    'responsavel',coalesce(u.nome,e.autor::text,'Usuário removido'),'dados',e.dados) order by e.recebido_em,e.evento_id)
    from public.entregas_eventos e left join public.usuarios_painel u on u.user_id=e.autor where e.pedido_id=p_id),'[]');
end $$;

revoke all on function public.comunicar_entregador(),public.atribuir_entrega(uuid,uuid,boolean),
  public.acompanhar_entrega_operacao(),public.minhas_entregas(),public.confirmar_entrega_offline(uuid,uuid,uuid,timestamptz),
  public.baixar_entrega_manual(uuid,text),public.painel_entregadores(integer),public.historico_entrega(uuid),
  public.confirmar_entrega(uuid),public.entregas_em_rota(),public.consultar_entrega_motoboy(uuid),
  public.reconhecer_cancelamento_entrega(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.comunicar_entregador(),public.atribuir_entrega(uuid,uuid,boolean),
  public.minhas_entregas(),public.confirmar_entrega_offline(uuid,uuid,uuid,timestamptz),
  public.baixar_entrega_manual(uuid,text),public.painel_entregadores(integer),public.historico_entrega(uuid),
  public.confirmar_entrega(uuid),public.entregas_em_rota(),public.consultar_entrega_motoboy(uuid),
  public.reconhecer_cancelamento_entrega(uuid,uuid,uuid,timestamptz) to authenticated;
notify pgrst, 'reload schema';
