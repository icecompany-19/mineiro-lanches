-- Totais das taxas cobradas nos pedidos; não altera cobrança, conclusão ou atribuição.
-- Helper privado compartilhado pela equipe e pelo resumo do próprio entregador.
create or replace function public.taxas_entregador(p_motoboy uuid, p_inicio timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'concluidas',coalesce(sum(p.taxa_entrega) filter (where p.status='entregue'),0),
    'emAberto',coalesce(sum(p.taxa_entrega) filter (where p.status in ('preparo','pronto','rota')),0),
    'qtdConcluidas',count(*) filter (where p.status='entregue'),
    'qtdEmAberto',count(*) filter (where p.status in ('preparo','pronto','rota')),
    'semTaxaConcluidas',count(*) filter (where p.status='entregue' and p.taxa_entrega is null),
    'semTaxaEmAberto',count(*) filter (where p.status in ('preparo','pronto','rota') and p.taxa_entrega is null))
  from public.entregas_operacao e join public.pedidos p on p.id=e.pedido_id
  where e.motoboy_id=p_motoboy and p.modo='entrega' and p.origem<>'exemplo'
    and (p.status in ('preparo','pronto','rota') or
      (p.status='entregue' and e.recebido_em>=p_inicio and e.recebido_em<=now()))
$$;
revoke all on function public.taxas_entregador(uuid,timestamptz) from public,anon,authenticated;

-- Sem parâmetro de usuário: o motoboy nunca consulta valores de outro entregador.
create or replace function public.minhas_taxas_entrega(p_dias integer default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare inicio timestamptz;
begin
  if not public.is_motoboy() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  return jsonb_build_object('dias',p_dias,'inicio',public.data_iso(inicio),'servidorEm',public.data_iso(now()),
    'taxas',public.taxas_entregador(auth.uid(),inicio));
end $$;
revoke all on function public.minhas_taxas_entrega(integer) from public,anon;
grant execute on function public.minhas_taxas_entrega(integer) to authenticated;

create or replace function public.painel_entregadores(p_dias integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inicio timestamptz; r jsonb;
begin
  if not public.is_equipe() then raise exception 'sem_permissao'; end if;
  if p_dias is null or p_dias not in (1,7,30) then raise exception 'dados_invalidos'; end if;
  inicio:=((public.dia_operacional(now())-(p_dias-1))::timestamp+interval '4 hours') at time zone 'America/Sao_Paulo';
  select jsonb_build_object('servidorEm',public.data_iso(now()),'inicio',public.data_iso(inicio),
    'entregadores',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'nome',m.nome,'ativo',m.ativo,
      'ultimaEm',c.ultima_em,'taxas',public.taxas_entregador(m.user_id,inicio)) order by m.nome)
      from public.motoboys m left join public.entregadores_comunicacao c on c.user_id=m.user_id),'[]'),
    'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'nome',p.cliente_nome,'status',p.status,
      'motoboyId',e.motoboy_id,'motoboyNome',e.motoboy_nome,'atribuicao',e.atribuicao,'atribuidoEm',e.atribuido_em,
      'taxaEntrega',p.taxa_entrega,
      'saiuEm',coalesce(e.saiu_em,(public.entrega_json(p)->>'saiuEm')::timestamptz),
      'confirmadoEm',e.confirmado_em,'recebidoEm',coalesce(e.recebido_em,f.recebido_em,h.concluido_em),
      'encerramento',coalesce(e.encerramento,case when f.evento_id is not null then 'manual' when h.concluido_em is not null then 'anterior' end),
      'legado',e.pedido_id is null and f.evento_id is null and p.status='entregue' and h.concluido_em is not null,
      'responsavel',coalesce(e.encerrado_por,f.autor),'motivo',coalesce(e.motivo,f.dados->>'motivo'),
      'horarioInconsistente',e.horario_inconsistente) order by p.criado_em)
      from public.pedidos p left join public.entregas_operacao e on e.pedido_id=p.id
      left join lateral (select x.* from public.entregas_eventos x where x.pedido_id=p.id and x.tipo='manual'
        and e.pedido_id is null order by x.recebido_em desc limit 1) f on true
      left join lateral (select max((x->>'em')::timestamptz) as concluido_em
        from jsonb_array_elements(p.historico) x where x->>'status'='entregue' and e.pedido_id is null) h on true
      where p.modo='entrega' and p.origem<>'exemplo' and (p.status in ('preparo','pronto','rota')
        or coalesce(e.recebido_em,f.recebido_em,case when p.status='entregue' then h.concluido_em end)>=inicio)), '[]')) into r;
  return r;
end $$;
revoke all on function public.painel_entregadores(integer) from public,anon;
grant execute on function public.painel_entregadores(integer) to authenticated;
notify pgrst, 'reload schema';
