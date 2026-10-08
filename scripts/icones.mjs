// Gera favicon e ícones do app a partir do selo (public/assets/logo-selo.svg).
// Uso: node scripts/icones.mjs
// Saída: public/favicon.svg e public/icons/{favicon-32,icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
//
// O selo traz a Lilita One embutida em @font-face (data:), que o librsvg do sharp ignora.
// Por isso a fonte do @fontsource é convertida de WOFF para TTF e entregue ao fontconfig
// (o SVG já tem 'Lilita One' na lista de font-family).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const RAIZ = resolve(import.meta.dirname, '..');
const SELO = join(RAIZ, 'public/assets/logo-selo.svg');
const PUBLICO = join(RAIZ, 'public');
const ICONES = join(PUBLICO, 'icons');
const WOFF_LILITA = join(RAIZ, 'node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff');
const VERMELHO = '#C8102E';

// WOFF 1.0 → SFNT (TTF): cada tabela vem comprimida com zlib.
function woffParaTtf(woff) {
  const n = woff.readUInt16BE(12);
  const tabelas = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const off = woff.readUInt32BE(o + 4),
      comp = woff.readUInt32BE(o + 8),
      orig = woff.readUInt32BE(o + 12);
    const bruto = woff.subarray(off, off + comp);
    tabelas.push({ tag: woff.readUInt32BE(o), soma: woff.readUInt32BE(o + 16), dados: comp < orig ? inflateSync(bruto) : bruto });
  }
  let exp = 0;
  while (1 << (exp + 1) <= n) exp++;
  const faixa = (1 << exp) * 16;
  const cab = Buffer.alloc(12 + n * 16);
  cab.writeUInt32BE(woff.readUInt32BE(4), 0);
  cab.writeUInt16BE(n, 4);
  cab.writeUInt16BE(faixa, 6);
  cab.writeUInt16BE(exp, 8);
  cab.writeUInt16BE(n * 16 - faixa, 10);
  const partes = [cab];
  let pos = cab.length;
  tabelas.forEach((t, i) => {
    const o = 12 + i * 16,
      pad = (4 - (t.dados.length % 4)) % 4;
    cab.writeUInt32BE(t.tag, o);
    cab.writeUInt32BE(t.soma, o + 4);
    cab.writeUInt32BE(pos, o + 8);
    cab.writeUInt32BE(t.dados.length, o + 12);
    partes.push(t.dados, Buffer.alloc(pad));
    pos += t.dados.length + pad;
  });
  return Buffer.concat(partes);
}

// Cópia enxuta do selo para favicon: sem fonte que nenhum texto usa, acessibilidade de <img>,
// classes de animação e casas decimais sobrando.
function otimizarSvg(svg) {
  return svg
    .replace(/@font-face\{font-family:'([^']+)';[^}]*\}/g, (bloco, familia) => (svg.split(familia).length > 2 ? bloco : ''))
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/\s(role|aria-label|class)="[^"]*"/g, '')
    .replace(/\sstyle="--i:\d+"/g, '')
    .replace(/(\d+\.\d{3,})/g, (n) => String(Math.round(Number(n) * 100) / 100))
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// O fontconfig precisa estar configurado antes de o sharp (libvips) carregar.
const tmp = mkdtempSync(join(tmpdir(), 'ml-icones-'));
mkdirSync(join(tmp, 'fontes'));
writeFileSync(join(tmp, 'fontes/lilita-one.ttf'), woffParaTtf(readFileSync(WOFF_LILITA)));
writeFileSync(
  join(tmp, 'fonts.conf'),
  `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${join(tmp, 'fontes')}</dir><cachedir>${join(tmp, 'cache')}</cachedir></fontconfig>`
);
process.env.FONTCONFIG_FILE = join(tmp, 'fonts.conf');
const { default: sharp } = await import('sharp');

try {
  const svg = readFileSync(SELO, 'utf8');
  mkdirSync(ICONES, { recursive: true });

  const favicon = otimizarSvg(svg);
  writeFileSync(join(PUBLICO, 'favicon.svg'), favicon + '\n');
  console.log(`favicon.svg ${svg.length} → ${favicon.length + 1} bytes`);

  // Selo rasterizado uma vez em alta resolução; cada ícone sai dele.
  const BASE = 1024;
  const selo = await sharp(Buffer.from(svg), { density: (72 * BASE) / 600 })
    .resize(BASE, BASE)
    .png()
    .toBuffer();

  // fracao: quanto do lado o selo ocupa; fundo: null = transparente
  const icones = [
    { nome: 'favicon-32.png', lado: 32, fracao: 1, fundo: null },
    { nome: 'icon-192.png', lado: 192, fracao: 1, fundo: null },
    { nome: 'icon-512.png', lado: 512, fracao: 1, fundo: null },
    { nome: 'icon-maskable-512.png', lado: 512, fracao: 0.8, fundo: VERMELHO }, // zona segura: círculo de 80%
    { nome: 'apple-touch-icon.png', lado: 180, fracao: 0.86, fundo: VERMELHO } // iOS não aceita transparência
  ];
  for (const ic of icones) {
    const interno = Math.round(ic.lado * ic.fracao);
    const seloRedim = await sharp(selo).resize(interno, interno, { kernel: 'lanczos3' }).png().toBuffer();
    const margem = Math.floor((ic.lado - interno) / 2);
    const fundo = ic.fundo || { r: 0, g: 0, b: 0, alpha: 0 };
    const saida = join(ICONES, ic.nome);
    await sharp({ create: { width: ic.lado, height: ic.lado, channels: 4, background: fundo } })
      .composite([{ input: seloRedim, left: margem, top: margem }])
      .png({ compressionLevel: 9, effort: 10, palette: ic.lado >= 180, quality: 95 })
      .toFile(saida);
    const meta = await sharp(saida).metadata();
    console.log(`icons/${ic.nome} ${meta.width}×${meta.height}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
