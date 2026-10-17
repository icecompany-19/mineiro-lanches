// Navegação de produção (sem as abas da prévia): bio é a tela inicial; da bio se chega ao cardápio e ao site,
// do site se volta ao cardápio e à bio. Links diretos, voltar do navegador, console limpo, nada de domínio externo
// (fora o próprio Supabase), nenhum texto de prévia e o painel em /painel/, com login da equipe.
// Uso: npx playwright test tests/navegacao.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global document, location, innerHeight, scrollTo, window, requestAnimationFrame, getComputedStyle, localStorage */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREVIA = /pr[ée]via|gasplab/i;
// o build dos testes (--mode development) fala com o Supabase local do .env.development
const SUPABASE = new URL(
  readFileSync(resolve(import.meta.dirname, '../.env.development'), 'utf8')
    .match(/^VITE_SUPABASE_URL=(.+)$/m)[1]
    .trim()
).origin;

// erros de console/página e requisições fora do próprio site, desde o primeiro goto.
// O Supabase local não tem Realtime: o WebSocket do supabase-js falha e tenta de novo (em produção ele conecta);
// esse erro do ambiente de teste fica de fora. As chamadas ao Supabase são do próprio sistema, não contam como externas.
function vigiar(page, baseURL) {
  const erros = [];
  const externas = [];
  const origem = new URL(baseURL).origin;
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket connection to '[^']*\/realtime\/v1\//.test(m.text())) erros.push(m.text());
  });
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (
      !u.startsWith(origem) &&
      !u.startsWith(SUPABASE) &&
      !u.startsWith(SUPABASE.replace(/^http/, 'ws')) &&
      !/^(data|blob|about):/.test(u)
    )
      externas.push(u);
  });
  return { erros, externas };
}

const tela = {
  bio: (page) => page.locator('[data-screen="bio"]'),
  cardapio: (page) => page.locator('[data-screen="menu"]'),
  site: (page) => page.locator('#view-site')
};

async function so(page, qual) {
  for (const [nome, loc] of Object.entries(tela)) {
    if (nome === qual) await expect(loc(page), `${qual} visível`).toBeVisible();
    else await expect(loc(page), `${nome} escondida quando ${qual} está na tela`).toBeHidden();
  }
}

async function hash(page) {
  return page.evaluate(() => location.hash);
}

test('as três telas são alcançáveis pelos links, sem as abas da prévia', async ({ page, baseURL }) => {
  const v = vigiar(page, baseURL);
  await page.goto('/');
  await so(page, 'bio');
  await expect(page.locator('.pv-bar, .pv-tabs, #intro, #view-painel, .dica')).toHaveCount(0);

  // bio → cardápio pelo CTA "Fazer pedido"
  await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
  await so(page, 'cardapio');
  expect(await hash(page)).toBe('#cardapio');

  // cardápio → bio pelo voltar do cabeçalho
  await page.getByRole('button', { name: 'Voltar para o link da bio' }).click();
  await so(page, 'bio');

  // bio → site pelo link discreto
  await page.getByRole('link', { name: /Conheça o truck/ }).click();
  await so(page, 'site');
  expect(await hash(page)).toBe('#site');

  // site → bio
  const bio = page
    .locator('#view-site')
    .getByRole('link', { name: /Link da bio/ })
    .first();
  await bio.scrollIntoViewIfNeeded();
  await bio.click();
  await so(page, 'bio');
  expect(await hash(page)).toBe('#bio');

  // de novo para o site e dele ao cardápio
  await page.getByRole('link', { name: /Conheça o truck/ }).click();
  await so(page, 'site');
  await page.locator('.s-hero').getByRole('button', { name: 'Fazer pedido' }).click();
  await so(page, 'cardapio');

  expect(v.erros, 'erros no console').toEqual([]);
  expect(v.externas, 'requisições a outros domínios').toEqual([]);
});

test('voltar e avançar do navegador seguem o caminho feito', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
  await so(page, 'cardapio');
  await page.goBack();
  await so(page, 'bio');
  await page.getByRole('link', { name: /Conheça o truck/ }).click();
  await so(page, 'site');
  await page.locator('.s-hero').getByRole('button', { name: 'Fazer pedido' }).click();
  await so(page, 'cardapio');
  await page.goBack();
  await so(page, 'site');
  await page.goBack();
  await so(page, 'bio');
  await page.goForward();
  await so(page, 'site');
  // o voltar do cabeçalho do cardápio volta no histórico quando a bio é a tela anterior
  await page.goto('about:blank');
  await page.goto('/');
  await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
  await page.getByRole('button', { name: 'Voltar para o link da bio' }).click();
  await so(page, 'bio');
  await page.goForward();
  await so(page, 'cardapio');
});

