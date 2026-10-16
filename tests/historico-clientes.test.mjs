import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarHistoricoClientes, normalizarTelefone } from '../src/lib/historico-clientes.js';

function memoria(inicial = {}) {
  let dados = inicial;
  return criarHistoricoClientes(() => dados, (_chave, valor) => { dados = JSON.parse(JSON.stringify(valor)); });
}
const casa = { cep: '08674-185', end: 'Rua das Flores, 100', ref: 'Casa' };

test('telefones com máscara, +55 e zero inicial identificam o mesmo cliente', () => {
  const historico = memoria();
  historico.salvar({ telefone: '(11) 98765-4321', nome: 'Marina', endereco: casa });
  assert.equal(historico.buscar('+55 (11) 98765-4321').nome, 'Marina');
  assert.equal(historico.buscar('011987654321').nome, 'Marina');
  assert.equal(normalizarTelefone('+55 11 98765-4321'), '11987654321');
  assert.equal(historico.buscar('11900000000'), null);
});

test('um segundo endereço conserva o primeiro e passa a ser o preferido', () => {
  const historico = memoria();
  historico.salvar({ telefone: '11987654321', nome: 'Marina', endereco: casa });
  historico.salvar({ telefone: '11987654321', nome: 'Marina Souza', endereco: { ...casa, end: 'Rua das Flores, 200' } });
  const perfil = historico.buscar('11987654321');
  assert.equal(perfil.nome, 'Marina Souza');
  assert.deepEqual(perfil.enderecos.map(e => e.end), ['Rua das Flores, 200', 'Rua das Flores, 100']);
});

test('endereços repetidos não duplicam; apartamentos diferentes são mantidos', () => {
  const historico = memoria();
  const salvar = endereco => historico.salvar({ telefone: '11987654321', nome: 'Marina', endereco });
  salvar(casa);
  salvar({ ...casa, cep: '08674185', end: ' RUA DAS FLORES, 100 ', ref: 'casa' });
  assert.equal(historico.buscar('11987654321').enderecos.length, 1);
  salvar({ ...casa, ref: 'Apartamento 12' });
  assert.equal(historico.buscar('11987654321').enderecos.length, 2);
});

test('os dados de um telefone não alteram os de outro; pedido local conserva os endereços', () => {
  const historico = memoria();
  historico.salvar({ telefone: '11987654321', nome: 'Marina', endereco: casa });
  historico.salvar({ telefone: '11911112222', nome: 'João', endereco: { ...casa, end: 'Rua do João, 2' } });
  historico.salvar({ telefone: '11987654321', nome: 'Marina', endereco: null });
  assert.equal(historico.buscar('11987654321').enderecos[0].end, casa.end);
  assert.equal(historico.buscar('11911112222').enderecos[0].end, 'Rua do João, 2');
});

test('histórico inválido e cadastro incompleto não impedem um novo pedido', () => {
  for (const inicial of [null, [], 'corrompido', { '11987654321': { nome: 'Marina', enderecos: [null, {}] } }]) {
    const historico = memoria(inicial);
    historico.salvar({ telefone: '123', nome: 'Marina', endereco: casa });
    assert.equal(historico.buscar('123'), null);
    historico.salvar({ telefone: '11987654321', nome: 'Marina', endereco: casa });
    assert.equal(historico.buscar('11987654321').enderecos.length, 1);
  }
});
