// Aceite do site imersivo (docs/DIRECAO-VISUAL.md §6 e §8; docs/PLANO-FASE-2.md, B18). Consolida o que o site inteiro (#site, cenas S0 a S9)
// precisa cumprir e que as cenas, uma a uma, não conferem: carregamento do chunk, as seções e os títulos, a luz da loja,
// movimento reduzido, só transform/opacity/clip-path, rolagem horizontal, alvos de toque, a gaveta #ficha aberta pelo site e a
// placa do cardápio. O detalhe de cada cena fica em tests/site-ii.spec.js (S1, S1b, S3, S4, S5, S8).
// O estado do banco (estado_cardapio) vem do Supabase local, alterado no caminho (page.route), sem mexer no banco; a hora da loja, de
// page.clock.setFixedTime (America/Sao_Paulo).
// Uso: npx playwright test tests/site.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global document, window, location, getComputedStyle, scrollTo, scrollY, scrollX, innerHeight, innerWidth, NodeFilter */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { carregarCore } from '../scripts/gerar-seed.mjs';

const RAIZ = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf8');
const { CONFIG } = carregarCore(resolve(RAIZ, 'src/core.js'));

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });

// ---------- ajudas ----------

// estado_cardapio do servidor com uma mudança aplicada por cima
async function mudarEstado(page, mudar) {
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await r.fetch();
    const j = await resposta.json();
    mudar(j);
    await r.fulfill({ response: resposta, json: j });
  });
}

// 12/10/2026 é segunda-feira; o turno de segunda é o do CONFIG (19h à meia-noite). hh:mm no horário de Brasília
const SEGUNDA = (hhmm) => new Date(`2026-10-12T${hhmm}:00-03:00`);
const ABRE = parseInt(CONFIG.horarios[1][0], 10) + 'h';
// todo teste começa numa segunda às 20h (truck aberto, parede acesa), qualquer que seja a hora de quem roda; os casos da luz trocam a hora
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(SEGUNDA('20:00'));
});

// o que está entre os marcadores [Sx] inicio/fim do index.html
function bloco(cena) {
  const m = html.match(new RegExp(`<!-- \\[${cena}\\] inicio[^>]*-->([\\s\\S]*?)<!-- \\[${cena}\\] fim -->`));
  if (!m) throw new Error('o index.html não tem os marcadores [' + cena + ']');
  return m[1];
}
const semTags = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

// rola até o topo da seção (sob a barra de 56 px)
const irA = (page, seletor) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    scrollTo(0, e.getBoundingClientRect().top + scrollY - 56);
  }, seletor);

// passa pelo site inteiro, de cima a baixo, em passos de 60% da janela, chamando `aoParar` em cada parada
async function percorrer(page, aoParar) {
  for (let y = 0; ; ) {
    await page.evaluate((v) => scrollTo(0, v), y);
    await page.waitForTimeout(140);
    if (aoParar) await aoParar(y);
    const { alt, vh } = await page.evaluate(() => ({ alt: document.documentElement.scrollHeight, vh: innerHeight }));
    if (y + vh >= alt - 1) break;
    y = Math.min(y + Math.round(vh * 0.6), alt - vh);
  }
}

// opacidade de um elemento multiplicada pela dos ancestrais (0 a 1)
const opacidadeEfetiva = (page, seletor) =>
  page.evaluate((sel) => {
    let o = 1;
    for (let e = document.querySelector(sel); e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  }, seletor);

// abre o site e espera a página montar (o chunk traz .fitas.pronta)
async function abrirSite(page) {
  await page.goto('/#site');
  await expect(page.locator('#view-site')).toBeVisible();
  await expect(page.locator('.fitas.pronta')).toBeVisible();
}

// ---------- 1. o chunk do site ----------
test.describe('chunk do site', () => {
  const CHUNK_JS = /\/_app\/site-[^/?]+\.js/;
  const CHUNK_CSS = /\/_app\/site-[^/?]+\.css/;

  test('/#bio não pede o chunk do site antes de 2 s (só no ocioso, depois da carga)', async ({ page }) => {
    const pedidos = [];
    page.on('request', (r) => {
      if (CHUNK_JS.test(r.url()) || CHUNK_CSS.test(r.url())) pedidos.push({ url: r.url(), t: Date.now() });
    });
    const t0 = Date.now();
    await page.goto('/#bio');
    await expect(page.locator('[data-screen="bio"]')).toBeVisible();
    await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - t0)));
    expect(pedidos.map((p) => p.url), 'chunk do site pedido antes de 2 s').toEqual([]);
    // depois da carga e dos 2 s, o navegador ocioso adianta o chunk (JS e CSS), nunca antes
    await expect.poll(() => pedidos.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    for (const p of pedidos) expect(p.t - t0, p.url).toBeGreaterThanOrEqual(2000);
    expect(pedidos.some((p) => CHUNK_JS.test(p.url))).toBe(true);
    expect(pedidos.some((p) => CHUNK_CSS.test(p.url))).toBe(true);
  });

  test('/#site pede o chunk (JS e CSS) e monta as cenas', async ({ page }) => {
    const [js, css] = await Promise.all([
      page.waitForRequest((r) => CHUNK_JS.test(r.url())),
      page.waitForRequest((r) => CHUNK_CSS.test(r.url())),
      page.goto('/#site')
    ]);
    expect(js.url()).toMatch(CHUNK_JS);
    expect(css.url()).toMatch(CHUNK_CSS);
    await expect(page.locator('.fitas.pronta')).toBeVisible();
  });
});

