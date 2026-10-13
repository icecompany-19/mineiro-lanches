// Capturas do site imersivo (B-ck/B19): /#site, uma captura por cena, achada pelos marcadores do index.html
// (<!-- [BARRA] inicio -->, <!-- [S0] inicio -->, ..., <!-- [S1b] inicio -->, ... <!-- [S9] fim -->, filhos diretos de #view-site).
// Cada cena é o primeiro elemento (fora <dialog>) entre o "inicio" e o "fim" do marcador; o nome do arquivo é o marcador mais a classe
// dela: barra, s0-hero, s1-fitas, s1b-placa, s2-monte, ... s9-final. Antes da foto a cena é percorrida de cima a baixo (os .rv e as
// imagens lazy só entram ao aparecer na janela, e o percurso espera as imagens baixarem) e a rolagem é posicionada (POSICAO e
// AJUSTES, abaixo: barra escondida na foto da cena, cartas da S5 sem sticky, S8 com a rota completa).
// Se os marcadores do index.html e os do DOM não baterem (cena que sumiu ou ganhou outro nome), a rodada falha, em vez de seguir com
// menos cenas sem avisar.
// Estados que importam, além da cena (nome da cena + sufixo):
//   s2-monte-inicio / -meio / -fim a janela com a cena presa à rolagem em p = 0, .5 e 1 (só captura: o medir mede a cena inteira;
//                                  com a S2 presa o PNG da cena em si não é salvo, só medido: seria o quadro inicial e um trilho vazio)
//   s2-monte-ficha                 a ficha aberta por "Pedir este" (S2 em p = 1)
//   s3-prensa-100                  a régua da S3 toda à direita (prensado; só sem movimento reduzido: com ele a régua some)
//   s6-noite-14h                   a S6 com a régua "Simule um horário" em 14h (parede apagada na simulação)
//   s7-galeria-ampliada            a primeira foto do mosaico aberta em #luz-caixa
// --cena=<trecho do nome ou posição> (ou CAPTURAS_CENA) limita a rodada a uma cena (teste de fumaça): "s2" pega a S2 e os estados dela.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, RAIZ } from './lib.mjs';

/* global document, window, scrollTo, scrollY, innerHeight, getComputedStyle */

export const alvo = 'site';
export const larguras = [390, 1280];

const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// marcadores "inicio" dentro de #view-site no fonte, na ordem: ["BARRA", "S0", "S1", "S1b", ...]
function marcadoresDoFonte() {
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
  const site = html.slice(html.indexOf('id="view-site"'));
  return [...site.matchAll(/<!--\s*\[(BARRA|S\d+[a-z]?)\]\s*inicio/g)].map((m) => m[1]);
}

// A luz do truck depende só do relógio fixo: o estado_cardapio real vem com loja.modo = 'auto' (o banco compartilhado pode estar em
// 'aberta'). O lib.mjs faz isso com page.route (modoAuto), mas com a interceptação ligada o Chromium deixa em branco, na foto de recorte,
// as imagens que estão fora da janela (as fotos das cartas da S5 saíam vazias com todas as imagens carregadas). Aqui a troca é feita
// dentro da página, por um fetch embrulhado, sem page.route: a resposta continua sendo a do banco real, só com o modo trocado.
export async function ligar(page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const resposta = await original(...args);
      const alvo = args[0];
      const url = String(alvo && alvo.url ? alvo.url : alvo);
      if (!url.includes('/rest/v1/rpc/estado_cardapio')) return resposta;
      try {
        const json = await resposta.clone().json();
        if (json && json.loja) json.loja.modo = 'auto';
        return new Response(JSON.stringify(json), { status: resposta.status, statusText: resposta.statusText, headers: { 'content-type': 'application/json' } });
      } catch {
        return resposta;
      }
    };
  });
}

