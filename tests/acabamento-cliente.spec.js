// Acabamento visual do cliente (achados da revisão das capturas em 390 e 1280): o valor do combo que não quebra, as presilhas
// sobre a barra de inox, o painel de tijolo na calha, a moldura das fotos 'antiga', a composição em frase corrida, o hover que
// não gruda no toque, "Adicionar mais itens" fora do rodapé fixo, o foco que não fica atrás do rodapé, o respiro do checkout,
// a faixa do combo balanceada, a ficha sem alça no diálogo de desktop e o alvo de 44 px na dica lateral.
// Só a geometria e o estilo calculado: o banco local não é alterado. Uso: npx playwright test tests/acabamento-cliente.spec.js
/* global window, localStorage, document */
import { test, expect } from '@playwright/test';

const linha = (produtoId) => ({
  chave: produtoId + '|teste',
  sel: { produtoId, completo: true, removidos: [], prensado: false, combo: { ativo: false, refri: '' }, adicionais: {}, sabor: '', qtd: 1 }
});
// sacola guardada no aparelho antes de abrir a página (carga nova, não só troca de hash)
async function abrirComSacola(page, produtos, hash) {
  await page.goto('/');
  await page.evaluate((s) => localStorage.setItem('mineiro:v2:sacola', JSON.stringify(s)), produtos.map(linha));
  await page.goto('about:blank');
  await page.goto('/' + hash);
}
const retangulo = (loc) => loc.evaluate((e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; });

test('sacola: o valor do combo não quebra entre o símbolo e o número e "Adicionar mais itens" fica antes da comanda', async ({ page }) => {
  await abrirComSacola(page, ['gran-bacon-onion', 'x-burguer'], '#sacola');
  await expect(page.locator('#sacola-linhas .linha')).toHaveCount(2);
  const oferta = page.locator('.upsell strong');
  await expect(oferta).toHaveText(/^Vira combo por \+R\$ \d+,\d\d\?$/); // o textContent não muda
  const nb = oferta.locator('.nb');
  await expect(nb).toBeVisible(); // o texto já existe enquanto a troca de tela ainda está em andamento
  // A carga da store e das fontes pode substituir a linha entre duas leituras da sacola.
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => nb.evaluate((e) => e.getClientRects().length), { message: 'o valor ocupa uma linha só' }).toBe(1);
  // "Adicionar mais itens" vem logo depois das linhas, antes do resumo em papel, e não encosta no rodapé fixo
  const mais = page.locator('[data-mais-itens]');
  expect(await mais.evaluate((e) => !!(e.compareDocumentPosition(document.querySelector('#sacola-resumo')) & 4)), 'antes do resumo').toBe(true);
  const m = await retangulo(mais);
  const pe = await retangulo(page.locator('[data-pe-sacola]'));
  expect(m.b <= pe.t + 1 || m.t >= pe.b, 'o botão não fica sob o rodapé fixo na primeira vista').toBe(true);
});

test('cardápio: composição em frase corrida, foto antiga em moldura escura e busca por "200 g"', async ({ page }) => {
  await page.goto('/#cardapio');
  await page.locator('#menu-lista .prod').first().waitFor({ state: 'attached' });
  const ing = (id) => page.locator('#prod-' + id + ' .prod-ing').textContent();
  // só a primeira palavra da frase é maiúscula; as marcas continuam como são
  expect(await ing('gran-burger')).toBe('Pão e hambúrguer artesanal 200 g, queijo, cheddar, maionese, barbecue');
  expect(await ing('dog-doritos')).toBe('O hot dog com Doritos da casa, Doritos, cheddar');
  expect(await ing('combo-2-dog-doritos')).toContain('Coca-Cola 600 ml'); // número e unidade colados
  // a busca digita espaço comum e acha a composição escrita com NBSP
  await page.fill('#f-busca', '200 g');
  await expect.poll(() => page.locator('#menu-lista .prod').count()).toBeGreaterThan(0);
  await page.fill('#f-busca', '');
  // a <img> cobria o anel pintado no quadro: agora a foto fica 4 px para dentro, sobre a moldura --chapa-2 com o anel --borda
  const q = await page.locator('#prod-gran-burger .foto.antiga').evaluate((f) => {
    const r = f.getBoundingClientRect(), i = f.querySelector('img').getBoundingClientRect(), cs = window.getComputedStyle(f);
    return { w: r.width, wImg: i.width, esq: i.left - r.left, topo: i.top - r.top, pad: cs.paddingTop, anel: cs.boxShadow };
  });
  expect(q).toMatchObject({ w: 96, wImg: 88, esq: 4, topo: 4, pad: '4px' });
  expect(q.anel).toContain('inset');
});

