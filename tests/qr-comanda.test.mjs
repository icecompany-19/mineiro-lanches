// Testes do QR da comanda (F3-12, contrato C3 do docs/PLANO-FASE-3.md): node --test tests/qr-comanda.test.mjs
// Sem navegador nem banco: o SVG de src/lib/qr-comanda.js é rasterizado com o sharp (librsvg) em vários tamanhos e lido de
// verdade com o jsQR, inclusive depois de cinza + limiar 1-bit, que é o que a impressora térmica faz (203 dpi, preto ou branco).
// O spec tests/comanda-impressao.spec.js repete a leitura no navegador, com a comanda montada pelo painel.
import { test as teste } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import QRCode from 'qrcode/lib/core/qrcode.js';
import sharp from 'sharp';
import { qrSvg } from '../src/lib/qr-comanda.js';

// O Playwright (testDir: tests) também importa *.test.mjs: lá estes testes do node:test não podem rodar.
const NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT) || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
const test = NODE_TEST ? teste : () => {};

const RAIZ = resolve(fileURLToPath(import.meta.url), '..', '..');
// um uuid de verdade (letras e números misturados): o QR comprime sequências só de dígitos, e os ids reais não são assim
const ID = 'b3f1c2a4-9d7e-4f10-8a6b-5c2e91d07a3f';
const BASE = 'https://mineirolanches.store';
// a carga real: <site>/motoboy/#<id do pedido> (74 caracteres com o domínio novo)
const CARGA = `${BASE}/motoboy/#${ID}`;
// ~66 caracteres, o tamanho de referência do contrato
const CARGA_66 = `${BASE}/motoboy/#${ID.slice(0, 28)}`;
// o endereço de reserva (vercel.app) é mais longo e muda de versão do QR
const CARGA_VERCEL = `https://mineiro-lanches.vercel.app/motoboy/#${ID}`;
const DPI_TERMICA = 203;

const mm = (svg, atributo) => parseFloat(new RegExp(`${atributo}="([\\d.]+)mm"`).exec(svg)[1]);

// SVG -> PNG na densidade pedida (px por polegada; o SVG tem o tamanho em mm)
const rasterizar = (svg, densidade) => sharp(Buffer.from(svg), { density: densidade }).flatten({ background: '#fff' }).png().toBuffer();

// decodifica um PNG com o jsQR; umBit = cinza + limiar em 128, como a térmica
async function ler(png, { umBit = false } = {}) {
  let img = sharp(png).grayscale();
  if (umBit) img = img.threshold(128);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  // o jsQR quer RGBA; o cinza do sharp vem com 1 canal (primeiro byte de cada pixel)
  const rgba = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const v = data[i * info.channels];
    rgba.set([v, v, v, 255], i * 4);
  }
  const achado = jsQR(rgba, info.width, info.height);
  return achado ? achado.data : null;
}

test('carga de ~66 caracteres: lado entre 28 e 40 mm, quadrado, viewBox em módulos', () => {
  assert.equal(CARGA_66.length, 66);
  assert.equal(CARGA.length, 74);
  for (const carga of [CARGA_66, CARGA]) {
    const svg = qrSvg(carga);
    const larg = mm(svg, 'width');
    const alt = mm(svg, 'height');
    assert.equal(larg, alt, 'quadrado');
    assert.ok(larg >= 28 && larg <= 40, `${carga.length} caracteres: ${larg} mm`);
    // 41 módulos (versão 6) + 2 × 4 de margem, a 0,8 mm cada um
    const [, lado] = /viewBox="0 0 (\d+) \1"/.exec(svg);
    assert.equal(+lado, 49);
    assert.equal(larg, +(49 * 0.8).toFixed(3));
  }
});

test('qualquer uuid no domínio novo cabe em 28–40 mm (a versão 6 do QR comporta 74 bytes em Q)', async () => {
  for (let i = 0; i < 300; i++) {
    const carga = `${BASE}/motoboy/#${randomUUID()}`;
    const larg = mm(qrSvg(carga), 'width');
    assert.ok(larg >= 28 && larg <= 40, `${carga}: ${larg} mm`);
  }
  // e lê: uma amostra, em 1 bit aos 203 dpi
  for (let i = 0; i < 12; i++) {
    const carga = `${BASE}/motoboy/#${randomUUID()}`;
    assert.equal(await ler(await rasterizar(qrSvg(carga), DPI_TERMICA), { umBit: true }), carga);
  }
});

test('o endereço de reserva (vercel.app) é mais longo (versão 7), mas cabe nos 72 mm do papel', () => {
  const larg = mm(qrSvg(CARGA_VERCEL), 'width');
  assert.equal(CARGA_VERCEL.length, 80);
  assert.ok(larg > 40 && larg < 72 - 2 * 3, `${larg} mm (papel de 72 mm menos 3 mm de cada lado)`);
});

