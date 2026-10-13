/* Mineiro Lanche · site imersivo: base comum das cenas (docs/DIRECAO-VISUAL.md 6.1).
   - reduz(): prefers-reduced-motion, lido na hora (o usuário pode mudar com a página aberta).
   - observar(el): um IntersectionObserver só para todas as seções; fora da tela a seção leva .pausa (o CSS pausa as
     animações dela) e, na primeira vez que entra, ganha .visivel (fica).
   - registrar(el, opcoes): a seção entra no laço rAF único, movido por scroll passivo e resize, que só roda com
     alguma seção registrada visível; ele escreve --p (0 a 1) na seção e chama opcoes.quadro(p, info) a cada quadro.
   - revelar(raiz): os .rv abaixo da dobra sobem com opacidade quando entram (os de cima começam visíveis).
   - embrulharLetras(el): letra por letra em spans (animação por --i), palavras em nowrap e o texto no aria-label.
   Só transform, opacity e clip-path animam; nada aqui usa setInterval. */

const MQ = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export function reduz() {
  return !!(MQ && MQ.matches);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------- visibilidade: .pausa e .visivel ----------
const temIO = 'IntersectionObserver' in window;
const visiveis = new Set(); // seções na tela agora
const regs = new Map(); // seção registrada → { modo, topo, quadro, p }
let ultimoY = window.scrollY;
let vel = 0;
let pendente = false;

const io = temIO
  ? new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          const el = e.target;
          el.classList.toggle('pausa', !e.isIntersecting);
          if (e.isIntersecting) {
            visiveis.add(el);
            el.classList.add('visivel');
          } else {
            visiveis.delete(el);
            // saiu num salto de rolagem: fecha o --p no valor de agora (0 ou 1) antes de parar
            const r = regs.get(el);
            if (r) atualizar(el, r, { y: window.scrollY, vh: window.innerHeight, vel: vel, dy: 0 });
          }
        });
        pedirQuadro();
      },
      // a margem de baixo faz a seção "entrar" quando já ocupa 10% da altura da janela
      { rootMargin: '0px 0px -10% 0px', threshold: 0 }
    )
  : null;

// a seção passa a ser vigiada (sem IntersectionObserver: fica sempre visível e sem pausa)
export function observar(el) {
  if (!el) return;
  if (io) io.observe(el);
  else {
    visiveis.add(el);
    el.classList.add('visivel');
  }
}
// a seção está na tela agora?
export function visivel(el) {
  return visiveis.has(el);
}

// ---------- laço rAF único: --p por seção ----------
// opcoes.modo: 'passagem' (padrão) = 0 quando o topo da seção aparece embaixo, 1 quando o fim dela sai em cima;
//              'preso' = cena com palco sticky: 0 quando o topo da seção chega a opcoes.topo (px), 1 quando o fim
//              dela chega ao pé da janela (a faixa em que o palco fica preso).
// opcoes.semP: a cena não usa o --p (o CSS dela não o lê): o laço não o calcula nem o escreve (escrever uma propriedade herdada
//              refaz o estilo da seção inteira a cada quadro de rolagem) e o quadro recebe p = 0.
// opcoes.quadro(p, info): chamado a cada quadro do laço com a seção visível; info = { y, vh, vel, dy }
//              (vel = velocidade da rolagem suavizada, em px por quadro; dy = quanto rolou desde o último quadro).
// Com movimento reduzido: --p fica em 1 (cena completa) e o quadro não é chamado.
// Devolve a função que tira a seção do laço.
export function registrar(el, opcoes) {
  if (!el) return () => {};
  const o = opcoes || {};
  const r = { modo: o.modo === 'preso' ? 'preso' : 'passagem', topo: +o.topo || 0, quadro: o.quadro || null, p: -1, semP: !!o.semP };
  regs.set(el, r);
  observar(el);
  atualizar(el, r, { y: window.scrollY, vh: window.innerHeight, vel: 0, dy: 0 });
  pedirQuadro();
  return () => {
    regs.delete(el);
  };
}

