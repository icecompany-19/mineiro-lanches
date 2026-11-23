// Topo do cardápio com os hot dogs na frente (desenho de 22/11/2026: docs/superpowers/specs/2026-11-22-hotdogs-topo-cardapio-design.md).
// Hot dog como primeira categoria, busca atrás da lupa, carrossel de fotos, índice do cardápio que vira a barra de categorias,
// régua de tamanhos e a faixa do combo depois dos hot dogs. O estado vem do Supabase local; mudanças só pelo page.route.
// Uso: npx playwright test tests/cardapio-topo.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
import { test, expect } from '@playwright/test';

test('hot dog é a primeira categoria do cardápio', async ({ page }) => {
  await page.goto('/#cardapio');
  await expect(page.locator('#menu-lista .cat').first()).toHaveAttribute('id', 'cat-hotdog');
});
