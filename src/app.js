/* Mineiro Lanche · app do cliente (bio, cardápio, ficha, sacola, checkout, acompanhamento) e site.
   Usa window.ML (core.js) com a store do Supabase já instalada: main-cliente.js chama iniciarApp() depois.
   O painel é outra página (/painel/).
   Pele: docs/DIRECAO-VISUAL.md ("Parede Acesa"). A luz do site segue a loja: html[data-luz="acesa|apagada"] e
   html[data-luz-motivo="turno|antes|pausa"], refeitos no carregamento, a cada minuto e no evento loja:modo.
   Site imersivo (#site): src/site/site.js e as cenas entram por import() em carregarSite() (chunk próprio, com o
   CSS dele); o contrato com ele é o ML.app (montado no início, mais abaixo). */
import FOTOS_JSON from 'virtual:fotos'; // public/assets/fotos.json (plugin em vite.config.js)
import { criarHistoricoClientes, normalizarTelefone as digitosTel, chaveEndereco } from './lib/historico-clientes.js';

export function iniciarApp() {
  'use strict';
  var ML = window.ML, C = ML.CONFIG, esc = ML.fmt.esc, brl = ML.fmt.brl;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduz = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, v)); };

  // #painel nesta página leva ao painel da equipe, que vive em /painel/
  if (/^#painel(\/|$)/.test(location.hash)) { location.replace('/painel/'); return; }

  // fotos reais: tamanho original, cor média, foco e origem ('nova' = cenário de tijolinho; 'antiga' = provisória)
  // (public/assets/fotos.json, gerado por scripts/fotos.mjs)
  var FOTOS = FOTOS_JSON;
  function ehNova(slug) { return !!FOTOS[slug] && FOTOS[slug].origem === 'nova'; }
  // a foto compartilhada (dog-max serve a Médio, Max e Super) fica com o produto do mesmo nome
  var produtoDaFoto = {};
  Object.keys(ML.produtos).forEach(function (id) { var p = ML.produtos[id]; if (p.foto && (!produtoDaFoto[p.foto] || p.id === p.foto)) produtoDaFoto[p.foto] = p; });
  // foto fora do cenário: só volta quando chegar a nova (docs/DIRECAO-VISUAL.md, S5)
  var FORA_DA_CENA = { 'combo-casal': true };

  var ICONE_CAT = { artesanais: 'burger', tradicionais: 'burger', hotdog: 'hotdog', baguetes: 'baguete', combos: 'combo', porcoes: 'batata', bebidas: 'lata' };
  function iconeDe(p) {
    if (p.id === 'porcao-onion') return 'onion';
    if (p.id === 'refri-600' || p.id === 'refri-1l' || p.id === 'suco-1l' || p.id === 'agua' || p.id === 'h2o') return 'garrafa';
    return ICONE_CAT[p.cat] || 'burger';
  }
  function ic(nome, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + nome + '"/></svg>'; }
  function src(slug, tam) { return '/assets/fotos/' + slug + '-' + tam + '.webp'; }
  // Larguras reais dos arquivos: o -540 e o -1080 nunca passam do original (dog-doritos tem 481 px,
  // gran-burger 720 e gran-crispy 716), então a largura é min(540, w) e min(1080, w), sem repetir.
  function arquivos(slug) {
    var f = FOTOS[slug], lista = [];
    [['540', 540], ['1080', 1080]].forEach(function (t) {
      var w = Math.min(t[1], f.w);
      if (!lista.some(function (a) { return a.w === w; })) lista.push({ tam: t[0], w: w, h: Math.round(f.h * w / f.w) });
    });
    return lista;
  }
  // Tamanho exibido de cada uso (para o navegador escolher o arquivo do srcset). O site passa o texto do sizes
  // direto (uso que não é chave daqui vale como o próprio sizes).
  var SIZES = {
    dest: '(min-width: 440px) 250px, 62vw',
    ficha: '(min-width: 1024px) 560px, (min-width: 440px) 440px, 100vw',
    story: '(min-width: 480px) 480px, 100vw'
  };
  // carga: 'lcp' (imagem principal da tela: sem lazy, prioridade alta), 'cedo' (acima da dobra) ou 'lazy' (padrão)
  function atrCarga(carga) {
    if (carga === 'lcp') return ' fetchpriority="high"';
    if (carga === 'cedo') return ' decoding="async"';
    return ' loading="lazy" decoding="async"';
  }
  function srcsetDe(slug) { return arquivos(slug).map(function (a) { return src(slug, a.tam) + ' ' + a.w + 'w'; }).join(', '); }
  // atributos de uma foto: src, srcset pela largura real, sizes, width/height do arquivo do src (sem CLS) e carga
  function atrFoto(slug, tam, uso, carga) {
    if (tam === 'q') return 'src="' + src(slug, 'q') + '" width="360" height="360"' + atrCarga(carga);
    var lista = arquivos(slug), base = lista.filter(function (a) { return a.tam === tam; })[0] || lista[lista.length - 1];
    return 'src="' + src(slug, base.tam) + '" srcset="' + srcsetDe(slug) + '"' +
      ' sizes="' + (SIZES[uso] || uso) + '" width="' + base.w + '" height="' + base.h + '"' + atrCarga(carga);
  }
  // o mesmo para um <img> que troca de foto (story e, no site, foto ampliada e cenas)
  function trocarFoto(img, slug, tam, uso) {
    var lista = arquivos(slug), base = lista.filter(function (a) { return a.tam === tam; })[0] || lista[lista.length - 1];
    img.sizes = SIZES[uso] || uso;
    img.srcset = srcsetDe(slug);
    img.width = base.w; img.height = base.h;
    img.src = src(slug, base.tam);
  }
  // luz da foto: a cor (sombra) só nas fotos novas; o foco (ponto do lanche) vira object-position nas fotos 3:4
  var RE_FOCO = /^\d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/;
  function estiloFoto(f, tam) {
    var s = f.origem === 'nova' && /^#[0-9a-f]{3,8}$/i.test(f.cor || '') ? '--cor:' + f.cor + ';' : '';
    if (tam !== 'q' && RE_FOCO.test(f.foco || '')) s += '--foco:' + f.foco;
    return s;
  }
  // foto real (sem alteração) ou arte da categoria quando o item não tem foto
  // opc: { uso: chave de SIZES (fotos -540/-1080), carga: 'lcp' | 'cedo' | 'lazy' }
  function visual(p, tam, extra, opc) {
    opc = opc || {};
    if (p.foto && FOTOS[p.foto]) {
      var f = FOTOS[p.foto], estilo = estiloFoto(f, tam);
      return '<span class="foto ' + (f.origem === 'nova' ? 'nova' : 'antiga') + (extra ? ' ' + extra : '') + '"' + (estilo ? ' style="' + estilo + '"' : '') + '><img ' + atrFoto(p.foto, tam, opc.uso, opc.carga) + (opc.carga === 'lcp' || opc.carga === 'cedo' ? ' class="ok"' : '') + ' alt="Foto do ' + esc(p.nome) + '"></span>';
    }
    return '<span class="arte' + (extra ? ' ' + extra : '') + '" aria-hidden="true">' + ic(iconeDe(p)) + '</span>';
  }
  // imagens lazy aparecem com um fade quando carregam; as 'lcp' e 'cedo' já nascem com class="ok" (sem fade: a foto principal não espera o load)
  document.addEventListener('load', function (e) { if (e.target.tagName === 'IMG' && e.target.parentNode && e.target.parentNode.classList.contains('foto')) e.target.classList.add('ok'); }, true);
  function marcarCarregadas(raiz) { $$('.foto img', raiz).forEach(function (i) { if (i.complete && i.naturalWidth) i.classList.add('ok'); }); }
  // composição em frase corrida: os rótulos de CONFIG.ing são os chips da ficha (capitalizados), então aqui cada um começa em minúscula, menos as marcas;
  // número e unidade ficam colados (NBSP) para a quebra de linha não separar "200" de "g"
  var MARCAS_ING = /^(Doritos|Catupiry|Perdigão|Coca)/;
  function ingTexto(p) {
    var t = p.inclui ? p.inclui.join(' · ') : [p.base].concat((p.ing || []).map(function (s) { return MARCAS_ING.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1); })).filter(Boolean).join(', ');
    return t.replace(/(\d) (g|kg|ml|L)\b/g, '$1\u00a0$2');
  }
  var FUMACA = '<span class="fumaca" aria-hidden="true"><i></i><i></i><i></i></span>';

  // ================= estado =================
  // aba: 'app' (bio, cardápio e telas do pedido) ou 'site'; tela: a tela visível dentro do app
  // pedidoToken: o pedido aberto em "Acompanhe" (#pedido/<token>, link que pode ser compartilhado)
  var st = { aba: 'app', tela: 'bio', busca: '', filtro: null, pedidoToken: null, modo: 'entrega', pagamento: null };
  // sacola e rascunho do checkout ficam no aparelho (localStorage, prefixo mineiro:v2:) e nunca se perdem num erro de envio
  var CHAVE_SACOLA = 'mineiro:v2:sacola', CHAVE_RASCUNHO = 'mineiro:v2:rascunho';
  function lerLocal(k, padrao) { try { var v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } }
  function gravarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } }
  var historicoClientes = criarHistoricoClientes(lerLocal, gravarLocal);
  // item com "Preço a confirmar" (preco null) nunca fica na sacola
  var sacola = lerLocal(CHAVE_SACOLA, []).filter(function (l) { return l && l.sel && ML.regras.temPreco(ML.produtos[l.sel.produtoId]); });
  function salvarSacola() { gravarLocal(CHAVE_SACOLA, sacola); atualizarContadores(); }
  // quem chega pelo QR (?origem=qrcode&mesa=3): vale para a visita toda (sessionStorage), mesmo depois de navegar
  var CHAVE_ORIGEM = 'mineiro:v2:origem';
  var origemQR = (function () {
    var q = new URLSearchParams(location.search), o = null;
    if (q.get('origem') === 'qrcode') {
      var mesa = String(q.get('mesa') || '').trim();
      o = { origem: 'qrcode', mesa: /^[0-9A-Za-z-]{1,10}$/.test(mesa) ? mesa : null };
      try { sessionStorage.setItem(CHAVE_ORIGEM, JSON.stringify(o)); } catch { /* sem storage */ }
      return o;
    }
    try { o = JSON.parse(sessionStorage.getItem(CHAVE_ORIGEM) || 'null'); } catch { o = null; }
    return o && o.origem === 'qrcode' ? o : null;
  })();
  // QR com mesa: o checkout já abre em "Retirada no local · Mesa N"
  if (origemQR && origemQR.mesa) st.modo = 'local';
  // item que não dá para pedir agora: esgotado hoje ou fora do cardápio (estado_cardapio do banco)
  function indisponivel(id) { var p = ML.produtos[id]; return !p || !!p.inativo || !!ML.store.esgotados()[id]; }
  // adicionais da linha que saíram do cardápio (o servidor recusaria o pedido com eles)
  function adicionaisFora(sel) { return Object.keys((sel && sel.adicionais) || {}).filter(function (id) { return !ML.adicionais[id] || ML.adicionais[id].inativo; }); }
  function linhaIndisponivel(sel) { return indisponivel(sel.produtoId) || adicionaisFora(sel).length > 0; }
  function comboTxt() { return brl(C.regras.combo.preco); }
  // "batata frita 140 g + refrigerante lata 350 ml" (CONFIG.regras.combo.inclui)
  function comboInclui() { return C.regras.combo.inclui.join(' + ').toLowerCase(); }
  // "Avise antes: não cobramos para prensar" (palavras do dono; o texto vem do CONFIG)
  function textoPrensado() { var t = C.regras.prensado.texto; return 'Avise antes: ' + t.charAt(0).toLowerCase() + t.slice(1); }
  function precoPrensado() { return C.regras.prensado.preco ? '+' + brl(C.regras.prensado.preco) : 'grátis'; }
  // textos fixos do HTML com preço: seguem o banco (combo_preco e preço dos produtos) quando o estado chega
  function atualizarPrecosFixos() {
    $$('[data-combo-preco]').forEach(function (el) { el.textContent = comboTxt(); });
    $$('[data-combo-selo]').forEach(function (el) { el.textContent = '+' + comboTxt().replace('R$ ', ''); });
    $$('[data-combo-inclui]').forEach(function (el) { el.textContent = comboInclui(); });
    $$('[data-preco-de]').forEach(function (el) { var p = ML.produtos[el.getAttribute('data-preco-de')]; if (p) el.textContent = brl(p.preco); });
    $$('[data-prazo]').forEach(function (el) { el.textContent = 'Prazo de espera: ' + ML.entrega.prazo() + '.'; });
  }
  function totaisSacola() { var n = 0, v = 0; sacola.forEach(function (l) { var it = ML.precos.item(l.sel); n += it.qtd; v += it.subtotal; }); return { n: n, v: Math.round(v * 100) / 100 }; }
  function addSacola(sel) {
    if (!ML.regras.temPreco(ML.produtos[sel.produtoId])) return;
    var n = ML.precos.normalizar(sel), k = ML.precos.chave(n);
    var ja = sacola.filter(function (l) { return l.chave === k; })[0];
    if (ja) ja.sel.qtd += n.qtd; else sacola.push({ chave: k, sel: n });
    salvarSacola();
  }
  function trocarLinha(chaveAntiga, sel) {
    sacola = sacola.filter(function (l) { return l.chave !== chaveAntiga; });
    addSacola(sel);
  }
  function linhaDe(chave) { return sacola.filter(function (l) { return l.chave === chave; })[0] || null; }
  function plural(n) { return n === 1 ? '1 item' : n + ' itens'; }

  // ================= horário, status e luz =================
  // versão curta do status (cabeçalho do cardápio): "Aberto · até 0h", "Fechado · abre às 19h"
  function textoCurto(s) {
    return s.txt.replace(' (horário estendido)', '').replace(/^Aberto agora/, 'Aberto').replace(/^Fechado agora/, 'Fechado')
      .replace(' · a loja pausou os pedidos', ' · pausa').replace('abre hoje às', 'abre às').replace('meia-noite', '0h');
  }
  function atualizarStatus() {
    var s = ML.horario.situacao(), loja = ML.store.loja(), raiz = document.documentElement;
    // o HTML chega neutro (sem verde nem vermelho): só aqui o selo diz se está aberto
    $$('[data-status]').forEach(function (el) { el.textContent = s.txt; el.classList.toggle('fechado', !s.aberto); el.classList.toggle('aberto', s.aberto); });
    $$('[data-status-curto]').forEach(function (el) { el.textContent = textoCurto(s); el.classList.toggle('fechado', !s.aberto); el.classList.toggle('aberto', s.aberto); });
    // a luz da parede segue a loja (o site imersivo só lê estes atributos)
    raiz.setAttribute('data-luz', s.aberto ? 'acesa' : 'apagada');
    raiz.setAttribute('data-luz-motivo', s.aberto ? 'turno' : (loja && loja.modo === 'fechada' ? 'pausa' : 'antes'));
    $$('[data-semana]').forEach(renderSemana);
    return s;
  }
  // de minuto em minuto, na virada do minuto (o texto "abre às 19h" muda na hora certa)
  function agendarStatus() { setTimeout(function () { atualizarStatus(); agendarStatus(); }, 60000 - (Date.now() % 60000) + 50); }
  // 7 lâmpadas (hoje acesa) e a régua de cada dia: escala 19h → 1h (360 min).
  function renderSemana(el) {
    var a = ML.horario.agora(), ini = 1140, faixa = 360;
    var turnoAtual = ML.horario.situacaoNo(a.dia, a.min);
    var ordem = [0, 1, 2, 3, 4, 5, 6];
    el.innerHTML = ordem.map(function (d) {
      var t = ML.horario.turnos[d], hoje = d === a.dia, nome = ML.fmt.dia(d);
      var barra, hora;
      if (t) { var de = Math.max(t.abre, ini), ate = Math.min(t.fecha, ini + faixa); barra = '<span class="faixa" style="left:' + ((de - ini) / faixa * 100) + '%;width:' + (Math.max(ate - de, 0) / faixa * 100) + '%"></span>'; hora = ML.fmt.hora(t.abre) + '–' + ML.fmt.hora(t.fecha).replace('meia-noite', '0h'); }
      else { barra = ''; hora = 'fechado'; }
      var marca = '';
      var minRel = turnoAtual.aberto && turnoAtual.turnoDia === d ? (a.min < ini ? a.min + 1440 : a.min) : (hoje ? a.min : -1);
      if (minRel >= ini && minRel <= ini + faixa) marca = '<span class="agora" style="left:' + ((minRel - ini) / faixa * 100) + '%"></span>';
      var cls = [hoje ? 'hoje' : '', t ? '' : 'fechado'].filter(Boolean).join(' ');
      return '<li' + (cls ? ' class="' + cls + '"' : '') + '><span class="lampada" aria-hidden="true">' + nome.charAt(0).toUpperCase() + '</span><span>' + nome.charAt(0).toUpperCase() + nome.slice(1) + '</span><span class="trilho">' + barra + marca + '</span><span class="hora">' + hora + '</span></li>';
    }).join('');
  }

  // ================= montagem: bio =================
  // stories por categoria do CONFIG, fotos novas primeiro (as provisórias entram depois, até chegarem as novas)
  function montarStories() {
    var grupos = [];
    C.categorias.forEach(function (c) {
      var vistos = {}, fotos = [];
      c.itens.forEach(function (p) {
        if (p.inativo || !p.foto || !FOTOS[p.foto] || vistos[p.foto]) return;
        if (FORA_DA_CENA[p.foto] && !ehNova(p.foto)) return;
        vistos[p.foto] = true; fotos.push(p.foto);
      });
      if (!fotos.length) return;
      fotos.sort(function (a, b) { return (ehNova(b) ? 1 : 0) - (ehNova(a) ? 1 : 0); });
      grupos.push({ nome: c.label, fotos: fotos, nova: ehNova(fotos[0]) });
    });
    return grupos.filter(function (g) { return g.nova; }).concat(grupos.filter(function (g) { return !g.nova; }));
  }
  var STORIES = montarStories();
  // "Saindo da chapa": só fotos novas (os destaques do CONFIG primeiro), uma vez cada foto
  function destaquesBio() {
    var vistos = {}, lista = [];
    C.destaques.map(function (id) { return ML.produtos[id]; }).concat(Object.keys(ML.produtos).map(function (id) { return ML.produtos[id]; })).forEach(function (p) {
      if (!p || !p.foto || !ehNova(p.foto) || vistos[p.foto]) return;
      var q = produtoDaFoto[p.foto] || p;
      if (q.inativo) return;
      vistos[p.foto] = true; lista.push(q);
    });
    return lista.slice(0, 10);
  }
  var ICONE_BIO = { 'Hambúrguer artesanal': 'burger', 'Hot dog com Doritos': 'hotdog', 'Retirada no local': 'sacola', 'Entregas': 'moto' };
  var ICONE_MODO = { entrega: 'moto', local: 'sacola' };
  // texto da taxa de entrega: último trecho do desc da entrega no CONFIG.modos; o HTML nasce vazio e o JS preenche
  function taxaEntregaTxt() {
    var ent = C.modos.filter(function (m) { return m.id === 'entrega'; })[0];
    return ent ? ent.desc.split(' · ').pop() : 'sem taxa';
  }
  function montarBio() {
    var naBio = st.aba === 'app' && st.tela === 'bio';
    $('#chips-bio').innerHTML = C.bio.map(function (b) { return '<li>' + ic(ICONE_BIO[b] || 'estrela') + esc(b) + '</li>'; }).join('');
    $('#stories').innerHTML = STORIES.map(function (s, i) {
      return '<button type="button" class="story-btn" data-story-abrir="' + i + '"><span class="story-anel"><img ' + atrFoto(s.fotos[0], 'q', null, naBio ? 'cedo' : 'lazy') + ' alt=""></span><span>' + esc(s.nome) + '</span></button>';
    }).join('');
    $('#destaques').innerHTML = destaquesBio().map(function (p) {
      var f = FOTOS[p.foto], sem = !ML.regras.temPreco(p);
      return '<button type="button" class="dest" data-abrir="' + p.id + '" style="--cor:' + esc(f.cor) + '">' + visual(p, '540', null, { uso: 'dest' }) +
        '<span class="dest-corpo"><strong>' + esc(p.nome) + '</strong><span' + (sem ? ' class="sem"' : '') + '>' + brl(p.preco) + '</span></span></button>';
    }).join('');
    $$('[data-wa]').forEach(function (a) { a.href = ML.whatsapp.link('Olá, ' + C.nome + '! Vim pelo link da bio.'); });
    $$('[data-wa-txt]').forEach(function (el) { el.textContent = 'WhatsApp ' + C.whatsappTexto; });
    $$('[data-insta]').forEach(function (a) { a.href = C.instagram; });
    var e = C.enderecoPartes;
    $$('[data-endereco]').forEach(function (el) { el.textContent = e ? [e.rua, e.bairro, e.cidade + '/' + e.uf].join(' · ') : C.endereco; });
    $$('[data-mapa]').forEach(function (a) { a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(C.endereco); });
    // cada turno num bloco (a quebra de linha cai entre os turnos, com o "·" no fim da linha de cima) e palavra com hífen sem quebra ("meia-noite")
    $$('[data-horario-txt]').forEach(function (el) { var ts = C.horarioTexto || []; el.innerHTML = ts.map(function (t, i) { return '<span class="turno">' + esc(t).replace(/[^ ]+-[^ ]+/g, '<span class="nb">$&</span>') + (i < ts.length - 1 ? '&nbsp;·' : '') + '</span>'; }).join(' '); });
    var modosBio = $('[data-modos-bio]');
    if (modosBio) {
      modosBio.innerHTML = C.modos.map(function (m) { return '<li>' + ic(ICONE_MODO[m.id] || 'truck') + '<span><strong>' + esc(m.label) + '</strong> · ' + esc(m.desc) + '</span></li>'; }).join('') +
        '<li>' + ic('prensa') + '<span><strong>Prensado</strong> · ' + esc(textoPrensado()) + '</span></li>';
    }
    // taxa de entrega da comanda da sacola (CONFIG.modos)
    $$('[data-taxa-entrega]').forEach(function (el) { el.textContent = taxaEntregaTxt(); });
    atualizarPedirDeNovo();
  }

  // "Pedir de novo": repõe na sacola os itens do último pedido deste aparelho que ainda dá para pedir
  function itensParaRepetir() {
    var meus = ML.store.meus ? ML.store.meus() : [];
    if (!meus.length) return [];
    return (meus[0].itens || []).filter(function (i) { var p = i.produtoId && ML.produtos[i.produtoId]; return p && ML.regras.temPreco(p) && !indisponivel(p.id); });
  }
  function selDoItem(i) {
    return {
      produtoId: i.produtoId, completo: i.completo !== false, removidos: i.removidos || [], prensado: !!i.prensado,
      combo: i.combo && i.combo.ativo ? { ativo: true, refri: i.combo.refri || '' } : { ativo: false, refri: '' },
      adicionais: (i.adicionais || []).reduce(function (o, a) { if (ML.adicionais[a.id] && !ML.adicionais[a.id].inativo) o[a.id] = a.qtd; return o; }, {}),
      sabor: i.sabor || '', qtd: i.qtd || 1
    };
  }
  function atualizarPedirDeNovo() {
    var b = $('[data-pedir-de-novo]'), l = $('[data-link-pedido]');
    if (b) b.hidden = !itensParaRepetir().length;
    if (l) l.hidden = !(ML.store.meus && ML.store.meus().length);
  }
  function pedirDeNovo() {
    var itens = itensParaRepetir();
    if (!itens.length) return;
    itens.forEach(function (i) { addSacola(selDoItem(i)); });
    navegar('sacola');
  }

  // ================= montagem: cardápio =================
  var FILTROS = [
    { id: 'bacon', label: 'Com bacon', fn: function (p) { return /bacon/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'ovo', label: 'Com ovo', fn: function (p) { return /\bovo\b|egg/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'frango', label: 'Frango', fn: function (p) { return /frango|chicken/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'doritos', label: 'Com Doritos', fn: function (p) { return /doritos/i.test(p.nome + ' ' + ingTexto(p)); } },
    { id: 'foto', label: 'Com foto', fn: function (p) { return !!p.foto; } }
  ];
  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\u00a0/g, ' ').toLowerCase(); }
  function montarChips() {
    $('#chips').innerHTML = C.categorias.map(function (c, i) {
      return '<button type="button" class="chip" data-chip="' + c.id + '" aria-pressed="' + (i === 0) + '">' + ic(c.icone) + esc(c.label) + '</button>';
    }).join('');
    $('#filtros').innerHTML = FILTROS.map(function (f) { return '<button type="button" class="filtro" data-filtro="' + f.id + '" aria-pressed="false">' + esc(f.label) + '</button>'; }).join('');
  }
  // card: o card inteiro (botão) abre a ficha; o "+" ao lado põe o lanche completo na sacola num toque.
  // Sem preço: "Preço a confirmar" e "Consultar" no WhatsApp no lugar do "+". Esgotado: sem "+".
  function cardHTML(p, off, carga) {
    var semPreco = !ML.regras.temPreco(p);
    var selo = off ? '<span class="selo-esgotado">Esgotado hoje</span>' : (ML.regras.podeCombo(p) && !semPreco ? '<span class="selo-combo">Vira combo +' + comboTxt() + '</span>' : '');
    var acao = off ? '' : semPreco
      ? '<a class="prod-consulta" href="' + esc(ML.whatsapp.link(ML.whatsapp.consulta(p))) + '" target="_blank" rel="noopener" aria-label="Consultar o preço do ' + esc(p.nome) + ' no WhatsApp">' + ic('chat') + 'Consultar</a>'
      : '<button type="button" class="prod-mais" data-rapido="' + p.id + '" aria-label="Adicionar ' + esc(p.nome) + ' à sacola">' + ic('mais') + '</button>';
    return '<div class="prod-cel' + (semPreco ? ' sem-preco' : '') + '"><button type="button" class="prod' + (off ? ' esgotado' : '') + '" id="prod-' + p.id + '" data-abrir="' + p.id + '">' + visual(p, 'q', null, { carga: carga }) +
      '<span class="prod-txt"><span class="prod-nome">' + esc(p.nome) + '</span><span class="prod-ing">' + esc(ingTexto(p)) + '</span>' + selo +
      '<span class="prod-pe"><span class="preco' + (semPreco ? ' sem' : '') + '">' + brl(p.preco) + '</span></span></span></button>' + acao + '</div>';
  }
  function renderMenu() {
    var esg = ML.store.esgotados(), q = semAcento(st.busca.trim()), filtro = FILTROS.filter(function (f) { return f.id === st.filtro; })[0];
    var achou = 0, naTela = st.aba === 'app' && st.tela === 'menu', fotos = 0;
    $('#menu-lista').innerHTML = C.categorias.map(function (c) {
      var itens = c.itens.filter(function (p) { return (!q || semAcento(p.nome + ' ' + ingTexto(p)).indexOf(q) >= 0) && (!filtro || filtro.fn(p)); });
      achou += itens.length;
      if (!itens.length) return '';
      return '<section class="cat" id="cat-' + c.id + '" data-cat="' + c.id + '" aria-labelledby="ct-' + c.id + '"><div class="cat-cab">' + ic(c.icone) + '<div><h2 id="ct-' + c.id + '">' + esc(c.label) + '</h2><small>' + esc(c.desc) + '</small></div></div>' +
        itens.map(function (p) {
          var carga = 'lazy';
          if (naTela && p.foto && fotos < 4) carga = fotos++ === 0 ? 'lcp' : 'cedo';
          return cardHTML(p, !!esg[p.id], carga);
        }).join('') + '</section>';
    }).join('');
    $('#vazio-busca').hidden = achou > 0;
    marcarCarregadas($('#menu-lista'));
  }
  function marcarChip() {
    var chips = $('#chips'), atual = null, lim = (chips ? chips.getBoundingClientRect().bottom : 182) + 18;
    $$('.cat').forEach(function (c) { if (c.getBoundingClientRect().top - lim <= 0) atual = c.getAttribute('data-cat'); });
    if (!atual) { var pri = $('.cat'); atual = pri && pri.getAttribute('data-cat'); }
    $$('[data-chip]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-chip') === atual)); });
  }
  // #cardapio/<categoria> (placa do cardápio do site): abre o cardápio já na categoria
  function categoriaDaRota(hash) {
    var t = String(hash || '').replace(/^#/, '').split('/');
    return t[0] === 'cardapio' && C.categorias.some(function (c) { return c.id === t[1]; }) ? t[1] : null;
  }
  function irCategoria(id) {
    if (!id) return;
    // com transição de tela a troca para o cardápio roda num quadro seguinte (e zera a rolagem): espera a
    // categoria estar na tela antes de rolar até ela
    var quadros = 0;
    (function tentar() {
      var cat = $('#cat-' + id);
      if (!cat || !cat.getClientRects().length) { if (++quadros < 60) requestAnimationFrame(tentar); return; }
      requestAnimationFrame(function () { cat.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' }); });
    })();
  }

  // ================= adição rápida pelo "+" =================
  // entra completo, sem prensar e sem combo; o toast oferece "Personalizar" (abre a ficha dessa linha da sacola).
  // Item com escolha obrigatória (sabor, refrigerante do combo), esgotado ou sem preço abre a ficha.
  function precisaEscolher(p) { return !!(p.sabor || p.escolheRefri); }
  function adicionarRapido(id, origem) {
    var p = ML.produtos[id];
    if (!p) return;
    if (indisponivel(id) || !ML.regras.temPreco(p) || precisaEscolher(p)) { abrirFicha(id, { origem: origem }); return; }
    var sel = { produtoId: id, completo: true, removidos: [], prensado: false, combo: { ativo: false, refri: '' }, adicionais: {}, sabor: '', qtd: 1 };
    var chave = ML.precos.chave(ML.precos.normalizar(sel));
    addSacola(sel);
    voar(origem, p);
    var mais = origem && origem.parentNode && $('[data-rapido]', origem.parentNode);
    if (mais) { mais.classList.add('ok'); mais.innerHTML = ic('check'); setTimeout(function () { mais.classList.remove('ok'); mais.innerHTML = ic('mais'); }, 600); }
    toast(p.nome + ' na sacola', { rotulo: 'Personalizar', fn: function () { var l = linhaDe(chave); if (l) abrirFicha(id, { sel: l.sel, editar: chave }); } });
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
    // editar uma linha com adicional que saiu do cardápio: ele sai da escolha (a ficha nem mostra o botão dele)
    adicionaisFora(ficha.sel).forEach(function (a) { delete ficha.sel.adicionais[a]; });
    renderFicha();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('#ficha-corpo').scrollTop = 0;
    voarParaFicha();
    soprarFumaca($('.ficha-foto .fumaca', dlg));
    if (opcoes.focoRefri) { var r = $('#f-refri'); if (r) setTimeout(function () { r.focus(); }, 380); }
  }
  // a foto do card vira o topo da ficha (troca curta, até 200 ms; com movimento reduzido, troca seca)
  function voarParaFicha() {
    if (reduz || !ficha.origem) return;
    var de = ficha.origem.querySelector('.foto img, .arte'), para = $('.ficha-foto img', dlg);
    if (!de || !para) return;
    var a = de.getBoundingClientRect(), b = para.getBoundingClientRect();
    if (!a.width || !b.width) return;
    // só transform e clip-path (direção §1.6): a origem fica no estilo, e o canto arredondado do card vem do clip-path
    // (raio em coordenadas antes da escala, para aparecer com 14 px)
    var raio = (14 * b.width) / a.width;
    para.style.transformOrigin = '0 0';
    var voo = para.animate([
      { transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + (a.width / b.width) + ',' + (a.height / b.height) + ')', clipPath: 'inset(0 round ' + raio + 'px)' },
      { transform: 'none', clipPath: 'inset(0 round 0px)' }
    ], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    voo.onfinish = voo.oncancel = function () { para.style.transformOrigin = ''; };
  }
  function soprarFumaca(f) { if (reduz || !f) return; f.classList.remove('sopra'); void f.offsetWidth; f.classList.add('sopra'); }
  function fecharFicha(depois) {
    if (!dlg.open) { if (depois) depois(); return; }
    if (reduz) { dlg.close(); if (depois) depois(); return; }
    dlg.classList.add('fecha');
    setTimeout(function () { dlg.classList.remove('fecha'); dlg.style.transform = ''; dlg.close(); if (depois) depois(); }, 220);
  }
  // segmentado: a opção ativa desliza (--i = índice ativo)
  function segHTML(nome, opcoes, ativa) {
    var i = opcoes.map(function (o) { return o.on; }).indexOf(true);
    return '<div class="seg' + (opcoes.length === 3 ? ' tres' : '') + (i < 0 ? ' nenhum' : '') + '" data-seg="' + nome + '" style="--i:' + Math.max(0, i) + '">' +
      opcoes.map(function (o) { return '<button type="button" class="opt" ' + o.attr + ' aria-pressed="' + !!o.on + '">' + o.txt + '</button>'; }).join('') + '</div>';
  }
  var SVG_PRENSA = function (on) {
    return '<svg class="prensa-demo' + (on ? ' on' : '') + '" viewBox="0 0 64 46" aria-hidden="true"><g class="placa-cima"><rect x="30" y="0" width="4" height="8" rx="2" fill="#94705C"/><rect x="6" y="8" width="52" height="6" rx="3" fill="#C4060C"/><rect x="6" y="8" width="52" height="2" rx="1" fill="#FFCC00"/></g><g class="lanche"><rect x="10" y="24" width="44" height="7" rx="3.5" fill="#E9A64A"/><rect x="10" y="31" width="44" height="4" fill="#FFCC00"/><rect x="10" y="35" width="44" height="6" rx="3" fill="#E6A94A"/></g><rect x="4" y="41" width="56" height="5" rx="2.5" fill="#6b6560"/></svg>';
  };
  // troca: depois de redesenhar, o controle que mudou parte do estado anterior (as transições do CSS rodam)
  function renderFicha(manterRolagem, troca) {
    var p = ML.produtos[ficha.sel.produtoId], s = ficha.sel, esg = indisponivel(p.id), temFoto = !!(p.foto && FOTOS[p.foto]);
    var corpo = $('#ficha-corpo'), rol = corpo.scrollTop;
    var h = temFoto
      ? '<div class="ficha-foto ' + (ehNova(p.foto) ? 'nova' : 'antiga') + '" style="' + estiloFoto(FOTOS[p.foto], '1080') + '"><img ' + atrFoto(p.foto, '1080', 'ficha', 'lcp') + ' alt="Foto do ' + esc(p.nome) + '">' + FUMACA + '</div>'
      : '<div class="ficha-foto sem-foto" aria-hidden="true">' + ic(iconeDe(p)) + '</div>';
    h += '<div class="ficha-cab"><h2 id="ficha-nome">' + esc(p.nome) + '</h2><span class="preco' + (ML.regras.temPreco(p) ? '' : ' sem') + '">' + brl(p.preco) + '</span>';
    if (p.inclui) h += '<ul class="ficha-inclui">' + p.inclui.map(function (x) { return '<li>' + ic('check') + esc(x) + '</li>'; }).join('') + '</ul>';
    else {
      if (p.base) h += '<p class="ficha-base">' + esc(p.base) + '</p>';
      if (p.ing && p.ing.length) h += '<ul class="ficha-ings" aria-label="Composição">' + p.ing.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }
    if (p.nota) h += '<p class="ficha-nota">' + esc(p.nota) + '</p>';
    if (esg) h += '<p class="ficha-nota alerta">' + (p.inativo ? 'Fora do cardápio no momento.' : 'Esgotado hoje na loja.') + '</p>';
    // "Preço a confirmar": não vai para a sacola; a alternativa é perguntar pelo WhatsApp (sem as opções de montar)
    if (!ML.regras.temPreco(p)) {
      h += '<div class="ficha-consulta"><p class="ficha-nota">A loja ainda vai confirmar o preço deste item. Por enquanto, peça pelo WhatsApp.</p>' +
        '<a class="btn btn-borda" id="ficha-consulta" href="' + esc(ML.whatsapp.link(ML.whatsapp.consulta(p))) + '" target="_blank" rel="noopener">' + ic('chat') + 'Consultar no WhatsApp</a></div></div><div style="height:18px"></div>';
      corpo.innerHTML = h;
      if (manterRolagem) corpo.scrollTop = rol;
      atualizarRodapeFicha();
      return;
    }
    h += '</div>';
    // 1. combo primeiro: "Vira combo? +R$ 14,90" (o painel enche de cheddar quando liga)
    if (ML.regras.podeCombo(p)) {
      var on = !!s.combo.ativo, ICONE_INCLUI = ['batata', 'lata'];
      h += '<section class="grupo-combo' + (on ? ' on' : '') + '"><span class="cheddar" aria-hidden="true"></span><button type="button" class="interruptor" role="switch" aria-checked="' + on + '" data-combo><span class="grupo-cab">' + ic('combo') + '<span><strong>Vira combo? <span class="nb">+' + comboTxt() + '</span></strong><small>' + esc(C.regras.combo.inclui.join(' + ')) + '</small></span></span><span class="trilho" aria-hidden="true"></span></button>';
      if (on) {
        h += '<div class="combo-extra"><div class="combo-itens">' + C.regras.combo.inclui.map(function (x, i) { return '<span class="combo-item">' + ic(ICONE_INCLUI[i] || 'combo') + esc(x) + '</span>'; }).join('') + '</div>';
        var refris = C.regras.combo.refris;
        if (refris && refris.length) {
          h += '<div class="campo" style="margin-top:0"><label for="f-refri">Qual refrigerante?</label><select id="f-refri" class="campo-sel">' + ['<option value="">Escolha</option>'].concat(refris.map(function (r) { return '<option' + (s.combo.refri === r ? ' selected' : '') + '>' + esc(r) + '</option>'; })).join('') + '</select></div>';
        } else {
          h += '<div class="campo" style="margin-top:0"><label for="f-refri">Qual refrigerante?</label><input id="f-refri" maxlength="40" placeholder="Ex.: Coca-Cola, Guaraná" value="' + esc(s.combo.refri || '') + '"></div>';
        }
        h += '</div>';
      }
      h += '</section>';
    }
    // 2. completo ou tirar algum item
    if ((p.tipo === 'lanche' || p.tipo === 'combo') && p.ing && p.ing.length) {
      h += '<section class="grupo"><div class="grupo-cab">' + ic('completo') + '<div><strong>Como você quer?</strong><small>Completo, ou tire o que não quiser</small></div></div>' +
        segHTML('completo', [{ attr: 'data-completo="1"', on: s.completo !== false, txt: 'Completo' }, { attr: 'data-completo="0"', on: s.completo === false, txt: 'Tirar algum item' }]);
      if (s.completo === false) {
        h += '<div class="ings" role="group" aria-label="Ingredientes">' + p.ing.map(function (i) {
          var tem = (s.removidos || []).indexOf(i) < 0;
          return '<button type="button" class="ing" data-ing="' + esc(i) + '" aria-pressed="' + tem + '" aria-label="' + (tem ? esc(i) : 'sem ' + esc(i)) + '">' + ic('tesoura') + esc(i) + '</button>';
        }).join('') + '</div><p class="ing-dica">Toque no ingrediente para tirar ou devolver.</p>';
      }
      h += '</section>';
    }
    // 3. prensado (não cobram para prensar)
    if (ML.regras.podePrensar(p)) {
      h += '<section class="grupo"><div class="grupo-cab">' + SVG_PRENSA(s.prensado) + '<div><strong>Prensado?</strong><small>' + esc(textoPrensado()) + '</small></div></div>' +
        segHTML('prensado', [{ attr: 'data-prensado="0"', on: !s.prensado, txt: 'Não' }, { attr: 'data-prensado="1"', on: !!s.prensado, txt: 'Sim <small>(' + esc(precoPrensado()) + ')</small>' }]) + '</section>';
    }
    if (p.escolheRefri) {
      h += '<section class="grupo"><div class="campo" style="margin-top:0"><label for="f-refri-combo">Qual refrigerante lata?</label><input id="f-refri-combo" maxlength="40" placeholder="Ex.: Coca-Cola, Guaraná" value="' + esc(s.sabor || '') + '"></div></section>';
    }
    // 4. adicionais com stepper
    if (ML.regras.podeAdicionais(p)) {
      var precos = C.adicionais.map(function (a) { return a.preco; }), iguais = precos.every(function (v) { return v === precos[0]; });
      h += '<section class="grupo"><div class="grupo-cab">' + ic('mais') + '<div><strong>Adicionais</strong><small>' + (iguais ? brl(precos[0]) + ' cada' : 'Escolha quantos quiser') + '</small></div></div>' +
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
    if (troca && !reduz) { var el = $(troca.sel, dlg); if (el) { troca.de(el); void el.offsetWidth; troca.para(el); } }
    atualizarRodapeFicha();
  }
  // troca de um segmentado: a pílula parte da opção anterior
  function trocaSeg(nome, de, para) {
    return { sel: '[data-seg="' + nome + '"]', de: function (el) { el.style.setProperty('--i', de); }, para: function (el) { el.style.setProperty('--i', para); } };
  }
  function atualizarRodapeFicha() {
    var s = ficha.sel, p = ML.produtos[s.produtoId], esg = indisponivel(p.id), semPreco = !ML.regras.temPreco(p);
    var n = ML.precos.normalizar(s), total = ML.precos.unitario(n) * n.qtd;
    $('#ficha-qtd').textContent = n.qtd;
    $('[data-fq="-1"]').disabled = semPreco || n.qtd <= 1;
    $('[data-fq="1"]').disabled = semPreco;
    $('#ficha-add-txt').textContent = esg ? (p.inativo ? 'Indisponível' : 'Esgotado hoje') : semPreco ? ML.fmt.semPreco : (ficha.editar ? 'Salvar' : 'Adicionar');
    $('#ficha-add').setAttribute('aria-disabled', String(esg || semPreco));
    if (semPreco) { $('#ficha-total').textContent = ''; $('#ficha-total').removeAttribute('data-v'); return; }
    contar($('#ficha-total'), total);
  }
  // o total "rola" em 200 ms quando muda (o texto já é o novo: leitor de tela e testes leem o valor certo)
  function contar(el, alvo) {
    var de = el.getAttribute('data-v');
    el.setAttribute('data-v', alvo);
    el.textContent = brl(alvo);
    if (reduz || de === null || +de === alvo || !el.animate) return;
    var sobe = alvo > +de;
    el.animate([{ transform: 'translateY(' + (sobe ? '55%' : '-55%') + ')', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function confirmarFicha() {
    var p = ML.produtos[ficha.sel.produtoId];
    if (indisponivel(p.id) || !ML.regras.temPreco(p)) return;
    var sel = JSON.parse(JSON.stringify(ficha.sel)), origem = ficha.origem, editar = ficha.editar;
    fecharFicha(function () {
      if (editar) { trocarLinha(editar, sel); renderSacola(); toast(p.nome + ' atualizado na sacola'); return; }
      addSacola(sel);
      voar(origem, p);
      toast(p.nome + ' na sacola · ' + plural(totaisSacola().n));
    });
  }
  // arrastar a alça para fechar (mais de 120 px, ou um puxão rápido)
  (function () {
    var y0 = null, t0 = 0, dy = 0;
    function ini(e) { y0 = e.clientY; t0 = performance.now(); dy = 0; dlg.style.transition = 'none'; e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); }
    function mov(e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); dlg.style.transform = 'translateY(' + dy + 'px)'; }
    function fim() {
      if (y0 == null) return;
      var v = dy / Math.max(1, performance.now() - t0);
      y0 = null; dlg.style.transition = 'transform .25s var(--suave)';
      if (dy > 120 || (dy > 40 && v > 0.8)) fecharFicha(); else dlg.style.transform = '';
      setTimeout(function () { dlg.style.transition = ''; }, 260);
    }
    [$('[data-arraste]', dlg), $('.ficha-alca', dlg)].forEach(function (el) { el.addEventListener('pointerdown', ini); el.addEventListener('pointermove', mov); el.addEventListener('pointerup', fim); el.addEventListener('pointercancel', fim); });
  })();
  dlg.addEventListener('click', function (e) { if (e.target === dlg) fecharFicha(); });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); fecharFicha(); });
  dlg.addEventListener('input', function (e) {
    if (e.target.id === 'f-refri') ficha.sel.combo.refri = e.target.value;
    if (e.target.id === 'f-sabor' || e.target.id === 'f-refri-combo') ficha.sel.sabor = e.target.value;
  });
  dlg.addEventListener('change', function (e) { if (e.target.id === 'f-refri') ficha.sel.combo.refri = e.target.value; });
  // pré-carga: ao encostar (ou focar) no card, a foto grande da ficha já começa a vir
  var precarregadas = {};
  function precarregarFicha(id) {
    var p = ML.produtos[id];
    if (!p || !p.foto || !FOTOS[p.foto] || precarregadas[p.foto]) return;
    precarregadas[p.foto] = true;
    var lista = arquivos(p.foto), base = lista.filter(function (a) { return a.tam === '1080'; })[0] || lista[lista.length - 1], img = new Image();
    img.sizes = SIZES.ficha; img.srcset = srcsetDe(p.foto); img.src = src(p.foto, base.tam);
  }
  function aoEncostar(e) { var t = e.target && e.target.closest && e.target.closest('[data-abrir]'); if (t) precarregarFicha(t.getAttribute('data-abrir')); }
  document.addEventListener('pointerdown', aoEncostar, { passive: true });
  document.addEventListener('focusin', aoEncostar);

  // ================= sacola =================
  // naSacola: marca o adicional que saiu do cardápio (num pedido já feito ele não importa mais)
  function tagsHTML(sel, naSacola) {
    var p = ML.produtos[sel.produtoId], t = [];
    if (p.tipo === 'lanche' || p.tipo === 'combo') t.push(sel.completo === false && sel.removidos && sel.removidos.length ? '<span class="tag sem">Sem ' + esc(sel.removidos.join(', ').toLowerCase()) + '</span>' : '<span class="tag">Completo</span>');
    if (ML.regras.podePrensar(p)) t.push(sel.prensado ? '<span class="tag prensado">Prensado</span>' : '<span class="tag">Não prensado</span>');
    if (sel.combo && sel.combo.ativo) t.push('<span class="tag combo">Combo <span class="nb">+' + comboTxt() + '</span>' + (sel.combo.refri ? ' · ' + esc(sel.combo.refri) : '') + '</span>');
    Object.keys(sel.adicionais || {}).forEach(function (id) {
      var q = sel.adicionais[id], a = ML.adicionais[id], fora = naSacola && (!a || a.inativo);
      t.push('<span class="tag adic' + (fora ? ' esgotado' : '') + '">+ ' + (q > 1 ? q + '× ' : '') + esc(a ? a.nome : id) + (fora ? ' · fora do cardápio' : '') + '</span>');
    });
    if (sel.sabor) t.push('<span class="tag">' + esc(sel.sabor) + '</span>');
    return t.join('');
  }
  function renderSacola() {
    var vazia = !sacola.length;
    $('#sacola-vazia').hidden = !vazia;
    $('#sacola-resumo').hidden = vazia;
    $('[data-pe-sacola]').hidden = vazia;
    $('[data-mais-itens]').hidden = vazia;
    $('#btn-continuar').setAttribute('aria-disabled', String(vazia));
    // a oferta "Vira combo" aparece uma vez, no primeiro lanche sem combo
    var ofertou = false;
    $('#sacola-linhas').innerHTML = sacola.map(function (l) {
      var p = ML.produtos[l.sel.produtoId], it = ML.precos.item(l.sel), fora = linhaIndisponivel(l.sel);
      var upsell = !ofertou && !fora && ML.regras.podeCombo(p) && !(l.sel.combo && l.sel.combo.ativo)
        ? '<div class="upsell"><span><strong>Vira combo por <span class="nb">+' + comboTxt() + '?</span></strong><small>' + esc(C.regras.combo.inclui.join(' + ')) + '</small></span><button type="button" data-upsell="' + esc(l.chave) + '">Quero combo</button></div>' : '';
      if (upsell) ofertou = true;
      // item que esgotou depois de entrar na sacola: fica marcado até sair (o servidor recusaria o pedido)
      var selo = indisponivel(p.id) ? '<span class="tag esgotado">' + (p.inativo ? 'Fora do cardápio' : 'Esgotado hoje') + '</span>' : '';
      return '<article class="linha' + (fora ? ' esgotado' : '') + '" data-card>' + visual(p, 'q') + '<div><div class="linha-nome"><span>' + esc(p.nome) + '</span><span class="preco">' + brl(it.subtotal) + '</span></div><div class="linha-esc">' + selo + tagsHTML(l.sel, true) + '</div>' +
        '<div class="linha-pe"><div class="stepper" role="group" aria-label="Quantidade de ' + esc(p.nome) + '"><button type="button" data-sq="' + esc(l.chave) + '" data-d="-1" aria-label="' + (l.sel.qtd > 1 ? 'Menos um ' : 'Tirar da sacola: ') + esc(p.nome) + '">' + ic(l.sel.qtd > 1 ? 'menos' : 'lixo') + '</button><output>' + l.sel.qtd + '</output><button type="button" data-sq="' + esc(l.chave) + '" data-d="1" aria-label="Mais um ' + esc(p.nome) + '">' + ic('mais') + '</button></div>' +
        '<div class="linha-acoes"><button type="button" class="mini" data-editar="' + esc(l.chave) + '">' + ic('lapis') + 'Editar</button></div></div></div>' + upsell + '</article>';
    }).join('');
    marcarCarregadas($('#sacola-linhas'));
    atualizarContadores();
  }

  // ================= checkout =================
  var rascunhoInicial = lerLocal(CHAVE_RASCUNHO, {});
  // peças do checkout que não estão no index.html: aviso de privacidade (LGPD), a mensagem de erro do telefone
  // e o bloco de erro do envio com "Tentar de novo" e "Enviar pelo WhatsApp" (acima do botão fixo)
  (function () {
    var tel = $('#f-tel'), campo = tel.closest('.campo');
    campo.id = 'c-tel';
    tel.setAttribute('autocomplete', 'tel-national');
    campo.insertAdjacentHTML('beforeend', '<span class="msg-erro" id="erro-tel" hidden>Informe o telefone com DDD para a loja falar com você.</span>');
    $('#c-nome').insertAdjacentHTML('afterend', '<p class="nota-dados">' + ic('check') + 'Usamos seus dados para preparar e entregar o pedido. Seus dados e endereços ficam salvos neste aparelho para os próximos pedidos.</p>');
    $('.enviar-wrap').insertAdjacentHTML('beforebegin',
      '<div class="envio-erro" id="envio-erro" role="alert" tabindex="-1" hidden><strong id="envio-erro-tit"></strong><p id="envio-erro-txt"></p>' +
      '<div class="envio-erro-acoes"><button type="button" class="btn btn-vermelho" data-tentar>Tentar de novo</button>' +
      '<button type="button" class="btn btn-vermelho" data-go="sacola" data-ajustar hidden>Ajustar a sacola</button>' +
      '<a class="btn btn-borda" id="envio-wa" href="#" target="_blank" rel="noopener">' + ic('chat') + 'Enviar pelo WhatsApp</a></div>' +
      '<small>A sacola e os seus dados continuam aqui.</small></div>');
    // rascunho do formulário: volta como estava depois de um envio que falhou e para o próximo pedido (só a observação sai quando o pedido sai)
    var r = rascunhoInicial;
    [['f-nome', 'nome'], ['f-tel', 'tel'], ['f-cep', 'cep'], ['f-end', 'end'], ['f-ref', 'ref'], ['f-obs', 'obs']].forEach(function (c) { if (r[c[1]]) $('#' + c[0]).value = r[c[1]]; });
    // Aproveita o formulário que já estava guardado antes do histórico por telefone.
    if (!historicoClientes.buscar(r.tel)) historicoClientes.salvar({ telefone: r.tel, nome: r.nome, endereco: { cep: r.cep, end: r.end, ref: r.ref } });
    // o modo escolhido também, a não ser que o QR da mesa mande "Retirada no local"
    if (!(origemQR && origemQR.mesa) && C.modos.some(function (m) { return m.id === r.modo; })) st.modo = r.modo;
  })();
  function salvarRascunho() {
    gravarLocal(CHAVE_RASCUNHO, { nome: $('#f-nome').value, tel: $('#f-tel').value, cep: $('#f-cep').value, end: $('#f-end').value, ref: $('#f-ref').value, obs: $('#f-obs').value, modo: st.modo });
  }
  $('#form-pedido').addEventListener('input', function () { salvarRascunho(); });
  // ================= endereço por CEP e taxa de entrega por distância =================
  // Com cotação ativa, ML.store consulta o backend e o banco exige cotação válida antes de criar a entrega.
  // O caminho ViaCEP/Nominatim/OSRM permanece apenas durante a transição, com a flag desligada.
  // Taxa = km (sempre para cima) x porKm + fixa; distância e valor são vinculados ao endereço no servidor.
  var entr = { cep: '', ok: false, rua: '', bairro: '', cidade: '', uf: '', km: null, taxa: null, estado: 'vazio', seq: 0, timer: null, cepSeq: 0, ctl: null, cepCtl: null, cotacao: null, ponto: null, candidato: null, expiraTimer: null, codigo: '', cotacaoAtiva: false };
  var dispositivoEntrega=lerLocal('mineiro:v2:entrega-dispositivo',null);
  if(typeof dispositivoEntrega!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dispositivoEntrega)) {dispositivoEntrega=novoUuid();gravarLocal('mineiro:v2:entrega-dispositivo',dispositivoEntrega);}
  function usaCotacao() { return !!ML.store.loja().cotacaoAtiva; }
  function cotacaoValida() { return entr.cotacao && Date.parse(entr.cotacao.expiraEm)>Date.now() && entr.estado==='ok'; }
  var cacheKm = {};
  var filaMapa = Promise.resolve(), ultimaConsultaMapa = 0;
  function mascaraCep(v) { var d = String(v || '').replace(/\D/g, '').slice(0, 8); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d; }
  function esperarConsulta(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function conferirConsulta(sinal) { if (sinal && sinal.aborted) throw new DOMException('Consulta cancelada', 'AbortError'); }
  function buscarJSON(url, ms, sinal) {
    function consultar() {
      conferirConsulta(sinal);
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var abortar = function () { if (ctl) ctl.abort(); };
      if (sinal) sinal.addEventListener('abort', abortar, { once: true });
      var t = setTimeout(abortar, ms || 8000);
      function limpar() { clearTimeout(t); if (sinal) sinal.removeEventListener('abort', abortar); }
      return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
        if (!r.ok) {
          var erro = new Error('http ' + r.status), depois = r.headers.get('Retry-After');
          erro.status = r.status;
          if (depois) { var atraso = /^\d+$/.test(depois) ? +depois * 1000 : Date.parse(depois) - Date.now(); if (isFinite(atraso)) erro.espera = Math.max(1100, atraso); }
          throw erro;
        }
        return r.json(); // o prazo vale também enquanto o corpo da resposta está chegando
      }).then(function (j) { limpar(); return j; }, function (e) { limpar(); throw e; });
    }
    function requisitar() {
      if (url.indexOf('https://nominatim.openstreetmap.org/') !== 0) return Promise.resolve().then(consultar);
      // Uma consulta por vez e pelo menos 1,1 s entre elas, inclusive entre tentativas automáticas.
      var consulta = filaMapa.then(function () {
        conferirConsulta(sinal);
        return esperarConsulta(Math.max(0, 1100 - (Date.now() - ultimaConsultaMapa)));
      }).then(function () { conferirConsulta(sinal); ultimaConsultaMapa = Date.now(); return consultar(); });
      filaMapa = consulta.catch(function () {});
      return consulta;
    }
    function tentar(n) {
      return requisitar().catch(function (e) {
        conferirConsulta(sinal);
        // 4xx definitivos não melhoram repetindo a chamada; rede, prazo, 429 e 5xx têm uma nova tentativa.
        if (n === 0 && (!e.status || e.status === 429 || e.status >= 500) && (e.espera || 1100) <= 15000) return esperarConsulta(e.espera || 1100).then(function () { return tentar(1); });
        throw e;
      });
    }
    return tentar(0);
  }
  function taxaCalculada() { return st.modo === 'entrega' && entr.estado === 'ok' && (!usaCotacao() || cotacaoValida()) ? entr.taxa : null; }
  function temNumero(txt) { return /\d/.test(txt) || /\bs\s*\/?\s*n\b/i.test(txt); }
  function textoTaxa() {
    if (st.modo !== 'entrega') return { chk: 'sem taxa', msg: '', cls: '' };
    if (entr.estado === 'buscando-cep') return { chk: 'calculando…', msg: 'Buscando o endereço para calcular a entrega…', cls: '' };
    if(usaCotacao()) {
      if(entr.estado==='confirmar') return {chk:'confirme o local',msg:'Precisamos confirmar a entrada do endereço no mapa para calcular a entrega.',cls:''};
      if(entr.estado==='expirada') return {chk:'atualize a taxa',msg:'A cotação venceu ou mudou. Recalcule a entrega e confira o total antes de enviar.',cls:'falha'};
      if(entr.estado==='falha') {
        var mensagens={endereco_divergente:'A rua precisa corresponder ao CEP informado. Confira o CEP e o endereço.',localizacao_invalida:'O ponto marcado não corresponde à região do CEP. Confira o endereço e marque a entrada no mapa.',mapas_nao_configurados:'O cálculo da entrega está temporariamente indisponível. Sua sacola continua salva.',muitas_cotacoes:'Aguarde um pouco antes de tentar calcular novamente.',consulta_em_andamento:'Já estamos consultando este endereço. Aguarde um pouco e tente novamente.',cep_invalido:'Confira o CEP para calcular a entrega.'};
        return {chk:'taxa pendente',msg:mensagens[entr.codigo] || 'Não foi possível calcular a entrega agora. Tente novamente. Sua sacola está salva.',cls:'falha'};
      }
    }
    if (!ML.entrega.ativa()) return { chk: 'a combinar', msg: '', cls: '' };
    if (entr.estado === 'ok') {
      // só o valor calculado para o endereço: a regra (km + valor fixo) não aparece para o cliente
      return { chk: brl(entr.taxa), msg: 'Taxa de entrega: ' + brl(entr.taxa), cls: 'ok' };
    }
    if (entr.estado === 'calculando') return { chk: 'calculando…', msg: 'Calculando a taxa de entrega…', cls: '' };
    if (entr.estado === 'sem-numero') return { chk: taxaEntregaTxt(), msg: 'Informe o número da casa para calcular a taxa de entrega.', cls: '' };
    if (entr.estado === 'falha') return { chk: 'a combinar', msg: 'Não conseguimos calcular a taxa agora. Confira o endereço e tente novamente.', cls: 'falha' };
    // modo entrega, ainda sem CEP resolvido: o CEP é o caminho para ver a taxa; escrevendo o endereço à mão, a loja combina o valor
    return { chk: taxaEntregaTxt(), msg: $('#f-cep').value ? '' : 'Digite o CEP para ver a taxa de entrega.', cls: '' };
  }
  function renderTaxa() {
    var t = textoTaxa(), box = $('#taxa-msg');
    $('#chk-taxa').textContent = t.chk;
    box.hidden = !t.msg || st.modo !== 'entrega';
    box.textContent = t.msg;
    box.className = 'taxa-msg' + (t.cls ? ' ' + t.cls : '');
    $('#taxa-tentar').hidden = st.modo !== 'entrega' || (entr.estado !== 'falha' && entr.estado !== 'expirada');
    $('#taxa-localizar').hidden=st.modo!=='entrega' || !usaCotacao() || !entr.ok || !['confirmar','ok','expirada'].includes(entr.estado);
    $('#taxa-fonte').hidden=!usaCotacao() || !cotacaoValida() || !entr.cotacao.fonte;
    var fonteEl=$('#taxa-fonte'), fonte=entr.cotacao && cotacaoValida()?entr.cotacao.fonte || '':'';
    fonteEl.textContent='';
    if(fonte) {
      var link=document.createElement('a');
      link.href=fonte==='Geoapify'?'https://www.geoapify.com/':'https://openrouteservice.org/';
      link.textContent=fonte;link.target='_blank';link.rel='noopener';
      fonteEl.append('Rotas: ',link,' · ');
      if(fonte!=='Geoapify' && entr.cotacao.localizacaoFonte==='Geoapify') {
        var geo=document.createElement('a');geo.href='https://www.geoapify.com/';geo.textContent='Geoapify';geo.target='_blank';geo.rel='noopener';fonteEl.append(geo,' · ');
      }
      var osm=document.createElement('a');osm.href='https://www.openstreetmap.org/copyright';
      osm.textContent='© OpenStreetMap';osm.target='_blank';osm.rel='noopener';fonteEl.append(osm);
    }
    atualizarContadores();
  }
  function dadosCotacao() {return {cep:entr.cep,rua:$('#f-end').value.trim(),endereco:enderecoCompleto(),dispositivo:dispositivoEntrega,ponto:entr.ponto,confirmado:!!entr.ponto};}
  function executarCotacao(seq) {
    ML.store.cotarEntrega(dadosCotacao(),entr.ctl && entr.ctl.signal).then(function(q){
      if(seq!==entr.seq)return;
      if(q.estado==='confirmar') {entr.estado='confirmar';entr.candidato=q.ponto;return;}
      if(!q.id || !(q.distanciaKm>0) || !(q.taxa>=0) || !(Date.parse(q.expiraEm)>Date.now())) throw new Error('cotacao_invalida');
      entr.km=q.distanciaKm;entr.taxa=q.taxa;entr.cotacao=q;entr.estado='ok';
      clearTimeout(entr.expiraTimer);
      entr.expiraTimer=setTimeout(function(){if(seq===entr.seq){entr.estado='expirada';renderTaxa();}},Math.max(1,Date.parse(q.expiraEm)-Date.now()));
    }).catch(function(e){if(seq===entr.seq){entr.estado='falha';entr.codigo=e.codigo || 'rede';}}).then(function(){if(seq===entr.seq)renderTaxa();});
  }
  $('#taxa-localizar').addEventListener('click',function(){
    if(!usaCotacao() || !entr.ok)return;
    var seq=entr.seq,sinal=entr.ctl && entr.ctl.signal;
    $('#taxa-localizar').disabled=true;
    var candidato=entr.ponto || entr.candidato;
    var busca=candidato?Promise.resolve({ponto:candidato}):ML.store.cotarEntrega(Object.assign(dadosCotacao(),{ponto:null,confirmado:false,forcarConfirmacao:true}),sinal);
    busca.then(function(r){
      if(seq!==entr.seq)return null;
      return import('./lib/mapa-entrega.js').then(function(m){if(seq!==entr.seq)return null;return m.abrirMapaEntrega({ponto:r.ponto,signal:sinal});});
    }).then(function(p){if(p && seq===entr.seq){entr.ponto=p;agendarTaxa(true,true);}}).catch(function(e){
      if(seq===entr.seq){entr.estado='falha';entr.codigo=e.codigo || 'rede';renderTaxa();}
    }).finally(function(){$('#taxa-localizar').disabled=false;});
  });
  function geocodificar(rua, bairro, cidade, uf, sinal) {
    function consulta(txt) { return buscarJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=' + encodeURIComponent(txt), 12000, sinal); }
    // O bairro do ViaCEP pode ter outro nome no mapa (ex.: CEP 08555-120).
    // Conserva rua, cidade e UF em todas as buscas; nunca usa só o centro da cidade.
    var soRua = rua.replace(/,\s*(?:\d|s\s*\/?\s*n\b).*$/i, '').trim();
    // Também aceita número sem vírgula antes e complemento depois ("Rua Exemplo 53, Casa").
    if (soRua === rua) soRua = rua.replace(/\s+(?:\d+[A-Za-z]?|s\s*\/?\s*n)(?:\s*,.*)?\s*$/i, '').trim();
    var tentativas = [];
    function incluir(partes) {
      var txt = partes.filter(Boolean).join(', ');
      if (tentativas.indexOf(txt) < 0) tentativas.push(txt);
    }
    incluir([rua, bairro, cidade, uf]);
    incluir([rua, cidade, uf]);
    if (soRua && soRua !== rua) { incluir([soRua, bairro, cidade, uf]); incluir([soRua, cidade, uf]); }
    function tentar(i) {
      return consulta(tentativas[i]).then(function (r) {
        if (r && r[0]) return r[0];
        if (i + 1 === tentativas.length) return null;
        return new Promise(function (ok) { setTimeout(ok, 1100); }).then(function () { return tentar(i + 1); });
      });
    }
    return tentar(0);
  }
  function kmDaRota(destino, sinal) {
    var o = C.entrega.origem;
    var url = 'https://router.project-osrm.org/route/v1/driving/' + o.lon + ',' + o.lat + ';' + destino.lon + ',' + destino.lat + '?overview=false';
    return buscarJSON(url, 15000, sinal).then(function (j) {
      if (!j || j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error('rota');
      return Math.max(0.001, Math.round(j.routes[0].distance) / 1000);
    });
  }
  function executarCalculo(seq) {
    if (seq !== entr.seq) return;
    if(usaCotacao()) {executarCotacao(seq);return;}
    var sinal = entr.ctl && entr.ctl.signal;
    var rua = $('#f-end').value.trim(), chave = [rua, entr.bairro, entr.cidade, entr.uf].join('|').toLowerCase();
    var busca = cacheKm[chave] != null ? Promise.resolve(cacheKm[chave]) : geocodificar(rua, entr.bairro, entr.cidade, entr.uf, sinal).then(function (g) {
      if (!g) throw new Error('endereco');
      return kmDaRota({ lat: +g.lat, lon: +g.lon }, sinal);
    });
    busca.then(function (km) {
      if (seq !== entr.seq) return;
      if (!(km > 0 && km <= 100)) throw new Error('fora do alcance'); // o banco só aceita até 100 km
      cacheKm[chave] = km;
      entr.km = km; entr.taxa = ML.entrega.taxa(km); entr.estado = 'ok';
    }).catch(function () { if (seq === entr.seq) entr.estado = 'falha'; }).then(function () { if (seq === entr.seq) renderTaxa(); });
  }
  // recalcula depois de mudar o CEP, a rua/número ou o modo; imediato = sem esperar o cliente parar de digitar
  function agendarTaxa(imediato,manterPonto) {
    clearTimeout(entr.timer);
    if (entr.ctl) entr.ctl.abort();
    entr.ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var seq = ++entr.seq;
    clearTimeout(entr.expiraTimer);entr.cotacao=null;entr.candidato=null;entr.codigo='';
    if(!manterPonto)entr.ponto=null;
    entr.km = null; entr.taxa = null;
    if (st.modo !== 'entrega' || !entr.ok || !ML.entrega.ativa()) entr.estado = 'vazio';
    else if (!temNumero($('#f-end').value)) entr.estado = 'sem-numero';
    else {
      entr.estado = 'calculando';
      entr.timer = setTimeout(function () { executarCalculo(seq); }, imediato ? 0 : 700);
    }
    renderTaxa();
  }
  function entregaPendente() { return entr.estado === 'calculando' || entr.estado === 'buscando-cep'; }
  // O envio reavalia o endereço e a taxa antes de mandar o pedido.
  function esperarTaxa() {
    return new Promise(function (ok) {
      var t0 = Date.now();
      (function olhar() { if (!entregaPendente() || Date.now() - t0 > 12000) ok(); else setTimeout(olhar, 150); })();
    });
  }
  function dicaCep(txt, cls) { var d = $('#cep-dica'); d.textContent = txt; d.className = 'campo-dica' + (cls ? ' ' + cls : ''); }
  function limparCep() {
    if (entr.cepCtl) entr.cepCtl.abort();
    entr.cep = ''; entr.ok = false; entr.bairro = ''; entr.cidade = ''; entr.uf = ''; entr.cepSeq++;
    $('#c-bairro').hidden = true; $('#f-bairro').value = '';
    dicaCep('Digite o CEP e a rua, o bairro e a cidade vêm sozinhos.');
  }
  function buscarCep(cep, manterRua) {
    // Um CEP novo invalida imediatamente a taxa e as consultas do endereço anterior.
    limparCep();
    var seq = entr.cepSeq;
    entr.cepCtl = typeof AbortController === 'function' ? new AbortController() : null;
    entr.cep = cep;
    agendarTaxa();
    if (st.modo === 'entrega') { entr.estado = 'buscando-cep'; renderTaxa(); }
    dicaCep('Buscando o CEP…');
    var sinal=entr.cepCtl && entr.cepCtl.signal;
    var consultaCep=usaCotacao()?ML.store.buscarCepEntrega(cep,dispositivoEntrega,sinal).then(function(j){return {cep:j.cep,logradouro:j.rua,bairro:j.bairro,localidade:j.cidade,uf:j.uf};}):buscarJSON('https://viacep.com.br/ws/'+cep+'/json/',10000,sinal);
    consultaCep.then(function (j) {
      if (seq !== entr.cepSeq) return;
      if (!j || j.erro) { entr.cep = ''; entr.ok = false; dicaCep('CEP não encontrado. Confira os números ou escreva o endereço abaixo.', 'erro'); agendarTaxa(); return; }
      entr.cep = cep; entr.ok = true; entr.bairro = j.bairro || ''; entr.cidade = j.localidade || ''; entr.uf = j.uf || '';
      var campo = $('#f-end'), rua = j.logradouro || '';
      // O preenchimento automático do celular pode trazer rua e número antes da resposta do CEP.
      var normalizarRua = function (v) { return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); };
      var mesmaRua = rua && normalizarRua(campo.value).indexOf(normalizarRua(rua)) === 0;
      if (rua && !(campo.value.trim() && (manterRua || mesmaRua))) campo.value = rua + ', ';
      $('#f-bairro').value = [entr.bairro, entr.cidade && entr.uf ? entr.cidade + '/' + entr.uf : entr.cidade].filter(Boolean).join(' · ');
      $('#c-bairro').hidden = !$('#f-bairro').value;
      dicaCep(rua ? 'Agora é só informar o número da casa.' : 'Este CEP não tem rua própria: escreva a rua e o número.', 'ok');
      salvarRascunho();
      if (!manterRua) { campo.focus(); try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch { /* sem seleção */ } }
      agendarTaxa(true);
    }, function () {
      if (seq !== entr.cepSeq) return;
      entr.cep = ''; entr.ok = false; dicaCep('Não conseguimos buscar o CEP agora. Confira o CEP e tente novamente.', 'erro'); agendarTaxa();
      entr.estado = 'falha'; renderTaxa();
    });
  }
  // endereço que vai no pedido: o que o cliente escreveu + bairro, cidade/UF e CEP do ViaCEP
  function enderecoCompleto() {
    var rua = $('#f-end').value.trim();
    if (!entr.ok) return rua;
    var resto = [entr.bairro, entr.cidade && entr.uf ? entr.cidade + '/' + entr.uf : entr.cidade, 'CEP ' + mascaraCep(entr.cep)].filter(Boolean);
    return [rua].concat(resto).join(', ').slice(0, 200);
  }
  $('#f-cep').addEventListener('input', function (e) {
    var antes = e.target.value, v = mascaraCep(antes);
    if (v !== antes) e.target.value = v;
    var d = v.replace(/\D/g, '');
    if (d.length === 8) { if (d !== entr.cep) buscarCep(d, false); }
    else if (entr.cep || entr.ok) { limparCep(); agendarTaxa(); }
    else dicaCep('Digite o CEP e a rua, o bairro e a cidade vêm sozinhos.');
  });
  $('#f-end').addEventListener('input', function () { if (entr.ok) agendarTaxa(); });
  $('#taxa-tentar').addEventListener('click', function () {
    var cep = $('#f-cep').value.replace(/\D/g, '');
    if (!entr.ok && cep.length === 8) buscarCep(cep, true); else agendarTaxa(true);
  });
  // rascunho com CEP: refaz a busca (sem apagar a rua e o número já digitados) só quando o cliente chega ao checkout
  var restaurarCep = $('#f-cep').value.replace(/\D/g, '').length === 8;

  // Identificação pelo telefone e vários endereços, separados por cliente neste aparelho.
  var telefoneIdentificado = digitosTel($('#f-tel').value);
  if (!/^\d{10,11}$/.test(telefoneIdentificado)) telefoneIdentificado = '';
  function lerEnderecoCliente() { return { cep: $('#f-cep').value, end: $('#f-end').value, ref: $('#f-ref').value }; }
  function limparEnderecoCliente() {
    limparCep();
    restaurarCep = false;
    $('#f-cep').value = ''; $('#f-end').value = ''; $('#f-ref').value = '';
    $('#f-endereco-salvo').value = '';
    agendarTaxa(); // invalida a rota e qualquer cálculo do endereço anterior
  }
  function preencherEnderecoCliente(endereco) {
    limparEnderecoCliente();
    $('#f-cep').value = mascaraCep(endereco.cep);
    $('#f-end').value = endereco.end;
    $('#f-ref').value = endereco.ref;
    restaurarCep = endereco.cep.length === 8;
    if (restaurarCep && st.tela === 'checkout') { restaurarCep = false; buscarCep(endereco.cep, true); }
    salvarRascunho();
  }
  function selecionarEnderecoAtual() {
    var perfil = historicoClientes.buscar(telefoneIdentificado);
    var chave = chaveEndereco(lerEnderecoCliente());
    var indice = perfil ? perfil.enderecos.findIndex(function (e) { return chaveEndereco(e) === chave; }) : -1;
    $('#f-endereco-salvo').value = indice < 0 ? '' : String(indice);
  }
  function renderEnderecosCliente() {
    var perfil = historicoClientes.buscar(telefoneIdentificado);
    var enderecos = perfil ? perfil.enderecos : [];
    $('#enderecos-salvos').hidden = !enderecos.length;
    $('#f-endereco-salvo').innerHTML = '<option value="">Novo endereço</option>' + enderecos.map(function (e, i) {
      return '<option value="' + i + '">' + esc(e.end + (e.ref ? ' · ' + e.ref : '') + (e.cep ? ' · CEP ' + mascaraCep(e.cep) : '')) + '</option>';
    }).join('');
    selecionarEnderecoAtual();
  }
  function identificarCliente() {
    var tel = digitosTel($('#f-tel').value);
    if (tel === telefoneIdentificado) return;
    // Ao trocar de cliente, nunca reaproveita o nome, o endereço ou a taxa de outra pessoa.
    if (telefoneIdentificado) { $('#f-nome').value = ''; $('#f-obs').value = ''; limparEnderecoCliente(); }
    telefoneIdentificado = /^\d{10,11}$/.test(tel) ? tel : '';
    var perfil = historicoClientes.buscar(telefoneIdentificado);
    if (perfil) {
      $('#f-nome').value = perfil.nome;
      if (perfil.enderecos.length) preencherEnderecoCliente(perfil.enderecos[0]);
    }
    $('#cliente-dica').textContent = perfil ? 'Encontramos seus dados salvos. Confira abaixo ou adicione outro endereço.'
      : telefoneIdentificado ? 'Preencha seus dados para continuar.' : 'Informe seu telefone com DDD para recuperar seus dados salvos.';
    renderEnderecosCliente();
    salvarRascunho();
  }
  $('#f-tel').addEventListener('input', identificarCliente);
  $('#f-tel').addEventListener('change', identificarCliente);
  $('#f-endereco-salvo').addEventListener('change', function () {
    var perfil = historicoClientes.buscar(telefoneIdentificado);
    var valor = this.value;
    if (perfil && valor !== '' && perfil.enderecos[+valor]) preencherEnderecoCliente(perfil.enderecos[+valor]);
    else limparEnderecoCliente();
    selecionarEnderecoAtual();
    salvarRascunho();
  });
  $('#btn-novo-endereco').addEventListener('click', function () {
    limparEnderecoCliente();
    salvarRascunho();
    $('#f-cep').focus();
  });
  ['#f-cep', '#f-end', '#f-ref'].forEach(function (sel) { $(sel).addEventListener('input', selecionarEnderecoAtual); });
  // Na volta ao checkout, conserva também alterações ainda não enviadas do rascunho.
  var perfilInicial = historicoClientes.buscar(telefoneIdentificado);
  if (perfilInicial) {
    if (!$('#f-nome').value) $('#f-nome').value = perfilInicial.nome;
    if (!Object.prototype.hasOwnProperty.call(rascunhoInicial, 'end') && !$('#f-end').value && perfilInicial.enderecos.length) preencherEnderecoCliente(perfilInicial.enderecos[0]);
    $('#cliente-dica').textContent = 'Encontramos seus dados salvos. Confira abaixo ou adicione outro endereço.';
  }
  renderEnderecosCliente();

  function modoLabel(m) { return m.id === 'local' && origemQR && origemQR.mesa ? m.label + ' · Mesa ' + origemQR.mesa : m.label; }
  function renderCheckout() {
    if(entr.cotacaoAtiva!==usaCotacao()) {entr.cotacaoAtiva=usaCotacao();if(entr.ok)agendarTaxa(true);}
    if (restaurarCep) { restaurarCep = false; buscarCep($('#f-cep').value.replace(/\D/g, ''), true); }
    $('#modos').innerHTML = C.modos.map(function (m) {
      return '<button type="button" class="modo" data-modo="' + m.id + '" aria-pressed="' + (st.modo === m.id) + '">' + ic(ICONE_MODO[m.id]) + '<span><strong>' + esc(modoLabel(m)) + '</strong><small>' + esc(m.desc) + '</small></span>' + ic('check', 'modo-check') + '</button>';
    }).join('');
    $('#bloco-endereco').hidden = st.modo !== 'entrega';
    var temPagamentos = Array.isArray(C.pagamentos) && C.pagamentos.length > 0;
    $('#pagamentos').closest('.bloco').hidden = !temPagamentos;
    $('#pagamentos').innerHTML = temPagamentos
      ? segHTML('pagamento', C.pagamentos.map(function (p) { return { attr: 'data-pag="' + esc(p) + '"', on: st.pagamento === p, txt: esc(p) }; }))
      : '';
    var t = totaisSacola();
    $('#chk-itens').textContent = plural(t.n);
    renderTaxa();
    // a comanda (que recolhe) lista os itens com o que foi escolhido
    $('#chk-lista').innerHTML = sacola.map(function (l) {
      var it = ML.precos.item(l.sel);
      return '<li><span>' + it.qtd + '× ' + esc(it.nome) + '<small>' + esc(it.resumo) + '</small></span><span>' + brl(it.subtotal) + '</span></li>';
    }).join('');
    var s = ML.horario.situacao(), av = $('#aviso-fechado');
    av.hidden = s.aberto;
    if (!s.aberto) av.textContent = s.txt + (ML.store.loja().aceitaFechada ? '. Os pedidos são preparados no horário de funcionamento da loja.' : '. Fora do horário a loja não recebe pedidos pelo site; se precisar, chame no WhatsApp.');
  }

  // envio: um uuid de idempotência por pedido montado; "Tentar de novo" reaproveita o mesmo (o servidor
  // devolve o pedido já gravado em vez de duplicar se a primeira tentativa chegou lá e só a resposta se perdeu)
  var envio = { uuid: null, assinatura: null, enviando: false };
  function novoUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function lerFormulario() {
    var mesa = st.modo === 'local' && origemQR ? origemQR.mesa : null;
    return {
      cliente: { nome: $('#f-nome').value.trim(), telefone: digitosTel($('#f-tel').value) }, modo: st.modo,
      endereco: st.modo === 'entrega' ? enderecoCompleto() : '', referencia: st.modo === 'entrega' ? $('#f-ref').value.trim() : '',
      distanciaKm: st.modo === 'entrega' && entr.estado === 'ok' ? entr.km : null,
      cotacaoId: st.modo==='entrega' && entr.cotacao?entr.cotacao.id:null,
      pagamento: st.pagamento, troco: '', obs: $('#f-obs').value.trim(),
      origem: origemQR ? 'qrcode' : 'cardapio', mesa: mesa,
      itens: sacola.map(function (l) { return l.sel; })
    };
  }
  // o mesmo pedido montado aqui, para a mensagem de WhatsApp quando o servidor não responde
  function pedidoLocal(d) {
    var itens = d.itens.map(function (s) { return ML.precos.item(s); });
    var taxa = d.distanciaKm ? ML.entrega.taxa(d.distanciaKm) : null;
    return Object.assign({}, d, { numero: null, itens: itens, taxaEntrega: taxa, total: Math.round((itens.reduce(function (a, i) { return a + i.subtotal; }, 0) + (taxa || 0)) * 100) / 100 });
  }
  var ERRO_ENVIO = {
    cotacao_necessaria:['Atualize a taxa de entrega',function(){return 'Recalcule a entrega, confira o total e envie novamente. Se a página estava aberta há algum tempo, atualize o site.';}],
    cotacao_expirada:['Atualize a taxa de entrega',function(){return 'A cotação venceu ou mudou. Recalcule a entrega e confira o novo total antes de enviar.';}],
    cotacao_endereco_divergente:['Confira o endereço de entrega',function(){return 'O endereço mudou após o cálculo. Recalcule a entrega antes de enviar.';}],
    loja_fechada: ['A loja não está recebendo pedidos agora', function () { return ML.horario.situacao().txt + '. Você pode chamar o ' + C.nome + ' pelo WhatsApp.'; }],
    produto_esgotado: ['Um item da sacola esgotou', function (d) { return (d.esgotados.length ? d.esgotados.join(', ') : 'Um dos itens') + ' acabou de esgotar hoje. Tire da sacola e envie de novo, ou peça pelo WhatsApp.'; }],
    produto_invalido: ['Um item da sacola saiu do cardápio', function (d) { return (d.esgotados.length ? d.esgotados.join(', ') + ' não está' : 'Um dos itens não está') + ' disponível agora. Ajuste a sacola e envie de novo.'; }],
    muitos_pedidos: ['Muitos pedidos deste telefone', function () { return 'Recebemos vários pedidos deste número em poucos minutos. Espere um pouco ou fale com a loja pelo WhatsApp.'; }],
    dados_invalidos: ['Confira os seus dados', function () { return 'A loja não aceitou algum campo do pedido. Confira nome, telefone e endereço e tente de novo.'; }],
    rede: ['Não conseguimos falar com a loja', function () { return 'Sem conexão ou o servidor não respondeu. Tente de novo, ou envie o pedido completo pelo WhatsApp.'; }]
  };
  // o que não dá para pedir na sacola: o lanche (esgotado ou fora do cardápio) ou um adicional que saiu do cardápio
  function nomesIndisponiveis() {
    var nomes = [];
    sacola.forEach(function (l) {
      var p = ML.produtos[l.sel.produtoId];
      if (indisponivel(l.sel.produtoId)) nomes.push(p ? p.nome : l.sel.produtoId);
      else adicionaisFora(l.sel).forEach(function (id) { var a = ML.adicionais[id]; nomes.push((a ? a.nome : id) + ' (adicional do ' + p.nome + ')'); });
    });
    return nomes;
  }
  // esgotado hoje ou fora do cardápio (produto ou adicional): muda o texto do aviso
  function codigoIndisponivel() {
    return sacola.some(function (l) { var p = ML.produtos[l.sel.produtoId]; return !p || p.inativo || adicionaisFora(l.sel).length > 0; }) ? 'produto_invalido' : 'produto_esgotado';
  }
  function mostrarErroEnvio(codigo, dados, soTexto) {
    var e = ERRO_ENVIO[codigo] || ERRO_ENVIO.rede, nomes = nomesIndisponiveis();
    $('#envio-erro-tit').textContent = e[0];
    $('#envio-erro-txt').textContent = e[1]({ esgotados: nomes });
    var ajustar = codigo === 'produto_esgotado' || codigo === 'produto_invalido';
    $('[data-tentar]').hidden = ajustar || codigo === 'muitos_pedidos';
    $('[data-ajustar]').hidden = !ajustar;
    $('#envio-wa').href = ML.whatsapp.link(ML.whatsapp.mensagem(pedidoLocal(dados)));
    $('#envio-wa').hidden=st.modo==='entrega' && usaCotacao() && !cotacaoValida();
    var box = $('#envio-erro');
    box.hidden = false;
    if (soTexto) return;
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'center' });
  }
  function esconderErroEnvio() { $('#envio-erro').hidden = true; }
  function travarEnvio(sim) {
    var btn = $('#btn-enviar');
    envio.enviando = sim;
    btn.classList.toggle('enviando', sim);
    btn.setAttribute('aria-disabled', String(sim));
    $('#form-pedido').setAttribute('aria-busy', String(sim));
    $('span', btn).textContent = sim ? 'Enviando para a loja…' : 'Enviar pedido';
  }
  function validar() {
    var nome = $('#f-nome').value.trim(), tel = digitosTel($('#f-tel').value), end = $('#f-end').value.trim(), ok = true;
    var semNumero = st.modo === 'entrega' && entr.ok && end.length >= 5 && !temNumero(end);
    var erroNome = nome.length < 2, erroTel = !/^\d{10,11}$/.test(tel), erroEnd = st.modo === 'entrega' && (end.length < 5 || semNumero);
    $('#erro-end').textContent = semNumero ? 'Informe o número da casa (ou S/N, se não tiver).' : 'Informe o endereço para a entrega.';
    // o erro também chega ao leitor de tela: aria-invalid no campo e a mensagem como descrição dele
    [['#c-nome', erroNome, '#f-nome', 'erro-nome'], ['#c-tel', erroTel, '#f-tel', 'erro-tel'], ['#c-end', erroEnd, '#f-end', 'erro-end']].forEach(function (c) {
      var campo = $(c[2]);
      $(c[0]).classList.toggle('erro', c[1]); $(c[0] + ' .msg-erro').hidden = !c[1]; if (c[1]) ok = false;
      campo.setAttribute('aria-invalid', String(c[1]));
      if (c[1]) campo.setAttribute('aria-describedby', c[3]); else if (campo.id === 'f-tel') campo.setAttribute('aria-describedby', 'cliente-dica'); else campo.removeAttribute('aria-describedby');
    });
    if (!ok) { var prim = $('.campo.erro input'); if (prim) prim.focus(); }
    return ok;
  }
  $('#form-pedido').addEventListener('submit', function (e) {
    e.preventDefault();
    if (envio.enviando) return;
    if (!sacola.length) { navegar('cardapio'); return; }
    if (!validar()) return;
    // CEP ou rota pendentes: espera terminar e valida novamente antes de enviar.
    if (st.modo === 'entrega' && entregaPendente()) {
      travarEnvio(true);
      esperarTaxa().then(function () {
        travarEnvio(false);
        if(usaCotacao()) {
          // A taxa ainda não era conhecida no primeiro clique. Exige confirmação do total após calculá-la.
          if(cotacaoValida()) {renderTaxa();$('#taxa-msg').textContent+=' Confira o total e toque em Enviar pedido.';}
          return;
        }
        var f = $('#form-pedido'); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true }));
      });
      return;
    }
    var dados = lerFormulario();
    var negocio=Object.assign({},dados);delete negocio.cotacaoId;delete negocio.distanciaKm;
    var assinatura=JSON.stringify(negocio);
    // Repetição de um envio incerto mantém o UUID; o banco recupera o pedido antes de validar a cotação.
    var recuperar=envio.uuid && envio.assinatura===assinatura;
    if(st.modo==='entrega' && usaCotacao() && !cotacaoValida() && !recuperar) {
      if(entr.estado==='ok')entr.estado='expirada';renderTaxa();
      $('#taxa-msg').setAttribute('tabindex','-1');$('#taxa-msg').focus();$('#taxa-msg').scrollIntoView({block:'center'});
      return;
    }
    var cadastroEnviado = { telefone: dados.cliente.telefone, nome: dados.cliente.nome, endereco: dados.modo === 'entrega' ? lerEnderecoCliente() : null };
    // item que já se sabe esgotado nem vai ao servidor
    if (nomesIndisponiveis().length) { renderSacola(); mostrarErroEnvio(codigoIndisponivel(), dados); return; }
    if (!envio.uuid || envio.assinatura !== assinatura) { envio.uuid = novoUuid(); envio.assinatura = assinatura; }
    dados.idempotencia = envio.uuid;
    esconderErroEnvio();
    travarEnvio(true);
    ML.store.criarPedido(dados).then(function (pedido) {
      historicoClientes.salvar(cadastroEnviado);
      renderEnderecosCliente();
      envio.uuid = null; envio.assinatura = null;
      sacola = []; salvarSacola();
      // o cliente que volta só confere: nome, telefone, endereço e referência continuam no aparelho (rascunho);
      // sai apenas a observação, que valia para aquele pedido
      $('#f-obs').value = '';
      salvarRascunho();
      travarEnvio(false);
      st.pedidoToken = pedido.token;
      // o checkout sai do histórico: voltar do acompanhamento leva à sacola, não ao formulário enviado
      navegar('pedido', true);
      // a comanda "imprime" no acompanhamento
      if (!reduz) { var c = $('#pedido-topo .comanda'); if (c) { c.classList.remove('imprime'); void c.offsetWidth; c.classList.add('imprime'); } }
    }, function (err) {
      travarEnvio(false);
      var codigo = (err && err.codigo) || 'rede';
      if(/^cotacao_/.test(codigo)) {entr.estado='expirada';renderTaxa();}
      // esgotou ou saiu do cardápio: busca o estado do cardápio para marcar o item na sacola
      if (codigo === 'produto_esgotado' || codigo === 'produto_invalido' || codigo === 'loja_fechada') {
        ML.store.recarregar().catch(function () {}).then(function () { renderSacola(); if (!$('#envio-erro').hidden) mostrarErroEnvio(codigo, dados, true); });
      }
      mostrarErroEnvio(codigo, dados);
    });
  });

  // ================= acompanhar pedido =================
  var PASSOS = {
    entrega: [['novo', 'Recebido', 'sino'], ['preparo', 'Na chapa', 'chama'], ['rota', 'Saiu para entrega', 'moto'], ['entregue', 'Entregue', 'check']],
    local: [['novo', 'Recebido', 'sino'], ['preparo', 'Na chapa', 'chama'], ['pronto', 'Pronto para retirada', 'sacola'], ['entregue', 'Retirado', 'check']]
  };
  var MSG = { novo: 'Pedido recebido pelo Mineiro Lanche', preparo: 'Seu lanche está na chapa', pronto: 'Pronto!', rota: 'Saiu para entrega', entregue: 'Bom apetite!', cancelado: 'Pedido cancelado' };
  var FINAIS = ['entregue', 'cancelado'];
  $('#ped-msg').insertAdjacentHTML('afterend', '<p class="sr" id="ped-status" role="status" aria-live="polite"></p>');
  var RE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function tokenDaRota(hash) { var t = String(hash || '').replace(/^#/, '').split('/'); return t[0] === 'pedido' && RE_TOKEN.test(t[1] || '') ? t[1].toLowerCase() : null; }
  function horaDe(iso) { var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  // selos do item: completos quando o pedido foi feito neste aparelho; senão, a partir do resumo do servidor
  function tagsDoItem(i) {
    if (i.produtoId && ML.produtos[i.produtoId]) return tagsHTML(Object.assign({}, i, { adicionais: (i.adicionais || []).reduce(function (o, a) { o[a.id] = a.qtd; return o; }, {}) }));
    return String(i.resumo || '').split(' · ').filter(Boolean).map(function (r) {
      var cls = /^Sem /.test(r) ? ' sem' : r === 'Prensado' ? ' prensado' : /^Combo /.test(r) ? ' combo' : /^\+ /.test(r) ? ' adic' : '';
      return '<span class="tag' + cls + '">' + esc(r) + '</span>';
    }).join('');
  }
  // o último status mostrado de cada pedido: a mudança acende a lâmpada e pisca o selo uma vez
  var statusVisto = {};
  function renderPedido() {
    if (!st.pedidoToken) { var meus = ML.store.meus(); if (meus.length) st.pedidoToken = meus[0].token; }
    if (!st.pedidoToken) { navegar('cardapio', true); return; }
    var p = ML.store.acompanhamento(st.pedidoToken), topo = $('#pedido-topo'), neon = $('#ped-neon');
    $('#ped-wa').hidden = !p;
    if (!p) {
      // ainda consultando (undefined) ou link de pedido que não existe (null)
      $('#ped-num').textContent = '#····';
      $('#ped-msg').textContent = p === null ? 'Pedido não encontrado. Confira o link ou faça um pedido novo.' : 'Buscando o seu pedido…';
      neon.textContent = ''; neon.className = 'ped-neon';
      topo.classList.remove('na-chapa');
      $('#linha-tempo').innerHTML = ''; $('#ped-itens').innerHTML = ''; $('#ped-total').textContent = '—';
      $('#ped-status').textContent = '';
      renderMeus();
      return;
    }
    $('#ped-num').textContent = ML.fmt.numero(p.numero);
    var msg = MSG[p.status] || '';
    if (p.status === 'pronto') msg = 'Seu pedido está pronto para retirada na loja';
    if (p.status === 'cancelado') { var u = p.historico[p.historico.length - 1]; msg += u && u.motivo ? ' · ' + u.motivo : ''; }
    $('#ped-msg').textContent = msg;
    // para leitor de tela: o status muda sozinho (consulta a cada 10 s)
    var rotulo = (ML.STATUS[p.status] || { label: p.status }).label;
    if ($('#ped-status').textContent !== 'Status do pedido: ' + rotulo) $('#ped-status').textContent = 'Status do pedido: ' + rotulo;
    var passos = PASSOS[p.modo] || PASSOS.entrega, ordem = passos.map(function (x) { return x[0]; }), idx = ordem.indexOf(p.status);
    // status "neon" com o rótulo do passo atual ("Na chapa" ganha fumaça e brilho laranja)
    neon.textContent = p.status === 'cancelado' ? 'Cancelado' : (passos[idx] ? passos[idx][1] : rotulo);
    neon.className = 'ped-neon' + (p.status === 'preparo' ? ' chapa' : p.status === 'cancelado' ? ' cancelado' : (p.status === 'pronto' || p.status === 'rota' || p.status === 'entregue') ? ' pronto' : '');
    topo.classList.toggle('na-chapa', p.status === 'preparo' && !reduz);
    $('#linha-tempo').innerHTML = p.status === 'cancelado'
      ? '<li class="passo atual cancelado"><span class="bolha">' + ic('x') + '</span><span><strong>Cancelado</strong><small>' + esc(msg) + '</small></span></li>'
      : passos.map(function (ps, i) {
        var h = p.historico.filter(function (x) { return x.status === ps[0]; })[0];
        var cls = i < idx || (i === idx && p.status === 'entregue') ? 'feito' : (i === idx ? 'atual' + (ps[0] === 'preparo' ? ' chapa' : '') : '');
        return '<li class="passo ' + cls + '"><span class="bolha">' + ic(ps[2]) + '</span><span><strong>' + esc(ps[1]) + '</strong><small>' + (h ? horaDe(h.em) : 'aguardando') + '</small></span></li>';
      }).join('');
    var antes = statusVisto[st.pedidoToken];
    statusVisto[st.pedidoToken] = p.status;
    if (antes && antes !== p.status && !reduz) {
      var lampada = $('#linha-tempo .passo.atual') || $$('#linha-tempo .passo.feito').pop();
      if (lampada) lampada.classList.add('acende');
      var selo = $('#pedido-selo'); selo.classList.remove('pisca'); void selo.offsetWidth; selo.classList.add('pisca');
    }
    $('#ped-itens').innerHTML = p.itens.map(function (i) {
      return '<div class="linha" style="grid-template-columns:1fr"><div><div class="linha-nome"><span>' + i.qtd + '× ' + esc(i.nome) + '</span><span class="preco">' + brl(i.subtotal) + '</span></div><div class="linha-esc">' + tagsDoItem(i) + '</div></div></div>';
    }).join('');
    // total do servidor (nunca o calculado no navegador)
    $('#ped-total').textContent = brl(p.total) + (p.modo !== 'entrega' ? '' : p.taxaEntrega != null ? ' (com entrega de ' + brl(p.taxaEntrega) + ')' : ' + entrega');
    $('#ped-wa').href = ML.whatsapp.link(ML.whatsapp.mensagem(Object.assign({ cliente: { nome: '' }, endereco: '', referencia: '', pagamento: null, troco: '', obs: '', origem: origemQR ? 'qrcode' : 'cardapio' }, p, { itens: p.itens.map(function (i) { return Object.assign({ resumo: '' }, i); }) })));
    renderMeus();
  }
  function renderMeus() {
    var outros = ML.store.meus().filter(function (m) { return m.token !== st.pedidoToken; });
    $('#bloco-meus').hidden = !outros.length;
    $('#meus').innerHTML = outros.map(function (o) { return '<button type="button" class="meu" data-ver-pedido="' + esc(o.token) + '"><span><strong>' + ML.fmt.numero(o.numero) + '</strong> · ' + esc((ML.STATUS[o.status] || { label: o.status }).label) + '</span><span class="preco">' + brl(o.total) + '</span></button>'; }).join('');
  }
  // consulta acompanhar_pedido a cada 10 s com a tela visível; para no pedido entregue ou cancelado.
  // vez: cada chamada nova invalida a anterior (nunca ficam dois ciclos de consulta rodando)
  var acomp = { timer: null, vez: 0, conferido: null };
  function pararAcompanhar() { clearTimeout(acomp.timer); acomp.timer = null; acomp.vez++; }
  function acompanhar() {
    pararAcompanhar();
    var tok = st.pedidoToken, vez = acomp.vez;
    if (!tok || st.aba !== 'app' || st.tela !== 'pedido' || document.visibilityState !== 'visible') return;
    // pedido já encerrado e conferido no servidor nesta visita: não precisa consultar de novo
    var atual = ML.store.acompanhamento(tok);
    if (atual && FINAIS.indexOf(atual.status) >= 0 && acomp.conferido === tok) return;
    ML.store.acompanhar(tok).then(function () { acomp.conferido = tok; }, function () { /* sem rede: tenta de novo no próximo ciclo */ }).then(function () {
      if (vez !== acomp.vez || tok !== st.pedidoToken || st.tela !== 'pedido') return;
      renderPedido();
      var p = ML.store.acompanhamento(tok);
      if (p === null || (p && FINAIS.indexOf(p.status) >= 0)) return;
      acomp.timer = setTimeout(acompanhar, 10000);
    });
  }
  // outro pedido de "Meus pedidos": troca o token do endereço (o link continua compartilhável)
  function verPedido(token) {
    st.pedidoToken = token;
    gravarRota('pedido', (history.state && history.state.de) || null, true);
    renderPedido(); acompanhar(); window.scrollTo(0, 0);
  }
  document.addEventListener('visibilitychange', function () {
    document.documentElement.classList.toggle('aba-oculta', document.visibilityState !== 'visible');
    if (document.visibilityState === 'visible' && st.tela === 'pedido') acompanhar();
  });
  window.addEventListener('online', function () { if (st.tela === 'pedido') acompanhar(); });

  // ================= placa: a logo oficial como placa luminosa =================
  // Sempre a imagem inteira (nunca filter, máscara ou blend na <img>). A arte já pinta acesa; a entrada (uma vez por
  // sessão) é chegar com mola + 2 lampejos + halo, e um brilho por máscara que passa uma vez e some.
  // Toque: 2 piscadas, 1 brilho e um sopro de fumaça. Balanço: mola amortecida movida pela rolagem (rAF só enquanto mexe).
  var CHAVE_PLACA = 'mineiro:v2:placa-acesa';
  var placa = $('[data-screen="bio"] [data-placa]'), placaAcesa = false;
  function passarBrilho(pl) {
    var arte = $('.placa-arte', pl), brilho = $('.placa-brilho', pl);
    if (reduz || !brilho || !arte || !arte.currentSrc || !brilho.firstChild.animate) return;
    var url = 'url("' + arte.currentSrc + '")';
    brilho.style.webkitMaskImage = url; brilho.style.maskImage = url;
    brilho.hidden = false;
    var a = brilho.firstChild.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }], { duration: 700, easing: 'ease-in-out' });
    a.onfinish = a.oncancel = function () { brilho.hidden = true; };
  }
  function acenderPlaca() {
    if (!placa || placaAcesa) return;
    placaAcesa = true;
    var ja = false;
    try { ja = sessionStorage.getItem(CHAVE_PLACA) === '1'; sessionStorage.setItem(CHAVE_PLACA, '1'); } catch { /* sem storage */ }
    if (reduz || ja) return;
    // depois da primeira pintura (a arte é candidata a LCP e já aparece acesa)
    requestAnimationFrame(function () {
      placa.classList.add('entra');
      setTimeout(function () { passarBrilho(placa); }, 1500);
    });
  }
  if (placa) {
    placa.addEventListener('click', function () {
      if (reduz) return;
      placa.classList.remove('pisca'); void placa.offsetWidth; placa.classList.add('pisca');
      setTimeout(function () { passarBrilho(placa); }, 450);
      soprarFumaca($('.fumaca', placa));
    });
  }
  // y nasce nulo: ler window.scrollY na carga força o layout da página inteira antes de o JS terminar de montar o DOM (368 ms no
  // trace do Lighthouse, e depois o layout se refaz); o primeiro evento de rolagem só marca o ponto de partida
  var balanco = { ang: 0, vel: 0, rodando: false, y: null };
  function balancarPlaca() {
    var y = window.scrollY, dy = balanco.y === null ? 0 : y - balanco.y;
    balanco.y = y;
    if (reduz || !placa || st.aba !== 'app' || st.tela !== 'bio' || !dy) return;
    balanco.vel += clamp(dy * 0.025, -0.9, 0.9);
    if (!balanco.rodando) { balanco.rodando = true; requestAnimationFrame(passoBalanco); }
  }
  function passoBalanco() {
    var b = balanco;
    b.vel += -0.05 * b.ang; b.vel *= 0.9; b.ang = clamp(b.ang + b.vel, -3, 3);
    if (Math.abs(b.ang) < 0.02 && Math.abs(b.vel) < 0.02) { b.ang = 0; b.vel = 0; placa.style.transform = ''; b.rodando = false; return; }
    placa.style.transform = 'rotate(' + b.ang.toFixed(2) + 'deg)';
    requestAnimationFrame(passoBalanco);
  }
  // cenas (parede com brasas, halo e anel): pausam fora da tela
  if ('IntersectionObserver' in window) {
    var ioCena = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('pausa', !e.isIntersecting); }); });
    $$('[data-cena], #pedido-topo').forEach(function (el) { ioCena.observe(el); });
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
    trocarFoto($('#story-img'), slug, '1080', 'story');
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
  // a sacola de destino: o botão flutuante (bio e site) ou a sacola redonda do cabeçalho
  function alvoCarrinho() {
    if (!$('#fab').hidden) return $('#fab');
    var b = $('[data-screen="' + st.tela + '"] [data-sacola-btn]');
    if (b && b.offsetParent) return b;
    if (st.tela === 'menu' && !$('#barra').hidden) return $('#barra .btn');
    return null;
  }
  function pular(el) {
    var b = el.querySelector('.badge') || el; b.classList.remove('pula'); void b.offsetWidth; b.classList.add('pula');
    if (el.classList.contains('ibtn-sacola')) { el.classList.remove('acende'); void el.offsetWidth; el.classList.add('acende'); }
  }
  // a foto -q voa até a sacola (420 ms); com movimento reduzido, só o contador muda
  function voar(origem, p) {
    var alvo = alvoCarrinho();
    if (reduz || !alvo) { if (alvo) pular(alvo); return; }
    var fonte = origem && (origem.querySelector('.foto img, .arte') || origem);
    if (!fonte || !fonte.getBoundingClientRect().width) { pular(alvo); return; }
    var r = fonte.getBoundingClientRect(), a = alvo.getBoundingClientRect(), size = Math.max(54, Math.min(r.width, 96));
    var el = document.createElement('div');
    el.className = 'voo'; el.innerHTML = p.foto && FOTOS[p.foto] ? '<img ' + atrFoto(p.foto, 'q', null, 'cedo') + ' alt="">' : visual(p, 'q');
    el.style.cssText = 'left:' + (r.left + r.width / 2 - size / 2) + 'px;top:' + (r.top + r.height / 2 - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px';
    document.body.appendChild(el);
    var dx = a.left + a.width / 2 - (r.left + r.width / 2), dy = a.top + a.height / 2 - (r.top + r.height / 2);
    el.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 70) + 'px) scale(.75) rotate(-14deg)', opacity: 1, offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.2) rotate(-30deg)', opacity: 0.4 }
    ], { duration: 420, easing: 'cubic-bezier(.45,0,.55,1)' }).onfinish = function () { el.remove(); pular(alvo); };
  }
  // toast: um de cada vez, 4 s, pausa no hover e no foco; a ação é "Ver sacola" ou "Personalizar"
  var tst = { timer: null, acao: null, fim: 0, resta: 0 };
  var elToast = $('#toast'), btnToast = $('#toast-acao');
  btnToast.tabIndex = -1;
  function fecharToast() { clearTimeout(tst.timer); elToast.classList.remove('on'); btnToast.tabIndex = -1; }
  function agendarToast(ms) { clearTimeout(tst.timer); tst.fim = Date.now() + ms; tst.timer = setTimeout(fecharToast, ms); }
  function toast(txt, acao) {
    $('#toast-txt').textContent = txt;
    if (st.aba === 'app' && (st.tela === 'sacola' || st.tela === 'checkout')) return;
    tst.acao = acao || { rotulo: 'Ver sacola', fn: function () { navegar('sacola'); } };
    btnToast.textContent = tst.acao.rotulo;
    btnToast.tabIndex = 0;
    elToast.classList.add('on');
    agendarToast(4000);
  }
  function pausarToast() { if (!elToast.classList.contains('on')) return; clearTimeout(tst.timer); tst.resta = Math.max(1500, tst.fim - Date.now()); }
  function seguirToast() { if (elToast.classList.contains('on') && !elToast.matches(':hover') && !elToast.contains(document.activeElement)) agendarToast(tst.resta || 1500); }
  elToast.addEventListener('mouseenter', pausarToast);
  elToast.addEventListener('focusin', pausarToast);
  elToast.addEventListener('mouseleave', seguirToast);
  elToast.addEventListener('focusout', function () { setTimeout(seguirToast, 0); });
  btnToast.addEventListener('click', function () { var a = tst.acao; fecharToast(); if (a) a.fn(); });
  function atualizarContadores() {
    var t = totaisSacola();
    $$('[data-contador]').forEach(function (b) { b.textContent = t.n; b.hidden = t.n === 0; });
    $$('[data-contagem]').forEach(function (b) { b.textContent = plural(t.n); });
    var taxa = taxaCalculada();
    $$('[data-total]').forEach(function (b) { b.textContent = brl(t.v + (taxa != null && b.closest('[data-screen="checkout"]') ? taxa : 0)); });
    $$('[data-total-txt]').forEach(function (b) { b.textContent = t.n ? plural(t.n) + ' · ' + brl(t.v) : 'Nada na sacola ainda'; });
    $$('[data-sacola-btn]').forEach(function (b) { b.classList.toggle('cheio', t.n > 0); });
    $('#barra').hidden = !(t.n > 0 && st.aba === 'app' && st.tela === 'menu');
    // o botão flutuante mostra a sacola no site e na bio (telas sem o botão da sacola no cabeçalho)
    $('#fab').hidden = !(t.n > 0 && (st.aba === 'site' || st.tela === 'bio'));
  }

  // ================= telas e rotas =================
  // Rotas no hash: #bio (início, também sem hash), #cardapio (e #cardapio/<categoria>), #site, #sacola, #checkout e #pedido.
  // Cada troca entra no histórico, então o voltar do navegador refaz o caminho.
  var TELA_DA_ROTA = { bio: 'bio', cardapio: 'menu', sacola: 'sacola', checkout: 'checkout', pedido: 'pedido' };
  var ROTA_DA_TELA = { bio: 'bio', menu: 'cardapio', sacola: 'sacola', checkout: 'checkout', pedido: 'pedido' };
  function podeTransicao() { return !!document.startViewTransition && !reduz && document.visibilityState === 'visible'; }
  function silenciar(t) { ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { if (t && t[k]) t[k].catch(function () {}); }); }
  function rotaAtual() { return st.aba === 'site' ? 'site' : ROTA_DA_TELA[st.tela]; }
  // '#cardapio' → 'cardapio'; vazio ou desconhecido → 'bio' (o prefixo vale: '#pedido/…' → 'pedido')
  function lerRota(hash) {
    var h = String(hash || '').replace(/^#/, '').split('/')[0];
    return h === 'site' || h === 'painel' || TELA_DA_ROTA[h] ? h : 'bio';
  }
  function mostrarView(qual) {
    st.aba = qual;
    $('#view-app').hidden = qual !== 'app';
    $('#view-site').hidden = qual !== 'site';
    if (qual === 'site') carregarSite(); else pararSite();
  }
  function focarTitulo(raiz) {
    var h = raiz.querySelector('h1:not(.sr)') || raiz.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  // troca a tela do app; inicial = primeira pintura (sem transição nem foco)
  function irTela(tela, inicial) {
    var usaVT = !inicial && podeTransicao();
    var troca = function () {
      if (st.aba !== 'app') mostrarView('app');
      st.tela = tela;
      $$('[data-screen]').forEach(function (s) { s.hidden = s.getAttribute('data-screen') !== tela; });
      if (tela === 'menu') { renderMenu(); requestAnimationFrame(marcarChip); animarFaixas(); }
      if (tela === 'sacola') renderSacola();
      if (tela === 'checkout') renderCheckout();
      if (tela === 'pedido') { renderPedido(); acompanhar(); } else pararAcompanhar();
      if (tela === 'checkout') esconderErroEnvio();
      if (tela === 'bio') { animarFaixas(); atualizarPedirDeNovo(); acenderPlaca(); adiantarSite(); }
      atualizarContadores();
      if (inicial) return;
      window.scrollTo(0, 0);
      var atual = $('[data-screen="' + tela + '"]');
      if (!usaVT) { atual.classList.remove('entra'); void atual.offsetWidth; atual.classList.add('entra'); }
      focarTitulo(atual);
    };
    if (usaVT) silenciar(document.startViewTransition(troca)); else troca();
  }
  function irSite(inicial) {
    var troca = function () {
      mostrarView('site'); atualizarContadores();
      if (inicial) return;
      window.scrollTo(0, 0); focarTitulo($('#view-site'));
    };
    if (!inicial && podeTransicao()) silenciar(document.startViewTransition(troca)); else troca();
  }
  // mostra a rota (sem mexer no histórico); devolve a rota de fato mostrada
  function aplicarRota(rota, inicial) {
    if (rota === 'checkout' && !sacola.length) rota = 'cardapio';
    if (dlg.open) dlg.close();
    fecharStory();
    fecharToast();
    if (rota === 'site') irSite(inicial); else irTela(TELA_DA_ROTA[rota] || 'bio', inicial);
    return rota;
  }
  function gravarRota(rota, de, substituir) {
    var estado = { rota: rota, de: de }, hash = rota === 'pedido' && st.pedidoToken ? 'pedido/' + st.pedidoToken : rota;
    try { history[substituir ? 'replaceState' : 'pushState'](estado, '', '#' + hash); } catch { /* sem histórico */ }
  }
  // navegação pelos botões e links do app: entra no histórico (ou substitui a entrada atual)
  function navegar(rota, substituir) {
    var de = rotaAtual();
    if (rota === de && !substituir) return;
    var mostrada = aplicarRota(rota);
    if (substituir) gravarRota(mostrada, (history.state && history.state.de) || null, true);
    else if (mostrada !== de) gravarRota(mostrada, de, false);
  }
  // botão "voltar" do cabeçalho: se a tela anterior no histórico é o destino, volta de verdade
  function voltarPara(rota) {
    if (history.state && history.state.de === rota) history.back(); else navegar(rota);
  }
  // voltar/avançar do navegador e links diretos digitados
  function aoMudarEndereco() {
    var rota = lerRota(location.hash);
    if (rota === 'painel') { location.replace('/painel/'); return; }
    // link de outro pedido (#pedido/<token>) com a tela de pedido já aberta
    var tok = rota === 'pedido' ? tokenDaRota(location.hash) : null;
    if (tok && tok !== st.pedidoToken) { st.pedidoToken = tok; if (rotaAtual() === 'pedido') { renderPedido(); acompanhar(); return; } }
    var cat = categoriaDaRota(location.hash);
    if (rota !== rotaAtual()) {
      var mostrada = aplicarRota(rota);
      if (mostrada !== rota) gravarRota(mostrada, (history.state && history.state.de) || null, true);
    }
    irCategoria(cat);
  }
  function animarFaixas() { $$('[data-faixa-combo]').forEach(function (f) { f.classList.remove('anima'); void f.offsetWidth; f.classList.add('anima'); }); }

  // ================= site imersivo (chunk próprio) =================
  // src/site/site.js (e o CSS das cenas) só vem por import(): na primeira visita a #site ou, depois da bio, no ocioso
  // (fora do modo economia de dados). A bio e o cardápio não pagam nada pelo site. iniciar() monta as cenas uma vez
  // e liga; parar() desliga quando a view do site sai de cena (docs/DIRECAO-VISUAL.md 6.1).
  var site = { modulo: null, carga: null, adiantado: false };
  function carregarSite() {
    if (!site.carga) {
      site.carga = import('./site/site.js').then(function (m) { site.modulo = m; return m; }, function (err) {
        site.carga = null; // sem rede: tenta de novo na próxima visita
        console.warn('site: o chunk não carregou', err);
        return null;
      });
    }
    return site.carga.then(function (m) {
      if (!m) return;
      m.iniciar();
      if (st.aba !== 'site') m.parar(); // carregou no ocioso ou o visitante já saiu: monta e fica desligado
    });
  }
  function pararSite() { if (site.modulo) site.modulo.parar(); }
  // depois da bio: espera a carga da página e mais 2 s, e pede o chunk quando o navegador estiver ocioso
  function adiantarSite() {
    if (site.adiantado || site.carga) return;
    site.adiantado = true;
    var c = navigator.connection;
    if (c && c.saveData) return;
    var ocioso = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1); };
    var depois = function () { setTimeout(function () { ocioso(function () { carregarSite(); }, { timeout: 5000 }); }, 2000); };
    if (document.readyState === 'complete') depois(); else window.addEventListener('load', depois, { once: true });
  }

  // ================= eventos =================
  document.addEventListener('click', function (e) {
    var t = e.target.closest('a[href^="#"],[data-go],[data-rapido],[data-abrir],[data-chip],[data-filtro],[data-completo],[data-ing],[data-prensado],[data-combo],[data-adic],[data-fq],#ficha-add,[data-fechar-ficha],[data-sq],[data-editar],[data-upsell],[data-modo],[data-pag],[data-story-abrir],[data-story],[data-fechar-story],#story-pedir,[data-ver-pedido],[data-novo-pedido],[data-tentar],[data-pedir-de-novo],[data-comanda-abre]');
    if (!t) return;
    var A = function (n) { return t.getAttribute(n); };
    // links internos (#bio, #site, #cardapio/<categoria>…): mesma navegação dos botões, com o histórico do app
    if (t.matches('a[href^="#"]')) {
      var h = A('href').slice(1);
      if (!h || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); navegar(lerRota(h)); irCategoria(categoriaDaRota(h)); return;
    }
    if (t.hasAttribute('data-go')) {
      var go = A('data-go'), rota = ROTA_DA_TELA[go] || go;
      if (go === 'checkout' && !sacola.length) return;
      if (t.hasAttribute('data-voltar')) voltarPara(rota); else navegar(rota);
    }
    else if (t.hasAttribute('data-rapido')) adicionarRapido(A('data-rapido'), t.parentNode.querySelector('[data-abrir]'));
    else if (t.hasAttribute('data-abrir')) abrirFicha(A('data-abrir'), { origem: t.closest('[data-abrir]') });
    else if (t.hasAttribute('data-chip')) { var cat = $('#cat-' + A('data-chip')); if (cat) cat.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' }); }
    else if (t.hasAttribute('data-filtro')) { st.filtro = st.filtro === A('data-filtro') ? null : A('data-filtro'); $$('[data-filtro]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filtro') === st.filtro)); }); renderMenu(); }
    else if (t.hasAttribute('data-completo')) { var c0 = ficha.sel.completo === false ? 1 : 0; ficha.sel.completo = A('data-completo') === '1'; if (ficha.sel.completo) ficha.sel.removidos = []; renderFicha(true, trocaSeg('completo', c0, ficha.sel.completo ? 0 : 1)); }
    else if (t.hasAttribute('data-ing')) { var ing = A('data-ing'), r = ficha.sel.removidos || (ficha.sel.removidos = []), ix = r.indexOf(ing); if (ix >= 0) r.splice(ix, 1); else r.push(ing); renderFicha(true); var f = $('[data-ing="' + CSS.escape(ing) + '"]', dlg); if (f) f.focus(); }
    else if (t.hasAttribute('data-prensado')) { var p0 = ficha.sel.prensado ? 1 : 0; ficha.sel.prensado = A('data-prensado') === '1'; renderFicha(true, trocaSeg('prensado', p0, ficha.sel.prensado ? 1 : 0)); }
    else if (t.hasAttribute('data-combo')) {
      var ligado = !ficha.sel.combo.ativo;
      ficha.sel.combo.ativo = ligado;
      renderFicha(true, { sel: '.grupo-combo', de: function (g) { g.classList.toggle('on', !ligado); $('[data-combo]', g).setAttribute('aria-checked', String(!ligado)); }, para: function (g) { g.classList.toggle('on', ligado); $('[data-combo]', g).setAttribute('aria-checked', String(ligado)); } });
      var sw = $('[data-combo]', dlg); if (sw) sw.focus();
    }
    else if (t.hasAttribute('data-adic')) { var id = A('data-adic'), ad = ficha.sel.adicionais || (ficha.sel.adicionais = {}); ad[id] = Math.max(0, Math.min(5, (ad[id] || 0) + (+A('data-d')))); if (!ad[id]) delete ad[id]; renderFicha(true); var bf = $('[data-adic="' + id + '"][data-d="' + A('data-d') + '"]', dlg); if (bf && !bf.disabled) bf.focus(); }
    else if (t.hasAttribute('data-fq')) { ficha.sel.qtd = Math.max(1, Math.min(20, (ficha.sel.qtd || 1) + (+A('data-fq')))); atualizarRodapeFicha(); }
    else if (t.id === 'ficha-add') confirmarFicha();
    else if (t.hasAttribute('data-fechar-ficha')) fecharFicha();
    else if (t.hasAttribute('data-sq')) {
      var l = linhaDe(A('data-sq'));
      if (l) { l.sel.qtd += +A('data-d'); if (l.sel.qtd <= 0) sacola = sacola.filter(function (x) { return x !== l; }); salvarSacola(); renderSacola(); }
    }
    else if (t.hasAttribute('data-editar')) { var le = linhaDe(A('data-editar')); if (le) abrirFicha(le.sel.produtoId, { sel: le.sel, editar: le.chave, origem: t.closest('[data-card]') }); }
    else if (t.hasAttribute('data-upsell')) {
      var lu = linhaDe(A('data-upsell'));
      if (lu) { var s2 = JSON.parse(JSON.stringify(lu.sel)); s2.combo = { ativo: true, refri: '' }; abrirFicha(s2.produtoId, { sel: s2, editar: lu.chave, origem: t.closest('[data-card]'), focoRefri: true }); }
    }
    else if (t.hasAttribute('data-modo')) { st.modo = A('data-modo'); agendarTaxa(true); renderCheckout(); salvarRascunho(); }
    else if (t.hasAttribute('data-pag')) { st.pagamento = A('data-pag'); renderCheckout(); }
    else if (t.hasAttribute('data-story-abrir')) abrirStory(+A('data-story-abrir'));
    else if (t.hasAttribute('data-story')) passarStory(+A('data-story'));
    else if (t.hasAttribute('data-fechar-story')) fecharStory();
    else if (t.id === 'story-pedir') { var pid = A('data-produto'); fecharStory(); if (pid) abrirFicha(pid); }
    else if (t.hasAttribute('data-ver-pedido')) verPedido(A('data-ver-pedido'));
    else if (t.hasAttribute('data-tentar')) { var form = $('#form-pedido'); if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }
    else if (t.hasAttribute('data-novo-pedido')) navegar('cardapio');
    else if (t.hasAttribute('data-pedir-de-novo')) pedirDeNovo();
    else if (t.hasAttribute('data-comanda-abre')) { var aberta = A('aria-expanded') !== 'true'; t.setAttribute('aria-expanded', String(aberta)); t.textContent = aberta ? 'Recolher' : 'Ver itens'; $('#chk-lista').hidden = !aberta; }
  });
  $('#f-busca').addEventListener('input', function (e) { st.busca = e.target.value; renderMenu(); });
  window.addEventListener('scroll', function () {
    if (st.aba === 'app' && st.tela === 'menu') marcarChip();
    else if (st.aba === 'app' && st.tela === 'bio') balancarPlaca();
  }, { passive: true });
  window.addEventListener('popstate', aoMudarEndereco);
  window.addEventListener('hashchange', aoMudarEndereco);
  // status do pedido, esgotados, preços e loja chegando do servidor (store do Supabase: Realtime ou consulta)
  ML.store.ouvir(function (ev) {
    var tipo = ev.tipo || '';
    if (tipo.indexOf('pedido') === 0) { if (st.aba === 'app' && st.tela === 'pedido') renderPedido(); atualizarContadores(); }
    if (tipo === 'cardapio:esgotados' || tipo === 'cardapio:estado') {
      if (tipo === 'cardapio:estado') { montarBio(); marcarCarregadas($('#destaques')); atualizarStatus(); atualizarPrecosFixos(); atualizarContadores(); if (entr.ok && entr.estado !== 'ok' && entr.estado !== 'calculando') agendarTaxa(true); }
      if (st.tela === 'menu') renderMenu();
      if (st.tela === 'sacola') renderSacola();
      if (st.tela === 'checkout') renderCheckout();
      if (dlg.open) renderFicha(true);
    }
    if (tipo === 'loja:modo') { atualizarStatus(); if (st.tela === 'checkout') renderCheckout(); }
  });

  // ================= início =================
  // A bio é a tela inicial. Link direto (#cardapio, #site…) abre a tela pedida; quem chega pelo QR (?origem=qrcode) cai no cardápio.
  var inicial = lerRota(location.hash), catInicial = categoriaDaRota(location.hash);
  if (!location.hash && origemQR && new URLSearchParams(location.search).get('origem') === 'qrcode') inicial = 'cardapio';
  if (inicial === 'checkout' && !sacola.length) inicial = 'cardapio';
  if (inicial === 'pedido') { st.pedidoToken = tokenDaRota(location.hash); if (!st.pedidoToken && !ML.store.meus().length) inicial = 'cardapio'; }
  // estado antes de montar: as imagens da tela inicial carregam já, as outras ficam para depois (lazy)
  st.aba = inicial === 'site' ? 'site' : 'app';
  st.tela = TELA_DA_ROTA[inicial] || 'bio';
  // contrato com o site imersivo (docs/DIRECAO-VISUAL.md 0.4): o site só chama estas funções
  ML.app = {
    abrirFicha: function (id, opcoes) { abrirFicha(id, opcoes || {}); },
    adicionarRapido: function (id, origem) { adicionarRapido(id, origem || null); },
    irCategoria: irCategoria,
    // fotos reais (fotos.json): atr/trocar/visual como no app; uso = chave de SIZES ou o texto do sizes
    foto: {
      atr: atrFoto, // (slug, tam "q"|"540"|"1080", uso, carga "lcp"|"cedo"|"lazy") → atributos do <img>
      trocar: trocarFoto, // (img, slug, tam, uso)
      visual: visual, // (produto, tam, classeExtra, { uso, carga }) → <span class="foto nova|antiga"><img></span> ou a arte
      nova: ehNova, // (slug) → a foto é de origem 'nova'
      marcarCarregadas: marcarCarregadas, // (raiz) → .ok nas fotos já carregadas
      info: function (slug) { return FOTOS[slug] || null; }, // { w, h, cor, foco, origem }
      slugs: function () { return Object.keys(FOTOS); },
      produtoDe: function (slug) { return produtoDaFoto[slug] || null; } // o produto dono da foto (dog-max → Hot Dog Max)
    },
    ic: ic, // (nome, classe) → <svg class="ic"><use href="#i-nome"/></svg>
    ingTexto: ingTexto, // (produto) → "Queijo, Cheddar, …" ou o inclui do combo
    contar: contar, // (el, valor) → escreve o preço e rola o número (sem rolar com movimento reduzido)
    soprarFumaca: soprarFumaca, // (el .fumaca)
    passarBrilho: passarBrilho, // (el .placa com .placa-arte e .placa-brilho)
    indisponivel: indisponivel // (id) → esgotado hoje ou fora do cardápio
  };
  montarBio(); montarChips(); renderMenu();
  atualizarStatus(); atualizarPrecosFixos(); agendarStatus();
  aplicarRota(inicial, true);
  irCategoria(catInicial);
  // public/rota.js mostrou a tela pedida antes da primeira pintura; daqui em diante vale o hidden do app
  document.documentElement.removeAttribute('data-tela-inicial');
  var mostrada = rotaAtual();
  if (location.hash || mostrada !== 'bio') gravarRota(mostrada, null, true);
  else try { history.replaceState({ rota: 'bio', de: null }, ''); } catch { /* sem histórico */ }
  marcarCarregadas(document);
  window.MLApp = { navegar: navegar, irTela: irTela };
}
