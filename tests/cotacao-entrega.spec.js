/* global window */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { criarHandler } from '../supabase/functions/cotar-entrega/handler.js';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const psql = (sql) => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const h = b64({ alg: 'HS256', typ: 'JWT' }),
  p = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
const token =
  h +
  '.' +
  p +
  '.' +
  createHmac('sha256', 'segredo-local-de-teste-com-mais-de-32-caracteres')
    .update(h + '.' + p)
    .digest('base64url');
const casos = [
  { cep: '08680120', rua: 'Rua Vitório Favalli', bairro: 'Vila Maria de Maggi', cidade: 'Suzano', lat: -23.5269209, lon: -46.323295 },
  { cep: '08615050', rua: 'Rua Professor Jeremia', bairro: 'Vila Urupês', cidade: 'Suzano', lat: -23.5437745, lon: -46.2954576 },
  {
    cep: '08501500',
    rua: 'Rua Benedito Leite',
    bairro: 'Vila Correa',
    cidade: 'Ferraz de Vasconcelos',
    lat: -23.5408541,
    lon: -46.3579467
  },
  { cep: '08676140', rua: 'Rua Camilo Scurço', bairro: 'Vila Figueira', cidade: 'Suzano', lat: -23.5525657, lon: -46.3090836 }
];
const json = (j) => new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } });
// eslint-disable-next-line no-empty-pattern -- fixture exigida pelo Playwright
test.beforeEach(({}, info) => test.skip(!['celular', 'iphone'].includes(info.project.name), 'checkout móvel'));
test.beforeAll(() => psql("update loja set modo='aberta',cotacao_ativa=true"));
test.afterAll(() => {
  psql(
    "delete from pedidos where cliente_nome like 'Cotacao Teste%'; delete from clientes where nome like 'Cotacao Teste%'; update loja set modo='auto',cotacao_ativa=false"
  );
});

