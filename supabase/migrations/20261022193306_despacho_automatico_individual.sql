-- Despacho individual sem mapas no mesmo ciclo de viagens. Instala desligado.
-- Não altera preços, pagamentos, taxas, pedidos históricos ou presença dos usuários.
alter table public.entrega_rotas_config
  add column if not exists despacho_individual_ativo boolean not null default false,
  add column if not exists despacho_ativado_em timestamptz,
  add column if not exists janela_agrupamento_seg integer not null default 0 check(janela_agrupamento_seg between 0 and 120),
  add column if not exists prazo_reserva_seg integer not null default 300 check(prazo_reserva_seg between 60 and 1800);
alter table public.entrega_viagens
  add column if not exists tipo_despacho text not null default 'rotas' check(tipo_despacho in ('rotas','individual')),
  add column if not exists reserva_ate timestamptz,
  alter column segundos drop not null,
  alter column metros drop not null,
  alter column ultima_entrega_seg drop not null;
alter table public.entrega_viagens_paradas alter column chegada_seg drop not null;
alter table public.entrega_viagens drop constraint if exists entrega_viagens_metricas_por_tipo;
alter table public.entrega_viagens add constraint entrega_viagens_metricas_por_tipo check (
  (tipo_despacho='rotas' and segundos is not null and metros is not null and ultima_entrega_seg is not null)
  or (tipo_despacho='individual' and segundos is null and metros is null and ultima_entrega_seg is null and geometria is null and reserva_ate is not null));
create index if not exists entrega_viagens_reserva_prazo on public.entrega_viagens(reserva_ate)
  where tipo_despacho='individual' and estado='reservada';

create or replace function public.rotas_config_json() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('modo',c.modo,'despachoIndividualAtivo',c.despacho_individual_ativo,'despachoAtivadoEm',c.despacho_ativado_em,
    'janelaAgrupamentoSeg',c.janela_agrupamento_seg,'prazoReservaSeg',c.prazo_reserva_seg,'regras',c.regras,'versao',c.versao,'limiteCreditosDia',c.limite_creditos_dia,
    'automacaoDisponivel',c.cron_ativo and c.job_url is not null,'origemConfirmada',l.entrega_origem ? 'confirmadaEm',
    'origem',l.entrega_origem,'configurada',public.rotas_regras_validas(c.regras))
  from public.entrega_rotas_config c cross join public.loja l where c.id=1 and l.id=1
$$;
revoke all on function public.rotas_config_json() from public,anon,authenticated;

create or replace function public.estado_entregador_rotas(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,'declarado',coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) and (not cfg.despacho_individual_ativo or d.desde>=cfg.despacho_ativado_em) then d.situacao end,'fora'),
    'disponivelDesde',d.desde,'ultimaEm',c.ultima_em,'viagemId',v.id,
    'qtdAbertas',(select count(*) from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),
    'situacao',case when v.id is not null then v.estado else coalesce(case when public.dia_operacional(d.desde)=public.dia_operacional(now()) and (not cfg.despacho_individual_ativo or d.desde>=cfg.despacho_ativado_em) then d.situacao end,'fora') end,
    'elegivel',coalesce(m.ativo and d.situacao='na_loja' and public.dia_operacional(d.desde)=public.dia_operacional(now()) and (not cfg.despacho_individual_ativo or d.desde>=cfg.despacho_ativado_em) and (cfg.despacho_individual_ativo or c.ultima_em>=now()-interval '2 minutes') and v.id is null and not exists(
      select 1 from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
      where e.motoboy_id=m.user_id and e.encerramento is null and p.status in ('preparo','pronto','rota')),false))
  from public.motoboys m cross join public.entrega_rotas_config cfg left join public.entregadores_disponibilidade d on d.user_id=m.user_id
    left join public.entregadores_comunicacao c on c.user_id=m.user_id
    left join public.entrega_viagens v on v.motoboy_id=m.user_id and v.estado in ('reservada','em_rota','retornando')
  where m.user_id=p_id and cfg.id=1
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
  if anterior.situacao is distinct from p_situacao or public.dia_operacional(anterior.desde) is distinct from public.dia_operacional(now())
    or exists(select 1 from public.entrega_rotas_config where id=1 and despacho_individual_ativo and (anterior.desde is null or anterior.desde<despacho_ativado_em)) then
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

