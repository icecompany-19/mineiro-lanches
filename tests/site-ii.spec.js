// Cenas do site imersivo da trilha site-II (docs/DIRECAO-VISUAL.md 6.2): S1 fitas, S1b placa do cardápio e S3 prensado.
// Cada cena confere o que o aceite do plano pede (docs/PLANO-FASE-2.md, B11 a B13). O estado do banco (estado_cardapio)
// vem do Supabase local, alterado no caminho (page.route), sem mexer no banco.
// Uso: npx playwright test tests/site-ii.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global document, window, requestAnimationFrame */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { carregarCore } from '../scripts/gerar-seed.mjs';

const RAIZ = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf8');
const { CONFIG } = carregarCore(resolve(RAIZ, 'src/core.js'));
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

// o texto de cada item do primeiro grupo de um trilho, na ordem
const itensDoGrupo = (page, fita) => page.locator(`[data-fita="${fita}"] .fita__grupo`).first().locator('.fita__item').allTextContents();
// o mesmo, lido do index.html (a lista de reserva, antes de qualquer JS)
function reservaDoHtml(fita) {
  const trilho = html.match(new RegExp(`data-fita="${fita}"><span class="fita__grupo">(.*?)</span></div>`))[1];
  return [...trilho.matchAll(/<span class="fita__item">(.*?)<\/span>/g)].map((m) => m[1]);
}

test.describe('S1 · fitas de letreiro', () => {
  test('nomes dos produtos com foto nova e avisos do CONFIG; sem Combo Casal, Doritos nem Hot Dog Pizza', async ({ page }) => {
    await page.goto('/#site');
    await expect(page.locator('.fitas.pronta')).toBeVisible();
    const a = await itensDoGrupo(page, 'a');
    const b = await itensDoGrupo(page, 'b');
    // a faixa a: os produtos com foto 'nova' (fotos.json), um por foto
    expect(a).toEqual(
      expect.arrayContaining(['Gran Salada', 'Gran Bacon Onion', 'Gran Crispy', 'X-Salada', 'Big Mineiro', 'Hot Dog Max', 'X-Churrasco', 'Combo Gran Bacon Onion'])
    );
    // a faixa b: prensado, combo e domingo, do CONFIG
    expect(b).toEqual([
      'Prensado? Avise antes: não cobramos para prensar',
      'Qualquer lanche vira combo +R$ 14,90',
      'Domingo também, das 19h à meia-noite'
    ]);
    const texto = await page.locator('.fitas').textContent();
    for (const proibido of ['Combo Casal', 'Doritos', 'Hot Dog Pizza']) expect(texto).not.toContain(proibido);
    // a lista de reserva do HTML é a mesma que o JS monta (sem salto quando o chunk chega)
    expect(a).toEqual(reservaDoHtml('a'));
    expect(b).toEqual(reservaDoHtml('b'));
  });

  test('cada trilho tem dois grupos iguais, o segundo aria-hidden, e cada grupo passa da largura da tela', async ({ page }) => {
    await page.goto('/#site');
    await expect(page.locator('.fitas.pronta')).toBeVisible();
    for (const fita of ['a', 'b']) {
      const grupos = page.locator(`[data-fita="${fita}"] .fita__grupo`);
      await expect(grupos).toHaveCount(2);
      await expect(grupos.nth(1)).toHaveAttribute('aria-hidden', 'true');
      const [g1, g2, tela] = await Promise.all([
        grupos.nth(0).evaluate((e) => e.getBoundingClientRect().width),
        grupos.nth(1).evaluate((e) => e.getBoundingClientRect().width),
        page.evaluate(() => window.innerWidth)
      ]);
      expect(Math.abs(g1 - g2), `grupos da faixa ${fita}`).toBeLessThan(1);
      expect(g1, `largura do grupo da faixa ${fita}`).toBeGreaterThan(tela);
    }
  });

  test('o combo_preco do estado troca o valor da faixa b', async ({ page }) => {
    await mudarEstado(page, (j) => {
      j.loja.comboPreco = 16.5;
    });
    await page.goto('/#site');
    await expect.poll(() => itensDoGrupo(page, 'b').then((l) => l[1])).toBe('Qualquer lanche vira combo +R$ 16,50');
    const texto = await page.locator('.fitas').textContent();
    expect(texto).not.toContain('+R$ 14,90');
    // a cópia aria-hidden do laço acompanha
    await expect(page.locator('[data-fita="b"] .fita__grupo').nth(1)).toContainText('+R$ 16,50');
  });

  test('o laço acelera com a rolagem e volta ao normal quando ela para', async ({ page }) => {
    await page.goto('/#site');
    await expect(page.locator('.fitas.pronta')).toBeVisible();
    await page.locator('.fitas').scrollIntoViewIfNeeded();
    const taxa = () => page.evaluate(() => document.querySelector('[data-fita="a"]').getAnimations()[0].playbackRate);
    expect(await taxa()).toBeLessThan(1.3);
    // 14 quadros rolando 40 px para um lado e para o outro (a fita continua na tela)
    const durante = await page.evaluate(
      () =>
        new Promise((fim) => {
          let n = 0;
          const passo = () => {
            window.scrollBy(0, n % 2 ? 40 : -40);
            if (++n < 14) requestAnimationFrame(passo);
            else fim(document.querySelector('[data-fita="a"]').getAnimations()[0].playbackRate);
          };
          requestAnimationFrame(passo);
        })
    );
    expect(durante).toBeGreaterThan(2);
    expect(durante).toBeLessThanOrEqual(6);
    await expect.poll(taxa, { timeout: 8000 }).toBeLessThan(1.3);
  });

  test('com movimento reduzido as faixas ficam paradas (nenhuma animação)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#site');
    await expect(page.locator('.fitas.pronta')).toBeVisible();
    await page.locator('.fitas').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.fitas')).length)).toBe(0);
    expect(await page.evaluate(() => document.querySelector('[data-fita="a"]').getAnimations().length)).toBe(0);
  });
});

