/* Mineiro Lanche · pedido de exemplo para a demonstração do painel (VITE_DEMO=1).
   Mesmo sorteio da prévia; sai sempre com origem 'exemplo' e "(exemplo)" no nome.
   Carregado só quando o painel pede exemplos (import dinâmico em store-supabase.js). */

const NOMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elaine',
  'Fábio',
  'Gabi',
  'Henrique',
  'Íris',
  'João',
  'Karen',
  'Lucas',
  'Marina',
  'Nando',
  'Olívia'
];
const REFRIS = ['Coca-Cola', 'Guaraná', 'Fanta'];
const sorteia = (a) => a[Math.floor(Math.random() * a.length)];

export function dadosDeExemplo(ML) {
  const C = ML.CONFIG;
  const esg = ML.store.esgotados();
  const todos = [];
  // o servidor recusa item esgotado (inclusive da equipe): sorteia só o que está disponível hoje
  C.categorias.forEach((c) => c.itens.forEach((p) => !esg[p.id] && todos.push(p)));
  const comida = todos.filter((p) => p.tipo !== 'bebida');
  const bebidas = todos.filter((p) => p.tipo === 'bebida');
  const itens = [];
  const k = 1 + Math.floor(Math.random() * 3);
  for (let j = 0; j < k; j++) {
    const p = sorteia(comida);
    const sel = { produtoId: p.id, qtd: Math.random() < 0.2 ? 2 : 1, prensado: Math.random() < 0.35, completo: true, adicionais: {} };
    if (p.ing && p.ing.length > 2 && Math.random() < 0.25) {
      sel.completo = false;
      sel.removidos = [sorteia(p.ing)];
    }
    if (ML.regras.podeCombo(p) && Math.random() < 0.45) sel.combo = { ativo: true, refri: sorteia(REFRIS) };
    if (ML.regras.podeAdicionais(p) && C.adicionais.length && Math.random() < 0.3) sel.adicionais[sorteia(C.adicionais).id] = 1;
    itens.push(sel);
  }
  if (bebidas.length && Math.random() < 0.3) itens.push({ produtoId: sorteia(bebidas).id, qtd: 1 });
  const modo = sorteia(['entrega', 'entrega', 'local']);
  return {
    origem: 'exemplo',
    cliente: { nome: sorteia(NOMES) + ' (exemplo)', telefone: '' },
    modo,
    endereco: modo === 'entrega' ? 'Endereço de exemplo, Suzano' : '',
    itens
  };
}
