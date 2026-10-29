// Comanda para a impressora térmica (papel 72 mm × 210 mm, 203 dpi) e informações em negrito (cliente, 16/10/2026):
//   - a comanda tem 72 mm de largura na tela e na impressão, e a página de impressão ganha 72 mm × a altura do cupom,
//     sem margem, venha a impressão do cartão, do detalhe do pedido ou da própria visualização;
//   - cada pedido imprime em UMA página (nada de cupom cortado em duas folhas);
//   - as informações saem em negrito; a taxa de entrega aparece na comanda;
//   - (17/10, contrato C3 do docs/PLANO-FASE-3.md) a comanda abre com a logo oficial (logo-512.webp, arte intacta); a impressão
//     espera a logo se ela ainda não chegou.
//   - (29/10, entregas manuais) a tela do motoboy saiu: nenhuma comanda leva QR do entregador nem a legenda "ENTREGADOR: LEIA
//     AO ENTREGAR"; a de entrega fecha no TOTAL, como a de retirada e a de consumo no local.
// O quadro vem de page.route sobre o GET dos pedidos (o banco não é alterado) e o window.print é trocado por um espião.
// Uso: npx playwright test tests/comanda-impressao.spec.js --project=desktop   (precisa do Supabase local no ar)
// Os casos que rasterizam o PDF precisam do pdftoppm (poppler) no PATH; sem ele são pulados (padrão de tests/qrcode.test.mjs).
/* global window, document, getComputedStyle */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

// ---------- logo oficial (17/10/2026, contrato C3) e comanda sem QR do entregador (29/10/2026) ----------

// abre a comanda do pedido n (já no quadro) e espera o diálogo parar de animar (entra com opacidade e deslocamento)
async function abrirComanda(page, n) {
  await page.locator(`.pn-card[data-id$="${String(n).padStart(2, '0')}"] [data-act="imprimir"]`).click();
  await expect(page.locator('.pn-comanda')).toBeVisible();
  await expect(page.locator('.pn-modal-caixa')).toHaveCSS('opacity', '1');
  await expect(page.locator('.pn-modal-caixa')).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/); // a animação termina na identidade
}

test.describe('logo na comanda e comanda sem QR do entregador', () => {
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
    expect(tela.alt).toBe('Mineiro Lanche');
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

  test('a comanda de entrega sai sem QR do entregador nem a legenda "ENTREGADOR: LEIA AO ENTREGAR", e fecha no total', async ({ page }) => {
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await entrar(page, [linha(22)]);
    await abrirComanda(page, 22);
    const comanda = page.locator('.pn-comanda');

    // nada de QR: nem o bloco, nem a legenda, nem o número repetido, nem svg
    await expect(comanda.locator('.pn-c-qr')).toHaveCount(0);
    await expect(comanda.locator('.pn-c-qr-t, .pn-c-qr-n')).toHaveCount(0);
    await expect(comanda.locator('svg')).toHaveCount(0);
    await expect(comanda).not.toContainText('ENTREGADOR');
    await expect(comanda).not.toContainText('LEIA AO ENTREGAR');
    await expect(comanda.getByText('#0022')).toHaveCount(1); // só o número do topo

    // o resto da comanda de entrega continua: logo, número, endereço, taxa, pagamento e total
    await expect(comanda.locator('img.pn-c-logo')).toHaveCount(1);
    await expect(comanda.locator('.pn-c-num')).toHaveText('#0022');
    await expect(comanda.locator('.pn-c-modo')).toContainText(/entrega/i);
    await expect(comanda).toContainText('Marina Souza');
    await expect(comanda).toContainText('Rua Eliziél Alves Costa, 300');
    await expect(comanda).toContainText('Portão azul');
    await expect(comanda.locator('.pn-c-taxa')).toContainText('ENTREGA: R$ 8,00 · 4 km');
    await expect(comanda.locator('.pn-c-total')).toContainText('R$ 105,70');

    // o total é o último bloco: não sobra nada depois dele
    await expect(comanda.locator(':scope > *').last()).toHaveClass(/pn-c-total/);

    // imprimir continua em uma página de 72 mm
    await page.locator('.pn-modal [data-m="imprimir"]').click();
    expect(await page.evaluate(() => window.__impressoes)).toBe(1);
    const pdf = await pdfDaImpressao(page);
    expect(pdf.paginas, 'cupom numa página só').toBe(1);
    expect(Math.abs(pdf.caixas[0].larguraPt - PT_72MM)).toBeLessThan(1.5);
    expect(erros, 'erros de JS').toEqual([]);
  });

  for (const modo of ['retirada', 'local']) {
    test(`pedido de ${modo} sai sem QR, sem erro, e a comanda continua com logo, 72 mm e uma página`, async ({ page }) => {
      const erros = [];
      page.on('pageerror', (e) => erros.push(e.message));
      await entrar(page, [linha(23, { modo, endereco: '', referencia: '', taxa_entrega: null, distancia_km: null, total: 97.7 })]);
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

  test('com a logo a página de impressão da entrega continua com 72 mm × a altura do cupom, em uma página, e a logo cabe inteira nela', async ({ page }) => {
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

    // na mídia de impressão: a comanda tem 72 mm, a logo fica dentro dela e não há QR nem imagem além da logo
    await page.emulateMedia({ media: 'print' });
    const m = await page.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return { esq: b.left, dir: b.right, base: b.bottom, l: b.width };
      };
      return { comanda: r('.pn-comanda'), logo: r('.pn-c-logo'), qr: document.querySelectorAll('.pn-comanda .pn-c-qr, .pn-comanda svg').length, imagens: document.querySelectorAll('.pn-comanda img').length };
    });
    await page.emulateMedia({ media: 'screen' });
    expect(Math.abs(m.comanda.l - 72 * MM)).toBeLessThan(1.5);
    expect(m.logo.esq).toBeGreaterThanOrEqual(m.comanda.esq - 0.5);
    expect(m.logo.dir).toBeLessThanOrEqual(m.comanda.dir + 0.5);
    expect(m.logo.base).toBeLessThanOrEqual(m.comanda.base + 0.5);
    expect([m.qr, m.imagens], 'sem QR; só a logo').toEqual([0, 1]);
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
});
