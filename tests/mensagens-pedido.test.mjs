import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarCore } from '../scripts/gerar-seed.mjs';
const { ML, contexto } = carregarCore();
contexto.URL = URL;
contexto.location.origin = 'https://mineirolanches.store';
const token = '71000000-0000-4000-8000-000000000001';
const pedido = {
  id: '72000000-0000-4000-8000-000000000001',
  token,
  numero: 87,
  status: 'preparo',
  modo: 'entrega',
  cliente: { nome: 'Ana' },
  endereco: 'Rua Exemplo, 10',
  total: 30,
  taxaEntrega: 6,
  itens: [{ qtd: 1, nome: 'Lanche', subtotal: 24, resumo: 'Completo' }]
};
const link = `https://mineirolanches.store/#pedido/${token}`;
test('confirmação usa o token de acompanhamento do pedido e a raiz pública, sem ID interno', () => {
  const texto = ML.whatsapp.confirmacao(pedido, 'https://mineirolanches.store/painel/?aba=pedidos#outro');
  assert(texto.includes(link));
  assert(texto.includes('pedido #0087 está confirmado'));
  assert(!texto.includes(pedido.id));
  assert(!texto.includes('/motoboy/'));
  assert(!texto.includes('/painel/'));
});
test('cada pedido recebe seu próprio link; receber não afirma que a cozinha já confirmou', () => {
  const outro = { ...pedido, numero: 88, token: '71000000-0000-4000-8000-000000000002', status: 'novo' };
  const texto = ML.whatsapp.confirmacao(outro);
  assert(texto.includes('#0088 foi recebido'));
  assert(!texto.includes('está confirmado'));
  assert(texto.includes(outro.token));
  assert(!texto.includes(token));
});
test('mensagem distingue entrega pronta, saída e retirada, preservando o acompanhamento', () => {
  for (const [campos, frase] of [
    [{ status: 'pronto' }, 'aguardando saída para entrega'],
    [{ status: 'rota' }, 'saiu para entrega'],
    [{ status: 'pronto', modo: 'retirada' }, 'pronto para retirada']
  ]) {
    const texto = ML.whatsapp.confirmacao({ ...pedido, ...campos });
    assert(texto.includes(frase));
    assert(texto.includes(link));
  }
});
test('mensagem completa conserva o link mesmo com itens e observações maiores que o limite', () => {
  const texto = ML.whatsapp.mensagem({ ...pedido, obs: 'Observação '.repeat(500) });
  assert(texto.length <= 1500);
  assert(texto.endsWith(link));
});
test('pedido não gravado ou token inválido não gera link fictício no plano B', () => {
  for (const valor of [null, '', 'token', '../painel/', pedido.id + '?outro=1']) {
    const p = { ...pedido, token: valor };
    assert.equal(ML.links.pedido(p), '');
    assert(!ML.whatsapp.mensagem(p).includes('/#pedido/'));
  }
  assert.equal(ML.links.pedido(pedido, 'javascript:alert(1)'), '');
  assert.equal(ML.links.pedido(pedido, 'https://usuario:senha@mineirolanches.store'), '');
});
