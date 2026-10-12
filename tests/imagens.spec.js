// Nenhuma foto esticada: toda <img> visível com object-fit "fill" precisa manter a proporção natural (±3%).
// Cobre bio, cardápio e site (rolando a página inteira para carregar as lazy), a ficha, um story e a foto ampliada.
// Origem: bug da prévia (recortes da bio com 118×720 px) causado por width/height no HTML sem height:auto no reset.
// Uso: npx playwright test tests/imagens.spec.js
/* global document, getComputedStyle, innerHeight, innerWidth, scrollTo */
import { test, expect } from '@playwright/test';

const TOLERANCIA = 0.03;

// rola até o fim (as imagens com loading="lazy" entram) e volta ao topo
async function rolarTudo(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.7)) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 200));
  });
  await esperarImagens(page);
  await page.evaluate(() => scrollTo(0, 0));
}

// espera terminar de carregar toda imagem visível que já tem endereço. As lazy paradas fora da área visível
// dos carrosséis horizontais (destaques, Gran, monte seu combo) ou da coluna do celular só carregam quando o
// carrossel anda, então ficam de fora: conta só a imagem que cruza a janela e todo ancestral que recorta (overflow).
async function esperarImagens(page) {
  await page.waitForFunction(
    () => {
      const cruza = (a, b) => a.right > b.left && a.left < b.right;
      const naArea = (img) => {
        const r = img.getBoundingClientRect();
        if (!cruza(r, { left: 0, right: innerWidth })) return false;
        for (let el = img.parentElement; el && el !== document.body; el = el.parentElement) {
          if (getComputedStyle(el).overflowX !== 'visible' && !cruza(r, el.getBoundingClientRect())) return false;
        }
        return true;
      };
      return [...document.images].filter((i) => i.getAttribute('src') && i.checkVisibility() && naArea(i)).every((i) => i.complete);
    },
    null,
    { timeout: 20_000 }
  );
}

// imagens visíveis com object-fit fill cuja proporção exibida difere da natural
async function distorcidas(page) {
  return page.evaluate((tol) => {
    const ruins = [];
    let conferidas = 0;
    for (const img of document.images) {
      if (!img.complete || !img.naturalWidth || !img.naturalHeight) continue;
      if (!img.checkVisibility({ visibilityProperty: true })) continue;
      const cs = getComputedStyle(img);
      if (cs.objectFit !== 'fill') continue;
      // caixa de conteúdo (sem padding nem borda): é nela que a foto é desenhada; transform não altera
      const w = img.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = img.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (w < 2 || h < 2) continue;
      conferidas++;
      const desvio = Math.abs(w / h / (img.naturalWidth / img.naturalHeight) - 1);
      if (desvio > tol) {
        ruins.push(
          `${(img.currentSrc || img.src).split('/').pop()}: exibida ${Math.round(w)}×${Math.round(h)}, natural ${img.naturalWidth}×${img.naturalHeight} (${(desvio * 100).toFixed(1)}%)`
        );
      }
    }
    return { ruins, conferidas };
  }, TOLERANCIA);
}

async function conferir(page, onde) {
  const { ruins, conferidas } = await distorcidas(page);
  expect(ruins, `imagens distorcidas em ${onde}`).toEqual([]);
  return conferidas;
}

