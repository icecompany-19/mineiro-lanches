// Medidas das telas (A11a, B-ck, B19, P10b): abre as mesmas telas do harness de capturas e grava capturas/medidas-<alvo>.json.
// Uso (Git Bash): source scripts/supabase-local/ambiente-windows.sh && node scripts/capturas/medir.mjs cliente|site|painel
//   [--sem-build] [--apenas=<trecho do rótulo, ex. 390-aberto>] [--cena=<site>] [--estrito]
// Por tela × largura × estado (× movimento reduzido):
//   contraste     cor computada do texto contra a cor média do fundo, amostrada numa captura feita com o texto transparente
//                 (para o fundo não levar a cor das letras), sob o retângulo de cada texto visível; < 4,5:1 (ou < 3:1 se o texto tem ≥ 24 px)
//   tijolo        largura de todo elemento (e ::before/::after) cujo background-image usa tijolo-real-1/2 (nítido) contra 420 px
//   alvos         controles clicáveis com menos de 44 px (cliente/site) ou 48 px (painel) em alguma dimensão
//   rolagem       scrollWidth > clientWidth
//   imagens       <img> ou fundo com filter, blend ou máscara; <img> distorcida (proporção do quadro ≠ proporção da imagem sem object-fit)
//   animações     com prefers-reduced-motion: tudo que ainda está rodando; sem ele: propriedades fora de transform/opacity/clip-path
// Sai com 0 mesmo com itens fora do limite (é um relatório); --estrito sai com 1 se houver algum. Erro do harness sai com 1.
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { executar, subirServidor, PASTA, rotuloVariante } from './lib.mjs';

/* global document, window, getComputedStyle, NodeFilter, CSSAnimation, CSSTransition, CSSStyleRule, CSSMediaRule, CSSSupportsRule, innerWidth, innerHeight, scrollY, scrollTo, requestAnimationFrame */

const LIMITE_TIJOLO = 420;
const RAZAO_TEXTO = 4.5;
const RAZAO_GRANDE = 3;
const TEXTO_GRANDE_PX = 24;
const PROP_PERMITIDAS = ['transform', 'opacity', 'clipPath', 'translate', 'rotate', 'scale'];

