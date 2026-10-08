/* Mineiro Lanche · app do cliente (bio, cardápio, ficha, sacola, checkout, acompanhamento) e site.
   Usa window.ML (core.js). O painel vem de painel.js (window.MLPainel). */
(function () {
  'use strict';
  var ML = window.ML, C = ML.CONFIG, esc = ML.fmt.esc, brl = ML.fmt.brl;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduz = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, v)); };

  // fotos reais (tamanho original e cor dominante, de assets/fotos.json)
  var FOTOS = {
    'gran-burger-bacon': { w: 1125, h: 1375, cor: '#181828' }, 'gran-egg-bacon': { w: 1125, h: 1217, cor: '#080808' },
    'gran-salada': { w: 1125, h: 1249, cor: '#282828' }, 'dog-pizza': { w: 1125, h: 1134, cor: '#281818' },
    'gran-bacon-maionese': { w: 1125, h: 1030, cor: '#080808' }, 'combo-2-dog-doritos': { w: 996, h: 1239, cor: '#282828' },
    'dog-doritos': { w: 481, h: 643, cor: '#485858' }, 'gran-crispy': { w: 716, h: 806, cor: '#380808' },
    'gran-burger': { w: 720, h: 866, cor: '#d8d8d8' }, 'combo-casal': { w: 1600, h: 1372, cor: '#e8e8d8' },
    'gran-chicken': { w: 1086, h: 1448, cor: '#080808' }, 'gran-bacon-onion': { w: 1112, h: 1468, cor: '#181818' },
    'combo-diluvio': { w: 1200, h: 1600, cor: '#c8c8c8' }
  };
  var produtoDaFoto = {};
  Object.keys(ML.produtos).forEach(function (id) { var p = ML.produtos[id]; if (p.foto && !produtoDaFoto[p.foto]) produtoDaFoto[p.foto] = p; });

  var ICONE_CAT = { artesanais: 'burger', tradicionais: 'burger', hotdog: 'hotdog', baguetes: 'baguete', combos: 'combo', porcoes: 'batata', bebidas: 'lata' };
  function iconeDe(p) {
    if (p.id === 'porcao-onion') return 'onion';
    if (p.id === 'refri-600' || p.id === 'refri-1l' || p.id === 'suco-1l' || p.id === 'agua' || p.id === 'h2o') return 'garrafa';
    return ICONE_CAT[p.cat] || 'burger';
  }
  function ic(nome, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + nome + '"/></svg>'; }
  function src(slug, tam) { return 'assets/fotos/' + slug + '-' + tam + '.webp'; }
  // foto real (sem alteração) ou arte da categoria quando o item não tem foto
  function visual(p, tam, extra) {
    if (p.foto && FOTOS[p.foto]) {
      var f = FOTOS[p.foto];
      return '<span class="foto' + (extra ? ' ' + extra : '') + '" style="--cor:' + f.cor + '"><img src="' + src(p.foto, tam) + '" alt="Foto do ' + esc(p.nome) + '" loading="lazy" decoding="async"' +
        (tam === 'q' ? ' width="360" height="360"' : '') + '></span>';
    }
    return '<span class="arte' + (extra ? ' ' + extra : '') + '" aria-hidden="true"><svg class="rabisco"><rect width="100%" height="100%" fill="url(#p-rabisco)"/></svg>' + ic(iconeDe(p)) + '</span>';
  }
  // imagens aparecem com um fade quando carregam
  document.addEventListener('load', function (e) { if (e.target.tagName === 'IMG' && e.target.parentNode && e.target.parentNode.classList.contains('foto')) e.target.classList.add('ok'); }, true);
  function marcarCarregadas(raiz) { $$('.foto img', raiz).forEach(function (i) { if (i.complete && i.naturalWidth) i.classList.add('ok'); }); }
  function ingTexto(p) { return p.inclui ? p.inclui.join(' · ') : [p.base].concat(p.ing || []).filter(Boolean).join(', '); }

  // ================= estado =================
  var st = { aba: 'bio', tela: 'bio', busca: '', filtro: null, pedidoId: null, modo: 'entrega', pagamento: null };
  var CHAVE_SACOLA = 'mineiro:v1:sacola';
  var sacola = (function () { try { return JSON.parse(localStorage.getItem(CHAVE_SACOLA) || '[]'); } catch (e) { return []; } })();
  function salvarSacola() { try { localStorage.setItem(CHAVE_SACOLA, JSON.stringify(sacola)); } catch (e) { /* sem storage */ } atualizarContadores(); }
  function totaisSacola() { var n = 0, v = 0; sacola.forEach(function (l) { var it = ML.precos.item(l.sel); n += it.qtd; v += it.subtotal; }); return { n: n, v: Math.round(v * 100) / 100 }; }
  function addSacola(sel) {
    var n = ML.precos.normalizar(sel), k = ML.precos.chave(n);
    var ja = sacola.filter(function (l) { return l.chave === k; })[0];
    if (ja) ja.sel.qtd += n.qtd; else sacola.push({ chave: k, sel: n });
    salvarSacola();
  }
  function trocarLinha(chaveAntiga, sel) {
    sacola = sacola.filter(function (l) { return l.chave !== chaveAntiga; });
    addSacola(sel);
  }
  function plural(n) { return n === 1 ? '1 item' : n + ' itens'; }

  // ================= horário e status =================
  function atualizarStatus() {
    var s = ML.horario.situacao();
    $$('[data-status]').forEach(function (el) { el.textContent = s.txt; el.classList.toggle('fechado', !s.aberto); });
    $$('[data-status-curto]').forEach(function (el) { el.textContent = (s.aberto ? 'Aberto · ' : 'Fechado · ') + C.nome; });
    $$('[data-semana]').forEach(renderSemana);
    return s;
  }
  // escala das barras: 18h → 2h (480 min)
  function renderSemana(el) {
    var a = ML.horario.agora(), ini = 1080, faixa = 480;
    var turnoAtual = ML.horario.situacaoNo(a.dia, a.min);
    var ordem = [1, 2, 3, 4, 5, 6, 0];
    el.innerHTML = ordem.map(function (d) {
      var t = ML.horario.turnos[d], hoje = d === a.dia, nome = ML.fmt.dia(d);
      var barra, hora;
      if (t) { barra = '<span class="faixa" style="left:' + ((t.abre - ini) / faixa * 100) + '%;width:' + ((t.fecha - t.abre) / faixa * 100) + '%"></span>'; hora = ML.fmt.hora(t.abre) + '–' + ML.fmt.hora(t.fecha).replace('meia-noite', '0h'); }
      else { barra = '<span class="faixa duvida" style="left:' + (60 / faixa * 100) + '%;width:' + (360 / faixa * 100) + '%"></span>'; hora = 'a confirmar'; }
      var marca = '';
      var minRel = turnoAtual.aberto && turnoAtual.turnoDia === d ? (a.min < ini ? a.min + 1440 : a.min) : (hoje ? a.min : -1);
      if (minRel >= ini && minRel <= ini + faixa) marca = '<span class="agora" style="left:' + ((minRel - ini) / faixa * 100) + '%"></span>';
      return '<li' + (hoje ? ' class="hoje"' : '') + '><span>' + nome.charAt(0).toUpperCase() + nome.slice(1) + '</span><span class="trilho">' + barra + marca + '</span><span class="hora">' + hora + '</span></li>';
    }).join('');
  }

  // ================= montagem: bio =================
  var STORIES = [
    { nome: 'Dog com Doritos', fotos: ['dog-doritos', 'combo-2-dog-doritos'] },
    { nome: 'Artesanais', fotos: ['gran-bacon-onion', 'gran-crispy', 'gran-egg-bacon', 'gran-chicken', 'gran-burger', 'gran-burger-bacon', 'gran-salada'] },
    { nome: 'Combos', fotos: ['combo-diluvio', 'combo-casal', 'gran-bacon-maionese'] },
    { nome: 'Dog Pizza', fotos: ['dog-pizza'] }
  ];
  var ICONE_BIO = { 'Hambúrguer artesanal': 'burger', 'Hot dog com Doritos': 'hotdog', 'Consumo no local': 'mesa', 'Entregas': 'moto' };
  function montarBio() {
    $('#chips-bio').innerHTML = C.bio.map(function (b) { return '<li>' + ic(ICONE_BIO[b] || 'estrela') + esc(b) + '</li>'; }).join('');
    $('#stories').innerHTML = STORIES.map(function (s, i) {
      return '<button type="button" class="story-btn" data-story-abrir="' + i + '"><span class="story-anel"><img src="' + src(s.fotos[0], 'q') + '" alt="" width="360" height="360" loading="lazy"></span>' + esc(s.nome) + '</button>';
    }).join('');
    $('#destaques').innerHTML = C.destaques.map(function (id) {
      var p = ML.produtos[id];
      return '<button type="button" class="dest" data-abrir="' + id + '">' + visual(p, '540') + '<span class="dest-corpo"><strong>' + esc(p.nome) + '</strong><span>' + brl(p.preco) + '</span></span></button>';
    }).join('');
    $$('[data-wa]').forEach(function (a) { a.href = ML.whatsapp.link('Olá, ' + C.nome + '! Vim pelo link da bio.'); });
    $$('[data-insta]').forEach(function (a) { a.href = C.instagram; });
  }

  // ================= montagem: cardápio =================
  var FILTROS = [
    { id: 'bacon', label: 'Com bacon', fn: function (p) { return /bacon/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'ovo', label: 'Com ovo', fn: function (p) { return /\bovo\b|egg/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'frango', label: 'Frango', fn: function (p) { return /frango|chicken/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'doritos', label: 'Com Doritos', fn: function (p) { return /doritos/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'foto', label: 'Com foto', fn: function (p) { return !!p.foto; } }
  ];
  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function montarChips() {
    $('#chips').innerHTML = C.categorias.map(function (c, i) {
      return '<button type="button" class="chip" data-chip="' + c.id + '" aria-pressed="' + (i === 0) + '">' + ic(c.icone) + esc(c.label) + '</button>';
    }).join('');
    $('#filtros').innerHTML = FILTROS.map(function (f) { return '<button type="button" class="filtro" data-filtro="' + f.id + '" aria-pressed="false">' + esc(f.label) + '</button>'; }).join('');
  }
  function renderMenu() {
    var esg = ML.store.esgotados(), q = semAcento(st.busca.trim()), filtro = FILTROS.filter(function (f) { return f.id === st.filtro; })[0];
    var achou = 0;
    $('#menu-lista').innerHTML = C.categorias.map(function (c) {
      var itens = c.itens.filter(function (p) { return (!q || semAcento(p.nome + ' ' + ingTexto(p)).indexOf(q) >= 0) && (!filtro || filtro.fn(p)); });
      achou += itens.length;
      if (!itens.length) return '';
      return '<section class="cat" id="cat-' + c.id + '" data-cat="' + c.id + '" aria-labelledby="ct-' + c.id + '"><div class="cat-cab">' + ic(c.icone) + '<div><h2 id="ct-' + c.id + '">' + esc(c.label) + '</h2><small>' + esc(c.desc) + '</small></div></div>' +
        itens.map(function (p) {
          var off = !!esg[p.id];
          return '<button type="button" class="prod' + (off ? ' esgotado' : '') + '" id="prod-' + p.id + '" data-abrir="' + p.id + '">' + visual(p, 'q') +
            '<span><span class="prod-nome">' + esc(p.nome) + '</span><span class="prod-ing">' + esc(ingTexto(p)) + '</span>' +
            (off ? '<span class="selo-esgotado">Esgotado hoje</span>' : (ML.regras.podeCombo(p) ? '<span class="selo-combo">Vira combo +R$ 14,90</span>' : '')) +
            '<span class="prod-pe"><span class="preco">' + brl(p.preco) + '</span><span class="prod-mais" aria-hidden="true">' + ic('mais') + '</span></span></span></button>';
        }).join('') + '</section>';
    }).join('');
    $('#vazio-busca').hidden = achou > 0;
    marcarCarregadas($('#menu-lista'));
  }
  function marcarChip() {
    var atual = null, lim = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) + 200;
    $$('.cat').forEach(function (c) { if (c.getBoundingClientRect().top - lim <= 0) atual = c.getAttribute('data-cat'); });
    if (!atual) { var pri = $('.cat'); atual = pri && pri.getAttribute('data-cat'); }
    $$('[data-chip]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-chip') === atual)); });
  }

  // ================= ficha do lanche =================
  var ficha = { sel: null, editar: null, origem: null };
  var dlg = $('#ficha');
  function abrirFicha(id, opcoes) {
    opcoes = opcoes || {};
    var p = ML.produtos[id]; if (!p) return;
    ficha.editar = opcoes.editar || null;
    ficha.origem = opcoes.origem || null;
    ficha.sel = opcoes.sel ? JSON.parse(JSON.stringify(opcoes.sel)) : { produtoId: id, completo: true, removidos: [], prensado: false, combo: { ativo: !!opcoes.combo, refri: '' }, adicionais: {}, sabor: '', qtd: 1 };
    renderFicha();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('#ficha-corpo').scrollTop = 0;
    voarParaFicha();
    if (opcoes.focoRefri) { var r = $('#f-refri'); if (r) setTimeout(function () { r.focus(); }, 380); }
  }
  // a foto do card "voa" até o topo da ficha
  function voarParaFicha() {
    if (reduz || !ficha.origem) return;
    var de = ficha.origem.querySelector('.foto img, .arte'), para = $('.ficha-foto img, .ficha-foto .arte', dlg);
    if (!de || !para) return;
    var a = de.getBoundingClientRect(), b = para.getBoundingClientRect();
    if (!a.width || !b.width) return;
    para.animate([
      { transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + (a.width / b.width) + ',' + (a.height / b.height) + ')', transformOrigin: '0 0', borderRadius: '14px' },
      { transform: 'none', transformOrigin: '0 0', borderRadius: '0' }
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function fecharFicha(depois) {
    if (!dlg.open) { if (depois) depois(); return; }
    if (reduz) { dlg.close(); if (depois) depois(); return; }
    dlg.classList.add('fecha');
    setTimeout(function () { dlg.classList.remove('fecha'); dlg.style.transform = ''; dlg.close(); if (depois) depois(); }, 240);
  }
  function renderFicha(manterRolagem) {
    var p = ML.produtos[ficha.sel.produtoId], s = ficha.sel, esg = !!ML.store.esgotados()[p.id];
    var corpo = $('#ficha-corpo'), rol = corpo.scrollTop;
    var h = '<div class="ficha-foto" style="--cor:' + (p.foto && FOTOS[p.foto] ? FOTOS[p.foto].cor : 'var(--amarelo)') + '">' +
      (p.foto && FOTOS[p.foto] ? '<img src="' + src(p.foto, '1080') + '" alt="Foto do ' + esc(p.nome) + '">' : visual(p, 'q')) + '</div>';
    h += '<div class="ficha-cab"><h2 id="ficha-nome">' + esc(p.nome) + '</h2><span class="preco">' + brl(p.preco) + '</span>';
    if (p.inclui) h += '<ul class="ficha-inclui">' + p.inclui.map(function (x) { return '<li>' + ic('check') + esc(x) + '</li>'; }).join('') + '</ul>';
    else h += '<p class="ficha-desc">' + esc(ingTexto(p)) + '</p>';
    if (p.nota) h += '<p class="ficha-nota">' + esc(p.nota) + '</p>';
    if (esg) h += '<p class="ficha-nota">Esgotado hoje no truck.</p>';
    h += '</div>';
    if ((p.tipo === 'lanche' || p.tipo === 'combo') && p.ing && p.ing.length) {
      h += '<section class="grupo"><div class="grupo-cab">' + ic('completo') + '<div><strong>Como você quer?</strong><small>Completo, ou tire o que não quiser</small></div></div>' +
        '<div class="seg"><button type="button" class="opt" data-completo="1" aria-pressed="' + (s.completo !== false) + '">Completo</button><button type="button" class="opt" data-completo="0" aria-pressed="' + (s.completo === false) + '">Tirar algum item</button></div>';
      if (s.completo === false) {
        h += '<div class="ings" role="group" aria-label="Ingredientes">' + p.ing.map(function (i) {
          var tem = (s.removidos || []).indexOf(i) < 0;
          return '<button type="button" class="ing" data-ing="' + esc(i) + '" aria-pressed="' + tem + '" aria-label="' + esc(i) + (tem ? ', no lanche' : ', retirado') + '">' + esc(i) + '</button>';
        }).join('') + '</div><p class="ing-dica">Toque no ingrediente para tirar ou devolver.</p>';
      }
      h += '</section>';
    }
    if (ML.regras.podePrensar(p)) {
      h += '<section class="grupo"><div class="grupo-cab"><svg class="prensa-demo' + (s.prensado ? ' on' : '') + '" viewBox="0 0 64 46" aria-hidden="true"><g class="placa-cima"><rect x="30" y="0" width="4" height="8" rx="2" fill="#6E5B4E"/><rect x="6" y="8" width="52" height="6" rx="3" fill="#C8102E"/></g><g class="lanche"><rect x="10" y="24" width="44" height="7" rx="3.5" fill="#E9A64A"/><rect x="10" y="31" width="44" height="4" fill="#F7C21B"/><rect x="10" y="35" width="44" height="6" rx="3" fill="#E6A94A"/></g><rect x="4" y="41" width="56" height="5" rx="2.5" fill="#3E3131"/></svg>' +
        '<div><strong>Prensado?</strong><small>' + esc(C.regras.prensado.texto) + '</small></div></div>' +
        '<div class="seg"><button type="button" class="opt" data-prensado="0" aria-pressed="' + !s.prensado + '">Não</button><button type="button" class="opt" data-prensado="1" aria-pressed="' + !!s.prensado + '">Sim, prensado<small>grátis</small></button></div></section>';
    }
    if (ML.regras.podeCombo(p)) {
      h += '<section class="grupo"><button type="button" class="interruptor" role="switch" aria-checked="' + !!s.combo.ativo + '" data-combo><span class="grupo-cab" style="margin:0">' + ic('combo') + '<span><strong>Vira combo? +R$ 14,90</strong><small>Batata frita 140 g + refrigerante lata 350 ml</small></span></span><span class="trilho" aria-hidden="true"></span></button>';
      if (s.combo.ativo) {
        h += '<div class="combo-extra"><div class="combo-itens"><span class="combo-item">' + ic('batata') + 'Batata 140 g</span><span class="combo-item">' + ic('lata') + 'Lata 350 ml</span></div>' +
          '<div class="campo" style="margin-top:0"><label for="f-refri">Qual refrigerante?</label><input id="f-refri" maxlength="40" placeholder="Ex.: Coca-Cola, Guaraná" value="' + esc(s.combo.refri || '') + '"></div></div>';
      }
      h += '</section>';
    }
    if (p.escolheRefri) {
      h += '<section class="grupo"><div class="campo" style="margin-top:0"><label for="f-refri-combo">Qual refrigerante lata?</label><input id="f-refri-combo" maxlength="40" placeholder="Ex.: Coca-Cola, Guaraná" value="' + esc(s.sabor || '') + '"></div></section>';
    }
    if (ML.regras.podeAdicionais(p)) {
      h += '<section class="grupo"><div class="grupo-cab">' + ic('mais') + '<div><strong>Adicionais</strong><small>R$ 7,50 cada</small></div></div>' +
        C.adicionais.map(function (a) {
          var q = (s.adicionais || {})[a.id] || 0;
          return '<div class="adic"><span>' + esc(a.nome) + '<small>+ ' + brl(a.preco) + '</small></span><div class="stepper" role="group" aria-label="' + esc(a.nome) + '"><button type="button" data-adic="' + a.id + '" data-d="-1" aria-label="Menos ' + esc(a.nome) + '"' + (q ? '' : ' disabled') + '>' + ic('menos') + '</button><output>' + q + '</output><button type="button" data-adic="' + a.id + '" data-d="1" aria-label="Mais ' + esc(a.nome) + '">' + ic('mais') + '</button></div></div>';
        }).join('') + '</section>';
    }
    if (p.sabor) {
      h += '<section class="grupo"><div class="campo" style="margin-top:0"><label for="f-sabor">Sabor</label><input id="f-sabor" maxlength="40" placeholder="Escreva o sabor que você quer" value="' + esc(s.sabor || '') + '"></div></section>';
    }
    h += '<div style="height:18px"></div>';
    corpo.innerHTML = h;
    if (manterRolagem) corpo.scrollTop = rol;
    atualizarRodapeFicha();
  }
  function atualizarRodapeFicha() {
    var s = ficha.sel, p = ML.produtos[s.produtoId], esg = !!ML.store.esgotados()[p.id];
    var n = ML.precos.normalizar(s), total = ML.precos.unitario(n) * n.qtd;
    $('#ficha-qtd').textContent = n.qtd;
    $('[data-fq="-1"]').disabled = n.qtd <= 1;
    $('#ficha-add-txt').textContent = esg ? 'Esgotado hoje' : (ficha.editar ? 'Salvar' : 'Adicionar');
    $('#ficha-add').setAttribute('aria-disabled', String(esg));
    contar($('#ficha-total'), total);
  }
  // contagem animada do total
  function contar(el, alvo) {
    var de = +(el.getAttribute('data-v') || alvo);
    el.setAttribute('data-v', alvo);
    if (reduz || de === alvo) { el.textContent = brl(alvo); return; }
    var t0 = performance.now();
    (function passo(t) { var k = clamp((t - t0) / 320), e = 1 - Math.pow(1 - k, 3); el.textContent = brl(de + (alvo - de) * e); if (k < 1) requestAnimationFrame(passo); })(t0);
  }
  function confirmarFicha() {
    var p = ML.produtos[ficha.sel.produtoId];
    if (ML.store.esgotados()[p.id]) return;
    var sel = JSON.parse(JSON.stringify(ficha.sel)), origem = ficha.origem, editar = ficha.editar;
    fecharFicha(function () {
      if (editar) { trocarLinha(editar, sel); renderSacola(); toast(p.nome + ' atualizado na sacola'); return; }
      addSacola(sel);
      voar(origem, p);
      toast(p.nome + ' na sacola · ' + plural(totaisSacola().n));
    });
  }
  // arrastar a alça para fechar
  (function () {
    var y0 = null, dy = 0;
    function ini(e) { y0 = e.clientY; dy = 0; dlg.style.transition = 'none'; e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); }
    function mov(e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); dlg.style.transform = 'translateY(' + dy + 'px)'; }
    function fim() { if (y0 == null) return; y0 = null; dlg.style.transition = 'transform .25s var(--suave)'; if (dy > 110) fecharFicha(); else dlg.style.transform = ''; setTimeout(function () { dlg.style.transition = ''; }, 260); }
    [$('[data-arraste]', dlg), $('.ficha-alca', dlg)].forEach(function (el) { el.addEventListener('pointerdown', ini); el.addEventListener('pointermove', mov); el.addEventListener('pointerup', fim); el.addEventListener('pointercancel', fim); });
  })();
  dlg.addEventListener('click', function (e) { if (e.target === dlg) fecharFicha(); });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); fecharFicha(); });
  dlg.addEventListener('input', function (e) {
    if (e.target.id === 'f-refri') ficha.sel.combo.refri = e.target.value;
    if (e.target.id === 'f-sabor' || e.target.id === 'f-refri-combo') ficha.sel.sabor = e.target.value;
  });

  // ================= sacola =================
  function tagsHTML(sel) {
    var p = ML.produtos[sel.produtoId], t = [];
    if (p.tipo === 'lanche' || p.tipo === 'combo') t.push(sel.completo === false && sel.removidos && sel.removidos.length ? '<span class="tag sem">Sem ' + esc(sel.removidos.join(', ').toLowerCase()) + '</span>' : '<span class="tag">Completo</span>');
    if (ML.regras.podePrensar(p)) t.push(sel.prensado ? '<span class="tag prensado">Prensado</span>' : '<span class="tag">Não prensado</span>');
    if (sel.combo && sel.combo.ativo) t.push('<span class="tag combo">Combo +R$ 14,90' + (sel.combo.refri ? ' · ' + esc(sel.combo.refri) : '') + '</span>');
    Object.keys(sel.adicionais || {}).forEach(function (id) { var q = sel.adicionais[id]; t.push('<span class="tag adic">+ ' + (q > 1 ? q + '× ' : '') + esc(ML.adicionais[id].nome) + '</span>'); });
    if (sel.sabor) t.push('<span class="tag">' + esc(sel.sabor) + '</span>');
    return t.join('');
  }
  function renderSacola() {
    var vazia = !sacola.length;
    $('#sacola-vazia').hidden = !vazia;
    $('#sacola-resumo').hidden = vazia;
    $('#btn-continuar').setAttribute('aria-disabled', String(vazia));
    $('#sacola-linhas').innerHTML = sacola.map(function (l) {
      var p = ML.produtos[l.sel.produtoId], it = ML.precos.item(l.sel);
      var upsell = ML.regras.podeCombo(p) && !(l.sel.combo && l.sel.combo.ativo)
        ? '<div class="upsell"><span>Vira combo por +R$ 14,90? Batata 140 g + lata 350 ml</span><button type="button" data-upsell="' + esc(l.chave) + '">Quero combo</button></div>' : '';
      return '<article class="linha" data-card>' + visual(p, 'q') + '<div><div class="linha-nome"><span>' + esc(p.nome) + '</span><span class="preco" style="font-size:16px">' + brl(it.subtotal) + '</span></div><div class="linha-esc">' + tagsHTML(l.sel) + '</div>' +
        '<div class="linha-pe"><div class="stepper" role="group" aria-label="Quantidade de ' + esc(p.nome) + '"><button type="button" data-sq="' + esc(l.chave) + '" data-d="-1" aria-label="Menos um ' + esc(p.nome) + '">' + ic(l.sel.qtd > 1 ? 'menos' : 'lixo') + '</button><output>' + l.sel.qtd + '</output><button type="button" data-sq="' + esc(l.chave) + '" data-d="1" aria-label="Mais um ' + esc(p.nome) + '">' + ic('mais') + '</button></div>' +
        '<div class="linha-acoes"><button type="button" class="mini" data-editar="' + esc(l.chave) + '">' + ic('lapis') + 'Editar</button></div></div></div>' + upsell + '</article>';
    }).join('');
    marcarCarregadas($('#sacola-linhas'));
    atualizarContadores();
  }

  // ================= checkout =================
  var ICONE_MODO = { entrega: 'moto', retirada: 'sacola', local: 'mesa' };
  function renderCheckout() {
    $('#modos').innerHTML = C.modos.map(function (m) {
      return '<button type="button" class="modo" data-modo="' + m.id + '" aria-pressed="' + (st.modo === m.id) + '">' + ic(ICONE_MODO[m.id]) + '<span><strong>' + esc(m.label) + '</strong><small>' + esc(m.desc) + '</small></span></button>';
    }).join('');
    $('#bloco-endereco').hidden = st.modo !== 'entrega';
    $('#pagamentos').innerHTML = C.pagamentos
      ? '<div class="seg tres">' + C.pagamentos.map(function (p) { return '<button type="button" class="opt" data-pag="' + esc(p) + '" aria-pressed="' + (st.pagamento === p) + '">' + esc(p) + '</button>'; }).join('') + '</div>'
      : '<p class="aviso">A forma de pagamento é combinada com o ' + esc(C.nome) + ' na entrega ou no truck.</p>';
    var t = totaisSacola();
    $('#chk-itens').textContent = plural(t.n);
    $('#chk-taxa').textContent = st.modo === 'entrega' ? 'taxa combinada' : 'sem taxa';
    var s = ML.horario.situacao(), av = $('#aviso-fechado');
    av.hidden = s.aberto;
    if (!s.aberto) av.textContent = s.txt + '. Nesta prévia você pode enviar o pedido mesmo assim para ver como ele chega no painel.';
  }
  $('#form-pedido').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!sacola.length) { irTela('menu'); return; }
    var nome = $('#f-nome').value.trim(), end = $('#f-end').value.trim(), ok = true;
    $('#c-nome').classList.toggle('erro', !nome); $('#c-nome .msg-erro').hidden = !!nome; if (!nome) ok = false;
    var precisaEnd = st.modo === 'entrega' && !end;
    $('#c-end').classList.toggle('erro', precisaEnd); $('#c-end .msg-erro').hidden = !precisaEnd; if (precisaEnd) ok = false;
    if (!ok) { var prim = $('.campo.erro input'); if (prim) prim.focus(); return; }
    var btn = $('#btn-enviar');
    if (btn.classList.contains('enviando')) return;
    btn.classList.add('enviando'); btn.setAttribute('aria-disabled', 'true'); $('span', btn).textContent = 'Enviando para o truck…';
    setTimeout(function () {
      var pedido = ML.store.criarPedido({
        cliente: { nome: nome, telefone: $('#f-tel').value.trim() }, modo: st.modo,
        endereco: st.modo === 'entrega' ? end : '', referencia: st.modo === 'entrega' ? $('#f-ref').value.trim() : '',
        pagamento: st.pagamento, obs: $('#f-obs').value.trim(), itens: sacola.map(function (l) { return l.sel; })
      });
      ML.store.lembrarMeu(pedido.id);
      sacola = []; salvarSacola();
      btn.classList.remove('enviando'); btn.setAttribute('aria-disabled', 'false'); $('span', btn).textContent = 'Enviar pedido';
      $('#f-obs').value = '';
      st.pedidoId = pedido.id;
      irTela('pedido');
    }, reduz ? 0 : 750);
  });

  // ================= acompanhar pedido =================
  var PASSOS = {
    entrega: [['novo', 'Recebido', 'sino'], ['preparo', 'Na chapa', 'chama'], ['rota', 'Saiu para entrega', 'moto'], ['entregue', 'Entregue', 'check']],
    retirada: [['novo', 'Recebido', 'sino'], ['preparo', 'Na chapa', 'chama'], ['pronto', 'Pronto para retirar', 'sacola'], ['entregue', 'Retirado', 'check']],
    local: [['novo', 'Recebido', 'sino'], ['preparo', 'Na chapa', 'chama'], ['pronto', 'Pronto para servir', 'mesa'], ['entregue', 'Servido', 'check']]
  };
  var MSG = { novo: 'Pedido recebido pelo Mineiro Lanche', preparo: 'Seu lanche está na chapa', pronto: 'Pronto!', rota: 'Saiu para entrega', entregue: 'Bom apetite!', cancelado: 'Pedido cancelado' };
  function horaDe(iso) { var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function renderPedido() {
    var p = st.pedidoId && ML.store.pedido(st.pedidoId);
    if (!p) { var meus = ML.store.meus(); p = meus.length ? ML.store.pedido(meus[0]) : null; if (p) st.pedidoId = p.id; }
    if (!p) { irTela('menu'); return; }
    $('#ped-num').textContent = ML.fmt.numero(p.numero);
    var msg = MSG[p.status] || '';
    if (p.status === 'pronto') msg = p.modo === 'retirada' ? 'Pronto! Pode retirar no truck' : 'Pronto para servir';
    if (p.status === 'cancelado') { var u = p.historico[p.historico.length - 1]; msg += u && u.motivo ? ' · ' + u.motivo : ''; }
    $('#ped-msg').textContent = msg;
    $('#truck').classList.toggle('on', p.status !== 'cancelado');
    var passos = PASSOS[p.modo] || PASSOS.entrega, ordem = passos.map(function (x) { return x[0]; }), idx = ordem.indexOf(p.status);
    $('#linha-tempo').innerHTML = p.status === 'cancelado'
      ? '<li class="passo atual"><span class="bolha">' + ic('x') + '</span><span><strong>Cancelado</strong><small>' + esc(msg) + '</small></span></li>'
      : passos.map(function (ps, i) {
        var h = p.historico.filter(function (x) { return x.status === ps[0]; })[0];
        var cls = i < idx || (i === idx && p.status === 'entregue') ? 'feito' : (i === idx ? 'atual' : '');
        return '<li class="passo ' + cls + '"><span class="bolha">' + ic(ps[2]) + '</span><span><strong>' + esc(ps[1]) + '</strong><small>' + (h ? horaDe(h.em) : 'aguardando') + '</small></span></li>';
      }).join('');
    $('#ped-itens').innerHTML = p.itens.map(function (i) {
      return '<div class="linha" style="grid-template-columns:1fr"><div><div class="linha-nome"><span>' + i.qtd + '× ' + esc(i.nome) + '</span><span class="preco" style="font-size:16px">' + brl(i.subtotal) + '</span></div><div class="linha-esc">' + tagsHTML(i.adicionais ? Object.assign({}, i, { adicionais: i.adicionais.reduce(function (o, a) { o[a.id] = a.qtd; return o; }, {}) }) : i) + '</div></div></div>';
    }).join('');
    $('#ped-total').textContent = brl(p.total) + (p.modo === 'entrega' ? ' + entrega' : '');
    $('#ped-wa').href = ML.whatsapp.link(ML.whatsapp.mensagem(p));
    var outros = ML.store.meus().filter(function (id) { return id !== p.id; }).map(function (id) { return ML.store.pedido(id); }).filter(Boolean);
    $('#bloco-meus').hidden = !outros.length;
    $('#meus').innerHTML = outros.map(function (o) { return '<button type="button" class="meu" data-ver-pedido="' + o.id + '"><span><strong>' + ML.fmt.numero(o.numero) + '</strong> · ' + esc(ML.STATUS[o.status].label) + '</span><span class="preco" style="font-size:15px">' + brl(o.total) + '</span></button>'; }).join('');
  }

  // ================= stories =================
  var story = { g: 0, i: 0, timer: null };
  var dlgStory = $('#story');
  function abrirStory(g) {
    story.g = g; story.i = 0;
    $('#story-barras').innerHTML = STORIES[g].fotos.map(function () { return '<span><i></i></span>'; }).join('');
    $('#story-tit').textContent = STORIES[g].nome;
    if (typeof dlgStory.showModal === 'function') dlgStory.showModal(); else dlgStory.setAttribute('open', '');
    mostrarStory();
  }
  function mostrarStory() {
    clearTimeout(story.timer);
    var s = STORIES[story.g], slug = s.fotos[story.i], p = produtoDaFoto[slug];
    $('#story-img').src = src(slug, '1080');
    $('#story-img').alt = p ? 'Foto do ' + p.nome : '';
    $('#story-nome').textContent = p ? p.nome : '';
    $('#story-preco').textContent = p ? brl(p.preco) : '';
    $('#story-pedir').setAttribute('data-produto', p ? p.id : '');
    $$('#story-barras span').forEach(function (b, i) { b.className = i < story.i ? 'visto' : (i === story.i ? 'agora' : ''); });
    var barra = $$('#story-barras span')[story.i];
    if (barra) { var i = barra.querySelector('i'); i.style.animation = 'none'; void i.offsetWidth; i.style.animation = ''; }
    dlgStory.classList.remove('pausado');
    if (!reduz) story.timer = setTimeout(function () { passarStory(1); }, 4500);
  }
  function passarStory(d) {
    var s = STORIES[story.g], prox = story.i + d;
    if (prox < 0) prox = 0;
    if (prox >= s.fotos.length) { if (story.g + 1 < STORIES.length) { abrirStoryContinuar(story.g + 1); } else fecharStory(); return; }
    story.i = prox; mostrarStory();
  }
  function abrirStoryContinuar(g) { story.g = g; story.i = 0; $('#story-barras').innerHTML = STORIES[g].fotos.map(function () { return '<span><i></i></span>'; }).join(''); $('#story-tit').textContent = STORIES[g].nome; mostrarStory(); }
  function fecharStory() { clearTimeout(story.timer); if (dlgStory.open) dlgStory.close(); }
  dlgStory.addEventListener('cancel', function () { clearTimeout(story.timer); });
  $('.story-foto', dlgStory).addEventListener('pointerdown', function () { clearTimeout(story.timer); dlgStory.classList.add('pausado'); });
  $('.story-foto', dlgStory).addEventListener('pointerup', function () { dlgStory.classList.remove('pausado'); if (!reduz) story.timer = setTimeout(function () { passarStory(1); }, 2500); });

  // ================= voo, toast e contadores =================
  function alvoCarrinho() {
    if (st.aba === 'site' && !$('#fab').hidden) return $('#fab');
    if (st.tela === 'menu' && !$('#barra').hidden) return $('#barra .btn');
    var b = $('[data-screen="' + st.tela + '"] [data-sacola-btn]');
    if (b && b.offsetParent) return b;
    return $('#tab-cardapio');
  }
  function pular(el) { var b = el.querySelector('.pv-badge') || el; b.classList.remove('pula'); void b.offsetWidth; b.classList.add('pula'); }
  function voar(origem, p) {
    var alvo = alvoCarrinho();
    if (reduz || !alvo) { if (alvo) pular(alvo); return; }
    var fonte = origem && (origem.querySelector('.foto img, .arte') || origem);
    if (!fonte || !fonte.getBoundingClientRect().width) { pular(alvo); return; }
    var r = fonte.getBoundingClientRect(), a = alvo.getBoundingClientRect(), size = Math.max(54, Math.min(r.width, 110));
    var el = document.createElement('div');
    el.className = 'voo'; el.innerHTML = p.foto && FOTOS[p.foto] ? '<img src="' + src(p.foto, 'q') + '" alt="">' : visual(p, 'q');
    el.style.cssText = 'left:' + (r.left + r.width / 2 - size / 2) + 'px;top:' + (r.top + r.height / 2 - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px';
    document.body.appendChild(el);
    var dx = a.left + a.width / 2 - (r.left + r.width / 2), dy = a.top + a.height / 2 - (r.top + r.height / 2);
    el.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + dx * 0.45 + 'px,' + (dy * 0.45 - 120) + 'px) scale(.8) rotate(-18deg)', opacity: 1, offset: 0.45 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.15) rotate(-40deg)', opacity: 0.5 }
    ], { duration: 800, easing: 'cubic-bezier(.45,0,.55,1)' }).onfinish = function () { el.remove(); pular(alvo); };
  }
  var toastTimer;
  function toast(txt) {
    var el = $('#toast'); $('#toast-txt').textContent = txt;
    if (st.aba === 'app' && (st.tela === 'sacola' || st.tela === 'checkout')) return;
    el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }
  function atualizarContadores() {
    var t = totaisSacola();
    $$('[data-contador]').forEach(function (b) { b.textContent = t.n; b.hidden = t.n === 0; });
    $$('[data-contagem]').forEach(function (b) { b.textContent = plural(t.n); });
    $$('[data-total]').forEach(function (b) { b.textContent = brl(t.v); });
    $$('[data-total-txt]').forEach(function (b) { b.textContent = plural(t.n) + ' · ' + brl(t.v); });
    $$('[data-sacola-btn]').forEach(function (b) { b.classList.toggle('cheio', t.n > 0); });
    $('#barra').hidden = !(t.n > 0 && st.aba === 'app' && st.tela === 'menu');
    $('#fab').hidden = !(t.n > 0 && st.aba === 'site');
    var novos = ML.store.pedidos().filter(function (p) { return p.status === 'novo'; }).length;
    $$('[data-novos]').forEach(function (b) { b.textContent = novos; b.hidden = novos === 0; });
  }

  // ================= telas e abas =================
  function podeTransicao() { return !!document.startViewTransition && !reduz && document.visibilityState === 'visible'; }
  function silenciar(t) { ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { if (t && t[k]) t[k].catch(function () {}); }); }
  function abaAtual() { return st.aba === 'site' ? 'site' : st.aba === 'painel' ? 'painel' : (st.tela === 'bio' ? 'bio' : 'cardapio'); }
  function marcarAba() {
    var nome = abaAtual(), idx = { bio: 0, cardapio: 1, site: 2, painel: 3 }[nome];
    $$('.pv-tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-aba') === nome)); });
    $('#pv-pill').style.transform = 'translateX(' + idx * 100 + '%)';
    try { history.replaceState(null, '', '#' + nome); } catch (e) { /* sem histórico */ }
  }
  var painelMontado = false;
  function mostrarView(qual) {
    if (st.aba === 'painel' && qual !== 'painel' && window.MLPainel && painelMontado) window.MLPainel.esconder();
    st.aba = qual;
    $('#view-app').hidden = qual !== 'app';
    $('#view-site').hidden = qual !== 'site';
    $('#view-painel').hidden = qual !== 'painel';
    if (qual === 'site') iniciarSite();
    if (qual === 'painel' && window.MLPainel) {
      if (!painelMontado) { window.MLPainel.montar($('#view-painel')); painelMontado = true; }
      window.MLPainel.mostrar();
    }
  }
  function irTela(tela) {
    var usaVT = podeTransicao();
    var troca = function () {
      if (st.aba !== 'app') mostrarView('app');
      st.tela = tela;
      $$('[data-screen]').forEach(function (s) { s.hidden = s.getAttribute('data-screen') !== tela; });
      if (tela === 'menu') { renderMenu(); requestAnimationFrame(marcarChip); animarFaixas(); }
      if (tela === 'sacola') renderSacola();
      if (tela === 'checkout') renderCheckout();
      if (tela === 'pedido') renderPedido();
      if (tela === 'bio') animarFaixas();
      atualizarContadores(); marcarAba();
      window.scrollTo(0, 0);
      var atual = $('[data-screen="' + tela + '"]');
      if (!usaVT) { atual.classList.remove('entra'); void atual.offsetWidth; atual.classList.add('entra'); }
      var h = atual.querySelector('h1:not(.sr)') || atual.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    };
    if (usaVT) silenciar(document.startViewTransition(troca)); else troca();
  }
  function irAba(nome) {
    esconderDica();
    if (nome === 'site' || nome === 'painel') {
      var troca = function () { mostrarView(nome); marcarAba(); atualizarContadores(); window.scrollTo(0, 0); };
      if (podeTransicao()) silenciar(document.startViewTransition(troca)); else troca();
    } else irTela(nome === 'cardapio' ? 'menu' : 'bio');
  }
  function animarFaixas() { $$('[data-faixa-combo]').forEach(function (f) { f.classList.remove('anima'); void f.offsetWidth; f.classList.add('anima'); }); }

  // ================= site =================
  var LANCHES_MONTE = ['gran-bacon-onion', 'gran-crispy', 'gran-egg-bacon', 'gran-chicken', 'gran-burger', 'gran-burger-bacon', 'gran-salada', 'dog-doritos', 'dog-pizza'];
  var monte = { id: 'gran-burger', combo: false };
  var siteIniciado = false, rafPend = false, ultimoY = 0, velocidade = 0;
  function montarSite() {
    $$('[data-letras]').forEach(function (el) {
      var off = +(el.getAttribute('data-desloc') || 0);
      el.innerHTML = el.getAttribute('data-letras').split('').map(function (ch, i) { return '<span class="letra" aria-hidden="true" style="--i:' + (i + off) + '">' + esc(ch) + '</span>'; }).join('');
    });
    var estrela = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-estrela"/></svg>';
    var faixa = function (l) { var b = l.map(function (n) { return '<span class="fita__item">' + esc(n) + estrela + '</span>'; }).join(''); return b + b + b; };
    $('[data-fita="a"]').innerHTML = faixa(['Hambúrguer artesanal', 'Hot dog com Doritos', 'Consumo no local', 'Entregas em Suzano e região', 'Prensado sem custo']);
    $('[data-fita="b"]').innerHTML = faixa(['Gran Bacon Onion', 'Gran Crispy', 'Combo Dilúvio', 'Dog com Doritos', 'Hot Dog Pizza', 'Combo Casal']);
    $('#monte-escolha').innerHTML = LANCHES_MONTE.map(function (id) {
      var p = ML.produtos[id];
      return '<button type="button" data-monte="' + id + '" aria-pressed="' + (id === monte.id) + '"><img src="' + src(p.foto, 'q') + '" alt="" width="360" height="360" loading="lazy">' + esc(p.nome) + '</button>';
    }).join('');
    renderMonte(true);
    $('#art-trilho').innerHTML = C.categorias[0].itens.slice().sort(function (a, b) { return (b.foto ? 1 : 0) - (a.foto ? 1 : 0); }).map(function (p) {
      return '<button type="button" class="art-card" data-abrir="' + p.id + '">' + visual(p, '540') + '<span class="art-corpo"><strong>' + esc(p.nome) + '</strong><small>' + esc(ingTexto(p)) + '</small><span>' + brl(p.preco) + '</span></span></button>';
    }).join('');
    var dog = ML.produtos['dog-doritos'];
    $('.dog-foto').insertAdjacentHTML('afterbegin', visual(dog, '1080'));
    var tri = '';
    for (var i = 0; i < 14; i++) tri += '<svg viewBox="0 0 30 28" data-dorito="' + i + '" style="left:' + (Math.random() * 90).toFixed(1) + '%"><path d="M15 2 28 26H2z" fill="#F08A1E" stroke="#B4560E" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="17" r="1" fill="#C4600F"/><circle cx="17" cy="20" r="1" fill="#C4600F"/><circle cx="15" cy="12" r=".9" fill="#C4600F"/></svg>';
    $('#doritos').innerHTML = tri;
    var pz = ML.produtos['dog-pizza'];
    $('#mini-pizza').innerHTML = visual(pz, 'q') + '<span><strong>' + esc(pz.nome) + '</strong><span>' + brl(pz.preco) + '</span></span>';
    $('#pilha').innerHTML = ['combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos'].map(function (id, i) {
      var p = ML.produtos[id];
      return '<article class="carta" style="--i:' + i + '">' + visual(p, '1080') + '<div class="carta-corpo"><strong>' + esc(p.nome) + '</strong><ul>' + p.inclui.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        (p.nota ? '<small style="color:var(--tinta-2)">' + esc(p.nota) + '</small>' : '') +
        '<div class="carta-pe"><span class="preco">' + brl(p.preco) + '</span><button type="button" class="btn btn-vermelho" data-abrir="' + id + '">' + ic('sacola') + 'Pedir</button></div></div></article>';
    }).join('');
    $('#mosaico').innerHTML = Object.keys(FOTOS).map(function (slug) {
      var f = FOTOS[slug], p = produtoDaFoto[slug];
      return '<button type="button" data-luz="' + slug + '" aria-label="Ampliar foto' + (p ? ' do ' + esc(p.nome) : '') + '"><img src="' + src(slug, '540') + '" alt="' + (p ? 'Foto do ' + esc(p.nome) : '') + '" width="' + f.w + '" height="' + f.h + '" loading="lazy" decoding="async"></button>';
    }).join('');
    marcarCarregadas($('#view-site'));
  }
  function renderMonte(primeira) {
    var p = ML.produtos[monte.id];
    $('#monte-img').src = src(p.foto, '540');
    $('#monte-img').alt = 'Foto do ' + p.nome;
    $('#monte-lanche').className = 'monte-lanche foto';
    $('#monte').classList.toggle('combo', monte.combo);
    $('#monte-switch').setAttribute('aria-checked', String(monte.combo));
    $('#monte-conta').textContent = p.nome + ' ' + brl(p.preco) + (monte.combo ? ' + combo ' + brl(C.regras.combo.preco) : '');
    var v = p.preco + (monte.combo ? C.regras.combo.preco : 0);
    if (primeira) { $('#monte-preco').textContent = brl(v); $('#monte-preco').setAttribute('data-v', v); } else contar($('#monte-preco'), v);
    $$('[data-monte]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-monte') === monte.id)); });
  }
  function aplicarPrensa(v) {
    var t = v / 100 * 76, svg = $('#prensa-ilustra');
    $('.placa-cima', svg).style.transform = 'translateY(' + t.toFixed(1) + 'px)';
    var esmaga = t > 46 ? (236 - (94 + t)) / 96 : 1;
    $('.lanche', svg).style.transform = 'scaleY(' + esmaga.toFixed(3) + ')';
    var prensado = v >= 85;
    svg.classList.toggle('prensado', prensado);
    $('#prensa-estado').textContent = prensado ? 'Prensado! Não cobramos para prensar.' : (v > 10 ? 'Prensando…' : 'Não prensado');
  }
  function iniciarSite() {
    if (!siteIniciado) {
      siteIniciado = true;
      prepararRevelacoes($('#view-site'));
      var palco = $('#palco');
      palco.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        var r = palco.getBoundingClientRect();
        palco.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
        palco.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
        pedirQuadro();
      });
      $('#art-trilho').addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        var card = e.target.closest('.art-card'); if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 10).toFixed(2) + 'deg');
        card.style.setProperty('--rx', (((e.clientY - r.top) / r.height - 0.5) * -8).toFixed(2) + 'deg');
      });
      $('#art-trilho').addEventListener('pointerout', function (e) { var c = e.target.closest('.art-card'); if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); } });
      // prensa: régua e arraste na ilustração
      var regua = $('#f-prensa');
      regua.addEventListener('input', function () { aplicarPrensa(+regua.value); });
      var svg = $('#prensa-ilustra'), y0 = null, v0 = 0;
      svg.addEventListener('pointerdown', function (e) { y0 = e.clientY; v0 = +regua.value; svg.setPointerCapture(e.pointerId); });
      svg.addEventListener('pointermove', function (e) { if (y0 == null) return; var v = clamp(v0 + (e.clientY - y0) / svg.getBoundingClientRect().height * 160, 0, 100); regua.value = v; aplicarPrensa(v); });
      svg.addEventListener('pointerup', function () { y0 = null; });
      aplicarPrensa(0);
    }
    pedirQuadro();
  }
  function pedirQuadro() { if (!rafPend) { rafPend = true; requestAnimationFrame(quadro); } }
  function quadro() {
    rafPend = false;
    if (st.aba !== 'site') return;
    var y = window.scrollY, vh = window.innerHeight;
    velocidade = velocidade * 0.85 + Math.abs(y - ultimoY) * 0.15; ultimoY = y;
    if (!reduz) {
      $$('.fita__trilho').forEach(function (tr) { var an = tr.getAnimations && tr.getAnimations()[0]; if (an) an.playbackRate = 1 + Math.min(velocidade / 6, 5); });
      var palco = $('#palco'), mx = +palco.style.getPropertyValue('--mx') || 0, my = +palco.style.getPropertyValue('--my') || 0;
      $$('.recorte', palco).forEach(function (o) { var p = +o.getAttribute('data-prof'); o.style.transform = 'translate(' + (mx * 28 * p).toFixed(1) + 'px,' + (my * 28 * p - y * 0.1 * p).toFixed(1) + 'px)'; });
      var dog = $('#s-dog'), rd = dog.getBoundingClientRect();
      if (rd.bottom > 0 && rd.top < vh) {
        var pd = clamp((vh - rd.top) / (vh + rd.height));
        var box = $('#doritos'), alt = box.getBoundingClientRect().height;
        $$('[data-dorito]', box).forEach(function (t, i) {
          var fase = (pd * 1.6 + i / 14) % 1;
          t.style.transform = 'translateY(' + ((fase * (alt + 80)) - 60).toFixed(1) + 'px) rotate(' + ((fase * 360 + i * 47) % 360).toFixed(0) + 'deg)';
        });
      }
      var cartas = $$('.carta');
      cartas.forEach(function (c, i) {
        var prox = cartas[i + 1]; if (!prox) { c.style.transform = ''; c.style.filter = ''; return; }
        var r1 = c.getBoundingClientRect(), rp = prox.getBoundingClientRect(), sob = clamp((r1.bottom - rp.top) / r1.height);
        c.style.transform = 'scale(' + (1 - sob * 0.06).toFixed(3) + ')';
        c.style.filter = 'brightness(' + (1 - sob * 0.3).toFixed(3) + ')';
      });
      if (velocidade > 0.5) pedirQuadro();
    }
  }
  function prepararRevelacoes(raiz) {
    if (reduz || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('fora'); io.unobserve(e.target); } }); }, { threshold: 0.12 });
    $$('.rv', raiz).forEach(function (el) { if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('fora'); io.observe(el); } });
  }

  // ================= abertura e dica =================
  function mostrarDica() {
    try { if (sessionStorage.getItem('ml-dica')) return; sessionStorage.setItem('ml-dica', '1'); } catch (e) { /* sem storage */ }
    var tabs = $('.pv-tabs').getBoundingClientRect();
    var d = document.createElement('div');
    d.className = 'dica'; d.id = 'dica'; d.setAttribute('role', 'note');
    d.textContent = 'Toque nas abas: cardápio, site e o painel onde os pedidos chegam.';
    document.body.appendChild(d);
    var largura = d.offsetWidth, esquerda = Math.max(12, Math.min(window.innerWidth - largura - 12, tabs.left + tabs.width / 2 - largura / 2));
    d.style.left = esquerda + 'px';
    d.style.setProperty('--seta', (tabs.left + tabs.width / 2 - esquerda) + 'px');
    setTimeout(esconderDica, 5600);
  }
  function esconderDica() { var d = $('#dica'); if (d && !d.classList.contains('sai')) { d.classList.add('sai'); setTimeout(function () { d.remove(); }, 320); } }
  function abertura(depois) {
    var intro = $('#intro'), visto = false;
    try { visto = !!sessionStorage.getItem('ml-intro'); sessionStorage.setItem('ml-intro', '1'); } catch (e) { /* sem storage */ }
    if (reduz || visto) { depois(); return; }
    intro.hidden = false;
    var fechou = false, fechar = function () { if (fechou) return; fechou = true; intro.classList.add('sai'); setTimeout(function () { intro.hidden = true; depois(); }, 600); };
    intro.addEventListener('click', fechar);
    $('#intro-btn').focus({ preventScroll: true });
    setTimeout(fechar, 3600);
  }

  // ================= eventos =================
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go],[data-aba],[data-abrir],[data-chip],[data-filtro],[data-completo],[data-ing],[data-prensado],[data-combo],[data-adic],[data-fq],#ficha-add,[data-fechar-ficha],[data-sq],[data-editar],[data-upsell],[data-modo],[data-pag],[data-story-abrir],[data-story],[data-fechar-story],#story-pedir,[data-ver-pedido],[data-novo-pedido],[data-monte],#monte-switch,#monte-add,[data-luz],[data-fechar-luz],#luz-pedir');
    if (!t) return;
    if (t.matches('a[data-aba]')) e.preventDefault();
    var A = function (n) { return t.getAttribute(n); };
    if (t.hasAttribute('data-go')) { $('#toast').classList.remove('on'); if (A('data-go') === 'checkout' && !sacola.length) return; irTela(A('data-go')); }
    else if (t.hasAttribute('data-aba')) irAba(A('data-aba'));
    else if (t.hasAttribute('data-abrir')) abrirFicha(A('data-abrir'), { origem: t.closest('[data-abrir]') });
    else if (t.hasAttribute('data-chip')) { var cat = $('#cat-' + A('data-chip')); if (cat) cat.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' }); }
    else if (t.hasAttribute('data-filtro')) { st.filtro = st.filtro === A('data-filtro') ? null : A('data-filtro'); $$('[data-filtro]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filtro') === st.filtro)); }); renderMenu(); }
    else if (t.hasAttribute('data-completo')) { ficha.sel.completo = A('data-completo') === '1'; if (ficha.sel.completo) ficha.sel.removidos = []; renderFicha(true); }
    else if (t.hasAttribute('data-ing')) { var ing = A('data-ing'), r = ficha.sel.removidos || (ficha.sel.removidos = []), ix = r.indexOf(ing); if (ix >= 0) r.splice(ix, 1); else r.push(ing); renderFicha(true); var f = $('[data-ing="' + CSS.escape(ing) + '"]', dlg); if (f) f.focus(); }
    else if (t.hasAttribute('data-prensado')) { ficha.sel.prensado = A('data-prensado') === '1'; renderFicha(true); }
    else if (t.hasAttribute('data-combo')) { ficha.sel.combo.ativo = !ficha.sel.combo.ativo; renderFicha(true); var sw = $('[data-combo]', dlg); if (sw) sw.focus(); }
    else if (t.hasAttribute('data-adic')) { var id = A('data-adic'), ad = ficha.sel.adicionais || (ficha.sel.adicionais = {}); ad[id] = Math.max(0, Math.min(5, (ad[id] || 0) + (+A('data-d')))); if (!ad[id]) delete ad[id]; renderFicha(true); var bf = $('[data-adic="' + id + '"][data-d="' + A('data-d') + '"]', dlg); if (bf && !bf.disabled) bf.focus(); }
    else if (t.hasAttribute('data-fq')) { ficha.sel.qtd = Math.max(1, Math.min(20, (ficha.sel.qtd || 1) + (+A('data-fq')))); atualizarRodapeFicha(); }
    else if (t.id === 'ficha-add') confirmarFicha();
    else if (t.hasAttribute('data-fechar-ficha')) fecharFicha();
    else if (t.hasAttribute('data-sq')) {
      var l = sacola.filter(function (x) { return x.chave === A('data-sq'); })[0];
      if (l) { l.sel.qtd += +A('data-d'); if (l.sel.qtd <= 0) sacola = sacola.filter(function (x) { return x !== l; }); salvarSacola(); renderSacola(); }
    }
    else if (t.hasAttribute('data-editar')) { var le = sacola.filter(function (x) { return x.chave === A('data-editar'); })[0]; if (le) abrirFicha(le.sel.produtoId, { sel: le.sel, editar: le.chave, origem: t.closest('[data-card]') }); }
    else if (t.hasAttribute('data-upsell')) {
      var lu = sacola.filter(function (x) { return x.chave === A('data-upsell'); })[0];
      if (lu) { var s2 = JSON.parse(JSON.stringify(lu.sel)); s2.combo = { ativo: true, refri: '' }; abrirFicha(s2.produtoId, { sel: s2, editar: lu.chave, origem: t.closest('[data-card]'), focoRefri: true }); }
    }
    else if (t.hasAttribute('data-modo')) { st.modo = A('data-modo'); renderCheckout(); }
    else if (t.hasAttribute('data-pag')) { st.pagamento = A('data-pag'); renderCheckout(); }
    else if (t.hasAttribute('data-story-abrir')) abrirStory(+A('data-story-abrir'));
    else if (t.hasAttribute('data-story')) passarStory(+A('data-story'));
    else if (t.hasAttribute('data-fechar-story')) fecharStory();
    else if (t.id === 'story-pedir') { var pid = A('data-produto'); fecharStory(); if (pid) abrirFicha(pid); }
    else if (t.hasAttribute('data-ver-pedido')) { st.pedidoId = A('data-ver-pedido'); renderPedido(); window.scrollTo(0, 0); }
    else if (t.hasAttribute('data-novo-pedido')) irTela('menu');
    else if (t.hasAttribute('data-monte')) { monte.id = A('data-monte'); renderMonte(); }
    else if (t.id === 'monte-switch') { monte.combo = !monte.combo; renderMonte(); }
    else if (t.id === 'monte-add') abrirFicha(monte.id, { combo: monte.combo, origem: $('#monte-lanche') });
    else if (t.hasAttribute('data-luz')) { var slug = A('data-luz'), pp = produtoDaFoto[slug], lz = $('#luz-caixa'); $('#luz-img').src = src(slug, '1080'); $('#luz-img').alt = pp ? 'Foto do ' + pp.nome : ''; $('#luz-nome').textContent = pp ? pp.nome + ' · ' + brl(pp.preco) : ''; $('#luz-pedir').setAttribute('data-produto', pp ? pp.id : ''); $('#luz-pedir').hidden = !pp; lz.showModal ? lz.showModal() : lz.setAttribute('open', ''); }
    else if (t.hasAttribute('data-fechar-luz')) $('#luz-caixa').close();
    else if (t.id === 'luz-pedir') { var lp = A('data-produto'); $('#luz-caixa').close(); if (lp) abrirFicha(lp); }
  });
  $('#luz-caixa').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#f-busca').addEventListener('input', function (e) { st.busca = e.target.value; renderMenu(); });
  window.addEventListener('scroll', function () { if (st.aba === 'site') pedirQuadro(); else if (st.aba === 'app' && st.tela === 'menu') marcarChip(); }, { passive: true });
  window.addEventListener('resize', function () { if (st.aba === 'site') pedirQuadro(); });
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace('#', '');
    if (['bio', 'cardapio', 'site', 'painel'].indexOf(h) >= 0 && h !== abaAtual()) irAba(h);
  });
  // pedidos, esgotados e status chegando do painel (mesma aba ou outra)
  ML.store.ouvir(function (ev) {
    var tipo = ev.tipo || '';
    if (tipo.indexOf('pedido') === 0 || tipo === 'storage:pedidos') { if (st.aba === 'app' && st.tela === 'pedido') renderPedido(); atualizarContadores(); }
    if (tipo === 'cardapio:esgotados' || tipo === 'storage:esgotados') { if (st.tela === 'menu') renderMenu(); if (dlg.open) renderFicha(true); }
    if (tipo === 'loja:modo' || tipo === 'storage:loja') atualizarStatus();
  });

  // ================= início =================
  montarBio(); montarChips(); renderMenu(); montarSite();
  atualizarStatus(); setInterval(atualizarStatus, 30000);
  var hash = (location.hash || '').replace('#', '');
  if (hash === 'site' || hash === 'painel') { st.aba = 'app'; mostrarView(hash); }
  else { st.aba = 'app'; if (hash === 'cardapio') { st.tela = 'menu'; $$('[data-screen]').forEach(function (s) { s.hidden = s.getAttribute('data-screen') !== 'menu'; }); } }
  marcarAba(); atualizarContadores(); animarFaixas(); marcarCarregadas(document);
  prepararRevelacoes($('#view-app'));
  abertura(function () { setTimeout(mostrarDica, 400); });
  window.MLApp = { irAba: irAba, irTela: irTela };
})();
