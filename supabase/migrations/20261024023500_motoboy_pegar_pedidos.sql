-- Fila da loja na tela do motoboy: pedidos prontos sem entregador e "pegar" outro antes da saída.
-- Aditiva. Não altera preços, taxas, pagamentos, presença nem pedidos históricos. Reutiliza o ciclo das viagens
-- individuais (reserva → carregamento reconhecido → saída → retorno), o prazo de reserva e as travas do despacho.
-- Depois da saída a fila fica só para consulta; outro pedido só depois do retorno explícito à loja.

-- Por que o motoboy não pode pegar pedido agora (null quando pode). Lido depois das travas por pegar_pedido_entrega.
create or replace function public.motivo_pegar_pedido(p_motoboy uuid) returns text
language sql stable security invoker set search_path='' as $$
  select case
    when not exists(select 1 from public.motoboys m where m.user_id=p_motoboy and m.ativo) then 'entregador_inativo'
    when not c.despacho_individual_ativo then 'despacho_desligado'
    when v.estado in ('em_rota','retornando') then 'entrega_em_andamento'
    when v.id is not null and v.tipo_despacho<>'individual' then 'entregador_em_viagem'
    when v.id is not null and v.revisao_pendente then 'viagem_requer_revisao'
    when v.id is not null and v.reserva_ate<=now() then 'reserva_expirada'
    -- entrega_viagens_paradas.ordem vai de 1 a 6: limite técnico já existente por saída.
    when v.id is not null and (select coalesce(max(s.ordem),0) from public.entrega_viagens_paradas s where s.viagem_id=v.id)>=6 then 'limite_viagem'
    when v.id is null and not coalesce((public.estado_entregador_rotas(p_motoboy)->>'elegivel')::boolean,false) then 'entregador_indisponivel'
  end
  from public.entrega_rotas_config c
    left join public.entrega_viagens v on v.motoboy_id=p_motoboy and v.estado in ('reservada','em_rota','retornando')
  where c.id=1
$$;
revoke all on function public.motivo_pegar_pedido(uuid) from public,anon,authenticated;

-- Pedidos prontos sem entregador, do mais antigo ao mais recente. Recorte mínimo: sem nome, telefone nem itens.
create or replace function public.pedidos_disponiveis_entrega() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  perform public.comunicar_entregador();
  return jsonb_build_object('servidorEm',public.data_iso(now()),'motivo',public.motivo_pegar_pedido(auth.uid()),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'numero',x.numero,'endereco',x.endereco,
        'prontoEm',public.data_iso(x.pronto),'cobrarNaEntrega',x.cobrar) order by x.pronto nulls last,x.id) from (
      select p.id,p.numero,p.endereco,h.pronto,
        coalesce(p.pagamento_na_entrega and p.pagamento_entrega_recebido_em is null and p.pagamento_online is distinct from 'aprovado',false) cobrar
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
        cross join lateral (select max((x->>'em')::timestamptz) pronto from jsonb_array_elements(p.historico) x where x->>'status'='pronto') h
      where p.modo='entrega' and p.status='pronto' and p.origem<>'exemplo' and not p.entrega_planejamento_pausado
        and e.motoboy_id is null and e.saiu_em is null and e.encerramento is null
        and not exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p.id and s.ativa)
      order by h.pronto nulls last,p.id limit 30) x),'[]'),
    'emPreparo',(select count(*) from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      where p.modo='entrega' and p.status='preparo' and p.origem<>'exemplo' and e.motoboy_id is null));
end $$;
revoke all on function public.pedidos_disponiveis_entrega() from public,anon;
grant execute on function public.pedidos_disponiveis_entrega() to authenticated;

