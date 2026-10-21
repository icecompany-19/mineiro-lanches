-- E-mail opcional na abertura do checkout; vazio significa não informado, sem identidade fictícia.
create or replace function public.preparar_pagamento_mp_online(p_token uuid,p_email text default null,p_iniciar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_p public.pedidos; v_m public.pagamentos_mp; v_criar boolean:=false; v_consultar boolean:=false;
begin
  select * into v_p from public.pedidos where token=p_token for update;
  if not found or v_p.pagamento_online is null then raise exception 'nao_encontrado' using errcode='P0001'; end if;
  select * into v_m from public.pagamentos_mp where pedido_id=v_p.id for update;
  if v_m.id is null and p_iniciar then
    if v_p.status<>'novo' or v_p.pagamento_online<>'pendente' then raise exception 'pagamento_encerrado' using errcode='P0001'; end if;
    p_email:=nullif(btrim(p_email),'');
    if p_email is not null and (char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'email_invalido' using errcode='P0001';
    end if;
    insert into public.pagamentos_mp(pedido_id,email,total) values(v_p.id,coalesce(lower(p_email),''),v_p.total) returning * into v_m;
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

revoke all on function public.preparar_pagamento_mp_online(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.preparar_pagamento_mp_online(uuid,text,boolean) to service_role;

-- A forma e o troco usam os campos existentes, preservando pedidos e clientes anteriores.
create or replace function public.proteger_pagamento_pedido()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.pagamento_online:=null;
    new.pagamento_em:=null;
    new.pagamento_na_entrega:=new.origem<>'exemplo' and coalesce(new.pagamento in ('Pagamento na entrega','Dinheiro na entrega','Dinheiro na retirada','Cartão na entrega','Cartão na retirada','Pix na entrega','Pix na retirada'),false);
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
  if new.pagamento_na_entrega and new.pagamento in ('Dinheiro na entrega','Dinheiro na retirada') then
    if tg_op='INSERT' or new.pagamento is distinct from old.pagamento or new.troco is distinct from old.troco then
      if new.troco is null or new.troco='' then raise exception 'troco_necessario' using errcode='P0001'; end if;
      if new.troco<>'Sem troco' then
        if new.troco !~ '^[0-9]{1,7},[0-9]{2}$' then raise exception 'troco_invalido' using errcode='P0001'; end if;
        if replace(new.troco,',','.')::numeric<=new.total then raise exception 'troco_invalido' using errcode='P0001'; end if;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.proteger_pagamento_pedido() from public,anon,authenticated;
drop trigger if exists pedidos_proteger_pagamento on public.pedidos;
create trigger pedidos_proteger_pagamento before insert or update on public.pedidos
for each row execute function public.proteger_pagamento_pedido();

create or replace function public.entrega_json(p public.pedidos) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select public.entrega_json_sem_entrega(p) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em,'pagamento',p.pagamento,'troco',p.troco)
$$;
revoke all on function public.entrega_json(public.pedidos) from public;
grant execute on function public.entrega_json(public.pedidos) to anon,authenticated,service_role;

create or replace function public.acompanhar_pedido(p_token uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select public.acompanhar_pedido_sem_entrega(p_token) || jsonb_build_object('pagamentoOnline',p.pagamento_online,'pagamentoNaEntrega',p.pagamento_na_entrega,'pagamentoRecebidoEm',p.pagamento_entrega_recebido_em,'pagamento',p.pagamento,'troco',p.troco) from public.pedidos p where p.token=p_token
$$;
revoke all on function public.acompanhar_pedido(uuid) from public;
grant execute on function public.acompanhar_pedido(uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';