// ---------- 2. as seções S0 a S9 ----------
// o título do herói quando a loja está aberta (as outras duas versões ficam em HERO)
const HERO_ABERTO = 'Acendeu: a chapa tá quente.';
const SECOES = [
  { id: 'S0', seletor: 'section.s-hero', titulo: '#s-tit [data-estado="aberto"]', texto: HERO_ABERTO },
  { id: 'S1', seletor: '.fitas' },
  { id: 'S1b', seletor: 'section.s-placa', titulo: '#placa-tit', texto: 'O que tem na chapa' },
  { id: 'S2', seletor: 'section.s-monte', titulo: '#monte-tit', texto: 'Pão seladinho na chapa' },
  { id: 'S3', seletor: 'section.s-prensa', titulo: '#prensa-tit', texto: 'Prensado ou não?' },
  { id: 'S4', seletor: 'section.s-dog', titulo: '#dog-tit', texto: '1, 2 ou 3 salsichas' },
  { id: 'S5', seletor: 'section.s-combos', titulo: '#comb-tit', texto: 'Vira combo' },
  { id: 'S6', seletor: 'section.s-noite', titulo: '#noite-tit', texto: 'Horário' },
  { id: 'S7', seletor: 'section.s-galeria', titulo: '#gal-tit', texto: 'Direto da chapa' },
  { id: 'S8', seletor: 'section.s-onde', titulo: '#onde-tit', texto: 'Centro de Suzano' },
  { id: 'S9', seletor: 'section.s-final', titulo: '#fim-tit', texto: CONFIG.frases.fome }
];
// os três títulos do herói (o CSS mostra o do estado da luz)
const HERO = { aberto: HERO_ABERTO, fechado: `A chapa acende às ${ABRE}.`, pausa: 'Pausa na chapa.' };

test.describe('seções S0 a S9', () => {
  test('o index.html tem os dez blocos, na ordem do roteiro, e cada título está no HTML pronto (antes de qualquer JS)', () => {
    const ordem = SECOES.map((s) => html.indexOf(`<!-- [${s.id}] inicio`));
    expect(ordem.every((i) => i > 0), 'marcadores [Sx] no index.html').toBe(true);
    expect(ordem, 'ordem dos blocos').toEqual([...ordem].sort((a, b) => a - b));
    for (const s of SECOES.filter((x) => x.texto)) {
      const texto = semTags(bloco(s.id));
      expect(texto, `título de ${s.id} no HTML`).toContain(s.texto);
      expect(bloco(s.id), `${s.id}: id do título`).toContain(`id="${s.titulo.match(/^#([\w-]+)/)[1]}"`);
    }
    const hero = semTags(bloco('S0'));
    for (const t of Object.values(HERO)) expect(hero, 'título do herói no HTML').toContain(t);
    expect(bloco('S1')).toContain('data-fita="a"');
    expect(bloco('S1')).toContain('data-fita="b"');
  });

  test('cada seção existe, na ordem, com o título esperado, visível e aceso', async ({ page }) => {
    // 20h de segunda (beforeEach): a loja está aberta, então o herói diz o título de aberto
    await abrirSite(page);
    const filhos = await page.evaluate(() => [...document.querySelectorAll('#view-site > section, #view-site > .fitas')].map((e) => (e.className.match(/s-[a-z]+|fitas/) || [''])[0]));
    expect(filhos, 'seções do #view-site, na ordem').toEqual(['s-hero', 'fitas', 's-placa', 's-monte', 's-prensa', 's-dog', 's-combos', 's-noite', 's-galeria', 's-onde', 's-final']);
    for (const s of SECOES) {
      const secao = page.locator(s.seletor);
      await expect.soft(secao, `${s.id} existe`).toHaveCount(1);
      await irA(page, s.seletor);
      await expect.soft(secao, `${s.id} visível`).toBeVisible();
      const box = await secao.boundingBox();
      expect.soft(box.width, `${s.id}: largura`).toBeGreaterThan(200);
      expect.soft(box.height, `${s.id}: altura`).toBeGreaterThan(60);
      if (s.id === 'S1') {
        // as faixas do letreiro não têm título: são duas, a e b
        await expect.soft(page.locator('.fitas [data-fita]'), 'S1: duas faixas').toHaveCount(2);
        continue;
      }
      const titulo = page.locator(s.titulo);
      await expect.soft(titulo, `${s.id}: título`).toBeVisible();
      await expect.soft(titulo, `${s.id}: texto do título`).toHaveText(s.texto);
      // o rótulo da seção é o título (aria-labelledby)
      await expect.soft(page.getByRole('region', { name: s.texto, exact: true }), `${s.id}: região com o nome do título`).toHaveCount(1);
      // a revelação (.rv) acende o título: opacidade inteira em 1 s
      await expect
        .poll(() => opacidadeEfetiva(page, s.titulo), { message: `${s.id}: título aceso`, timeout: 4000 })
        .toBeGreaterThan(0.99);
    }
  });
});

