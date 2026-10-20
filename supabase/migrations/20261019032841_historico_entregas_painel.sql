-- Inclui conclusões anteriores ao controle individual, sem regravar nem atribuir pedidos históricos.
-- A consulta continua exclusiva da equipe; o histórico anterior fica fora das médias por entregador.
create or replace function public.painel_entregadores(p_dias integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
