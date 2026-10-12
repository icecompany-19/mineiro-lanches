/* S1 · fitas de letreiro (dono: site-II). Seção: div.fitas, entre os marcadores [S1] do index.html.
   Hoje: duas faixas que correm em laço (CSS, conteúdo triplicado) e aceleram com a velocidade da rolagem (1 a 6×).
   (B11 troca os textos: produtos com foto nova, combo e horário do CONFIG.) */
import { registrar } from '../base.js';

let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.fitas');
  if (!sec || montada) return;
  montada = true;
  const estrela = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-estrela"/></svg>';
  const faixa = (lista) => {
    const b = lista.map((n) => '<span class="fita__item">' + ctx.esc(n) + estrela + '</span>').join('');
    return b + b + b;
  };
  const a = ctx.$('[data-fita="a"]', sec);
  const b = ctx.$('[data-fita="b"]', sec);
  if (a) a.innerHTML = faixa(['Hambúrguer artesanal', 'Hot dog com Doritos', 'Consumo no local', 'Entregas em Suzano e região', 'Prensado sem custo']);
  if (b) b.innerHTML = faixa(['Gran Bacon Onion', 'Gran Crispy', 'Combo Dilúvio', 'Dog com Doritos', 'Hot Dog Pizza', 'Combo Casal']);
  const trilhos = ctx.$$('.fita__trilho', sec);
  // a velocidade da rolagem (px por quadro, suavizada no laço da base) vira o playbackRate da animação CSS
  registrar(sec, {
    quadro(p, info) {
      trilhos.forEach((tr) => {
        const an = tr.getAnimations && tr.getAnimations()[0];
        if (an) an.playbackRate = 1 + Math.min(info.vel / 6, 5);
      });
    }
  });
}
