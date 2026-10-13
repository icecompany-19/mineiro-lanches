/* S8 · onde (dono: site-II). Seção: section.s-onde, entre os marcadores [S8] do index.html.
   A rota em SVG (de "você" até o truck) é desenhada pelo --p do mapa (stroke-dashoffset, em CSS) e o truck anda por
   getPointAtLength; o --p vai de 0 a 1 quando o mapa atravessa a tela (laço de base.js) e a rota fecha antes de o mapa
   sair (de .1 a .5). Com movimento reduzido a rota fica completa e o truck no fim. O endereço e o link do mapa vêm do
   CONFIG; os links de contato ([data-wa], [data-insta], [data-go]) são do src/app.js. Sem texto circular (D11). */
import { registrar } from '../base.js';

let montada = false;
const fim = (p) => Math.min(1, Math.max(0, (p - 0.1) * 2.5));

export function iniciar(ctx) {
  const sec = ctx.$('.s-onde');
  if (!sec || montada) return;
  montada = true;
  const C = ctx.C;
  ctx.$('#onde-end', sec).textContent = C.enderecoPartes ? [C.enderecoPartes.rua, C.enderecoPartes.bairro, C.enderecoPartes.cidade + '/' + C.enderecoPartes.uf].join('\u00a0· ') : C.endereco;
  ctx.$('#onde-mapa', sec).href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(C.endereco);
  const rota = ctx.$('#onde-rota', sec);
  const truck = ctx.$('#onde-truck', sec);
  const total = rota.getTotalLength();
  const andar = (p) => {
    const q = rota.getPointAtLength(fim(p) * total);
    truck.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px)';
  };
  andar(1);
  registrar(ctx.$('.onde-mapa', sec), { quadro: andar });
}