// ================== dentro da página ==================
// Instala window.__ml com as funções que as medidas usam (uma vez por tela; o registro de textos medidos recomeça).
function instalar() {
  const ml = {};
  window.__ml = ml;
  ml.seletor = (el) => {
    const partes = [];
    let e = el;
    for (let n = 0; e && e.nodeType === 1 && n < 3 && e !== document.body; n++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) {
        partes.unshift(s + '#' + e.id);
        break;
      }
      const cls = (e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      partes.unshift(s);
    }
    return partes.join(' > ');
  };
  const cor = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  ml.cor = cor;
  ml.opacidade = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  ml.modal = () => Array.from(document.querySelectorAll('dialog[open]')).find((d) => d.matches(':modal')) || null;
  // recorta o retângulo pelos ancestrais com overflow (para quando o texto está fora do quadro que o esconde)
  ml.recortar = (r, el) => {
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = a.getBoundingClientRect();
        if (cs.overflowX !== 'visible') {
          x0 = Math.max(x0, b.left);
          x1 = Math.min(x1, b.right);
        }
        if (cs.overflowY !== 'visible') {
          y0 = Math.max(y0, b.top);
          y1 = Math.min(y1, b.bottom);
        }
      }
      if (cs.position === 'fixed') break;
    }
    return x1 - x0 >= 2 && y1 - y0 >= 2 ? { left: x0, top: y0, right: x1, bottom: y1 } : null;
  };
  ml.ocultar = (sim) => {
    let s = document.getElementById('__ml-oculta');
    if (!s) {
      s = document.createElement('style');
      s.id = '__ml-oculta';
      s.textContent =
        '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;caret-color:transparent!important;transition:none!important;text-decoration-color:transparent!important}' +
        '*::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important}text,tspan{fill:transparent!important}';
      document.head.appendChild(s);
    }
    s.media = sim ? 'all' : 'not all';
  };
  ml.estado = { medidos: new Set(), ocultos: new Set(), transparentes: new Set(), cobertos: new Map(), minusculos: new Set(), candidatos: new Map(), chavesMedidas: new Set() };
  // textos visíveis na janela atual que ainda não foram medidos
  // borda: { topo, base } diz se esta janela é a primeira/última da varredura. Texto na faixa de cima ou de baixo da janela fica para
  // outra janela (embaixo de barra fixa com degradê o fundo não é o da página), salvo nas pontas, onde não haveria outra chance.
  ml.coletar = (raiz, borda) => {
    const est = ml.estado;
    const saida = [];
    const vw = innerWidth, vh = innerHeight;
    const processar = (chave, el, texto, r, fill, tam, peso) => {
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || cs.display === 'none') {
        est.ocultos.add(chave);
        return;
      }
      const c = cor(fill);
      if (!c) return;
      const alfa = c[3] * ml.opacidade(el);
      if (c[3] === 0) {
        est.transparentes.add(chave);
        return;
      }
      if (alfa < 0.02) {
        est.ocultos.add(chave);
        return;
      }
      const rr = ml.recortar(r, el);
      if (!rr) {
        est.minusculos.add(chave);
        return;
      }
      const x0 = Math.max(0, rr.left), y0 = Math.max(0, rr.top), x1 = Math.min(vw, rr.right), y1 = Math.min(vh, rr.bottom);
      const area = (rr.right - rr.left) * (rr.bottom - rr.top);
      const vis = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      est.candidatos.set(chave, ml.seletor(el) + '|' + texto.replace(/s+/g, ' ').trim().slice(0, 60) + ' => ' + ml.seletor(el) + ' "' + texto.replace(/s+/g, ' ').trim().slice(0, 25) + '" @' + Math.round(rr.top) + ',' + Math.round(rr.bottom) + ' vis ' + Math.round((100 * vis) / area) + '%');
      const cy = (y0 + y1) / 2;
      if ((cy < vh * 0.18 && !borda.topo) || (cy > vh * 0.82 && !borda.base)) return;
      if (vis / area < 0.9 && !(rr.bottom - rr.top > vh * 0.9 && vis / area >= 0.5)) return; // fica para outra janela
      const topo = document.elementFromPoint(Math.min(vw - 1, Math.max(0, (x0 + x1) / 2)), Math.min(vh - 1, Math.max(0, (y0 + y1) / 2)));
      if (topo && !(el.contains(topo) || topo.contains(el))) {
        est.cobertos.set(chave, ml.seletor(el) + ' <- ' + ml.seletor(topo));
        return;
      }
      est.medidos.add(chave);
      est.chavesMedidas.add(ml.seletor(el) + '|' + texto.replace(/s+/g, ' ').trim().slice(0, 60));
      saida.push({
        texto: texto.replace(/\s+/g, ' ').trim().slice(0, 60),
        seletor: ml.seletor(el),
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        cor: c.slice(0, 3), alfa, tamanho: parseFloat(tam), peso: String(peso)
      });
    };
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const faixa = document.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (est.medidos.has(n) || est.ocultos.has(n) || est.transparentes.has(n) || est.minusculos.has(n)) continue;
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('script,style,noscript,svg,template,option,[hidden]')) continue;
      faixa.selectNodeContents(n);
      const r = faixa.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      const cs = getComputedStyle(el);
      processar(n, el, n.nodeValue, r, cs.webkitTextFillColor || cs.color, cs.fontSize, cs.fontWeight);
    }
    // valores e placeholders de campos (não são nós de texto)
    raiz.querySelectorAll('input,textarea,select').forEach((el) => {
      if (est.medidos.has(el) || est.ocultos.has(el)) return;
      if (el.tagName === 'INPUT' && /^(hidden|checkbox|radio|range|file|color|image|button|submit|reset)$/.test(el.type)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
      let texto = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : '') : el.value;
      const cs = getComputedStyle(el);
      let fill = cs.webkitTextFillColor || cs.color;
      if (!texto && el.placeholder) {
        texto = el.placeholder;
        fill = getComputedStyle(el, '::placeholder').color;
      }
      if (!texto) return;
      processar(el, el, texto, r, fill, cs.fontSize, cs.fontWeight);
    });
    return saida;
  };
  ml.scrollers = (raiz) =>
    Array.from(raiz.querySelectorAll('*')).filter((e) => {
      const cs = getComputedStyle(e);
      return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 8 && e.clientHeight > 40 && e.getBoundingClientRect().height > 0;
    });
}

