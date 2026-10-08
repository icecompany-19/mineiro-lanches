// Navegação de produção (sem as abas da prévia): bio é a tela inicial; da bio se chega ao cardápio e ao site,
// do site se volta ao cardápio e à bio. Links diretos, voltar do navegador, console limpo, nada de domínio externo
// (fora o próprio Supabase), nenhum texto de prévia e o painel em /painel/, com login da equipe.
// Uso: npx playwright test tests/navegacao.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global document, location, innerHeight, scrollTo, window, requestAnimationFrame */
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
  expect(ld.address).toMatchObject({ addressLocality: 'Suzano', addressRegion: 'SP', addressCountry: 'BR' });
  expect(ld.hasMenu).toMatch(/\/#cardapio$/);
  expect(ld.openingHoursSpecification.flatMap((o) => o.dayOfWeek)).not.toContain('Sunday');
  expect(painel).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(painel).toContain('<link rel="manifest" href="/painel/manifest.webmanifest">');
});
