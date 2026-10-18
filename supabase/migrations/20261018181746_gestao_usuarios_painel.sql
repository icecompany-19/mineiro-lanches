-- Cadastro administrativo privado; equipe e motoboys continuam sendo as portas de acesso existentes.
create table if not exists public.usuarios_painel (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check(char_length(btrim(nome)) between 2 and 80),
  email text not null unique check(email=lower(btrim(email))),
  perfil text not null check(perfil in ('admin','equipe','motoboy')),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.usuarios_painel_eventos (
  id bigint generated always as identity primary key,
  autor uuid not null,
  alvo uuid not null,
  acao text not null check(acao in ('criar','editar','senha')),
  perfil text,
  ativo boolean,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_painel enable row level security;
alter table public.usuarios_painel_eventos enable row level security;
revoke all on public.usuarios_painel,public.usuarios_painel_eventos from public,anon,authenticated;
grant all on public.usuarios_painel,public.usuarios_painel_eventos to service_role;
revoke all on sequence public.usuarios_painel_eventos_id_seq from public,anon,authenticated;
grant usage,select on sequence public.usuarios_painel_eventos_id_seq to service_role;

-- A implantação existente tem um único membro da equipe: ele mantém o controle da loja.
-- Não concede administração indiscriminadamente quando há vários membros preexistentes.
insert into public.usuarios_painel(user_id,nome,email,perfil,ativo)
select e.user_id,coalesce(nullif(btrim(e.nome),''),'Responsável'),lower(u.email),
  case when (select count(*) from public.equipe)=1 then 'admin' else 'equipe' end,true
from public.equipe e join auth.users u on u.id=e.user_id
on conflict(user_id) do nothing;
insert into public.usuarios_painel(user_id,nome,email,perfil,ativo)
select m.user_id,coalesce(nullif(btrim(m.nome),''),'Entregador'),lower(u.email),'motoboy',m.ativo
from public.motoboys m join auth.users u on u.id=m.user_id
on conflict(user_id) do nothing;

-- Somente o backend chama esta função. Verifica o administrador novamente dentro da trava,
-- inclusive se ele foi desativado enquanto outra requisição estava em andamento.
create or replace function public.gerir_acesso_usuario(p_autor uuid,p_id uuid,p_nome text,p_email text,p_perfil text,p_ativo boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_antes public.usuarios_painel; v_novo public.usuarios_painel;
begin
  perform pg_advisory_xact_lock(hashtextextended('mineiro:gestao-usuarios',0));
  if not exists(select 1 from public.usuarios_painel u join public.equipe e on e.user_id=u.user_id
    where u.user_id=p_autor and u.ativo and u.perfil='admin') then
    raise exception 'sem_permissao' using errcode='P0001';
  end if;
  if p_id is null or p_nome is null or char_length(btrim(p_nome)) not between 2 and 80
     or p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_perfil is null or p_perfil not in ('admin','equipe','motoboy') or p_ativo is null then
    raise exception 'dados_invalidos' using errcode='P0001';
  end if;
  select * into v_antes from public.usuarios_painel where user_id=p_id;
  if p_id=p_autor and (p_perfil<>'admin' or not p_ativo) then
    raise exception 'proprio_acesso_protegido' using errcode='P0001';
  end if;
  if v_antes.user_id is not null and v_antes.email<>lower(btrim(p_email)) then
    raise exception 'email_nao_alteravel' using errcode='P0001';
  end if;
  insert into public.usuarios_painel(user_id,nome,email,perfil,ativo)
  values(p_id,btrim(p_nome),lower(btrim(p_email)),p_perfil,p_ativo)
  on conflict(user_id) do update set nome=excluded.nome,perfil=excluded.perfil,ativo=excluded.ativo,atualizado_em=now()
  returning * into v_novo;
  if p_ativo and p_perfil in ('admin','equipe') then
    insert into public.equipe(user_id,nome) values(p_id,btrim(p_nome)) on conflict(user_id) do update set nome=excluded.nome;
    delete from public.motoboys where user_id=p_id;
  else
    delete from public.equipe where user_id=p_id;
    if p_perfil='motoboy' then
      insert into public.motoboys(user_id,nome,ativo) values(p_id,btrim(p_nome),p_ativo)
      on conflict(user_id) do update set nome=excluded.nome,ativo=excluded.ativo;
    else delete from public.motoboys where user_id=p_id;
    end if;
  end if;
  insert into public.usuarios_painel_eventos(autor,alvo,acao,perfil,ativo)
  values(p_autor,p_id,case when v_antes.user_id is null then 'criar' else 'editar' end,p_perfil,p_ativo);
  return jsonb_build_object('user_id',v_novo.user_id,'nome',v_novo.nome,'email',v_novo.email,'perfil',v_novo.perfil,'ativo',v_novo.ativo);
end $$;
revoke all on function public.gerir_acesso_usuario(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.gerir_acesso_usuario(uuid,uuid,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';
