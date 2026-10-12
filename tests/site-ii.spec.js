// Cenas do site imersivo da trilha site-II (docs/DIRECAO-VISUAL.md 6.2): S1 fitas, S1b placa do cardápio e S3 prensado.
// Cada cena confere o que o aceite do plano pede (docs/PLANO-FASE-2.md, B11 a B13). O estado do banco (estado_cardapio)
// vem do Supabase local, alterado no caminho (page.route), sem mexer no banco.
// Uso: npx playwright test tests/site-ii.spec.js (com o Supabase local no ar e o supabase/setup.sql aplicado)
/* global document, window, requestAnimationFrame, getComputedStyle, localStorage */
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

test.describe('S3 · prensado ou não?', () => {
  const regua = (page) => page.locator('#f-prensa');
  const estado = (page) => page.locator('#prensa-estado');
  // a foto do quadro interativo e a posição da chapa na tela
  const foto = (page) => page.locator('#prensa-palco .prensa-foto img');
  const topoDaChapa = (page) => page.locator('#prensa-palco .prensa-chapa').evaluate((e) => e.getBoundingClientRect().top);
  async function abrir(page) {
    await page.goto('/#site');
    await expect(page.locator('#view-site')).toBeVisible();
    await page.locator('#prensa-palco').scrollIntoViewIfNeeded();
    await expect(foto(page)).toHaveJSProperty('complete', true);
  }

  test('foto nova do X-Churrasco, o texto vem do CONFIG e a régua desce a prensa', async ({ page }) => {
    await abrir(page);
    await expect(foto(page)).toHaveAttribute('src', /\/assets\/fotos\/x-churrasco-540\.webp$/);
    await expect(foto(page)).toHaveAttribute('alt', 'Foto do X-Churrasco');
    await expect(page.locator('#prensa-aviso')).toHaveText('Avise antes: ' + CONFIG.regras.prensado.texto.replace(/^./, (c) => c.toLowerCase()) + '.');
    await expect(estado(page)).toHaveText('Não prensado');
    const alto = await topoDaChapa(page);
    await regua(page).fill('50');
    await expect(estado(page)).toHaveText('Prensando…');
    await expect(page.locator('#prensa-palco')).not.toHaveClass(/prensado/);
    await regua(page).fill('100');
    await expect(estado(page)).toHaveText('Prensado!');
    await expect(page.locator('#prensa-palco')).toHaveClass(/prensado/);
    // a chapa desce (21% da altura do quadro, 98 px num quadro de 467) e o vapor e o Tsss entram
    await expect.poll(async () => (await topoDaChapa(page)) - alto).toBeGreaterThan(60);
    await expect(page.locator('#prensa-palco .prensa-tsss')).toHaveCSS('animation-name', 'prensa-tsss');
    // volta ao começo
    await regua(page).fill('0');
    await expect(estado(page)).toHaveText('Não prensado');
    await expect.poll(async () => Math.abs((await topoDaChapa(page)) - alto)).toBeLessThan(2);
  });

  test('com a prensa descida a foto nunca é deformada: sem transform e na proporção natural', async ({ page }) => {
    await abrir(page);
    await regua(page).fill('100');
    await expect(estado(page)).toHaveText('Prensado!');
    await page.waitForTimeout(400); // a chapa pousa (transição de .2 s)
    const r = await foto(page).evaluate((img) => {
      const cs = getComputedStyle(img);
      const dono = [];
      for (let e = img; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).transform !== 'none') dono.push(e.className);
      return { transform: cs.transform, w: img.clientWidth, h: img.clientHeight, nw: img.naturalWidth, nh: img.naturalHeight, comTransform: dono };
    });
    expect(r.transform).toBe('none');
    expect(r.comTransform, 'nenhum elemento da foto ao quadro leva transform').toEqual([]);
    expect(Math.abs(r.w / r.h / (r.nw / r.nh) - 1)).toBeLessThan(0.03);
  });

  test('arrastar a chapa pelo cabo desce a prensa junto com a régua', async ({ page }) => {
    await abrir(page);
    const cabo = await page.locator('#prensa-palco .prensa-cabo').boundingBox();
    const quadro = await page.locator('#prensa-palco').boundingBox();
    await page.mouse.move(cabo.x + cabo.width / 2, cabo.y + cabo.height / 2);
    await page.mouse.down();
    // 21% da altura do quadro é o curso todo; passa um pouco para garantir o fim
    await page.mouse.move(cabo.x + cabo.width / 2, cabo.y + cabo.height / 2 + quadro.height * 0.1, { steps: 4 });
    await expect.poll(async () => +(await regua(page).inputValue())).toBeGreaterThan(30);
    await page.mouse.move(cabo.x + cabo.width / 2, cabo.y + cabo.height / 2 + quadro.height * 0.3, { steps: 4 });
    await page.mouse.up();
    await expect(regua(page)).toHaveValue('100');
    await expect(estado(page)).toHaveText('Prensado!');
  });

  test('pelo teclado: a régua é um controle comum', async ({ page }) => {
    await abrir(page);
    await regua(page).focus();
    await page.keyboard.press('End');
    await expect(estado(page)).toHaveText('Prensado!');
    await page.keyboard.press('Home');
    await expect(estado(page)).toHaveText('Não prensado');
  });

  test('com movimento reduzido os dois estados ficam lado a lado, parados', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#site');
    await page.locator('.prensa-par').scrollIntoViewIfNeeded();
    const cenas = page.locator('.prensa-cena');
    await expect(cenas).toHaveCount(2);
    await expect(cenas.nth(0)).toBeVisible();
    await expect(cenas.nth(1)).toBeVisible();
    await expect(page.locator('.prensa-controle')).toBeHidden();
    await expect(cenas.nth(0).locator('.prensa-rotulo')).toHaveText('Não prensado');
    await expect(cenas.nth(1).locator('.prensa-rotulo')).toHaveText('Prensado!');
    await expect(cenas.nth(1).locator('img')).toHaveJSProperty('complete', true);
    const [a, b] = await Promise.all([cenas.nth(0).boundingBox(), cenas.nth(1).boundingBox()]);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1); // lado a lado
    // a chapa do segundo está mais baixa que a do primeiro (relativa ao quadro)
    const chapa = (i) => cenas.nth(i).locator('.prensa-chapa').evaluate((e) => e.getBoundingClientRect().top - e.closest('.prensa-palco').getBoundingClientRect().top);
    expect((await chapa(1)) - (await chapa(0))).toBeGreaterThan(40);
    expect(await page.evaluate(() => document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('.s-prensa')).length)).toBe(0);
    for (const i of [0, 1]) await expect(cenas.nth(i).locator('img')).toHaveCSS('transform', 'none');
  });
});

