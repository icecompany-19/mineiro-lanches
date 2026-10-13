// Apoio dos specs de aceite (tests/aceite-cliente.spec.js e tests/aceite-painel.spec.js): medidas que os dois repetem.
// Não é um spec (o Playwright só roda *.spec.js): é importado pelos dois.
// Cada medida devolve dados e deixa o expect para o spec, com a mensagem do caso.
/* global document, window, getComputedStyle, CSSRule, requestAnimationFrame */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const RAIZ = resolve(import.meta.dirname, '../..');

// ---------- API local compartilhada ----------
// O Postgres/PostgREST/proxy locais são usados por vários agentes ao mesmo tempo e às vezes derrubam uma conexão
// (ECONNRESET). route.fetch() tenta de novo antes de desistir.
export async function buscar(route, tentativas = 4) {
  for (let i = 1; ; i++) {
    try {
      return await route.fetch();
    } catch (e) {
      if (i >= tentativas || !/ECONNRESET|ECONNREFUSED|socket hang up|EPIPE/i.test(String(e.message))) throw e;
      await new Promise((ok) => setTimeout(ok, 300 * i));
    }
  }
}

// ---------- janela ----------
// celular = 390×844 (largura do aceite, não os 412 do Pixel 7); desktop = 1280×800. O spec escolhe pelo projeto.
export const JANELAS = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } };
export const larguraDoProjeto = (testInfo) => (testInfo.project.name === 'celular' ? 390 : 1280);

// ---------- ferramentas dentro da página ----------
// window.__aceite.desc(el): "button#id.classe1.classe2[data-act=x]"; areaEfetiva(el): caixa do elemento somada à dos
// pseudo-elementos absolutos (o ::after de .filtro estende o alvo do corpo de 36 px; docs/DIRECAO-VISUAL.md 4.2 conta com 44).
export async function instalarApoio(page) {
  await page.addInitScript(() => {
    const desc = (el, fundo = 0) => {
      if (!el || !el.tagName) return String(el);
      const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
      const attr = ['data-act', 'data-nav', 'data-go', 'data-modo', 'role'].filter((a) => el.getAttribute(a) != null).map((a) => `[${a}=${el.getAttribute(a)}]`).join('');
      const proprio = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls.trim() ? '.' + cls.trim().split(/\s+/).join('.') : '') + attr;
      // sem id nem classe, o pai ajuda a achar o elemento ("div.ficha-foto > img")
      if (!el.id && !cls.trim() && !attr && fundo < 3 && el.parentElement && el.parentElement !== document.body) return desc(el.parentElement, fundo + 1) + ' > ' + proprio;
      return proprio;
    };
    const areaEfetiva = (el) => {
      const r = el.getBoundingClientRect();
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom, pseudo = false;
      const cs = getComputedStyle(el);
      if (cs.position !== 'static') {
        for (const p of ['::before', '::after']) {
          const ps = getComputedStyle(el, p);
          if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || ps.position !== 'absolute' || ps.pointerEvents === 'none') continue;
          const L = parseFloat(ps.left), T = parseFloat(ps.top), W = parseFloat(ps.width), H = parseFloat(ps.height);
          if ([L, T, W, H].some(Number.isNaN)) continue;
          const left = r.left + (parseFloat(cs.borderLeftWidth) || 0) + L;
          const top = r.top + (parseFloat(cs.borderTopWidth) || 0) + T;
          x0 = Math.min(x0, left); y0 = Math.min(y0, top); x1 = Math.max(x1, left + W); y1 = Math.max(y1, top + H);
          pseudo = true;
        }
      }
      return { w: x1 - x0, h: y1 - y0, base: { w: r.width, h: r.height }, pseudo };
    };
    window.__aceite = { desc, areaEfetiva };
  });
}

