export const ESTADOS_PAGAMENTO = {
  pendente: 'Aguardando pagamento',
  aprovado: 'Pagamento aprovado',
  recusado: 'Pagamento recusado',
  cancelado: 'Pagamento cancelado ou expirado',
  reembolsado: 'Pagamento reembolsado',
  parcialmente_reembolsado: 'Pagamento parcialmente reembolsado',
  em_disputa: 'Pagamento em contestação',
  revisao: 'Pagamento em revisão'
};
export function checkoutSeguro(valor) {
  const u = new URL(valor);
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'www.mercadopago.com.br' ||
    u.username ||
    u.password ||
    !u.pathname.startsWith('/checkout/')
  )
    throw new Error('Endereço de pagamento inválido');
  return u.href;
}
export function textoPagamento(estado) {
  return ESTADOS_PAGAMENTO[estado] || 'Pagamento em verificação';
}
export function permitePagar(pedido) {
  return pedido?.status === 'novo' && pedido.pagamentoOnline === 'pendente';
}
// O histórico operacional não muda ao receber um pagamento; sua versão é independente.
export function financeiroRecente(pedido, outro) {
  const em = (p) => (p?.pagamentoEm ? Date.parse(p.pagamentoEm) : -Infinity);
  return em(outro) > em(pedido) ? { ...pedido, pagamentoOnline: outro.pagamentoOnline, pagamentoEm: outro.pagamentoEm } : pedido;
}