create or replace function public.configurar_despacho_entregas(p_ativo boolean,p_versao uuid,
  p_janela_agrupamento_seg integer default 0,p_prazo_reserva_seg integer default 300) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_ativo is null or p_janela_agrupamento_seg is null or p_janela_agrupamento_seg not between 0 and 120
    or p_prazo_reserva_seg is null or p_prazo_reserva_seg not between 60 and 1800 then raise exception 'dados_invalidos'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_versao is distinct from c.versao then raise exception 'versao_alterada'; end if;
  if p_ativo and (not c.cron_ativo or c.job_url is null
    or c.job_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/planejar-entregas$') then raise exception 'automacao_indisponivel'; end if;
  update public.entrega_rotas_config set despacho_individual_ativo=p_ativo,
    despacho_ativado_em=case when p_ativo and not c.despacho_individual_ativo then now() else despacho_ativado_em end,
    modo=case when p_ativo then 'desligado' else modo end,
    janela_agrupamento_seg=p_janela_agrupamento_seg,prazo_reserva_seg=p_prazo_reserva_seg,
    versao=gen_random_uuid(),alterado_em=now(),alterado_por=auth.uid() where id=1;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  insert into public.entrega_rotas_eventos(autor,tipo,dados) values(auth.uid(),'configuracao_despacho',
    jsonb_build_object('ativo',p_ativo,'janelaAgrupamentoSeg',p_janela_agrupamento_seg,'prazoReservaSeg',p_prazo_reserva_seg));
  perform public.disparar_planejador_entregas();
  return public.rotas_config_json();
end $$;
revoke all on function public.configurar_despacho_entregas(boolean,uuid,integer,integer) from public,anon;
grant execute on function public.configurar_despacho_entregas(boolean,uuid,integer,integer) to authenticated;

-- Executado apenas no job assíncrono. A ordem de travas acompanha reserva/saída:
-- configuração, pedidos em ordem, cadastro do motoboy, viagem.
create or replace function public.processar_despacho_individual() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; v public.entrega_viagens; candidato public.pedidos;
  alvo uuid; nome text; viagem uuid; atrib uuid; reservadas integer:=0; expiradas integer:=0; inicio timestamptz;
begin
  select * into c from public.entrega_rotas_config where id=1 for update;
  for v in select * from public.entrega_viagens where tipo_despacho='individual' and estado='reservada'
    and reserva_ate<=now() order by id loop
    perform 1 from public.pedidos p join public.entrega_viagens_paradas s on s.pedido_id=p.id
      where s.viagem_id=v.id order by p.id for update of p;
    perform 1 from public.motoboys where user_id=v.motoboy_id for update;
    select * into v from public.entrega_viagens where id=v.id for update;
    if v.estado<>'reservada' or v.saiu_em is not null or v.reserva_ate>now() then continue; end if;
    if exists(select 1 from public.entrega_viagens_paradas s join public.entregas_operacao e on e.pedido_id=s.pedido_id
      where s.viagem_id=v.id and (e.saiu_em is not null or e.atribuicao<>s.atribuicao)) then continue; end if;
    insert into public.entregas_eventos(pedido_id,tipo,dados)
      select s.pedido_id,'reserva_expirada',jsonb_build_object('viagem',v.id,'motoboy',v.motoboy_id)
      from public.entrega_viagens_paradas s where s.viagem_id=v.id;
    delete from public.entregas_operacao e using public.entrega_viagens_paradas s
      where s.viagem_id=v.id and e.pedido_id=s.pedido_id and e.atribuicao=s.atribuicao
      and e.saiu_em is null and e.encerramento is null;
    update public.entrega_viagens_paradas set ativa=false where viagem_id=v.id;
    update public.entrega_viagens set estado='cancelada',versao=gen_random_uuid(),carregada_versao=null,
      motivo='Reserva expirou antes da saída' where id=v.id;
    if v.motoboy_id is not null then
      insert into public.entregadores_disponibilidade(user_id,situacao,motivo)
        values(v.motoboy_id,'pausado','Reserva expirou antes da saída; confirme disponibilidade novamente')
        on conflict(user_id) do update set situacao='pausado',desde=now(),autor=null,motivo=excluded.motivo;
    end if;
    insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,tipo,dados)
      values(v.id,v.motoboy_id,'reserva_expirada',jsonb_build_object('carregada',v.carregada_versao is not null,'pausaEntregador',v.motoboy_id is not null));
    expiradas:=expiradas+1;
  end loop;
  if c.despacho_individual_ativo then
    inicio:=(public.dia_operacional(now())::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
    for candidato in select p.* from public.pedidos p
      left join public.entregas_operacao e on e.pedido_id=p.id
      cross join lateral (select max((h->>'em')::timestamptz) pronto from jsonb_array_elements(p.historico) h where h->>'status'='pronto') h
      where p.modo='entrega' and p.status='pronto' and p.origem<>'exemplo' and h.pronto is not null
        and not p.entrega_planejamento_pausado and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
        and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      order by h.pronto,p.id limit 12 for update of p skip locked loop
      -- O cursor conserva seu snapshot. Releia o vínculo depois de obter a trava:
      -- uma atribuição manual de um pedido ainda não visitado pode ter ocorrido.
      if not exists(select 1 from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
        where p.id=candidato.id and p.status='pronto' and p.modo='entrega' and not p.entrega_planejamento_pausado
          and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
          and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)) then continue; end if;
      select m.user_id,m.nome into alvo,nome from public.motoboys m
        join public.entregadores_disponibilidade d on d.user_id=m.user_id
        where coalesce((public.estado_entregador_rotas(m.user_id)->>'elegivel')::boolean,false)
        order by d.desde,(public.taxas_entregador(m.user_id,inicio)->>'qtdConcluidas')::integer,m.user_id
        limit 1 for update of m skip locked;
      if not found then exit; end if;
      if not coalesce((public.estado_entregador_rotas(alvo)->>'elegivel')::boolean,false) then continue; end if;
      atrib:=gen_random_uuid();
      insert into public.entrega_viagens(motoboy_id,motoboy_nome,automatica,origem,regras,segundos,metros,ultima_entrega_seg,tipo_despacho,reserva_ate)
        values(alvo,nome,true,'{}',jsonb_build_object('maxPedidos',1),null,null,null,'individual',now()+make_interval(secs=>c.prazo_reserva_seg))
        returning id into viagem;
      insert into public.entregas_operacao(pedido_id,atribuicao,motoboy_id,motoboy_nome)
        values(candidato.id,atrib,alvo,nome) on conflict(pedido_id) do update set atribuicao=excluded.atribuicao,
        motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,atribuido_em=now(),atribuido_por=null
        where public.entregas_operacao.motoboy_id is null and public.entregas_operacao.saiu_em is null
          and public.entregas_operacao.encerramento is null;
      if not found then raise exception 'pedido_alterado'; end if;
      insert into public.entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,chegada_seg)
        values(viagem,candidato.id,1,atrib,null);
      insert into public.entregas_eventos(pedido_id,tipo,dados) values(candidato.id,'atribuicao',
        jsonb_build_object('motoboy',alvo,'nome',nome,'viagem',viagem,'origem','despacho_individual_automatico'));
      insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,tipo,dados)
        values(viagem,alvo,'reserva',jsonb_build_object('tipoDespacho','individual','reservaAte',now()+make_interval(secs=>c.prazo_reserva_seg)));
      reservadas:=reservadas+1;
    end loop;
  end if;
  if reservadas+expiradas>0 then
    insert into public.entrega_rotas_execucoes(automatica,estado,entrada,creditos_reservados)
      values(true,'concluida',jsonb_build_object('tipoDespacho','individual','reservadas',reservadas,'expiradas',expiradas),0);
  end if;
  return jsonb_build_object('estado','concluida','tipoDespacho','individual','planos',0,'reservadas',reservadas,'expiradas',expiradas);
