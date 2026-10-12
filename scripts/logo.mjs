// Logo oficial do Mineiro Lanche, extraída do PDF do cliente SEM ALTERAR NADA: nada de recolorir, suavizar,
// redesenhar ou IA. O PDF é do CorelDRAW 2021: textos em vetor; anel dourado, disco vermelho e estrelas em bitmap.
//
// Uso:  node scripts/logo.mjs                   extrai a logo (rasters, SVG recortado, logo.svg e logo-selo.svg)
//       node scripts/logo.mjs og                refaz public/assets/og.jpg com a foto padrão (a maior do Gran Bacon Onion)
//       node scripts/logo.mjs og --foto <arq>   idem, com outra foto real (ex.: as fotos novas, depois do scripts/fotos.mjs)
//
// Saída da extração:
//   public/assets/logo/logo-{1024,512,256,128}.{png,webp}  largura exata, fundo transparente, recortada à caixa do conteúdo
//   public/assets/logo/logo.svg   SVG recortado (pdftocairo -svg com o viewBox na caixa): texto em vetor, bitmaps originais
//   public/assets/logo.svg        cópia do recortado, para as referências antigas (site, cartaz, JSON-LD)
//   public/assets/logo-selo.svg   a mesma arte num quadrado 600×600, inscrita no círculo (QR, painel, story, caminhão)
//   public/assets/logo/selo-{256,128}.{png,webp}  o selo em raster leve, para espaços pequenos quadrados ou redondos
//   design/logo/logo.json         caixa do conteúdo, raio do selo e resolução real dos bitmaps (lido pelos outros scripts)
//
// Como sai cada raster: o pdftocairo (poppler) renderiza o PDF direto na escala final, com fundo transparente, e só a
// região da logo. Não há reamostragem nossa depois; o sharp só recomprime (PNG sem perda; WebP quase sem perda).
//
// Nitidez: o anel é um JPEG de 507 px (109 ppi na página) e o disco um de 505 px (121 ppi). Com a logo inteira a 624 px
// de largura o anel sai 1:1 ("larguraUtilPx" no logo.json). Acima disso o texto continua nítido (vetor), mas o anel e o
// disco só são ampliados: o logo-1024 serve para telas densas, não traz mais detalhe no disco.
//
// Ferramentas: pdftocairo e pdfimages (poppler-utils) e sharp.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PDF = join(RAIZ, 'design', 'logo', 'LOGOTIPO_MINEIRO.pdf');
export const DADOS = join(RAIZ, 'design', 'logo', 'logo.json');
export const PASTA_LOGO = join(RAIZ, 'public', 'assets', 'logo');
export const LOGO_SVG = join(RAIZ, 'public', 'assets', 'logo.svg');
export const SELO_SVG = join(RAIZ, 'public', 'assets', 'logo-selo.svg');
export const OG = join(RAIZ, 'public', 'assets', 'og.jpg');
export const LARGURAS = [1024, 512, 256, 128];
export const LADOS_SELO = [256, 128];
export const LADO_SELO = 600; // viewBox do selo (o QR e o painel contam com um quadrado de 600)
export const CARVAO = '#1A1414'; // fundo escuro da marca (--carvao)

const PPI_CAIXA = 1200; // resolução da medição da caixa: 1/1200 pol. = 0,06 pt
const FOLGA_CAIXA = 4; // pt em volta da caixa aproximada, na medição fina
// WebP quase sem perda (near-lossless): no máximo ±4 níveis por canal e nenhum desvio de cor. O WebP com perda comum
// passa por YUV 4:2:0 e, mesmo em qualidade 100, borra a borda vermelho/amarelo e puxa a logo para o verde.
export const OPCOES_WEBP = { nearLossless: true, quality: 60, effort: 6 };

// ---------- poppler ----------

