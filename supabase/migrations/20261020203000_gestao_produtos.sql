-- Catálogo persistente; alterações do painel sobrevivem ao seed e a novos deploys.
create table if not exists public.categorias_produtos (
  id text primary key check(id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  label text not null check(char_length(label) between 1 and 80),
  icone text not null default 'burger',
  descricao text not null default '',
  ordem int not null default 0
);
alter table public.categorias_produtos enable row level security;
revoke all on public.categorias_produtos from public,anon,authenticated;
grant select on public.categorias_produtos to anon,authenticated;
grant all on public.categorias_produtos to service_role;
drop policy if exists categorias_produtos_leitura on public.categorias_produtos;
create policy categorias_produtos_leitura on public.categorias_produtos for select to anon,authenticated using(true);
alter table public.produtos add column if not exists detalhes jsonb not null default '{}';
alter table public.produtos add column if not exists editado_painel boolean not null default false;
alter table public.produtos add column if not exists atualizado_em timestamptz not null default now();
insert into public.categorias_produtos(id,label,icone,descricao,ordem)
select id,label,icone,"desc",ordem from jsonb_to_recordset('[{"id":"testes","label":"Teste de pagamento","icone":"sacola","desc":"Item temporário para validar o pagamento online","ordem":0},{"id":"artesanais","label":"Artesanais","icone":"burger","desc":"Hambúrguer artesanal de 200 g","ordem":1},{"id":"tradicionais","label":"Tradicionais","icone":"burger","desc":"Os clássicos da chapa","ordem":2},{"id":"hotdog","label":"Hot dog","icone":"hotdog","desc":"Salsicha Perdigão · Dog Bacon ou Dog Pizza: qualquer dog com o adicional Bacon ou Pizza","ordem":3},{"id":"baguetes","label":"Baguetes","icone":"baguete","desc":"Na baguete, do jeito mineiro","ordem":4},{"id":"combos","label":"Combos","icone":"combo","desc":"Lanche, batata e bebida","ordem":5},{"id":"porcoes","label":"Porções","icone":"batata","desc":"Pra dividir","ordem":6},{"id":"bebidas","label":"Bebidas","icone":"lata","desc":"Geladas","ordem":7}]'::jsonb) as c(id text,label text,icone text,"desc" text,ordem int)
on conflict(id) do nothing;
update public.produtos p set detalhes=d.detalhes from jsonb_to_recordset('[{"id":"teste-pagamento","detalhes":{"base":"Somente validação do pagamento. Não é um alimento. Selecione retirada no local.","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-burger","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-burger-bacon","detalhes":{"base":"Gran Burger com bacon","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-salada","detalhes":{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-egg","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-bacon","detalhes":{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-egg-bacon","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-big-tudo","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-black","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-big-mineiro","detalhes":{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-chicken","detalhes":{"base":"Pão de brioche e hambúrguer de frango empanado","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-bacon-onion","detalhes":{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"gran-crispy","detalhes":{"base":"Pão de brioche e hambúrguer 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-burguer","detalhes":{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-salada","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"mega-x-salada-egg","detalhes":{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"ultra-x-salada-bacon","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"exagerado-x-salada-egg-bacon","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"big-tudo","detalhes":{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"black-master","detalhes":{"base":"Pão australiano e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"big-mineiro","detalhes":{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-medio","detalhes":{"base":"Pão médio e 1 salsicha Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-medio-frango","detalhes":{"base":"Pão e 1 salsicha","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-max","detalhes":{"base":"Pão médio e 2 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-max-frango","detalhes":{"base":"Pão e 2 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-super","detalhes":{"base":"Pão médio e 3 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-super-frango","detalhes":{"base":"Pão e 3 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-doritos","detalhes":{"base":"O hot dog com Doritos da casa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-pizza","detalhes":{"base":"Hot Dog Super (3 salsichas Perdigão) com o adicional Pizza","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"dog-cbo-turbo","detalhes":{"base":"Pão de dog e 3 salsichas Perdigão","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"carne-maluca","detalhes":{"base":"Baguete e carne desfiada","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-frango","detalhes":{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-frango-egg-bacon","detalhes":{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-calabresa","detalhes":{"base":"Baguete e calabresa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"x-churrasco","detalhes":{"base":"Pão de baguete e contra-filé","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"americano","detalhes":{"base":"Baguete","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"combo-diluvio","detalhes":{"base":"","nota":"Pergunte pelo WhatsApp quantos lanches vêm.","inclui":["Gran Burgers na piscininha de cheddar","Farofinha de bacon","140 g de batata frita","Refrigerante lata 350 ml (qualquer um)"],"sabor":false,"escolheRefri":true}},{"id":"combo-casal","detalhes":{"base":"","nota":"Na foto: 2 lanches e batata com calabresa, cheddar, maionese e cebola crispy. Pergunte pelo WhatsApp quais lanches vêm.","inclui":["2 lanches","Porção de batata"],"sabor":false,"escolheRefri":false}},{"id":"gran-bacon-coca-maionese","detalhes":{"base":"","nota":"","inclui":["Gran Bacon","Coca-Cola 350 ml","Maionese artesanal da casa"],"sabor":false,"escolheRefri":false}},{"id":"combo-2-dog-doritos","detalhes":{"base":"","nota":"","inclui":["2 Hot Dog com Doritos","Coca-Cola 600 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-burger","detalhes":{"base":"","nota":"","inclui":["Gran Burger (brioche, 200 g de carne angus, mussarela, cheddar, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-bacon","detalhes":{"base":"","nota":"","inclui":["Gran Bacon (brioche, 200 g de carne angus, mussarela, cheddar, bacon, maionese, barbecue, alface americano e tomate)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-salada","detalhes":{"base":"","nota":"","inclui":["Gran Salada (brioche, 200 g de carne angus, mussarela, cheddar, alface americano, tomate, cebola roxa, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-bacon-onion","detalhes":{"base":"","nota":"","inclui":["Gran Bacon Onion (angus 200 g, maionese grill, barbecue, cheddar cremoso, bacon em fatias, 2 onion rings, alface americana, tomate em rodelas e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-hot-dog-max","detalhes":{"base":"","nota":"","inclui":["Hot dog médio com 2 salsichas, alface, purê, batata palha, ketchup, cheddar e catupiry","250 g de batata frita","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-x-frango","detalhes":{"base":"","nota":"","inclui":["X-Frango na baguete (filé de frango, mussarela, maionese, barbecue, vinagrete, purê, batata palha, cheddar e catupiry)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"combo-gran-chicken","detalhes":{"base":"","nota":"","inclui":["Gran Chicken (brioche, frango empanado, maionese, barbecue, alface americano, tomate e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}},{"id":"porcao-batata","detalhes":{"base":"","nota":"","inclui":["500 g de batata frita","Cheddar cremoso","Bacon","Requeijão","Calabresa","Alho-poró"],"sabor":false,"escolheRefri":false}},{"id":"porcao-onion","detalhes":{"base":"","nota":"","inclui":["6 onion rings"],"sabor":false,"escolheRefri":false}},{"id":"refri-lata","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"refri-600","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"refri-1l","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"refri-dolly","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"suco-lata","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"suco-1l","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}},{"id":"agua","detalhes":{"base":"","nota":"","inclui":[],"sabor":false,"escolheRefri":false}},{"id":"h2o","detalhes":{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}}]'::jsonb) as d(id text,detalhes jsonb) where p.id=d.id and not p.editado_painel and p.detalhes='{}'::jsonb;
-- Categorias legadas desconhecidas também permanecem visíveis.
insert into public.categorias_produtos(id,label,ordem)
select distinct categoria,categoria,100 from public.produtos on conflict(id) do nothing;

create table if not exists public.produtos_eventos (
  id bigint generated always as identity primary key,
  produto_id text not null references public.produtos(id),
  autor uuid not null,
  antes jsonb,
  depois jsonb not null,
  criado_em timestamptz not null default now()
);
alter table public.produtos_eventos enable row level security;
revoke all on public.produtos_eventos from public,anon,authenticated;
grant select on public.produtos_eventos to authenticated;
grant all on public.produtos_eventos to service_role;
grant usage,select on sequence public.produtos_eventos_id_seq to service_role;
drop policy if exists produtos_eventos_equipe on public.produtos_eventos;
create policy produtos_eventos_equipe on public.produtos_eventos for select to authenticated using((select public.is_equipe()));

create or replace function public.catalogo_json()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'categorias',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'icone',c.icone,'desc',c.descricao) order by c.ordem,c.id) from public.categorias_produtos c),'[]'::jsonb),
  'produtos',coalesce((select jsonb_agg(to_jsonb(p) order by p.ordem,p.id) from public.produtos p),'[]'::jsonb)
)
$$;
revoke all on function public.catalogo_json() from public,anon,authenticated;
grant execute on function public.catalogo_json() to anon,authenticated,service_role;