end $$;
revoke all on function public.processar_despacho_individual() from public,anon,authenticated;

create or replace function public.iniciar_planejamento_entregas(p_autor uuid,p_token text default null,
  p_pedidos jsonb default null,p_ordem_fixa boolean default false,p_verificar boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config; origem jsonb; pedidos jsonb; entregadores jsonb; entrada jsonb; cache_chave text;
  resultado jsonb; id_exec uuid; usados integer; custo integer; n integer; matriz jsonb; inicio timestamptz;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if p_autor is null then
    if p_token is null or p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
    if not coalesce(p_verificar,false) and c.modo<>'automatico' and not c.despacho_individual_ativo
      and not exists(select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada') then return jsonb_build_object('estado','desligado'); end if;
  elsif not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
  select * into c from public.entrega_rotas_config where id=1 for update;
  if p_autor is null and p_token is distinct from c.job_token then raise exception 'sem_permissao'; end if;
  if p_autor is null and not coalesce(p_verificar,false) and c.modo<>'automatico' and not c.despacho_individual_ativo
      and not exists(select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada') then return jsonb_build_object('estado','desligado'); end if;
  if not coalesce(p_verificar,false) and (c.despacho_individual_ativo or exists(
    select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada')) then
    if p_pedidos is not null then raise exception 'dados_invalidos'; end if;
    resultado:=public.processar_despacho_individual();
    if c.despacho_individual_ativo or c.modo<>'automatico' then return resultado; end if;
  end if;
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
    -- Espera o mais antigo para reunir os pedidos já prontos, inclusive os recentes.
    -- A janela só vale para reserva automática com agrupamento por percurso.
    if p_autor is null and (c.regras->>'maxPedidos')::integer>1 and c.janela_agrupamento_seg>0
      and (select min((p->>'prontoEm')::timestamptz) from jsonb_array_elements(pedidos) p)
        >now()-make_interval(secs=>c.janela_agrupamento_seg) then
      return jsonb_build_object('estado','aguarde','motivo','janela_agrupamento');
    end if;
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
    despacho_individual_ativo=case when p_modo<>'desligado' then false else despacho_individual_ativo end,
    versao=gen_random_uuid(),alterado_em=now(),alterado_por=auth.uid() where id=1;
  update public.entrega_rotas_planos set estado='vencido' where estado='aberto';
  insert into public.entrega_rotas_eventos(autor,tipo,dados) values(auth.uid(),'configuracao',jsonb_build_object('modo',p_modo,'regras',p_regras));
  if p_modo='automatico' then perform public.disparar_planejador_entregas(); end if;
  return public.rotas_config_json();
end $$;
revoke all on function public.configurar_rotas(text,jsonb,integer,uuid) from public,anon;
grant execute on function public.configurar_rotas(text,jsonb,integer,uuid) to authenticated;

create or replace function public.viagem_entrega_json(v public.entrega_viagens) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',v.id,'motoboyId',v.motoboy_id,'motoboyNome',v.motoboy_nome,'versao',v.versao,'estado',v.estado,
    'tipoDespacho',v.tipo_despacho,'reservaAte',v.reserva_ate,'criadaEm',v.criada_em,'automatica',v.automatica,'carregadaVersao',v.carregada_versao,'carregadaEm',v.carregada_em,
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

create or replace function public.reconhecer_carregamento_viagem(p_id uuid,p_versao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.entrega_viagens;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  select * into v from public.entrega_viagens where id=p_id for update;
  if not found or v.motoboy_id is distinct from auth.uid() then raise exception 'nao_atribuido'; end if;
  if v.versao is distinct from p_versao or v.revisao_pendente then raise exception 'versao_alterada'; end if;
  if v.tipo_despacho='individual' and v.reserva_ate<=now() then raise exception 'reserva_expirada'; end if;
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
  if v.tipo_despacho='individual' and v.reserva_ate<=now() then raise exception 'reserva_expirada'; end if;
  if v.revisao_pendente then raise exception 'viagem_requer_revisao'; end if;
  if v.carregada_versao is distinct from v.versao then raise exception 'carregamento_pendente'; end if;
  if v.tipo_despacho='rotas' and v.origem is distinct from (select entrega_origem from public.loja where id=1) then raise exception 'origem_alterada'; end if;
  if exists(select 1 from public.entrega_viagens_paradas s join public.pedidos p on p.id=s.pedido_id
    join public.entregas_operacao e on e.pedido_id=p.id where s.viagem_id=v.id and
      (not s.ativa or p.status<>'pronto' or e.atribuicao<>s.atribuicao or e.motoboy_id is distinct from alvo or e.saiu_em is not null
        or (v.tipo_despacho='rotas' and (p.entrega_destino is null or p.entrega_destino_ate<=now())))) then raise exception 'pedido_alterado'; end if;
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

create or replace function public.minha_operacao_rotas() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return jsonb_build_object('servidorEm',public.data_iso(now()),'entregador',public.estado_entregador_rotas(auth.uid()),
    'modo',(select modo from public.entrega_rotas_config where id=1),
    'despachoIndividualAtivo',(select despacho_individual_ativo from public.entrega_rotas_config where id=1),
    'janelaAgrupamentoSeg',(select janela_agrupamento_seg from public.entrega_rotas_config where id=1),
    'viagem',(select public.viagem_entrega_json(v) from public.entrega_viagens v where motoboy_id=auth.uid() and estado in ('reservada','em_rota','retornando')));
end $$;
revoke all on function public.minha_operacao_rotas() from public,anon;
grant execute on function public.minha_operacao_rotas() to authenticated;

create or replace function public.disparar_planejador_entregas(p_verificar boolean default false) returns bigint
language plpgsql security invoker set search_path='' as $$
declare c public.entrega_rotas_config; requisicao bigint;
begin
  select * into c from public.entrega_rotas_config where id=1;
  if c.job_url is null or (c.modo<>'automatico' and not c.despacho_individual_ativo and not p_verificar
      and not exists(select 1 from public.entrega_viagens where tipo_despacho='individual' and estado='reservada'))
    or c.job_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/planejar-entregas$'
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  select net.http_post(url:=c.job_url,body:=jsonb_build_object('tokenJob',c.job_token,'acao',case when p_verificar then 'verificar' else 'automatico' end),
    headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=90000) into requisicao;
  return requisicao;
end $$;
revoke all on function public.disparar_planejador_entregas(boolean) from public,anon,authenticated;

notify pgrst,'reload schema';
