// Confere o build como a Vercel vai servir (vercel.json): cabeçalhos, redirecionamentos do QR e CSP sem violação.
// Uso: npx playwright test tests/vercel.spec.js --project=desktop
// Roda "npm run build" numa pasta temporária (não mexe no dist/ dos outros testes) e sobe scripts/servir-como-vercel.mjs.
// VERCEL_DIST=<pasta> pula o build e serve essa pasta.
/* global window, document, innerHeight, scrollTo */
import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const RAIZ = resolve(import.meta.dirname, '..');
const ENV = Object.fromEntries(
  readFileSync(join(RAIZ, '.env.production'), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const SUPABASE = new URL(ENV.VITE_SUPABASE_URL).host;
const SITE = ENV.VITE_SITE_URL.replace(/\/$/, '');

// O que tem de estar em toda resposta.
const SEGURANCA = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=63072000; includeSubDomains'
};
const PERMISSOES = ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'];
const CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", `https://${SUPABASE}`, `wss://${SUPABASE}`],
  'manifest-src': ["'self'"],
  'media-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': []
};
const CACHE = {
  html: 'public, max-age=0, must-revalidate',
  app: 'public, max-age=31536000, immutable',
  assets: 'public, max-age=604800, stale-while-revalidate=86400',
  qr: 'public, max-age=3600'
};
const REDIRECTS = [
  ['/q', '/?origem=qrcode'],
  ['/q/3', '/?origem=qrcode&mesa=3'],
  ['/painel', '/painel/']
];
const PAGINAS = ['/', '/#cardapio', '/q', '/q/3', '/painel/'];
// Cartaz do QR (public/qr/cartaz.html, fora do Vite): também é servido com a mesma CSP.
const CARTAZ = '/qr/cartaz';

let base, pasta, pastaTmp, servidor;

function portaLivre() {
  return new Promise((ok, erro) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', erro);
  });
}

async function esperarServidor(url, ms = 15_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      if ((await fetch(url + '/robots.txt')).status) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('servir-como-vercel.mjs não respondeu em ' + url);
}

function lerCsp(valor) {
  const mapa = {};
  for (const parte of valor.split(';')) {
    const [nome, ...fontes] = parte.trim().split(/\s+/);
    if (nome) mapa[nome] = fontes;
  }
  return mapa;
}