// ---------- rolagem horizontal ----------
// documentElement.scrollWidth === clientWidth e o scrollTo para a direita não anda (o body tem overflow-x:hidden, que
// esconde a barra mas não o excesso: por isso se confere também o deslocamento real).
export async function rolagemHorizontal(page) {
  return page.evaluate(async () => {
    const d = document.documentElement;
    const antes = window.scrollY;
    window.scrollTo(99999, antes);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const andou = window.scrollX;
    window.scrollTo(0, antes);
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, bodyScrollWidth: document.body.scrollWidth, andou };
  });
}

// ---------- alvos de toque ----------
const CONTROLES = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="switch"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [tabindex="0"]';

// Controles visíveis dentro de `raiz` cuja área efetiva é menor que `minimo` × `minimo`. Fica de fora:
// - o que não aparece (checkVisibility) e o escondido só para leitor de tela (1×1);
// - link no meio de uma frase (display inline com outro texto no mesmo bloco): WCAG 2.5.8 e 2.5.5 o isentam.
export async function alvosPequenos(page, raiz, minimo) {
  return page.evaluate(
    ({ raiz, minimo, controles }) => {
      const ap = window.__aceite;
      const pequenos = [];
      let conferidos = 0;
      const escopo = raiz ? [...document.querySelectorAll(raiz)] : [document.body];
      const vistos = new Set();
      for (const base of escopo) {
        for (const el of base.querySelectorAll(controles)) {
          if (vistos.has(el)) continue;
          vistos.add(el);
          if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 1 && r.height <= 1) continue;
          if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
            const pai = el.parentElement;
            if (pai && pai.textContent.replace(el.textContent, '').trim().length > 0) continue;
          }
          conferidos++;
          const a = ap.areaEfetiva(el);
          if (a.w + 0.01 < minimo || a.h + 0.01 < minimo)
            pequenos.push({
              quem: ap.desc(el),
              texto: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
              medida: `${Math.round(a.w)}×${Math.round(a.h)}${a.pseudo ? ` (corpo ${Math.round(a.base.w)}×${Math.round(a.base.h)} + pseudo-elemento)` : ''}`
            });
        }
      }
      return { pequenos, conferidos };
    },
    { raiz, minimo, controles: CONTROLES }
  );
}