test('um único <svg>, um único <path>, fundo branco, sem a palavra "Mineiro" e sem CSS para desenhar', () => {
  const svg = qrSvg(CARGA, { rotulo: 'QR code da entrega do pedido #0011' });
  assert.equal(svg.match(/<svg\b/g).length, 1);
  assert.equal(svg.match(/<\/svg>/g).length, 1);
  assert.equal(svg.match(/<path\b/g).length, 1);
  assert.equal(svg.match(/<rect\b/g).length, 1, 'só o fundo é um <rect>');
  assert.match(svg, /<rect width="49" height="49" fill="#fff"\/>/);
  assert.match(svg, /<path fill="#000" d="M[^"]+"\/>/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="QR code da entrega do pedido #0011"/);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
  assert.doesNotMatch(svg, /mineiro/i, 'tests/logo-tela.spec.js reprova svg com "mineiro"');
  assert.doesNotMatch(svg, /style=|<style|<image|<text|<title|<script|filter|mask|opacity|url\(|href/i, 'só atributos de desenho, nada de CSS nem imagem');
});

test('o rótulo padrão não leva "Mineiro", a URL nem o id do pedido', () => {
  const svg = qrSvg(CARGA);
  const rotulo = /aria-label="([^"]*)"/.exec(svg)[1];
  assert.ok(rotulo.length > 10, 'tem rótulo');
  assert.doesNotMatch(rotulo, /mineiro|http|motoboy|#|[0-9a-f]{8}-[0-9a-f]{4}/i);
});

test('o rótulo é escapado (não quebra o atributo nem o XML)', async () => {
  const svg = qrSvg(CARGA, { rotulo: 'A "B" <C> & \'D\'' });
  assert.match(svg, /aria-label="A &quot;B&quot; &lt;C&gt; &amp; &#39;D&#39;"/);
  assert.equal(svg.match(/<svg\b/g).length, 1);
  assert.equal(await ler(await rasterizar(svg, 300)), CARGA, 'o SVG continua válido e legível');
});

test('o caminho desenha exatamente os módulos do QR (corridas horizontais, margem de 4)', () => {
  const qr = QRCode.create(CARGA, { errorCorrectionLevel: 'Q' });
  const n = qr.modules.size;
  const d = /<path fill="#000" d="([^"]+)"/.exec(qrSvg(CARGA))[1];
  const pintado = new Set();
  let corridas = 0;
  for (const [, x, y, c, c2] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    assert.equal(c, c2, 'a corrida volta pelo mesmo comprimento');
    corridas++;
    for (let i = 0; i < +c; i++) pintado.add(`${+y - 4},${+x - 4 + i}`);
  }
  assert.equal(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, ''), '', 'o caminho só tem corridas');
  assert.ok(corridas > 100 && corridas < n * n / 2, `${corridas} corridas`);
  for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) assert.equal(pintado.has(`${l},${c}`), !!qr.modules.get(l, c), `módulo (${l}, ${c})`);
  for (const chave of pintado) {
    const [l, c] = chave.split(',').map(Number);
    assert.ok(l >= 0 && l < n && c >= 0 && c < n, 'nada pintado na zona de silêncio');
  }
});

for (const [nome, carga] of [['de ~66 caracteres', CARGA_66], ['real, de 74 caracteres', CARGA], ['do endereço de reserva (vercel.app)', CARGA_VERCEL]]) {
  test(`carga ${nome} lê a URL exata em 203, 300 e 600 dpi`, async () => {
    const svg = qrSvg(carga);
    for (const dpi of [DPI_TERMICA, 300, 600]) {
      const png = await rasterizar(svg, dpi);
      assert.equal(await ler(png), carga, `${dpi} dpi`);
    }
  });

  test(`carga ${nome} lê a URL exata depois de cinza + limiar 1-bit (térmica)`, async () => {
    const svg = qrSvg(carga);
    for (const dpi of [DPI_TERMICA, 300, 600]) {
      const png = await rasterizar(svg, dpi);
      assert.equal(await ler(png, { umBit: true }), carga, `${dpi} dpi em 1 bit`);
    }
  });
}

test('aos 203 dpi da térmica o módulo de 0,8 mm tem ~6,4 pontos e a imagem tem o tamanho certo', async () => {
  const svg = qrSvg(CARGA);
  const { width, height } = await sharp(await rasterizar(svg, DPI_TERMICA)).metadata();
  const esperado = (mm(svg, 'width') / 25.4) * DPI_TERMICA; // ~313 pontos
  assert.ok(Math.abs(width - esperado) <= 1.5 && width === height, `${width}×${height} para ${esperado.toFixed(1)}`);
  assert.ok(Math.abs(width / 49 - 6.4) < 0.1, `${(width / 49).toFixed(2)} pontos por módulo`);
});

