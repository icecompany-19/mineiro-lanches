-- Tabela de preços de 22/11/2026: os preços novos do cardápio de papel (fotos do dono), com final ,99 no site,
-- e as bebidas da lista do dono. Adicionais (Catupiry, Bacon, Doritos, Queijo, Pizza) de R$ 7,50 para R$ 7,00.
-- Itens que não aparecem nas fotos: +R$ 1 com final ,99; Hot Dog Pizza e Gran Burger Bacon = lanche + adicional.
-- Aprovado pelo usuário em 22/11/2026. Só o site: a 99 muda depois, com outra aprovação.
-- Trava: só aplica se todos os 56 produtos ainda estiverem com o preço de antes (senão nada muda).
-- Rodar no SQL Editor do projeto Mineiro Lanche (ou: supabase db query --remote=<ref> -f este-arquivo).
do $$
declare n int;
begin
  with v(id, antes, depois) as (values
    ('dog-medio', 13.90, 14.99),
    ('dog-medio-frango', 19.90, 21.99),
    ('dog-max', 15.90, 16.99),
    ('dog-max-frango', 21.90, 23.99),
    ('dog-super', 18.90, 19.99),
    ('dog-super-frango', 24.90, 26.99),
    ('dog-doritos', 23.90, 24.99),
    ('dog-pizza', 26.40, 26.99),
    ('dog-cbo-turbo', 34.90, 35.99),
    ('x-burguer', 16.90, 17.99),
    ('x-salada', 19.90, 20.99),
    ('mega-x-salada-egg', 21.90, 22.99),
    ('ultra-x-salada-bacon', 23.90, 24.99),
    ('exagerado-x-salada-egg-bacon', 27.90, 28.99),
    ('big-tudo', 28.90, 29.99),
    ('black-master', 29.90, 30.99),
    ('big-mineiro', 30.90, 31.99),
    ('gran-burger', 25.90, 26.99),
    ('gran-burger-bacon', 33.40, 33.99),
    ('gran-salada', 26.90, 29.99),
    ('gran-egg', 30.90, 31.99),
    ('gran-bacon', 31.90, 32.99),
    ('gran-egg-bacon', 33.90, 34.99),
    ('gran-big-tudo', 34.90, 35.99),
    ('gran-black', 35.90, 36.99),
    ('gran-big-mineiro', 36.90, 37.99),
    ('gran-chicken', 24.90, 25.99),
    ('gran-bacon-onion', 34.90, 35.99),
    ('gran-crispy', 27.90, 27.99),
    ('carne-maluca', 26.90, 27.99),
    ('x-frango', 25.90, 26.99),
    ('x-frango-egg-bacon', 29.90, 30.99),
    ('x-calabresa', 25.90, 26.99),
    ('x-churrasco', 28.90, 29.99),
    ('americano', 21.90, 22.99),
    ('combo-diluvio', 49.90, 50.99),
    ('combo-casal', 99.90, 100.99),
    ('gran-bacon-coca-maionese', 42.90, 43.99),
    ('combo-2-dog-doritos', 57.80, 58.99),
    ('combo-gran-burger', 39.90, 40.99),
    ('combo-gran-bacon', 45.90, 46.99),
    ('combo-gran-salada', 42.90, 43.99),
    ('combo-gran-bacon-onion', 48.90, 49.99),
    ('combo-hot-dog-max', 29.90, 30.99),
    ('combo-x-frango', 39.90, 40.99),
    ('combo-gran-chicken', 38.90, 39.99),
    ('porcao-batata', 39.90, 39.99),
    ('porcao-onion', 14.90, 14.99),
    ('refri-lata', 8.00, 9.99),
    ('refri-600', 12.00, 12.99),
    ('refri-1l', 14.00, 14.99),
    ('refri-dolly', 4.50, 4.99),
    ('suco-lata', 7.00, 9.99),
    ('suco-1l', 11.00, 12.99),
    ('agua', 4.00, 4.99),
    ('h2o', 8.00, 9.99)
  )
  update public.produtos p set preco = v.depois
  from v where p.id = v.id and p.preco = v.antes;
  get diagnostics n = row_count;
  if n <> 56 then
    raise exception 'esperava 56 produtos com o preço de antes, achei %; nada foi alterado', n;
  end if;

  update public.adicionais set preco = 7.00
  where id in ('catupiry', 'bacon', 'doritos', 'queijo', 'pizza') and preco = 7.50;
  get diagnostics n = row_count;
  if n <> 5 then
    raise exception 'esperava 5 adicionais a R$ 7,50, achei %; nada foi alterado', n;
  end if;
end $$;

select id, nome, preco from public.produtos where ativo order by categoria, ordem;
select id, nome, preco from public.adicionais order by id;
