/* S4 · hot dog (dono: site-II). Seção: section.s-dog (#s-dog), entre os marcadores [S4] do index.html.
   Hoje: foto do Dog com Doritos, 14 Doritos desenhados caindo conforme a rolagem (--p da seção) e o mini card do
   Hot Dog Pizza. (B14: Dog Max, 1/2/3 salsichas com odômetro de preço, "Adicionar" e o CBO Turbo.) */
import { registrar } from '../base.js';

const SIZES_DOG = '(min-width: 460px) 420px, calc(100vw - 40px)';
let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.s-dog');
  if (!sec || montada) return;
  montada = true;
  const P = ctx.ML.produtos;
  const dog = P['dog-doritos'];
  const foto = ctx.$('.dog-foto', sec);
  if (dog && foto) foto.insertAdjacentHTML('afterbegin', ctx.foto.visual(dog, '1080', null, { uso: SIZES_DOG }));
  const box = ctx.$('#doritos', sec);
  if (box) {
    let tri = '';
    for (let i = 0; i < 14; i++) {
      tri +=
        '<svg viewBox="0 0 30 28" data-dorito="' + i + '" style="left:' + (Math.random() * 90).toFixed(1) + '%"><path d="M15 2 28 26H2z" fill="#F08A1E" stroke="#B4560E" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="17" r="1" fill="#C4600F"/><circle cx="17" cy="20" r="1" fill="#C4600F"/><circle cx="15" cy="12" r=".9" fill="#C4600F"/></svg>';
    }
    box.innerHTML = tri;
  }
  const pz = P['dog-pizza'];
  const mini = ctx.$('#mini-pizza', sec);
  if (pz && mini) mini.innerHTML = ctx.foto.visual(pz, 'q') + '<span><strong>' + ctx.esc(pz.nome) + '</strong><span>' + ctx.brl(pz.preco) + '</span></span>';
  if (!box) return;
  const doritos = ctx.$$('[data-dorito]', box);
  // os Doritos caem conforme a seção atravessa a tela (p de 0 a 1), cada um numa fase
  registrar(sec, {
    quadro(p) {
      const alt = box.getBoundingClientRect().height;
      doritos.forEach((t, i) => {
        const fase = (p * 1.6 + i / 14) % 1;
        t.style.transform = 'translateY(' + (fase * (alt + 80) - 60).toFixed(1) + 'px) rotate(' + ((fase * 360 + i * 47) % 360).toFixed(0) + 'deg)';
      });
    }
  });
}