// ---------- foco por Tab ----------
// Aperta Tab até voltar ao primeiro controle e devolve, por parada, o contorno de foco. O anel esperado é
// 3px solid (--fio); o que muda por contexto (comanda de papel, campo de busca) quem confere é o spec (semAnel).
export async function percorrerTab(page, { limite = 260 } = {}) {
  await page.evaluate(() => {
    window.__tabPrimeiro = null;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  const paradas = [];
  for (let i = 0; i < limite; i++) {
    await page.keyboard.press('Tab');
    const p = await page.evaluate(async () => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { corpo: true };
      // o contorno tem transição (.opt, botões): espera as transições do elemento e um quadro; só então lê o estilo
      await Promise.allSettled(el.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').map((a) => a.finished));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (window.__tabPrimeiro === el) return { volta: true };
      if (!window.__tabPrimeiro) window.__tabPrimeiro = el;
      const anel = (e) => {
        const cs = getComputedStyle(e);
        return { largura: cs.outlineWidth, estilo: cs.outlineStyle, cor: cs.outlineColor };
      };
      const rotulo = el.closest('label');
      return {
        quem: window.__aceite.desc(el),
        texto: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 30),
        focusVisible: el.matches(':focus-visible'),
        visivel: el.checkVisibility(),
        anel: anel(el),
        anelDoRotulo: rotulo && rotulo.matches(':focus-within') ? anel(rotulo) : null,
        naComanda: !!el.closest('.comanda')
      };
    });
    if (p.volta) break;
    if (p.corpo) continue; // o foco saiu da página (barra do navegador): segue até voltar
    paradas.push(p);
  }
  return paradas;
}

// ---------- animações ----------
// Tudo o que o navegador tem em curso agora (CSS, transição e WAAPI).
export async function lerAnimacoes(page) {
  return page.evaluate(() =>
    document.getAnimations().map((a) => {
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      return {
        nome: a.animationName || a.transitionProperty || 'waapi',
        transicao: a.constructor.name === 'CSSTransition',
        estado: a.playState,
        infinita: t.iterations === Infinity,
        duracao: t.duration,
        alvo: window.__aceite.desc(a.effect && a.effect.target) + ((a.effect && a.effect.pseudoElement) || '')
      };
    })
  );
}

// "Em andamento" = o que ainda se mexe ou vai se mexer: tudo menos o que já terminou (um fill-mode: both mantém a
// animação terminada na lista de document.getAnimations()).
export const emAndamento = (animacoes) => animacoes.filter((a) => a.estado !== 'finished');

// Só estas propriedades podem ser animadas (docs/DIRECAO-VISUAL.md 1.6 e §8). As do `getKeyframes()` vêm em camelCase;
// as do CSS (@keyframes), em kebab-case; o que não é propriedade (offset, easing, composite) não conta.
export const PERMITIDAS = new Set(['transform', 'opacity', 'clipPath', 'clip-path']);
const NAO_PROPRIEDADE = new Set(['offset', 'computedOffset', 'easing', 'composite', 'animation-timing-function', 'animation-composition']);
export const propriedadesProibidas = (props) => [...new Set(props)].filter((p) => !NAO_PROPRIEDADE.has(p) && !PERMITIDAS.has(p));

// Todo @keyframes das folhas de estilo carregadas pela página: { nome, props }.
export async function keyframesDoCss(page) {
  return page.evaluate(() => {
    const achados = [];
    const ler = (regras) => {
      for (const r of regras) {
        if (r.type === CSSRule.KEYFRAMES_RULE) {
          const props = new Set();
          for (const f of r.cssRules) for (const p of f.style) props.add(p);
          achados.push({ nome: r.name, props: [...props] });
        } else if (r.cssRules) ler(r.cssRules); // @media, @supports
      }
    };
    for (const folha of document.styleSheets) {
      try {
        ler(folha.cssRules);
      } catch {
        /* folha de outra origem */
      }
    }
    return achados;
  });
}

// Gravador de animações vivas: a cada quadro anota, por animação, as propriedades que ela de fato anima (CSS ou WAAPI;
// transição fica de fora). Chave = nome do @keyframes, ou "waapi@<elemento>" para element.animate(). Uma propriedade é
// animada quando aparece em um só keyframe (o outro lado é implícito) ou com valores diferentes entre os keyframes:
// transform-origin igual nos dois lados não é animação. Instalar ANTES de navegar; ler com lerGravacao no fim.
export async function instalarGravador(page) {
  await page.addInitScript(() => {
    window.__gravacao = {};
    const visto = new WeakSet();
    const BASE = new Set(['offset', 'computedOffset', 'easing', 'composite']);
    const olhar = () => {
      for (const a of document.getAnimations()) {
        if (visto.has(a) || a.constructor.name === 'CSSTransition') continue;
        visto.add(a);
        const valores = {};
        try {
          for (const k of a.effect.getKeyframes()) for (const [p, v] of Object.entries(k)) if (!BASE.has(p)) (valores[p] = valores[p] || []).push(String(v));
        } catch {
          /* efeito sem keyframes */
        }
        const props = Object.entries(valores)
          .filter(([, vs]) => vs.length === 1 || new Set(vs).size > 1)
          .map(([p]) => p);
        const alvo = window.__aceite ? window.__aceite.desc(a.effect.target) + (a.effect.pseudoElement || '') : '?';
        const nome = a.animationName || 'waapi@' + alvo;
        const antes = window.__gravacao[nome] || { props: [], alvos: [] };
        window.__gravacao[nome] = { props: [...new Set([...antes.props, ...props])], alvos: [...new Set([...antes.alvos, alvo])].slice(0, 4) };
      }
      requestAnimationFrame(olhar);
    };
    requestAnimationFrame(olhar);
  });
}
export const lerGravacao = (page) => page.evaluate(() => window.__gravacao);

// ---------- aba oculta ----------
// O app e o painel leem document.visibilityState / document.hidden e o evento visibilitychange.
export async function ocultarAba(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
export async function mostrarAba(page) {
  await page.evaluate(() => {
    delete document.visibilityState;
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// ---------- CSP ----------
// vercel.json é a fonte da CSP de produção. O vite preview não manda cabeçalho, então a página recebe a mesma CSP por
// page.route; só o connect-src troca o Supabase de produção pelo local do .env.development, e sai o
// upgrade-insecure-requests (que tentaria https em localhost). Um script injetado de propósito prova que a CSP vale.
export function cspDeTeste() {
  const cfg = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'));
  const valor = cfg.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  const env = readFileSync(join(RAIZ, '.env.development'), 'utf8');
  const local = new URL(env.match(/^VITE_SUPABASE_URL=(.+)$/m)[1].trim());
  return valor
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && d !== 'upgrade-insecure-requests')
    .map((d) => (d.startsWith('connect-src') ? `connect-src 'self' ${local.origin} ws://${local.host}` : d))
    .join('; ');
}

export async function vigiarCsp(page) {
  const csp = cspDeTeste();
  const violacoes = [];
  // Com o HTML servido por page.route, o Chromium trata a página como de endereço "desconhecido" e bloqueia (Private
  // Network Access) as chamadas dela à API em localhost:54321. Por isso a API também passa pelo Playwright (route.fetch).
  const api = new URL(readFileSync(join(RAIZ, '.env.development'), 'utf8').match(/^VITE_SUPABASE_URL=(.+)$/m)[1].trim()).origin;
  await page.route(
    (url) => url.origin === api,
    async (route) => {
      await route.fulfill({ response: await buscar(route) });
    }
  );
  await page.route(
    (url) => url.pathname === '/' || url.pathname === '/painel/',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const resposta = await buscar(route);
      await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'content-security-policy': csp } });
    }
  );
  await page.addInitScript(() => {
    window.__violacoesCsp = [];
    document.addEventListener(
      'securitypolicyviolation',
      (e) => window.__violacoesCsp.push(`${e.effectiveDirective} bloqueou ${e.blockedURI || 'inline'} (${e.sourceFile || '?'}:${e.lineNumber || '?'})`),
      true
    );
  });
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violacoes.push('console: ' + m.text().slice(0, 200));
  });
  page.on('requestfailed', (r) => {
    if (/BLOCKED_BY_CSP/i.test((r.failure() && r.failure().errorText) || '')) violacoes.push('bloqueado: ' + r.url());
  });
  page.on('pageerror', (e) => {
    if (/Content Security Policy|unsafe-eval/i.test(e.message)) violacoes.push('erro: ' + e.message.slice(0, 200));
  });
  return {
    csp,
    // violações até agora (console, requisições e eventos do documento atual)
    async todas() {
      const doDoc = await page.evaluate(() => window.__violacoesCsp || []);
      return [...violacoes, ...doDoc];
    },
    // a CSP está valendo? Um <script> inline injetado não pode rodar. A violação do próprio canário (inline) sai da
    // lista; chamar por último, depois de ler todas()
    async canarioBloqueado() {
      const rodou = await page.evaluate(async () => {
        window.__canario = 'nao executou';
        const s = document.createElement('script');
        s.textContent = 'window.__canario = "executou"';
        document.head.appendChild(s);
        await new Promise((r) => setTimeout(r, 150));
        window.__violacoesCsp = window.__violacoesCsp.filter((v) => !/inline/i.test(v));
        return window.__canario === 'executou';
      });
      for (let i = violacoes.length - 1; i >= 0; i--) if (/inline/i.test(violacoes[i])) violacoes.splice(i, 1);
      return !rodou;
    }
  };
}