// cenas do DOM: [{ i, id, nome }] na ordem. O primeiro elemento entre os comentários é a cena.
async function listarCenas(page) {
  const doDom = await page.evaluate(() => {
    const raiz = document.querySelector('#view-site');
    const out = [];
    let atual = null;
    for (const no of Array.from(raiz.childNodes)) {
      if (no.nodeType === 8) {
        const m = /^\s*\[(BARRA|S\d+[a-z]?)\]\s*(inicio|fim)/.exec(no.nodeValue);
        if (!m) continue;
        if (m[2] === 'inicio') atual = { id: m[1], classe: '', achou: false };
        else if (atual && atual.id === m[1]) {
          out.push(atual);
          atual = null;
        }
      } else if (no.nodeType === 1 && atual && !atual.achou && no.tagName !== 'DIALOG') {
        atual.achou = true;
        atual.classe = (no.className || '').split(/\s+/)[0] || no.tagName.toLowerCase();
      }
    }
    return out;
  });
  const ids = doDom.map((c) => c.id);
  const fonte = marcadoresDoFonte();
  if (ids.join() !== fonte.join()) throw new Error(`cenas do DOM (${ids.join(' ')}) diferem dos marcadores do index.html (${fonte.join(' ')})`);
  const semElemento = doDom.filter((c) => !c.achou).map((c) => c.id);
  if (semElemento.length) throw new Error('marcador sem elemento entre o inicio e o fim: ' + semElemento.join(' '));
  return doDom.map((c, i) => ({ i, id: c.id, nome: c.id === 'BARRA' ? 'barra' : `${c.id.toLowerCase()}-${slug(c.classe.replace(/^s-/, ''))}` }));
}

// o elemento da cena (de novo a cada uso: o DOM pode ter sido refeito pelo JS da cena)
const elementoDaCena = (page, id) =>
  page.evaluateHandle((marca) => {
    const raiz = document.querySelector('#view-site');
    let dentro = false;
    for (const no of Array.from(raiz.childNodes)) {
      if (no.nodeType === 8) {
        const m = /^\s*\[(BARRA|S\d+[a-z]?)\]\s*(inicio|fim)/.exec(no.nodeValue);
        if (m && m[1] === marca) dentro = m[2] === 'inicio';
      } else if (no.nodeType === 1 && dentro && no.tagName !== 'DIALOG') return no;
    }
    return null;
  }, id);

// Passa pela cena de cima a baixo (passos de 60% da janela) para os .rv e as imagens lazy entrarem. Em cada parada espera as imagens
// da janela (e da janela seguinte) acabarem de baixar, no máximo 4 s: com 140 ms fixos as cartas da S5 saíam com o quadro das fotos vazio.
// No fim espera as imagens que ainda faltam na cena inteira (máx. 8 s) e deixa a rolagem no topo dela sob a barra.
async function percorrer(page, elemento) {
  await page.evaluate(async (el) => {
    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const faltam = (raiz, margem) =>
      Array.from(raiz.querySelectorAll('img')).filter((i) => {
        if (!i.currentSrc && !i.src) return false;
        const r = i.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < -margem || r.top > innerHeight + margem) return false;
        return !(i.complete && i.naturalWidth);
      });
    const esperar = async (raiz, margem, limite) => {
      const fimEm = Date.now() + limite;
      while (Date.now() < fimEm && faltam(raiz, margem).length) await pausa(100);
    };
    const topo = el.getBoundingClientRect().top + scrollY;
    const base = topo + el.getBoundingClientRect().height;
    const passo = Math.max(200, Math.floor(innerHeight * 0.6));
    for (let y = topo - 56; y < base; y += passo) {
      scrollTo(0, Math.max(0, y));
      await pausa(160);
      await esperar(el, innerHeight, 4000);
    }
    scrollTo(0, Math.max(0, base - innerHeight));
    await pausa(200);
    await esperar(el, 1e6, 8000);
    scrollTo(0, Math.max(0, topo - 56));
    await pausa(150);
  }, elemento);
}

