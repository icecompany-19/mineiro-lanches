// Testes da logo oficial (scripts/logo.mjs e scripts/icones.mjs): node --test tests/logo.test.mjs
// Cada arquivo gerado é comparado com uma renderização direta do PDF do cliente na mesma escala e na mesma grade de
// pixels: diferença média perto de zero e nenhum desvio de cor. O SVG recortado, rasterizado, também precisa bater.
// Precisa do poppler-utils (pdftocairo, pdfimages).
import { test as teste } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// O Playwright (testDir: tests) também importa *.test.mjs: lá estes testes do node:test não rodam.
const NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT) || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
const test = NODE_TEST ? teste : () => {};
const L = NODE_TEST ? await import('../scripts/logo.mjs') : {};
const I = NODE_TEST ? await import('../scripts/icones.mjs') : {};

const PUBLICO = NODE_TEST ? join(L.RAIZ, 'public') : '';
const dados = NODE_TEST ? JSON.parse(readFileSync(L.DADOS, 'utf8')) : {};

// ---------- comparação ----------

async function rgba(entrada, largura, altura) {
  const { data, info } = await sharp(entrada).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (largura) assert.deepEqual([info.width, info.height], [largura, altura], 'tamanho');
  return { data, largura: info.width, altura: info.height };
}

// Diferença de cada canal (cor pré-multiplicada pelo alfa, e o alfa) em níveis de 0 a 255:
// média absoluta, viés (média com sinal: mostra mudança de cor) e máximo.
function comparar(a, b) {
  assert.equal(a.data.length, b.data.length);
  const n = a.data.length / 4;
  const media = [0, 0, 0, 0],
    vies = [0, 0, 0, 0];
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const pa = a.data[i + 3] / 255,
      pb = b.data[i + 3] / 255;
    for (let c = 0; c < 4; c++) {
      const d = c < 3 ? a.data[i + c] * pa - b.data[i + c] * pb : a.data[i + 3] - b.data[i + 3];
      media[c] += Math.abs(d);
      vies[c] += d;
      if (Math.abs(d) > max) max = Math.abs(d);
    }
  }
  return { media: media.map((v) => v / n), vies: vies.map((v) => v / n), max };
}

function conferir(dif, { media, vies, max }, rotulo) {
  const txt = `${rotulo}: média ${dif.media.map((v) => v.toFixed(3)).join('/')} · viés ${dif.vies.map((v) => v.toFixed(3)).join('/')} · máx ${dif.max.toFixed(0)}`;
  for (let c = 0; c < 4; c++) {
    assert.ok(dif.media[c] <= media, `${txt} (média acima de ${media})`);
    assert.ok(Math.abs(dif.vies[c]) <= vies, `${txt} (desvio de cor acima de ${vies})`);
  }
  assert.ok(dif.max <= max, `${txt} (máximo acima de ${max})`);
  return txt;
}

// Renderização direta do PDF num recorte (x, y, largura, altura em px na escala dada).
const direta = (r) => rgba(L.renderizarPagina({ ...r, ppi: r.escala * 72 }), r.largura, r.altura);

