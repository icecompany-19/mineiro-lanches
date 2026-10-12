/* S7 · parede de fotos (dono: site-I). Seção: section.s-galeria e dialog#luz-caixa, entre os marcadores [S7] do
   index.html. O HTML traz o título, o #mosaico vazio e a caixa da foto ampliada; aqui:
   - o mosaico nasce do fotos.json (ML.app.foto): SÓ foto de origem 'nova', um quadro por arquivo (o dog-max serve ao Médio,
     ao Max e ao Super e aparece 1 vez, com o nome do produto dono da foto, "Hot Dog Max"), nunca a 'antiga' (docs/DIRECAO-VISUAL.md
     2.3 e 6.2, S7). Os 6 destaques da bio (D9) vêm na frente; as fotos novas que chegarem depois entram no fim, sozinhas;
   - cada quadro é um button[data-ampliar] com a foto -540 (lazy), o foco do fotos.json em object-position, nome e preço no pé;
     o preço é um [data-preco-de], então o app o refaz quando o banco manda outro valor ("Preço a confirmar" sem preço);
   - o toque abre #luz-caixa com a foto grande, nome, preço e "Pedir" (abre a ficha). Sem lightbox novo: é a caixa de antes.
   O resto (alvenaria por columns, foco de luz, rotação de ±1,2° e paralaxe por animation-timeline) é do CSS. */

// o que a página mostra por quadro: 2 colunas no celular, 3 a partir de 600 px e 4 a partir de 880 px (o mesmo cálculo do CSS), então o srcset escolhe o -540
const SIZES_MOSAICO = '(min-width: 1180px) 276px, (min-width: 880px) calc(25vw - 19px), (min-width: 600px) calc(33.3vw - 21px), calc(50vw - 26px)';
const SIZES_LUZ = '(min-width: 750px) 720px, 96vw';
// os 6 destaques da bio (decisão D9), na ordem em que aparecem lá
const DESTAQUES = ['gran-bacon-onion', 'gran-crispy', 'x-churrasco', 'big-mineiro', 'dog-max', 'combo-gran-bacon-onion'];
// proporções dos quadros em rodízio: com a mesma foto 3:4 em todos, o columns viraria grade; assim vira parede de tijolo
const PROPORCOES = ['3/4', '1/1', '4/5', '5/6', '1/1', '3/4'];
const RE_COR = /^#[0-9a-f]{3,8}$/i;
const RE_FOCO = /^\d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/;
let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.s-galeria');
  if (!sec || montada) return;
  const mosaico = ctx.$('#mosaico', sec);
  if (!mosaico) return;
  montada = true;
  mosaico.innerHTML = fotosNovas(ctx)
    .map((slug, i) => quadro(ctx, slug, i))
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

// os slugs com foto 'nova' e produto no cardápio, sem repetir arquivo (os slugs do fotos.json já são únicos): destaques, depois o resto
function fotosNovas(ctx) {
  const ok = (slug) => {
    const p = ctx.foto.produtoDe(slug);
    return ctx.foto.nova(slug) && !!p && !p.inativo;
  };
  const todos = ctx.foto.slugs().filter(ok);
  const frente = DESTAQUES.filter((s) => todos.includes(s));
  return frente.concat(todos.filter((s) => !frente.includes(s)));
}

// um quadro da parede: foto com foco de luz por cima e o nome e o preço no pé
function quadro(ctx, slug, i) {
  const p = ctx.foto.produtoDe(slug);
  const f = ctx.foto.info(slug) || {};
  const nome = ctx.esc(p.nome);
  const vars = '--ar:' + PROPORCOES[i % PROPORCOES.length] + ';' + (RE_COR.test(f.cor || '') ? '--cor:' + f.cor : '');
  return (
    '<button type="button" class="quadro" data-ampliar="' + slug + '" style="' + vars + '" aria-label="Ampliar foto do ' + nome + '">' +
    '<span class="foto nova gal-foto"' + (RE_FOCO.test(f.foco || '') ? ' style="--foco:' + f.foco + '"' : '') + '>' +
    '<img ' + ctx.foto.atr(slug, '540', SIZES_MOSAICO, 'lazy') + ' alt=""><i class="gal-luz" aria-hidden="true"></i></span>' +
    '<span class="gal-pe"><strong>' + nome + '</strong><span class="gal-preco" data-preco-de="' + p.id + '">' + ctx.brl(p.preco) + '</span></span>' +
    '</button>'
  );
}

function ampliar(ctx, lz, slug) {
  const p = ctx.foto.produtoDe(slug);
  const img = ctx.$('#luz-img', lz);
  ctx.foto.trocar(img, slug, '1080', SIZES_LUZ);
  img.alt = p ? 'Foto do ' + p.nome : '';
  const nome = ctx.$('#luz-nome', lz);
  nome.textContent = p ? p.nome : '';
  if (p) {
    const preco = document.createElement('span');
    preco.className = 'luz-preco';
    preco.textContent = ' · ' + ctx.brl(p.preco);
    nome.appendChild(preco);
  }
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