// medidas do DOM (tudo menos o contraste)
function medirDom({ escopo, minAlvo, tijoloMax, reduzido, permitidas }) {
  const ml = window.__ml;
  const modal = ml.modal();
  const raiz = modal || escopo || document.documentElement;
  const todos = [raiz, ...raiz.querySelectorAll('*')];
  const num = (v) => Math.round(v * 10) / 10;
  const resumoTxt = (el) => (el.getAttribute('aria-label') || el.textContent || el.value || el.title || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 50);

  // ----- alvos clicáveis
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=switch],[role=tab],[role=link],[role=checkbox],[role=radio],[role=menuitem],[tabindex]:not([tabindex="-1"])';
  const oculto = (el) => {
    const r = el.getBoundingClientRect();
    return r.width < 4 || r.height < 4 || getComputedStyle(el).opacity === '0';
  };
  const candidatos = new Set(raiz.matches && raiz.matches(SEL) ? [raiz] : []);
  raiz.querySelectorAll(SEL).forEach((e) => candidatos.add(e));
  raiz.querySelectorAll('label').forEach((l) => {
    if (l.control && oculto(l.control)) candidatos.add(l);
  });
  const alvosAbaixo = [];
  let alvosTotal = 0;
  candidatos.forEach((el) => {
    if (el.closest('[inert]')) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || ml.opacidade(el) < 0.02) return;
    if (el.tagName !== 'LABEL' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (r.width < 4 || r.height < 4)) return;
    if (el.tagName === 'INPUT' && el.labels && el.labels.length && oculto(el)) return;
    alvosTotal++;
    if (r.width >= minAlvo - 0.5 && r.height >= minAlvo - 0.5) return;
    alvosAbaixo.push({
      seletor: ml.seletor(el),
      texto: resumoTxt(el),
      largura: num(r.width),
      altura: num(r.height),
      emLinha: cs.display === 'inline' && !!el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 4,
      desabilitado: !!el.disabled
    });
  });

  // ----- tijolo nítido
  const tijolo = [];
  todos.forEach((el) => {
    for (const pseudo of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo || null);
      const bg = cs.backgroundImage || '';
      const m = /tijolo-real-(1|2)\.webp/.exec(bg);
      if (!m) continue;
      const r = el.getBoundingClientRect();
      let largura = r.width;
      if (pseudo) {
        const w = parseFloat(cs.width);
        largura = Number.isNaN(w) ? r.width : w;
        if (cs.content === 'none') continue;
      }
      tijolo.push({ seletor: ml.seletor(el) + pseudo, textura: 'tijolo-real-' + m[1], largura: num(largura), limite: tijoloMax, visivel: r.width > 0 && cs.display !== 'none', ok: largura <= tijoloMax });
    }
  });

  // ----- rolagem horizontal
  const de = document.documentElement;
  const culpados = [];
  if (de.scrollWidth > de.clientWidth || document.body.scrollWidth > de.clientWidth) {
    document.querySelectorAll('body *').forEach((el) => {
      if (culpados.length >= 8) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.right <= de.clientWidth + 1) return;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return;
      if (getComputedStyle(el).position === 'fixed') return;
      culpados.push({ seletor: ml.seletor(el), direita: num(r.right), largura: num(r.width) });
    });
  }

  // ----- imagens
  const imagens = { total: 0, comFiltro: [], comBlendOuMascara: [], fundosComBlendOuMascara: [], distorcidas: [], semCarga: [] };
  todos.forEach((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const ehImg = el.tagName === 'IMG';
    const fundoFoto = /url\(/.test(cs.backgroundImage || '');
    if (!ehImg && !fundoFoto) return;
    if (!r.width || !r.height) return;
    if (ehImg) imagens.total++;
    const ref = { seletor: ml.seletor(el), arquivo: ehImg ? (el.currentSrc || el.src || '').split('/').pop().split('?')[0] : (/url\("?[^")]*?([^/")]+)"?\)/.exec(cs.backgroundImage) || [])[1] };
    let filtro = cs.filter !== 'none' ? cs.filter : '';
    let onde = filtro ? 'própria' : '';
    for (let a = el.parentElement; a && !filtro && a !== document.documentElement; a = a.parentElement) {
      const f = getComputedStyle(a).filter;
      if (f && f !== 'none') {
        filtro = f;
        onde = 'ancestral ' + ml.seletor(a);
      }
    }
    if (filtro) imagens.comFiltro.push({ ...ref, filter: filtro, onde });
    const blend = cs.mixBlendMode !== 'normal' ? cs.mixBlendMode : '';
    const mascara = (cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none') ? 'máscara' : '';
    if (blend || mascara) (ehImg ? imagens.comBlendOuMascara : imagens.fundosComBlendOuMascara).push({ ...ref, blend, mascara });
    if (!ehImg) return;
    if (!el.naturalWidth) {
      imagens.semCarga.push({ ...ref, loading: el.loading });
      return;
    }
    if (cs.objectFit === 'fill' || cs.objectFit === '') {
      const cw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ch = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (cw > 0 && ch > 0) {
        const razao = cw / ch / (el.naturalWidth / el.naturalHeight);
        if (Math.abs(razao - 1) > 0.02) imagens.distorcidas.push({ ...ref, natural: el.naturalWidth + 'x' + el.naturalHeight, quadro: num(cw) + 'x' + num(ch), deformacao: Math.round((razao - 1) * 1000) / 10 + '%' });
      }
    }
  });

  // ----- animações
  const vivas = [];
  const foraDaRegra = [];
  let infinitas = 0;
  let totalVivas = 0;
  document.getAnimations().forEach((a) => {
    const alvo = a.effect && a.effect.target;
    if (escopo && alvo && !escopo.contains(alvo)) return;
    if (a.playState !== 'running' && a.playState !== 'pending') return;
    totalVivas++;
    const tim = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
    const infinita = tim.iterations === Infinity;
    if (infinita) infinitas++;
    const tipo = a instanceof CSSAnimation ? 'animation:' + a.animationName : a instanceof CSSTransition ? 'transition:' + a.transitionProperty : 'js';
    const props = new Set();
    try {
      a.effect.getKeyframes().forEach((k) => Object.keys(k).forEach((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p) && props.add(p)));
    } catch {
      /* sem keyframes legíveis */
    }
    const lista = Array.from(props);
    const item = { tipo, alvo: alvo ? ml.seletor(alvo) : '', propriedades: lista, infinita, duracaoMs: typeof tim.duration === 'number' ? Math.round(tim.duration) : null };
    if (reduzido) vivas.push(item);
    const fora = lista.filter((p) => !permitidas.includes(p));
    if (fora.length) foraDaRegra.push({ ...item, fora });
  });

  return {
    modalAberto: !!modal,
    alvos: { limite: minAlvo, total: alvosTotal, abaixo: alvosAbaixo.length, itens: alvosAbaixo },
    tijolo: { limite: tijoloMax, elementos: tijolo.length, acimaDoLimite: tijolo.filter((t) => !t.ok).length, itens: tijolo },
    rolagemHorizontal: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bodyScrollWidth: document.body.scrollWidth, estoura: de.scrollWidth > de.clientWidth, culpados },
    imagens,
    animacoes: { reduzido, vivas: totalVivas, infinitas, listaVivas: reduzido ? vivas.slice(0, 40) : undefined, foraDaRegra: foraDaRegra.slice(0, 40), foraDaRegraTotal: foraDaRegra.length }
  };
}

