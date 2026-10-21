-- Pagamento na entrega é a receber, nunca uma aprovação fictícia do Mercado Pago.
alter table public.pedidos add column if not exists pagamento_na_entrega boolean not null default false;
alter table public.pedidos add column if not exists pagamento_entrega_recebido_em timestamptz;
alter table public.pedidos add column if not exists pagamento_entrega_convertendo boolean not null default false;
create or replace function public.proteger_pagamento_pedido()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.pagamento_online:=null;
    new.pagamento_em:=null;
    new.pagamento_na_entrega:=new.origem<>'exemplo' and coalesce(new.pagamento='Pagamento na entrega',false);
    new.pagamento_entrega_recebido_em:=null;
    new.pagamento_entrega_convertendo:=false;
    if new.origem<>'exemplo' and (select pagamentos_ativos from public.loja where id=1) then
      if new.total<=0 or (new.modo='entrega' and new.taxa_entrega is null) then
        raise exception 'pagamento_valor_invalido' using errcode='P0001';
      end if;
      if not new.pagamento_na_entrega then
      new.pagamento_online:='pendente';
      new.pagamento:='Mercado Pago';
      new.troco:='';
      end if;
    end if;
  else
    if new.pagamento_na_entrega and new.pagamento_online in ('pendente','recusado','cancelado') then new.pagamento_online:=null; end if;
  if new.status is distinct from old.status and new.status not in ('novo','cancelado')
    and old.pagamento_online is not null and new.pagamento_online is distinct from 'aprovado' then
    raise exception 'pagamento_pendente' using errcode='P0001';
  end if;
  end if;
  return new;
end $$;
revoke all on function public.proteger_pagamento_pedido() from public,anon,authenticated;
drop trigger if exists pedidos_proteger_pagamento on public.pedidos;
create trigger pedidos_proteger_pagamento before insert or update on public.pedidos
for each row execute function public.proteger_pagamento_pedido();


do $$ begin
 if to_regprocedure('public.preparar_pagamento_mp_online(uuid,text,boolean)') is null then
 alter function public.preparar_pagamento_mp(uuid,text,boolean) rename to preparar_pagamento_mp_online;
 end if;