// A foto de uma cena é um recorte da página inteira (fullPage + clip) e o Chromium rola a página durante essa foto (a S5 em 390 saltava
// ~1200 px). O que depende da rolagem sai fora do lugar: a barra do site (fixed) caía no meio da foto, as cartas da S5 (sticky) se
// descolavam do lugar delas e a rota da S8 (--p) ficava no começo. Por isso, só nas fotos de cena (não nas janelas):
//   - a barra do site fica escondida (a cena "barra" a mostra; as janelas -inicio/-meio/-fim/-ficha/-ampliada também);
//   - as cartas da S5 ficam em fluxo comum (position: relative), como já ficam com movimento reduzido: o lugar natural delas;
//   - a S8 é fotografada com a cena já passada pelo topo (POSICAO 'fim'): a rota no estado final, o mesmo do movimento reduzido.
// As outras cenas são fotografadas com o topo delas no topo da janela ('topo').
const POSICAO = { S8: 'fim' };
const AJUSTES = [
  { id: '__cap-barra', css: '.barra-site{visibility:hidden!important}', quando: (c) => c !== 'BARRA' },
  { id: '__cap-s5', css: '.s-combos .carta{position:relative!important;top:auto!important}', quando: (c) => c === 'S5' }
];
const ajustar = (page, cena) =>
  page.evaluate(
    ({ ajustes, ligados }) => {
      for (const a of ajustes) {
        let st = document.getElementById(a.id);
        if (!st) {
          st = document.createElement('style');
          st.id = a.id;
          st.textContent = a.css;
          document.head.appendChild(st);
        }
        st.media = ligados.includes(a.id) ? 'all' : 'not all';
      }
    },
    { ajustes: AJUSTES.map(({ id, css }) => ({ id, css })), ligados: AJUSTES.filter((a) => cena && a.quando(cena)).map((a) => a.id) }
  );
const semAjustes = (page) => ajustar(page, '');
// Depois de ajustar, dá tempo de as imagens da cena serem decodificadas nos lugares novos: sem isso as fotos das cartas da S5, que o
// ajuste move, saíam em branco (o Chromium não pinta, numa foto de recorte, a imagem que acabou de entrar fora da janela).
const assentarAjuste = async (page) => {
  await page.evaluate(() => Promise.all(Array.from(document.querySelectorAll('#view-site img')).filter((i) => i.complete && i.naturalWidth && i.decode).map((i) => i.decode().catch(() => {}))));
  await page.waitForTimeout(900);
};
async function posicionar(page, elemento, modo) {
  await page.evaluate(
    ({ el, m }) => {
      const r = el.getBoundingClientRect();
      scrollTo(0, Math.max(0, Math.round(r.top + scrollY + (m === 'fim' ? r.height : 0))));
    },
    { el: elemento, m: modo }
  );
}

// Rola até o ponto em que a S2 (presa à rolagem) está em p: 0 quando o topo dela chega sob a barra, 1 quando o fim chega ao pé da janela.
// Com movimento reduzido a seção não prende (p fica em 1): vai ao topo dela.
const rolarParaP = (page, p) =>
  page.evaluate((q) => {
    const s = document.querySelector('.s-monte');
    const palco = s.querySelector('.s2-palco');
    const topoPalco = (palco && parseFloat(getComputedStyle(palco).top)) || 56;
    const r = s.getBoundingClientRect();
    const t = r.top + scrollY;
    const y0 = t - topoPalco;
    const y1 = Math.max(y0, r.bottom + scrollY - innerHeight);
    scrollTo(0, Math.round(y0 + q * (y1 - y0)));
  }, p);