// regras do CSS que usam o tijolo nítido (uma vez por alvo: o que existe, mesmo que a tela medida não mostre)
function regrasComTijolo() {
  const achadas = [];
  const ler = (regras, sufixo) => {
    for (const r of Array.from(regras)) {
      if (r.cssRules && !(r instanceof CSSStyleRule)) ler(r.cssRules, sufixo + (r instanceof CSSMediaRule ? ' @media ' + r.conditionText : r instanceof CSSSupportsRule ? ' @supports' : ''));
      else if (r instanceof CSSStyleRule && /parede-nitida|tijolo-real-(1|2)/.test(r.cssText)) achadas.push(r.selectorText + sufixo);
    }
  };
  for (const s of Array.from(document.styleSheets)) {
    try {
      ler(s.cssRules, '');
    } catch {
      /* folha de outra origem */
    }
  }
  return achadas;
}

// ================== no Node ==================
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const razao = (a, b) => {
  const [x, y] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (x + 0.05) / (y + 0.05);
};
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// cor média (e a do percentil pior) do fundo sob o retângulo, na captura sem texto
function amostrar(buf, info, e, escala) {
  const W = info.width, H = info.height, C = info.channels;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(e.x * escala)));
  const y0 = Math.max(0, Math.min(H - 1, Math.floor(e.y * escala)));
  const x1 = Math.max(x0 + 1, Math.min(W, Math.ceil((e.x + e.w) * escala)));
  const y1 = Math.max(y0 + 1, Math.min(H, Math.ceil((e.y + e.h) * escala)));
  const passo = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500)));
  const px = [];
  let r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y += passo) {
    for (let x = x0; x < x1; x += passo) {
      const i = (y * W + x) * C;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      px.push([buf[i], buf[i + 1], buf[i + 2]]);
    }
  }
  const n = px.length || 1;
  const media = [r / n, g / n, b / n];
  px.sort((p, q) => lum(p) - lum(q));
  return { media, claro: px[Math.min(px.length - 1, Math.floor(px.length * 0.9))] || media, escuro: px[Math.floor(px.length * 0.1)] || media };
}

