-- Cardápio do Mineiro Lanche: gerado por scripts/gerar-seed.mjs a partir do CONFIG de src/core.js. Não edite à mão.
-- 56 produtos e 5 adicionais. Idempotente: atualiza nome, preço, categoria, ordem,
-- ingredientes, tipo e foto pelo id, sem mexer em esgotado_dia. O CONFIG manda no ativo: quem está nele fica
-- ativo (um item que saiu e voltou é reativado); quem saiu fica inativo.
-- Preço null = "Preço a confirmar" (o criar_pedido recusa): dog-cbo-turbo.

insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem) values
  ('gran-burger', 'artesanais', 'Gran Burger', 25.90, 'lanche', 'gran-burger', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 1),
  ('gran-burger-bacon', 'artesanais', 'Gran Burger Bacon', 33.40, 'lanche', 'gran-burger-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon']::text[], 2),
  ('gran-salada', 'artesanais', 'Gran Salada', 26.90, 'lanche', 'gran-salada', array['Maionese grill', 'Cheddar cremoso', 'Mussarela', 'Barbecue', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 3),
  ('gran-egg', 'artesanais', 'Gran Egg', 30.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 4),
  ('gran-bacon', 'artesanais', 'Gran Bacon', 31.90, 'lanche', null, array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon em tiras', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 5),
  ('gran-egg-bacon', 'artesanais', 'Gran Egg Bacon', 33.90, 'lanche', 'gran-egg-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 6),
  ('gran-big-tudo', 'artesanais', 'Gran Big Tudo', 34.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 7),
  ('gran-black', 'artesanais', 'Gran Black', 35.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 8),
  ('gran-big-mineiro', 'artesanais', 'Gran Big Mineiro', 36.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Presunto', 'Azeite e sal']::text[], 9),
  ('gran-chicken', 'artesanais', 'Gran Chicken', 24.90, 'lanche', 'gran-chicken', array['Cheddar', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 10),
  ('gran-bacon-onion', 'artesanais', 'Gran Bacon Onion', 34.90, 'lanche', 'gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '3 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 11),
  ('gran-crispy', 'artesanais', 'Gran Crispy', 27.90, 'lanche', 'gran-crispy', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Cebola caramelizada', 'Cebola crispy']::text[], 12),
  ('x-burguer', 'tradicionais', 'X-Burguer', 16.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 13),
  ('x-salada', 'tradicionais', 'X-Salada', 19.90, 'lanche', 'x-salada', array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 14),
  ('mega-x-salada-egg', 'tradicionais', 'Mega X-Salada Egg', 21.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo']::text[], 15),
  ('ultra-x-salada-bacon', 'tradicionais', 'Ultra X-Salada Bacon', 23.90, 'lanche', 'ultra-x-salada-bacon', array['Cheddar cremoso', 'Mussarela', 'Bacon', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 16),
  ('exagerado-x-salada-egg-bacon', 'tradicionais', 'Exagerado X-Salada Egg Bacon', 27.90, 'lanche', 'exagerado-x-salada-egg-bacon', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon', 'Ovo', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 17),
  ('big-tudo', 'tradicionais', 'Big Tudo', 28.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon', 'Batata palha']::text[], 18),
  ('black-master', 'tradicionais', 'Black Master', 29.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon']::text[], 19),
  ('big-mineiro', 'tradicionais', 'Big Mineiro', 30.90, 'lanche', 'big-mineiro', array['Mussarela', 'Presunto', 'Ovo', 'Bacon', 'Maionese', 'Barbecue', 'Batata palha', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 20),
  ('dog-medio', 'hotdog', 'Hot Dog Médio', 13.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 21),
  ('dog-medio-frango', 'hotdog', 'Hot Dog Médio Frango', 19.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 22),
  ('dog-max', 'hotdog', 'Hot Dog Max', 15.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 23),
  ('dog-max-frango', 'hotdog', 'Hot Dog Max Frango', 21.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 24),
  ('dog-super', 'hotdog', 'Hot Dog Super', 18.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 25),
  ('dog-super-frango', 'hotdog', 'Hot Dog Super Frango', 24.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 26),
  ('dog-doritos', 'hotdog', 'Dog com Doritos', 23.90, 'lanche', 'dog-doritos', array['Doritos', 'Cheddar']::text[], 27),
  ('dog-pizza', 'hotdog', 'Hot Dog Pizza', 26.40, 'lanche', 'dog-pizza', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry', 'Queijo gratinado', 'Orégano']::text[], 28),
  ('dog-cbo-turbo', 'hotdog', 'Hot Dog CBO Turbo', null, 'lanche', 'dog-cbo-turbo', array['Maionese', 'Ketchup', 'Alface', 'Azeite e sal', 'Purê de batata', 'Batata palha', 'Cheddar', 'Catupiry', 'Mussarela gratinada', 'Bacon']::text[], 29),
  ('carne-maluca', 'baguetes', 'Carne Maluca', 26.90, 'lanche', null, array['Maionese', 'Barbecue', 'Milho', 'Batata palha', 'Vinagrete com cebola', 'Purê', 'Requeijão', 'Cheddar']::text[], 30),
  ('x-frango', 'baguetes', 'X-Frango', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 31),
  ('x-frango-egg-bacon', 'baguetes', 'X-Frango Egg Bacon', 29.90, 'lanche', null, array['Queijo', 'Purê', 'Ovo', 'Bacon', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 32),
  ('x-calabresa', 'baguetes', 'X-Calabresa', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 33),
  ('x-churrasco', 'baguetes', 'X-Churrasco', 28.90, 'lanche', 'x-churrasco', array['Maionese', 'Barbecue', 'Vinagrete', 'Mussarela', 'Purê de batata', 'Batata palha', 'Cheddar', 'Requeijão']::text[], 34),
  ('americano', 'baguetes', 'Americano', 21.90, 'lanche', null, array['Maionese', 'Mussarela', 'Presunto', 'Ovo', 'Tomate', 'Alface', 'Azeite e sal']::text[], 35),
  ('combo-diluvio', 'combos', 'Combo Dilúvio', 49.90, 'combo', 'combo-diluvio', array['Piscininha de cheddar', 'Farofinha de bacon']::text[], 36),
  ('combo-casal', 'combos', 'Combo Casal', 99.90, 'combo', 'combo-casal', '{}'::text[], 37),
  ('gran-bacon-coca-maionese', 'combos', 'Gran Bacon + Coca 350 ml + Maionese da casa', 42.90, 'combo', 'gran-bacon-maionese', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 38),
  ('combo-2-dog-doritos', 'combos', 'Combo 2 Hot Dog com Doritos', 57.80, 'combo', 'combo-2-dog-doritos', array['Doritos', 'Cheddar']::text[], 39),
  ('combo-gran-burger', 'combos', 'Combo Gran Burger', 39.90, 'combo', null, array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue']::text[], 40),
  ('combo-gran-bacon', 'combos', 'Combo Gran Bacon', 45.90, 'combo', null, array['Mussarela', 'Cheddar', 'Bacon', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate']::text[], 41),
  ('combo-gran-salada', 'combos', 'Combo Gran Salada', 42.90, 'combo', null, array['Mussarela', 'Cheddar', 'Alface americano', 'Tomate', 'Cebola roxa', 'Maionese', 'Barbecue']::text[], 42),
  ('combo-gran-bacon-onion', 'combos', 'Combo Gran Bacon Onion', 48.90, 'combo', 'combo-gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '3 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 43),
  ('combo-hot-dog-max', 'combos', 'Combo Hot Dog Max', 29.90, 'combo', null, array['Alface', 'Purê', 'Batata palha', 'Ketchup', 'Cheddar', 'Catupiry']::text[], 44),
  ('combo-x-frango', 'combos', 'Combo X-Frango', 39.90, 'combo', null, array['Mussarela', 'Maionese', 'Barbecue', 'Vinagrete', 'Purê', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 45),
  ('combo-gran-chicken', 'combos', 'Combo Gran Chicken', 38.90, 'combo', null, array['Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 46),
  ('porcao-batata', 'porcoes', 'Porção de batata turbinada', 39.90, 'porcao', null, '{}'::text[], 47),
  ('porcao-onion', 'porcoes', 'Porção de onion', 14.90, 'porcao', null, '{}'::text[], 48),
  ('refri-lata', 'bebidas', 'Refrigerante lata', 8.00, 'bebida', null, '{}'::text[], 49),
  ('refri-600', 'bebidas', 'Refrigerante 600 ml', 12.00, 'bebida', null, '{}'::text[], 50),
  ('refri-1l', 'bebidas', 'Refrigerante 1 litro', 14.00, 'bebida', null, '{}'::text[], 51),
  ('refri-dolly', 'bebidas', 'Refrigerante Dolly', 4.50, 'bebida', null, '{}'::text[], 52),
  ('suco-lata', 'bebidas', 'Suco lata', 7.00, 'bebida', null, '{}'::text[], 53),
  ('suco-1l', 'bebidas', 'Suco 1 litro', 11.00, 'bebida', null, '{}'::text[], 54),
  ('agua', 'bebidas', 'Água', 4.00, 'bebida', null, '{}'::text[], 55),
  ('h2o', 'bebidas', 'H2O', 8.00, 'bebida', null, '{}'::text[], 56)
on conflict (id) do update set
  categoria = excluded.categoria,
  nome = excluded.nome,
  preco = excluded.preco,
  tipo = excluded.tipo,
  foto = excluded.foto,
  ingredientes = excluded.ingredientes,
  ordem = excluded.ordem,
  ativo = true;

-- o que saiu do CONFIG fica inativo (pedidos antigos continuam apontando para ele)
update public.produtos set ativo = false
where ativo and id not in ('gran-burger', 'gran-burger-bacon', 'gran-salada', 'gran-egg', 'gran-bacon', 'gran-egg-bacon', 'gran-big-tudo', 'gran-black', 'gran-big-mineiro', 'gran-chicken', 'gran-bacon-onion', 'gran-crispy', 'x-burguer', 'x-salada', 'mega-x-salada-egg', 'ultra-x-salada-bacon', 'exagerado-x-salada-egg-bacon', 'big-tudo', 'black-master', 'big-mineiro', 'dog-medio', 'dog-medio-frango', 'dog-max', 'dog-max-frango', 'dog-super', 'dog-super-frango', 'dog-doritos', 'dog-pizza', 'dog-cbo-turbo', 'carne-maluca', 'x-frango', 'x-frango-egg-bacon', 'x-calabresa', 'x-churrasco', 'americano', 'combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos', 'combo-gran-burger', 'combo-gran-bacon', 'combo-gran-salada', 'combo-gran-bacon-onion', 'combo-hot-dog-max', 'combo-x-frango', 'combo-gran-chicken', 'porcao-batata', 'porcao-onion', 'refri-lata', 'refri-600', 'refri-1l', 'refri-dolly', 'suco-lata', 'suco-1l', 'agua', 'h2o');

insert into public.adicionais (id, nome, preco) values
  ('catupiry', 'Catupiry', 7.50),
  ('bacon', 'Bacon', 7.50),
  ('doritos', 'Doritos', 7.50),
  ('queijo', 'Queijo', 7.50),
  ('pizza', 'Pizza', 7.50)
on conflict (id) do update set
  nome = excluded.nome,
  preco = excluded.preco,
  ativo = true;

update public.adicionais set ativo = false
where ativo and id not in ('catupiry', 'bacon', 'doritos', 'queijo', 'pizza');

-- loja: cria se não existir; depois só horarios, combo_preco e taxa de entrega vêm do CONFIG (modo e aceita_fechada são do painel)
insert into public.loja (id, modo, aceita_fechada, combo_preco, taxa_km, taxa_fixa, horarios)
values (1, 'auto', false, 14.90, 1.00, 4.00, '{"0":["19:00","01:00"],"1":["19:00","00:00"],"2":["19:00","00:00"],"3":null,"4":["19:00","00:00"],"5":["19:00","01:00"],"6":["19:00","01:00"]}'::jsonb)
on conflict (id) do update set
  horarios = excluded.horarios,
  combo_preco = excluded.combo_preco,
  taxa_km = excluded.taxa_km,
  taxa_fixa = excluded.taxa_fixa;