test('faixa do combo balanceada e dica lateral com alvo de 44 px', async ({ page }) => {
  await page.goto('/#cardapio');
  const titulo = page.locator('[data-screen="menu"] .faixa-combo strong');
  await expect(titulo).toBeVisible();
  expect(await titulo.evaluate((e) => window.getComputedStyle(e).textWrap)).toContain('balance');
  if ((page.viewportSize() || { width: 0 }).width >= 1180) {
    const a = page.locator('.lado__dica a');
    const h = (await a.boundingBox()).height;
    expect(h, 'link do WhatsApp da dica lateral >= 43 px').toBeGreaterThanOrEqual(43);
    // o respiro vem de padding com margem negativa: a altura da dica não muda
    const dica = page.locator('.lado__dica');
    const antes = (await dica.boundingBox()).height;
    await a.evaluate((e) => { e.style.cssText = 'display:inline;padding:0;margin:0'; });
    expect(Math.abs(antes - (await dica.boundingBox()).height)).toBeLessThanOrEqual(1);
  }
});

test('ficha: a alça de arrastar só existe na gaveta do celular', async ({ page }) => {
  await page.goto('/#cardapio');
  await page.locator('#prod-gran-bacon-onion').click();
  await page.locator('#ficha[open]').waitFor();
  const largo = page.viewportSize().width >= 1024; // diálogo central de 560 px
  const d = await page.evaluate(() => ({ alca: window.getComputedStyle(document.querySelector('.ficha-alca')).display, arraste: window.getComputedStyle(document.querySelector('.ficha-arraste')).display }));
  if (largo) expect(d).toEqual({ alca: 'none', arraste: 'none' });
  else expect(d.alca).not.toBe('none');
});

test('hover só onde há mouse: no toque o primário fixo continua em --placa', async ({ page }) => {
  await abrirComSacola(page, ['x-burguer'], '#sacola');
  const botao = page.locator('#btn-continuar');
  await expect(botao).toBeVisible();
  const fundo = () => botao.evaluate((e) => window.getComputedStyle(e).backgroundColor);
  await page.mouse.move(0, 0);
  const repouso = await fundo();
  await botao.hover();
  const comHover = await page.evaluate(() => window.matchMedia('(hover:hover)').matches);
  if (comHover) expect(await fundo(), 'com mouse o hover clareia o primário').not.toBe(repouso);
  else expect(await fundo(), 'sem hover (toque) o tom não muda').toBe(repouso);
});

test('checkout: o título respira 24 px e o campo focado não fica atrás do rodapé fixo', async ({ page }) => {
  await abrirComSacola(page, ['x-burguer'], '#sacola');
  await page.locator('#btn-continuar').click();
  await page.locator('[data-screen="checkout"]').waitFor({ state: 'visible' });
  expect(await page.locator('[data-screen="checkout"] .form').evaluate((e) => window.getComputedStyle(e).paddingTop)).toBe('24px');
  // entrega é o modo padrão: endereço e referência existem e são os campos mais baixos da primeira vista
  for (const campo of ['#f-ref', '#f-obs']) {
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.locator(campo).focus();
    await page.waitForTimeout(400); // a rolagem do foco é suave
    const c = await retangulo(page.locator(campo));
    const pe = await retangulo(page.locator('[data-screen="checkout"] .pe-fixo'));
    expect(c.b, campo + ' fica acima do rodapé fixo').toBeLessThanOrEqual(pe.t + 1);
  }
});

test('acompanhamento: presilhas sobre a barra de inox e o painel de tijolo na calha', async ({ page }) => {
  await page.goto('/');
  // só a geometria importa: mostra a tela do pedido sem precisar de um pedido real
  await page.evaluate(() => {
    document.querySelectorAll('.tela').forEach((s) => { s.hidden = s.getAttribute('data-screen') !== 'pedido'; });
    window.scrollTo(0, 0);
  });
  await expect(page.locator('#pedido-topo')).toBeVisible();
  const g = await page.evaluate(() => {
    const topo = document.querySelector('#pedido-topo').getBoundingClientRect(), bloco = document.querySelector('[data-screen="pedido"] .bloco').getBoundingClientRect();
    const rel = (e) => { const b = e.getBoundingClientRect(); return { t: b.top - topo.top, b: b.bottom - topo.top }; };
    return {
      barra: rel(document.querySelector('.trilho-inox')),
      presilhas: [...document.querySelectorAll('.presilha')].map(rel),
      margemPendurada: window.getComputedStyle(document.querySelector('.comanda-pendurada .comanda')).marginTop,
      margemTotal: window.getComputedStyle(document.querySelector('[data-screen="pedido"] .bloco .comanda')).marginTop,
      calha: { esq: topo.left - bloco.left, dir: topo.right - bloco.right }
    };
  });
  expect(g.margemPendurada, 'a margem de 12 px é só da comanda do total').toBe('0px');
  expect(g.margemTotal).toBe('12px');
  expect(g.presilhas).toHaveLength(2);
  for (const p of g.presilhas) {
    // a presilha desce de dentro da barra (22 a 32 px do topo) até ~56 px: era 38 a 68 px, solta abaixo da barra
    expect(p.t, 'a presilha começa sobre a barra').toBeLessThan(g.barra.b);
    expect(p.t).toBeGreaterThan(g.barra.t);
    expect(p.b).toBeLessThan(62);
  }
  expect(Math.abs(g.calha.esq)).toBeLessThan(1);
  expect(Math.abs(g.calha.dir)).toBeLessThan(1);
});