test('links diretos #bio, #cardapio e #site, e #painel leva a /painel/', async ({ page, baseURL }) => {
  const v = vigiar(page, baseURL);
  for (const [h, qual] of [
    ['#bio', 'bio'],
    ['#cardapio', 'cardapio'],
    ['#site', 'site'],
    ['', 'bio']
  ]) {
    await page.goto('about:blank'); // carga nova, não só troca de hash
    await page.goto('/' + h);
    await so(page, qual);
  }
  // quem chega pelo QR cai direto no cardápio
  await page.goto('/?origem=qrcode');
  await so(page, 'cardapio');
  await page.goto('/#painel');
  await expect(page).toHaveURL(/\/painel\/$/);
  // sem login, o painel mostra só o login da equipe
  await expect(page.locator('.pn-acesso').getByLabel('E-mail')).toBeVisible();
  expect(v.erros, 'erros no console').toEqual([]);
  expect(v.externas, 'requisições a outros domínios').toEqual([]);
});

// Herói do site (docs/DIRECAO-VISUAL.md 6.2, S0): a placa é a logo oficial, os 3 títulos ocupam a mesma célula e só o do
// estado da luz aparece; o nome da marca fica na logo (nada de "MINEIRO" em h1) e os dois botões ficam acima da dobra.
test('herói do site: placa, um título por estado da luz e botões acima da dobra', async ({ page }) => {
  await page.goto('/#site');
  const hero = page.locator('.s-hero');
  await expect(hero).toBeVisible();
  await expect(hero.locator('.placa .placa-arte')).toBeVisible();
  await expect(page.locator('.palco, .recorte, .s-letreiro')).toHaveCount(0);
  expect((await page.locator('#view-site h1').allTextContents()).join(' ')).not.toMatch(/mineiro/i);
  await expect(hero.locator('.hero-tit__e')).toHaveCount(3);
  // só o título do estado (o app escreve html[data-luz] e [data-luz-motivo]) fica visível e o h1 diz o mesmo ao leitor de
  // tela (aria-label). O estado da loja chega do servidor depois da primeira pintura: confere até os dois concordarem
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = document.documentElement.dataset;
        const estado = d.luz === 'acesa' ? 'aberto' : d.luzMotivo === 'pausa' ? 'pausa' : 'fechado';
        const titulos = [...document.querySelectorAll('.s-hero .hero-tit__e')];
        const visiveis = titulos.filter((e) => getComputedStyle(e).visibility === 'visible').map((e) => e.dataset.estado);
        const atual = titulos.find((e) => e.dataset.estado === estado);
        const rotulo = document.getElementById('s-tit').getAttribute('aria-label');
        return visiveis.length === 1 && visiveis[0] === estado && rotulo === atual.textContent.replace(/\s+/g, ' ').trim();
      })
    )
    .toBe(true);
  const altura = await page.evaluate(() => innerHeight);
  for (const b of [hero.getByRole('button', { name: 'Fazer pedido' }), hero.getByRole('link', { name: 'WhatsApp' })]) {
    const caixa = await b.boundingBox();
    expect(caixa.y + caixa.height, 'botão do herói acima da dobra').toBeLessThanOrEqual(altura);
    expect(caixa.height, 'alvo de toque').toBeGreaterThanOrEqual(44);
  }
});

test('herói do site: com a loja pausada o título é "Pausa na chapa." e o h1 acompanha', async ({ page }) => {
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await r.fetch();
    const j = await resposta.json();
    j.loja.modo = 'fechada';
    await r.fulfill({ response: resposta, json: j });
  });
  await page.goto('/#site');
  await expect(page.locator('.s-hero .hero-tit__e[data-estado="pausa"]')).toBeVisible();
  await expect(page.locator('.s-hero .hero-tit__e:visible')).toHaveCount(1);
  await expect(page.locator('#s-tit')).toHaveAttribute('aria-label', 'Pausa na chapa.');
});

