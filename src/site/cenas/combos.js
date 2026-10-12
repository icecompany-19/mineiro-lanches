/* S5 · combos (dono: site-II). Seção: section.s-combos, entre os marcadores [S5] do index.html.
   Hoje: pilha de cartas presas (sticky) com Dilúvio, Casal, Gran Bacon com Coca e 2 Dogs; a carta coberta encolhe
   e escurece conforme a próxima sobe. (B15: neon "Qualquer lanche vira combo", ROTEIRO.combos, sem filter, sem Casal.) */
import { registrar } from '../base.js';

const SIZES_CARTA = '(min-width: 1180px) 600px, (min-width: 880px) 52vw, calc(100vw - 40px)';
const COMBOS = ['combo-diluvio', 'combo-casal', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos'];
let montada = false;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function iniciar(ctx) {
  const sec = ctx.$('.s-combos');
  if (!sec || montada) return;
  montada = true;
  const pilha = ctx.$('#pilha', sec);
  if (!pilha) return;
  const P = ctx.ML.produtos;
  pilha.innerHTML = COMBOS.filter((id) => P[id])
    .map((id, i) => {
      const p = P[id];
      return (
        '<article class="carta" style="--i:' + i + '">' + ctx.foto.visual(p, '1080', null, { uso: SIZES_CARTA }) +
        '<div class="carta-corpo"><strong>' + ctx.esc(p.nome) + '</strong><ul>' + (p.inclui || []).map((x) => '<li>' + ctx.esc(x) + '</li>').join('') + '</ul>' +
        (p.nota ? '<small style="color:var(--tinta-2)">' + ctx.esc(p.nota) + '</small>' : '') +
        '<div class="carta-pe"><span class="preco">' + ctx.brl(p.preco) + '</span><button type="button" class="btn btn-vermelho" data-abrir="' + id + '">' + ctx.ic('sacola') + 'Pedir</button></div></div></article>'
      );
    })
    .join('');
  const cartas = ctx.$$('.carta', pilha);
  // a carta coberta pela próxima encolhe e escurece (o "sob" vai de 0 a 1)
  registrar(sec, {
    quadro() {
      cartas.forEach((c, i) => {
        const prox = cartas[i + 1];
        if (!prox) {
          c.style.transform = '';
          c.style.filter = '';
          return;
        }
        const r1 = c.getBoundingClientRect();
        const rp = prox.getBoundingClientRect();
        const sob = clamp01((r1.bottom - rp.top) / r1.height);
        c.style.transform = 'scale(' + (1 - sob * 0.06).toFixed(3) + ')';
        c.style.filter = 'brightness(' + (1 - sob * 0.3).toFixed(3) + ')';
      });
    }
  });
}
