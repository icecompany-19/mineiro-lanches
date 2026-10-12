// Integridade da logo na tela (docs/DIRECAO-VISUAL.md §3.5). O tests/logo.test.mjs cobre os arquivos gerados do PDF;
// este cobre o que o navegador mostra: só a arte real em webp, nunca maior que 280 px, sem svg redesenhado, sem
// filter/blend/máscara, primeira pintura opaca, nada por cima da arte em repouso e nenhum pedido ao logo-1024.
// Uso: npx playwright test tests/logo-tela.spec.js --project=celular --project=desktop (não precisa da API).
/* global document, getComputedStyle, location, window, devicePixelRatio */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const RAIZ = resolve(import.meta.dirname, '..');

// O painel já saiu de /assets/logo-selo.svg (P1): aquele teste é normal. Falta o site: quando B10 tirar o
// img.logo-final do #view-site, apague a linha "test.fixme(true, MOTIVO_SITE)" abaixo e esta constante.
const MOTIVO_SITE = 'removido pela trilha site (B10 tira o img.logo-final do #view-site); vira test normal na integração';

// arquivos permitidos em tela: logo-<n>.webp e selo-<n>.webp (o logo-1024 existe, mas nunca é pedido: ver o último teste)
const ARQUIVO = /^\/assets\/logo\/(logo|selo)-\d+\.webp$/;
// a arte em tela: a placa (bio, herói, final) e todo selo/logo vindo da pasta da logo
const LOGOS = ".placa-arte, img[src*='/assets/logo/']";
const LARGURA_MAXIMA = 280;
const MEDIA_MAXIMA = 2; // 2/255 por canal, na média dos pixels opacos (o protótipo mediu 0,61)

const ROTAS = [
  { nome: 'bio', url: '/', tela: '[data-screen="bio"]' },
  { nome: 'cardápio', url: '/#cardapio', tela: '[data-screen="menu"]' },
  { nome: 'site', url: '/#site', tela: '#view-site' }
];

// abre a rota e espera a tela aparecer e as imagens da logo (as lazy fora da área visível ficam de fora)
async function abrir(page, rota) {
  await page.goto(rota.url);
  await expect(page.locator(rota.tela).first(), `${rota.nome} visível`).toBeVisible();
  await page.waitForFunction(
    (sel) => [...document.querySelectorAll(sel)].filter((i) => i.getAttribute('src') && i.loading !== 'lazy').every((i) => i.complete),
    LOGOS,
    { timeout: 20_000 }
  );
}

