// Checkout Pro via Orders API. Nenhum dado de cartão passa pela loja.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ORDER_ID = /^ORD[A-Z0-9]{10,80}$/i;
export function centavos(valor) {
  const s = String(valor);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new Error('valor_invalido');
  const [inteiro, decimal = ''] = s.split('.');
  return Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'));
}
export function urlCheckout(valor) {
  const u = new URL(valor);
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'www.mercadopago.com.br' ||
    u.username ||
    u.password ||
    !u.pathname.startsWith('/checkout/')
  )
    throw new Error('checkout_invalido');
  return u.href;
}
export function criarOrder(pagamento, site) {
  const retorno = new URL(site);
  if (retorno.protocol !== 'https:' || retorno.pathname !== '/' || retorno.search || retorno.hash || retorno.username || retorno.password)
    throw new Error('configuracao');
  retorno.hash = 'pedido/' + pagamento.token;
  const items = pagamento.itens.map((i) => ({
    external_code: i.produtoId,
    title: i.nome,
    quantity: i.qtd,
    unit_price: (centavos(i.precoUnit) / 100).toFixed(2)
  }));
  if (pagamento.taxaEntrega > 0)
    items.push({
      external_code: 'entrega',
      title: 'Taxa de entrega',
      quantity: 1,
      unit_price: (centavos(pagamento.taxaEntrega) / 100).toFixed(2)
    });
  if (
    !items.length ||
    items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1) ||
    items.reduce((s, i) => s + centavos(i.unit_price) * i.quantity, 0) !== centavos(pagamento.total)
  )
    throw new Error('valor_invalido');
  return {
    type: 'online',
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    total_amount: (centavos(pagamento.total) / 100).toFixed(2),
    external_reference: pagamento.id,
    expiration_time: 'PT30M',
    payer: { email: pagamento.email },
    items,
    description: 'Pedido Mineiro Lanche #' + pagamento.numero,
    config: {
      online: { success_url: retorno.href, failure_url: retorno.href, pending_url: retorno.href, auto_return: 'approved' },
      payment_method: { not_allowed_types: ['ticket', 'atm'], max_installments: 1 }
    }
  };
}
export function conferirOrder(order, pagamento, conta, ambiente) {
  if (
    !ORDER_ID.test(order.id || '') ||
    order.external_reference !== pagamento.id ||
    String(order.user_id) !== String(conta) ||
    order.currency !== 'BRL' ||
    order.type !== 'online' ||
    order.processing_mode !== 'manual' ||
    centavos(order.total_amount) !== centavos(pagamento.total) ||
    (pagamento.order_id && pagamento.order_id !== order.id) ||
    order.id.toUpperCase().startsWith('ORDTST') !== (ambiente === 'test') ||
    !Number.isFinite(Date.parse(order.last_updated_date))
  )
    throw new Error('pagamento_divergente');
  let estado = 'pendente';
  if (order.status === 'processed' && order.status_detail === 'accredited') {
    if (centavos(order.total_paid_amount) !== centavos(pagamento.total)) throw new Error('pagamento_divergente');
    estado = 'aprovado';
  } else if (order.status === 'refunded' || order.status_detail === 'refunded') estado = 'reembolsado';
  else if (order.status_detail === 'partially_refunded') estado = 'parcialmente_reembolsado';
  else if (order.status === 'failed') estado = 'recusado';
  else if (order.status === 'canceled') estado = 'cancelado';
  else if (order.status === 'charged_back' || order.status_detail === 'charged_back') estado = 'em_disputa';
  else if (!['created', 'processing', 'action_required'].includes(order.status)) estado = 'revisao';
  return {
    p_id: pagamento.id,
    p_order_id: order.id,
    p_estado: estado,
    p_em: order.last_updated_date,
    p_checkout: order.checkout_url ? urlCheckout(order.checkout_url) : null,
    p_status: String(order.status).slice(0, 80),
    p_detalhe: String(order.status_detail || '').slice(0, 100)
  };
}
export async function assinaturaValida(req, segredo) {
  if (!segredo) return false;
  const id = new URL(req.url).searchParams.get('data.id');
  const requestId = req.headers.get('x-request-id');
  const assinatura = req.headers.get('x-signature') || '';
  const ts = assinatura.match(/(?:^|,)\s*ts=(\d{10,13})(?:,|$)/)?.[1];
  const hashes = [...assinatura.matchAll(/(?:^|,)\s*v1=([a-f0-9]{64})(?=,|$)/gi)].map((m) => m[1]);
  if (!id || !ORDER_ID.test(id) || !requestId || requestId.length > 200 || !ts || !hashes.length) return false;
  // O ts faz parte do HMAC. Reentregas legítimas podem chegar dias depois: idempotência no banco protege replay.
  const modelo = `id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const hash of hashes) {
    const bytes = Uint8Array.from(hash.match(/../g), (b) => parseInt(b, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(modelo))) return true;
  }
  return false;
}