// Limites dos pixels com alfa > 0.
function caixaAlfa({ data, largura, altura }) {
  let x0 = largura,
    y0 = altura,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < altura; y++)
    for (let x = 0; x < largura; x++)
      if (data[(y * largura + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return { x0, y0, x1, y1 };
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---------- dados da extração ----------

test('logo.json é deste PDF e registra a resolução real dos bitmaps', () => {
  assert.equal(dados.sha256, sha256(readFileSync(L.PDF)), 'PDF mudou: rode node scripts/logo.mjs');
  const { caixa } = dados;
  assert.ok(caixa.w > 400 && caixa.w < 420 && caixa.h > 330 && caixa.h < 340, `caixa ${caixa.w} × ${caixa.h} pt`);
  const anel = dados.bitmaps.find((b) => b.formato === 'jpeg' && b.largura === 507);
  assert.ok(anel, 'JPEG de 507 px (anel) listado');
  assert.equal(dados.larguraUtilPx, Math.round((caixa.w * Math.min(...dados.bitmaps.map((b) => b.ppi))) / 72));
  assert.ok(dados.larguraUtilPx > 600 && dados.larguraUtilPx < 650, `largura útil ${dados.larguraUtilPx} px`);
  // o raio do selo contém a caixa inteira só se for maior que a meia-largura; e nunca maior que a meia-diagonal
  assert.ok(dados.raio >= caixa.w / 2 && dados.raio <= Math.hypot(caixa.w, caixa.h) / 2, `raio ${dados.raio}`);
});

// ---------- rasters ----------

for (const largura of L.LARGURAS || []) {
  test(`logo-${largura}.png e .webp = PDF renderizado na mesma escala`, async (t) => {
    const r = dados.rasters[largura];
    assert.ok(r, `rasters.${largura} no logo.json`);
    // o recorte é o da caixa na grade da página, com a arte inteira dentro
    assert.equal(r.largura, largura);
    assert.equal(r.x, Math.floor(dados.caixa.x * r.escala));
    assert.equal(r.y, Math.floor(dados.caixa.y * r.escala));
    assert.ok((dados.caixa.x + dados.caixa.w) * r.escala <= r.x + r.largura + 1e-6, 'arte cabe na largura');
    assert.ok((dados.caixa.y + dados.caixa.h) * r.escala <= r.y + r.altura + 1e-6, 'arte cabe na altura');

    const ref = await direta(r);
    const png = await rgba(join(L.PASTA_LOGO, `logo-${largura}.png`), r.largura, r.altura);
    t.diagnostic(conferir(comparar(png, ref), { media: 0.01, vies: 0.01, max: 1 }, 'png'));
    const webp = await rgba(join(L.PASTA_LOGO, `logo-${largura}.webp`), r.largura, r.altura);
    t.diagnostic(conferir(comparar(webp, ref), { media: 0.5, vies: 0.1, max: 8 }, 'webp'));

    // recorte com margem mínima: a arte encosta (até 1 px) nos quatro lados
    const c = caixaAlfa(png);
    assert.ok(c.x0 <= 1 && c.y0 <= 1 && c.x1 >= r.largura - 2 && c.y1 >= r.altura - 2, `margens ${JSON.stringify(c)}`);
  });
}

for (const lado of L.LADOS_SELO || []) {
  test(`selo-${lado}.png e .webp = PDF renderizado, arte inteira no círculo inscrito`, async (t) => {
    const r = dados.selos?.[lado];
    assert.ok(r, `selos.${lado} no logo.json`);
    const esperado = L.recorteDoSelo(dados, lado);
    assert.deepEqual([r.x, r.y, r.largura, r.altura], [esperado.x, esperado.y, lado, lado], 'quadrado centrado na caixa');
    assert.ok(Math.abs(r.escala - esperado.escala) < 1e-7, 'círculo da arte inscrito no quadrado');
    const ref = await direta(r);
    const png = await rgba(join(L.PASTA_LOGO, `selo-${lado}.png`), lado, lado);
    t.diagnostic(conferir(comparar(png, ref), { media: 0.01, vies: 0.01, max: 1 }, 'png'));
    t.diagnostic(conferir(comparar(await rgba(join(L.PASTA_LOGO, `selo-${lado}.webp`), lado, lado), ref), { media: 0.5, vies: 0.1, max: 8 }, 'webp'));
    let fora = 0;
    for (let y = 0; y < lado; y++)
      for (let x = 0; x < lado; x++) if (png.data[(y * lado + x) * 4 + 3] && Math.hypot(x + 0.5 - lado / 2, y + 0.5 - lado / 2) > lado / 2 + 1) fora++;
    assert.equal(fora, 0, 'arte fora do círculo inscrito');
  });
}

// ---------- SVG ----------

// O SVG reenquadrado na grade de pixels de um recorte da renderização direta.
const naGrade = (svg, r) =>
  Buffer.from(L.reenquadrarSvg(svg, { x: r.x / r.escala, y: r.y / r.escala, w: r.largura / r.escala, h: r.altura / r.escala }, r.largura, r.altura));

test('SVG recortado: texto em vetor, bitmaps originais do PDF e nada do logo reprovado', () => {
  const svg = readFileSync(join(L.PASTA_LOGO, 'logo.svg'), 'utf8');
  assert.equal(readFileSync(L.LOGO_SVG, 'utf8'), svg, 'public/assets/logo.svg = public/assets/logo/logo.svg');
  const { x, y, w, h } = dados.caixa;
  assert.ok(svg.includes(`viewBox="${x} ${y} ${w} ${h}"`), 'viewBox na caixa do conteúdo');
  assert.ok((svg.match(/<path [^>]*\bd="/g) || []).length >= 10, 'contornos do texto em vetor');
  assert.doesNotMatch(svg, /<text|@font-face|Lilita|lg-anel|lg-faixa/, 'sem texto com fonte nem peças do logo redesenhado');

  // Os JPEGs embutidos são os bytes originais do PDF (pdfimages -j copia o fluxo DCT sem recodificar).
  const pasta = mkdtempSync(join(tmpdir(), 'ml-logo-teste-'));
  try {
    execFileSync('pdfimages', ['-j', L.PDF, join(pasta, 'b')]);
    const originais = readdirSync(pasta)
      .filter((a) => a.endsWith('.jpg'))
      .map((a) => sha256(readFileSync(join(pasta, a))));
    const embutidos = [...svg.matchAll(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g)].map((m) => sha256(Buffer.from(m[1], 'base64')));
    assert.equal(originais.length, 2);
    assert.deepEqual([...embutidos].sort(), [...originais].sort(), 'JPEGs do SVG = JPEGs do PDF');
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

for (const largura of [1024, 512, 128]) {
  test(`SVG recortado rasterizado = PDF renderizado (${largura} px)`, async (t) => {
    const r = dados.rasters[largura];
    const svg = readFileSync(join(L.PASTA_LOGO, 'logo.svg'), 'utf8');
    const dif = comparar(await rgba(naGrade(svg, r), r.largura, r.altura), await direta(r));
    t.diagnostic(conferir(dif, { media: 0.3, vies: 0.1, max: 64 }, 'svg'));
  });
}

test('logo-selo.svg: a mesma arte num quadrado de 600, inteira no círculo inscrito', async (t) => {
  const svg = readFileSync(L.SELO_SVG, 'utf8');
  assert.match(svg, /viewBox="0 0 600 600"/);
  // grade: selo = k · página + t; o recorte direto na escala k começa no pixel (rx, ry)
  const k = L.escalaDoSelo(dados);
  const r = L.recorteNaEscala(dados.caixa, k);
  const tx = 300 - k * dados.centro.x,
    ty = 300 - k * dados.centro.y;
  const quadro = { x: r.x + tx, y: r.y + ty, w: r.largura, h: r.altura };
  const selo = await rgba(Buffer.from(L.reenquadrarSvg(svg, quadro, r.largura, r.altura)), r.largura, r.altura);
  t.diagnostic(conferir(comparar(selo, await direta(r)), { media: 0.3, vies: 0.1, max: 64 }, 'selo'));

  // nenhum pixel da arte fora do círculo de raio 300 (o painel e o QR recortam em círculo)
  const cheio = await rgba(Buffer.from(svg), 600, 600);
  let fora = 0;
  for (let y = 0; y < 600; y++)
    for (let x = 0; x < 600; x++) if (cheio.data[(y * 600 + x) * 4 + 3] > 8 && Math.hypot(x + 0.5 - 300, y + 0.5 - 300) > 300.5) fora++;
  assert.equal(fora, 0, 'arte fora do círculo inscrito');
});

// ---------- ícones ----------

test('favicon.svg é o SVG recortado num quadrado (logo em vetor)', async () => {
  const fav = readFileSync(join(PUBLICO, 'favicon.svg'), 'utf8');
  const recortado = readFileSync(join(L.PASTA_LOGO, 'logo.svg'), 'utf8');
  const semRaiz = (s) => s.replace(/<svg [^>]*>/, '<svg>');
  assert.equal(semRaiz(fav), semRaiz(recortado), 'mesmo desenho, só o enquadramento muda');
  const vb = fav.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.equal(vb[2], vb[3], 'viewBox quadrado');
  assert.ok(vb[0] <= dados.caixa.x && vb[0] + vb[2] >= dados.caixa.x + dados.caixa.w - 1e-3, 'arte inteira no quadro');
  assert.ok(vb[1] <= dados.caixa.y && vb[1] + vb[3] >= dados.caixa.y + dados.caixa.h - 1e-3, 'arte inteira no quadro');
});

for (const esp of I.ESPECIFICACOES || []) {
  test(`icons/${esp.nome}: a logo renderizada do PDF, inteira e centrada`, async (t) => {
    const arquivo = join(I.ICONES, esp.nome);
    const icone = await rgba(arquivo, esp.lado, esp.lado);
    // igual ao que o script gera agora a partir do PDF
    const novo = await rgba(await I.gerarIcone(dados, esp), esp.lado, esp.lado);
    t.diagnostic(conferir(comparar(icone, novo), { media: 0.01, vies: 0.01, max: 1 }, 'ícone'));
    // e a região da logo = renderização direta (onde a logo é opaca, o fundo não interfere)
    const { escala, esquerda, topo } = I.layoutDoIcone(dados, esp);
    const r = L.recorteNaEscala(dados.caixa, escala);
    const logo = await direta(r);
    let soma = 0,
      n = 0;
    for (let y = 0; y < r.altura; y++)
      for (let x = 0; x < r.largura; x++) {
        const o = (y * r.largura + x) * 4;
        if (logo.data[o + 3] !== 255) continue;
        const p = ((topo + y) * esp.lado + esquerda + x) * 4;
        for (let c = 0; c < 3; c++) soma += Math.abs(icone.data[p + c] - logo.data[o + c]);
        n += 3;
      }
    assert.ok(n > 0 && soma / n < 0.01, `região da logo difere do PDF (${(soma / n).toFixed(3)})`);

    // fundo: transparente ou carvão; a arte não encosta na borda; no maskable, cabe no círculo seguro (80%)
    const canto = [...icone.data.subarray(0, 4)];
    assert.deepEqual(canto, esp.fundo ? [0x1a, 0x14, 0x14, 255] : [0, 0, 0, 0], 'fundo');
    if (esp.ajuste === 'circulo') {
      const raioSeguro = esp.lado * 0.4;
      for (let y = 0; y < esp.lado; y++)
        for (let x = 0; x < esp.lado; x++) {
          const o = (y * esp.lado + x) * 4;
          const fundo = Math.abs(icone.data[o] - 0x1a) + Math.abs(icone.data[o + 1] - 0x14) + Math.abs(icone.data[o + 2] - 0x14) < 6;
          if (!fundo) assert.ok(Math.hypot(x + 0.5 - esp.lado / 2, y + 0.5 - esp.lado / 2) <= raioSeguro, `arte fora da zona segura em (${x}, ${y})`);
        }
    } else if (esp.fundo) {
      assert.ok(esquerda >= 1 && topo >= 1 && esquerda + r.largura <= esp.lado - 1, 'respiro em volta da logo');
    }
  });
}

// ---------- og:image ----------

test('og.jpg: 1200×630 com a logo real sobre fundo escuro e uma foto real', async (t) => {
  const og = await rgba(L.OG, 1200, 630);
  const meta = await sharp(L.OG).metadata();
  assert.equal(meta.format, 'jpeg');
  const { escala, esquerda, topo } = L.layoutOg(dados);
  const r = L.recorteNaEscala(dados.caixa, escala);
  const logo = await direta(r);
  const soma = [0, 0, 0],
    vies = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < r.altura; y++)
    for (let x = 0; x < r.largura; x++) {
      const o = (y * r.largura + x) * 4;
      if (logo.data[o + 3] !== 255) continue;
      const p = ((topo + y) * 1200 + esquerda + x) * 4;
      for (let c = 0; c < 3; c++) {
        soma[c] += Math.abs(og.data[p + c] - logo.data[o + c]);
        vies[c] += og.data[p + c] - logo.data[o + c];
      }
      n++;
    }
  const media = soma.map((v) => v / n),
    desvio = vies.map((v) => v / n);
  t.diagnostic(`logo no og: média ${media.map((v) => v.toFixed(2)).join('/')} · viés ${desvio.map((v) => v.toFixed(2)).join('/')}`);
  assert.ok(media.every((v) => v < 2.5) && desvio.every((v) => Math.abs(v) < 1), 'logo do og = PDF (só a perda do JPEG)');
  // canto superior esquerdo escuro (carvão, com o véu) e a foto à direita com detalhe de verdade
  const [cr, cg, cb] = og.data.subarray(0, 3);
  assert.ok(cr < 40 && cg < 40 && cb < 40, `fundo escuro (${cr}, ${cg}, ${cb})`);
  const { channels } = await sharp(L.OG).extract({ left: 900, top: 100, width: 250, height: 430 }).stats();
  assert.ok(channels[0].stdev > 20, 'foto na metade direita');
});

// ---------- QR ----------

test('QR do cardápio usa a logo real no selo', () => {
  const qr = join(PUBLICO, 'qr', 'cardapio.svg');
  if (!existsSync(qr)) return;
  const svg = readFileSync(qr, 'utf8');
  assert.match(svg, /data:image\/jpeg;base64,/, 'bitmaps da logo embutidos no selo');
  assert.doesNotMatch(svg, /@font-face|Lilita/, 'nada do selo redesenhado');
});
