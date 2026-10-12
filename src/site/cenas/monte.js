/* S2 · "Pão seladinho na chapa" (dono: site-I). Seção: section.s-monte, entre os marcadores [S2] do index.html.
   O HTML traz o estado completo (foto, composição de cada lanche, segmentado, "Pedir este"); o CSS faz a cena inteira a
   partir de --p (monte.css). Aqui:
   - a seção entra no laço rAF único de base.js (modo 'preso': p vai de 0 a 1 enquanto o palco fica preso sob a barra);
     este arquivo não tem laço próprio, só reage ao quadro para marcar data-pronto e soltar o vapor em p = 1;
   - o segmentado (lanches de ROTEIRO.monte com foto 'nova') troca a foto (ML.app.foto.trocar), a composição e o preço;
   - "Pedir este" abre a ficha do lanche escolhido (ML.app.abrirFicha);
   - a próxima foto é pré-carregada quando a seção chega a 800 px da tela e quando um botão do segmentado é tocado.
   Se o roteiro mudar (o Gran Bacon ganhar foto nova, por exemplo), o segmentado e as composições são refeitos a partir do
   CONFIG, com o mesmo markup do HTML. Sem nenhum lanche com foto nova, a seção some. Movimento reduzido: base.js deixa
   --p em 1 e o CSS não prende a tela. */
import { registrar, reduz } from '../base.js';
import { ROTEIRO, comFotoNova, fotoDe } from '../roteiro.js';

const SIZES = '(min-width:1024px) 480px, 90vw'; // o mesmo do <img> do HTML
const PRONTO = 0.955; // p a partir do qual o botão aceita toque e o vapor sobe

let montada = false;
let vazia = false;
let ctx = null;
let sec = null;
let ids = []; // lanches do segmentado, na ordem do roteiro
let atual = null;
let pronto = false;
let desregistrar = null;
let el = {}; // pedaços da seção

export function iniciar(c) {
  const s = c.$('.s-monte');
  if (!s) return;
  ctx = c;
  if (!montada) {
    montada = true;
    sec = s;
    montar();
  }
  ligar();
}

function montar() {
  const P = ctx.ML.produtos;
  ids = comFotoNova(ROTEIRO.monte).filter((id) => ctx.ML.regras.temPreco(P[id]));
  if (!ids.length) {
    // sem foto 'nova' a seção não aparece (docs/DIRECAO-VISUAL.md 6.1)
    vazia = true;
    sec.hidden = true;
    return;
  }
  el = {
    quadro: ctx.$('[data-monte-quadro]', sec),
    figura: ctx.$('.s2-foto', sec),
    img: ctx.$('.s2-foto img', sec),
    vapor: ctx.$('.s2-vapor', sec),
    pilha: ctx.$('.s2-pilha', sec),
    seg: ctx.$('.s2-seg', sec),
    preco: ctx.$('[data-monte-pedir] [data-preco-de]', sec)
  };
  // o HTML é o do roteiro de hoje; se mudou, refaz o segmentado e as composições
  const noHtml = ctx.$$('[data-monte]', el.seg).map((b) => b.getAttribute('data-monte'));
  if (noHtml.join() !== ids.join()) {
    el.pilha.innerHTML = ids.map(htmlComposicao).join('');
    el.seg.innerHTML = ids.map((id) => '<button type="button" class="opt" data-monte="' + id + '" aria-pressed="false">' + ctx.esc(P[id].nome) + '</button>').join('');
    el.seg.style.setProperty('--n', ids.length);
  }
  escolher(ids[0], true);
  sec.addEventListener('click', (e) => {
    const b = e.target.closest('[data-monte],[data-monte-pedir]');
    if (!b) return;
    if (b.hasAttribute('data-monte')) escolher(b.getAttribute('data-monte'));
    else ctx.app.abrirFicha(atual, { origem: el.quadro });
  });
  // quem vai tocar num lanche já começa a baixar a foto dele
  const adiantar = (e) => {
    const b = e.target.closest && e.target.closest('[data-monte]');
    if (b) precarregar(b.getAttribute('data-monte'));
  };
  sec.addEventListener('pointerdown', adiantar);
  sec.addEventListener('focusin', adiantar);
  // a seção chegou perto da tela: baixa a foto do próximo lanche
  if ('IntersectionObserver' in window) {
    const perto = new IntersectionObserver(
      (es) => {
        if (!es.some((x) => x.isIntersecting)) return;
        perto.disconnect();
        precarregar(proximo());
      },
      { rootMargin: '800px 0px' }
    );
    perto.observe(sec);
  }
}