function avaliar(e, am) {
  const a = Math.min(1, e.alfa);
  const comp = (fundo) => e.cor.map((v, k) => v * a + fundo[k] * (1 - a));
  const txt = comp(am.media);
  const limite = e.tamanho >= TEXTO_GRANDE_PX ? RAZAO_GRANDE : RAZAO_TEXTO;
  const claro = lum(txt) >= lum(am.media);
  const pior = am.media && (claro ? am.claro : am.escuro);
  return {
    texto: e.texto,
    seletor: e.seletor,
    razao: Math.round(razao(txt, am.media) * 100) / 100,
    razaoPiorPonto: Math.round(razao(comp(pior), pior) * 100) / 100,
    limite,
    tamanhoPx: e.tamanho,
    peso: e.peso,
    corTexto: hex(txt),
    corFundo: hex(am.media),
    retangulo: { x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h) }
  };
}

// espera terminar o que é finito (entradas por opacidade ao rolar, transições): amostrar um texto a meio caminho do fade mede uma cor que não existe em repouso
const assentar = (page) =>
  page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => !(a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming().iterations === Infinity))
          .map((a) => a.finished.catch(() => {}))
      ),
      new Promise((ok) => setTimeout(ok, 1500))
    ])
  );

// percorre a tela em janelas (rolagem da página, ou do que rola dentro da gaveta aberta), medindo o contraste texto a texto
async function medirContraste(page, escopo) {
  await page.evaluate(() => window.__ml.ocultar(false));
  const plano = await page.evaluate((esc) => {
    const ml = window.__ml;
    const modal = ml.modal();
    const vh = innerHeight;
    const rolaveis = modal ? ml.scrollers(modal).length : 0;
    let topo = 0, base = document.documentElement.scrollHeight;
    if (esc) {
      const r = esc.getBoundingClientRect();
      topo = Math.max(0, r.top + scrollY - 20);
      base = r.bottom + scrollY;
    }
    return { modal: !!modal, vh, topo, base, rolaveis };
  }, escopo);

  const itens = [];
  const janela = async (borda) => {
    const entradas = await page.evaluate(({ esc, b }) => {
      const ml = window.__ml;
      return ml.coletar(ml.modal() || esc || document.body, b);
    }, { esc: escopo, b: borda });
    if (!entradas.length) return;
    let png;
    try {
      await page.evaluate(() => window.__ml.ocultar(true));
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      png = await page.screenshot({ timeout: 60_000 }); // em 390 (DPR 3), sem GPU, uma janela leva até ~7 s
    } finally {
      await page.evaluate(() => window.__ml.ocultar(false));
    }
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const escala = info.width / (await page.evaluate(() => innerWidth));
    for (const e of entradas) itens.push(avaliar(e, amostrar(data, info, e, escala)));
  };

  if (plano.modal) {
    const n = plano.rolaveis;
    await assentar(page);
    await janela({ topo: true, base: n === 0 });
    for (let k = 0; k < n; k++) {
      const alturas = await page.evaluate((k2) => {
        const el = window.__ml.scrollers(window.__ml.modal())[k2];
        return el ? { sh: el.scrollHeight, ch: el.clientHeight } : null;
      }, k);
      if (!alturas) continue;
      const passoRolagem = Math.floor(alturas.ch * 0.6);
      const ultimo = Math.ceil((alturas.sh - alturas.ch) / passoRolagem);
      for (let q = 1; q <= ultimo; q++) {
        await page.evaluate(({ k2, y2 }) => (window.__ml.scrollers(window.__ml.modal())[k2].scrollTop = y2), { k2: k, y2: q * passoRolagem });
        await page.waitForTimeout(150);
        await assentar(page);
        await janela({ topo: false, base: q === ultimo && k === n - 1 });
      }
      await page.evaluate((k2) => (window.__ml.scrollers(window.__ml.modal())[k2].scrollTop = 0), k);
    }
  } else {
    const passo = Math.floor(plano.vh * 0.6); // sobreposição grande: o texto sob um cabeçalho fixo aparece livre noutra janela
    const ys = [];
    for (let y = plano.topo; ; y += passo) {
      ys.push(y);
      if (y + plano.vh >= plano.base) break;
    }
    for (const [q, y] of ys.entries()) {
      await page.evaluate((yy) => scrollTo(0, yy), y);
      await page.waitForTimeout(150);
      await assentar(page);
      await janela({ topo: q === 0, base: q === ys.length - 1 });
    }
    await page.evaluate(() => scrollTo(0, 0));
  }

  const est = await page.evaluate(() => {
    const e = window.__ml.estado;
    const cobList = Array.from(e.cobertos).filter(([n]) => !e.medidos.has(n));
    const cob = cobList.length;
    // um nó de texto trocado pelo app durante a varredura (relógio, contadores) conta como o que já foi medido
    const parciais = Array.from(e.candidatos).filter(([n, v]) => !e.medidos.has(n) && !e.cobertos.has(n) && !e.chavesMedidas.has(v.split(' => ')[0]));
    const novoTotal = e.candidatos.size;
    return { exemplos: cobList.slice(0, 6).map(([, v]) => v), exemplosParciais: parciais.slice(0, 6).map(([, v]) => v.split(' => ')[1]), parciaisN: parciais.length, candidatos: novoTotal, medidos: e.medidos.size, transparentes: e.transparentes.size, cobertos: cob, ocultos: e.ocultos.size, minusculos: e.minusculos.size };
  });
  const abaixo = itens.filter((i) => i.razao < i.limite);
  const abaixoPior = itens.filter((i) => i.razaoPiorPonto < i.limite);
  abaixo.sort((a, b) => a.razao - b.razao);
  return {
    limites: { texto: RAZAO_TEXTO, textoGrande: RAZAO_GRANDE, textoGrandeAPartirDePx: TEXTO_GRANDE_PX },
    textosAmostrados: itens.length,
    abaixoDoLimite: abaixo.length,
    abaixoDoLimiteNoPiorPonto: abaixoPior.length,
    piorRazao: itens.length ? Math.min(...itens.map((i) => i.razao)) : null,
    naoAmostrados: { candidatos: est.candidatos, parciaisOuForaDaVarredura: est.parciaisN, cobertosPorOutroElemento: est.cobertos, exemplosCobertos: est.exemplos, exemplosNaoAmostrados: est.exemplosParciais, transparentes: est.transparentes, ocultos: est.ocultos, minusculos: est.minusculos },
    menoresRazoes: [...itens].sort((a, b) => a.razao - b.razao).slice(0, 8),
    itens: abaixo.slice(0, 40)
  };
}

