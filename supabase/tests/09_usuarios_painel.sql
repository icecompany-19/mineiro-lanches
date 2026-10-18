begin;
\ir _ajuda.sql
insert into usuarios_painel(user_id,nome,email,perfil,ativo) values
(:'equipe','Administrador teste','equipe@teste.local','admin',true),
(:'moto','Entregador teste','moto@teste.local','motoboy',true)
on conflict(user_id) do update set perfil=excluded.perfil,ativo=true;
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in ('usuarios_painel'::regclass,'usuarios_painel_eventos'::regclass)),'cadastro e auditoria têm RLS');
set local role anon;
select pg_temp.igual(pg_temp.erro('select * from usuarios_painel'),'42501','anônimo não enumera usuários');
select pg_temp.igual(pg_temp.erro('select * from usuarios_painel_eventos'),'42501','anônimo não lê auditoria');
reset role;
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select * from usuarios_painel'),'42501','usuário logado não enumera o cadastro privado');
select pg_temp.igual(pg_temp.erro($q$select gerir_acesso_usuario(null,null,'Nome','teste@teste.local','admin',true)$q$),'42501','não promove permissões chamando o helper');
reset role;
set local role service_role;
select pg_temp.igual(pg_temp.erro(format('select gerir_acesso_usuario(%L,%L,%L,%L,%L,true)',:'moto',:'moto','Entregador','moto@teste.local','admin')),'sem_permissao','motoboy não autoriza mudança de perfil');
select pg_temp.igual(pg_temp.erro(format('select gerir_acesso_usuario(%L,%L,%L,%L,%L,false)',:'equipe',:'equipe','Administrador','equipe@teste.local','admin')),'proprio_acesso_protegido','administrador não se desativa');
select pg_temp.igual(pg_temp.erro(format('select gerir_acesso_usuario(%L,%L,%L,%L,%L,true)',:'equipe',:'equipe','Administrador','equipe@teste.local','motoboy')),'proprio_acesso_protegido','administrador não remove o próprio perfil');
select gerir_acesso_usuario(:'equipe',:'moto','Entregador','moto@teste.local','motoboy',false);
select pg_temp.ok(not (select ativo from motoboys where user_id=:'moto'),'desativação corta a autorização do motoboy');
select gerir_acesso_usuario(:'equipe',:'moto','Equipe nova','moto@teste.local','equipe',true);
select pg_temp.ok(exists(select 1 from equipe where user_id=:'moto') and not exists(select 1 from motoboys where user_id=:'moto'),'mudança para equipe não mantém acesso duplo');
select gerir_acesso_usuario(:'equipe',:'moto','Outro administrador','moto@teste.local','admin',true);
select pg_temp.ok((select perfil='admin' from usuarios_painel where user_id=:'moto'),'administrador pode criar outro administrador');
select gerir_acesso_usuario(:'equipe',:'moto','Outro administrador','moto@teste.local','admin',false);
select pg_temp.ok(not exists(select 1 from equipe where user_id=:'moto'),'desativação remove acesso ao painel');
select pg_temp.igual(pg_temp.erro(format('select gerir_acesso_usuario(%L,%L,%L,%L,%L,true)',:'moto',:'moto','Administrador','moto@teste.local','admin')),'sem_permissao','administrador desativado não reutiliza sessão para conceder acesso');
select pg_temp.ok((select count(*)=4 from usuarios_painel_eventos where autor=:'equipe' and alvo=:'moto'),'operações de acesso registradas sem senhas');
reset role;
rollback;
