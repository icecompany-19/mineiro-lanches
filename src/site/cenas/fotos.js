/* S7 · parede de fotos (dono: site-I). Seção: section.s-galeria e dialog#luz-caixa, entre os marcadores [S7] do
   index.html. Hoje: todas as fotos do fotos.json em alvenaria (#mosaico, button[data-ampliar]); o toque abre a foto
   ampliada com nome, preço e "Pedir" (abre a ficha). (B9: só fotos 'nova', sem repetir arquivo, foco de luz.) */

const SIZES_MOSAICO = '(min-width: 1180px) 276px, (min-width: 880px) calc(25vw - 19px), calc(50vw - 26px)';
const SIZES_LUZ = '(min-width: 750px) 720px, 96vw';
let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.s-galeria');
  if (!sec || montada) return;
  montada = true;
  const mosaico = ctx.$('#mosaico', sec);
  if (!mosaico) return;
  // data-ampliar (não data-luz: o <html> leva data-luz com o estado do truck)
  mosaico.innerHTML = ctx.foto
    .slugs()
    .map((slug) => {
      const p = ctx.foto.produtoDe(slug);
      return '<button type="button" data-ampliar="' + slug + '" aria-label="Ampliar foto' + (p ? ' do ' + ctx.esc(p.nome) : '') + '"><img ' + ctx.foto.atr(slug, '540', SIZES_MOSAICO) + ' alt="' + (p ? 'Foto do ' + ctx.esc(p.nome) : '') + '"></button>';
    })
    .join('');
  const lz = ctx.$('#luz-caixa');
  if (!lz) return;
  mosaico.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ampliar]');
    if (b) ampliar(ctx, lz, b.getAttribute('data-ampliar'));
  });
  lz.addEventListener('click', (e) => {
    // toque fora da foto (no fundo do dialog) fecha
    if (e.target === lz) {
      lz.close();
      return;
    }
    const t = e.target.closest('[data-fechar-luz],#luz-pedir');
    if (!t) return;
    const id = t.id === 'luz-pedir' ? t.getAttribute('data-produto') : null;
    lz.close();
    if (id) ctx.app.abrirFicha(id);
  });
}

function ampliar(ctx, lz, slug) {
  const p = ctx.foto.produtoDe(slug);
  const img = ctx.$('#luz-img', lz);
  ctx.foto.trocar(img, slug, '1080', SIZES_LUZ);
  img.alt = p ? 'Foto do ' + p.nome : '';
  ctx.$('#luz-nome', lz).textContent = p ? p.nome + ' · ' + ctx.brl(p.preco) : '';
  const pedir = ctx.$('#luz-pedir', lz);
  pedir.setAttribute('data-produto', p ? p.id : '');
  pedir.hidden = !p;
  if (lz.showModal) lz.showModal();
  else lz.setAttribute('open', '');
}

// a view do site saiu de cena (voltar do navegador, link para a bio): a foto ampliada fecha junto
export function parar() {
  const lz = document.getElementById('luz-caixa');
  if (lz && lz.open) lz.close();
}