// ---------- 3. a luz segue a loja ----------
test.describe('luz da loja e título do herói', () => {
  const CASOS = [
    // modo no banco, hora (Brasília), luz, motivo, título do herói, status, neon do final
    ['fechada', '20:00', 'apagada', 'pausa', 'pausa', /^Fechado agora · a loja pausou os pedidos$/, 'Pausa na chapa.'],
    ['fechada', '14:00', 'apagada', 'pausa', 'pausa', /^Fechado agora · a loja pausou os pedidos$/, 'Pausa na chapa.'],
    ['aberta', '14:00', 'acesa', 'turno', 'aberto', /^Aberto agora \(horário estendido\)$/, 'O Mineiro tá aceso'],
    ['auto', '20:00', 'acesa', 'turno', 'aberto', /^Aberto agora · até meia-noite$/, 'O Mineiro tá aceso'],
    ['auto', '14:00', 'apagada', 'antes', 'fechado', new RegExp(`^Fechado agora · abre hoje às ${ABRE}$`), `Volta às ${ABRE}. A chapa espera.`]
  ];
  for (const [modo, hora, luz, motivo, estado, status, neon] of CASOS) {
    test(`modo "${modo}" às ${hora}: parede ${luz === 'acesa' ? 'acesa' : 'apagada'} e herói "${HERO[estado]}"`, async ({ page }) => {
      await page.clock.setFixedTime(SEGUNDA(hora));
      await mudarEstado(page, (j) => {
        j.loja.modo = modo;
      });
      const estadoChegou = page.waitForResponse((r) => r.url().includes('/rpc/estado_cardapio'));
      await page.goto('/#site');
      await expect(page.locator('#view-site')).toBeVisible();
      await estadoChegou;
      const raiz = page.locator('html');
      await expect(raiz).toHaveAttribute('data-luz', luz);
      await expect(raiz).toHaveAttribute('data-luz-motivo', motivo);
      // só um título à vista (os três ficam empilhados na mesma célula): o do estado
      const visivel = page.locator('.hero-tit__e:visible');
      await expect(visivel).toHaveCount(1);
      await expect(visivel).toHaveAttribute('data-estado', estado);
      await expect(visivel).toHaveText(HERO[estado]);
      await expect(page.locator('#s-tit')).toHaveAttribute('aria-label', HERO[estado]);
      await expect(page.locator('.s-hero [data-status]')).toHaveText(status);
      await expect(page.locator('[data-fim-status]')).toHaveText(neon);
      // o ponto de status da barra tem a cor da luz (verde aceso, vermelho apagado)
      const cores = await page.evaluate((token) => {
        const sonda = document.createElement('i');
        sonda.style.background = 'var(' + token + ')';
        document.body.append(sonda);
        const esperada = getComputedStyle(sonda).backgroundColor;
        sonda.remove();
        return { esperada, ponto: getComputedStyle(document.querySelector('.barra-site__ponto')).backgroundColor };
      }, luz === 'acesa' ? '--neon-aberto' : '--vermelho-luz');
      expect(cores.ponto, 'ponto de status da barra').toBe(cores.esperada);
    });
  }
});