export async function telas(page, v, dados, tela) {
  await page.goto(BASE + '/#site');
  await page.locator('#view-site').waitFor({ state: 'visible' });
  await page.locator('#view-site section').first().waitFor({ state: 'attached' });
  // o JS das cenas (import() de src/site/site.js) monta o mosaico, o segmentado da S2 e a régua da S6
  await page.locator('#noite-regua:not([disabled])').waitFor({ state: 'attached' });
  await page.locator('#mosaico button[data-ampliar]').first().waitFor({ state: 'attached' });
  const filtro = (process.env.CAPTURAS_CENA || '').toLowerCase();
  const cenas = await listarCenas(page);
  const quer = (c) => !filtro || c.nome.includes(filtro) || String(c.i) === filtro;
  const fechar = async (seletorAberto, seletorFechar) => {
    await page.locator(seletorFechar).first().click();
    await page.locator(seletorAberto).waitFor({ state: 'hidden' });
  };

  for (const c of cenas) {
    if (!quer(c)) continue;
    const elemento = (await elementoDaCena(page, c.id)).asElement();
    await percorrer(page, elemento);
    await posicionar(page, elemento, POSICAO[c.id] || 'topo');
    await page.waitForTimeout(1500);
    // S2 presa à rolagem (palco sticky, 200 a 240vh): a foto do elemento seria o primeiro quadro e um trilho vazio embaixo. Ela só é
    // medida (soMedida: o capturas.mjs não salva o PNG) e as fotos dela são as janelas -inicio, -meio e -fim abaixo.
    const presa = c.id === 'S2' && (await page.evaluate(() => getComputedStyle(document.querySelector('.s2-palco')).position === 'sticky'));
    await ajustar(page, c.id);
    await assentarAjuste(page);
    await tela(c.nome, { elemento, cheia: false, espera: 100, soMedida: presa });
    await semAjustes(page);

    if (c.id === 'S2') {
      // a janela em p = 0, .5 e 1 (o medir só mede a cena inteira acima: soCaptura). Com movimento reduzido a seção não prende e
      // as três saem iguais (cena completa).
      await rolarParaP(page, 0);
      await page.waitForTimeout(1200);
      await tela(c.nome + '-inicio', { cheia: false, soCaptura: true, espera: 200 });
      await rolarParaP(page, 0.5);
      await page.waitForTimeout(1200);
      await tela(c.nome + '-meio', { cheia: false, soCaptura: true, espera: 200 });
      await rolarParaP(page, 1);
      await page.waitForTimeout(1500);
      await tela(c.nome + '-fim', { cheia: false, soCaptura: true, espera: 200 });
      // "Pedir este" abre a ficha do lanche escolhido (o botão só aceita toque em p = 1: data-pronto)
      await page.locator('[data-monte-pedir]').click();
      await page.locator('#ficha[open]').waitFor();
      await tela(c.nome + '-ficha', { cheia: false, espera: 700 });
      await fechar('#ficha', '[data-fechar-ficha]');
    }

    // com movimento reduzido a régua não existe (o CSS mostra os dois estados lado a lado): só há o estado -100 na versão animada
    if (c.id === 'S3' && (await page.locator('#f-prensa').isVisible())) {
      await page.locator('#f-prensa').scrollIntoViewIfNeeded();
      await page.locator('#f-prensa').fill('100');
      await page.waitForTimeout(900);
      const secao = (await elementoDaCena(page, c.id)).asElement();
      await posicionar(page, secao, 'topo');
      await page.waitForTimeout(400);
      await ajustar(page, c.id);
      await assentarAjuste(page);
      await tela(c.nome + '-100', { elemento: secao, cheia: false, espera: 300 });
      await semAjustes(page);
    }

    if (c.id === 'S6') {
      await page.locator('#noite-regua').scrollIntoViewIfNeeded();
      await page.locator('#noite-regua').fill('840'); // 14h
      await page.waitForTimeout(900);
      const secao = (await elementoDaCena(page, c.id)).asElement();
      await posicionar(page, secao, 'topo');
      await page.waitForTimeout(400);
      await ajustar(page, c.id);
      await assentarAjuste(page);
      await tela(c.nome + '-14h', { elemento: secao, cheia: false, espera: 700 });
      await semAjustes(page);
    }

    if (c.id === 'S7') {
      await page.locator('#mosaico button[data-ampliar]').first().scrollIntoViewIfNeeded();
      await page.locator('#mosaico button[data-ampliar]').first().click();
      await page.locator('#luz-caixa[open]').waitFor();
      await tela(c.nome + '-ampliada', { cheia: false, espera: 700 });
      await fechar('#luz-caixa', '[data-fechar-luz]');
    }
  }
}
