-- Entregas manuais (29/10, migration 20261029190000): a equipe leva a entrega por todas as etapas no painel,
-- sem motoboy, sem baixa manual e sem motivo; nada de viagem, planejador ou funções do motoboy.
begin;
\ir _ajuda.sql
update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=false;

select pg_temp.sou(null);
set local role anon;
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')),
  pg_temp.cliente('11900016001') || '{"modo":"entrega","endereco":"Rua Manual, 16","distanciaKm":3}')) as ent \gset
select criar_pedido(pg_temp.pedido(jsonb_build_array(pg_temp.item('dog-max')),
  pg_temp.cliente('11900016002') || '{"modo":"entrega","endereco":"Rua Antiga, 7","distanciaKm":2}')) as antigo \gset
reset role;
select :'ent'::jsonb ->> 'id' as ent_id, :'antigo'::jsonb ->> 'id' as antigo_id \gset

-- automação desligada pela migration
select pg_temp.ok((select modo='desligado' and not despacho_individual_ativo and not cron_ativo from entrega_rotas_config where id=1),
  'rotas e despacho automático ficam desligados');
select pg_temp.ok(not exists(select 1 from pg_trigger where tgrelid='pedidos'::regclass and not tgisinternal
    and tgname in ('pedidos_entregas_operacao','pedidos_viagens_paradas')),
  'mudança de status não passa mais pelos gatilhos de entregador e viagem');

-- um pedido que já estava numa viagem do sistema antigo (reservada para o motoboy de teste)
insert into entrega_viagens(id,motoboy_id,motoboy_nome,estado,criada_por,origem,regras,tipo_despacho,reserva_ate)
values('00000000-0000-4000-8000-0000000016aa',:'moto','Motoboy teste','reservada',:'moto','{}','{}','individual',now()+interval '5 minutes');
insert into entrega_viagens_paradas(viagem_id,pedido_id,ordem,atribuicao,ativa)
values('00000000-0000-4000-8000-0000000016aa',:'antigo_id',1,gen_random_uuid(),true);

select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(mudar_status(:'ent_id','preparo') ->> 'status','preparo','entrega: aceitar e preparar');
select pg_temp.igual(mudar_status(:'ent_id','pronto') ->> 'status','pronto','entrega: marcar pronto');
select pg_temp.igual(mudar_status(:'ent_id','rota') ->> 'status','rota','entrega: saiu para entrega pela equipe, sem motoboy');
select mudar_status(:'ent_id','entregue') as r \gset
select pg_temp.ok(:'r'::jsonb ->> 'status' = 'entregue' and not (:'r'::jsonb #> '{historico,-1}' ? 'motivo')
                  and (select array_agg(h ->> 'status' order by n) from jsonb_array_elements(:'r'::jsonb -> 'historico') with ordinality x(h, n))
                      = array['novo','preparo','pronto','rota','entregue'],
  'entrega: concluída pela equipe sem motivo; histórico com todas as etapas');
select pg_temp.igual(mudar_status(:'antigo_id','preparo') ->> 'status','preparo','pedido de viagem antiga: preparo');
select pg_temp.igual(mudar_status(:'antigo_id','pronto') ->> 'status','pronto','pedido de viagem antiga: pronto');
select pg_temp.igual(mudar_status(:'antigo_id','rota') ->> 'status','rota','pedido de viagem antiga não fica preso a ela (sem pedido_em_viagem)');
select pg_temp.igual(mudar_status(:'antigo_id','entregue') ->> 'status','entregue','pedido de viagem antiga: concluído pela equipe');
-- a ordem das etapas continua valendo
select pg_temp.igual(pg_temp.erro(format($$select mudar_status(%L,'rota')$$,:'ent_id')),'transicao_invalida','entregue → rota: transicao_invalida');
reset role;
select pg_temp.ok((select count(*)=0 from entregas_operacao where pedido_id in (:'ent_id',:'antigo_id'))
                  and (select count(*)=0 from entregas_eventos where pedido_id in (:'ent_id',:'antigo_id')),
  'nada é gravado no controle de entregadores');
select pg_temp.ok((select estado='reservada' from entrega_viagens where id='00000000-0000-4000-8000-0000000016aa'),
  'viagem antiga fica como estava (histórico preservado)');

-- funções do motoboy e da aba Entregadores: fora do alcance de quem está logado (equipe ou motoboy)
select pg_temp.ok(not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array['minhas_entregas','minha_operacao_rotas','confirmar_entrega','confirmar_entrega_offline',
      'consultar_entrega_motoboy','entregas_em_rota','comunicar_entregador','minhas_taxas_entrega','pedidos_disponiveis_entrega',
      'pegar_pedido_entrega','reconhecer_cancelamento_entrega','reconhecer_carregamento_viagem','iniciar_viagem_entrega',
      'retornar_viagem_entrega','definir_disponibilidade_entregador','atribuir_entrega','baixar_entrega_manual','painel_entregadores',
      'historico_entrega','painel_rotas_entregas','configurar_rotas','configurar_despacho_entregas','reservar_viagem_entrega',
      'desfazer_viagem_entrega','conferir_destino_pedido','liberar_planejamento_pedidos','disparar_planejador_entregas'])
      and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
  'anon e authenticated sem execute nas funções retiradas');
select pg_temp.sou(:'moto');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select minhas_entregas()'),'42501','motoboy não lista mais entregas');
select pg_temp.igual(pg_temp.erro(format('select confirmar_entrega(%L)',:'ent_id')),'42501','motoboy não confirma mais entregas');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select painel_entregadores(1)'),'42501','equipe não abre mais a central de entregadores');
select pg_temp.ok(has_function_privilege('authenticated','confirmar_pagamento_entrega(uuid)','execute')
                  and has_function_privilege('authenticated','mudar_status(uuid,text,text)','execute'),
  'o que o painel usa continua liberado (etapas e recebimento na entrega)');
rollback;
