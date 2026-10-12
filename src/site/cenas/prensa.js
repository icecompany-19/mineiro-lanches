/* S3 · prensado ou não? (dono: site-II). Seção: section.s-prensa, entre os marcadores [S3] do index.html.
   Hoje: a régua #f-prensa (0 a 100) e o arraste na ilustração descem a chapa; a partir de 85 está prensado e sobe
   vapor. (B13: foto nova do X-Churrasco, nunca deformada, e a prensa em CSS.) */

let montada = false;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function iniciar(ctx) {
  const sec = ctx.$('.s-prensa');
  if (!sec || montada) return;
  montada = true;
  const svg = ctx.$('#prensa-ilustra', sec);
  const regua = ctx.$('#f-prensa', sec);
  const estado = ctx.$('#prensa-estado', sec);
  if (!svg || !regua) return;
  const aplicar = (v) => {
    const t = (v / 100) * 76;
    ctx.$('.placa-cima', svg).style.transform = 'translateY(' + t.toFixed(1) + 'px)';
    const esmaga = t > 46 ? (236 - (94 + t)) / 96 : 1;
    ctx.$('.lanche', svg).style.transform = 'scaleY(' + esmaga.toFixed(3) + ')';
    const prensado = v >= 85;
    svg.classList.toggle('prensado', prensado);
    if (estado) estado.textContent = prensado ? 'Prensado! Não cobramos para prensar.' : v > 10 ? 'Prensando…' : 'Não prensado';
  };
  regua.addEventListener('input', () => aplicar(+regua.value));
  // arraste na ilustração: descer o dedo desce a chapa
  let y0 = null;
  let v0 = 0;
  svg.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    v0 = +regua.value;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const v = clamp(v0 + ((e.clientY - y0) / svg.getBoundingClientRect().height) * 160, 0, 100);
    regua.value = v;
    aplicar(v);
  });
  svg.addEventListener('pointerup', () => {
    y0 = null;
  });
  aplicar(0);
}
