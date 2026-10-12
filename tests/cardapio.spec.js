// Cardápio e checkout com o estado do banco (estado_cardapio) diferente do CONFIG: preço do combo nos textos
// fixos do HTML, adicional que saiu do cardápio com o item já na sacola, erros do checkout acessíveis e o foco
// visível nas telas escuras (anel --fio). O estado vem do Supabase local, alterado no caminho (page.route), sem mexer no banco.
// Uso: npx playwright test tests/cardapio.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global window, localStorage, document */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { carregarCore } from '../scripts/gerar-seed.mjs';

const RAIZ = resolve(import.meta.dirname, '..');
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

// estado_cardapio do servidor com uma mudança aplicada por cima
async function mudarEstado(page, mudar) {
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await r.fetch();
    const j = await resposta.json();
    mudar(j);
    await r.fulfill({ response: resposta, json: j });
  });
}
// sacola guardada no aparelho antes de abrir a página (carga nova, não só troca de hash)
async function abrirComSacola(page, sacola, hash) {
  await page.goto('/');
  await page.evaluate((s) => localStorage.setItem('mineiro:v2:sacola', JSON.stringify(s)), sacola);
  await page.goto('about:blank');
  await page.goto('/' + hash);
}
const linha = (produtoId, adicionais) => ({
  chave: produtoId + '|teste',
  sel: {
    produtoId,
    completo: true,
    removidos: [],
    prensado: false,
    combo: { ativo: false, refri: '' },
    adicionais: adicionais || {},
    sabor: '',
    qtd: 1
  }
});

test('os preços escritos no HTML seguem o CONFIG e, na página, o preço do banco', async ({ page, request }) => {
  // o HTML (sem JS, inclusive as metas de SEO) sai com o preço do combo do CONFIG, que é o mesmo do seed
  const { CONFIG } = carregarCore(resolve(RAIZ, 'src/core.js'));
  const combo = brl(CONFIG.regras.combo.preco);
  const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf8');
  const noHtml = [...html.matchAll(/(?:combo por \+|data-combo-preco>)(R\$ \d+,\d\d)/g)].map((m) => m[1]);
  expect(noHtml.length, 'textos de combo no index.html (3 metas + 5 na página)').toBe(8);
  expect([...new Set(noHtml)], 'preço do combo escrito no HTML = CONFIG').toEqual([combo]);
  expect((await (await request.get('/')).text()).match(/data-combo-preco/g).length).toBe(5);

  // o banco manda outro preço: todos os textos fixos da página trocam
  await mudarEstado(page, (j) => {
    j.loja.comboPreco = 16.5;
    j.precos['dog-max'] = 24.5;
    j.precos['gran-bacon-onion'] = 35.5;
  });
  await page.goto('/');
  const textos = () => page.evaluate(() => [...document.querySelectorAll('[data-combo-preco]')].map((e) => e.textContent));
  await expect.poll(textos).toEqual(Array(5).fill('R$ 16,50'));
  await expect(page.locator('.bio-ctas + .faixa-combo')).toContainText('+R$ 16,50 · batata frita');
  expect(await page.locator('body').innerText()).not.toContain('+R$ 14,90');
  await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
  await expect(page.locator('[data-screen="menu"] .faixa-combo')).toContainText('+R$ 16,50');
  await expect(page.locator('#prod-gran-burger .selo-combo')).toHaveText('Vira combo +R$ 16,50');
  expect(await page.locator('body').innerText()).not.toContain('+R$ 14,90');
  await page.goto('/#site');
  await expect(page.locator('#monte-switch')).toContainText('Vira combo +R$ 16,50');
  await expect(page.locator('[data-preco-de="dog-max"]')).toHaveText('R$ 24,50');
  expect(await page.locator('.palco__dica').textContent()).toBe('Gran Bacon Onion · R$ 35,50');
});

