/* global localStorage */
import { test, expect } from '@playwright/test';

for (const [entrada, seletor] of [['no nome', '.prod-nome'], ['na foto', '.foto img']]) {
  test(`tocar ${entrada} abre os opcionais visíveis e permite personalizar o lanche`, async ({ page, isMobile }) => {
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    const tocar = (el) => isMobile ? el.tap() : el.click();
    await page.goto('/#cardapio');
    await tocar(page.locator('#prod-gran-burger ' + seletor));
    const ficha = page.locator('#ficha');
    const corpo = page.locator('#ficha-corpo');
    await expect(ficha).toHaveAttribute('open', '');
    // Só open/isVisible não basta: no WebKit o corpo ficava com 0 px e nada aparecia.
    await expect.poll(() => corpo.evaluate((el) => el.clientHeight)).toBeGreaterThan(200);
    await expect(page.locator('#ficha-nome')).toBeInViewport();
    await expect(page.locator('#ficha-add')).toBeInViewport();

    await tocar(ficha.locator('[data-completo="0"]'));
    await expect(ficha.locator('[data-ing]').first()).toBeInViewport();
    const ingrediente = await ficha.locator('[data-ing]').first().getAttribute('data-ing');
    await tocar(ficha.locator('[data-ing]').first());
    await expect(ficha.locator('[data-ing]').first()).toHaveAttribute('aria-pressed', 'false');
    await tocar(ficha.locator('[data-adic="bacon"][data-d="1"]'));
    await expect(ficha.locator('[data-adic="bacon"][data-d="1"]').locator('..').locator('output')).toHaveText('1');
    await tocar(page.locator('#ficha-add'));
    await expect(ficha).not.toHaveAttribute('open', '');
    const selecao = await page.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:sacola'))[0].sel);
    expect(selecao.removidos).toContain(ingrediente);
    expect(selecao.adicionais.bacon).toBe(1);

    // O dialog também deve voltar a abrir depois de adicionar à sacola.
    await tocar(page.locator('#prod-gran-burger ' + seletor));
    await expect.poll(() => corpo.evaluate((el) => el.clientHeight)).toBeGreaterThan(200);
    await tocar(ficha.locator('[data-fechar-ficha]'));
    await expect(ficha).not.toHaveAttribute('open', '');
    expect(erros).toEqual([]);
  });
}
