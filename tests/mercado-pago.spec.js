/* global window */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { criarPagamentos } from '../supabase/functions/mercado-pago/handler.js';
const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const sql = (s) => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const h = b64({ alg: 'HS256', typ: 'JWT' }),
  p = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
const service =
  h +
  '.' +
  p +
  '.' +
  createHmac('sha256', 'segredo-local-de-teste-com-mais-de-32-caracteres')
    .update(h + '.' + p)
    .digest('base64url');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const secret = 'segredo-webhook-local';
let original;
function limpar() {
  sql(
    "delete from pagamentos_mp_eventos where pagamento_id in(select m.id from pagamentos_mp m join pedidos p on p.id=m.pedido_id where p.cliente_nome like 'MP Teste%'); delete from pagamentos_mp where pedido_id in(select id from pedidos where cliente_nome like 'MP Teste%'); delete from pedidos where cliente_nome like 'MP Teste%'; delete from clientes where nome like 'MP Teste%'"
  );
}
test.beforeAll(() => {
  original = JSON.parse(
    sql("select json_build_object('modo',modo,'pagamentos_ativos',pagamentos_ativos,'cotacao_ativa',cotacao_ativa) from loja where id=1")
  );
});
test.beforeEach(() => {
  limpar();
  sql("update loja set modo='aberta',pagamentos_ativos=true,cotacao_ativa=false where id=1");
});
test.afterAll(() => {
  limpar();
  sql(
    `update loja set modo='${original.modo}',pagamentos_ativos=${original.pagamentos_ativos},cotacao_ativa=${original.cotacao_ativa} where id=1`
  );
});
async function preparar(page, { falhar = false } = {}) {
  const estado = { criadas: [], orders: new Map(), falhar };
  const fetcher = async (u, op) => {
    const url = String(u);
    if (url.includes('/auth/v1/user')) return fetch(url.replace('localhost:54323', 'localhost:54321'), op);
    if (url.startsWith('http://localhost:54323')) return fetch(url.replace('/rest/v1/', '/'), op);
    if (url === 'https://api.mercadopago.com/v1/orders') {
      if (estado.falhar) return json({ erro: 'temporario' }, 503);
      const body = JSON.parse(op.body),
        id = 'ORDTST' + body.external_reference.replaceAll('-', '').toUpperCase();
      estado.criadas.push({ body, idem: op.headers['X-Idempotency-Key'] });
      const order = {
        id,
        external_reference: body.external_reference,
        user_id: '123',
        currency: 'BRL',
        type: 'online',
        processing_mode: 'manual',
        total_amount: body.total_amount,
        total_paid_amount: '0.00',
        status: 'created',
        status_detail: 'created',
        last_updated_date: new Date(Date.now() - 2000).toISOString(),
        checkout_url: 'https://www.mercadopago.com.br/checkout/v1/redirect?order_id=' + id,
        integration_data: { application_id: '456' }
      };
      estado.orders.set(id, order);
      return json(order, 201);
    }
    if (url.endsWith('/refund')) {
      const order = estado.orders.get(url.split('/').at(-2));
      Object.assign(order, { status: 'refunded', status_detail: 'refunded', last_updated_date: new Date().toISOString() });
      return json({ status: 'refunded' });
    }
    if (url.startsWith('https://api.mercadopago.com/v1/orders/')) return json(estado.orders.get(url.split('/').pop()));
    throw Error('Endpoint inesperado ' + url);
  };
  const cfg = {
    supabaseUrl: 'http://localhost:54323',
    serviceKey: service,
    accessToken: 'token-local-simulado',
    webhookSecret: secret,
    accountId: '123',
    applicationId: '456',
    mode: 'test',
    siteUrl: 'https://mineirolanches.store'
  };
  const handler = criarPagamentos(cfg, { fetcher });
  estado.handler = handler;
  estado.webhook = criarPagamentos(cfg, { webhook: true, fetcher });
  await page.route('**/functions/v1/mercado-pago', async (route) => {
    const req = route.request(),
      res = await handler(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() }));
    await route.fulfill({ status: res.status, headers: { 'Content-Type': 'application/json' }, body: await res.text() });
  });
  await page.route('https://www.mercadopago.com.br/checkout/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Checkout Mercado Pago simulado</h1>' })
  );
  return estado;
}
async function checkout(page) {
  await page.goto('/#cardapio');
  await expect.poll(() => page.evaluate(() => window.ML.store.loja().pagamentosAtivos)).toBe(true);
  await page.locator('#prod-x-burguer').click();
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').click();
  await page.locator('#f-tel').fill('1198' + String(Math.floor(1000000 + Math.random() * 8999999)));
  const nome = 'MP Teste ' + Math.random().toString(36).slice(2);
  await page.locator('#f-nome').fill(nome);
  await page.locator('[data-modo=local]').click();
  await page.locator('#f-email-pagamento').fill('comprador@example.com');
  return nome;
}
async function confirmar(estado) {
  const o = [...estado.orders.values()][0];
  Object.assign(o, {
    status: 'processed',
    status_detail: 'accredited',
    total_paid_amount: o.total_amount,
    last_updated_date: new Date().toISOString()
  });
  const rid = 'request-webhook',
    ts = String(Date.now());
  const hash = createHmac('sha256', secret).update(`id:${o.id.toLowerCase()};request-id:${rid};ts:${ts};`).digest('hex');
  const res = await estado.webhook(
    new Request('http://local/?data.id=' + o.id, {
      method: 'POST',
      headers: { 'x-request-id': rid, 'x-signature': `ts=${ts},v1=${hash}` },
      body: JSON.stringify({ type: 'order', data: { id: o.id } })
    })
  );
  expect(res.status).toBe(200);
}
test('checkout móvel vai ao Mercado Pago; webhook aprova e retorno mostra pagamento confirmado', async ({ page }) => {
  const estado = await preparar(page),
    nome = await checkout(page);
  await expect(page.locator('#btn-enviar')).toContainText('Pagar pedido');
  await page.screenshot({ path: test.info().outputPath('checkout-mercado-pago.png'), fullPage: true });
  await page.locator('#btn-enviar').click();
  await expect(page).toHaveURL(/www\.mercadopago\.com\.br\/checkout\//);
  expect(estado.criadas).toHaveLength(1);
  expect(estado.criadas[0].body.total_amount).toBe('16.90');
  expect(sql(`select pagamento_online from pedidos where cliente_nome='${nome}'`)).toBe('pendente');
  await confirmar(estado);
  const token = sql(`select token from pedidos where cliente_nome='${nome}'`);
  await page.goto('/#pedido/' + token);
  await expect(page.locator('#pedido-pagamento-status')).toHaveText('Pagamento aprovado');
  await expect(page.locator('#pedido-pagar')).toBeHidden();
  expect(sql(`select count(*) from pagamentos_mp m join pedidos p on p.id=m.pedido_id where p.cliente_nome='${nome}'`)).toBe('1');
});
test('falha preserva pedido; retorno adulterado não aprova e repetição usa o mesmo pagamento', async ({ page }) => {
  const estado = await preparar(page, { falhar: true }),
    nome = await checkout(page);
  await page.locator('#btn-enviar').click();
  await expect(page.locator('#pedido-pagamento-erro')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('pagamento-pendente.png'), fullPage: true });
  const token = sql(`select token from pedidos where cliente_nome='${nome}'`),
    id = sql(`select m.id from pagamentos_mp m join pedidos p on p.id=m.pedido_id where p.cliente_nome='${nome}'`);
  await page.goto('/?status=approved#pedido/' + token);
  await expect(page.locator('#pedido-pagamento-status')).toHaveText('Aguardando pagamento');
  estado.falhar = false;
  sql(`update pagamentos_mp set criando_ate=now()-interval '1 second' where id='${id}'`);
  await page.locator('#pedido-pagamento-email').fill('comprador@example.com');
  await page.getByRole('button', { name: 'Pagar no Mercado Pago', exact: true }).click();
  await expect(page).toHaveURL(/www\.mercadopago\.com\.br\/checkout\//);
  expect(estado.criadas).toHaveLength(1);
  expect(estado.criadas[0].idem).toBe(id);
  expect(sql(`select count(*) from pedidos where cliente_nome='${nome}'`)).toBe('1');
});
test('painel bloqueia aceitar antes de pagar e habilita depois do webhook', async ({ page, browser }) => {
  const estado = await preparar(page),
    nome = await checkout(page);
  await page.locator('#btn-enviar').click();
  await expect(page).toHaveURL(/www\.mercadopago\.com\.br\/checkout\//);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    painel = await ctx.newPage();
  try {
    await painel.goto('http://localhost:4180/painel/');
    await painel.getByLabel('E-mail').fill('equipe@teste.local');
    await painel.getByLabel('Senha').fill('teste');
    await painel.getByRole('button', { name: 'Entrar', exact: true }).click();
    const id = sql(`select id from pedidos where cliente_nome='${nome}'`),
      card = painel.locator(`.pn-card[data-id="${id}"]`);
    await expect(card).toContainText('Aguardando pagamento');
    await expect(card.locator('[data-act=avancar]')).toHaveCount(0);
    await confirmar(estado);
    await expect(card.locator('[data-act=avancar]')).toBeVisible({ timeout: 15000 });
    await card.locator('[data-act=avancar]').click();
    await expect.poll(() => sql(`select status from pedidos where id='${id}'`)).toBe('preparo');
  } finally {
    await ctx.close();
  }
});
test('administrador estorna pedido pago e cancelado pelo detalhe do histórico', async ({ page, browser }) => {
  const estado = await preparar(page),
    nome = await checkout(page);
  await page.locator('#btn-enviar').click();
  await expect(page).toHaveURL(/www\.mercadopago\.com\.br\/checkout\//);
  await confirmar(estado);
  const id = sql(`select id from pedidos where cliente_nome='${nome}'`),
    admin = '00000000-0000-4000-8000-000000000001';
  const anterior = sql(`select to_jsonb(u) from usuarios_painel u where user_id='${admin}'`);
  sql(`insert into usuarios_painel(user_id,nome,email,perfil,ativo) values('${admin}','Equipe teste','equipe@teste.local','admin',true) on conflict(user_id) do update set perfil='admin',ativo=true;
 update pedidos set status='cancelado' where id='${id}';`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    painel = await ctx.newPage();
  try {
    await painel.route('**/functions/v1/mercado-pago', async (route) => {
      const req = route.request(),
        r = await estado.handler(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() }));
      await route.fulfill({ status: r.status, headers: { 'Content-Type': 'application/json' }, body: await r.text() });
    });
    await painel.goto('http://localhost:4180/painel/');
    await painel.getByLabel('E-mail').fill('equipe@teste.local');
    await painel.getByLabel('Senha').fill('teste');
    await painel.getByRole('button', { name: 'Entrar', exact: true }).click();
    await painel.locator('[data-nav=historico]').click();
    await painel.locator(`tr[data-id="${id}"] [data-act=detalhe]`).click();
    await expect(painel.locator('[data-lateral]')).toContainText('Pedido cancelado com pagamento recebido');
    painel.once('dialog', (d) => d.accept());
    await painel.locator('[data-lateral] [data-act=estornar]').click();
    await expect.poll(() => sql(`select pagamento_online from pedidos where id='${id}'`)).toBe('reembolsado');
    await expect(painel.locator('[data-lateral]')).toContainText('Reembolsado');
    expect(sql(`select reembolso_autor from pagamentos_mp where pedido_id='${id}'`)).toBe(admin);
  } finally {
    await ctx.close();
    if (anterior) {
      const a = JSON.parse(anterior);
      sql(`update usuarios_painel set perfil='${a.perfil}',ativo=${a.ativo} where user_id='${admin}'`);
    } else sql(`delete from usuarios_painel where user_id='${admin}'`);
  }
});