test.describe('S1b · placa do cardápio', () => {
  // o menor preço (> 0) de cada categoria no CONFIG
  const menores = () => CONFIG.categorias.map((c) => [c.id, c.label, brl(Math.min(...c.itens.filter((p) => p.preco > 0).map((p) => p.preco)))]);
  const linhas = (page) => page.locator('.s-placa .placa-lista a');

  test('uma linha por categoria com "a partir de" o menor preço, no HTML e na página; nada de "a confirmar" nem R$ 0,00', async ({ page }) => {
    // a lista pronta do index.html (antes de qualquer JS)
    const doHtml = [...html.matchAll(/<a href="#cardapio\/([a-z]+)"><span class="placa-nome">(.*?)<\/span>.*?placa-valor">(.*?)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(doHtml).toEqual(menores());
    await page.goto('/#site');
    await expect(linhas(page)).toHaveCount(CONFIG.categorias.length);
    for (const [id, label, preco] of menores()) {
      const a = page.locator(`.s-placa a[href="#cardapio/${id}"]`);
      await expect(a).toHaveText(new RegExp('^' + label + '\\s*a partir de ' + preco.replace('$', '\\$') + '$', 'i'));
    }
    const texto = await page.locator('.s-placa .placa-lista').textContent();
    expect(texto).not.toMatch(/confirmar|R\$ 0,00/i);
  });

  test('clicar em "Combos" abre o cardápio rolado até a categoria', async ({ page }) => {
    await page.goto('/#site');
    const combos = page.locator('.s-placa a[href="#cardapio/combos"]');
    await combos.scrollIntoViewIfNeeded();
    await combos.click();
    await expect(page.locator('[data-screen="menu"]')).toBeVisible();
    await expect(page.locator('#view-site')).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => Math.round(document.querySelector('#cat-combos').getBoundingClientRect().top)), { timeout: 8000 })
      .toBeLessThan(260);
    expect(await page.evaluate(() => document.querySelector('#cat-combos').getBoundingClientRect().top)).toBeGreaterThan(-20);
    // o link direto também abre na categoria
    await page.goto('about:blank');
    await page.goto('/#cardapio/bebidas');
    await expect(page.locator('[data-screen="menu"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('#cat-bebidas').getBoundingClientRect().top)), { timeout: 8000 }).toBeLessThan(260);
  });

  test('preço do banco e itens esgotados refazem o "a partir de"; categoria toda esgotada diz Esgotado hoje', async ({ page }) => {
    await mudarEstado(page, (j) => {
      j.precos['x-burguer'] = 18.5;
      j.esgotados = ['dog-medio', 'porcao-batata', 'porcao-onion'];
    });
    await page.goto('/#site');
    const preco = (id) => page.locator(`.s-placa a[href="#cardapio/${id}"] .placa-preco`);
    await expect(preco('tradicionais')).toHaveText('a partir de R$ 18,50');
    await expect(preco('hotdog')).toHaveText('a partir de R$ 15,90'); // o Médio (13,90) esgotou: vale o Max
    await expect(preco('porcoes')).toHaveText('Esgotado hoje');
    await expect(preco('artesanais')).toHaveText('a partir de R$ 24,90');
    expect(await page.locator('.s-placa .placa-lista').textContent()).not.toMatch(/confirmar|R\$ 0,00/i);
  });
});