// ---------- 3b. o herói diz o dia quando a próxima abertura não é hoje (horário: quarta fechada) ----------
test.describe('título do herói nos dias sem turno', () => {
  // 14/10/2026 é quarta; hh:mm(:ss) no horário de Brasília
  const EM = (dia, hhmm) => new Date(`2026-10-${dia}T${hhmm}${hhmm.length === 5 ? ':00' : ''}-03:00`);
  // as letras do título "fechado": o texto e o --i de cada uma (a animação acende na ordem de leitura, sem buraco nem repetição)
  const letras = (page) =>
    page.evaluate(() => [...document.querySelectorAll('.s-hero .hero-tit__e[data-estado="fechado"] .letra')].map((l) => [l.textContent, l.style.getPropertyValue('--i')]));
  async function conferir(page, titulo) {
    const visivel = page.locator('.hero-tit__e:visible');
    await expect(visivel).toHaveCount(1);
    await expect(visivel).toHaveAttribute('data-estado', 'fechado');
    await expect(visivel).toHaveText(titulo);
    await expect(page.locator('#s-tit')).toHaveAttribute('aria-label', titulo);
    const ls = await letras(page);
    expect(ls.map((l) => l[0]).join(''), 'uma .letra por caractere do título').toBe(titulo.replace(/\s+/g, ''));
    expect(ls.map((l) => +l[1]), '--i das letras em sequência').toEqual(ls.map((_, i) => i));
  }
  async function abrir(page, quando) {
    await page.clock.setFixedTime(quando);
    const estadoChegou = page.waitForResponse((r) => r.url().includes('/rpc/estado_cardapio'));
    await page.goto('/#site');
    await expect(page.locator('#view-site')).toBeVisible();
    await estadoChegou;
  }
  const CASOS = [
    // quando, rótulo, título
    [EM(14, '20:00'), 'quarta 20:00', `A chapa acende amanhã às ${ABRE}.`],
    [EM(14, '12:00'), 'quarta 12:00', `A chapa acende amanhã às ${ABRE}.`],
    [EM(13, '00:30'), 'terça 00:30 (a abertura é hoje)', `A chapa acende às ${ABRE}.`],
    [EM(15, '14:00'), 'quinta 14:00 (a abertura é hoje)', `A chapa acende às ${ABRE}.`]
  ];
  for (const [quando, rotulo, titulo] of CASOS) {
    test(`${rotulo}: "${titulo}"`, async ({ page }) => {
      await abrir(page, quando);
      await conferir(page, titulo);
      // o título mais longo não empurra os botões do herói para baixo da dobra
      const caixa = await page.locator('.s-hero').getByRole('button', { name: 'Fazer pedido' }).boundingBox();
      expect(caixa.y + caixa.height, 'Fazer pedido acima da dobra').toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    });
  }

  test('dois dias seguidos sem turno (o banco manda): o título diz o nome do dia', async ({ page }) => {
    await mudarEstado(page, (j) => {
      j.loja.horarios['4'] = null; // quinta também fechada: a quarta espera até a sexta
    });
    await abrir(page, EM(14, '20:00'));
    await conferir(page, `A chapa acende sexta às ${ABRE}.`);
  });

  test('a virada da meia-noite de quarta para quinta refaz o título com as letras já embrulhadas', async ({ page }) => {
    // 23:59:59,5: o relógio de minuto do herói dispara a cada ~0,5 s enquanto a hora fica parada aí
    await abrir(page, EM(14, '23:59:59.500'));
    await conferir(page, `A chapa acende amanhã às ${ABRE}.`);
    await page.clock.setFixedTime(EM(15, '00:00:01'));
    await expect(page.locator('.s-hero [data-abre-dia]')).toHaveText('');
    await conferir(page, `A chapa acende às ${ABRE}.`);
  });
});

// ---------- 4. movimento reduzido ----------
// animação "viva": a que ainda não acabou e dura mais que um instante. O base.css zera as durações para 0,01 ms e uma volta (o fim é
// imediato: a foto que carrega, por exemplo, acende numa transição dessas); laço infinito ou ligado à rolagem sempre conta.
const vivas = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        if (a.playState === 'finished' || a.playState === 'idle') return false;
        const t = a.effect.getTiming();
        return t.iterations === Infinity || typeof t.duration !== 'number' || t.duration > 1 || !(a.timeline instanceof window.DocumentTimeline);
      })
      .map((a) => {
        const alvo = a.effect.target;
        return (a.animationName || a.transitionProperty || 'WAAPI') + ' em ' + (alvo ? alvo.tagName.toLowerCase() + (alvo.className && typeof alvo.className === 'string' ? '.' + alvo.className.trim().split(/\s+/)[0] : '') : '?');
      })
  );

// o que está na tela e deveria estar à vista mas está apagado: texto e fotos com opacidade efetiva < .99. O que fica invisível de propósito
// (visibility:hidden: os títulos do herói que não são do estado, as composições do S2 que não são do lanche escolhido) não conta.
const apagados = (page) =>
  page.evaluate(() => {
    const raiz = document.getElementById('view-site');
    const alvos = new Set();
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim()) alvos.add(n.parentElement);
    raiz.querySelectorAll('img').forEach((i) => alvos.add(i));
    const ruins = [];
    for (const e of alvos) {
      if (!e.getClientRects().length || e.closest('[hidden], dialog:not([open])')) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      let op = 1;
      let escondido = false;
      for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        op *= parseFloat(cs.opacity);
        if (cs.visibility === 'hidden') escondido = true;
      }
      if (!escondido && op < 0.99) ruins.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + (typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '') + ' (' + op.toFixed(2) + ')');
    }
    return ruins;
  });