test.describe('S4 · hot dog: 1, 2 ou 3 salsichas', () => {
  const dogs = Object.fromEntries(CONFIG.categorias.find((c) => c.id === 'hotdog').itens.map((p) => [p.id, p]));
  const preco = (page) => page.locator('#dog-preco');
  const sacola = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:sacola') || '[]'));
  async function abrir(page) {
    await page.goto('/#site');
    await expect(page.locator('#view-site')).toBeVisible();
    await page.locator('#dog-bandeja').scrollIntoViewIfNeeded();
    await expect(page.locator('#dog-foto img')).toHaveJSProperty('complete', true);
    // as salsichas caem uma vez na primeira vez que a bandeja aparece: espera acabar
    await page.waitForFunction(() => ![...document.querySelectorAll('.dog-salsicha')].some((s) => s.getAnimations().length));
  }

  test('foto nova do Dog Max, radiogroup 1/2/3 com Médio, Max e Super e o preço do CONFIG (também no HTML)', async ({ page }) => {
    // o HTML pronto (antes de qualquer JS) já traz o Dog Max e o preço dele
    expect(html).toContain(`id="dog-preco" data-preco-de="dog-max">${brl(dogs['dog-max'].preco)}<`);
    await abrir(page);
    await expect(page.locator('#dog-foto img')).toHaveAttribute('src', /\/assets\/fotos\/dog-max-540\.webp$/);
    const radios = page.locator('.s-dog [role="radiogroup"] [role="radio"]');
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(0)).toHaveText('1Médio');
    await expect(radios.nth(1)).toHaveText('2Max');
    await expect(radios.nth(2)).toHaveText('3Super');
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radiogroup', { name: 'Quantidade de salsichas' })).toBeVisible();
    await expect(preco(page)).toHaveText(brl(dogs['dog-max'].preco));
    await expect(page.locator('#dog-nome')).toHaveText('Hot Dog Max');
    await expect(page.locator('#dog-base')).toHaveText(dogs['dog-max'].base);
    // os chips da base e a dica vêm do CONFIG
    await expect(page.locator('#dog-ings li')).toHaveText(dogs['dog-max'].ing);
    await expect(page.locator('#dog-dica')).toHaveText(dogs['dog-max'].nota);
    await expect(page.locator('.dog-salsicha.on')).toHaveCount(2);
  });

  test('trocar 1 para 3 rola os dígitos do preço (240 ms) e cai a terceira salsicha', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('.dog-salsicha.on')).toHaveCount(2);
    const logo = await page.evaluate(() => {
      document.querySelector('[data-dog="dog-super"]').click();
      return {
        colunas: document.querySelectorAll('#dog-preco .odo').length,
        anima: document.querySelector('#dog-preco .odo-f').getAnimations().length,
        duracao: document.querySelector('#dog-preco .odo-f').getAnimations()[0].effect.getTiming().duration,
        queda: [...document.querySelectorAll('.dog-salsicha.on')].map((s) => s.getAnimations().length)
      };
    });
    expect(logo.colunas).toBeGreaterThan(0);
    expect(logo.anima).toBe(1);
    expect(logo.duracao).toBe(240);
    expect(logo.queda).toEqual([0, 0, 1]); // só a que entrou cai
    await expect(preco(page)).toHaveText(brl(dogs['dog-super'].preco));
    await expect(preco(page)).toHaveAttribute('data-preco-de', 'dog-super');
    await expect(page.locator('#dog-preco .odo')).toHaveCount(0); // no repouso o texto é plano
    await expect(page.locator('.dog-salsicha.on')).toHaveCount(3);
    await expect(page.locator('#dog-nome')).toHaveText('Hot Dog Super');
    await expect(page.locator('#dog-base')).toContainText('3 salsichas');
    await expect(page.locator('[data-dog="dog-super"]')).toHaveAttribute('aria-checked', 'true');
    // de 3 para 1: o preço desce e sobra uma salsicha
    await page.locator('[data-dog="dog-medio"]').click();
    await expect(preco(page)).toHaveText(brl(dogs['dog-medio'].preco));
    await expect(page.locator('.dog-salsicha.on')).toHaveCount(1);
  });

  test('pelo teclado: as setas trocam o tamanho (radiogroup)', async ({ page }) => {
    await abrir(page);
    await page.locator('[data-dog="dog-max"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-dog="dog-super"]')).toBeFocused();
    await expect(preco(page)).toHaveText(brl(dogs['dog-super'].preco));
    await page.keyboard.press('Home');
    await expect(page.locator('[data-dog="dog-medio"]')).toBeFocused();
    await expect(preco(page)).toHaveText(brl(dogs['dog-medio'].preco));
  });

  test('"Adicionar" põe o Hot Dog Super completo na sacola com o toast; "Personalizar" abre a ficha do tamanho', async ({ page }) => {
    await abrir(page);
    await page.locator('[data-dog="dog-super"]').click();
    await page.locator('.s-dog').getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.locator('#toast-txt')).toHaveText('Hot Dog Super na sacola');
    const linhas = await sacola(page);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].sel).toMatchObject({ produtoId: 'dog-super', completo: true, prensado: false, qtd: 1, combo: { ativo: false } });
    await page.locator('[data-dog="dog-medio"]').click();
    await page.locator('#dog-pers').click();
    await expect(page.locator('#ficha')).toBeVisible();
    await expect(page.locator('#ficha-nome')).toHaveText('Hot Dog Médio');
  });

  test('o preço do banco vale no tamanho escolhido', async ({ page }) => {
    await mudarEstado(page, (j) => {
      j.precos['dog-max'] = 24.5;
      j.precos['dog-super'] = 29.9;
    });
    await abrir(page);
    await expect(preco(page)).toHaveText('R$ 24,50');
    await page.locator('[data-dog="dog-super"]').click();
    await expect(preco(page)).toHaveText('R$ 29,90');
    await expect(preco(page)).toHaveAttribute('data-preco-de', 'dog-super');
  });

  test('card do CBO Turbo: Preço a confirmar, sem botão de sacola e consulta no WhatsApp', async ({ page }) => {
    await abrir(page);
    const card = page.locator('#dog-cbo');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('Hot Dog CBO Turbo');
    await expect(card).toContainText('3 salsichas Perdigão');
    await expect(card.locator('#dog-cbo-preco')).toHaveText('Preço a confirmar');
    await expect(card.locator('img')).toHaveAttribute('src', /\/dog-cbo-turbo-540\.webp$/);
    await expect(card.getByRole('button')).toHaveCount(0); // o "Pedir" só aparece com preço
    const wa = card.getByRole('link', { name: 'Consultar no WhatsApp' });
    await expect(wa).toHaveAttribute('target', '_blank');
    const href = await wa.getAttribute('href');
    expect(href).toMatch(/^https:\/\/wa\.me\/5511985720150\?text=/);
    expect(decodeURIComponent(href.split('?text=')[1])).toBe('Olá, Mineiro Lanche! Vi o Hot Dog CBO Turbo no cardápio e quero saber o preço. Como faço para pedir?');
    expect(await sacola(page)).toEqual([]);
  });

  test('com movimento reduzido a troca é direta: sem colunas, salsichas paradas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    const r = await page.evaluate(() => {
      document.querySelector('[data-dog="dog-super"]').click();
      return {
        texto: document.querySelector('#dog-preco').textContent,
        colunas: document.querySelectorAll('#dog-preco .odo').length,
        animacoes: document.getAnimations().filter((a) => a.effect && a.effect.getTiming().duration > 1 && a.effect.target.closest('.s-dog')).length,
        salsichas: document.querySelectorAll('.dog-salsicha.on').length
      };
    });
    expect(r).toEqual({ texto: brl(dogs['dog-super'].preco), colunas: 0, animacoes: 0, salsichas: 3 });
  });
});
