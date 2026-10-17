/* Mineiro Lanche · entregador: as duas chamadas ao banco (supabase/migrations/20261017000001_motoboy.sql).
   - confirmarEntrega(sb, id): marca o pedido como entregue. Idempotente no servidor: ler a comanda de novo devolve
     jaEntregue: true, sem erro (por isso "tentar de novo" depois de uma falha de rede é seguro).
   - entregasEmRota(sb): pedidos de entrega em rota do dia, para o plano B sem câmera.
   Erros: raise exception '<codigo>' (P0001) vira Error com .codigo e .mensagem (texto para o entregador). Qualquer
   outra falha (sem rede, tempo esgotado, 5xx) é 'rede'; token recusado é 'sessao'. */

const TEMPO_LIMITE = 15000; // sem resposta em 15 s conta como falta de rede

export const MENSAGENS = {
  sem_permissao: 'Este usuário não tem permissão para confirmar entregas',
  dados_invalidos: 'Esse código não é de um pedido',
  nao_encontrado: 'Pedido não encontrado',
  nao_e_entrega: 'Esse pedido é de retirada',
  pedido_cancelado: 'Pedido cancelado',
  transicao_invalida: 'Ainda não foi aceito pela cozinha',
  sessao: 'Sua sessão expirou. Toque em Sair e entre de novo',
  rede: 'Sem conexão com o servidor. Confira a internet e tente de novo'
};

// códigos que o banco manda como texto da exceção (docs/CONTRATO-API.md)
const CODIGOS = ['sem_permissao', 'dados_invalidos', 'nao_encontrado', 'nao_e_entrega', 'pedido_cancelado', 'transicao_invalida'];

export function codigoDoErro(e) {
  if (!e) return 'rede';
  if (e.codigo) return e.codigo;
  const m = String(e.message || '').trim();
  if (CODIGOS.indexOf(m) >= 0) return m;
  if (/^PGRST30/.test(e.code || '') || /jwt/i.test(m)) return 'sessao';
  if (e.code === '42501') return 'sem_permissao';
  if (e.code === '22P02') return 'dados_invalidos'; // uuid malformado
  return 'rede';
}

function erroCom(codigo, causa) {
  const e = new Error(codigo);
  e.codigo = codigo;
  e.mensagem = MENSAGENS[codigo] || MENSAGENS.rede;
  e.causa = causa;
  return e;
}

async function chamar(sb, nome, args) {
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), TEMPO_LIMITE);
  try {
    const { data, error } = await sb.rpc(nome, args || {}).abortSignal(ctrl.signal);
    if (error) throw erroCom(codigoDoErro(error), error);
    return data;
  } catch (e) {
    throw e && e.codigo ? e : erroCom('rede', e);
  } finally {
    clearTimeout(relogio);
  }
}

// o que a tela usa de um pedido (entrega_json do banco): nunca itens nem token
function pedidoDe(p) {
  p = p || {};
  const cli = p.cliente || {};
  return {
    id: p.id,
    numero: p.numero == null ? null : Number(p.numero),
    status: p.status || '',
    nome: String(cli.nome || ''),
    telefone: String(cli.telefone || ''),
    endereco: String(p.endereco || ''),
    referencia: String(p.referencia || ''),
    obs: String(p.obs || ''),
    total: p.total == null ? null : Number(p.total)
  };
}

// → { ok, jaEntregue, pedido }
export async function confirmarEntrega(sb, id) {
  const r = await chamar(sb, 'confirmar_entrega', { p_id: id });
  if (!r || typeof r !== 'object') throw erroCom('rede', new Error('resposta vazia'));
  return { ok: r.ok !== false, jaEntregue: !!r.jaEntregue, pedido: pedidoDe(r.pedido) };
}

// → [pedido]
export async function entregasEmRota(sb) {
  const lista = await chamar(sb, 'entregas_em_rota');
  return (Array.isArray(lista) ? lista : []).map(pedidoDe);
}