test.describe('movimento reduzido', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('nenhuma animação viva em nenhuma seção, de cima a baixo', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirSite(page);
    await percorrer(page, async (y) => {
      await expect.poll(() => vivas(page), { message: `animações vivas em y=${y}` }).toEqual([]);
    });
  });

  test('todo o conteúdo das cenas aparece completo e estático, sem revelação nem trava', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirSite(page);
    // nada fica à espera de rolagem: os .rv não ganham .fora e as letras do herói não animam
    await expect(page.locator('.rv.fora')).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.hero-tit .letra')).animationName)).toBe('none');
    await percorrer(page, async (y) => {
      await expect.poll(() => apagados(page), { message: `texto ou foto apagado em y=${y}` }).toEqual([]);
    });
    // S2: a seção não prende a tela; a foto está inteira, a composição toda acesa e o "Pedir este" aceita toque
    await irA(page, 'section.s-monte');
    const monte = await page.evaluate(() => {
      const sec = document.querySelector('.s-monte');
      const li = [...sec.querySelectorAll('.s2-comp[data-ativo] li')];
      return {
        altura: sec.offsetHeight / innerHeight,
        palco: getComputedStyle(sec.querySelector('.s2-palco')).position,
        // clip-path: inset(topo direita base [esquerda] round raio); revelada por inteiro = todos os recuos em 0
        recuos: (getComputedStyle(sec.querySelector('.s2-foto')).clipPath.match(/^inset\(([^)]*?)(?: round [^)]*)?\)$/) || [null, 'sem inset'])[1].split(' ').map(parseFloat),
        linhas: li.length,
        apagadas: li.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.99).length,
        botao: getComputedStyle(sec.querySelector('[data-monte-pedir]')).pointerEvents,
        opacidadeBotao: getComputedStyle(sec.querySelector('[data-monte-pedir]')).opacity
      };
    });
    expect(monte.altura, 'S2 não é mais alta que a tela (nada de trava)').toBeLessThan(1.5);
    expect(monte.palco).not.toBe('sticky');
    expect(monte.recuos.every((v) => v === 0), `foto revelada por inteiro (recuos do clip-path: ${monte.recuos})`).toBe(true);
    expect(monte.linhas).toBeGreaterThan(3);
    expect(monte.apagadas).toBe(0);
    expect(monte.botao).not.toBe('none');
    expect(+monte.opacidadeBotao).toBe(1);
    // S7: a parede de fotos já tem as fotos novas, visíveis
    await irA(page, 'section.s-galeria');
    await expect(page.locator('.mosaico button.quadro').first()).toBeVisible();
    expect(await page.locator('.mosaico button.quadro').count()).toBeGreaterThan(3);
  });
});

// ---------- 5. só transform, opacity e clip-path ----------
// Um amostrador no quadro de animação (rAF) anota, desde o carregamento, toda animação que existir em document.getAnimations()
// (CSS, transição ou WAAPI, parada ou rodando) e as propriedades de cada keyframe. Pega até a de 240 ms do preço rolando.
// Fora da regra, e anotadas como aviso: as transições de COR de um controle (hover, pressionado, escolhido) que o app.css dá a .btn, .chip
// e .opt (feedback de estado do componente, compartilhado com o cardápio; não é animação de cena).
const AMOSTRADOR = () => {
  const PERMITIDAS = ['transform', 'opacity', 'clipPath'];
  const META = ['offset', 'computedOffset', 'easing', 'composite'];
  const COR = ['color', 'backgroundColor', 'borderColor', 'boxShadow', 'outlineColor'];
  window.__anim = { vistas: {}, fora: [], estado: [] };
  const vistos = new WeakSet();
  const alvoDe = (a) => {
    const e = a.effect && a.effect.target;
    if (!e) return '?';
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '') + ((a.effect.pseudoElement || '') && ' ' + a.effect.pseudoElement);
  };
  const quadro = () => {
    for (const a of document.getAnimations()) {
      if (vistos.has(a)) continue;
      vistos.add(a);
      const nome = a.animationName || (a.transitionProperty ? 'transição de ' + a.transitionProperty : 'WAAPI');
      const props = new Set();
      for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!META.includes(p)) props.add(p);
      window.__anim.vistas[nome] = [...props].sort();
      for (const p of props) {
        if (PERMITIDAS.includes(p)) continue;
        const controle = a instanceof window.CSSTransition && COR.includes(p) && a.effect.target && a.effect.target.closest && a.effect.target.closest('a, button, input, label, [role="radio"]');
        window.__anim[controle ? 'estado' : 'fora'].push(nome + ' anima "' + p + '" em ' + alvoDe(a));
      }
    }
    window.requestAnimationFrame(quadro);
  };
  window.requestAnimationFrame(quadro);
};
const lerAmostras = (page) => page.evaluate(() => ({ vistas: window.__anim.vistas, fora: [...new Set(window.__anim.fora)], estado: [...new Set(window.__anim.estado)] }));

