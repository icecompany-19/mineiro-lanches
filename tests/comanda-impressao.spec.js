// Comanda para a impressora térmica (papel 72 mm × 210 mm, 203 dpi) e informações em negrito (cliente, 16/10/2026):
//   - a comanda tem 72 mm de largura na tela e na impressão, e a página de impressão ganha 72 mm × a altura do cupom,
//     sem margem, venha a impressão do cartão, do detalhe do pedido ou da própria visualização;
//   - cada pedido imprime em UMA página (nada de cupom cortado em duas folhas);
//   - as informações saem em negrito; a taxa de entrega aparece na comanda;
//   - (17/10, contrato C3 do docs/PLANO-FASE-3.md) a comanda abre com a logo oficial (logo-512.webp, arte intacta) e, no pedido
//     de entrega, fecha com o QR do entregador (<site>/motoboy/#<id>), a legenda "ENTREGADOR: LEIA AO ENTREGAR" e o número
//     repetido; retirada e retirada no local não levam QR; a impressão espera a logo se ela ainda não chegou.
// O quadro vem de page.route sobre o GET dos pedidos (o banco não é alterado) e o window.print é trocado por um espião.
// Uso: npx playwright test tests/comanda-impressao.spec.js --project=desktop   (precisa do Supabase local no ar)
// Os casos que rasterizam o PDF precisam do pdftoppm (poppler) no PATH; sem ele são pulados (padrão de tests/qrcode.test.mjs).
/* global window, document, getComputedStyle */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import jsQR from 'jsqr';
import sharp from 'sharp';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const MM = 96 / 25.4; // px por mm no CSS
const PT_72MM = (72 / 25.4) * 72; // 204,09 pt
const temPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return e.code !== 'ENOENT';
  }
})();

// eslint-disable-next-line no-empty-pattern -- o Playwright exige o padrão de desestruturação no primeiro argumento
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'desktop', 'painel de computador: só no desktop'));
test.beforeAll(() => {
  try {
    execFileSync('psql', [PG, '-X', '-At', '-q', '-c', "insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = 'equipe@teste.local' on conflict do nothing"]);
  } catch {
    /* sem psql: o login mostraria "Sem acesso" e o teste diria isso */
  }
});

const item = (nome, subtotal, extra = {}) => ({
  produtoId: 'x-burguer', nome, tipo: 'lanche', precoBase: subtotal, precoUnit: subtotal, qtd: 1, completo: true, removidos: [],
  prensado: false, combo: { ativo: false, refri: '' }, adicionais: [], sabor: '', resumo: 'Completo', subtotal, ...extra
});
function linha(n, extra = {}) {
  const em = new Date(Date.now() - 4 * 60000).toISOString();
  return {
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, numero: n, token: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    criado_em: em, origem: 'cardapio', mesa: null, cliente_nome: 'Marina Souza', cliente_telefone: '11985720150', modo: 'entrega',
    endereco: 'Rua Eliziél Alves Costa, 300, Centro, Suzano/SP, CEP 08674-185', referencia: 'Portão azul', pagamento: null, troco: '', obs: 'Sem cebola, por favor',
    itens: [
      item('Gran Bacon Onion', 49.8, { prensado: true, combo: { ativo: true, refri: 'Coca-Cola' }, removidos: ['Cebola roxa'], completo: false, resumo: 'Sem cebola roxa' }),
      item('Porção de batata turbinada', 39.9, { tipo: 'porcao' }),
      item('Refrigerante lata', 8, { tipo: 'bebida' })
    ],
    total: 105.7, distancia_km: 3.2, taxa_entrega: 8, status: 'novo', historico: [{ status: 'novo', em }], ...extra
  };
}

async function entrar(page, pedidos) {
  await page.route('**/rest/v1/pedidos?*', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: pedidos }) : r.fallback()));
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sem acesso' })).toHaveCount(0);
  await expect(page.locator('#view-painel .pn-app')).toBeAttached({ timeout: 25_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__impressoes = 0;
    window.print = () => { window.__impressoes++; }; // o espião: não abre a janela de impressão
  });
}