-- Pega um pedido da fila: cria a reserva individual ou acrescenta à reserva ainda na loja. A versão muda,
-- então a saída exige carregar de novo no celular. Dois motoboys no mesmo pedido: só o primeiro leva.
create or replace function public.pegar_pedido_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.entrega_rotas_config; v public.entrega_viagens; p public.pedidos; e public.entregas_operacao;
  nome text; motivo text; viagem uuid; atrib uuid:=gen_random_uuid(); ordem integer:=1; prazo timestamptz;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_id is null then raise exception 'dados_invalidos'; end if;
  -- Mesma ordem de travas da reserva, saída e expiração: pedidos por id, cadastro do motoboy, viagem.
  perform 1 from public.pedidos x where x.id=p_id or x.id in (select s.pedido_id from public.entrega_viagens_paradas s
    join public.entrega_viagens v1 on v1.id=s.viagem_id where v1.motoboy_id=auth.uid() and v1.estado='reservada')
    order by x.id for update;
  select m.nome into nome from public.motoboys m where m.user_id=auth.uid() and m.ativo for update;
  if not found then raise exception 'entregador_inativo'; end if;
  select * into v from public.entrega_viagens x where x.motoboy_id=auth.uid() and x.estado in ('reservada','em_rota','retornando') for update;
  -- Relê depois das travas: outro motoboy, a equipe ou o job podem ter mudado o pedido no meio.
  select * into p from public.pedidos x where x.id=p_id;
  if not found or p.modo<>'entrega' or p.origem='exemplo' then raise exception 'nao_encontrado'; end if;
  select * into e from public.entregas_operacao x where x.pedido_id=p_id;
  if p.status<>'pronto' or p.entrega_planejamento_pausado or e.motoboy_id is not null or e.saiu_em is not null
    or e.encerramento is not null or exists(select 1 from public.entrega_viagens_paradas s where s.pedido_id=p_id and s.ativa) then
    raise exception 'pedido_indisponivel'; end if;
  motivo:=public.motivo_pegar_pedido(auth.uid());
  if motivo is not null then raise exception '%',motivo; end if;
  select * into c from public.entrega_rotas_config where id=1;
  prazo:=now()+make_interval(secs=>c.prazo_reserva_seg);
  if v.id is null then
    insert into public.entrega_viagens(motoboy_id,motoboy_nome,criada_por,automatica,origem,regras,segundos,metros,ultima_entrega_seg,tipo_despacho,reserva_ate)
      values(auth.uid(),nome,auth.uid(),false,'{}',jsonb_build_object('maxPedidos',1),null,null,null,'individual',prazo)
      returning id into viagem;
    insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(viagem,auth.uid(),auth.uid(),'reserva',
      jsonb_build_object('tipoDespacho','individual','reservaAte',prazo,'origem','motoboy','pedido',p_id));
  else
    viagem:=v.id;
    select coalesce(max(s.ordem),0)+1 into ordem from public.entrega_viagens_paradas s where s.viagem_id=v.id;
    prazo:=greatest(v.reserva_ate,prazo);
    update public.entrega_viagens set versao=gen_random_uuid(),carregada_versao=null,
      regras=jsonb_build_object('maxPedidos',ordem),reserva_ate=prazo where id=v.id;
    insert into public.entrega_rotas_eventos(viagem_id,motoboy_id,autor,tipo,dados) values(viagem,auth.uid(),auth.uid(),'pedido_acrescentado',
      jsonb_build_object('pedido',p_id,'ordem',ordem,'reservaAte',prazo));
  end if;
  insert into public.entregas_operacao(pedido_id,atribuicao,motoboy_id,motoboy_nome,atribuido_por)
    values(p_id,atrib,auth.uid(),nome,auth.uid()) on conflict(pedido_id) do update set atribuicao=excluded.atribuicao,
    motoboy_id=excluded.motoboy_id,motoboy_nome=excluded.motoboy_nome,atribuido_em=now(),atribuido_por=excluded.atribuido_por
    where public.entregas_operacao.motoboy_id is null and public.entregas_operacao.saiu_em is null
      and public.entregas_operacao.encerramento is null;
  if not found then raise exception 'pedido_indisponivel'; end if;
  insert into public.entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,chegada_seg) values(viagem,p_id,ordem,atrib,null);
  insert into public.entregas_eventos(pedido_id,autor,tipo,dados) values(p_id,auth.uid(),'atribuicao',
    jsonb_build_object('motoboy',auth.uid(),'nome',nome,'viagem',viagem,'origem','motoboy_pegou'));
  perform public.comunicar_entregador();
  return jsonb_build_object('ok',true,'viagem',(select public.viagem_entrega_json(x) from public.entrega_viagens x where x.id=viagem));
end $$;
revoke all on function public.pegar_pedido_entrega(uuid) from public,anon;
grant execute on function public.pegar_pedido_entrega(uuid) to authenticated;

notify pgrst,'reload schema';