test.describe('animação só com transform, opacity e clip-path', () => {
  test('toda animação do site, passando por todas as seções e mexendo nas cenas', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(AMOSTRADOR);
    await abrirSite(page);
    // toque na placa do herói (piscar, brilho e fumaça)
    await page.locator('.s-hero [data-placa]').click();
    await page.waitForTimeout(700);
    await percorrer(page);
    // S2: troca de lanche
    await irA(page, 'section.s-monte');
    await page.locator('[data-monte="gran-salada"]').click();
    await page.waitForTimeout(300);
    // S3: prensa descendo e subindo
    await page.locator('#prensa-palco').scrollIntoViewIfNeeded();
    await page.locator('#f-prensa').fill('100');
    await page.waitForTimeout(600);
    await page.locator('#f-prensa').fill('0');
    // S4: 3 salsichas (dígitos rolando) e "Adicionar" (a foto voa para a sacola)
    await page.locator('#dog-bandeja').scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await page.locator('[data-dog="dog-super"]').click();
    await page.waitForTimeout(500);
    await page.locator('#dog-add').click();
    await page.waitForTimeout(700);
    // S5: outro chip
    await page.locator('#combo-escolher').scrollIntoViewIfNeeded();
    await page.locator('#combo-chips .chip').nth(2).click();
    // S6: a régua do horário
    await page.locator('#noite-regua').scrollIntoViewIfNeeded();
    await page.locator('#noite-regua').fill('300');
    await page.waitForTimeout(400);
    // S7: foto ampliada (abre e fecha)
    await page.locator('.mosaico button.quadro').first().scrollIntoViewIfNeeded();
    await page.locator('.mosaico button.quadro').first().click();
    await expect(page.locator('#luz-caixa')).toBeVisible();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const { vistas, fora, estado } = await lerAmostras(page);
    for (const e of estado) test.info().annotations.push({ type: 'aviso', description: 'transição de cor de controle (fora da regra): ' + e });
    // o amostrador viu o que o site tem de movimento (senão o teste não prova nada)
    for (const nome of ['fita-corre', 'hero-brasa', 'hero-acende', 'halo-respira', 'gal-par', 'zumbido', 'WAAPI']) expect(Object.keys(vistas), 'animações vistas').toContain(nome);
    expect(fora, 'animações que usam outra propriedade').toEqual([]);
  });

  // A foto do card vira o topo da ficha (src/app.js, voarParaFicha, a mesma do cardápio): só transform e clip-path nos keyframes.
  test('a foto que voa do site para a ficha só anima transform, opacity e clip-path', async ({ page }) => {
    await page.addInitScript(AMOSTRADOR);
    await abrirSite(page);
    await irA(page, 'section.s-monte');
    await page.locator('[data-monte-quadro]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.ML.app.abrirFicha('gran-bacon-onion', { origem: document.querySelector('[data-monte-quadro]') }));
    await expect(page.locator('#ficha')).toBeVisible();
    await page.waitForTimeout(400);
    expect((await lerAmostras(page)).fora).toEqual([]);
  });
});