test('adicional que saiu do cardápio com o lanche na sacola: a linha acusa, o envio não sai e editar tira o adicional', async ({
  page
}) => {
  await mudarEstado(page, (j) => {
    delete j.adicionais.bacon;
  });
  let envios = 0;
  await page.route('**/rest/v1/rpc/criar_pedido', (r) => {
    envios++;
    return r.abort();
  });
  await abrirComSacola(page, [linha('gran-burger', { bacon: 1 })], '#sacola');
  await expect.poll(() => page.evaluate(() => !!window.ML.adicionais.bacon.inativo)).toBe(true);
  const l = page.locator('#sacola-linhas .linha');
  await expect(l).toHaveClass(/esgotado/);
  await expect(l.locator('.tag.adic')).toHaveText('+ Bacon · fora do cardápio');
  await expect(l.locator('.upsell')).toHaveCount(0);

  // o checkout nem manda ao servidor (ele recusaria com produto_invalido) e diz qual item é o problema
  await page.locator('#btn-continuar').click();
  await page.locator('#f-nome').fill('Ana Teste');
  await page.locator('#f-tel').fill('11985720150');
  await page.locator('[data-modo="local"]').click();
  await page.locator('#btn-enviar').click();
  const erro = page.locator('#envio-erro');
  await expect(erro).toContainText('Um item da sacola saiu do cardápio');
  await expect(erro).toContainText('Bacon (adicional do Gran Burger) não está disponível agora');
  expect(envios).toBe(0);

  // editar a linha: a ficha não tem o bacon e salvar tira o adicional (o preço volta ao do lanche)
  await page.getByRole('button', { name: 'Ajustar a sacola' }).click();
  await page.locator('[data-editar]').click();
  await expect(page.locator('#ficha [data-adic="bacon"]')).toHaveCount(0);
  await page.locator('#ficha-add').click();
  await expect(page.locator('#ficha')).toBeHidden();
  await expect(l).not.toHaveClass(/esgotado/);
  await expect(l.locator('.tag.adic')).toHaveCount(0);
  await expect(l.locator('.linha-nome .preco')).toHaveText('R$ 25,90');
});

test('checkout: o erro de cada campo chega ao leitor de tela (aria-invalid e descrição)', async ({ page }) => {
  await abrirComSacola(page, [linha('x-burguer')], '#checkout');
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
  await page.locator('[data-modo="entrega"]').click();
  await page.locator('#btn-enviar').click();
  const nome = page.locator('#f-nome');
  await expect(nome).toBeFocused();
  await expect(nome).toHaveAttribute('aria-invalid', 'true');
  await expect(nome).toHaveAccessibleDescription('Escreva seu nome para o truck chamar você.');
  await expect(page.locator('#f-tel')).toHaveAccessibleDescription('Informe o telefone com DDD para o truck falar com você.');
  await expect(page.locator('#f-end')).toHaveAccessibleDescription('Informe o endereço para a entrega.');
  // corrigido o nome: ele deixa de estar inválido; os outros continuam
  await nome.fill('Ana');
  await page.locator('#btn-enviar').click();
  await expect(nome).toHaveAttribute('aria-invalid', 'false');
  await expect(nome).not.toHaveAttribute('aria-describedby');
  await expect(page.locator('#f-tel')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-tel')).toBeFocused();
});

test('foco do teclado visível nas telas escuras: anel fio dourado (#FFCC00, 12,9:1 sobre a noite)', async ({ page }) => {
  await page.goto('/#cardapio');
  await page.locator('#prod-gran-burger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ficha')).toBeVisible();
  const alvo = page.locator('#ficha [data-completo="0"]');
  for (let i = 0; i < 12 && !(await alvo.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(alvo).toBeFocused();
  // o .opt tem transição: espera a cor assentar
  await expect
    .poll(() =>
      alvo.evaluate((el) => {
        const c = window.getComputedStyle(el);
        return { cor: c.outlineColor, estilo: c.outlineStyle, visivel: el.matches(':focus-visible') };
      })
    )
    .toEqual({ cor: 'rgb(255, 204, 0)', estilo: 'solid', visivel: true });
});