for (const rota of ROTAS) {
  test.describe(`logo em tela: ${rota.nome}`, () => {
    test.beforeEach(async ({ page }) => {
      await abrir(page, rota);
    });

    test('toda logo vem de /assets/logo/(logo|selo)-N.webp (src, srcset e currentSrc)', async ({ page }) => {
      const logos = await page.evaluate((sel) => {
        const caminho = (u) => new URL(u, location.href).pathname;
        return [...document.querySelectorAll(sel)].map((img) => ({
          tag: img.tagName,
          classe: img.className,
          src: img.getAttribute('src') ? caminho(img.getAttribute('src')) : '',
          srcset: (img.getAttribute('srcset') || '')
            .split(',')
            .map((c) => c.trim().split(/\s+/)[0])
            .filter(Boolean)
            .map(caminho),
          carregada: img.complete && img.naturalWidth > 0,
          atual: img.currentSrc ? caminho(img.currentSrc) : ''
        }));
      }, LOGOS);

      expect(logos.length, 'há ao menos uma logo no DOM').toBeGreaterThan(0);
      expect(logos.filter((l) => l.classe.includes('placa-arte')).length, 'a placa (.placa-arte) está no DOM').toBeGreaterThan(0);
      for (const l of logos) {
        const quem = `${l.tag}.${l.classe || '(sem classe)'}`;
        expect(l.tag, `${quem} é <img>`).toBe('IMG');
        expect(l.src, `${quem}: src`).toMatch(ARQUIVO);
        for (const c of l.srcset) expect(c, `${quem}: srcset`).toMatch(ARQUIVO);
        // imagem já carregada tem currentSrc, e ele também é um webp da pasta
        if (l.carregada) expect(l.atual, `${quem}: currentSrc`).toMatch(ARQUIVO);
        expect(l.atual + l.src + l.srcset.join(), `${quem} nunca usa o 1024`).not.toContain('logo-1024');
      }
      // a placa da bio está carregada e tem currentSrc
      if (rota.nome === 'bio') {
        const placa = logos.find((l) => l.classe.includes('placa-arte'));
        expect(placa.carregada, 'placa da bio carregada').toBe(true);
        expect(placa.atual, 'placa da bio: currentSrc').toMatch(ARQUIVO);
      }
    });

    test('nenhum svg do DOM carrega o nome (a logo não é redesenhada em svg)', async ({ page }) => {
      const svgs = await page.evaluate(() =>
        [...document.querySelectorAll('svg')]
          .filter((s) => /mineiro/i.test([s.textContent, s.getAttribute('aria-label'), s.getAttribute('data-letras')].join(' ')))
          .map((s) => (s.getAttribute('class') || s.id || 'svg') + ': ' + (s.textContent || '').trim().slice(0, 40))
      );
      expect(svgs, 'svg com "MINEIRO"').toEqual([]);
    });

    test('filter, mix-blend-mode e mask-image da arte são neutros', async ({ page }) => {
      const estilos = await page.evaluate((sel) => {
        return [...document.querySelectorAll(sel)].map((img) => {
          const cs = getComputedStyle(img);
          return {
            quem: img.className || img.getAttribute('src'),
            filter: cs.filter,
            blend: cs.mixBlendMode,
            mascara: cs.maskImage,
            mascaraWebkit: cs.webkitMaskImage
          };
        });
      }, LOGOS);
      expect(estilos.length).toBeGreaterThan(0);
      for (const e of estilos) {
        expect(e.filter, `${e.quem}: filter`).toBe('none');
        expect(e.blend, `${e.quem}: mix-blend-mode`).toBe('normal');
        expect(e.mascara, `${e.quem}: mask-image`).toBe('none');
        expect(e.mascaraWebkit, `${e.quem}: -webkit-mask-image`).toBe('none');
      }
    });

    for (const [largura, altura] of [
      [390, 844],
      [1280, 800]
    ]) {
      test(`nenhuma logo passa de ${LARGURA_MAXIMA} px de largura em ${largura}`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: altura });
        await abrir(page, rota);
        const larguras = await page.evaluate((sel) => {
          return [...document.querySelectorAll(sel)]
            .filter((img) => img.checkVisibility())
            .map((img) => ({
              quem: img.className || img.getAttribute('src'),
              largura: Math.max(img.clientWidth, img.getBoundingClientRect().width)
            }));
        }, LOGOS);
        if (rota.nome !== 'site') expect(larguras.length, 'há logo visível na tela').toBeGreaterThan(0);
        for (const l of larguras) expect(l.largura, `${l.quem} em ${largura}`).toBeLessThanOrEqual(LARGURA_MAXIMA);
      });
    }
  });
}

test.describe('referências aos SVGs da raiz saem da tela', () => {
  // /assets/logo.svg (a arte inteira) e /assets/logo-selo.svg (o selo): ficam no repositório, mas não em tela (D10)
  const SVG_DA_RAIZ = /\/assets\/logo\.svg|logo-selo\.svg/g;
  const achar = (arquivos) =>
    arquivos.flatMap(([nome, texto]) =>
      texto.split('\n').flatMap((linha, i) => (linha.match(SVG_DA_RAIZ) ? [`${nome}:${i + 1}: ${linha.trim().slice(0, 120)}`] : []))
    );

  test('index.html não aponta para /assets/logo.svg nem logo-selo.svg', () => {
    test.fixme(true, MOTIVO_SITE);
    const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
    expect(achar([['index.html', html]])).toEqual([]);
  });

  test('src/painel/*.js não aponta para /assets/logo.svg nem logo-selo.svg', () => {
    const pasta = join(RAIZ, 'src/painel');
    const arquivos = readdirSync(pasta)
      .filter((f) => f.endsWith('.js'))
      .map((f) => [`src/painel/${f}`, readFileSync(join(pasta, f), 'utf8')]);
    expect(arquivos.length, 'há arquivos .js em src/painel').toBeGreaterThan(0);
    expect(achar(arquivos)).toEqual([]);
  });
});

