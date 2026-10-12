/* S0 · herói (dono: site-I). Seção: section.s-hero, entre os marcadores [S0] do index.html.
   Hoje: o título "MINEIRO LANCHE" cai letra por letra; no palco, os recortes seguem o mouse e a rolagem (paralaxe).
   (B3/B4 trocam isto pelo herói "Acende": parede, placa, 3 títulos por estado da luz.) */
import { embrulharLetras, registrar, pedirQuadro } from '../base.js';

let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.s-hero');
  if (!sec || montada) return;
  montada = true;
  // letras do título a partir do texto do HTML (o h1 já tem aria-label)
  embrulharLetras(ctx.$('#s-tit', sec));
  const palco = ctx.$('#palco', sec);
  if (!palco) return;
  // os recortes são lazy no HTML (quem chega pelo QR não baixa); com o site na tela, vêm já
  if (!ctx.raiz.hidden) ctx.$$('img[loading="lazy"]', palco).forEach((i) => (i.loading = 'eager'));
  palco.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = palco.getBoundingClientRect();
    palco.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    palco.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    pedirQuadro();
  });
  const recortes = ctx.$$('.recorte', palco);
  // paralaxe: cada recorte anda conforme a profundidade (data-prof), o ponteiro e a rolagem
  registrar(sec, {
    quadro(p, info) {
      const mx = +palco.style.getPropertyValue('--mx') || 0;
      const my = +palco.style.getPropertyValue('--my') || 0;
      recortes.forEach((o) => {
        const prof = +o.getAttribute('data-prof');
        o.style.transform = 'translate(' + (mx * 28 * prof).toFixed(1) + 'px,' + (my * 28 * prof - info.y * 0.1 * prof).toFixed(1) + 'px)';
      });
    }
  });
}