function conferirSeguranca(h, rota) {
  for (const [k, v] of Object.entries(SEGURANCA)) expect(h[k], `${k} em ${rota}`).toBe(v);
  for (const p of PERMISSOES) expect(h['permissions-policy'] || '', `Permissions-Policy em ${rota}`).toContain(p);
  expect(h['content-security-policy'], `CSP em ${rota}`).toBeTruthy();
  const csp = lerCsp(h['content-security-policy']);
  for (const [diretiva, fontes] of Object.entries(CSP)) {
    expect(csp[diretiva], `CSP ${diretiva} em ${rota}`).toBeDefined();
    expect([...csp[diretiva]].sort(), `CSP ${diretiva} em ${rota}`).toEqual([...fontes].sort());
  }
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (process.env.VERCEL_DIST) pasta = resolve(process.env.VERCEL_DIST);
  else {
    pastaTmp = mkdtempSync(join(tmpdir(), 'ml-vercel-'));
    pasta = join(pastaTmp, 'dist');
    try {
      execFileSync('npm', ['run', 'build', '--', '--outDir', pasta, '--emptyOutDir'], { cwd: RAIZ, stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
      const saida = `${e.stdout || ''}\n${e.stderr || ''}`.trim().slice(-2000);
      throw new Error('"npm run build" falhou (problema do front, não do vercel.json):\n' + saida);
    }
  }
  const porta = await portaLivre();
  base = `http://localhost:${porta}`;
  servidor = spawn(process.execPath, [join(RAIZ, 'scripts/servir-como-vercel.mjs'), String(porta), '--dir', pasta], {
    cwd: RAIZ,
    stdio: 'ignore'
  });
  await esperarServidor(base);
});

test.afterAll(() => {
  servidor?.kill();
  if (pastaTmp) rmSync(pastaTmp, { recursive: true, force: true });
});

test('vercel.json: framework, build e saída', () => {
  const cfg = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'));
  expect(cfg.framework).toBe('vite');
  expect(cfg.buildCommand).toBe('npm run build');
  expect(cfg.outputDirectory).toBe('dist');
  // trailingSlash false faria /painel/ → /painel → /painel/ em laço
  expect(cfg.trailingSlash).not.toBe(false);
  for (const [de] of REDIRECTS) expect(cfg.redirects.find((r) => r.source === de.replace(/\/3$/, '/:mesa'))?.statusCode, de).toBe(302);
});

test('redirecionamentos temporários do QR e do painel', async ({ request, page }) => {
  for (const [de, para] of REDIRECTS) {
    const r = await request.get(base + de, { maxRedirects: 0 });
    expect(r.status(), `status de ${de}`).toBe(302);
    expect(r.headers().location, `destino de ${de}`).toBe(para);
  }
  // no navegador (o app pode mexer no hash ou limpar a query depois; vale a URL da resposta final)
  for (const [de, para] of REDIRECTS) {
    const resp = await page.goto(base + de);
    expect(resp.url(), `URL final de ${de}`).toBe(base + para);
    expect(resp.status(), `página final de ${de}`).toBe(200);
    expect(resp.request().redirectedFrom()?.url(), `origem do redirecionamento ${de}`).toBe(base + de);
  }
  // a query de quem chega pelo QR é mantida
  const r = await request.get(base + '/q?utm_source=cartaz', { maxRedirects: 0 });
  expect(r.headers().location).toBe('/?origem=qrcode&utm_source=cartaz');
});

test('cabeçalhos de segurança e de cache', async ({ request }) => {
  const appJs = readdirSync(join(pasta, '_app')).find((a) => a.endsWith('.js'));
  expect(appJs, 'bundle em /_app').toBeTruthy();
  const casos = [
    ['/', { 'cache-control': CACHE.html }],
    ['/painel/', { 'cache-control': CACHE.html, 'x-robots-tag': 'noindex, nofollow' }],
    ['/painel/manifest.webmanifest', { 'x-robots-tag': 'noindex, nofollow' }],
    ['/_app/' + appJs, { 'cache-control': CACHE.app }],
    ['/assets/og.jpg', { 'cache-control': CACHE.assets }],
    ['/manifest.webmanifest', {}],
    ['/favicon.svg', {}],
    ['/icons/icon-192.png', {}],
    ['/robots.txt', {}],
    ['/sitemap.xml', {}]
  ];
  const qr = existsSync(join(pasta, 'qr')) && readdirSync(join(pasta, 'qr')).find((a) => /\.(svg|png|html)$/.test(a));
  if (qr) casos.push(['/qr/' + qr, { 'cache-control': CACHE.qr }]);
  else test.info().annotations.push({ type: 'aviso', description: 'public/qr ainda não existe: cache de /qr/* não conferido' });

  for (const [rota, esperado] of casos) {
    const r = await request.get(base + rota, { maxRedirects: 0 });
    expect(r.status(), rota).toBe(200);
    const h = r.headers();
    conferirSeguranca(h, rota);
    for (const [k, v] of Object.entries(esperado)) expect(h[k], `${k} em ${rota}`).toBe(v);
    if (!rota.startsWith('/painel/')) expect(h['x-robots-tag'], `X-Robots-Tag fora do painel (${rota})`).toBeUndefined();
  }
});

test('manifestos e ícones', async ({ request }) => {
  const manifestos = {
    '/manifest.webmanifest': {
      name: 'Mineiro Lanche',
      short_name: 'Mineiro',
      start_url: '/?origem=pwa',
      scope: '/',
      theme_color: '#C8102E',
      background_color: '#FFF6E0'
    },
    '/painel/manifest.webmanifest': {
      name: 'Painel · Mineiro Lanche',
      short_name: 'Painel',
      start_url: '/painel/',
      scope: '/painel/',
      background_color: '#1A1414'
    }
  };
  for (const [rota, campos] of Object.entries(manifestos)) {
    const r = await request.get(base + rota);
    expect(r.status(), rota).toBe(200);
    expect(r.headers()['content-type'], rota).toContain('application/manifest+json');
    const m = await r.json();
    expect(m, rota).toMatchObject({ ...campos, display: 'standalone', lang: 'pt-BR' });
    expect(
      m.icons.some((i) => i.purpose === 'maskable'),
      `ícone maskable em ${rota}`
    ).toBe(true);
    for (const ic of m.icons) {
      const img = await request.get(base + ic.src);
      expect(img.status(), ic.src).toBe(200);
      expect(img.headers()['content-type'], ic.src).toBe(ic.type);
      if (ic.type === 'image/png') {
        const { width, height } = await sharp(await img.body()).metadata();
        expect(`${width}x${height}`, ic.src).toBe(ic.sizes);
      }
    }
  }
  for (const [rota, lado] of [
    ['/icons/favicon-32.png', 32],
    ['/icons/apple-touch-icon.png', 180]
  ]) {
    const img = await request.get(base + rota);
    expect(img.status(), rota).toBe(200);
    const { width, height } = await sharp(await img.body()).metadata();
    expect([width, height], rota).toEqual([lado, lado]);
  }
});

test('robots.txt e sitemap.xml', async ({ request }) => {
  const robots = await (await request.get(base + '/robots.txt')).text();
  expect(robots).toMatch(/^Disallow: \/painel\/$/m);
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  const sitemap = await request.get(base + '/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain(`<loc>${SITE}/</loc>`);
});

for (const rota of [...PAGINAS, CARTAZ]) {
  test(`sem violação de CSP em ${rota}`, async ({ page }) => {
    test.skip(rota === CARTAZ && !existsSync(join(pasta, 'qr/cartaz.html')), 'public/qr/cartaz.html ainda não existe');
    const violacoes = [],
      falhas = [],
      avisos = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) violacoes.push('console: ' + m.text());
    });
    page.on('requestfailed', (req) => {
      const erro = req.failure()?.errorText || '';
      if (/BLOCKED_BY_CSP/i.test(erro)) violacoes.push(`bloqueado: ${req.url()}`);
      else if (req.url().startsWith(base) && !/ERR_ABORTED/.test(erro)) falhas.push(`${req.url()} (${erro})`);
    });
    page.on('response', (resp) => {
      if (resp.url().startsWith(base) && resp.status() >= 400) avisos.push(`${resp.status()} ${resp.url()}`);
    });
    page.on('pageerror', (e) => {
      if (/Content Security Policy|unsafe-eval/i.test(e.message)) violacoes.push('erro: ' + e.message);
      else avisos.push('erro de JS: ' + e.message);
    });
    await page.addInitScript(() => {
      window.__violacoesCsp = [];
      document.addEventListener(
        'securitypolicyviolation',
        (e) =>
          window.__violacoesCsp.push(
            `${e.effectiveDirective} bloqueou ${e.blockedURI || 'inline'} (${e.sourceFile || '?'}:${e.lineNumber || '?'})`
          ),
        true
      );
    });

    const resp = await page.goto(base + rota, { waitUntil: 'load' });
    expect(resp.status(), rota).toBe(200);
    // rola até o fim para disparar as imagens com loading="lazy"
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
      scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    violacoes.push(...(await page.evaluate(() => window.__violacoesCsp || [])));

    for (const a of avisos) test.info().annotations.push({ type: 'aviso', description: a });
    expect(violacoes, `violações de CSP em ${rota}`).toEqual([]);
    expect(falhas, `requisições do próprio site que falharam em ${rota}`).toEqual([]);
  });
}
