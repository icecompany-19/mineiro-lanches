import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { criarPagamentos } from '../supabase/functions/mercado-pago/handler.js';
import { criarOrder, conferirOrder, assinaturaValida, centavos, urlCheckout } from '../supabase/functions/_shared/mercado-pago.js';
import { checkoutSeguro, permitePagar, financeiroRecente } from '../src/lib/pagamentos.js';
const id = '00000000-0000-4000-8000-000000000010',
  token = '00000000-0000-4000-8000-000000000020';
const orderId = 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9';
const config = {
  supabaseUrl: 'https://db.invalid',
  serviceKey: 'backend-privado',
  accessToken: 'mp-privado',
  webhookSecret: 'assinatura-secreta',
  accountId: '123',
  applicationId: '456',
  mode: 'test',
  siteUrl: 'https://mineirolanches.store'
};
const pagamento = {
  id,
  pedido_id: '00000000-0000-4000-8000-000000000030',
  numero: 20,
  token,
  email: 'teste@example.com',
  total: '28.90',
  itens: [{ produtoId: 'x-burguer', nome: 'X-Burguer', qtd: 1, precoUnit: 16.9 }],
  taxaEntrega: 12,
  estado: 'pendente',
  pedido_status: 'novo'
};
const order = {
  id: orderId,
  external_reference: id,
  user_id: '123',
  currency: 'BRL',
  type: 'online',
  processing_mode: 'manual',
  total_amount: '28.90',
  total_paid_amount: '28.90',
  status: 'processed',
  status_detail: 'accredited',
  last_updated_date: '2026-10-18T18:00:00Z',
  checkout_url: 'https://www.mercadopago.com.br/checkout/v1/redirect?order_id=' + orderId,
  integration_data: { application_id: '456' }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
function preparar({ p = { ...pagamento, criar: true }, o = order, webhook = false, conf = config, erroMP = false, negado = false } = {}) {
  const calls = [];
  const handler = criarPagamentos(conf, {
    webhook,
    fetcher: async (u, op) => {
      calls.push({ url: String(u), ...op, body: op.body ? JSON.parse(op.body) : null });
      if (String(u).includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001' });
      if (String(u).includes('autorizar_reembolso_mp'))
        return negado ? json({ message: 'sem_permissao' }, 400) : json({ ...pagamento, order_id: orderId });
      if (String(u).includes('/refund')) return json({ status: 'refunded' });
      if (String(u).includes('/v1/orders')) return erroMP ? json({ error: 'secret-sensitive-diagnostic' }, 500) : json(o);
      if (String(u).includes('/pagamentos_mp?')) return json([p]);
      if (String(u).includes('reservar_conciliacao_mp')) return json([p]);
      if (String(u).includes('preparar_pagamento_mp')) return json(p);
      if (String(u).includes('registrar_pagamento_mp')) return json({ estado: 'aprovado' });
      assert.fail(String(u));
    }
  });
  return {
    calls,
    handler,
    enviar: (body, headers = {}) =>
      handler(
        new Request('https://local.invalid', {
          method: 'POST',
          headers: { Origin: 'https://mineirolanches.store', ...headers },
          body: JSON.stringify(body)
        })
      )
  };
}
function notificacao(override = {}) {
  const query = '?data.id=' + orderId + '&type=order',
    rid = 'request-1',
    ts = '1742505638683';
  const manifest = `id:${orderId.toLowerCase()};request-id:${rid};ts:${ts};`;
  const hash = createHmac('sha256', config.webhookSecret).update(manifest).digest('hex');
  return new Request('https://local.invalid/' + query, {
    method: 'POST',
    headers: { 'x-request-id': rid, 'x-signature': `ts=${ts},v1=${hash}`, ...override },
    body: JSON.stringify({ type: 'order', data: { id: orderId }, status: 'approved', amount: 1 })
  });
}
test('valores monetários exatos e total inclui entrega calculada pelo banco', () => {
  assert.equal(centavos('28.90'), 2890);
  for (const v of ['-1', '1.001', 'NaN', '1e3', null]) assert.throws(() => centavos(v));
  const payload = criarOrder(pagamento, config.siteUrl);
  assert.equal(payload.total_amount, '28.90');
  assert.equal(payload.items[0].unit_price, '16.90');
  assert.equal(payload.items[1].unit_price, '12.00');
  assert.throws(() => criarOrder({ ...pagamento, total: '1.00' }, config.siteUrl));
  assert.equal(payload.external_reference, id);
  assert.equal(payload.processing_mode, 'manual');
  assert.equal(payload.config.online.success_url, 'https://mineirolanches.store/#pedido/' + token);
  assert.deepEqual(payload.config.payment_method.not_allowed_types, ['ticket', 'atm']);
  assert(!JSON.stringify(payload).includes(config.accessToken));
});
test('checkout rejeita destinos externos, credenciais e protocolos inseguros no backend e navegador', () => {
  for (const bad of [
    'https://evil.invalid/checkout/',
    'https://www.mercadopago.com.br.evil.invalid/checkout/',
    'http://www.mercadopago.com.br/checkout/',
    'https://a:b@www.mercadopago.com.br/checkout/',
    'javascript:alert(1)'
  ]) {
    assert.throws(() => urlCheckout(bad));
    assert.throws(() => checkoutSeguro(bad));
  }
  assert.equal(checkoutSeguro(order.checkout_url), order.checkout_url);
});
test('aprovação confere conta, referência, moeda, ambiente, total, valor efetivamente pago e tipo', () => {
  assert.equal(conferirOrder(order, pagamento, '123', 'test').p_estado, 'aprovado');
  for (const patch of [
    { user_id: '999' },
    { external_reference: token },
    { currency: 'USD' },
    { total_amount: '1.00' },
    { total_paid_amount: '0.00' },
    { type: 'qr' },
    { id: 'ORD01KS5AJ6HTK2HRQ3XJ3C2JCKP9' },
    { last_updated_date: null }
  ])
    assert.throws(() => conferirOrder({ ...order, ...patch }, pagamento, '123', 'test'));
  assert.equal(
    conferirOrder({ ...order, status: 'action_required', status_detail: 'waiting_capture' }, pagamento, '123', 'test').p_estado,
    'pendente'
  );
  assert.equal(
    conferirOrder({ ...order, status_detail: 'partially_refunded' }, pagamento, '123', 'test').p_estado,
    'parcialmente_reembolsado'
  );
});
test('inicia com preço e idempotência do banco; ignora total adulterado e não expõe credenciais', async () => {
  const { enviar, calls } = preparar();
  const r = await enviar({ acao: 'iniciar', token, email: pagamento.email, total: 0.01 });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert(!text.includes('privado'));
  assert(!text.includes(pagamento.email));
  const call = calls.find((c) => c.url === 'https://api.mercadopago.com/v1/orders');
  assert.equal(call.body.total_amount, '28.90');
  assert.equal(call.headers['X-Idempotency-Key'], id);
  assert(calls.some((c) => c.url.endsWith('/registrar_pagamento_mp')));
});
test('consulta usa GET do recurso, nunca cria outra cobrança; lease em andamento retorna 202', async () => {
  const p = { ...pagamento, order_id: orderId, consultar: true };
  const a = preparar({ p });
  assert.equal((await a.enviar({ acao: 'consultar', token })).status, 200);
  assert(a.calls.some((c) => c.url.endsWith('/v1/orders/' + orderId) && c.method === 'GET'));
  assert(!a.calls.some((c) => c.url === 'https://api.mercadopago.com/v1/orders'));
  const b = preparar({ p: { ...pagamento, criar: false } });
  assert.equal((await b.enviar({ acao: 'iniciar', token })).status, 202);
  assert(!b.calls.some((c) => c.url.includes('api.mercadopago.com')));
});
test('webhook exige HMAC válido e consulta estado autorizado, ignorando aprovação do corpo', async () => {
  assert.equal(await assinaturaValida(notificacao(), config.webhookSecret), true);
  const { handler, calls } = preparar({ webhook: true });
  assert.equal((await handler(notificacao({ 'x-signature': 'ts=1742505638683,v1=' + '0'.repeat(64) }))).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await handler(notificacao())).status, 200);
  assert.equal(calls.find((c) => c.url.endsWith('/registrar_pagamento_mp')).body.p_estado, 'aprovado');
});
test('notificação de outra aplicação ou valor divergente não libera a cozinha', async () => {
  for (const patch of [{ total_amount: '1.00' }, { integration_data: { application_id: '999' } }]) {
    const { handler, calls } = preparar({ webhook: true, o: { ...order, ...patch } });
    assert.equal((await handler(notificacao())).status, 422);
    assert(!calls.some((c) => c.url.endsWith('/registrar_pagamento_mp')));
  }
});
test('falha no provedor devolve erro para nova tentativa de webhook, sem detalhes sensíveis', async () => {
  const { handler } = preparar({ webhook: true, erroMP: true });
  const r = await handler(notificacao());
  assert.equal(r.status, 503);
  assert.equal(await r.text(), JSON.stringify({ codigo: 'pagamento_indisponivel' }));
});
test('credenciais ausentes, origens e ações inválidas falham fechadas', async () => {
  const a = preparar({ conf: { ...config, accessToken: '' } });
  assert.equal((await a.enviar({ acao: 'iniciar', token })).status, 503);
  assert.equal(a.calls.length, 0);
  const b = preparar();
  assert.equal((await b.enviar({ acao: 'iniciar', token }, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await b.enviar({ acao: 'iniciar', token: 'nao-e-uuid' })).status, 422);
  assert.equal((await b.enviar({ acao: 'aprovar', token })).status, 422);
});
test('rotina de recuperação não aceita chave pública; backend pode reconciliar', async () => {
  const { enviar, calls } = preparar();
  assert.equal((await enviar({ acao: 'reconciliar' }, { Authorization: 'Bearer anon' })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await enviar({ acao: 'reconciliar' }, { Authorization: 'Bearer ' + config.serviceKey })).status, 200);
});
test('estorno valida sessão e autorização administrativa antes de chamar o provedor', async () => {
  const a = preparar({ negado: true });
  assert.equal((await a.enviar({ acao: 'estornar', pedidoId: pagamento.pedido_id }, { Authorization: 'Bearer motoboy' })).status, 403);
  assert(!a.calls.some((c) => c.url.includes('/refund')));
  const b = preparar();
  assert.equal((await b.enviar({ acao: 'estornar', pedidoId: pagamento.pedido_id })).status, 401);
  const r = await b.enviar({ acao: 'estornar', pedidoId: pagamento.pedido_id }, { Authorization: 'Bearer admin' });
  assert.equal(r.status, 200);
  const refund = b.calls.find((c) => c.url.endsWith('/refund'));
  assert.notEqual(refund.headers['X-Idempotency-Key'], id);
  assert.match(refund.headers['X-Idempotency-Key'], /^[0-9a-f-]{36}$/);
});
test('retorno do navegador e pedido cancelado não representam autorização para pagar/preparar', () => {
  assert.equal(permitePagar({ status: 'novo', pagamentoOnline: 'pendente' }), true);
  assert.equal(permitePagar({ status: 'novo', pagamentoOnline: 'aprovado' }), false);
  assert.equal(permitePagar({ status: 'cancelado', pagamentoOnline: 'pendente' }), false);
});
test('eventos operacionais atrasados não desfazem estado financeiro e pagamento não desfaz preparo', () => {
  const preparo = { status: 'preparo', historico: [{}, {}], pagamentoOnline: 'pendente', pagamentoEm: null };
  const pago = { status: 'novo', historico: [{}], pagamentoOnline: 'aprovado', pagamentoEm: '2026-10-18T20:00:00Z' };
  assert.deepEqual(financeiroRecente(preparo, pago), { ...preparo, pagamentoOnline: 'aprovado', pagamentoEm: pago.pagamentoEm });
  assert.strictEqual(financeiroRecente(pago, preparo), pago);
  const estornado = { ...pago, pagamentoOnline: 'reembolsado', pagamentoEm: '2026-10-18T21:00:00Z' };
  assert.strictEqual(financeiroRecente(estornado, pago), estornado);
});
test('estorno não opera com outra conta/aplicação ou quando a API já mostra devolução', async () => {
  const a = preparar({ o: { ...order, user_id: '999' } });
  assert.equal((await a.enviar({ acao: 'estornar', pedidoId: pagamento.pedido_id }, { Authorization: 'Bearer admin' })).status, 422);
  assert(!a.calls.some((c) => c.url.endsWith('/refund')));
});
