/* Mineiro Lanche · núcleo compartilhado entre cardápio, site e painel.
   Expõe window.ML: CONFIG (cardápio e regras), preços, horário e mensagem de WhatsApp. Os pedidos vivem no servidor:
   as entradas trocam ML.store pela store do Supabase (src/lib/store-supabase.js).
   Fontes: cardápio impresso enviado pelo dono, legendas de 02/10/2026 e Instagram @mineirolanchesuzano.
   Fica como script clássico (IIFE, sem import/export): as entradas o importam só pelo efeito e
   scripts/gerar-seed.mjs o avalia com node:vm para gerar o seed do banco. */
(function () {
  'use strict';

  // ================= CONFIG: tudo que é do Mineiro Lanche =================
  var CONFIG = {
    nome: 'Mineiro Lanche',
    tipo: 'food truck',
    cidade: 'Suzano',
    regiao: 'Centro, Suzano',
    whatsapp: '5511985720150',
    whatsappTexto: '(11) 98572-0150',
    instagram: 'https://www.instagram.com/mineirolanchesuzano/',
    bio: ['Hambúrguer artesanal', 'Hot dog com Doritos', 'Consumo no local', 'Entregas'],
    frases: {
      fome: 'Quando bater aquela fome, chama o Mineiro Lanche!',
      cheddar: 'Diretamente pros amantes de cheddar!',
      regiao: 'Suzano e região'
    },
    // 0 = domingo. Domingo não informado (a bio diz "todos os dias"): null = a confirmar.
    horarios: { 0: null, 1: ['19:00', '00:00'], 2: ['19:00', '00:00'], 3: ['19:00', '00:00'], 4: ['19:00', '00:00'], 5: ['19:00', '01:00'], 6: ['19:00', '01:00'] },
    horarioTexto: ['Segunda a quinta, das 19h à meia-noite', 'Sexta e sábado, das 19h à 1h', 'Domingo: a confirmar'],
    modos: [
      { id: 'entrega', label: 'Entrega', desc: 'Suzano e região · taxa combinada' },
      { id: 'local', label: 'Comer no local', desc: 'Consumo no truck' }
    ],
    pagamentos: null, // a confirmar; ex.: ['Pix', 'Cartão', 'Dinheiro']
    regras: {
      combo: { preco: 14.90, inclui: ['Batata frita 140 g', 'Refrigerante lata 350 ml'], refris: null }, // sabores a confirmar
      prensado: { preco: 0, texto: 'Não cobramos para prensar' }
    },
    adicionais: [
      { id: 'catupiry', nome: 'Catupiry', preco: 7.50 },
      { id: 'bacon', nome: 'Bacon', preco: 7.50 },
      { id: 'doritos', nome: 'Doritos', preco: 7.50 },
      { id: 'queijo', nome: 'Queijo', preco: 7.50 },
      { id: 'pizza', nome: 'Pizza', preco: 7.50 }
    ],
    // tipo: lanche (vira combo, prensado, tirar item, adicionais) | combo (prensado, tirar item, adicionais) | porcao | bebida
    // foto: nome do arquivo em /assets/fotos (sem tamanho); recorte: /assets/recortes/<nome>.webp quando existe
    categorias: [
      { id: 'artesanais', label: 'Artesanais', icone: 'burger', desc: 'Hambúrguer artesanal de 200 g', itens: [
        { id: 'gran-burger', nome: 'Gran Burger', preco: 25.90, tipo: 'lanche', foto: 'gran-burger', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-burger-bacon', nome: 'Gran Burger Bacon', preco: 33.40, tipo: 'lanche', foto: 'gran-burger-bacon', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon'], base: 'Gran Burger com bacon' },
        { id: 'gran-salada', nome: 'Gran Salada', preco: 26.90, tipo: 'lanche', foto: 'gran-salada', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-egg', nome: 'Gran Egg', preco: 30.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-bacon', nome: 'Gran Bacon', preco: 31.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-egg-bacon', nome: 'Gran Egg Bacon', preco: 33.90, tipo: 'lanche', foto: 'gran-egg-bacon', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Ovo', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-big-tudo', nome: 'Gran Big Tudo', preco: 34.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-black', nome: 'Gran Black', preco: 35.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Tomate', 'Cebola roxa', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-big-mineiro', nome: 'Gran Big Mineiro', preco: 36.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Bacon', 'Ovo', 'Requeijão', 'Batata palha', 'Tomate', 'Cebola roxa', 'Presunto', 'Azeite e sal'], base: 'Pão e hambúrguer artesanal 200 g' },
        { id: 'gran-chicken', nome: 'Gran Chicken', preco: 24.90, tipo: 'lanche', foto: 'gran-chicken', ing: ['Cheddar', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa'], base: 'Pão de brioche e hambúrguer de frango empanado' },
        { id: 'gran-bacon-onion', nome: 'Gran Bacon Onion', preco: 34.90, tipo: 'lanche', foto: 'gran-bacon-onion', ing: ['Maionese', 'Barbecue', '3 onion rings', 'Cheddar cremoso', 'Mussarela', 'Bacon', 'Alface americano', 'Tomate', 'Cebola roxa'], base: 'Pão de brioche e hambúrguer 200 g' },
        { id: 'gran-crispy', nome: 'Gran Crispy', preco: 27.90, tipo: 'lanche', foto: 'gran-crispy', ing: ['Maionese', 'Barbecue', 'Cheddar cremoso', 'Cebola caramelizada', 'Cebola crispy'], base: 'Pão de brioche e hambúrguer 200 g' }
      ] },
      { id: 'tradicionais', label: 'Tradicionais', icone: 'burger', desc: 'Os clássicos da chapa', itens: [
        { id: 'x-burguer', nome: 'X-Burguer', preco: 16.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue'], base: 'Pão e hambúrguer' },
        { id: 'x-salada', nome: 'X-Salada', preco: 19.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal'], base: 'Pão e hambúrguer' },
        { id: 'mega-x-salada-egg', nome: 'Mega X-Salada Egg', preco: 21.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo'], base: 'Pão e hambúrguer' },
        { id: 'ultra-x-salada-bacon', nome: 'Ultra X-Salada Bacon', preco: 23.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Bacon'], base: 'Pão e hambúrguer' },
        { id: 'exagerado-x-salada-egg-bacon', nome: 'Exagerado X-Salada Egg Bacon', preco: 27.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Ovo', 'Bacon'], base: 'Pão e hambúrguer' },
        { id: 'big-tudo', nome: 'Big Tudo', preco: 28.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon', 'Batata palha'], base: 'Pão e hambúrguer' },
        { id: 'black-master', nome: 'Black Master', preco: 29.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Bacon'], base: 'Pão australiano e hambúrguer' },
        { id: 'big-mineiro', nome: 'Big Mineiro', preco: 30.90, tipo: 'lanche', ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Alface', 'Vinagrete com cebola', 'Azeite e sal', 'Requeijão', 'Ovo', 'Presunto', 'Bacon', 'Batata palha'], base: 'Pão e hambúrguer' }
      ] },
      { id: 'hotdog', label: 'Hot dog', icone: 'hotdog', desc: 'Salsicha Perdigão', itens: [
        { id: 'dog-medio', nome: 'Hot Dog Médio', preco: 13.90, tipo: 'lanche', ing: ['Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal'], base: 'Pão e 1 salsicha' },
        { id: 'dog-medio-frango', nome: 'Hot Dog Médio Frango', preco: 19.90, tipo: 'lanche', ing: ['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal'], base: 'Pão e 1 salsicha' },
        { id: 'dog-max', nome: 'Hot Dog Max', preco: 15.90, tipo: 'lanche', ing: ['Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal'], base: 'Pão e 2 salsichas' },
        { id: 'dog-max-frango', nome: 'Hot Dog Max Frango', preco: 21.90, tipo: 'lanche', ing: ['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal'], base: 'Pão e 2 salsichas' },
        { id: 'dog-super', nome: 'Hot Dog Super', preco: 18.90, tipo: 'lanche', ing: ['Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal'], base: 'Pão e 3 salsichas' },
        { id: 'dog-super-frango', nome: 'Hot Dog Super Frango', preco: 24.90, tipo: 'lanche', ing: ['Frango', 'Maionese', 'Ketchup', 'Alface', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Azeite e sal'], base: 'Pão e 3 salsichas' },
        { id: 'dog-doritos', nome: 'Dog com Doritos', preco: 23.90, tipo: 'lanche', foto: 'dog-doritos', ing: ['Doritos', 'Cheddar'], base: 'O hot dog com Doritos da casa' },
        { id: 'dog-pizza', nome: 'Hot Dog Pizza', preco: 26.40, tipo: 'lanche', foto: 'dog-pizza', ing: ['Queijo gratinado', 'Azeitona', 'Orégano'], base: 'Hot dog com cobertura de pizza', nota: 'Ingredientes a confirmar (na foto: queijo gratinado, azeitona e orégano).' }
      ] },
      { id: 'baguetes', label: 'Baguetes', icone: 'baguete', desc: 'Na baguete, do jeito mineiro', itens: [
        { id: 'carne-maluca', nome: 'Carne Maluca', preco: 26.90, tipo: 'lanche', ing: ['Maionese', 'Barbecue', 'Milho', 'Batata palha', 'Vinagrete com cebola', 'Purê', 'Requeijão', 'Cheddar'], base: 'Baguete e carne desfiada' },
        { id: 'x-frango', nome: 'X-Frango', preco: 25.90, tipo: 'lanche', ing: ['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal'], base: 'Baguete e filé de frango' },
        { id: 'x-frango-egg-bacon', nome: 'X-Frango Egg Bacon', preco: 29.90, tipo: 'lanche', ing: ['Queijo', 'Purê', 'Ovo', 'Bacon', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal'], base: 'Baguete e filé de frango' },
        { id: 'x-calabresa', nome: 'X-Calabresa', preco: 25.90, tipo: 'lanche', ing: ['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal'], base: 'Baguete e calabresa' },
        { id: 'x-churrasco', nome: 'X-Churrasco', preco: 28.90, tipo: 'lanche', ing: ['Queijo', 'Purê', 'Batata palha', 'Cheddar', 'Requeijão', 'Vinagrete com cebola', 'Maionese', 'Barbecue', 'Azeite e sal'], base: 'Baguete e contra filé' },
        { id: 'americano', nome: 'Americano', preco: 21.90, tipo: 'lanche', ing: ['Maionese', 'Mussarela', 'Presunto', 'Ovo', 'Tomate', 'Alface', 'Azeite e sal'], base: 'Baguete' }
      ] },
      { id: 'combos', label: 'Combos', icone: 'combo', desc: 'Lanche, batata e bebida', itens: [
        { id: 'combo-diluvio', nome: 'Combo Dilúvio', preco: 49.90, tipo: 'combo', foto: 'combo-diluvio', inclui: ['Gran Burgers na piscininha de cheddar', 'Farofinha de bacon', '140 g de batata frita', 'Refrigerante lata 350 ml (qualquer um)'], escolheRefri: true, ing: ['Piscininha de cheddar', 'Farofinha de bacon'], nota: 'Mais de um lanche (foto: 2 burgers). Quantidade exata a confirmar.' },
        { id: 'combo-casal', nome: 'Combo Casal', preco: 99.90, tipo: 'combo', foto: 'combo-casal', inclui: ['2 lanches', 'Porção de batata'], ing: [], nota: 'Composição exata a confirmar. Na foto: 2 lanches e batata com calabresa, cheddar, maionese e cebola crispy.' },
        { id: 'gran-bacon-coca-maionese', nome: 'Gran Bacon + Coca 350 ml + Maionese da casa', preco: 42.90, tipo: 'combo', foto: 'gran-bacon-maionese', inclui: ['Gran Bacon', 'Coca-Cola 350 ml', 'Maionese artesanal da casa'], ing: ['Queijo', 'Cheddar', 'Maionese', 'Barbecue', 'Bacon', 'Alface', 'Tomate', 'Cebola roxa', 'Azeite e sal'] },
        { id: 'combo-2-dog-doritos', nome: 'Combo 2 Hot Dog com Doritos', preco: 57.80, tipo: 'combo', foto: 'combo-2-dog-doritos', inclui: ['2 Hot Dog com Doritos', 'Coca-Cola 600 ml'], ing: ['Doritos', 'Cheddar'] },
        { id: 'combo-gran-burger', nome: 'Combo Gran Burger', preco: 39.90, tipo: 'combo', inclui: ['Gran Burger (brioche, 200 g de carne angus, mussarela, cheddar, maionese e barbecue)', 'Coca-Cola 350 ml', '250 g de batata'], ing: ['Mussarela', 'Cheddar', 'Maionese', 'Barbecue'] },
        { id: 'combo-gran-bacon', nome: 'Combo Gran Bacon', preco: 45.90, tipo: 'combo', inclui: ['Gran Bacon (brioche, 200 g de carne angus, mussarela, cheddar, bacon, maionese, barbecue, alface americano e tomate)', 'Coca-Cola 350 ml', '250 g de batata'], ing: ['Mussarela', 'Cheddar', 'Bacon', 'Maionese', 'Barbecue', 'Alface americano', 'Tomate'] },
        { id: 'combo-gran-salada', nome: 'Combo Gran Salada', preco: 42.90, tipo: 'combo', inclui: ['Gran Salada (brioche, 200 g de carne angus, mussarela, cheddar, alface americano, tomate, cebola roxa, maionese e barbecue)', 'Coca-Cola 350 ml', '250 g de batata'], ing: ['Mussarela', 'Cheddar', 'Alface americano', 'Tomate', 'Cebola roxa', 'Maionese', 'Barbecue'] },
        { id: 'combo-gran-bacon-onion', nome: 'Combo Gran Bacon Onion', preco: 48.90, tipo: 'combo', inclui: ['Gran Bacon Onion (brioche, maionese, barbecue, 200 g de carne angus, mussarela, cheddar, bacon e 3 onion rings)', '250 g de batata', 'Coca-Cola 350 ml'], ing: ['Maionese', 'Barbecue', 'Mussarela', 'Cheddar', 'Bacon', '3 onion rings'] },
        { id: 'combo-hot-dog-max', nome: 'Combo Hot Dog Max', preco: 29.90, tipo: 'combo', inclui: ['Hot dog médio com 2 salsichas, alface, purê, batata palha, ketchup, cheddar e catupiri', '250 g de batata frita', 'Coca-Cola 350 ml'], ing: ['Alface', 'Purê', 'Batata palha', 'Ketchup', 'Cheddar', 'Catupiri'] },
        { id: 'combo-x-frango', nome: 'Combo X-Frango', preco: 39.90, tipo: 'combo', inclui: ['X-Frango na baguete (filé de frango, mussarela, maionese, barbecue, vinagrete, purê, batata palha, cheddar e catupiry)', '250 g de batata', 'Coca-Cola 350 ml'], ing: ['Mussarela', 'Maionese', 'Barbecue', 'Vinagrete', 'Purê', 'Batata palha', 'Cheddar', 'Catupiry'] },
        { id: 'combo-gran-chicken', nome: 'Combo Gran Chicken', preco: 38.90, tipo: 'combo', inclui: ['Gran Chicken (brioche, frango empanado, maionese, barbecue, alface americano, tomate e cebola roxa)', '250 g de batata', 'Coca-Cola 350 ml'], ing: ['Maionese', 'Barbecue', 'Alface americano', 'Tomate', 'Cebola roxa'] }
      ] },
      { id: 'porcoes', label: 'Porções', icone: 'batata', desc: 'Pra dividir', itens: [
        { id: 'porcao-batata', nome: 'Porção de batata', preco: 39.90, tipo: 'porcao', inclui: ['500 g de batata', 'Cheddar', 'Catupiri', 'Bacon', 'Calabresa'] },
        { id: 'porcao-onion', nome: 'Porção de onion', preco: 14.90, tipo: 'porcao', inclui: ['6 onion rings'] }
      ] },
      { id: 'bebidas', label: 'Bebidas', icone: 'lata', desc: 'Geladas', itens: [
        { id: 'refri-lata', nome: 'Refrigerante lata', preco: 8.00, tipo: 'bebida', sabor: true },
        { id: 'refri-600', nome: 'Refrigerante 600 ml', preco: 12.00, tipo: 'bebida', sabor: true },
        { id: 'refri-1l', nome: 'Refrigerante 1 litro', preco: 14.00, tipo: 'bebida', sabor: true },
        { id: 'refri-dolly', nome: 'Refrigerante Dolly', preco: 4.50, tipo: 'bebida', sabor: true },
        { id: 'suco-lata', nome: 'Suco lata', preco: 7.00, tipo: 'bebida', sabor: true },
        { id: 'suco-1l', nome: 'Suco 1 litro', preco: 11.00, tipo: 'bebida', sabor: true },
        { id: 'agua', nome: 'Água', preco: 4.00, tipo: 'bebida' },
        { id: 'h2o', nome: 'H2O', preco: 8.00, tipo: 'bebida', sabor: true }
      ] }
    ],
    destaques: ['gran-bacon-onion', 'gran-crispy', 'combo-diluvio', 'dog-doritos', 'gran-chicken', 'combo-casal']
  };

  // ================= utilidades =================
  var produtos = {};
  CONFIG.categorias.forEach(function (c) { c.itens.forEach(function (p) { p.cat = c.id; produtos[p.id] = p; }); });
  var adicionaisPorId = {};
  CONFIG.adicionais.forEach(function (a) { adicionaisPorId[a.id] = a; });

  function arred(v) { return Math.round(v * 100) / 100; }
  function brl(v) { return 'R$ ' + arred(v).toFixed(2).replace('.', ','); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n, t) { return String(n).padStart(t || 2, '0'); }
  function numeroTxt(n) { return '#' + pad(n, 4); }
  function podeCombo(p) { return p.tipo === 'lanche'; }
  function podePrensar(p) { return p.tipo === 'lanche' || p.tipo === 'combo'; }
  function podeAdicionais(p) { return p.tipo === 'lanche' || p.tipo === 'combo'; }

  // ================= preço e descrição de uma escolha =================
  // sel = { produtoId, completo, removidos[], prensado, combo: { ativo, refri }, adicionais: { id: qtd }, sabor, qtd }
  function normalizar(sel) {
    var p = produtos[sel.produtoId];
    var adic = {};
    Object.keys(sel.adicionais || {}).forEach(function (id) { var q = +sel.adicionais[id] || 0; if (q > 0 && adicionaisPorId[id]) adic[id] = q; });
    var removidos = (sel.completo === false ? (sel.removidos || []) : []).filter(function (r) { return (p.ing || []).indexOf(r) >= 0; }).sort();
    return {
      produtoId: p.id,
      completo: removidos.length === 0,
      removidos: removidos,
      prensado: podePrensar(p) ? !!sel.prensado : false,
      combo: podeCombo(p) && sel.combo && sel.combo.ativo ? { ativo: true, refri: (sel.combo.refri || '').trim() } : { ativo: false, refri: '' },
      adicionais: podeAdicionais(p) ? adic : {},
      sabor: (sel.sabor || '').trim(),
      qtd: Math.max(1, +sel.qtd || 1)
    };
  }
  function precoUnitario(sel) {
    var p = produtos[sel.produtoId], v = p.preco;
    if (sel.combo && sel.combo.ativo) v += CONFIG.regras.combo.preco;
    Object.keys(sel.adicionais || {}).forEach(function (id) { v += (sel.adicionais[id] || 0) * adicionaisPorId[id].preco; });
    return arred(v);
  }
  // mesma configuração = mesma chave (as linhas iguais se somam na sacola)
  function chave(sel) {
    var n = normalizar(sel);
    return [n.produtoId, n.removidos.join('+'), n.prensado ? 'P' : '', n.combo.ativo ? 'C:' + n.combo.refri.toLowerCase() : '',
      Object.keys(n.adicionais).sort().map(function (id) { return id + 'x' + n.adicionais[id]; }).join('+'), n.sabor.toLowerCase()].join('|');
  }
  function resumo(sel) {
    var p = produtos[sel.produtoId], partes = [];
    if (p.tipo === 'lanche' || p.tipo === 'combo') partes.push(sel.completo === false && sel.removidos && sel.removidos.length ? 'Sem ' + sel.removidos.join(', ').toLowerCase() : 'Completo');
    if (podePrensar(p)) partes.push(sel.prensado ? 'Prensado' : 'Não prensado');
    if (sel.combo && sel.combo.ativo) partes.push('Combo +' + brl(CONFIG.regras.combo.preco).replace('R$ ', 'R$') + (sel.combo.refri ? ' (' + sel.combo.refri + ')' : ''));
    Object.keys(sel.adicionais || {}).forEach(function (id) { var q = sel.adicionais[id]; partes.push('+ ' + (q > 1 ? q + '× ' : '') + adicionaisPorId[id].nome); });
    if (sel.sabor) partes.push(sel.sabor);
    return partes.join(' · ');
  }
  function itemDoPedido(sel) {
    var n = normalizar(sel), p = produtos[n.produtoId], unit = precoUnitario(n);
    return {
      chave: chave(n), produtoId: p.id, nome: p.nome, categoria: p.cat, tipo: p.tipo,
      precoBase: p.preco, precoUnit: unit, qtd: n.qtd,
      completo: n.completo, removidos: n.removidos, prensado: n.prensado, combo: n.combo,
      adicionais: Object.keys(n.adicionais).map(function (id) { return { id: id, nome: adicionaisPorId[id].nome, qtd: n.adicionais[id], preco: adicionaisPorId[id].preco }; }),
      sabor: n.sabor, resumo: resumo(n), subtotal: arred(unit * n.qtd)
    };
  }

  // ================= horário (America/Sao_Paulo) =================
  var DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function hm(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  var TURNOS = {};
  // monta os turnos do CONFIG.horarios; o banco pode mandar outros (estado_cardapio) e eles valem por cima
  function definirHorarios(horarios) {
    if (horarios) CONFIG.horarios = horarios;
    Object.keys(TURNOS).forEach(function (d) { delete TURNOS[d]; });
    for (var d = 0; d < 7; d++) {
      var h = CONFIG.horarios[d];
      if (!h) { TURNOS[d] = null; continue; }
      var a = hm(h[0]), f = hm(h[1]); if (f <= a) f += 1440;
      TURNOS[d] = { abre: a, fecha: f };
    }
  }
  definirHorarios();
  function agoraSP(data) {
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(data || new Date());
      var g = function (t) { return parts.filter(function (x) { return x.type === t; })[0].value; };
      return { dia: DIAS[g('weekday')], min: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10) };
    } catch { var d = data || new Date(); return { dia: d.getDay(), min: d.getHours() * 60 + d.getMinutes() }; }
  }
  function horaTxt(min) { min = ((min % 1440) + 1440) % 1440; if (min === 0) return 'meia-noite'; var h = Math.floor(min / 60), m = min % 60; return h + 'h' + (m ? pad(m) : ''); }
  function relogio(min) { return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60); }
  // aberto pelo turno de hoje ou pela sobra de madrugada do turno de ontem
  function situacaoNo(dia, min) {
    var hoje = TURNOS[dia], ontem = TURNOS[(dia + 6) % 7];
    if (hoje && min >= hoje.abre && min < hoje.fecha) return { aberto: true, ate: hoje.fecha, turnoDia: dia };
    if (ontem && ontem.fecha > 1440 && min < ontem.fecha - 1440) return { aberto: true, ate: ontem.fecha, turnoDia: (dia + 6) % 7 };
    return { aberto: false };
  }
  function situacao(data) {
    var a = agoraSP(data), s = situacaoNo(a.dia, a.min), loja = window.ML.store.loja();
    var base = { agora: a, manual: loja.modo !== 'auto' };
    if (loja.modo === 'fechada') return Object.assign(base, { aberto: false, txt: 'Fechado agora · o truck pausou os pedidos' });
    if (s.aberto) return Object.assign(base, { aberto: true, txt: 'Aberto agora · até ' + horaTxt(s.ate) });
    if (loja.modo === 'aberta') return Object.assign(base, { aberto: true, txt: 'Aberto agora (horário estendido)' });
    var hoje = TURNOS[a.dia];
    if (hoje && a.min < hoje.abre) return Object.assign(base, { aberto: false, txt: 'Fechado agora · abre hoje às ' + horaTxt(hoje.abre) });
    if (hoje === null && CONFIG.horarios[a.dia] === null) return Object.assign(base, { aberto: false, txt: 'Domingo: horário a confirmar', aConfirmar: true });
    for (var i = 1; i <= 7; i++) {
      var d = (a.dia + i) % 7, t = TURNOS[d];
      if (t) return Object.assign(base, { aberto: false, txt: 'Fechado agora · abre ' + (i === 1 ? 'amanhã' : NOMES_DIA[d]) + ' às ' + horaTxt(t.abre) });
    }
    return Object.assign(base, { aberto: false, txt: 'Horário a confirmar' });
  }

  var STATUS = {
    novo: { label: 'Recebido', painel: 'Novo' },
    preparo: { label: 'Em preparo', painel: 'Em preparo' },
    pronto: { label: 'Pronto para retirar', painel: 'Pronto' },
    rota: { label: 'Saiu para entrega', painel: 'Em rota' },
    entregue: { label: 'Entregue', painel: 'Concluído' },
    cancelado: { label: 'Cancelado', painel: 'Cancelado' }
  };
  // próximo status conforme o modo do pedido
  function proximoStatus(pedido) {
    var s = pedido.status;
    if (s === 'novo') return 'preparo';
    if (s === 'preparo') return pedido.modo === 'entrega' ? 'rota' : 'pronto';
    if (s === 'pronto' || s === 'rota') return 'entregue';
    return null;
  }

  // ================= store de partida =================
  // As entradas (main-cliente.js e main-painel.js) instalam a store do Supabase (src/lib/store-supabase.js),
  // com o mesmo contrato (docs/CONTRATO-PAINEL.md). Esta é só a de partida: sem pedidos, nada esgotado e
  // loja pelo horário. É também o que os scripts em node:vm (gerar-seed, testar-paridade) enxergam.
  var ouvintes = [];
  var store = {
    pedidos: function () { return []; },
    pedido: function () { return null; },
    esgotados: function () { return {}; },
    loja: function () { return { modo: 'auto' }; },
    config: function () { return { som: true, atencaoMin: 15, atrasoMin: 25 }; },
    ouvir: function (fn) { ouvintes.push(fn); return function () { ouvintes = ouvintes.filter(function (x) { return x !== fn; }); }; }
  };

  // ================= mensagem de WhatsApp =================
  function mensagem(pedido) {
    var modoTxt = ({ entrega: 'Entrega', retirada: 'Retirada no truck', local: 'Comer no local' }[pedido.modo] || pedido.modo) + (pedido.modo === 'local' && pedido.mesa ? ' · Mesa ' + pedido.mesa : '');
    var out = ['Olá, ' + CONFIG.nome + '! ' + (pedido.origem === 'qrcode' ? 'Vim pelo QR code do truck' : 'Vim pelo link da bio') + ' e quero fazer um pedido.'];
    // sem número quando o pedido não chegou ao servidor (plano B do checkout)
    if (pedido.numero) out.push('Pedido ' + numeroTxt(pedido.numero));
    out.push('');
    pedido.itens.forEach(function (i) { out.push(i.qtd + '× ' + i.nome + ' — ' + brl(i.subtotal)); out.push('   ' + i.resumo); });
    out.push('');
    out.push('Total: ' + brl(pedido.total) + (pedido.modo === 'entrega' ? ' (taxa de entrega a combinar)' : ''));
    out.push(modoTxt);
    if (pedido.modo === 'entrega') out.push('Endereço: ' + (pedido.endereco || 'a informar') + (pedido.referencia ? ' (' + pedido.referencia + ')' : ''));
    if (pedido.cliente.nome) out.push('Nome: ' + pedido.cliente.nome);
    out.push('Pagamento: ' + (pedido.pagamento || 'a combinar') + (pedido.troco ? ' · troco para ' + pedido.troco : ''));
    if (pedido.obs) out.push('Observação: ' + pedido.obs);
    var s = out.join('\n');
    return s.length > 1500 ? s.slice(0, 1497) + '...' : s;
  }
  function waLink(texto, telefone) { return 'https://wa.me/' + (telefone || CONFIG.whatsapp) + '?text=' + encodeURIComponent(texto); }

  window.ML = {
    CONFIG: CONFIG, produtos: produtos, adicionais: adicionaisPorId, STATUS: STATUS,
    fmt: { brl: brl, esc: esc, numero: numeroTxt, hora: horaTxt, relogio: relogio, dia: function (d) { return NOMES_DIA[d]; } },
    regras: { podeCombo: podeCombo, podePrensar: podePrensar, podeAdicionais: podeAdicionais, proximoStatus: proximoStatus },
    precos: { normalizar: normalizar, unitario: precoUnitario, chave: chave, resumo: resumo, item: itemDoPedido },
    horario: { agora: agoraSP, situacao: situacao, situacaoNo: situacaoNo, turnos: TURNOS, definir: definirHorarios },
    store: store,
    whatsapp: { mensagem: mensagem, link: waLink }
  };
})();
