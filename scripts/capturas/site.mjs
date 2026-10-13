// Capturas do site imersivo (B-ck/B19): /#site, uma captura por cena (cada <section> de #view-site, rolando até ela e esperando 1,5 s).
// As cenas ficam entre comentários do index.html no formato <!-- [S0] inicio ... -->: o nome do arquivo é "s0-inicio".
// Sem esses comentários (site antigo), o nome é "s<posição>-<classe da seção>". Ver lib.mjs.
// --cena=<trecho do nome ou posição> (ou CAPTURAS_CENA) limita a rodada a uma cena (teste de fumaça).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, RAIZ, modoAuto } from './lib.mjs';

/* global document, NodeFilter */

export const alvo = 'site';
export const larguras = [390, 1280];

const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ids das cenas na ordem do index.html: "[S0] inicio" → "s0-inicio"
function cenasDoFonte() {
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
  const site = html.slice(html.indexOf('id="view-site"'));
  return [...site.matchAll(/<!--\s*\[(S\d+)\]\s*([^\s.·:—-]+)/g)].map((m) => `${m[1].toLowerCase()}-${slug(m[2])}`);
}

export async function ligar(page) {
  await modoAuto(page);
}

// seções de primeiro nível de #view-site, com o comentário [Sn] que as antecede (no DOM) quando houver
async function listarCenas(page) {
  const doDom = await page.evaluate(() => {
    const raiz = document.querySelector('#view-site');
    const todas = Array.from(raiz.querySelectorAll('section')).filter((s) => !s.parentElement.closest('#view-site section'));
    return todas.map((s, i) => {
      let no = s.previousSibling;
      while (no && no.nodeType !== 8 && no.nodeType !== 1) no = no.previousSibling;
      let comentario = no && no.nodeType === 8 ? no.nodeValue : '';
      if (!/\[S\d+\]/.test(comentario)) {
        const w = document.createTreeWalker(s, NodeFilter.SHOW_COMMENT);
        const c = w.nextNode();
        comentario = c && /\[S\d+\]/.test(c.nodeValue) ? c.nodeValue : '';
      }
      const m = /\[(S\d+)\]\s*([^\s.·:—-]+)/.exec(comentario);
      const classe = (s.className || '').split(/\s+/)[0] || s.getAttribute('aria-labelledby') || 'secao';
      return { i, id: m ? `${m[1]}-${m[2]}` : null, classe };
    });
  });
  const doFonte = cenasDoFonte();
  const usarFonte = doFonte.length === doDom.length && doDom.some((c) => !c.id);
  return doDom.map((c) => ({
    i: c.i,
    nome: slug(c.id || (usarFonte ? doFonte[c.i] : `s${c.i}-${c.classe.replace(/^s-/, '')}`))
  }));
}

export async function telas(page, v, dados, tela) {
  await page.goto(BASE + '/#site');
  await page.locator('#view-site').waitFor({ state: 'visible' });
  await page.locator('#view-site section').first().waitFor({ state: 'attached' });
  const filtro = process.env.CAPTURAS_CENA || '';
  const cenas = await listarCenas(page);
  for (const c of cenas) {
    if (filtro && !c.nome.includes(filtro.toLowerCase()) && String(c.i) !== filtro) continue;
    const secao = await page.evaluateHandle((i) => Array.from(document.querySelectorAll('#view-site section')).filter((s) => !s.parentElement.closest('#view-site section'))[i], c.i);
    const elemento = secao.asElement();
    await elemento.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await tela(c.nome, { elemento, cheia: false, espera: 100 });
  }
}
