// Preço do CBO Turbo confirmado em R$ 34,90 e proteção caso um produto perca o preço no banco:
// o card mostra "Preço a confirmar", a ficha não deixa adicionar e oferece "Consultar no WhatsApp" com a mensagem
// pronta, e o item nunca fica na sacola. O horário da semana mostra o domingo aberto.
// Só comportamento: o visual definitivo é do agente de design.
// Uso: npx playwright test tests/preco-a-confirmar.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global localStorage */
import { test, expect } from '@playwright/test';

const ID = 'dog-cbo-turbo';
const sacolaGuardada = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:sacola') || '[]'));

test('Preço a confirmar: aparece no cardápio, não vai para a sacola e oferece o WhatsApp', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  // simula o preço retirado no banco (o CBO Turbo de produção custa R$ 34,90).
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await r.fetch();
    const j = await resposta.json();
    j.precos[ID] = null;
    await r.fulfill({ response: resposta, json: j });
  });
  const estado = page.waitForResponse('**/rest/v1/rpc/estado_cardapio');
  await page.goto('/#cardapio');
  expect((await (await estado).json()).precos[ID]).toBeNull();

  const card = page.locator('#prod-' + ID);
  await expect(card.locator('.preco')).toHaveText('Preço a confirmar');
  await expect(card.locator('.selo-combo')).toHaveCount(0);
  await expect(card).toContainText('3 salsichas Perdigão');
  await expect(page.locator('#cat-hotdog .cat-cab small')).toContainText('Dog Bacon ou Dog Pizza');

  // ficha: sem opções de montar, botão de adicionar desligado e o WhatsApp com a mensagem pronta
  await card.click();
  const ficha = page.locator('#ficha');
  await expect(ficha).toBeVisible();
  await expect(ficha.locator('.ficha-cab .preco')).toHaveText('Preço a confirmar');
  await expect(page.locator('#ficha-add')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#ficha-add-txt')).toHaveText('Preço a confirmar');
  await expect(page.locator('#ficha-total')).toHaveText('');
  await expect(page.locator('#ficha [data-fq="1"]')).toBeDisabled();
  await expect(ficha.locator('[data-combo], [data-adic], [data-completo]')).toHaveCount(0);
  const wa = page.locator('#ficha-consulta');
  await expect(wa).toHaveText(/Consultar no WhatsApp/);
  const href = await wa.getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/5511985720150\?text=/);
  expect(decodeURIComponent(href.split('?text=')[1])).toBe(
    'Olá, Mineiro Lanche! Vi o Hot Dog CBO Turbo no cardápio e quero saber o preço. Como faço para pedir?'
  );

  // tocar no botão desligado não põe nada na sacola (aria-disabled: o Playwright não clica; o evento vai direto)
  await page.locator('#ficha-add').dispatchEvent('click');
  await expect(ficha).toBeVisible();
  expect(await sacolaGuardada(page)).toEqual([]);

  // a ficha de um item com preço volta ao normal depois
  await page.locator('[data-fechar-ficha]').click();
  await expect(ficha).toBeHidden();
  await page.locator('#prod-dog-max').click();
  await expect(page.locator('#ficha-add')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#ficha-add-txt')).toHaveText('Adicionar');
  await expect(page.locator('#ficha-total')).toHaveText('R$ 15,90');
  await expect(page.locator('#ficha [data-fq="1"]')).toBeEnabled();
  await expect(ficha.locator('.ficha-nota')).toContainText('Dog Bacon ou Dog Pizza');
  expect(erros).toEqual([]);
});

test('CBO Turbo por R$ 34,90 pode ser personalizado e adicionado à sacola', async ({ page }) => {
  await page.goto('/#cardapio');
  const card = page.locator('#prod-' + ID);
  await expect(card.locator('.preco')).toHaveText('R$ 34,90');
  await expect(card.locator('.selo-combo')).toContainText('Vira combo');
  await card.click();
  await expect(page.locator('#ficha-total')).toHaveText('R$ 34,90');
  await expect(page.locator('#ficha-add')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#ficha [data-adic="bacon"][data-d="1"]')).toHaveCount(1);
  await page.locator('#ficha-add').click();
  await expect(page.locator('#ficha')).toBeHidden();
  await page.goto('/#sacola');
  const linha = page.locator('#sacola-linhas .linha');
  await expect(linha).toHaveCount(1);
  await expect(linha).toContainText('Hot Dog CBO Turbo');
  await expect(linha.locator('.linha-nome .preco')).toHaveText('R$ 34,90');
  expect((await sacolaGuardada(page))[0].sel.produtoId).toBe(ID);
});

test('horário da semana: domingo abre das 19h à 1h e a quarta aparece fechada', async ({ page }) => {
  await page.goto('/#site');
  const domingo = page.locator('[data-semana] li', { hasText: 'Domingo' }).first();
  await expect(domingo.locator('.hora')).toHaveText('19h–1h');
  await expect(domingo.locator('.faixa')).toHaveCount(1);
  // a régua vai de 19h a 1h: o turno ocupa a escala inteira
  await expect(domingo.locator('.faixa')).toHaveAttribute('style', 'left:0%;width:100%');
  const quarta = page.locator('[data-semana] li', { hasText: 'Quarta' }).first();
  await expect(quarta.locator('.hora')).toHaveText('fechado');
  await expect(quarta).toHaveClass(/fechado/);
  await expect(quarta.locator('.faixa')).toHaveCount(0);
  await expect(page.locator('[data-semana]').first()).not.toContainText('a confirmar');
});