async function preparar(page, { preciso = false, semRotas = false, principalFalha = false, expirar = false, aguardarRota = false } = {}) {
  psql('delete from entrega_travas; delete from entrega_limites');
  const chamadas = { rota: 0, alternativa: 0, geocode: 0, envios: 0 };
  let liberar;
  const esperaRota = aguardarRota
    ? new Promise((resolve) => {
        liberar = resolve;
      })
    : Promise.resolve();
  chamadas.liberarRota = () => {
    if (liberar) liberar();
  };
  let reduzida = expirar;
  const fetcher = async (u, op) => {
    const s = String(u);
    if (s.startsWith('http://localhost:54323')) return fetch(u, op);
    if (s.includes('viacep')) {
      const c = casos.find((c) => s.includes(c.cep));
      return json(c ? { cep: c.cep, logradouro: c.rua, bairro: c.bairro, localidade: c.cidade, uf: 'SP' } : { erro: true });
    }
    if (s.includes('awesomeapi')) {
      const c = casos.find((c) => s.includes(c.cep));
      return json(
        c ? { cep: c.cep, address: c.rua, city: c.cidade, state: 'SP', district: c.bairro, lat: String(c.lat), lng: String(c.lon) } : {}
      );
    }
    if (s.includes('/geocode/search')) {
      chamadas.geocode++;
      if (!preciso) return json({ results: [] });
      const c = casos.find((c) => s.includes(c.cep.slice(0, 5) + '-' + c.cep.slice(5)));
      return json({
        results: [
          {
            lat: c.lat,
            lon: c.lon,
            country_code: 'br',
            state_code: 'SP',
            city: c.cidade,
            street: c.rua,
            housenumber: '100',
            postcode: c.cep,
            result_type: 'building',
            rank: { confidence: 1, match_type: 'full_match' }
          }
        ]
      });
    }
    if (s.includes('api.geoapify.com/v1/routing')) {
      chamadas.rota++;
      await esperaRota;
      return semRotas || principalFalha
        ? new Response('{}', { status: 503 })
        : json({ results: [{ distance: 10000, distance_units: 'Meters' }] });
    }
    if (s.includes('openrouteservice')) {
      chamadas.alternativa++;
      return semRotas ? new Response('{}', { status: 503 }) : json({ routes: [{ summary: { distance: 10000 } }] });
    }
    throw new Error('Serviço inesperado ' + s);
  };
  // O handler usa /rest/v1; PostgREST direto não tem esse prefixo.
  const adaptado = criarHandler({
    supabaseUrl: 'http://localhost:54323',
    serviceKey: token,
    geoapifyKey: 'teste',
    orsKey: 'teste',
    fetcher: (u, o) => fetcher(String(u).replace('http://localhost:54323/rest/v1/', 'http://localhost:54323/'), o)
  });
  await page.route('**/functions/v1/cotar-entrega', async (route) => {
    const r = route.request();
    const response = await adaptado(new Request('https://local.invalid', { method: r.method(), headers: r.headers(), body: r.postData() }));
    const body = await response.json();
    if (reduzida && body.estado === 'ok') {
      body.expiraEm = new Date(Date.now() + 2000).toISOString();
      reduzida = false;
    }
    try {
      await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      /* cliente cancelou endereço antigo */
    }
  });
  await page.route('https://tile.openstreetmap.org/**', (r) =>
    r.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64')
    })
  );
  page.on('request', (r) => {
    if (r.url().includes('/rpc/criar_pedido')) chamadas.envios++;
  });
  return chamadas;
}
async function checkout(page, c = casos[0]) {
  await page.goto('/#cardapio');
  await expect.poll(() => page.evaluate(() => window.ML.store.loja().cotacaoAtiva)).toBe(true);
  await page.locator('#prod-x-burguer').click();
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').click();
  const nome = 'Cotacao Teste ' + Math.random().toString(36).slice(2);
  await page.locator('#f-nome').fill(nome);
  await page.locator('#f-tel').fill('1197' + String(Math.floor(1000000 + Math.random() * 8999999)));
  await page.locator('#f-cep').fill(c.cep);
  await expect(page.locator('#f-end')).toHaveValue(c.rua + ', ');
  await page.locator('#f-end').fill(c.rua + (c === casos[2] ? ' 100, Casa' : ', 100'));
  return nome;
}
async function confirmar(page) {
  await expect(page.locator('#chk-taxa')).toHaveText('confirme o local');
  await page.locator('#taxa-localizar').click();
  const dialog = page.getByRole('dialog', { name: 'Onde vamos entregar?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirmar local de entrega' })).toBeDisabled();
  const mapa = dialog.locator('.mapa-entrega__mapa'),
    b = await mapa.boundingBox();
  await mapa.click({ position: { x: b.width / 2 + 45, y: b.height / 2 } });
  await dialog.getByRole('button', { name: 'Confirmar local de entrega' }).click();
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
}

for (const [i, c] of casos.entries())
  test(`recupera o caso ${i + 1} com confirmação, grava taxa e mantém o endereço`, async ({ page }) => {
    await preparar(page);
    const nome = await checkout(page, c);
    await confirmar(page);
    await expect(page.locator('#btn-enviar .btn-valor')).toHaveText('R$ 30,90');
    await page.locator('#btn-enviar').click();
    await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
    expect(
      psql(`select taxa_entrega,total,cotacao_entrega_id is not null,entrega_destino is not null from pedidos where cliente_nome='${nome}'`)
    ).toBe('14.00|30.90|t|t');
  });