function rodar(comando, args) {
  try {
    return execFileSync(comando, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${comando} não encontrado: instale o poppler-utils (apt install poppler-utils)`);
    throw new Error(`${comando} falhou: ${(e.stderr || e.message).trim()}`);
  }
}

// Renderiza uma região da página (em px, na resolução ppi) com fundo transparente. Devolve o PNG (RGBA) do poppler.
export function renderizarPagina({ ppi, x, y, largura, altura }) {
  const pasta = mkdtempSync(join(tmpdir(), 'ml-logo-'));
  try {
    const args = ['-png', '-transp', '-singlefile', '-r', String(ppi)];
    if (largura) args.push('-x', String(x), '-y', String(y), '-W', String(largura), '-H', String(altura));
    rodar('pdftocairo', [...args, PDF, join(pasta, 'r')]);
    return readFileSync(join(pasta, 'r.png'));
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

// Bitmaps embutidos no PDF e a resolução com que cada um foi posto na página (pdfimages -list).
// Iguais (as cinco estrelas) viram uma linha com "quantidade".
export function bitmapsDoPdf() {
  const lista = [];
  for (const l of rodar('pdfimages', ['-list', PDF]).split('\n').slice(2)) {
    const c = l.trim().split(/\s+/);
    if (c.length < 13 || c[2] !== 'image') continue;
    const b = { largura: Number(c[3]), altura: Number(c[4]), cor: c[5], formato: c[8], ppi: Number(c[12]) };
    const igual = lista.find((o) => ['largura', 'altura', 'cor', 'formato', 'ppi'].every((k) => o[k] === b[k]));
    if (igual) igual.quantidade++;
    else lista.push({ ...b, quantidade: 1 });
  }
  return lista;
}

// ---------- caixa do conteúdo ----------

// Limites dos pixels com alfa > 0 e, por linha, o primeiro e o último (para o raio do selo).
async function medirAlfa(png) {
  const { data, info } = await sharp(png).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const linhas = [];
  let x0 = w,
    x1 = -1,
    y0 = h,
    y1 = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let a = -1,
      b = -1;
    for (let x = 0; x < w; x++)
      if (data[o + x]) {
        a = x;
        break;
      }
    if (a < 0) continue;
    for (let x = w - 1; x >= a; x--)
      if (data[o + x]) {
        b = x;
        break;
      }
    linhas.push([y, a, b]);
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
    if (y < y0) y0 = y;
    y1 = y;
  }
  if (x1 < 0) throw new Error('PDF sem conteúdo visível');
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, linhas, largura: w, altura: h };
}

const sha256 = (arquivo) => createHash('sha256').update(readFileSync(arquivo)).digest('hex');
const arred = (v, casas = 4) => Math.round(v * 10 ** casas) / 10 ** casas;

// Caixa do conteúdo em pt (origem no canto superior esquerdo da página, como no SVG do pdftocairo),
// o centro dela e o raio do menor círculo com esse centro que contém a arte inteira (base do selo).
export async function medirLogo() {
  // 1) página inteira a 72 ppi: caixa aproximada
  const grossa = await medirAlfa(renderizarPagina({ ppi: 72 }));
  // 2) só essa região, com folga, a 1200 ppi: caixa precisa
  const k = PPI_CAIXA / 72;
  const x = Math.floor((grossa.x0 - FOLGA_CAIXA) * k);
  const y = Math.floor((grossa.y0 - FOLGA_CAIXA) * k);
  const largura = Math.ceil((grossa.x1 - grossa.x0 + 2 * FOLGA_CAIXA) * k);
  const altura = Math.ceil((grossa.y1 - grossa.y0 + 2 * FOLGA_CAIXA) * k);
  const fina = await medirAlfa(renderizarPagina({ ppi: PPI_CAIXA, x, y, largura, altura }));
  if (fina.x0 === 0 || fina.y0 === 0 || fina.x1 === largura || fina.y1 === altura) throw new Error('A arte encostou na borda da medição');
  const caixa = { x: (x + fina.x0) / k, y: (y + fina.y0) / k, w: (fina.x1 - fina.x0) / k, h: (fina.y1 - fina.y0) / k };
  const centro = { x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2 };
  // raio: canto mais distante do centro entre os pixels das pontas de cada linha
  const cx = centro.x * k - x,
    cy = centro.y * k - y;
  let r2 = 0;
  for (const [ly, a, b] of fina.linhas) {
    const dy = Math.max(Math.abs(ly - cy), Math.abs(ly + 1 - cy));
    const dx = Math.max(Math.abs(a - cx), Math.abs(b + 1 - cx));
    r2 = Math.max(r2, dx * dx + dy * dy);
  }
  return { caixa, centro, raio: Math.sqrt(r2) / k };
}

// Dados da logo (caixa, raio, bitmaps). Lê o design/logo/logo.json se ele for deste PDF; senão mede de novo.
export async function lerDados({ forcar = false } = {}) {
  const hash = sha256(PDF);
  if (!forcar && existsSync(DADOS)) {
    const d = JSON.parse(readFileSync(DADOS, 'utf8'));
    if (d.sha256 === hash) return d;
  }
  const { caixa, centro, raio } = await medirLogo();
  const bitmaps = bitmapsDoPdf();
  // O bitmap de menor resolução (o anel) manda: na largura útil ele sai 1 px de imagem por 1 px de tela.
  const ppiMin = Math.min(...bitmaps.map((b) => b.ppi));
  return {
    fonte: relative(RAIZ, PDF),
    sha256: hash,
    unidade: 'pt (1/72 pol.), origem no canto superior esquerdo da página',
    caixa: { x: arred(caixa.x), y: arred(caixa.y), w: arred(caixa.w), h: arred(caixa.h) },
    centro: { x: arred(centro.x), y: arred(centro.y) },
    raio: arred(raio),
    bitmaps,
    larguraUtilPx: Math.round((caixa.w * ppiMin) / 72),
    rasters: {}
  };
}

// ---------- rasters ----------

// Recorte alinhado à grade de pixels da página: a caixa começa em fração de pixel, então o recorte vai do
// pixel que contém o início da arte até o que contém o fim (margem transparente de no máximo 1 px por lado).
export function recorteNaEscala(caixa, escala) {
  const x = Math.floor(caixa.x * escala);
  const y = Math.floor(caixa.y * escala);
  return {
    escala,
    ppi: escala * 72,
    x,
    y,
    largura: Math.ceil((caixa.x + caixa.w) * escala) - x,
    altura: Math.ceil((caixa.y + caixa.h) * escala) - y
  };
}

// Maior escala em que o recorte cabe em exatamente `largura` px.
export function recorteNaLargura(caixa, largura) {
  let escala = largura / caixa.w;
  for (let i = 0; i < 10; i++) {
    const r = recorteNaEscala(caixa, escala);
    if (r.largura <= largura) return { ...r, largura };
    const fracao = caixa.x * escala - Math.floor(caixa.x * escala);
    escala = Math.min(escala * (1 - 1e-9), (largura - fracao) / caixa.w);
  }
  return { ...recorteNaEscala(caixa, (largura - 1) / caixa.w), largura };
}

// Selo em raster: quadrado de `lado` px com o centro da caixa no meio e o círculo que contém a arte inteira inscrito.
export function recorteDoSelo(dados, lado) {
  const escala = lado / 2 / dados.raio;
  const x = Math.round(dados.centro.x * escala - lado / 2);
  const y = Math.round(dados.centro.y * escala - lado / 2);
  return { escala, ppi: escala * 72, x, y, largura: lado, altura: lado };
}

// A logo renderizada direto do PDF na escala pedida (px por pt). Devolve o PNG e o recorte usado.
export function renderizarLogo(dados, escala) {
  const r = recorteNaEscala(dados.caixa, escala);
  return { ...r, png: renderizarPagina(r) };
}

// ---------- SVG ----------

// Página inteira em SVG (pdftocairo -svg): texto em vetor; JPEGs embutidos com os bytes originais do PDF.
// -noshrink -nocenter: sem eles o pdftocairo encaixa a página num papel de pt inteiros (595 × 842), encolhendo
// e centrando o desenho (cerca de 0,3 pt de diferença); com eles as coordenadas são exatamente as do PDF.
function svgDaPagina() {
  const pasta = mkdtempSync(join(tmpdir(), 'ml-logo-svg-'));
  try {
    rodar('pdftocairo', ['-svg', '-noshrink', '-nocenter', PDF, join(pasta, 'p.svg')]);
    return readFileSync(join(pasta, 'p.svg'), 'utf8');
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

// Separa o SVG do pdftocairo em <defs> e desenho, sem mexer em nenhuma coordenada ou cor. Só:
// - as estrelas (o mesmo PNG cinco vezes) passam a usar um bitmap só;
// - os ids ganham o prefixo "ml-" (não colidem se o SVG for embutido em outro, como no QR).
export function partesDoSvg(svg) {
  const defs = svg.match(/<defs>([\s\S]*?)<\/defs>/)[1];
  const desenho = svg.slice(svg.indexOf('</defs>') + 7, svg.lastIndexOf('</svg>'));
  const primeiro = new Map(); // dados do bitmap → id que fica
  const troca = new Map(); // id repetido → id que fica
  const defsSemRepetidos = defs.replace(/<image id="([^"]+)"[^>]*?xlink:href="([^"]+)"\s*\/>\s*/g, (tag, id, dadosImg) => {
    if (!primeiro.has(dadosImg)) {
      primeiro.set(dadosImg, id);
      return tag;
    }
    troca.set(id, primeiro.get(dadosImg));
    return '';
  });
  const ajustar = (s) =>
    s
      .replace(/(xlink:href="#)([^"]+)"/g, (_, a, id) => `${a}${troca.get(id) || id}"`)
      .replace(/\bid="([^"]+)"/g, 'id="ml-$1"')
      .replace(/url\(#([^)]+)\)/g, 'url(#ml-$1)')
      .replace(/xlink:href="#([^"]+)"/g, 'xlink:href="#ml-$1"');
  return { defs: ajustar(defsSemRepetidos).trim(), desenho: ajustar(desenho).trim(), estrelasJuntadas: troca.size };
}

const num = (v) => String(arred(v));
const CABECA = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const TITULO = '<title>Mineiro Lanche food truck</title>';

// SVG recortado: o mesmo desenho, com o viewBox na caixa do conteúdo.
export function svgRecortado({ defs, desenho }, { caixa }) {
  const { x, y, w, h } = caixa;
  return (
    CABECA +
    `<svg ${NS} width="${num(w)}" height="${num(h)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}">\n${TITULO}\n` +
    `<defs>\n${defs}\n</defs>\n${desenho}\n</svg>\n`
  );
}

// Troca só o enquadramento (width, height e viewBox da raiz) de um SVG da logo; o desenho não muda.
export function reenquadrarSvg(svg, { x, y, w, h }, largura = w, altura = h) {
  return svg.replace(
    /(<svg [^>]*?)\swidth="[^"]+" height="[^"]+" viewBox="[^"]+">/,
    `$1 width="${num(largura)}" height="${num(altura)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}">`
  );
}

// Selo: o mesmo desenho num quadrado de 600, centrado na caixa e com a arte inteira dentro do círculo inscrito
// (raio 300). Quem recorta em círculo (QR, avatar do painel) não corta nada da arte.
export function escalaDoSelo({ raio }) {
  return LADO_SELO / 2 / raio;
}
export function svgSelo({ defs, desenho }, dados) {
  const k = escalaDoSelo(dados);
  const tx = LADO_SELO / 2 - k * dados.centro.x;
  const ty = LADO_SELO / 2 - k * dados.centro.y;
  return (
    CABECA +
    `<svg ${NS} width="${LADO_SELO}" height="${LADO_SELO}" viewBox="0 0 ${LADO_SELO} ${LADO_SELO}">\n${TITULO}\n` +
    `<defs>\n${defs}\n</defs>\n<g transform="matrix(${num(k)} 0 0 ${num(k)} ${num(tx)} ${num(ty)})">\n${desenho}\n</g>\n</svg>\n`
  );
}

// ---------- extração ----------

const kb = (bytes) => `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;

export async function extrair() {
  const dados = await lerDados({ forcar: true });
  mkdirSync(PASTA_LOGO, { recursive: true });
  const { caixa } = dados;
  console.log(`Caixa da logo: ${caixa.w} × ${caixa.h} pt a partir de (${caixa.x}, ${caixa.y}) · raio do selo ${dados.raio} pt`);
  for (const b of dados.bitmaps)
    console.log(
      `  ${b.quantidade}× bitmap ${b.largura}×${b.altura} (${b.formato}) a ${b.ppi} ppi: 1:1 com a logo a ${((b.ppi / 72) * caixa.w).toFixed(0)} px de largura`
    );
  console.log(`  largura útil: ${dados.larguraUtilPx} px (acima disso o anel e o disco não ganham nitidez; o texto sim)`);

  for (const largura of LARGURAS) {
    const r = recorteNaLargura(caixa, largura);
    const png = renderizarPagina(r);
    const nome = join(PASTA_LOGO, `logo-${largura}`);
    await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(`${nome}.png`);
    await sharp(png).webp(OPCOES_WEBP).toFile(`${nome}.webp`);
    dados.rasters[largura] = { escala: arred(r.escala, 8), x: r.x, y: r.y, largura: r.largura, altura: r.altura };
    const tamanhos = ['png', 'webp'].map((ext) => kb(readFileSync(`${nome}.${ext}`).length)).join(' · ');
    console.log(`  logo-${largura}: ${r.largura}×${r.altura} px (${tamanhos})${largura > dados.larguraUtilPx ? ' · acima da largura útil' : ''}`);
  }

  dados.selos = {};
  for (const lado of LADOS_SELO) {
    const r = recorteDoSelo(dados, lado);
    const png = renderizarPagina(r);
    const nome = join(PASTA_LOGO, `selo-${lado}`);
    await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(`${nome}.png`);
    await sharp(png).webp(OPCOES_WEBP).toFile(`${nome}.webp`);
    dados.selos[lado] = { escala: arred(r.escala, 8), x: r.x, y: r.y, largura: lado, altura: lado };
    console.log(`  selo-${lado}: ${lado}×${lado} px (${['png', 'webp'].map((ext) => kb(readFileSync(`${nome}.${ext}`).length)).join(' · ')})`);
  }

  const partes = partesDoSvg(svgDaPagina());
  const recortado = svgRecortado(partes, dados);
  writeFileSync(join(PASTA_LOGO, 'logo.svg'), recortado);
  copyFileSync(join(PASTA_LOGO, 'logo.svg'), LOGO_SVG);
  writeFileSync(SELO_SVG, svgSelo(partes, dados));
  console.log(`  logo/logo.svg e logo.svg: ${kb(recortado.length)} (estrelas: ${partes.estrelasJuntadas} cópias do bitmap juntadas)`);
  console.log(`  logo-selo.svg: ${kb(readFileSync(SELO_SVG).length)} (arte inteira no círculo de ${LADO_SELO / 2})`);

  writeFileSync(DADOS, JSON.stringify(dados, null, 2) + '\n');
  console.log(`  ${relative(RAIZ, DADOS)}`);
  return dados;
}

// ---------- og:image ----------

export const PRODUTO_OG = 'gran-bacon-onion';
const PASTA_FOTOS = join(RAIZ, 'public', 'assets', 'fotos');

// A maior versão de uma foto do produto em public/assets/fotos (<id>-<largura>.<ext>).
export function fotoDoProduto(id) {
  const opcoes = existsSync(PASTA_FOTOS)
    ? readdirSync(PASTA_FOTOS)
        .map((a) => ({ a, m: a.match(/^(.+)-(\d+)\.(webp|jpe?g|png|avif)$/i) }))
        .filter(({ m }) => m && m[1] === id)
        .sort((p, q) => Number(q.m[2]) - Number(p.m[2]))
    : [];
  if (!opcoes.length) throw new Error(`Sem foto de "${id}" em ${relative(RAIZ, PASTA_FOTOS)}/. Passe --foto <arquivo>.`);
  return join(PASTA_FOTOS, opcoes[0].a);
}

// og.jpg (1200×630): fundo carvão; a foto real à direita, fundida no carvão por um degradê; a logo real à esquerda,
// renderizada direto do PDF na escala final (440 px de altura: o anel sai abaixo de 1:1, nítido).
export const OG_LARGURA = 1200;
export const OG_ALTURA = 630;
const OG_AREA_FOTO = 730; // a foto ocupa no máximo os 730 px da direita
const OG_DEGRADE = 260; // largura do degradê que funde a borda esquerda da foto no carvão

export function layoutOg(dados) {
  const escala = 440 / dados.caixa.h;
  const r = recorteNaEscala(dados.caixa, escala);
  const esquerda = Math.round(318 - (dados.centro.x * escala - r.x));
  const topo = Math.round(OG_ALTURA / 2 - (dados.centro.y * escala - r.y));
  return { escala, recorte: r, esquerda, topo };
}

export async function gerarOg({ foto, saida = OG } = {}) {
  const dados = await lerDados();
  const arquivo = foto ? resolve(foto) : fotoDoProduto(PRODUTO_OG);

  // A foto entra pela altura inteira (o lanche não perde o topo do pão). Foto larga demais é cortada nas laterais,
  // pelo ponto de maior interesse; foto em pé fica encostada na direita e o degradê funde a borda dela.
  const meta = await sharp(arquivo).rotate().metadata();
  const [w0, h0] = meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const larguraFoto = Math.min(OG_AREA_FOTO, Math.round((w0 * OG_ALTURA) / h0));
  const fotoPronta = await sharp(arquivo)
    .rotate()
    .resize(larguraFoto, OG_ALTURA, { fit: 'cover', position: 'attention' })
    .toBuffer();
  const xFoto = OG_LARGURA - larguraFoto;

  // Escurecimento desenhado em código: degradê na borda esquerda da foto e um véu leve no topo e na base.
  const veu = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_LARGURA}" height="${OG_ALTURA}">` +
      `<defs><linearGradient id="e" x1="${xFoto}" x2="${xFoto + OG_DEGRADE}" y1="0" y2="0" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${CARVAO}"/><stop offset=".4" stop-color="${CARVAO}" stop-opacity=".7"/>` +
      `<stop offset="1" stop-color="${CARVAO}" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".3"/>` +
      `<stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>` +
      `<rect x="${xFoto - 1}" width="${OG_DEGRADE + 1}" height="100%" fill="url(#e)"/><rect width="100%" height="100%" fill="url(#v)"/></svg>`
  );

  const { escala, esquerda, topo } = layoutOg(dados);
  const logo = renderizarLogo(dados, escala);
  await sharp({ create: { width: OG_LARGURA, height: OG_ALTURA, channels: 3, background: CARVAO } })
    .composite([
      { input: fotoPronta, left: xFoto, top: 0 },
      { input: veu, left: 0, top: 0 },
      { input: logo.png, left: esquerda, top: topo }
    ])
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(saida);
  console.log(`${relative(RAIZ, saida)}: ${OG_LARGURA}×${OG_ALTURA}, ${kb(readFileSync(saida).length)} · foto ${relative(RAIZ, arquivo)}`);
  if (foto && !basename(arquivo).startsWith(PRODUTO_OG))
    console.log('  Lembrete: ajuste o og:image:alt no <head> do index.html para o lanche desta foto.');
  return { foto: arquivo, escala, esquerda, topo };
}

// ---------- linha de comando ----------

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--ajuda') || argv.includes('-h')) {
    console.log('Uso: node scripts/logo.mjs            (extrai a logo do PDF)\n     node scripts/logo.mjs og [--foto arquivo]');
    return;
  }
  if (argv[0] === 'og') {
    let foto = null;
    for (let i = 1; i < argv.length; i++) {
      const [chave, junto] = argv[i].split(/=(.*)/s);
      if (chave === '--foto') foto = junto ?? argv[++i];
      else throw new Error(`Opção desconhecida: ${argv[i]}`);
    }
    if (foto && !existsSync(foto)) throw new Error(`Foto não encontrada: ${foto}`);
    await gerarOg({ foto });
    return;
  }
  if (argv.length) throw new Error(`Opção desconhecida: ${argv[0]}`);
  await extrair();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
