-- Entregas manuais (29/10/2026, pedido do dono): a equipe avança cada etapa no painel (aceitar, marcar pronto,
-- saiu para entrega e concluir). Sai a operação do motoboy: tela /motoboy/, atribuição, viagens, despacho
-- automático, fila do celular e o QR da comanda.
-- Não apaga nada: tabelas e histórico de atribuições, viagens e eventos ficam no banco, e nenhum pedido é alterado.
-- Banco existente: aplicar só esta migration (sem setup/seed em produção). Guia: docs/ENTREGAS-MANUAIS.md.

-- 1. Automação desligada: nada mais reserva viagem para um motoboy nem chama o planejador.
update public.entrega_rotas_config
   set modo='desligado', despacho_individual_ativo=false, cron_ativo=false, versao=gen_random_uuid(), alterado_em=now()
 where id=1;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from cron.job where jobname='mineiro-planejar-entregas') then
      perform cron.unschedule('mineiro-planejar-entregas');
    end if;
  end if;
end $$;

-- 2. Etapas manuais: a equipe leva a entrega de pronto a rota e de rota a entregue sem motoboy, sem baixa manual e
-- sem motivo. Pedido que ainda estava numa viagem antiga não fica mais preso a ela.
create or replace function public.mudar_status(p_id uuid,p_status text,p_motivo text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.pedidos; motivo text:=public.aparar(coalesce(p_motivo,'')); ok boolean; evento jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
  if p_id is null or p_status is null or p_status not in ('novo','preparo','pronto','rota','entregue','cancelado') or length(motivo)>200 then
    raise exception 'dados_invalidos' using errcode='P0001'; end if;
  select * into p from public.pedidos where id=p_id for update;
  if not found then raise exception 'nao_encontrado' using errcode='P0001'; end if;
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
  return public.pedido_json(p);
end $$;
revoke all on function public.mudar_status(uuid,text,text) from public,anon;
grant execute on function public.mudar_status(uuid,text,text) to authenticated;

-- 3. A mudança de status não mexe mais no controle de entregadores nem nas viagens
-- (eram esses gatilhos que exigiam o motivo da baixa manual).
drop trigger if exists pedidos_entregas_operacao on public.pedidos;
drop trigger if exists pedidos_viagens_paradas on public.pedidos;

-- 4. Funções do motoboy e da aba Entregadores fora da API: nenhum usuário logado chama mais. A Edge Function
-- planejar-entregas, se ainda for chamada, usa service_role e encontra a automação desligada; a limpeza dos dados do
-- planejamento continua no cron de hora em hora (mineiro-limpar-planejamento).
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      -- tela do motoboy
      'minhas_entregas','minha_operacao_rotas','confirmar_entrega','confirmar_entrega_offline','consultar_entrega_motoboy',
      'entregas_em_rota','comunicar_entregador','minhas_taxas_entrega','pedidos_disponiveis_entrega','pegar_pedido_entrega',
      'reconhecer_cancelamento_entrega','reconhecer_carregamento_viagem','iniciar_viagem_entrega','retornar_viagem_entrega',
      'definir_disponibilidade_entregador',
      -- aba Entregadores, viagens e despacho
      'atribuir_entrega','baixar_entrega_manual','painel_entregadores','historico_entrega','painel_rotas_entregas',
      'configurar_rotas','configurar_despacho_entregas','reservar_viagem_entrega','desfazer_viagem_entrega',
      'conferir_destino_pedido','liberar_planejamento_pedidos','disparar_planejador_entregas'])
  loop
    execute format('revoke execute on function %s from public,anon,authenticated',f);
  end loop;
end $$;

notify pgrst,'reload schema';