// a cada entrada no site: a seção entra de novo no laço, com a geometria de agora (no carregamento ocioso a view estava escondida)
function ligar() {
  if (vazia) return;
  if (desregistrar) desregistrar();
  pronto = false;
  sec.removeAttribute('data-pronto');
  sec.setAttribute('data-anim', '');
  desregistrar = registrar(sec, { modo: 'preso', topo: topoDoPalco(), quadro: quadro });
}

// onde o palco gruda (top do .s2-palco: a barra do site mais a área segura do aparelho)
function topoDoPalco() {
  const palco = ctx.$('.s2-palco', sec);
  return (palco && parseFloat(getComputedStyle(palco).top)) || 56;
}

// a cada quadro do laço: em p = 1 o botão aceita toque e o vapor sobe (uma vez por vez que chega lá)
function quadro(p) {
  const ok = p >= PRONTO;
  if (ok === pronto) return;
  pronto = ok;
  sec.toggleAttribute('data-pronto', ok);
  if (ok) ctx.app.soprarFumaca(el.vapor);
}

// as linhas da composição: a base e os ingredientes do CONFIG, na ordem dele
function htmlComposicao(id) {
  const p = ctx.ML.produtos[id];
  const itens = [p.base].concat(p.ing || []).filter(Boolean);
  return (
    '<ol class="s2-comp" data-comp="' + id + '" style="--n:' + itens.length + '" aria-label="Composição: ' + ctx.esc(p.nome) + '">' +
    itens.map((t, k) => '<li style="--k:' + k + '">' + ctx.esc(t) + '</li>').join('') +
    '</ol>'
  );
}

function escolher(id, inicial) {
  const p = ctx.ML.produtos[id];
  if (!p) return;
  atual = id;
  const slug = fotoDe(id);
  const info = ctx.foto.info(slug);
  // segmentado: a opção ativa desliza (--i) e só uma composição fica à vista
  el.seg.style.setProperty('--i', ids.indexOf(id));
  ctx.$$('[data-monte]', el.seg).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-monte') === id)));
  ctx.$$('[data-comp]', el.pilha).forEach((o) => o.toggleAttribute('data-ativo', o.getAttribute('data-comp') === id));
  // foto: a luz (--cor) e o ponto do lanche (--foco) vêm do fotos.json
  if (info) {
    el.figura.style.setProperty('--cor', info.cor);
    if (info.foco) el.figura.style.setProperty('--foco', info.foco);
  }
  if (!el.img.src.endsWith('/' + slug + '-540.webp')) {
    // a foto antiga some e a nova aparece quando carrega (app.js põe .ok no evento load); o quadro tem tamanho fixo: sem CLS
    if (!inicial && !reduz()) el.img.classList.remove('ok');
    ctx.foto.trocar(el.img, slug, '540', SIZES);
  }
  el.img.alt = 'Foto do ' + p.nome;
  // preço: o app escreve [data-preco-de] quando o banco manda outro valor, então o atributo acompanha o lanche
  el.preco.setAttribute('data-preco-de', id);
  if (inicial) {
    el.preco.textContent = ctx.brl(p.preco);
    el.preco.setAttribute('data-v', p.preco);
  } else ctx.app.contar(el.preco, p.preco);
  if (!inicial) precarregar(proximo());
}

// o lanche depois do atual no segmentado (volta ao primeiro depois do último)
function proximo() {
  return ids[(ids.indexOf(atual) + 1) % ids.length];
}

// baixa a foto do lanche num <img> solto, com o mesmo srcset e sizes do quadro (o navegador escolhe o mesmo arquivo)
const baixadas = new Set();
function precarregar(id) {
  const p = id && ctx.ML.produtos[id];
  if (!p || baixadas.has(id)) return;
  baixadas.add(id);
  ctx.foto.trocar(new Image(), fotoDe(id), '540', SIZES);
}
