/* S2 · monte seu combo (dono: site-I). Seção: section.s-monte, entre os marcadores [S2] do index.html.
   Hoje: escolhe o lanche (foto -q nos botões), liga o combo (batata e lata entram), o preço rola e "Escolher e
   adicionar" abre a ficha com o combo como está. (B6/B7 trocam por "Pão seladinho na chapa", presa à rolagem.) */

const LANCHES_MONTE = ['gran-bacon-onion', 'gran-crispy', 'gran-egg-bacon', 'gran-chicken', 'gran-burger', 'gran-burger-bacon', 'gran-salada', 'dog-doritos', 'dog-pizza'];
const SIZES_MONTE = '(min-width: 520px) 300px, 58vw';
const monte = { id: 'gran-burger', combo: false };
let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.s-monte');
  if (!sec || montada) return;
  montada = true;
  const P = ctx.ML.produtos;
  const lista = LANCHES_MONTE.filter((id) => P[id] && P[id].foto);
  ctx.$('#monte-escolha', sec).innerHTML = lista
    .map((id) => '<button type="button" data-monte="' + id + '" aria-pressed="' + (id === monte.id) + '"><img ' + ctx.foto.atr(P[id].foto, 'q') + ' alt="">' + ctx.esc(P[id].nome) + '</button>')
    .join('');
  render(ctx, sec, true);
  sec.addEventListener('click', (e) => {
    const t = e.target.closest('[data-monte],#monte-switch,#monte-add');
    if (!t) return;
    if (t.hasAttribute('data-monte')) {
      monte.id = t.getAttribute('data-monte');
      render(ctx, sec);
    } else if (t.id === 'monte-switch') {
      monte.combo = !monte.combo;
      render(ctx, sec);
    } else ctx.app.abrirFicha(monte.id, { combo: monte.combo, origem: ctx.$('#monte-lanche', sec) });
  });
}

function render(ctx, sec, primeira) {
  const p = ctx.ML.produtos[monte.id];
  const C = ctx.C;
  const img = ctx.$('#monte-img', sec);
  ctx.foto.trocar(img, p.foto, '540', SIZES_MONTE);
  img.alt = 'Foto do ' + p.nome;
  ctx.$('#monte-lanche', sec).className = 'monte-lanche foto';
  ctx.$('#monte', sec).classList.toggle('combo', monte.combo);
  ctx.$('#monte-switch', sec).setAttribute('aria-checked', String(monte.combo));
  ctx.$('#monte-conta', sec).textContent = p.nome + ' ' + ctx.brl(p.preco) + (monte.combo ? ' + combo ' + ctx.brl(C.regras.combo.preco) : '');
  const v = p.preco + (monte.combo ? C.regras.combo.preco : 0);
  const preco = ctx.$('#monte-preco', sec);
  if (primeira) {
    preco.textContent = ctx.brl(v);
    preco.setAttribute('data-v', v);
  } else ctx.app.contar(preco, v);
  ctx.$$('[data-monte]', sec).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-monte') === monte.id)));
}