end $$;
create or replace function public.preparar_pagamento_mp(p_token uuid,p_email text default null,p_iniciar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.pedidos;
begin
 select * into p from public.pedidos where token=p_token for update;
 if not found then raise exception 'nao_encontrado'; end if;
 if p.pagamento_na_entrega or p.pagamento_entrega_convertendo then
   if p_iniciar then raise exception 'pagamento_encerrado'; end if;
   return jsonb_build_object('estado',case when p.pagamento_entrega_convertendo then 'alterando' else 'na_entrega' end,'pedido_status',p.status);
 end if;
 return public.preparar_pagamento_mp_online(p_token,p_email,p_iniciar);
end $$;
revoke all on function public.preparar_pagamento_mp(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.preparar_pagamento_mp(uuid,text,boolean) to service_role;

create or replace function public.autorizar_pagamento_entrega_mp(p_autor uuid,p_id uuid,p_finalizar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.pedidos; m public.pagamentos_mp;
begin
 if not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
 select * into p from public.pedidos where id=p_id for update;
 if not found then raise exception 'nao_encontrado'; end if;
 if p.status in ('cancelado','entregue') or p.pagamento_online in ('aprovado','reembolsado','parcialmente_reembolsado','em_disputa') then raise exception 'pagamento_encerrado'; end if;
 if p.pagamento_na_entrega then return jsonb_build_object('naEntrega',true); end if;
 select * into m from public.pagamentos_mp where pedido_id=p_id for update;
 if m.criando_ate>now() then raise exception 'pagamento_em_criacao'; end if;
 if m.estado in ('aprovado','reembolsado','parcialmente_reembolsado','em_disputa') then raise exception 'pagamento_encerrado'; end if;
 if p_finalizar then
   if m.order_id is not null and m.estado<>'cancelado' then raise exception 'pagamento_online_ativo'; end if;
   update public.pedidos set pagamento_na_entrega=true,pagamento='Pagamento na entrega',pagamento_online=null,
     pagamento_em=clock_timestamp(),pagamento_entrega_convertendo=false,
     historico=historico||jsonb_build_array(jsonb_build_object('status',status,'em',public.data_iso(now()),'autor',p_autor,'evento','pagamento_na_entrega','motivo','Pagamento alterado para receber na entrega; checkout online encerrado.')) where id=p_id;
   return jsonb_build_object('naEntrega',true);
 end if;
 update public.pedidos set pagamento_entrega_convertendo=true where id=p_id;
 return case when m.id is null then jsonb_build_object('semCheckout',true) else to_jsonb(m) end;
end $$;
revoke all on function public.autorizar_pagamento_entrega_mp(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.autorizar_pagamento_entrega_mp(uuid,uuid,boolean) to service_role;

create or replace function public.confirmar_pagamento_entrega(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.pedidos;
begin
 if not public.is_equipe() then raise exception 'sem_permissao'; end if;
 select * into p from public.pedidos where id=p_id for update;
 if not found then raise exception 'nao_encontrado'; end if;
 if not p.pagamento_na_entrega or p.status='cancelado' or p.pagamento_online is not null then raise exception 'pagamento_encerrado'; end if;
 if p.pagamento_entrega_recebido_em is null then
 update public.pedidos set pagamento_entrega_recebido_em=clock_timestamp(),pagamento_em=clock_timestamp(),
 historico=historico||jsonb_build_array(jsonb_build_object('status',status,'em',public.data_iso(now()),'autor',auth.uid(),'evento','pagamento_recebido','motivo','Equipe confirmou o recebimento do pagamento na entrega.')) where id=p_id returning * into p;
 end if;
 return public.pedido_json(p);
end $$;
revoke all on function public.confirmar_pagamento_entrega(uuid) from public,anon,authenticated;
grant execute on function public.confirmar_pagamento_entrega(uuid) to authenticated;

do $$ begin if to_regprocedure('public.pedido_json_sem_entrega(public.pedidos)') is null then alter function public.pedido_json(public.pedidos) rename to pedido_json_sem_entrega; end if; end $$;
create or replace function public.pedido_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.pedido_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em)
$$;
revoke all on function public.pedido_json(public.pedidos) from public;
grant execute on function public.pedido_json(public.pedidos) to anon,authenticated,service_role;

do $$ begin if to_regprocedure('public.entrega_json_sem_entrega(public.pedidos)') is null then alter function public.entrega_json(public.pedidos) rename to entrega_json_sem_entrega; end if; end $$;
create or replace function public.entrega_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.entrega_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em)
$$;
revoke all on function public.entrega_json(public.pedidos) from public;
grant execute on function public.entrega_json(public.pedidos) to anon,authenticated,service_role;

do $$ begin if to_regprocedure('public.acompanhar_pedido_sem_entrega(uuid)') is null then alter function public.acompanhar_pedido(uuid) rename to acompanhar_pedido_sem_entrega; end if; end $$;
create or replace function public.acompanhar_pedido(p_token uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select public.acompanhar_pedido_sem_entrega(p_token) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em) from public.pedidos p where p.token=p_token
$$;
revoke all on function public.acompanhar_pedido(uuid) from public;
grant execute on function public.acompanhar_pedido(uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';
create or replace function public.liberar_reserva_pagamento_entrega_mp(p_autor uuid,p_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.equipe where user_id=p_autor) then raise exception 'sem_permissao'; end if;
 update public.pedidos set pagamento_entrega_convertendo=false where id=p_id and not pagamento_na_entrega;
end $$;
revoke all on function public.liberar_reserva_pagamento_entrega_mp(uuid,uuid) from public,anon,authenticated;
grant execute on function public.liberar_reserva_pagamento_entrega_mp(uuid,uuid) to service_role;