test('herói do site: o cone da arandela segue o mouse em 1024+ e, com movimento reduzido, nada anima', async ({ page }) => {
  const largo = (page.viewportSize()?.width || 0) >= 1024;
  const mx = () => page.evaluate(() => getComputedStyle(document.querySelector('.s-hero')).getPropertyValue('--mx'));
  await page.goto('/#site');
  await expect(page.locator('.s-hero .hero-tit .letra').first()).toBeAttached(); // o chunk do site montou o herói
  if (largo) {
    const antes = await mx();
    await page.mouse.move(300, 300);
    await page.mouse.move(900, 400);
    expect(await mx(), '--mx depois do pointermove').not.toBe(antes);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('about:blank');
  await page.goto('/#site');
  await expect(page.locator('.s-hero .hero-tit .letra').first()).toBeAttached();
  const antes = await mx();
  if (largo) {
    await page.mouse.move(250, 350);
    await page.mouse.move(1000, 450);
    expect(await mx(), 'sem movimento reduzido o mouse não mexe o cone').toBe(antes);
  }
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.getAnimations().length), 'animações com movimento reduzido').toBe(0);
});

// Barra do site (docs/DIRECAO-VISUAL.md 6.1): 56 px e sempre visível, selo de 34 px sem srcset com o ponto de status, abas
// Bio · Cardápio · Site em 1024+ (em 390, só a pílula "Cardápio") e a sacola com contador; todo alvo tem 44 px ou mais.
test('barra do site: 56 px, sempre visível, alvos de 44 px e a sacola com contador', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'mineiro:v2:sacola',
      JSON.stringify([
        {
          chave: 'gran-burger|teste',
          sel: { produtoId: 'gran-burger', completo: true, removidos: [], prensado: false, combo: { ativo: false, refri: '' }, adicionais: {}, sabor: '', qtd: 1 }
        }
      ])
    )
  );
  await page.goto('about:blank');
  await page.goto('/#site');
  const barra = page.locator('.barra-site');
  await expect(barra).toBeVisible();
  const largo = (page.viewportSize()?.width || 0) >= 1024;

  // selo-128 de 34 px, sem srcset (o selo-128 cobre até 42 px CSS em DPR 3; tests/imagens.spec.js confere o resto)
  const selo = barra.locator('.barra-site__selo img');
  await expect(selo).not.toHaveAttribute('srcset', /.+/);
  await expect(selo).toHaveAttribute('src', '/assets/logo/selo-128.webp');
  expect((await selo.boundingBox()).width).toBe(34);
  // o ponto de status acompanha a luz do app (acesa: neon do aberto; apagada: vermelho de texto no escuro)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cor = getComputedStyle(document.querySelector('.barra-site__ponto')).backgroundColor;
        return document.documentElement.dataset.luz === 'acesa' ? cor === 'rgb(91, 227, 138)' : cor === 'rgb(255, 106, 92)';
      })
    )
    .toBe(true);

  // em 390 só a pílula "Cardápio"; em 1024+ as três abas, com "Site" na vez
  const bio = barra.getByRole('button', { name: 'Bio' });
  const cardapio = barra.getByRole('button', { name: 'Cardápio' });
  const site = barra.getByRole('link', { name: 'Site' });
  await expect(cardapio).toBeVisible();
  if (largo) {
    await expect(bio).toBeVisible();
    await expect(site).toBeVisible();
    await expect(site).toHaveAttribute('aria-current', 'page');
  } else {
    await expect(bio).toBeHidden();
    await expect(site).toBeHidden();
  }

  // a sacola traz o contador do app e todo alvo visível tem 44 px ou mais (medido no layout)
  await expect(barra.locator('[data-contador]')).toHaveText('1');
  const alvos = [barra.getByRole('link', { name: 'Mineiro Lanche, início' }), cardapio, barra.getByRole('button', { name: 'Ver a sacola' })];
  if (largo) alvos.push(bio, site);
  for (const a of alvos) {
    const r = await a.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { w: b.width, h: b.height };
    });
    expect(r.w, 'largura do alvo').toBeGreaterThanOrEqual(44);
    expect(r.h, 'altura do alvo').toBeGreaterThanOrEqual(44);
  }
  expect((await barra.boundingBox()).height).toBe(56);

  // sempre visível: depois de rolar o site inteiro a barra continua no topo
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  expect((await barra.boundingBox()).y, 'barra no topo da janela').toBe(0);

  // a pílula leva ao cardápio (pelo data-go="menu" do app)
  await cardapio.click();
  await so(page, 'cardapio');
});