// lê do PDF que o Chromium gera em modo de impressão: tamanho de cada página e quantas páginas
async function pdfDaImpressao(page) {
  await page.emulateMedia({ media: 'print' });
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const txt = buf.toString('latin1');
  const paginas = [...txt.matchAll(/\/Type\s*\/Page[^s]/g)].length;
  const caixas = [...txt.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({ larguraPt: +m[1], alturaPt: +m[2] }));
  return { paginas, caixas };
}

test('a comanda tem 72 mm, sai em negrito e a página de impressão tem o tamanho do cupom (uma página só)', async ({ page }) => {
  await entrar(page, [linha(11)]);
  await page.locator('.pn-card[data-id$="11"] [data-act="imprimir"]').click();
  const comanda = page.locator('.pn-comanda');
  await expect(comanda).toBeVisible();

  // 72 mm de largura (272 px a 96 dpi)
  const caixa = await comanda.boundingBox();
  expect(Math.abs(caixa.width - 72 * MM)).toBeLessThan(1.5);

  // negrito nas informações
  const pesos = await page.evaluate(() => {
    const p = (s) => Number(getComputedStyle(document.querySelector(s)).fontWeight);
    return { comanda: p('.pn-comanda'), item: p('.pn-c-lin'), cliente: p('.pn-c-v'), obs: p('.pn-c-obs'), selos: p('.pn-c-sel'), total: p('.pn-c-total') };
  });
  for (const [onde, peso] of Object.entries(pesos)) expect(peso, `negrito em ${onde}`).toBeGreaterThanOrEqual(700);

  // a taxa de entrega entra na comanda
  await expect(comanda).toContainText('ENTREGA: R$ 8,00 · 4 km');
  await expect(comanda).toContainText('CEP 08674-185');

  // imprimir: a página ganha 72 mm × a altura do cupom, sem margem
  await page.locator('.pn-modal [data-m="imprimir"]').click();
  expect(await page.evaluate(() => window.__impressoes)).toBe(1);
  const regra = await page.locator('#pn-pagina-impressao').textContent();
  const [, h] = regra.match(/size:\s*72mm\s+(\d+)mm;\s*margin:\s*0/) || [];
  expect(h, 'regra @page com 72mm de largura e margem 0: ' + regra).toBeTruthy();
  const alturaCupomMm = caixa.height / MM;
  expect(Number(h)).toBeGreaterThanOrEqual(Math.floor(alturaCupomMm));
  expect(Number(h)).toBeLessThanOrEqual(Math.ceil(alturaCupomMm) + 4);

  const pdf = await pdfDaImpressao(page);
  expect(pdf.paginas, 'cupom numa página só').toBe(1);
  expect(pdf.caixas).toHaveLength(1);
  expect(Math.abs(pdf.caixas[0].larguraPt - PT_72MM), `largura da página ${pdf.caixas[0].larguraPt} pt`).toBeLessThan(1.5);
  expect(Math.abs(pdf.caixas[0].alturaPt - Number(h) * (72 / 25.4)), 'altura da página = a medida posta').toBeLessThan(1.5);
});

