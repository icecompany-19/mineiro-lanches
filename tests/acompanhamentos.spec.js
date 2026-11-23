// Acompanhamentos na sacola (23/11/2026): batata, onion e bebidas para o cliente somar ao próprio pedido com um toque.
// Preço e disponibilidade vêm do catálogo; bebida com sabor abre a ficha para escolher. O estado vem do Supabase local.
// Uso: npx playwright test tests/acompanhamentos.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
import { test, expect } from '@playwright/test';
import { rolagemHorizontal } from './apoio/aceite.js';

async function mudarEstado(page, mudar) {
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await r.fetch();
    const j = await resposta.json();
    mudar(j);
    await r.fulfill({ response: resposta, json: j });
  });
}
// um Hot Dog Médio na sacola pelo "+" do cardápio e a sacola aberta
async function sacolaComLanche(page) {
  await page.goto('/#cardapio');
  await page.locator('#prod-dog-medio').locator('xpath=..').locator('[data-rapido]').click();
  await page.goto('/#sacola');
  await expect(page.locator('#sacola-linhas .linha')).toHaveCount(1);
}
const acomp = (page) => page.locator('#acomp .acomp-item');

test('sacola vazia não mostra acompanhamentos', async ({ page }) => {
  await page.goto('/#sacola');
  await expect(page.locator('#acomp')).toBeHidden();
});

test('sacola com lanche mostra os acompanhamentos com o preço do catálogo', async ({ page }) => {
  await sacolaComLanche(page);
  await expect(page.locator('#acomp')).toBeVisible();
  await expect(acomp(page).first()).toContainText('Batata frita P');
  const textos = await acomp(page).allTextContents();
  expect(textos.length).toBeGreaterThanOrEqual(5);
  for (const t of textos) expect(t).toMatch(/R\$ \d+,\d\d/);
  expect(textos.join(' ')).toContain('Porção de onion');
  expect(textos.join(' ')).toContain('Refrigerante lata');
});

test('o + de um acompanhamento sem sabor soma direto ao pedido', async ({ page }) => {
  await sacolaComLanche(page);
  await acomp(page).filter({ hasText: 'Porção de onion' }).getByRole('button').click();
  await expect(page.locator('#sacola-linhas .linha')).toHaveCount(2);
  await expect(page.locator('#sacola-linhas')).toContainText('Porção de onion');
});

test('bebida com sabor abre a ficha para escolher', async ({ page }) => {
  await sacolaComLanche(page);
  await acomp(page).filter({ hasText: 'Refrigerante lata' }).getByRole('button').click();
  await expect(page.locator('#ficha')).toBeVisible();
  await expect(page.locator('#ficha-nome')).toHaveText('Refrigerante lata');
});

test('acompanhamento esgotado sai da lista', async ({ page }) => {
  await mudarEstado(page, (j) => { j.esgotados = ['porcao-onion']; });
  await sacolaComLanche(page);
  await expect(page.locator('#acomp')).not.toContainText('Porção de onion');
});

for (const largura of [320, 390]) {
  test(`largura ${largura}: a faixa de acompanhamentos não estica a sacola`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 760 });
    await sacolaComLanche(page);
    await expect(page.locator('#acomp')).toBeVisible();
    const r = await rolagemHorizontal(page);
    expect(r.andou).toBe(0);
    expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth);
    const larguraLinha = await page.locator('#sacola-linhas .linha').first().evaluate((e) => Math.round(e.getBoundingClientRect().right));
    expect(larguraLinha).toBeLessThanOrEqual(largura);
  });
}