// ---------- 6. sem rolagem horizontal ----------
for (const largura of [390, 1280]) {
  test(`${largura} px: o site inteiro cabe na largura (sem rolagem horizontal)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: largura, height: largura < 800 ? 844 : 800 });
    await abrirSite(page);
    expect(await page.evaluate(() => innerWidth), 'largura da janela').toBe(largura);
    const medir = () =>
      page.evaluate(() => {
        const raiz = document.documentElement;
        const y = scrollY;
        scrollTo(160, y); // tenta empurrar para o lado
        const x = scrollX;
        scrollTo(0, y);
        const r = { largura: raiz.clientWidth, doc: raiz.scrollWidth, corpo: document.body.scrollWidth, x, largos: [] };
        if (r.doc > r.largura || r.corpo > r.largura || x > 0) {
          // quem passa da borda direita sem um pai que corte (overflow) no caminho
          for (const e of document.querySelectorAll('body *')) {
            const rc = e.getBoundingClientRect();
            if (rc.right <= r.largura + 0.5 || !rc.width) continue;
            let corta = false;
            for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
              const o = getComputedStyle(p);
              if (o.overflowX !== 'visible' && p !== document.body) corta = true;
            }
            if (!corta) r.largos.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + (typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '') + ' até ' + Math.round(rc.right));
          }
          r.largos = r.largos.slice(0, 8);
        }
        return r;
      });
    await percorrer(page, async (y) => {
      const m = await medir();
      expect(m, `rolagem horizontal em y=${y}`).toMatchObject({ doc: m.largura, corpo: m.largura, x: 0, largos: [] });
    });
  });
}

// ---------- 7. alvos de toque ----------
// todo controle à vista (link, botão, campo, opção) mede ao menos 44 px nos dois lados (tamanho de layout: a entrada da gaveta escala)
// Devolve os que ficaram abaixo e, para provar que a varredura achou controles, todos os que mediu.
const alvos = (page) =>
  page.evaluate(() => {
    const achados = [];
    const medidos = [];
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="switch"], [tabindex]:not([tabindex="-1"])';
    const raizes = ['#view-site', '#toast', '#fab', '#ficha[open]', '#luz-caixa[open]'];
    const tudo = raizes.flatMap((r) => [...document.querySelectorAll(r)].flatMap((el) => (el.matches(sel) ? [el] : []).concat([...el.querySelectorAll(sel)])));
    for (const e of new Set(tudo)) {
      if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || e.closest('[hidden], [inert], dialog:not([open])')) continue;
      const rc = e.getBoundingClientRect();
      if (rc.bottom < 0 || rc.top > innerHeight) continue;
      const w = e.offsetWidth || rc.width;
      const h = e.offsetHeight || rc.height;
      const nome = (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '')) + ' "' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24) + '"';
      medidos.push(nome);
      if (w < 44 || h < 44) achados.push(nome + ' ' + Math.round(w * 10) / 10 + 'x' + Math.round(h * 10) / 10);
    }
    return { achados, medidos };
  });

test.describe('alvos clicáveis', () => {
  test('todo controle à vista mede 44 px ou mais, em cada seção', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirSite(page);
    const vistos = new Set();
    const medidos = new Set();
    await percorrer(page, async () => {
      const r = await alvos(page);
      r.achados.forEach((p) => vistos.add(p));
      r.medidos.forEach((p) => medidos.add(p));
    });
    expect([...vistos], 'alvos menores que 44 px').toEqual([]);
    // a varredura passou pelos controles de verdade: barra, CTAs, segmentados, chips, cartas, mapa, rodapé
    expect(medidos.size, 'controles medidos').toBeGreaterThan(30);
    for (const nome of ['Fazer pedido', 'Pedir este', 'Adicionar', 'Personalizar', 'Escolher e virar combo', 'Abrir no mapa', 'Link da bio']) expect([...medidos].join('\n'), 'controle medido').toContain(nome);
  });

  test('o que aparece depois do toque também: toast, botão flutuante, "Voltar para agora" e a foto ampliada', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirSite(page);
    const vistos = new Set();
    const medidos = new Set();
    const medir = async () => {
      const r = await alvos(page);
      r.achados.forEach((p) => vistos.add(p));
      r.medidos.forEach((p) => medidos.add(p));
    };
    // "Adicionar" põe o item na sacola: toast com "Personalizar" e botão flutuante (no celular)
    await page.locator('#dog-add').scrollIntoViewIfNeeded();
    await page.locator('#dog-add').click();
    await expect(page.locator('#toast-acao')).toBeVisible();
    await expect(page.locator('#toast-acao')).toHaveText('Personalizar');
    await page.waitForTimeout(500);
    await medir();
    // a régua do horário liga o "Voltar para agora"
    await page.locator('#noite-regua').scrollIntoViewIfNeeded();
    await page.locator('#noite-regua').fill('300');
    await expect(page.locator('.noite__volta')).toBeVisible();
    await medir();
    // foto ampliada
    await page.locator('.mosaico button.quadro').first().scrollIntoViewIfNeeded();
    await page.locator('.mosaico button.quadro').first().click();
    await expect(page.locator('#luz-caixa')).toBeVisible();
    await page.waitForTimeout(500);
    await medir();
    expect([...vistos], 'alvos menores que 44 px').toEqual([]);
    for (const nome of ['#toast-acao "Personalizar"', 'Voltar para agora', '#luz-pedir "Pedir"', 'Fechar']) expect([...medidos].join('\n'), 'controle medido').toContain(nome);
  });
});

// ---------- 8. a gaveta #ficha aberta pelo site ----------
// A ficha é um <dialog> fora de #view-app (e de #view-site): dentro de um ancestral escondido ele abriria com tamanho zero.
async function conferirGaveta(page, nome) {
  const ficha = page.locator('#ficha');
  await expect(ficha).toBeVisible();
  await expect(ficha).toHaveAttribute('open', '');
  await expect(page.locator('#ficha-nome')).toHaveText(nome);
  const vp = page.viewportSize();
  // depois da entrada (a gaveta sobe), ela está dentro da janela e tem tamanho de gaveta
  await expect
    .poll(
      async () => {
        const b = await ficha.boundingBox();
        return !!b && b.width > 250 && b.height > 300 && b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
      },
      { message: 'a gaveta cabe na janela, com tamanho' }
    )
    .toBe(true);
  expect(await page.evaluate(() => !!document.querySelector('#view-app #ficha, #view-site #ficha')), '#ficha fora de #view-app e #view-site').toBe(false);
  // o conteúdo veio: o botão de adicionar com o total
  await expect(page.locator('#ficha-add')).toBeVisible();
  await expect(page.locator('#ficha-total')).toHaveText(/^R\$ \d+,\d{2}$/);
  const add = await page.locator('#ficha-add').boundingBox();
  expect(add.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.querySelector('#ficha-corpo').offsetHeight)).toBeGreaterThan(100);
}

test.describe('gaveta #ficha aberta pelo site', () => {
  test('S2 · "Pedir este" abre a ficha do lanche escolhido', async ({ page }) => {
    await abrirSite(page);
    await irA(page, 'section.s-monte');
    await page.locator('[data-monte="gran-salada"]').click();
    // o botão só aceita toque quando a cena chega ao fim (data-pronto): rola até o fim da seção
    await page.evaluate(() => {
      const s = document.querySelector('.s-monte');
      scrollTo(0, s.getBoundingClientRect().top + scrollY + s.offsetHeight - innerHeight);
    });
    await expect(page.locator('.s-monte')).toHaveAttribute('data-pronto', '');
    await page.getByRole('button', { name: /Pedir este/ }).click();
    await conferirGaveta(page, 'Gran Salada');
  });

  test('S4 · "Adicionar" põe na sacola e o toast "Personalizar" abre a ficha do que entrou', async ({ page }) => {
    await abrirSite(page);
    await page.locator('#dog-bandeja').scrollIntoViewIfNeeded();
    await page.locator('#dog-add').click();
    await expect(page.locator('#toast-txt')).toHaveText('Hot Dog Max na sacola');
    await page.locator('#toast-acao').click();
    await conferirGaveta(page, 'Hot Dog Max');
  });

  test('S4 · "Personalizar" abre a ficha do tamanho escolhido', async ({ page }) => {
    await abrirSite(page);
    await page.locator('#dog-bandeja').scrollIntoViewIfNeeded();
    await page.locator('[data-dog="dog-super"]').click();
    await page.locator('#dog-pers').click();
    await conferirGaveta(page, 'Hot Dog Super');
  });

  test('S5 · "Escolher e virar combo" abre a ficha do chip escolhido, com o combo ligado', async ({ page }) => {
    await abrirSite(page);
    await page.locator('#combo-escolher').scrollIntoViewIfNeeded();
    await page.locator('#combo-chips .chip', { hasText: 'X-Churrasco' }).click();
    await page.getByRole('button', { name: 'Escolher e virar combo' }).click();
    await conferirGaveta(page, 'X-Churrasco');
    await expect(page.locator('#ficha [data-combo]')).toHaveAttribute('aria-checked', 'true');
  });

  test('a gaveta fecha e o site continua de pé', async ({ page }) => {
    await abrirSite(page);
    await page.locator('#dog-bandeja').scrollIntoViewIfNeeded();
    await page.locator('#dog-pers').click();
    await conferirGaveta(page, 'Hot Dog Max');
    await page.locator('#ficha [data-fechar-ficha]').click();
    await expect(page.locator('#ficha')).toBeHidden();
    await expect(page.locator('#view-site')).toBeVisible();
  });
});

// ---------- 9. placa do cardápio (S1b) ----------
test.describe('placa do cardápio', () => {
  test('"Combos" abre o cardápio com #cat-combos visível no topo da tela', async ({ page }) => {
    await abrirSite(page);
    const combos = page.locator('.s-placa a[href="#cardapio/combos"]');
    await combos.scrollIntoViewIfNeeded();
    await combos.click();
    await expect(page.locator('[data-screen="menu"]')).toBeVisible();
    await expect(page.locator('#view-site')).toBeHidden();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#cardapio/);
    const cat = page.locator('#cat-combos');
    await expect(cat).toBeVisible();
    // a rolagem até a categoria é suave: espera pousar abaixo do cabeçalho preso, no alto da tela
    const topo = () => page.evaluate(() => Math.round(document.querySelector('#cat-combos').getBoundingClientRect().top));
    await expect.poll(topo, { timeout: 8000, message: 'topo de #cat-combos' }).toBeLessThan(260);
    expect(await topo()).toBeGreaterThan(-20);
    await expect(cat).toBeInViewport();
    // o título da categoria não fica escondido por baixo do cabeçalho nem dos chips presos
    const aDescoberto = await page.evaluate(() => {
      const h2 = document.querySelector('#cat-combos h2');
      const r = h2.getBoundingClientRect();
      const noPonto = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2);
      return !!noPonto && document.querySelector('#cat-combos').contains(noPonto);
    });
    expect(aDescoberto, 'o título de Combos está à mostra').toBe(true);
    await expect(cat.locator('h2')).toHaveText(/Combos/i);
  });
});