-- Mantém o contrato anterior (preços, esgotados, loja), acrescentando o catálogo completo.
create or replace function public.estado_cardapio()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with d as(select public.dia_operacional(now()) as dia)
select jsonb_build_object(
 'diaOperacional',to_char(d.dia,'YYYY-MM-DD'),
 'esgotados',coalesce((select jsonb_agg(p.id order by p.ordem,p.id) from public.produtos p where p.esgotado_dia=d.dia),'[]'::jsonb),
 'inativos',coalesce((select jsonb_agg(p.id order by p.ordem,p.id) from public.produtos p where not p.ativo),'[]'::jsonb),
 'precos',coalesce((select jsonb_object_agg(p.id,p.preco) from public.produtos p),'{}'::jsonb),
 'adicionais',coalesce((select jsonb_object_agg(a.id,a.preco) from public.adicionais a where a.ativo),'{}'::jsonb),
 'catalogo',public.catalogo_json(),'loja',public.loja_json()) from d
$$;

create or replace function public.salvar_produto(p_dados jsonb,p_versao timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare anterior public.produtos; novo public.produtos; ident text; valor numeric; det jsonb; foto_val text;
begin
 if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
 if p_dados is null or jsonb_typeof(p_dados)<>'object' or octet_length(p_dados::text)>30000 then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 ident:=p_dados->>'id';
 if ident is null or ident !~ '^[a-z0-9][a-z0-9-]{0,59}$' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('produto:'||ident,0));
 select * into anterior from public.produtos where id=ident for update;
 if (anterior.id is not null and (p_versao is null or p_versao<>anterior.atualizado_em)) or (anterior.id is null and p_versao is not null) then
   raise exception 'produto_alterado' using errcode='P0001';
 end if;
 if jsonb_typeof(p_dados->'nome') is distinct from 'string' or char_length(btrim(p_dados->>'nome')) not between 1 and 120
   or not exists(select 1 from public.categorias_produtos where id=p_dados->>'categoria')
   or coalesce(p_dados->>'tipo','') not in ('lanche','combo','porcao','bebida')
   or jsonb_typeof(p_dados->'ativo') is distinct from 'boolean'
   or jsonb_typeof(p_dados->'ingredientes') is distinct from 'array'
   or jsonb_typeof(p_dados->'detalhes') is distinct from 'object'
   or jsonb_typeof(p_dados->'ordem') is distinct from 'number' then
   raise exception 'dados_invalidos' using errcode='P0001';
 end if;
 if not (p_dados ? 'preco') or jsonb_typeof(p_dados->'preco') not in ('null','number') then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 valor:=(p_dados->>'preco')::numeric;
 if valor<0 or valor>99999.99 or valor<>round(valor,2) or (p_dados->>'ordem')::numeric not between 0 and 100000
   or (p_dados->>'ordem')::numeric<>trunc((p_dados->>'ordem')::numeric) then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 foto_val:=nullif(p_dados->>'foto','');
 if foto_val is not null then
   if foto_val ~ '^uploads/[a-f0-9-]{36}\.webp$' then
     -- Upload precisa existir; arquivos imutáveis preservam fotos de outros produtos.
     if to_regclass('storage.objects') is not null then
       if not exists(select 1 from storage.objects where bucket_id='produtos-fotos' and name=foto_val) then raise exception 'foto_invalida' using errcode='P0001'; end if;
     end if;
   elsif foto_val !~ '^[a-z0-9][a-z0-9-]{0,59}$' or (foto_val is distinct from anterior.foto and not exists(select 1 from public.produtos where foto=foto_val)) then
     raise exception 'foto_invalida' using errcode='P0001';
   end if;
 end if;
 det:=p_dados->'detalhes';
 if jsonb_typeof(det->'base') is distinct from 'string' or char_length(det->>'base')>500
   or jsonb_typeof(det->'nota') is distinct from 'string' or char_length(det->>'nota')>500
   or jsonb_typeof(det->'inclui') is distinct from 'array'
   or jsonb_typeof(det->'sabor') is distinct from 'boolean'
   or jsonb_typeof(det->'escolheRefri') is distinct from 'boolean' then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 if jsonb_array_length(p_dados->'ingredientes')>40 or jsonb_array_length(det->'inclui')>40 or exists(
   select 1 from jsonb_array_elements((p_dados->'ingredientes')||(det->'inclui')) a(v)
   where jsonb_typeof(v)<>'string' or char_length(btrim(v#>>'{}')) not between 1 and 200
 ) then raise exception 'dados_invalidos' using errcode='P0001'; end if;
 -- Ignora qualquer chave extra: o cliente não consegue alterar campos operacionais.
 det:=jsonb_build_object('base',btrim(det->>'base'),'nota',btrim(det->>'nota'),'inclui',det->'inclui','sabor',det->'sabor','escolheRefri',det->'escolheRefri');
 insert into public.produtos(id,categoria,nome,preco,tipo,foto,ingredientes,ordem,ativo,detalhes,editado_painel,atualizado_em)
 values(ident,p_dados->>'categoria',btrim(p_dados->>'nome'),valor,p_dados->>'tipo',foto_val,
   array(select jsonb_array_elements_text(p_dados->'ingredientes')),(p_dados->>'ordem')::int,(p_dados->>'ativo')::boolean,det,true,clock_timestamp())
 on conflict(id) do update set categoria=excluded.categoria,nome=excluded.nome,preco=excluded.preco,tipo=excluded.tipo,foto=excluded.foto,
   ingredientes=excluded.ingredientes,ordem=excluded.ordem,ativo=excluded.ativo,detalhes=excluded.detalhes,editado_painel=true,atualizado_em=excluded.atualizado_em
 returning * into novo;
 insert into public.produtos_eventos(produto_id,autor,antes,depois) values(ident,auth.uid(),case when anterior.id is null then null else to_jsonb(anterior) end,to_jsonb(novo));
 return to_jsonb(novo);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'dados_invalidos' using errcode='P0001';
end $$;
revoke all on function public.salvar_produto(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.salvar_produto(jsonb,timestamptz) to authenticated;

-- Storage existe no Supabase hospedado. O Postgres local de testes não instala esse serviço.
do $storage$
begin
 if to_regclass('storage.buckets') is not null then
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('produtos-fotos','produtos-fotos',true,2097152,array['image/webp']) on conflict(id) do nothing;
   execute 'drop policy if exists produtos_fotos_inserir on storage.objects';
   execute $policy$create policy produtos_fotos_inserir on storage.objects for insert to authenticated
    with check(bucket_id='produtos-fotos' and (select public.is_equipe()) and name ~ '^uploads/[a-f0-9-]{36}\.webp$')$policy$;
   execute 'drop policy if exists produtos_fotos_equipe_leitura on storage.objects';
   execute $policy$create policy produtos_fotos_equipe_leitura on storage.objects for select to authenticated
    using(bucket_id='produtos-fotos' and (select public.is_equipe()))$policy$;
   execute 'drop policy if exists produtos_fotos_limpar on storage.objects';
   execute $policy$create policy produtos_fotos_limpar on storage.objects for delete to authenticated
    using(bucket_id='produtos-fotos' and (select public.is_equipe()) and not exists(select 1 from public.produtos p where p.foto=name))$policy$;
 end if;
end $storage$;
notify pgrst,'reload schema';

create or replace function public.atualizar_versao_produto()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin new.atualizado_em:=clock_timestamp(); return new; end $$;
revoke all on function public.atualizar_versao_produto() from public,anon,authenticated;
drop trigger if exists produtos_versao on public.produtos;
create trigger produtos_versao before update on public.produtos for each row execute function public.atualizar_versao_produto();