function progresso(el, r, vh) {
  const b = el.getBoundingClientRect();
  if (r.modo === 'preso') {
    const faixa = b.height - (vh - r.topo);
    return faixa <= 0 ? (b.top <= r.topo ? 1 : 0) : clamp01((r.topo - b.top) / faixa);
  }
  return clamp01((vh - b.top) / (vh + b.height));
}
function escreverP(el, r, p) {
  if (Math.abs(p - r.p) < 0.0005) return;
  r.p = p;
  el.style.setProperty('--p', p.toFixed(4));
}
function atualizar(el, r, info) {
  if (reduz()) {
    if (!r.semP) escreverP(el, r, 1);
    return;
  }
  if (r.semP) {
    if (r.quadro) r.quadro(0, info);
    return;
  }
  const p = progresso(el, r, info.vh);
  escreverP(el, r, p);
  if (r.quadro) r.quadro(p, info);
}

// pede um quadro do laço (rolagem, resize ou uma cena que mudou algo pelo ponteiro); só agenda com seção visível
export function pedirQuadro() {
  if (pendente) return;
  for (const el of regs.keys()) {
    if (visiveis.has(el)) {
      pendente = true;
      requestAnimationFrame(quadro);
      return;
    }
  }
}
function quadro() {
  pendente = false;
  const y = window.scrollY;
  const dy = y - ultimoY;
  ultimoY = y;
  vel = vel * 0.85 + Math.abs(dy) * 0.15;
  const info = { y: y, vh: window.innerHeight, vel: vel, dy: dy };
  regs.forEach((r, el) => {
    if (visiveis.has(el)) atualizar(el, r, info);
  });
  // a velocidade cai suave até parar (as fitas desaceleram em vez de travar)
  if (vel > 0.5 && !reduz()) pedirQuadro();
  else vel = 0;
}
window.addEventListener('scroll', pedirQuadro, { passive: true });
window.addEventListener('resize', pedirQuadro);

// ---------- revelação dos .rv ----------
// Os que estão abaixo da dobra ganham .fora e sobem quando entram; os de cima começam visíveis.
// Com a raiz escondida (site montado no carregamento ocioso), espera ela aparecer para medir.
export function revelar(raiz) {
  if (!raiz || reduz() || !temIO) return;
  const medir = () => {
    const vh = window.innerHeight;
    const ioRv = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.remove('fora');
            ioRv.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    // as seções abaixo da dobra (content-visibility: auto, com o miolo pulado) são medidas pela caixa delas: medir cada .rv obrigaria
    // o navegador a montar o layout de todas, que é o que o content-visibility evita
    const abaixo = new Map();
    raiz.querySelectorAll('.rv').forEach((el) => {
      const sec = el.closest('section');
      if (sec && !abaixo.has(sec)) abaixo.set(sec, sec.getBoundingClientRect().top > vh);
      if ((sec && abaixo.get(sec)) || el.getBoundingClientRect().top > vh) {
        el.classList.add('fora');
        ioRv.observe(el);
      }
    });
  };
  if (raiz.getClientRects().length) {
    medir();
    return;
  }
  const espera = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    espera.disconnect();
    medir();
  });
  espera.observe(raiz);
}

// ---------- título letra por letra ----------
// Embrulha o texto de el (inclusive dentro de spans filhos, que ficam) em <span class="palavra" aria-hidden="true">
// com um <span class="letra" style="--i:n"> por letra; o índice segue de um filho para o outro. O leitor de tela lê
// o aria-label (posto aqui se o elemento não tiver um). Chamar de novo não refaz. Devolve o número de letras.
export function embrulharLetras(el, inicio) {
  if (!el) return 0;
  if (el.hasAttribute('data-embrulhado')) return +el.getAttribute('data-embrulhado');
  if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  let i = +inicio || 0;
  const textos = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) textos.push(n);
  textos.forEach((n) => {
    const frag = document.createDocumentFragment();
    n.nodeValue.split(/(\s+)/).forEach((pedaco) => {
      if (!pedaco) return;
      if (/^\s+$/.test(pedaco)) {
        frag.appendChild(document.createTextNode(pedaco));
        return;
      }
      const pal = document.createElement('span');
      pal.className = 'palavra';
      pal.setAttribute('aria-hidden', 'true');
      Array.from(pedaco).forEach((ch) => {
        const l = document.createElement('span');
        l.className = 'letra';
        l.style.setProperty('--i', i++);
        l.textContent = ch;
        pal.appendChild(l);
      });
      frag.appendChild(pal);
    });
    n.parentNode.replaceChild(frag, n);
  });
  el.setAttribute('data-embrulhado', String(i));
  return i;
}