async function medirTela({ page, alvo, nome, variante, elemento }) {
  const base = { tela: nome, largura: variante.largura, estado: variante.estado, reduzido: variante.reduzido, chave: `${nome}-${rotuloVariante(variante)}`, captura: `${alvo}/${nome}-${rotuloVariante(variante)}.png` };
  try {
    await page.evaluate(instalar);
    const dom = await page.evaluate(medirDom, {
      escopo: elemento || null,
      minAlvo: alvo === 'painel' ? 48 : 44,
      tijoloMax: LIMITE_TIJOLO,
      reduzido: variante.reduzido,
      permitidas: PROP_PERMITIDAS
    });
    const contraste = await medirContraste(page, elemento || null);
    return { ...base, contraste, ...dom };
  } catch (e) {
    console.log(`  falha ao medir ${base.chave}: ${e.message.split('\n')[0]}`);
    return { ...base, erro: e.message.split('\n')[0] };
  }
}

// ---------- resumo de todas as telas ----------
function resumir(telas, alvo) {
  const ok = telas.filter((t) => !t.erro);
  const unicos = (lista, chave) => {
    const m = new Map();
    for (const x of lista) {
      const k = chave(x);
      if (!m.has(k)) m.set(k, x);
    }
    return [...m.values()];
  };
  const soma = (f) => ok.reduce((s, t) => s + f(t), 0);
  const falhasContraste = ok.flatMap((t) => (t.contraste.itens || []).map((i) => ({ ...i, tela: t.chave })));
  const unicosContraste = unicos(falhasContraste.sort((a, b) => a.razao - b.razao), (i) => i.seletor + '|' + i.texto);
  const alvosFalha = ok.flatMap((t) => t.alvos.itens.map((i) => ({ ...i, tela: t.chave })));
  const tijolo = ok.flatMap((t) => t.tijolo.itens.map((i) => ({ ...i, tela: t.chave })));
  const filtros = ok.flatMap((t) => t.imagens.comFiltro.map((i) => ({ ...i, tela: t.chave })));
  const blends = ok.flatMap((t) => t.imagens.comBlendOuMascara.map((i) => ({ ...i, tela: t.chave })));
  const distorcidas = ok.flatMap((t) => t.imagens.distorcidas.map((i) => ({ ...i, tela: t.chave })));
  const reduzidas = ok.filter((t) => t.reduzido);
  return {
    alvo,
    medicoes: ok.length,
    comErro: telas.length - ok.length,
    contraste: {
      textosAmostrados: soma((t) => t.contraste.textosAmostrados),
      abaixoDoLimite: soma((t) => t.contraste.abaixoDoLimite),
      abaixoDoLimiteNoPiorPonto: soma((t) => t.contraste.abaixoDoLimiteNoPiorPonto),
      medicoesComFalha: ok.filter((t) => t.contraste.abaixoDoLimite > 0).map((t) => t.chave),
      piorRazao: ok.length ? Math.min(...ok.map((t) => (t.contraste.piorRazao == null ? 99 : t.contraste.piorRazao))) : null,
      pioresDistintos: unicosContraste.slice(0, 25),
      menoresRazoesDistintas: unicos(
        ok.flatMap((t) => (t.contraste.menoresRazoes || []).map((i) => ({ ...i, tela: t.chave }))).sort((a, b) => a.razao - b.razao),
        (i) => i.seletor + '|' + i.texto
      ).slice(0, 10)
    },
    tijolo: {
      limite: LIMITE_TIJOLO,
      medicoesComTijoloNitido: ok.filter((t) => t.tijolo.itens.some((i) => i.visivel)).map((t) => t.chave),
      acimaDoLimite: unicos(tijolo.filter((i) => !i.ok), (i) => i.seletor + '|' + i.tela),
      maiorLarguraVisivel: tijolo.filter((i) => i.visivel).length ? Math.max(...tijolo.filter((i) => i.visivel).map((i) => i.largura)) : null,
      elementosDistintos: Object.values(
        tijolo.reduce((m, i) => {
          const x = (m[i.seletor] = m[i.seletor] || { seletor: i.seletor, textura: i.textura, maiorLarguraVisivel: 0, telasComOElementoVisivel: 0 });
          if (i.visivel) {
            x.telasComOElementoVisivel++;
            x.maiorLarguraVisivel = Math.max(x.maiorLarguraVisivel, i.largura);
          }
          return m;
        }, {})
      )
    },
    alvos: {
      abaixoDoMinimo: soma((t) => t.alvos.abaixo),
      abaixoDoMinimoSoLinksNoTexto: soma((t) => t.alvos.itens.filter((i) => i.emLinha).length),
      medicoesComFalha: ok.filter((t) => t.alvos.abaixo > 0).map((t) => t.chave),
      distintos: unicos(alvosFalha, (i) => i.seletor).slice(0, 40)
    },
    rolagemHorizontal: { medicoesQueEstouram: ok.filter((t) => t.rolagemHorizontal.estoura).map((t) => `${t.chave} (${t.rolagemHorizontal.scrollWidth} > ${t.rolagemHorizontal.clientWidth})`) },
    imagens: {
      avaliadas: soma((t) => t.imagens.total),
      comFiltro: unicos(filtros, (i) => i.seletor + '|' + i.filter),
      comBlendOuMascara: unicos(blends, (i) => i.seletor),
      fundosComBlendOuMascaraInformativo: unicos(ok.flatMap((t) => t.imagens.fundosComBlendOuMascara.map((i) => ({ ...i, tela: t.chave }))), (i) => i.seletor + '|' + i.blend + '|' + i.mascara),
      distorcidas: unicos(distorcidas, (i) => i.seletor + '|' + i.arquivo)
    },
    animacoes: {
      comMovimentoReduzido: {
        medicoes: reduzidas.length,
        comAnimacaoViva: reduzidas.filter((t) => t.animacoes.vivas > 0).map((t) => `${t.chave}: ${t.animacoes.vivas} viva(s), ${t.animacoes.infinitas} infinita(s)`),
        distintas: unicos(reduzidas.flatMap((t) => t.animacoes.listaVivas || []), (a) => a.tipo + '|' + a.alvo).slice(0, 30)
      },
      propriedadesForaDeTransformOpacityClipPath: unicos(ok.flatMap((t) => t.animacoes.foraDaRegra.map((a) => ({ ...a, tela: t.chave }))), (a) => a.tipo + '|' + a.fora.join()).slice(0, 30)
    }
  };
}

