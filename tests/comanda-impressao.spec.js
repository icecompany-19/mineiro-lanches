// Comanda para a impressora térmica (papel 72 mm × 210 mm, 203 dpi) e informações em negrito (cliente, 16/10/2026):
//   - a comanda tem 72 mm de largura na tela e na impressão, e a página de impressão ganha 72 mm × a altura do cupom,
//     sem margem, venha a impressão do cartão, do detalhe do pedido ou da própria visualização;
//   - cada pedido imprime em UMA página (nada de cupom cortado em duas folhas);
//   - as informações saem em negrito; a taxa de entrega aparece na comanda.
// O quadro vem de page.route sobre o GET dos pedidos (o banco não é alterado) e o window.print é trocado por um espião.
// Uso: npx playwright test tests/comanda-impressao.spec.js --project=desktop   (precisa do Supabase local no ar)
/* global window, document, getComputedStyle */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const MM = 96 / 25.4; // px por mm no CSS
const PT_72MM = (72 / 25.4) * 72; // 204,09 pt

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

test('pedido sem taxa calculada mostra "TAXA DE ENTREGA A COMBINAR" na comanda', async ({ page }) => {
  await entrar(page, [linha(14, { taxa_entrega: null, distancia_km: null, total: 97.7 })]);
  await page.locator('.pn-card[data-id$="14"] [data-act="imprimir"]').click();
  await expect(page.locator('.pn-comanda')).toContainText('TAXA DE ENTREGA A COMBINAR');
});

test('impressão térmica tem margens brancas, sem faixas escuras ou sombras do painel', async ({ page }, testInfo) => {
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