test('endereço preciso segue automaticamente; falha da rota principal recupera pelo segundo provedor', async ({ page }) => {
  const chamadas = await preparar(page, { preciso: true, principalFalha: true });
  await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  expect(chamadas.alternativa).toBe(1);
  await expect(page.locator('#taxa-fonte')).toContainText('OpenRouteService');
});
test('falha completa preserva sacola e impede enviar pedido sem taxa', async ({ page }) => {
  const chamadas = await preparar(page, { preciso: true, semRotas: true });
  await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('taxa pendente');
  await page.locator('#btn-enviar').click();
  expect(chamadas.envios).toBe(0);
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
  await expect(page.locator('#chk-itens')).toHaveText('1 item');
});
test('cotação expira e o cliente precisa conferir o valor recalculado antes de enviar', async ({ page }) => {
  const chamadas = await preparar(page, { preciso: true, expirar: true });
  await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  await expect(page.locator('#chk-taxa')).toHaveText('atualize a taxa');
  await page.locator('#btn-enviar').click();
  expect(chamadas.envios).toBe(0);
  await page.locator('#taxa-tentar').click();
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  expect(chamadas.rota).toBe(1); // rota vigente foi reaproveitada pelo backend
});
test('resposta perdida após gravar: repetição depois da expiração recupera um único pedido', async ({ page }) => {
  await preparar(page, { preciso: true, expirar: true });
  const nome = await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  let perder = true;
  await page.route('**/rest/v1/rpc/criar_pedido', async (r) => {
    const response = await r.fetch();
    if (perder) {
      perder = false;
      await r.abort();
    } else await r.fulfill({ response });
  });
  await page.locator('#btn-enviar').click();
  await expect(page.locator('#envio-erro')).toBeVisible();
  await expect(page.locator('#chk-taxa')).toHaveText('atualize a taxa');
  await page.locator('[data-tentar]').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  expect(psql(`select count(*) from pedidos where cliente_nome='${nome}'`)).toBe('1');
});
test('GPS recusado permite marcar o mapa e concluir o cálculo', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition(ok, erro) {
          erro({ code: 1 });
        }
      }
    })
  );
  await preparar(page);
  await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('confirme o local');
  await page.locator('#taxa-localizar').click();
  const dialog = page.getByRole('dialog', { name: 'Onde vamos entregar?' });
  await dialog.getByRole('button', { name: 'Usar minha localização' }).click();
  await expect(dialog.locator('[role="status"]')).toContainText('marcar o endereço no mapa');
  await dialog.getByRole('button', { name: 'Marcar no centro do mapa' }).click();
  await dialog.getByRole('button', { name: 'Confirmar local de entrega' }).click();
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
});
test('trocar de endereço invalida a cotação anterior e consulta o destino novo', async ({ page }) => {
  const chamadas = await preparar(page, { preciso: true });
  await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  await page.locator('#f-cep').fill(casos[1].cep);
  await expect(page.locator('#chk-taxa')).not.toHaveText('R$ 14,00');
  await expect(page.locator('#f-end')).toHaveValue(casos[1].rua + ', ');
  await page.locator('#f-end').fill(casos[1].rua + ', 100');
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  expect(chamadas.rota).toBe(2);
});
test('enviar antes da cotação terminar exige conferir o total e confirmar de novo', async ({ page }) => {
  const chamadas = await preparar(page, { preciso: true, aguardarRota: true });
  await checkout(page);
  await expect.poll(() => chamadas.rota).toBe(1);
  await page.locator('#btn-enviar').click();
  await expect(page.locator('#form-pedido')).toHaveAttribute('aria-busy', 'true');
  chamadas.liberarRota();
  await expect(page.locator('#form-pedido')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  await expect(page.locator('#taxa-msg')).toContainText('Confira o total');
  expect(chamadas.envios).toBe(0);
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  expect(chamadas.envios).toBe(1);
});

test('taxa identifica o provedor com atribuição e a chave não chega ao navegador', async ({ page }) => {
  const externas = [];
  page.on('request', (r) => {
    if (/api\.geoapify|api\.openrouteservice|googleapis/.test(r.url())) externas.push(r.url());
  });
  await preparar(page, { preciso: true });
  await checkout(page);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 14,00');
  await expect(page.locator('#taxa-fonte a').first()).toHaveAttribute('href', 'https://www.geoapify.com/');
  expect(externas).toEqual([]);
});