function imprimir(r) {
  const c = r.contraste, t = r.tijolo;
  console.log(`\nMedidas de ${r.alvo}: ${r.medicoes} medições (${r.comErro} com erro)`);
  console.log(`  contraste: ${c.textosAmostrados} textos amostrados, ${c.abaixoDoLimite} abaixo do limite (${c.abaixoDoLimiteNoPiorPonto} no pior ponto do fundo), pior razão ${c.piorRazao}`);
  console.log(`  tijolo nítido: ${t.medicoesComTijoloNitido.length} medições com o elemento; acima de ${t.limite} px: ${t.acimaDoLimite.length}; maior largura visível: ${t.maiorLarguraVisivel}`);
  console.log(`  alvos abaixo do mínimo: ${r.alvos.abaixoDoMinimo} em ${r.alvos.medicoesComFalha.length} medições`);
  console.log(`  rolagem horizontal: ${r.rolagemHorizontal.medicoesQueEstouram.length} medições estouram`);
  console.log(`  imagens: ${r.imagens.avaliadas} avaliadas, ${r.imagens.comFiltro.length} com filter, ${r.imagens.comBlendOuMascara.length} com blend/máscara, ${r.imagens.distorcidas.length} distorcidas`);
  console.log(`  animações com movimento reduzido: ${r.animacoes.comMovimentoReduzido.comAnimacaoViva.length} de ${r.animacoes.comMovimentoReduzido.medicoes} medições com algo vivo; fora de transform/opacity/clip-path: ${r.animacoes.propriedadesForaDeTransformOpacityClipPath.length}`);
}

