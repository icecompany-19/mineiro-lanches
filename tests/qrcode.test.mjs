// Testes do QR code (A4.2 e A4.3): node --test tests/qrcode.test.mjs
// Lê de verdade (jsQR) o PNG em vários tamanhos, o SVG rasterizado, um QR de mesa e o cartaz renderizado.
// A URL esperada é <base>/q, com a base de QR_BASE ou da VITE_SITE_URL do .env.production.
/* global document */ // só dentro de pagina.evaluate (roda no navegador)
import { after as depois, before as antes, test as teste } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import sharp from 'sharp';

// O Playwright (testDir: tests) também importa *.test.mjs. Lá estes testes do node:test não podem rodar
// (abririam navegador dentro do processo dele e mexeriam no código de saída): só com node --test ou node <arquivo>.
const NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT) || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
const nada = () => {};
const test = NODE_TEST ? teste : nada;
const before = NODE_TEST ? antes : nada;
const after = NODE_TEST ? depois : nada;
// Importado só aqui: no processo do Playwright o gerador (que mexe no fontconfig) nem carrega.
const { PASTA_QR, RAIZ, abrirCartaz, abrirNavegador, destinoDe, lerBase, montarQr, servirPasta } = NODE_TEST
  ? await import('../scripts/qrcode.mjs')
  : { PASTA_QR: '', lerBase: () => '', destinoDe: () => '' };

const BASE = lerBase();
const ESPERADO = destinoDe(BASE);
const PNG = join(PASTA_QR, 'cardapio.png');
const SVG = join(PASTA_QR, 'cardapio.svg');
const PX_POR_MM = 96 / 25.4;
// O cartaz é servido com a CSP do site (vercel.json): nada de script inline.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'";

// Decodifica uma imagem (caminho ou buffer), opcionalmente redimensionada para lado x lado.
async function ler(entrada, lado) {
  let img = sharp(entrada);
  if (lado) img = img.resize(lado, lado);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const achado = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return achado ? achado.data : null;
}

// Cor RGB do pixel (x, y) de uma imagem já decodificada por sharp(...).raw().
const pixel = ({ data, info }, x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];

test('PNG de 2048 px lê a URL exata', async () => {
  const meta = await sharp(PNG).metadata();
  assert.equal(meta.width, 2048);
  assert.equal(meta.height, 2048);
  assert.equal(await ler(PNG), ESPERADO);
});

for (const lado of [600, 300, 200, 150]) {
  test(`PNG reduzido para ${lado} px lê a URL exata`, async () => {
    assert.equal(await ler(PNG, lado), ESPERADO);
  });
}

test('menor tamanho em que o PNG ainda lê', async (t) => {
  let menor = null;
  for (let lado = 150; lado >= 40; lado -= 5) {
    if ((await ler(PNG, lado)) !== ESPERADO) break;
    menor = lado;
  }
  const q = montarQr(ESPERADO);
  const msg = `menor tamanho que ainda lê: ${menor} px (${q.lado} módulos com a margem, ${(menor / q.lado).toFixed(1)} px por módulo)`;
  t.diagnostic(msg);
  console.log(`  ${msg}`);
  assert.ok(menor && menor <= 150);
});

