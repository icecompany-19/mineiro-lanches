// Topo do cardápio com os hot dogs na frente (desenho de 22/11/2026: docs/superpowers/specs/2026-11-22-hotdogs-topo-cardapio-design.md).
// Hot dog como primeira categoria, busca atrás da lupa, carrossel de fotos, índice do cardápio que vira a barra de categorias,
// régua de tamanhos e a faixa do combo depois dos hot dogs. O estado vem do Supabase local; mudanças só pelo page.route.
// Uso: npx playwright test tests/cardapio-topo.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
import { test, expect } from '@playwright/test';
import { instalarApoio, rolagemHorizontal, alvosPequenos } from './apoio/aceite.js';

test('hot dog é a primeira categoria do cardápio', async ({ page }) => {
  await page.goto('/#cardapio');
  await expect(page.locator('#menu-lista .cat').first()).toHaveAttribute('id', 'cat-hotdog');
});

// ---------- busca atrás da lupa ----------
const lupa = (page) => page.locator('[data-screen="menu"] .tela-cab [data-busca-abrir]');

test('lupa abre a busca e foca o campo; Esc fecha', async ({ page }) => {
  await page.goto('/#cardapio');
  await expect(page.locator('#f-busca')).toBeHidden();
  await lupa(page).click();
  await expect(page.locator('#f-busca')).toBeVisible();
  await expect(page.locator('#f-busca')).toBeFocused();
  await expect(lupa(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#f-busca')).toBeHidden();
  await expect(lupa(page)).toHaveAttribute('aria-expanded', 'false');
});

test('buscar esconde o topo e mostra só o resultado', async ({ page }) => {
  await page.goto('/#cardapio');
  await lupa(page).click();
  await page.fill('#f-busca', 'bacon');
  await expect(page.locator('[data-screen="menu"]')).toHaveClass(/\bbuscando\b/);
  await expect(page.locator('#car-hd')).toBeHidden();
  await expect(page.locator('#indice')).toBeHidden();
  const textos = await page.locator('#menu-lista .prod').allTextContents();
  expect(textos.length).toBeGreaterThan(0);
  for (const t of textos) expect(t.toLowerCase()).toContain('bacon');
});

test('fechar a busca limpa texto e filtro', async ({ page }) => {
  await page.goto('/#cardapio');
  await lupa(page).click();
  await page.fill('#f-busca', 'bacon');
  await page.locator('[data-filtro="frango"]').click();
  await page.locator('[data-busca-fechar]').click();
  await expect(page.locator('#f-busca')).toBeHidden();
  await expect(page.locator('#f-busca')).toHaveValue('');
  await expect(page.locator('[data-filtro][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="menu"]')).not.toHaveClass(/\bbuscando\b/);
  await expect(page.locator('#menu-lista .cat')).toHaveCount(7);
});

test('sair do cardápio com a busca aberta não deixa filtro escondido', async ({ page }) => {
  await page.goto('/#cardapio');
  await lupa(page).click();
  await page.fill('#f-busca', 'bacon');
  await page.locator('[data-screen="menu"] [data-voltar]').click();
  await page.locator('[data-screen="bio"] .bio-ctas [data-go="menu"]').click();
  await expect(page.locator('#f-busca')).toBeHidden();
  await expect(page.locator('#f-busca')).toHaveValue('');
  await expect(page.locator('#menu-lista .cat')).toHaveCount(7);
});

// ---------- carrossel dos hot dogs ----------
// estado_cardapio do servidor com uma mudança aplicada por cima (o mesmo jeito do cardapio.spec.js)
async function mudarEstado(page, mudar) {
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await r.fetch();
    const j = await resposta.json();
    mudar(j);
    await r.fulfill({ response: resposta, json: j });
  });
}
const slides = (page) => page.locator('#car-trilho .car-slide');

test('carrossel mostra os 4 hot dogs com o preço do catálogo', async ({ page }) => {
  await page.goto('/#cardapio');
  await expect(slides(page)).toHaveCount(4);
  await expect(page.locator('#car-trilho .car-preco')).toHaveText(['a partir de R$ 14,99', 'R$ 35,99', 'R$ 26,99', 'R$ 24,99']);
  await expect(page.locator('#car-trilho .car-tit')).toHaveText(['Hot dog', 'CBO Turbo', 'Dog Pizza', 'Doritos Max']);
  await expect(slides(page).first().locator('.car-n')).toHaveText('1/4');
  await expect(page.locator('#car-pontos i')).toHaveCount(4);
});

