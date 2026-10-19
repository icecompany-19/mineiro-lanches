-- Somatórios financeiros por vínculo e recebimento no servidor, sem criar repasses.
begin;
\ir _ajuda.sql
\set moto 41000000-0000-4000-8000-000000000003
\set outro 41000000-0000-4000-8000-000000000004
insert into auth.users(id,email) values(:'moto','moto-taxas@teste.local');
insert into motoboys(user_id,nome) values(:'moto','Motoboy taxas');
insert into auth.users(id,email) values(:'outro','outro-taxas@teste.local') on conflict do nothing;
insert into motoboys(user_id,nome) values(:'outro','Outro entregador') on conflict(user_id) do update set ativo=true;
update motoboys set ativo=true where user_id=:'moto';
create temp table casos_taxas(nome text,id uuid,taxa numeric);
insert into casos_taxas
select nome,(pg_temp.novo('[{"produtoId":"gran-burger"}]','{"modo":"entrega","endereco":"Rua Taxas, 10","distanciaKm":2}') ->> 'id')::uuid,taxa
from (values ('celular',7.25),('manual',4.10),('aberto',9.00),('cancelado',90.00),('outro',88.10),
  ('semana',3.35),('sem_taxa',null::numeric),('aberto_sem_taxa',null::numeric)) t(nome,taxa);
select pg_temp.sou(:'equipe');
select mudar_status(id,'preparo') from casos_taxas;
select atribuir_entrega(id,case when nome='outro' then :'outro'::uuid else :'moto'::uuid end,true) from casos_taxas;
update pedidos p set taxa_entrega=t.taxa from casos_taxas t where p.id=t.id;
select baixar_entrega_manual(id,'Conferência das taxas') from casos_taxas where nome in ('manual','outro','semana','sem_taxa');
select mudar_status(id,'cancelado','Cancelamento da fixture') from casos_taxas where nome='cancelado';
select id as celular from casos_taxas where nome='celular' \gset
select atribuicao as versao from entregas_operacao where pedido_id=:'celular' \gset
select gen_random_uuid() as evento \gset
select pg_temp.sou(:'moto');
select confirmar_entrega_offline(:'celular',:'evento',:'versao',now());
select confirmar_entrega_offline(:'celular',:'evento',:'versao',now());
update entregas_operacao set recebido_em=now()-interval '5 days' where pedido_id=(select id from casos_taxas where nome='semana');
update pedidos set criado_em=now()-interval '40 days' where id=(select id from casos_taxas where nome='semana');

set local role authenticated;
select minhas_taxas_entrega(1) as hoje \gset
select minhas_taxas_entrega(7) as semana \gset
select pg_temp.igual(:'hoje'::jsonb#>>'{taxas,concluidas}','11.35','taxas somam confirmação e baixa manual uma vez, sem outro entregador nem cancelamento');
select pg_temp.igual(:'hoje'::jsonb#>>'{taxas,emAberto}','9.00','taxas abertas ficam separadas das concluídas');
select pg_temp.igual(:'hoje'::jsonb#>>'{taxas,qtdConcluidas}','3','pedido sem taxa conta como concluído sem inventar valor');
select pg_temp.igual(:'hoje'::jsonb#>>'{taxas,semTaxaConcluidas}','1','taxa concluída desconhecida é sinalizada');
select pg_temp.igual(:'hoje'::jsonb#>>'{taxas,semTaxaEmAberto}','1','taxa aberta desconhecida é sinalizada');
select pg_temp.igual(:'semana'::jsonb#>>'{taxas,concluidas}','14.70','período usa recebimento, mesmo com criação mais antiga');
select pg_temp.igual(minhas_taxas_entrega(30)#>>'{taxas,concluidas}','14.70','período de trinta dias mantém soma exata em centavos');
select pg_temp.ok(:'hoje'::jsonb#>'{taxas}' is not null and not (:'hoje'::jsonb ?| array['pedidos','entregadores','cliente','telefone']),'resumo próprio não expõe clientes nem outros entregadores');
select pg_temp.igual(pg_temp.erro('select minhas_taxas_entrega(2)'),'dados_invalidos','período arbitrário recusado');
select pg_temp.igual(pg_temp.erro('select minhas_taxas_entrega(null)'),'dados_invalidos','período nulo recusado');
select pg_temp.igual(pg_temp.erro('select painel_entregadores(1)'),'sem_permissao','motoboy continua sem resumo financeiro dos demais');
reset role;

select pg_temp.sou(:'equipe'); set local role authenticated;
select painel_entregadores(1) as painel \gset
select pg_temp.ok((select e->'taxas'=(:'hoje'::jsonb->'taxas') from jsonb_array_elements(:'painel'::jsonb->'entregadores') e where e->>'id'=:'moto'),'equipe e celular usam o mesmo somatório');
select pg_temp.igual(pg_temp.erro('select minhas_taxas_entrega(1)'),'sem_permissao','equipe sem perfil de motoboy não ganha consulta própria');
reset role;
select pg_temp.sou(:'outro'); set local role authenticated;
select pg_temp.igual(minhas_taxas_entrega(1)#>>'{taxas,concluidas}','88.10','outro motoboy recebe somente suas próprias taxas');
reset role;
update motoboys set ativo=false where user_id=:'outro';
set local role authenticated;
select pg_temp.igual(pg_temp.erro('select minhas_taxas_entrega(1)'),'sem_permissao','desativação corta nova consulta financeira');
reset role;
select pg_temp.ok(not has_function_privilege('anon','minhas_taxas_entrega(integer)','execute'),'anônimo não consulta taxas');
select pg_temp.ok(not has_function_privilege('authenticated','taxas_entregador(uuid,timestamptz)','execute')
  and not has_function_privilege('anon','taxas_entregador(uuid,timestamptz)','execute'),'helper com identificador de motoboy fica privado');
rollback;