// ---------- principal ----------
const args = process.argv.slice(2);
const alvoPedido = args.find((a) => !a.startsWith('--'));
if (!['cliente', 'site', 'painel'].includes(alvoPedido)) {
  console.error('uso: node scripts/capturas/medir.mjs cliente|site|painel [--sem-build] [--apenas=390-aberto] [--cena=s0] [--estrito]');
  process.exit(2);
}
const cena = (args.find((a) => a.startsWith('--cena=')) || '').slice(7);
if (cena) process.env.CAPTURAS_CENA = cena;
const opc = { build: !args.includes('--sem-build'), apenas: (args.find((a) => a.startsWith('--apenas=')) || '').slice(9) || null };

const modulo = await import(`./${alvoPedido}.mjs`);
const servidor = await subirServidor({ build: opc.build });
let codigo = 0;
try {
  const telas = [];
  let regras = [];
  console.log(`== medidas: ${alvoPedido}`);
  const { erros, falhas } = await executar(
    modulo,
    async (ctx) => {
      if (ctx.soCaptura) return; // estado só para a foto (ex.: S2 em p = .5 e 1): a cena inteira já é medida
      if (!regras.length) regras = await ctx.page.evaluate(regrasComTijolo).catch(() => []);
      const m = await medirTela(ctx);
      const i = telas.findIndex((t) => t.chave === m.chave); // variante repetida depois de uma falha: vale a última
      if (i >= 0) telas[i] = m;
      else telas.push(m);
    },
    { ...opc, servidor }
  );
  const resumo = resumir(telas, alvoPedido);
  resumo.tijolo.regrasNoCss = regras;
  const saida = join(PASTA, `medidas-${alvoPedido}.json`);
  mkdirSync(PASTA, { recursive: true });
  const parcial = !!(opc.apenas || cena);
  writeFileSync(
    saida,
    JSON.stringify(
      {
        alvo: alvoPedido,
        geradoEm: new Date().toISOString(),
        parcial,
        relogio: { aberto: '2026-10-13T20:00-03:00', fechado: '2026-10-13T14:00-03:00' },
        limites: { contraste: { texto: RAZAO_TEXTO, textoGrande: RAZAO_GRANDE, textoGrandeAPartirDePx: TEXTO_GRANDE_PX }, tijoloNitidoPx: LIMITE_TIJOLO, alvoMinimoPx: alvoPedido === 'painel' ? 48 : 44 },
        errosDeConsole: erros,
        falhasDoHarness: falhas,
        resumo,
        telas
      },
      null,
      2
    )
  );
  imprimir(resumo);
  console.log(`  gravado em ${saida}`);
  if (erros.length) console.log(`  ${erros.length} erro(s) de console:\n   ` + erros.slice(0, 10).join('\n   '));
  if (falhas.length) console.log(`  ${falhas.length} falha(s) do harness:\n   ` + falhas.join('\n   '));
  if (erros.length || falhas.length || resumo.comErro) codigo = 1;
  if (args.includes('--estrito') && (resumo.contraste.abaixoDoLimite || resumo.tijolo.acimaDoLimite.length || resumo.alvos.abaixoDoMinimo || resumo.rolagemHorizontal.medicoesQueEstouram.length || resumo.imagens.comFiltro.length || resumo.imagens.distorcidas.length || resumo.animacoes.comMovimentoReduzido.comAnimacaoViva.length)) codigo = 1;
} finally {
  servidor.parar();
}
process.exit(codigo);
