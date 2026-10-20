-- Cardápio do Mineiro Lanche: gerado por scripts/gerar-seed.mjs a partir do CONFIG de src/core.js. Não edite à mão.
-- 57 produtos e 5 adicionais. Idempotente: atualiza nome, preço, categoria, ordem,
-- ingredientes, tipo e foto pelo id, sem mexer em esgotado_dia. O CONFIG manda no ativo: quem está nele fica
-- ativo (um item que saiu e voltou é reativado); quem saiu fica inativo. Itens editados/criados
-- no painel são preservados integralmente, inclusive disponibilidade, preço e categoria.
-- Preço null = "Preço a confirmar" (o criar_pedido recusa): nenhum.

insert into public.categorias_produtos (id, label, icone, descricao, ordem) values
  ('testes', 'Teste de pagamento', 'sacola', 'Item temporário para validar o pagamento online', 0),
  ('artesanais', 'Artesanais', 'burger', 'Hambúrguer artesanal de 200 g', 1),
  ('tradicionais', 'Tradicionais', 'burger', 'Os clássicos da chapa', 2),
  ('hotdog', 'Hot dog', 'hotdog', 'Salsicha Perdigão · Dog Bacon ou Dog Pizza: qualquer dog com o adicional Bacon ou Pizza', 3),
  ('baguetes', 'Baguetes', 'baguete', 'Na baguete, do jeito mineiro', 4),
  ('combos', 'Combos', 'combo', 'Lanche, batata e bebida', 5),
  ('porcoes', 'Porções', 'batata', 'Pra dividir', 6),
  ('bebidas', 'Bebidas', 'lata', 'Geladas', 7)
on conflict (id) do nothing;

insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem, detalhes) values
  ('teste-pagamento', 'testes', 'Teste de pagamento (temporário)', 1.00, 'porcao', null, '{}'::text[], 1, '{"base":"Somente validação do pagamento. Não é um alimento. Selecione retirada no local.","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-burger', 'artesanais', 'Gran Burger', 25.90, 'lanche', 'gran-burger', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 2, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-burger-bacon', 'artesanais', 'Gran Burger Bacon', 33.40, 'lanche', 'gran-burger-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon']::text[], 3, '{"base":"Gran Burger com bacon","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-salada', 'artesanais', 'Gran Salada', 26.90, 'lanche', 'gran-salada', array['Maionese grill', 'Cheddar cremoso', 'Mussarela', 'Barbecue', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 4, '{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-egg', 'artesanais', 'Gran Egg', 30.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 5, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-bacon', 'artesanais', 'Gran Bacon', 31.90, 'lanche', null, array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon em tiras', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 6, '{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-egg-bacon', 'artesanais', 'Gran Egg Bacon', 33.90, 'lanche', 'gran-egg-bacon', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 7, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-big-tudo', 'artesanais', 'Gran Big Tudo', 34.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 8, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-black', 'artesanais', 'Gran Black', 35.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 9, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-big-mineiro', 'artesanais', 'Gran Big Mineiro', 36.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Presunto', 'Azeite e sal']::text[], 10, '{"base":"Pão e hambúrguer artesanal 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-chicken', 'artesanais', 'Gran Chicken', 24.90, 'lanche', 'gran-chicken', array['Cheddar', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 11, '{"base":"Pão de brioche e hambúrguer de frango empanado","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-bacon-onion', 'artesanais', 'Gran Bacon Onion', 34.90, 'lanche', 'gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 12, '{"base":"Pão seladinho na chapa e hambúrguer angus 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-crispy', 'artesanais', 'Gran Crispy', 27.90, 'lanche', 'gran-crispy', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Cebola caramelizada', 'Cebola crispy']::text[], 13, '{"base":"Pão de brioche e hambúrguer 200 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-burguer', 'tradicionais', 'X-Burguer', 16.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue']::text[], 14, '{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-salada', 'tradicionais', 'X-Salada', 19.90, 'lanche', 'x-salada', array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 15, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('mega-x-salada-egg', 'tradicionais', 'Mega X-Salada Egg', 21.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo']::text[], 16, '{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('ultra-x-salada-bacon', 'tradicionais', 'Ultra X-Salada Bacon', 23.90, 'lanche', 'ultra-x-salada-bacon', array['Cheddar cremoso', 'Mussarela', 'Bacon', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 17, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('exagerado-x-salada-egg-bacon', 'tradicionais', 'Exagerado X-Salada Egg Bacon', 27.90, 'lanche', 'exagerado-x-salada-egg-bacon', array['Maionese', 'Barbecue', 'Cheddar cremoso', 'Mussarela', 'Bacon', 'Ovo', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 18, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('big-tudo', 'tradicionais', 'Big Tudo', 28.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon', 'Batata palha']::text[], 19, '{"base":"Pão e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('black-master', 'tradicionais', 'Black Master', 29.90, 'lanche', null, array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon']::text[], 20, '{"base":"Pão australiano e hambúrguer","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('big-mineiro', 'tradicionais', 'Big Mineiro', 30.90, 'lanche', 'big-mineiro', array['Mussarela', 'Presunto', 'Ovo', 'Bacon', 'Maionese', 'Barbecue', 'Batata palha', 'Alface', 'Vinagrete', 'Azeite e sal']::text[], 21, '{"base":"Pão de hambúrguer e hambúrguer 90 g","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-medio', 'hotdog', 'Hot Dog Médio', 13.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 22, '{"base":"Pão médio e 1 salsicha Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-medio-frango', 'hotdog', 'Hot Dog Médio Frango', 19.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 23, '{"base":"Pão e 1 salsicha","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-max', 'hotdog', 'Hot Dog Max', 15.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 24, '{"base":"Pão médio e 2 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-max-frango', 'hotdog', 'Hot Dog Max Frango', 21.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 25, '{"base":"Pão e 2 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-super', 'hotdog', 'Hot Dog Super', 18.90, 'lanche', 'dog-max', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 26, '{"base":"Pão médio e 3 salsichas Perdigão","nota":"Dog Bacon ou Dog Pizza: escolha o adicional Bacon ou Pizza (queijo gratinado e orégano) aqui embaixo.","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-super-frango', 'hotdog', 'Hot Dog Super Frango', 24.90, 'lanche', null, array['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal']::text[], 27, '{"base":"Pão e 3 salsichas","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-doritos', 'hotdog', 'Dog com Doritos', 23.90, 'lanche', 'dog-doritos', array['Doritos', 'Cheddar']::text[], 28, '{"base":"O hot dog com Doritos da casa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-pizza', 'hotdog', 'Hot Dog Pizza', 26.40, 'lanche', 'dog-pizza', array['Maionese', 'Ketchup', 'Alface', 'Purê de batata', 'Azeite e sal', 'Batata palha', 'Cheddar', 'Catupiry', 'Queijo gratinado', 'Orégano']::text[], 29, '{"base":"Hot Dog Super (3 salsichas Perdigão) com o adicional Pizza","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('dog-cbo-turbo', 'hotdog', 'Hot Dog CBO Turbo', 34.90, 'lanche', 'dog-cbo-turbo', array['Maionese', 'Ketchup', 'Alface', 'Azeite e sal', 'Purê de batata', 'Batata palha', 'Cheddar', 'Catupiry', 'Mussarela gratinada', 'Bacon']::text[], 30, '{"base":"Pão de dog e 3 salsichas Perdigão","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('carne-maluca', 'baguetes', 'Carne Maluca', 26.90, 'lanche', null, array['Maionese', 'Barbecue', 'Milho', 'Batata palha', 'Vinagrete com cebola', 'Purê', 'Requeijão', 'Cheddar']::text[], 31, '{"base":"Baguete e carne desfiada","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-frango', 'baguetes', 'X-Frango', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 32, '{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-frango-egg-bacon', 'baguetes', 'X-Frango Egg Bacon', 29.90, 'lanche', null, array['Queijo', 'Purê', 'Ovo', 'Bacon', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 33, '{"base":"Baguete e filé de frango","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-calabresa', 'baguetes', 'X-Calabresa', 25.90, 'lanche', null, array['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal']::text[], 34, '{"base":"Baguete e calabresa","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('x-churrasco', 'baguetes', 'X-Churrasco', 28.90, 'lanche', 'x-churrasco', array['Maionese', 'Barbecue', 'Vinagrete', 'Mussarela', 'Purê de batata', 'Batata palha', 'Cheddar', 'Requeijão']::text[], 35, '{"base":"Pão de baguete e contra-filé","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('americano', 'baguetes', 'Americano', 21.90, 'lanche', null, array['Maionese', 'Mussarela', 'Presunto', 'Ovo', 'Tomate', 'Alface', 'Azeite e sal']::text[], 36, '{"base":"Baguete","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-diluvio', 'combos', 'Combo Dilúvio', 49.90, 'combo', 'combo-diluvio', array['Piscininha de cheddar', 'Farofinha de bacon']::text[], 37, '{"base":"","nota":"Pergunte pelo WhatsApp quantos lanches vêm.","inclui":["Gran Burgers na piscininha de cheddar","Farofinha de bacon","140 g de batata frita","Refrigerante lata 350 ml (qualquer um)"],"sabor":false,"escolheRefri":true}'::jsonb),
  ('combo-casal', 'combos', 'Combo Casal', 99.90, 'combo', 'combo-casal', '{}'::text[], 38, '{"base":"","nota":"Na foto: 2 lanches e batata com calabresa, cheddar, maionese e cebola crispy. Pergunte pelo WhatsApp quais lanches vêm.","inclui":["2 lanches","Porção de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('gran-bacon-coca-maionese', 'combos', 'Gran Bacon + Coca 350 ml + Maionese da casa', 42.90, 'combo', 'gran-bacon-maionese', array['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal']::text[], 39, '{"base":"","nota":"","inclui":["Gran Bacon","Coca-Cola 350 ml","Maionese artesanal da casa"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-2-dog-doritos', 'combos', 'Combo 2 Hot Dog com Doritos', 57.80, 'combo', 'combo-2-dog-doritos', array['Doritos', 'Cheddar']::text[], 40, '{"base":"","nota":"","inclui":["2 Hot Dog com Doritos","Coca-Cola 600 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-burger', 'combos', 'Combo Gran Burger', 39.90, 'combo', null, array['Mussarela', 'Cheddar', 'Maionese', 'Barbecue']::text[], 41, '{"base":"","nota":"","inclui":["Gran Burger (brioche, 200 g de carne angus, mussarela, cheddar, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-bacon', 'combos', 'Combo Gran Bacon', 45.90, 'combo', null, array['Mussarela', 'Cheddar', 'Bacon', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate']::text[], 42, '{"base":"","nota":"","inclui":["Gran Bacon (brioche, 200 g de carne angus, mussarela, cheddar, bacon, maionese, barbecue, alface americano e tomate)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-salada', 'combos', 'Combo Gran Salada', 42.90, 'combo', null, array['Mussarela', 'Cheddar', 'Alface americano', 'Tomate', 'Cebola roxa', 'Maionese', 'Barbecue']::text[], 43, '{"base":"","nota":"","inclui":["Gran Salada (brioche, 200 g de carne angus, mussarela, cheddar, alface americano, tomate, cebola roxa, maionese e barbecue)","Coca-Cola 350 ml","250 g de batata"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-bacon-onion', 'combos', 'Combo Gran Bacon Onion', 48.90, 'combo', 'combo-gran-bacon-onion', array['Maionese grill', 'Barbecue', 'Cheddar cremoso', 'Bacon em fatias', '2 onion rings', 'Alface americana', 'Tomate em rodelas', 'Cebola roxa']::text[], 44, '{"base":"","nota":"","inclui":["Gran Bacon Onion (angus 200 g, maionese grill, barbecue, cheddar cremoso, bacon em fatias, 2 onion rings, alface americana, tomate em rodelas e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-hot-dog-max', 'combos', 'Combo Hot Dog Max', 29.90, 'combo', null, array['Alface', 'Purê', 'Batata palha', 'Ketchup', 'Cheddar', 'Catupiry']::text[], 45, '{"base":"","nota":"","inclui":["Hot dog médio com 2 salsichas, alface, purê, batata palha, ketchup, cheddar e catupiry","250 g de batata frita","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-x-frango', 'combos', 'Combo X-Frango', 39.90, 'combo', null, array['Mussarela', 'Maionese', 'Barbecue', 'Vinagrete', 'Purê', 'Batata palha', 'Cheddar', 'Catupiry']::text[], 46, '{"base":"","nota":"","inclui":["X-Frango na baguete (filé de frango, mussarela, maionese, barbecue, vinagrete, purê, batata palha, cheddar e catupiry)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('combo-gran-chicken', 'combos', 'Combo Gran Chicken', 38.90, 'combo', null, array['Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa']::text[], 47, '{"base":"","nota":"","inclui":["Gran Chicken (brioche, frango empanado, maionese, barbecue, alface americano, tomate e cebola roxa)","250 g de batata","Coca-Cola 350 ml"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('porcao-batata', 'porcoes', 'Porção de batata turbinada', 39.90, 'porcao', null, '{}'::text[], 48, '{"base":"","nota":"","inclui":["500 g de batata frita","Cheddar cremoso","Bacon","Requeijão","Calabresa","Alho-poró"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('porcao-onion', 'porcoes', 'Porção de onion', 14.90, 'porcao', null, '{}'::text[], 49, '{"base":"","nota":"","inclui":["6 onion rings"],"sabor":false,"escolheRefri":false}'::jsonb),
  ('refri-lata', 'bebidas', 'Refrigerante lata', 8.00, 'bebida', null, '{}'::text[], 50, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('refri-600', 'bebidas', 'Refrigerante 600 ml', 12.00, 'bebida', null, '{}'::text[], 51, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('refri-1l', 'bebidas', 'Refrigerante 1 litro', 14.00, 'bebida', null, '{}'::text[], 52, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('refri-dolly', 'bebidas', 'Refrigerante Dolly', 4.50, 'bebida', null, '{}'::text[], 53, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('suco-lata', 'bebidas', 'Suco lata', 7.00, 'bebida', null, '{}'::text[], 54, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('suco-1l', 'bebidas', 'Suco 1 litro', 11.00, 'bebida', null, '{}'::text[], 55, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb),
  ('agua', 'bebidas', 'Água', 4.00, 'bebida', null, '{}'::text[], 56, '{"base":"","nota":"","inclui":[],"sabor":false,"escolheRefri":false}'::jsonb),
  ('h2o', 'bebidas', 'H2O', 8.00, 'bebida', null, '{}'::text[], 57, '{"base":"","nota":"","inclui":[],"sabor":true,"escolheRefri":false}'::jsonb)
on conflict (id) do update set
  categoria = excluded.categoria,
  nome = excluded.nome,
  preco = excluded.preco,
  tipo = excluded.tipo,
  foto = excluded.foto,
  ingredientes = excluded.ingredientes,
  detalhes = excluded.detalhes,
  ordem = excluded.ordem,
  ativo = true
where not public.produtos.editado_painel;

-- o que saiu do CONFIG fica inativo (pedidos antigos continuam apontando para ele)
update public.produtos set ativo = false
where ativo and not editado_painel and id not in ('teste-pagamento', 'gran-burger', 'gran-burger-bacon', 'gran-salada', 'gran-egg', 'gran-bacon', 'gran-egg-bacon', 'gran-big-tudo', 'gran-black', 'gran-big-mineiro', 'gran-chicken', 'gran-bacon-onion', 'gran-crispy', 'x-burguer', 'x-salada', 'mega-x-salada-egg', 'ultra-x-salada-bacon', 'exagerado-x-salada-egg-bacon', 'big-tudo', 'black-master', 'big-mineiro', 'dog-medio', 'dog-medio-frango', 'dog-max', 'dog-max-frango', 'dog-super', 'dog-super-frango', 'dog-doritos', 'dog-pizza', 'dog-cbo-turbo', 'carne-maluca', 'x-frango', 'x-frango-egg-bacon', 'x-calabresa', 'x-churrasco', 'americano', 'combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos', 'combo-gran-burger', 'combo-gran-bacon', 'combo-gran-salada', 'combo-gran-bacon-onion', 'combo-hot-dog-max', 'combo-x-frango', 'combo-gran-chicken', 'porcao-batata', 'porcao-onion', 'refri-lata', 'refri-600', 'refri-1l', 'refri-dolly', 'suco-lata', 'suco-1l', 'agua', 'h2o');

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
