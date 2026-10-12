/* S1b · placa do cardápio (dono: site-II). Seção: section.s-placa, entre os marcadores [S1b] do index.html.
   Uma linha por categoria do CONFIG: rótulo, pontilhado e "a partir de R$ X", e o link #cardapio/<id> abre o cardápio
   rolado até a categoria (o clique é do app). O HTML traz a lista pronta, com o menor preço do CONFIG; aqui o preço é
   refeito em tempo de execução (preço do banco e itens esgotados: evento cardapio:esgotados). Nunca "a confirmar" nem R$ 0,00:
   item sem preço fica de fora da conta, e categoria toda esgotada diz "Esgotado hoje".
   A rolagem até a categoria é do app: irCategoria() espera o cardápio aparecer (também com transição de tela). */

let montada = false;

// o menor preço (> 0) entre os itens que dá para pedir agora
function textoDe(ctx, cat) {
  let menor = null;
  let comPreco = false;
  cat.itens.forEach((p) => {
    if (!ctx.ML.regras.temPreco(p) || !(p.preco > 0)) return;
    comPreco = true;
    if (!ctx.app.indisponivel(p.id) && (menor === null || p.preco < menor)) menor = p.preco;
  });
  if (menor !== null) return ['a partir de <span class="placa-valor">' + ctx.brl(menor) + '</span>', false];
  return [comPreco ? 'Esgotado hoje' : '', comPreco];
}

function atualizar(ctx, lista) {
  ctx.C.categorias.forEach((c) => {
    const preco = ctx.$('a[href="#cardapio/' + c.id + '"] .placa-preco', lista);
    if (!preco) return;
    const [html, esgotado] = textoDe(ctx, c);
    if (preco.innerHTML !== html) preco.innerHTML = html;
    preco.classList.toggle('esgotado', esgotado);
  });
}

export function iniciar(ctx) {
  const lista = ctx.$('.s-placa .placa-lista');
  if (!lista || montada) return;
  montada = true;
  atualizar(ctx, lista);
  ctx.ML.store.ouvir((ev) => {
    if (ev.tipo === 'cardapio:esgotados' || ev.tipo === 'cardapio:estado') atualizar(ctx, lista);
  });
}
