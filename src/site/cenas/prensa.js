/* S3 · prensado ou não? (dono: site-II). Seção: section.s-prensa, entre os marcadores [S3] do index.html.
   A foto 'nova' do primeiro de ROTEIRO.prensado (hoje o X-Churrasco; o HTML já traz essa foto) fica parada e inteira:
   nada de scaleY nela. A prensa é CSS (chapa de inox em degradê e cabo) e desce por translateY conforme --v (0 a 1, o
   valor da régua #f-prensa / 100); a partir de 85 está prensado: sobe vapor e aparece "Tsss…". Dá para arrastar a
   chapa e o cabo (o quadro anda junto com a régua). O texto vem de CONFIG.regras.prensado.texto.
   Com movimento reduzido o CSS mostra os dois estados lado a lado, parados (a segunda cena do HTML). */
import { ROTEIRO, primeiroComFotoNova } from '../roteiro.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const USO = '(min-width:880px) 440px, 90vw'; // o quadro tem no máximo 440 px
let montada = false;
let soltar = null;

// troca a foto das duas cenas se o roteiro apontar para outro produto que o do HTML
function foto(ctx, sec) {
  const id = primeiroComFotoNova(ROTEIRO.prensado);
  if (!id) {
    sec.classList.add('sem-foto'); // sem foto nova, a seção fica só com o texto
    return;
  }
  const palcos = ctx.$$('.prensa-palco', sec);
  if (palcos[0].getAttribute('data-prensa-de') === id) return;
  const p = ctx.ML.produtos[id];
  palcos.forEach((palco, i) => {
    palco.querySelector('.foto').outerHTML = ctx.foto.visual(p, '540', 'prensa-foto', { uso: USO, carga: 'lazy' });
    palco.setAttribute('data-prensa-de', id);
    if (i) ctx.$('img', palco).alt = ''; // a cena fixa é só desenho (aria-hidden)
  });
  ctx.foto.marcarCarregadas(sec);
}

export function iniciar(ctx) {
  const sec = ctx.$('.s-prensa');
  if (!sec || montada) return;
  const palco = ctx.$('#prensa-palco', sec);
  const regua = ctx.$('#f-prensa', sec);
  if (!palco || !regua) return;
  montada = true;
  const estado = ctx.$('#prensa-estado', sec);
  const aviso = ctx.$('#prensa-aviso', sec);
  const texto = ctx.C.regras.prensado.texto;
  if (aviso) aviso.textContent = 'Avise antes: ' + texto.charAt(0).toLowerCase() + texto.slice(1) + '.';
  foto(ctx, sec);

  const aplicar = (v) => {
    palco.style.setProperty('--v', (v / 100).toFixed(3));
    const prensado = v >= 85;
    palco.classList.toggle('prensado', prensado);
    if (estado) estado.textContent = prensado ? 'Prensado!' : v > 10 ? 'Prensando…' : 'Não prensado';
  };
  regua.addEventListener('input', () => aplicar(+regua.value));

  // arraste pela chapa ou pelo cabo: a chapa anda 20% da altura do quadro, então o dedo anda junto com ela
  let y0 = null;
  let v0 = 0;
  soltar = () => {
    y0 = null;
    palco.classList.remove('arrasta');
  };
  palco.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.prensa-chapa, .prensa-cabo')) return;
    y0 = e.clientY;
    v0 = +regua.value;
    palco.classList.add('arrasta');
    e.target.setPointerCapture(e.pointerId);
  });
  palco.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const v = clamp(v0 + ((e.clientY - y0) / (palco.clientHeight * 0.2)) * 100, 0, 100);
    regua.value = v;
    aplicar(v);
  });
  palco.addEventListener('pointerup', soltar);
  palco.addEventListener('pointercancel', soltar);
  aplicar(+regua.value);
}

// saiu do site com a chapa na mão: solta
export function parar() {
  if (soltar) soltar();
}