test('entrega sem taxa fica destacada no painel e na comanda, sem parecer incluída no total', async ({ page }) => {
  await entrar(page, [linha(16, { taxa_entrega: null, distancia_km: null, total: 97.7 })]);
  const card = page.locator('.pn-card[data-id$="16"]');
  await expect(card.locator('.pn-taxa--pendente')).toHaveText('Taxa de entrega pendente — não incluída no total');
  await card.locator('[data-act="imprimir"]').click();
  const taxa = page.locator('.pn-comanda .pn-c-taxa');
  await expect(taxa).toHaveText('TAXA DE ENTREGA PENDENTE — NÃO INCLUÍDA NO TOTAL');
  await expect(page.locator('.pn-comanda .pn-c-total')).toContainText('R$ 97,70');
  await page.emulateMedia({ media: 'print' });
  await expect(taxa).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(taxa).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('imprimir pelo detalhe do pedido dá a mesma comanda e a mesma página que pelo cartão', async ({ page }) => {
  await entrar(page, [linha(12)]);
  const medir = async () => {
    const regra = await page.locator('#pn-pagina-impressao').textContent();
    const largura = (await page.locator('.pn-comanda').boundingBox()).width;
    return { regra, largura: Math.round(largura) };
  };
  await page.locator('.pn-card[data-id$="12"] [data-act="imprimir"]').click();
  await page.locator('.pn-modal [data-m="imprimir"]').click();
  const pelaCard = await medir();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-modal')).toHaveCount(0);

  // o detalhe abre pelo histórico
  await page.locator('[data-nav="historico"]').click();
  await page.locator('[data-view="historico"] [data-act="detalhe"]').first().click();
  await page.locator('.pn-lateral [data-act="imprimir"]').click();
  await page.locator('.pn-modal [data-m="imprimir"]').click();
  const peloDetalhe = await medir();
  expect(peloDetalhe).toEqual(pelaCard);
  expect(await page.evaluate(() => window.__impressoes)).toBe(2);
});

test('pedido com muitos itens continua em uma página só, com a altura ajustada ao cupom', async ({ page }) => {
  const muitos = Array.from({ length: 24 }, (_, i) => item('Hot Dog Max ' + (i + 1), 15.9, { qtd: 2, subtotal: 31.8 }));
  await entrar(page, [linha(13, { itens: muitos, total: 770.2, obs: 'Entregar no portão dos fundos, tocar duas vezes e esperar o cliente sair com o troco já separado' })]);
  await page.locator('.pn-card[data-id$="13"] [data-act="imprimir"]').click();
  await page.locator('.pn-modal [data-m="imprimir"]').click();
  const regra = await page.locator('#pn-pagina-impressao').textContent();
  const h = Number(regra.match(/72mm\s+(\d+)mm/)[1]);
  expect(h).toBeGreaterThan(210); // maior que o papel de 210 mm: a página cresce, não corta
  const pdf = await pdfDaImpressao(page);
  expect(pdf.paginas).toBe(1);
  expect(Math.abs(pdf.caixas[0].larguraPt - PT_72MM)).toBeLessThan(1.5);
});

test('impressão térmica tem margens brancas, sem faixas escuras ou sombras do painel', async ({ page }, testInfo) => {
  test.skip(!temPdftoppm, 'sem pdftoppm (poppler) no PATH');
  await entrar(page, [linha(15)]);
  await page.locator('.pn-card[data-id$="15"] [data-act="imprimir"]').click();
  await page.locator('.pn-modal [data-m="imprimir"]').click();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const caminho = testInfo.outputPath('comanda.pdf');
  const imagem = testInfo.outputPath('comanda');
  writeFileSync(caminho, pdf);
  execFileSync('pdftoppm', ['-r', '203', '-png', '-singlefile', caminho, imagem]);
  await testInfo.attach('comanda-termica', { path: imagem + '.png', contentType: 'image/png' });

  const { data, info } = await sharp(imagem + '.png').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const margem = Math.floor(2 * 203 / 25.4); // primeiros/últimos 2 mm não têm conteúdo
  let pixelsEscurosNaMargem = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x >= margem && x < info.width - margem) continue;
      const i = (y * info.width + x) * info.channels;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 245) pixelsEscurosNaMargem++;
    }
  }
  expect(pixelsEscurosNaMargem, 'margens laterais do PDF devem sair totalmente brancas').toBe(0);

  const sombras = await page.locator('.pn-modal, .pn-modal-caixa, .pn-comanda').evaluateAll(els => els.map(el => getComputedStyle(el).boxShadow));
  expect(sombras).toEqual(['none', 'none', 'none']);
});

// ---------- logo oficial e QR do entregador (17/10/2026, contrato C3) ----------

// decodifica um PNG com o jsQR; umBit = cinza + limiar em 128, como a impressora térmica
async function lerQr(png, { umBit = false } = {}) {
  let img = sharp(png).flatten({ background: '#fff' }).grayscale();
  if (umBit) img = img.threshold(128);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(info.width * info.height * 4); // o jsQR quer RGBA; o cinza do sharp vem com 1 canal
  for (let i = 0; i < info.width * info.height; i++) rgba.set([data[i * info.channels], data[i * info.channels], data[i * info.channels], 255], i * 4);
  const achado = jsQR(rgba, info.width, info.height);
  return achado ? achado.data : null;
}