test('esgotado sai do carrossel; sem nenhum, o carrossel some', async ({ page }) => {
  let esgotados = ['dog-pizza'];
  await mudarEstado(page, (j) => { j.esgotados = esgotados; });
  await page.goto('/#cardapio');
  await expect(slides(page)).toHaveCount(3);
  await expect(page.locator('#car-trilho')).not.toContainText('Dog Pizza');
  esgotados = ['dog-medio', 'dog-max', 'dog-super', 'dog-cbo-turbo', 'dog-pizza', 'dog-doritos'];
  await page.reload();
  await expect(page.locator('#car-hd')).toBeHidden();
});

test('preço novo do banco aparece no carrossel', async ({ page }) => {
  await mudarEstado(page, (j) => { j.precos['dog-medio'] = 13.5; });
  await page.goto('/#cardapio');
  await expect(page.locator('#car-trilho .car-preco').first()).toHaveText('a partir de R$ 13,50');
});

test('Pedir este abre a ficha e Ver tamanhos leva aos hot dogs', async ({ page }) => {
  await page.goto('/#cardapio');
  await slides(page).filter({ hasText: 'CBO Turbo' }).getByRole('button', { name: 'Pedir este' }).click();
  await expect(page.locator('#ficha')).toBeVisible();
  await expect(page.locator('#ficha-nome')).toHaveText('Hot Dog CBO Turbo');
  await page.locator('#ficha [data-fechar-ficha]').first().click();
  await expect(page.locator('#ficha')).toBeHidden();
  await slides(page).first().getByRole('button', { name: 'Ver tamanhos' }).click();
  await expect(page.locator('#cat-hotdog .cat-cab')).toBeInViewport();
});

test('carrossel não anda sozinho', async ({ page }) => {
  await page.goto('/#cardapio');
  await expect(slides(page)).toHaveCount(4);
  await page.waitForTimeout(5000);
  expect(await page.locator('#car-trilho').evaluate((t) => t.scrollLeft)).toBe(0);
});

// ---------- índice do cardápio e barra de categorias ----------
test('índice mostra as 7 categorias e o total', async ({ page }) => {
  await page.goto('/#cardapio');
  const tiles = page.locator('#indice .indice-tile[data-ir-cat]');
  await expect(tiles).toHaveCount(7);
  await expect(tiles.first()).toContainText('Hot dog');
  await expect(tiles.first()).toContainText('9 itens');
  await expect(page.locator('#indice-total')).toHaveText('56 itens');
  await expect(page.locator('#indice [data-busca-abrir]')).toBeVisible();
});

test('tocar no índice leva à categoria', async ({ page }) => {
  await page.goto('/#cardapio');
  await page.locator('#indice [data-ir-cat="combos"]').click();
  await expect(page.locator('#ct-combos')).toBeInViewport();
});

test('barra de categorias só aparece depois do índice', async ({ page }) => {
  await page.goto('/#cardapio');
  await expect(page.locator('#indice')).toBeVisible();
  await expect(page.locator('#chips')).toBeHidden();
  await page.locator('#cat-artesanais').evaluate((c) => c.scrollIntoView({ block: 'start' }));
  await expect(page.locator('#chips')).toBeVisible();
  await expect(page.locator('[data-chip="artesanais"]')).toHaveAttribute('aria-pressed', 'true');
});

test('link direto abre na categoria, com o título fora do cabeçalho e da barra', async ({ page }) => {
  await page.goto('/#cardapio/combos');
  await expect(page.locator('#ct-combos')).toBeInViewport();
  await expect(page.locator('#chips')).toBeVisible();
  await expect.poll(async () => {
    const t = await page.locator('#ct-combos').boundingBox();
    const b = await page.locator('#chips').boundingBox();
    return Math.round(t.y - (b.y + b.height));
  }).toBeGreaterThanOrEqual(0);
});

for (const [largura, altura] of [[320, 640], [1280, 800]]) {
  test(`largura ${largura}: topo sem rolagem lateral e alvos de 44 px`, async ({ page }) => {
    await instalarApoio(page);
    await page.setViewportSize({ width: largura, height: altura });
    await page.goto('/#cardapio');
    await expect(page.locator('#car-trilho .car-slide')).toHaveCount(4);
    const r = await rolagemHorizontal(page);
    expect(r.andou).toBe(0);
    expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth);
    for (const raiz of ['#car-hd', '#indice', '#cat-hotdog .regua']) {
      const { pequenos } = await alvosPequenos(page, raiz, 44);
      expect(pequenos.map((p) => `${p.quem} "${p.texto}" ${p.medida}`), raiz).toEqual([]);
    }
  });
}