test.describe('fotos sem distorção', () => {
  test('bio, rolando a página e abrindo um story e a ficha', async ({ page }) => {
    await page.goto('/#bio');
    await expect(page.locator('[data-screen="bio"]')).toBeVisible();
    await rolarTudo(page);
    // a bio não tem mais recortes soltos (docs/DIRECAO-VISUAL.md 5.1): a imagem "fill" dela é a logo oficial
    expect(await conferir(page, 'bio'), 'logo da bio conferida').toBeGreaterThanOrEqual(1);

    await page.locator('.story-btn').first().click();
    await expect(page.locator('#story')).toBeVisible();
    await esperarImagens(page);
    await conferir(page, 'story');
    await page.locator('[data-fechar-story]').click();
    await expect(page.locator('#story')).toBeHidden();

    await page.locator('#destaques .dest').first().click();
    await expect(page.locator('#ficha')).toBeVisible();
    await esperarImagens(page);
    await conferir(page, 'ficha aberta pela bio');
  });

  test('cardápio, rolando a página e abrindo a ficha', async ({ page }) => {
    await page.goto('/#cardapio');
    await expect(page.locator('[data-screen="menu"]')).toBeVisible();
    await rolarTudo(page);
    await conferir(page, 'cardápio');

    await page.locator('#prod-gran-burger').click();
    await expect(page.locator('#ficha')).toBeVisible();
    await expect(page.locator('#ficha .ficha-foto img')).toHaveJSProperty('complete', true);
    await esperarImagens(page);
    await conferir(page, 'ficha do Gran Burger');
  });

  test('site, rolando a página e abrindo a galeria ampliada', async ({ page }) => {
    await page.goto('/#site');
    await expect(page.locator('#view-site')).toBeVisible();
    await rolarTudo(page);
    expect(await conferir(page, 'site'), 'fotos da galeria e logo conferidas').toBeGreaterThanOrEqual(15);

    const foto = page.locator('#mosaico button').first();
    await foto.scrollIntoViewIfNeeded();
    await foto.click();
    await expect(page.locator('#luz-caixa')).toBeVisible();
    await esperarImagens(page);
    await conferir(page, 'galeria ampliada');
  });
});

test('srcset usa a largura real dos arquivos (sem repetir largura)', async ({ page }) => {
  await page.goto('/#site');
  await expect(page.locator('#view-site')).toBeVisible();
  const conjuntos = await page.evaluate(() =>
    [...document.querySelectorAll('img[srcset]')].map((i) => ({
      srcset: i.getAttribute('srcset'),
      sizes: i.getAttribute('sizes'),
      w: i.width,
      h: i.height
    }))
  );
  expect(conjuntos.length).toBeGreaterThan(10);
  // a logo (placa) usa srcset por densidade, 1x e 2x, e nunca o logo-1024 (docs/DIRECAO-VISUAL.md 3.1 e 3.3)
  const logos = conjuntos.filter((c) => c.srcset.includes('/assets/logo/'));
  for (const c of logos) {
    expect(c.srcset).toBe('/assets/logo/logo-256.webp 1x, /assets/logo/logo-512.webp 2x');
    expect(c.w * c.h, `width/height em ${c.srcset}`).toBeGreaterThan(0);
  }
  for (const c of conjuntos.filter((x) => !logos.includes(x))) {
    expect(c.sizes, c.srcset).toBeTruthy();
    expect(c.w * c.h, `width/height em ${c.srcset}`).toBeGreaterThan(0);
    const larguras = c.srcset.split(',').map((p) => p.trim().split(/\s+/)[1]);
    expect(new Set(larguras).size, `largura repetida em ${c.srcset}`).toBe(larguras.length);
  }
  // o selo da barra do site é o selo-128 de 34 px, SEM srcset: o selo-128 cobre até 42 px CSS em DPR 3 e o teste da logo acima exige logo-256/512 em todo srcset da logo
  const selo = await page.evaluate(() => {
    const i = document.querySelector('.barra-site__selo img');
    return { src: i.getAttribute('src'), srcset: i.getAttribute('srcset'), w: i.getBoundingClientRect().width };
  });
  expect(selo).toEqual({ src: '/assets/logo/selo-128.webp', srcset: null, w: 34 });
  const doritos = conjuntos.find((c) => c.srcset.includes('/dog-doritos-'));
  expect(doritos?.srcset).toBe('/assets/fotos/dog-doritos-540.webp 481w');
  const burger = await page.evaluate(() => document.querySelector('img[srcset*="/gran-burger-540"]')?.getAttribute('srcset'));
  expect(burger).toBe('/assets/fotos/gran-burger-540.webp 540w, /assets/fotos/gran-burger-1080.webp 720w');
});