test('1-bit com ruído leve ainda lê (borda de módulo e papel levemente cinza)', async () => {
  const png = await rasterizar(qrSvg(CARGA), DPI_TERMICA);
  // papel térmico não é branco puro: clareia o preto e escurece o branco antes do limiar
  const suave = await sharp(png).linear(0.7, 50).blur(0.6).toBuffer();
  assert.equal(await ler(suave, { umBit: true }), CARGA);
});

test('opções: correção de erro, tamanho do módulo, margem e um módulo de 0,75 mm (6 pontos a 203 dpi)', async () => {
  const lado = (svg) => +/viewBox="0 0 (\d+)/.exec(svg)[1];
  assert.ok(lado(qrSvg(CARGA, { ecc: 'L' })) < lado(qrSvg(CARGA, { ecc: 'Q' })), 'L é menor que Q');
  assert.ok(lado(qrSvg(CARGA, { ecc: 'H' })) > lado(qrSvg(CARGA, { ecc: 'Q' })), 'H é maior que Q');
  assert.equal(lado(qrSvg(CARGA, { margem: 2 })), 45);
  assert.equal(mm(qrSvg(CARGA, { moduloMm: 0.75 }), 'width'), 36.75);
  const seis = qrSvg(CARGA, { moduloMm: 0.75 });
  const png = await rasterizar(seis, DPI_TERMICA);
  const { width } = await sharp(png).metadata();
  assert.ok(Math.abs(width - 49 * 6) <= 1.5, `${width} pontos`);
  assert.equal(await ler(png, { umBit: true }), CARGA);
});

test('sem texto não há QR', () => {
  for (const vazio of ['', null, undefined]) assert.throws(() => qrSvg(vazio), /No input text/);
});

// ---------- contrato do painel (sem navegador): o que a comanda precisa para sair certa ----------
const painelJs = readFileSync(resolve(RAIZ, 'src/painel/painel.js'), 'utf8');
const painelCss = readFileSync(resolve(RAIZ, 'src/painel/painel.css'), 'utf8');
const mainPainel = readFileSync(resolve(RAIZ, 'src/main-painel.js'), 'utf8');

test('painel.js continua IIFE sem import nem import.meta; o QR vem de window.MLQr', () => {
  assert.doesNotMatch(painelJs, /^\s*import[\s{*]/m);
  assert.doesNotMatch(painelJs, /import\.meta|\bexport\s/);
  assert.match(painelJs, /window\.MLQr/);
  assert.match(mainPainel, /import \{ qrSvg \} from '\.\/lib\/qr-comanda\.js'/);
  assert.match(mainPainel, /window\.MLQr = \{ qrSvg, base: /);
  assert.ok(mainPainel.indexOf('window.MLQr') < mainPainel.indexOf('iniciarAcesso({'), 'MLQr antes de iniciar o painel');
});

test('a comanda usa a logo oficial em webp 512 e nunca o svg, o selo ou o 1024', () => {
  const img = /<img class="pn-c-logo"[^>]*>/.exec(painelJs)[0];
  assert.match(img, /src="\/assets\/logo\/logo-512\.webp"/);
  assert.match(img, /width="512" height="416"/);
  assert.match(img, /alt="Mineiro Lanche food truck"/);
  assert.match(img, /decoding="sync"/);
  assert.doesNotMatch(img, /style=|filter|mask|blend/);
  const comanda = painelJs.slice(painelJs.indexOf('function comandaHTML'), painelJs.indexOf('function abrirComanda'));
  assert.doesNotMatch(comanda, /logo-1024|logo\.svg|logo-selo\.svg|selo-\d+/);
});

test('o CSS da logo e do QR da comanda não usa filter, blend, máscara, fundo nem sombra', () => {
  const regras = painelCss.split('\n').filter((l) => /^\.pn-c-(logo|qr)\b/.test(l));
  assert.ok(regras.length >= 4, `regras da logo e do QR: ${regras.length}`);
  for (const r of regras) assert.doesNotMatch(r, /filter|blend|mask|background|box-shadow|clip-path/, r);
  const logo = regras.find((r) => r.startsWith('.pn-c-logo'));
  assert.match(logo, /display: block; width: 38mm; height: auto; margin: 0 auto 2mm/);
  assert.match(regras.find((r) => r.startsWith('.pn-c-qr {')), /text-align: center; break-inside: avoid/);
  assert.match(regras.find((r) => r.startsWith('.pn-c-qr svg')), /display: block; margin: 0 auto; max-width: 100%/);
  assert.match(painelCss, /\.pn-comanda \{[^}]*width: 72mm/, 'a comanda continua com 72 mm');
});