test.describe('placa da bio', () => {
  test.beforeEach(async ({ page }) => {
    await abrir(page, ROTAS[0]);
  });

  // §3.4: "a arte já aparece visível (opacidade 1)". Toda animação da arte que mexe em opacidade começa em 1, e com
  // todas paradas no instante 0 a arte está inteira (opacidade 1). Vale para a entrada e para o toque (as 2 piscadas).
  test('o primeiro keyframe de opacidade da arte vale 1 (entrada e toque)', async ({ page }) => {
    const lerAnimacoes = () =>
      page.evaluate(() => {
        const arte = document.querySelector('[data-screen="bio"] .placa-arte');
        const animacoes = arte.getAnimations().map((a) => ({
          nome: a.animationName,
          quadros: a.effect.getKeyframes().map((k) => ({ deslocamento: k.computedOffset, opacidade: k.opacity }))
        }));
        // tudo no instante 0 (o atraso de 0,5 s da "acende" aplica o primeiro quadro pelo preenchimento anterior)
        for (const a of arte.getAnimations()) {
          a.pause();
          a.currentTime = 0;
        }
        return { animacoes, opacidadeNoInicio: getComputedStyle(arte).opacity };
      });

    // entrada (uma vez por sessão: a página é nova, a marca em sessionStorage ainda não existe)
    await expect(page.locator('[data-screen="bio"] .placa.entra')).toHaveCount(1);
    const entrada = await lerAnimacoes();
    verificarInicioOpaco(entrada, 'entrada');

    // toque: 2 piscadas (a classe .pisca troca a animação da entrada pela das piscadas)
    await page.locator('[data-screen="bio"] [data-placa]').click();
    await expect(page.locator('[data-screen="bio"] .placa.pisca')).toHaveCount(1);
    const toque = await lerAnimacoes();
    verificarInicioOpaco(toque, 'toque');
  });

  // §3.5: depois de 3 s a captura do elemento difere da arte servida em no máximo 2/255 por canal, só nos pixels
  // opacos da arte. Pega brilho esquecido, filtro, tom diferente, véu ou qualquer coisa por cima da arte em repouso.
  // Para o navegador não reamostrar a imagem (o que sozinho já passa de 2/255 nas bordas), a captura roda numa janela
  // nova com a densidade que mostra o arquivo de maior densidade 1:1 (largura do arquivo / largura CSS da arte) e com
  // a largura que põe a arte num pixel inteiro. A diferença que sobra é só a do decodificador de webp (o protótipo mediu 0,61).
  test('depois de 3 s a arte na tela é a do arquivo (≤ 2/255 por canal, só pixels opacos)', async ({ browser, page, baseURL }) => {
    const { larguraCss, candidatas } = await page.evaluate(() => {
      const arte = document.querySelector('[data-screen="bio"] .placa-arte');
      const candidatas = arte
        .getAttribute('srcset')
        .split(',')
        .map((c) => c.trim().split(/\s+/))
        .map(([url, d]) => ({ url: new URL(url, location.href).href, densidade: parseFloat(d) || 1 }))
        .sort((a, b) => a.densidade - b.densidade);
      return { larguraCss: arte.clientWidth, candidatas };
    });
    const maior = candidatas.at(-1);
    const resposta = await page.request.get(maior.url);
    expect(resposta.ok(), `GET ${maior.url}`).toBe(true);
    const arquivo = await resposta.body();
    const meta = await sharp(arquivo).metadata();
    const densidade = meta.width / larguraCss;
    expect(densidade, 'o maior arquivo do srcset pede densidade > 2 (senão o navegador escolheria outro)').toBeGreaterThan(2);

    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: densidade });
    try {
      const p = await ctx.newPage();
      await abrir(p, ROTAS[0]);
      const arte = p.locator('[data-screen="bio"] .placa-arte');
      await p.waitForTimeout(3000);
      // entrada e brilho já terminaram: não resta animação rodando na arte nem brilho aberto sobre ela
      await p.waitForFunction(() =>
        document
          .querySelector('[data-screen="bio"] .placa-arte')
          .getAnimations()
          .every((a) => a.playState === 'finished')
      );
      await expect(p.locator('[data-screen="bio"] .placa-brilho'), 'em repouso não há brilho sobre a arte').toBeHidden();
      expect(await arte.evaluate((img) => img.currentSrc), 'a janela de captura carrega o mesmo arquivo').toBe(maior.url);

      // largura da janela que deixa a borda esquerda da arte num pixel inteiro do dispositivo (sem reamostragem)
      let melhor = { fracao: 1, largura: 390 };
      for (let largura = 360; largura <= 440 && melhor.fracao > 0.01; largura++) {
        await p.setViewportSize({ width: largura, height: 844 });
        const x = await arte.evaluate((img) => img.getBoundingClientRect().x * devicePixelRatio);
        const fracao = Math.abs(x - Math.round(x));
        if (fracao < melhor.fracao) melhor = { fracao, largura };
      }
      await p.setViewportSize({ width: melhor.largura, height: 844 });
      await p.waitForTimeout(300);
      expect(await arte.evaluate((img) => getComputedStyle(img).opacity), 'opacidade da arte em repouso').toBe('1');

      const d = await compararComArquivo(await arte.screenshot(), arquivo);
      expect(d.opacos, 'pixels opacos comparados').toBeGreaterThan(10_000);
      for (const [i, canal] of ['R', 'G', 'B'].entries()) {
        expect(
          d.media[i],
          `${canal}: diferença média nos ${d.opacos} pixels opacos (máx. ${d.maximo[i]}; deslocamento ${d.dx},${d.dy}; janela ${melhor.largura}, fração ${melhor.fracao.toFixed(2)})`
        ).toBeLessThanOrEqual(MEDIA_MAXIMA);
      }
    } finally {
      await ctx.close();
    }
  });
});