// O app (módulo) roda depois da primeira pintura. Aqui ele chega atrasado de propósito (rede lenta) e um laço de
// requestAnimationFrame anota o que cada quadro mostra até ele rodar; também soma os layout shifts da carga.
async function quadrosAntesDoApp(page, url) {
  await page.addInitScript(() => {
    window.__quadros = [];
    window.__shift = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__shift += e.value))).observe({
      type: 'layout-shift',
      buffered: true
    });
    const ve = (s) => {
      const el = document.querySelector(s);
      return !!el && el.checkVisibility() && el.getBoundingClientRect().height > 0;
    };
    const olhar = () => {
      if (window.MLApp) return;
      if (document.body)
        window.__quadros.push({
          bio: ve('[data-screen="bio"]'),
          menu: ve('[data-screen="menu"]'),
          site: ve('#view-site'),
          pedido: ve('[data-screen="pedido"]')
        });
      requestAnimationFrame(olhar);
    };
    requestAnimationFrame(olhar);
  });
  await page.route(/\/_app\/[^?]*\.js(\?|$)/, async (r) => {
    await new Promise((ok) => setTimeout(ok, 700));
    await r.continue().catch(() => {}); // a página pode ter fechado nesse meio-tempo
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.MLApp);
  return page.evaluate(() => window.__quadros);
}

test('QR e links diretos: a tela pedida já é a primeira pintada, sem a bio piscar antes', async ({ browser }) => {
  for (const [url, tela] of [
    ['/?origem=qrcode', 'menu'],
    ['/?origem=qrcode&mesa=3', 'menu'],
    ['/#cardapio', 'menu'],
    ['/#site', 'site'],
    ['/#pedido/00000000-0000-4000-8000-00000000abcd', 'pedido']
  ]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const quadros = await quadrosAntesDoApp(page, url);
    expect(quadros.length, `${url}: quadros pintados antes do app`).toBeGreaterThan(0);
    expect(quadros.filter((q) => q.bio).length, `${url}: quadros com a bio antes do app`).toBe(0);
    expect(
      quadros.some((q) => q[tela]),
      `${url}: ${tela} na tela antes do app`
    ).toBe(true);
    // depois que o app roda, só a tela certa
    await expect(page.locator('[data-screen="bio"]')).toBeHidden();
    if (tela === 'site') await expect(page.locator('#view-site')).toBeVisible();
    else await expect(page.locator(`[data-screen="${tela}"]`)).toBeVisible();
    await ctx.close();
  }
});

test('bio: chips e stories entram sem empurrar o "Fazer pedido" (CLS < 0,1) e o selo começa neutro', async ({ page }) => {
  const quadros = await quadrosAntesDoApp(page, '/');
  expect(
    quadros.some((q) => q.bio),
    'a bio pintada antes do app'
  ).toBe(true);
  // antes do app o selo de horário não diz aberto nem fechado
  const html = await (await page.request.get('/')).text();
  expect(html).toMatch(/<p class="status" data-status role="status">/);
  await expect(page.locator('#chips-bio li')).toHaveCount(4);
  await page.waitForTimeout(800); // fontes e estado do cardápio
  const cls = await page.evaluate(() => window.__shift);
  expect(cls, 'layout shift da carga da bio').toBeLessThan(0.1);
  await expect(page.locator('.bio-id [data-status]')).toHaveClass(/\b(aberto|fechado)\b/);
});

test('nenhum texto de prévia, console limpo e nada de fora em todas as telas', async ({ page, baseURL }) => {
  const v = vigiar(page, baseURL);
  for (const h of ['#bio', '#cardapio', '#site']) {
    await page.goto('about:blank');
    await page.goto('/' + h);
    // rola tudo: carrega as fotos lazy e as revelações do site
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
    });
    const texto = await page.locator('body').innerText();
    expect(texto.match(PREVIA)?.[0], `texto de prévia em ${h}`).toBeUndefined();
  }
  await expect(page).toHaveTitle(/Mineiro Lanche/);
  expect(await page.title()).not.toMatch(PREVIA);
  const metas = await page.evaluate(() => [...document.querySelectorAll('meta')].map((m) => m.content || '').join(' '));
  expect(metas).not.toMatch(PREVIA);
  await page.waitForLoadState('networkidle');
  expect(v.erros, 'erros no console').toEqual([]);
  expect(v.externas, 'requisições a outros domínios (fontes inclusive)').toEqual([]);
});

