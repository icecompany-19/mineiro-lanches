// Histórico do checkout neste aparelho. O telefone seleciona os dados locais;
// não concede acesso aos dados privados de clientes no servidor.
const CHAVE = 'mineiro:v2:cadastros';

export function normalizarTelefone(valor) {
  let d = String(valor || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d;
}

function enderecoValido(valor) {
  if (!valor || typeof valor.end !== 'string' || valor.end.trim().length < 5) return null;
  return {
    cep: String(valor.cep || '').replace(/\D/g, '').slice(0, 8),
    end: valor.end.trim().slice(0, 110),
    ref: String(valor.ref || '').trim().slice(0, 80)
  };
}

export function chaveEndereco(endereco) {
  const e = enderecoValido(endereco);
  if (!e) return '';
  return [e.cep, e.end, e.ref].map(v => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s,.]+/g, ' ').trim()).join('|');
}

export function criarHistoricoClientes(ler, gravar) {
  let cadastros = ler(CHAVE, {});
  if (!cadastros || typeof cadastros !== 'object' || Array.isArray(cadastros)) cadastros = {};

  function buscar(telefone) {
    const tel = normalizarTelefone(telefone);
    const perfil = /^\d{10,11}$/.test(tel) && cadastros[tel];
    if (!perfil || typeof perfil.nome !== 'string') return null;
    const enderecos = Array.isArray(perfil.enderecos) ? perfil.enderecos.map(enderecoValido).filter(Boolean) : [];
    return { nome: perfil.nome.slice(0, 60), enderecos };
  }

  function salvar({ telefone, nome, endereco }) {
    const tel = normalizarTelefone(telefone);
    if (!/^\d{10,11}$/.test(tel) || typeof nome !== 'string' || nome.trim().length < 2) return;
    const anterior = buscar(tel);
    let enderecos = anterior ? anterior.enderecos : [];
    const novo = enderecoValido(endereco);
    if (novo) enderecos = [novo, ...enderecos.filter(e => chaveEndereco(e) !== chaveEndereco(novo))];
    cadastros[tel] = { nome: nome.trim().slice(0, 60), enderecos };
    gravar(CHAVE, cadastros);
  }

  return { buscar, salvar };
}