test('SVG rasterizado lê a URL exata e traz o selo embutido', async () => {
  const svg = readFileSync(SVG);
  for (const lado of [1024, 300]) assert.equal(await ler(await sharp(svg, { density: 300 }).png().toBuffer(), lado), ESPERADO);
  const texto = svg.toString();
  assert.match(texto, /fill="#1A1414"/);
  assert.match(texto, /fill="#FFF6E0"/);
  assert.match(texto, /<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0 0 600 600">/, 'selo como SVG aninhado');
  assert.doesNotMatch(texto, /(href|src)="(https?:|\/)/, 'sem referência externa');
});

test('cores, margem de 4 módulos e selo dentro dos limites', async () => {
  const q = montarQr(ESPERADO);
  const modulo = 2048 / q.lado;
  const img = await sharp(PNG).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Zona de silêncio inteira em creme (amostra no meio de cada módulo da margem).
  for (let i = 0; i < q.lado; i++)
    for (const j of [0, 1, 2, 3, q.lado - 4, q.lado - 3, q.lado - 2, q.lado - 1]) {
      for (const [x, y] of [
        [i, j],
        [j, i]
      ]) {
        const cor = pixel(img, Math.floor((x + 0.5) * modulo), Math.floor((y + 0.5) * modulo));
        assert.deepEqual(cor, [0xff, 0xf6, 0xe0], `margem em (${x}, ${y})`);
      }
    }
  // Canto do localizador em carvão.
  assert.deepEqual(pixel(img, Math.floor(4.5 * modulo), Math.floor(4.5 * modulo)), [0x1a, 0x14, 0x14]);
  assert.ok(q.fracaoSelo <= 0.2 && q.fracaoLimpa <= 0.2, 'selo em no máximo 20% da área');
  assert.ok(Math.max(...q.dano) <= Math.floor(q.corrige / 2), `selo gasta no máximo metade da correção (${q.dano} de ${q.corrige})`);
});

test('LEIA-ME traz o destino e como regenerar', () => {
  const leia = readFileSync(join(PASTA_QR, 'LEIA-ME.txt'), 'utf8');
  assert.ok(leia.includes(`Destino do QR: ${ESPERADO}\n`));
  assert.ok(leia.includes('npm run qrcode -- --base https://dominio-final'));
});

// Gerar QR novo renderiza o selo a partir do PDF da logo (pdftocairo, do poppler) ou, sem o poppler, do logo-selo.svg.
test('linha de comando: --base e QR de mesa', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'mineiro-qr-'));
  try {
    execFileSync(
      process.execPath,
      [join(RAIZ, 'scripts', 'qrcode.mjs'), `--base=${BASE}/`, '--mesas', '2-3', '--saida', pasta, '--sem-pdf'],
      {
        stdio: 'pipe'
      }
    );
    assert.equal(await ler(join(pasta, 'cardapio.png')), ESPERADO, 'barra final da base é ignorada');
    assert.equal(await ler(join(pasta, 'mesa-3.png')), destinoDe(BASE, 3));
    assert.equal(await ler(join(pasta, 'mesa-3.png'), 300), destinoDe(BASE, 3));
    assert.equal(
      await ler(
        await sharp(readFileSync(join(pasta, 'mesa-2.svg')))
          .png()
          .toBuffer()
      ),
      destinoDe(BASE, 2)
    );
    assert.match(readFileSync(join(pasta, 'LEIA-ME.txt'), 'utf8'), /Mesas: 2, 3 /);

    // Outra base, sem --mesas: os QR de mesa antigos saem (apontariam para a base velha).
    execFileSync(
      process.execPath,
      [join(RAIZ, 'scripts', 'qrcode.mjs'), '--base', 'https://exemplo.com.br', '--saida', pasta, '--sem-pdf'],
      { stdio: 'pipe' }
    );
    assert.equal(await ler(join(pasta, 'cardapio.png')), 'https://exemplo.com.br/q');
    assert.equal(existsSync(join(pasta, 'mesa-3.png')), false);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

// ---------- cartaz ----------

// Abre o cartaz guardando violações de CSP e erros de JS.
async function abrir(url, opcoes) {
  const problemas = [];
  const pagina = await abrirCartaz(navegador, url, opcoes, (p) => {
    p.on('console', (m) => /Content Security Policy/i.test(m.text()) && problemas.push(m.text()));
    p.on('pageerror', (e) => problemas.push(e.message));
  });
  return { pagina, problemas };
}

let servidor;
let navegador;
before(async () => {
  servidor = await servirPasta(join(RAIZ, 'public'), 0, { 'content-security-policy': CSP });
  navegador = await abrirNavegador();
});
after(async () => {
  await navegador?.close();
  await servidor?.fechar();
});

for (const tamanho of ['a6', 'a5']) {
  test(`cartaz ${tamanho.toUpperCase()} renderizado lê a URL exata`, async (t) => {
    const { pagina, problemas } = await abrir(`${servidor.url}/qr/cartaz.html?tamanho=${tamanho}`, {
      viewport: { width: 800, height: 1000 },
      deviceScaleFactor: 1
    });
    try {
      assert.deepEqual(problemas, [], 'sem violação de CSP nem erro de JS');
      await pagina.emulateMedia({ media: 'print' });
      const captura = await pagina.screenshot({ fullPage: true });
      assert.equal(await ler(captura), ESPERADO);

      const info = await pagina.evaluate(() => ({
        texto: document.body.innerText.replace(/\s+/g, ' '),
        fontes: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')),
        logo: document.querySelector('.logo').naturalWidth,
        qr: document.querySelector('#qr').getBoundingClientRect().width,
        folha: document.querySelector('.folha').getBoundingClientRect().width
      }));
      for (const trecho of ['Aponte a câmera e peça', '(11) 98572-0150', '@mineirolanchesuzano'])
        assert.ok(info.texto.includes(trecho), trecho);
      assert.match(info.texto, /cardápio completo, monte seu lanche e acompanhe o pedido/i);
      assert.ok(info.fontes.includes('Lilita One') && info.fontes.includes('Oswald'), `fontes locais carregadas: ${info.fontes}`);
      assert.ok(info.logo > 0, 'logo carregado');

      const q = montarQr(ESPERADO);
      const mmQr = info.qr / PX_POR_MM;
      const mmCodigo = (mmQr * q.n) / q.lado;
      assert.ok(Math.abs(info.folha / PX_POR_MM - (tamanho === 'a5' ? 148 : 105)) < 0.5, 'largura da folha');
      assert.ok(mmCodigo >= 40, `QR com pelo menos 4 cm (${mmCodigo.toFixed(1)} mm sem a margem)`);
      t.diagnostic(`QR no cartaz ${tamanho}: ${mmQr.toFixed(1)} mm com a margem, ${mmCodigo.toFixed(1)} mm só o código`);
    } finally {
      await pagina.close();
    }
  });
}

test('cartaz de mesa sem QR gerado mostra o aviso', async () => {
  const { pagina, problemas } = await abrir(`${servidor.url}/qr/cartaz.html?mesa=99`);
  try {
    await pagina.waitForSelector('.aviso');
    assert.deepEqual(problemas, []);
    assert.equal(await pagina.textContent('#mesa'), 'Mesa 99');
    assert.match(await pagina.textContent('.aviso'), /npm run qrcode -- --mesas/);
  } finally {
    await pagina.close();
  }
});

test('PDFs do cartaz existem em A6 e A5, com uma página', () => {
  for (const [tamanho, larg, alt] of [
    ['a6', 297.6, 419.5],
    ['a5', 419.5, 595.3]
  ]) {
    const arquivo = join(PASTA_QR, `cartaz-${tamanho}.pdf`);
    assert.ok(existsSync(arquivo), arquivo);
    const pdf = readFileSync(arquivo);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const texto = pdf.toString('latin1');
    assert.equal((texto.match(/\/Type\s*\/Page[^s]/g) || []).length, 1, `${tamanho}: uma página`);
    const caixa = texto.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    assert.ok(caixa, `${tamanho}: MediaBox`);
    assert.ok(Math.abs(Number(caixa[1]) - larg) < 2 && Math.abs(Number(caixa[2]) - alt) < 2, `${tamanho}: ${caixa[1]} x ${caixa[2]} pt`);
  }
});

// O PDF "impresso" a 300 dpi (pdftoppm, do poppler) também lê. Pula se o poppler não estiver instalado.
const temPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
test('PDFs rasterizados a 300 dpi leem a URL exata', { skip: !temPdftoppm && 'pdftoppm não instalado' }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'mineiro-pdf-'));
  try {
    for (const tamanho of ['a6', 'a5']) {
      execFileSync('pdftoppm', ['-r', '300', '-png', '-singlefile', join(PASTA_QR, `cartaz-${tamanho}.pdf`), join(pasta, tamanho)]);
      assert.equal(await ler(join(pasta, `${tamanho}.png`)), ESPERADO, tamanho);
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