// abre a comanda do pedido n (já no quadro) e espera o diálogo parar de animar (entra com opacidade e deslocamento)
async function abrirComanda(page, n) {
  await page.locator(`.pn-card[data-id$="${String(n).padStart(2, '0')}"] [data-act="imprimir"]`).click();
  await expect(page.locator('.pn-comanda')).toBeVisible();
  await expect(page.locator('.pn-modal-caixa')).toHaveCSS('opacity', '1');
  await expect(page.locator('.pn-modal-caixa')).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/); // a animação termina na identidade
}

test.describe('logo e QR do entregador na comanda', () => {
  test.use({ deviceScaleFactor: 4 }); // o QR é lido de screenshot: precisa de pixels de sobra por módulo

  test('a logo oficial abre a comanda: carregada, em 38 mm, sem filter, blend nem máscara, e o número continua grande', async ({ page }) => {
    await entrar(page, [linha(21)]);
    await abrirComanda(page, 21);
    const comanda = page.locator('.pn-comanda');
    await expect(comanda.locator('img')).toHaveCount(1);
    const logo = comanda.locator('img.pn-c-logo');
    await expect.poll(() => logo.evaluate((i) => i.complete && i.naturalWidth > 0), { message: 'logo carregada' }).toBe(true);
    const medir = () =>
      logo.evaluate((i) => {
        const cs = getComputedStyle(i);
        const r = i.getBoundingClientRect();
        const c = i.closest('.pn-comanda').getBoundingClientRect();
        return {
          src: new URL(i.src).pathname, alt: i.alt, largura: i.getAttribute('width'), altura: i.getAttribute('height'), decoding: i.getAttribute('decoding'),
          natural: [i.naturalWidth, i.naturalHeight], filter: cs.filter, blend: cs.mixBlendMode, mascara: cs.maskImage, mascaraWebkit: cs.webkitMaskImage,
          opacidade: cs.opacity, caixa: [r.width, r.height], noTopo: r.top - c.top, centro: r.left + r.width / 2 - (c.left + c.width / 2)
        };
      });
    const tela = await medir();
    expect(tela.src).toBe('/assets/logo/logo-512.webp');
    expect(tela.alt).toBe('Mineiro Lanche food truck');
    expect([tela.largura, tela.altura, tela.decoding]).toEqual(['512', '416', 'sync']);
    expect(tela.natural).toEqual([512, 416]);
    expect([tela.filter, tela.blend, tela.mascara, tela.mascaraWebkit, tela.opacidade]).toEqual(['none', 'normal', 'none', 'none', '1']);
    expect(Math.abs(tela.caixa[0] - 38 * MM), `largura ${tela.caixa[0]} px`).toBeLessThan(1);
    expect(Math.abs(tela.caixa[1] - 38 * MM * (416 / 512)), 'proporção da arte (512 × 416)').toBeLessThan(1);
    expect(tela.noTopo, 'a logo abre a comanda (depois do preenchimento de 3 mm)').toBeLessThan(3 * MM + 2);
    expect(Math.abs(tela.centro), 'centralizada').toBeLessThan(1);
    // nunca o svg, o selo nem o 1024
    expect(await comanda.innerHTML()).not.toMatch(/logo-1024|logo\.svg|logo-selo|selo-\d/);
    // o número do pedido segue grande e vem depois da logo
    await expect(comanda.locator('.pn-c-num')).toHaveText('#0021');
    expect(Number(await comanda.locator('.pn-c-num').evaluate((e) => getComputedStyle(e).fontSize.replace('px', '')))).toBeGreaterThanOrEqual(40);
    const caixaLogo = await logo.boundingBox();
    expect((await comanda.locator('.pn-c-num').boundingBox()).y).toBeGreaterThan(caixaLogo.y + caixaLogo.height - 1);
    // em modo de impressão a arte continua intacta
    await page.emulateMedia({ media: 'print' });
    const impressao = await medir();
    await page.emulateMedia({ media: 'screen' });
    expect([impressao.filter, impressao.blend, impressao.mascara, impressao.mascaraWebkit, impressao.opacidade]).toEqual(['none', 'normal', 'none', 'none', '1']);
    expect(Math.abs(impressao.caixa[0] - 38 * MM)).toBeLessThan(1);
  });

  test('a comanda de entrega traz o QR do entregador: lido, igual a <site>/motoboy/#<id>, com legenda e número repetido', async ({ page }) => {
    const pedido = linha(22);
    await entrar(page, [pedido]);
    await abrirComanda(page, 22);
    const comanda = page.locator('.pn-comanda');
    const qr = comanda.locator('.pn-c-qr');
    await expect(qr).toHaveCount(1);
    const base = await page.evaluate(() => window.MLQr.base);
    expect(base, 'base sem barra no fim').toMatch(/^https?:\/\/[^/]+$/);
    const esperado = base + '/motoboy/#' + pedido.id;

    // legenda em negrito e o número do pedido repetido (o primeiro está no topo, em .pn-c-num)
    await expect(qr.locator('.pn-c-qr-t')).toHaveText('ENTREGADOR: LEIA AO ENTREGAR');
    await expect(qr.locator('.pn-c-qr-n')).toHaveText('#0022');
    await expect(comanda.getByText('#0022')).toHaveCount(2);
    for (const sel of ['.pn-c-qr-t', '.pn-c-qr-n']) expect(Number(await qr.locator(sel).evaluate((e) => getComputedStyle(e).fontWeight)), sel).toBeGreaterThanOrEqual(700);
    // o QR fecha a comanda (depois do total) e não se parte entre páginas
    const total = await comanda.locator('.pn-c-total').boundingBox();
    expect((await qr.boundingBox()).y).toBeGreaterThan(total.y + total.height - 1);
    expect(await qr.evaluate((e) => getComputedStyle(e).breakInside)).toBe('avoid');

    // um <svg> com um único <path>; sem "Mineiro" nem URL no rótulo; lado entre 28 e 40 mm
    const svg = qr.locator('svg');
    await expect(svg).toHaveCount(1);
    await expect(svg.locator('path')).toHaveCount(1);
    expect(await svg.getAttribute('shape-rendering')).toBe('crispEdges');
    const rotulo = await svg.getAttribute('aria-label');
    expect(rotulo).toBeTruthy();
    expect(rotulo).not.toMatch(/mineiro|http/i);
    const lado = (await svg.boundingBox()).width / MM;
    expect(lado, `QR com ${lado.toFixed(1)} mm`).toBeGreaterThanOrEqual(28);
    expect(lado).toBeLessThanOrEqual(40);

    // lê de verdade: o bloco inteiro (com a legenda) e só o svg, em cores e em 1 bit
    const bloco = await qr.screenshot();
    expect(await lerQr(bloco), 'bloco do QR').toBe(esperado);
    expect(await lerQr(bloco, { umBit: true }), 'bloco do QR em 1 bit').toBe(esperado);
    const so = await svg.screenshot();
    expect(await lerQr(so), 'só o svg').toBe(esperado);
    expect(await lerQr(so, { umBit: true }), 'só o svg em 1 bit').toBe(esperado);
  });

  for (const modo of ['retirada', 'local']) {
    test(`pedido de ${modo} sai sem QR, sem erro, e a comanda continua com logo, 72 mm e uma página`, async ({ page }) => {
      const erros = [];
      page.on('pageerror', (e) => erros.push(e.message));
      await entrar(page, [linha(23, { modo, endereco: '', referencia: '', taxa_entrega: null, distancia_km: null, total: 97.7 })]);
      expect(await page.evaluate(() => typeof window.MLQr.qrSvg), 'o gerador está carregado: a falta do QR é só da regra').toBe('function');
      await abrirComanda(page, 23);
      const comanda = page.locator('.pn-comanda');
      await expect(comanda.locator('.pn-c-qr')).toHaveCount(0);
      await expect(comanda.locator('svg')).toHaveCount(0);
      await expect(comanda).not.toContainText('ENTREGADOR');
      await expect(comanda.locator('img.pn-c-logo')).toHaveCount(1);
      await expect(comanda.locator('.pn-c-num')).toHaveText('#0023');
      expect(Math.abs((await comanda.boundingBox()).width - 72 * MM)).toBeLessThan(1.5);

      await page.locator('.pn-modal [data-m="imprimir"]').click();
      expect(await page.evaluate(() => window.__impressoes)).toBe(1);
      const pdf = await pdfDaImpressao(page);
      expect(pdf.paginas, 'cupom numa página só').toBe(1);
      expect(Math.abs(pdf.caixas[0].larguraPt - PT_72MM)).toBeLessThan(1.5);
      expect(erros, 'erros de JS').toEqual([]);
    });
  }

  test('com logo e QR a página de impressão continua com 72 mm × a altura do cupom, em uma página, e o QR cabe inteiro nela', async ({ page }) => {
    await entrar(page, [linha(24)]);
    await abrirComanda(page, 24);
    const alturaCupomMm = (await page.locator('.pn-comanda').boundingBox()).height / MM;
    await page.locator('.pn-modal [data-m="imprimir"]').click();
    expect(await page.evaluate(() => window.__impressoes)).toBe(1);
    const regra = await page.locator('#pn-pagina-impressao').textContent();
    const [, h] = regra.match(/size:\s*72mm\s+(\d+)mm;\s*margin:\s*0/) || [];
    expect(h, 'regra @page com 72mm de largura e margem 0: ' + regra).toBeTruthy();
    expect(Number(h)).toBeGreaterThanOrEqual(Math.floor(alturaCupomMm));
    expect(Number(h)).toBeLessThanOrEqual(Math.ceil(alturaCupomMm) + 4);

    const pdf = await pdfDaImpressao(page);
    expect(pdf.paginas, 'cupom numa página só').toBe(1);
    expect(Math.abs(pdf.caixas[0].larguraPt - PT_72MM), `largura da página ${pdf.caixas[0].larguraPt} pt`).toBeLessThan(1.5);
    expect(Math.abs(pdf.caixas[0].alturaPt - Number(h) * (72 / 25.4)), 'altura da página = a medida posta').toBeLessThan(1.5);

    // na mídia de impressão: a comanda tem 72 mm, o QR e a logo ficam dentro dela, o QR em preto sobre branco
    await page.emulateMedia({ media: 'print' });
    const m = await page.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return { esq: b.left, dir: b.right, base: b.bottom, l: b.width };
      };
      return {
        comanda: r('.pn-comanda'), qr: r('.pn-c-qr svg'), logo: r('.pn-c-logo'),
        caminho: document.querySelector('.pn-c-qr svg path').getAttribute('fill'), fundo: document.querySelector('.pn-c-qr svg rect').getAttribute('fill'),
        preto: getComputedStyle(document.querySelector('.pn-c-qr svg path')).fill
      };
    });
    await page.emulateMedia({ media: 'screen' });
    expect(Math.abs(m.comanda.l - 72 * MM)).toBeLessThan(1.5);
    for (const parte of [m.qr, m.logo]) {
      expect(parte.esq).toBeGreaterThanOrEqual(m.comanda.esq - 0.5);
      expect(parte.dir).toBeLessThanOrEqual(m.comanda.dir + 0.5);
      expect(parte.base).toBeLessThanOrEqual(m.comanda.base + 0.5);
    }
    expect(m.qr.l / MM).toBeGreaterThanOrEqual(28);
    expect(m.qr.l / MM).toBeLessThanOrEqual(40);
    expect([m.caminho, m.fundo]).toEqual(['#000', '#fff']);
    expect(m.preto).toBe('rgb(0, 0, 0)');
  });

  test('a impressão espera a logo que ainda não chegou e imprime uma vez só, mesmo com cliques repetidos em Imprimir', async ({ page }) => {
    let liberar;
    const solta = new Promise((ok) => (liberar = ok));
    await page.route('**/assets/logo/logo-512.webp', async (rota) => {
      await solta;
      await rota.continue();
    });
    await entrar(page, [linha(25)]);
    await page.locator('.pn-card[data-id$="25"] [data-act="imprimir"]').click();
    await expect(page.locator('.pn-comanda')).toBeVisible();
    expect(await page.locator('.pn-c-logo').evaluate((i) => i.complete), 'a logo ainda está a caminho').toBe(false);
    // quem não vê nada acontecer clica de novo: durante a espera, os cliques a mais não podem virar outras impressões
    for (let i = 0; i < 3; i++) await page.locator('.pn-modal [data-m="imprimir"]').click();
    expect(await page.evaluate(() => window.__impressoes), 'espera a logo').toBe(0);
    liberar();
    await expect.poll(() => page.evaluate(() => window.__impressoes), { message: 'imprime quando a logo chega' }).toBe(1);
    expect(await page.locator('.pn-c-logo').evaluate((i) => i.complete && i.naturalWidth), 'a logo já estava pronta').toBe(512);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__impressoes), 'uma vez só').toBe(1);
    const regra = await page.locator('#pn-pagina-impressao').textContent();
    const h = Number(regra.match(/72mm\s+(\d+)mm/)[1]);
    expect(h).toBeGreaterThanOrEqual(Math.floor((await page.locator('.pn-comanda').boundingBox()).height / MM));
  });

  test('logo que nunca chega: imprime mesmo assim em poucos segundos; fechar o diálogo antes cancela a impressão', async ({ page }) => {
    const presas = [];
    await page.route('**/assets/logo/logo-512.webp', (rota) => presas.push(rota)); // nunca responde
    await entrar(page, [linha(26)]);
    await abrirComanda(page, 26);
    await page.locator('.pn-modal [data-m="imprimir"]').click();
    expect(await page.evaluate(() => window.__impressoes)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__impressoes), { timeout: 6000, message: 'sai com o tempo limite' }).toBe(1);

    // fechou o diálogo durante a espera: nada é impresso
    await page.keyboard.press('Escape');
    await expect(page.locator('.pn-modal')).toHaveCount(0);
    await abrirComanda(page, 26);
    await page.locator('.pn-modal [data-m="imprimir"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pn-modal')).toHaveCount(0);
    await page.waitForTimeout(2600);
    expect(await page.evaluate(() => window.__impressoes), 'diálogo fechado: não imprime').toBe(1);
    for (const rota of presas) await rota.abort().catch(() => {});
  });

  test('o PDF da impressão, rasterizado a 203 dpi em 1 bit, ainda deixa ler o QR do entregador', async ({ page }, testInfo) => {
    test.skip(!temPdftoppm, 'sem pdftoppm (poppler) no PATH');
    const pedido = linha(27);
    await entrar(page, [pedido]);
    await abrirComanda(page, 27);
    await page.locator('.pn-modal [data-m="imprimir"]').click();
    const base = await page.evaluate(() => window.MLQr.base);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    const caminho = testInfo.outputPath('comanda-qr.pdf');
    const imagem = testInfo.outputPath('comanda-qr');
    writeFileSync(caminho, pdf);
    execFileSync('pdftoppm', ['-r', '203', '-png', '-singlefile', caminho, imagem]);
    await testInfo.attach('comanda-termica-qr', { path: imagem + '.png', contentType: 'image/png' });
    const png = await sharp(imagem + '.png').toBuffer();
    expect(await lerQr(png, { umBit: true }), 'QR lido na página inteira, em 1 bit').toBe(base + '/motoboy/#' + pedido.id);
  });
});

// A resolução da térmica (203 dpi = 2,1146 pixels de tela por ponto): o navegador desenha o QR vetorial em ~6,4 pontos por módulo.
// Não precisa do poppler: é a captura da própria página em mídia de impressão, passada a 1 bit.
test.describe('na resolução da térmica', () => {
  test.use({ deviceScaleFactor: 203 / 96 });

  test('em mídia de impressão e em 1 bit (203 dpi) o QR do entregador ainda lê', async ({ page }) => {
    const pedido = linha(28);
    await entrar(page, [pedido]);
    await page.setViewportSize({ width: 1280, height: 1400 }); // a comanda inteira cabe na captura
    await abrirComanda(page, 28);
    const base = await page.evaluate(() => window.MLQr.base);
    await page.emulateMedia({ media: 'print' });
    const png = await page.locator('.pn-comanda').screenshot();
    await page.emulateMedia({ media: 'screen' });
    expect(await lerQr(png, { umBit: true }), 'página inteira em 1 bit').toBe(base + '/motoboy/#' + pedido.id);
  });
});