test('/painel/ carrega o painel depois do login', async ({ page, baseURL }) => {
  const v = vigiar(page, baseURL);
  await page.goto('/painel/');
  await expect(page).toHaveTitle('Painel · Mineiro Lanche');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('#view-painel .pn-app')).toHaveCount(0);
  // login local: equipe@teste.local (o proxy do Supabase local aceita qualquer senha)
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sem acesso' }), 'equipe@teste.local precisa estar na tabela equipe').toHaveCount(0);
  await expect(page.locator('#view-painel .pn-app')).toBeAttached();
  // computador: quadro completo; celular: a versão compacta do painel
  const desktop = (page.viewportSize()?.width || 0) >= 1024;
  await expect(page.locator(desktop ? '.pn-desktop' : '.pn-mobile')).toBeVisible();
  if (desktop) await expect(page.locator('.pn-lado .pn-rodape')).toHaveText('Mineiro Lanche · Painel de pedidos');
  const texto = await page.locator('body').innerText();
  expect(texto.match(PREVIA)?.[0], 'texto de prévia no painel').toBeUndefined();
  // "Abrir cardápio ao lado" aponta para o cardápio da página do cliente
  if (desktop) {
    const popup = page.waitForEvent('popup');
    await page.locator('[data-act="abrir-cardapio"]').click();
    const janela = await popup;
    await expect(janela).toHaveURL(/\/#cardapio$/);
    await expect(janela.locator('[data-screen="menu"]')).toBeVisible();
  }
  expect(v.erros, 'erros no console').toEqual([]);
  expect(v.externas, 'requisições a outros domínios').toEqual([]);
});

test('head de produção: SEO na página do cliente, noindex só no painel, sem script inline', async ({ request }) => {
  const cliente = await (await request.get('/')).text();
  const painel = await (await request.get('/painel/')).text();
  for (const [nome, html] of [
    ['cliente', cliente],
    ['painel', painel]
  ]) {
    // só <script src> ou JSON-LD: a CSP de produção é script-src 'self'
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      ([, attrs, corpo]) => !/\bsrc=/.test(attrs) && !/application\/ld\+json/.test(attrs) && corpo.trim()
    );
    expect(inline.length, `script inline em ${nome}`).toBe(0);
    if (nome === 'cliente') {
      // public/rota.js é clássico e síncrono, antes do módulo: marca a tela inicial antes da primeira pintura
      const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
      expect(scripts[0], 'rota.js antes do app').toBe('/rota.js');
      expect(html).not.toMatch(/<script[^>]*src="\/rota\.js"[^>]*(defer|async|type="module")/);
    }
    expect(html, `favicon em ${nome}`).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(html).not.toContain('%VITE_');
  }
  expect(cliente).toContain('<html lang="pt-BR">');
  expect(cliente).not.toMatch(/name="robots"[^>]*noindex/);
  expect(cliente).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/">/);
  expect(cliente).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+\/assets\/og\.jpg">/);
  expect(cliente).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  expect(cliente).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
  const ld = JSON.parse(cliente.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  expect(ld['@type']).toBe('FoodEstablishment');
  expect(ld.telephone).toBe('+55 11 98572-0150');
  expect(ld.address).toMatchObject({
    streetAddress: 'Rua Eliziel Alves Costa, 300, Centro',
    addressLocality: 'Suzano',
    addressRegion: 'SP',
    addressCountry: 'BR'
  });
  expect(ld.hasMenu).toMatch(/\/#cardapio$/);
  // pedido do dono em 16/10 (docs/CLIENTE-2026-10.md): todos os dias das 18h à meia-noite, sexta e sábado também; fechado às quartas
  expect(ld.openingHoursSpecification).toHaveLength(1);
  const dias = Object.fromEntries(ld.openingHoursSpecification.flatMap((o) => o.dayOfWeek.map((d) => [d, o.opens + '-' + o.closes])));
  expect(dias).toEqual({
    Sunday: '18:00-00:00',
    Monday: '18:00-00:00',
    Tuesday: '18:00-00:00',
    Thursday: '18:00-00:00',
    Friday: '18:00-00:00',
    Saturday: '18:00-00:00'
  });
  expect(dias).not.toHaveProperty('Wednesday');
  expect(painel).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(painel).toContain('<link rel="manifest" href="/painel/manifest.webmanifest">');
});