// densidade 3 (iPhone Pro, por exemplo): a placa de 208 px pede o 2x (logo-512.webp) e nada pede o logo-1024
test.describe('densidade 3', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

  test('nenhuma rota pede o logo-1024 (bio, cardápio e site, com a página toda rolada)', async ({ context }) => {
    const pedidos = [];
    context.on('request', (r) => pedidos.push(r.url()));
    for (const rota of ROTAS) {
      const page = await context.newPage(); // página nova: o rota.js e o preload rodam em cada carga
      await abrir(page, rota);
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(window.innerHeight * 0.7)) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      await page.waitForTimeout(500);
      await page.close();
    }
    const logos = pedidos.filter((u) => /\/assets\/logo\//.test(u));
    expect(
      logos.some((u) => /\/logo-512\.webp$/.test(u)),
      'a placa pediu o 2x (logo-512.webp)'
    ).toBe(true);
    expect(
      logos.filter((u) => /logo-1024/.test(u)),
      'pedidos ao logo-1024'
    ).toEqual([]);
  });
});

// ---------- apoio ----------

function verificarInicioOpaco({ animacoes, opacidadeNoInicio }, quando) {
  const comOpacidade = animacoes.filter((a) => a.quadros.some((q) => q.opacidade !== undefined));
  expect(comOpacidade.length, `${quando}: há animação de opacidade na arte (o teste não pode ser vazio)`).toBeGreaterThan(0);
  for (const a of animacoes) {
    const primeiro = a.quadros.find((q) => q.deslocamento === 0);
    expect(primeiro, `${quando}/${a.nome}: keyframe inicial`).toBeTruthy();
    if (primeiro.opacidade !== undefined) expect(Number(primeiro.opacidade), `${quando}/${a.nome}: opacidade do 1º keyframe`).toBe(1);
  }
  expect(Number(opacidadeNoInicio), `${quando}: opacidade da arte no instante 0`).toBe(1);
}

// Diferença média (e máxima), por canal R, G e B, entre a captura e o arquivo no tamanho original, olhando só os
// pixels 100% opacos do arquivo (sem 4 px de margem). A captura de um elemento sai arredondada para fora (pode ter 1 ou
// 2 pixels a mais em cada lado), então o encaixe é procurado entre -2 e +3 pixels. A média é a medida; o máximo só
// aparece no relatório (o decodificador de webp do Chrome e o do sharp divergem nas bordas de cor).
async function compararComArquivo(png, arquivo) {
  const cap = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ref = await sharp(arquivo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: cw, height: ch } = cap.info;
  const { width: rw, height: rh } = ref.info;
  const MARGEM = 4;
  const medir = (dx, dy, passo) => {
    const soma = [0, 0, 0];
    const maximo = [0, 0, 0];
    let opacos = 0;
    for (let y = MARGEM; y < rh - MARGEM; y += passo) {
      if (y + dy < 0 || y + dy >= ch) continue;
      for (let x = MARGEM; x < rw - MARGEM; x += passo) {
        if (x + dx < 0 || x + dx >= cw) continue;
        const r = (y * rw + x) * 4;
        if (ref.data[r + 3] !== 255) continue;
        const c = ((y + dy) * cw + (x + dx)) * 4;
        opacos++;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(cap.data[c + k] - ref.data[r + k]);
          soma[k] += d;
          if (d > maximo[k]) maximo[k] = d;
        }
      }
    }
    return { opacos, media: soma.map((s) => (opacos ? s / opacos : 255)), maximo };
  };
  let melhor = { dx: 0, dy: 0, soma: Infinity };
  for (let dy = -2; dy <= 3; dy++) {
    for (let dx = -2; dx <= 3; dx++) {
      const m = medir(dx, dy, 3);
      const soma = m.media[0] + m.media[1] + m.media[2];
      if (soma < melhor.soma) melhor = { dx, dy, soma };
    }
  }
  return { ...medir(melhor.dx, melhor.dy, 1), dx: melhor.dx, dy: melhor.dy };
}
