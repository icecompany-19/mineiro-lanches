/* S1b · placa do cardápio (dono: site-II). Seção: section.s-placa, entre os marcadores [S1b] do index.html.
   Uma linha por categoria do CONFIG: rótulo, pontilhado e "a partir de R$ X", e o link #cardapio/<id> abre o cardápio
   rolado até a categoria (o clique é do app). O HTML traz a lista pronta, com o menor preço do CONFIG; aqui o preço é
   refeito em tempo de execução (preço do banco e itens esgotados: evento cardapio:esgotados). Nunca "a confirmar" nem R$ 0,00:
   item sem preço fica de fora da conta, e categoria toda esgotada diz "Esgotado hoje".
   Rolagem até a categoria: com a transição de visualização (sem movimento reduzido) o app troca de tela no quadro
   seguinte e o irCategoria() dele roda antes disso, com o cardápio ainda escondido. Por isso, depois do clique, esta
   cena espera o site sair de cena e pede o irCategoria() de novo. */

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

// depois do clique o app troca de tela (talvez numa transição de visualização): rola quando o cardápio já está na tela
function rolarQuandoAbrir(ctx, id) {
  let quadros = 0;
  const espera = () => {
    if (ctx.raiz.hidden) ctx.app.irCategoria(id);
    else if (++quadros < 60) requestAnimationFrame(espera);
  };
  requestAnimationFrame(espera);
}

export function iniciar(ctx) {
  const lista = ctx.$('.s-placa .placa-lista');
  if (!lista || montada) return;
  montada = true;
  atualizar(ctx, lista);
  lista.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#cardapio/"]');
    if (a && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) rolarQuandoAbrir(ctx, a.getAttribute('href').split('/')[1]);
  });
  ctx.ML.store.ouvir((ev) => {
    if (ev.tipo === 'cardapio:esgotados' || ev.tipo === 'cardapio:estado') atualizar(ctx, lista);
  });
}
