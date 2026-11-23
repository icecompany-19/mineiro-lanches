// Topo do cardápio com os hot dogs na frente (desenho de 22/11/2026: docs/superpowers/specs/2026-11-22-hotdogs-topo-cardapio-design.md).
// Hot dog como primeira categoria, busca atrás da lupa, carrossel de fotos, índice do cardápio que vira a barra de categorias,
// régua de tamanhos e a faixa do combo depois dos hot dogs. O estado vem do Supabase local; mudanças só pelo page.route.
// Uso: npx playwright test tests/cardapio-topo.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
import { test, expect } from '@playwright/test';

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
