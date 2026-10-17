// QR code do cardápio (seção 4 do docs/PLANO.md): SVG para a gráfica, PNG de 2048 px e PDFs do cartaz.
// Uso:  npm run qrcode
//       npm run qrcode -- --base https://dominio-final --mesas 1-10
// Opções: --base URL (padrão: VITE_SITE_URL do .env.production) · --mesas 1-10 ou 1,3,5
//         --saida pasta (padrão: public/qr) · --sem-pdf (não gera os PDFs do cartaz)
/* global document */ // só dentro de pagina.evaluate (roda no navegador)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import ECCode from 'qrcode/lib/core/error-correction-code.js';
import Utils from 'qrcode/lib/core/utils.js';
import sharp from 'sharp';
import { LADO_SELO, lerDados, renderizarLogo } from './logo.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA_QR = join(RAIZ, 'public', 'qr');
// Servidor temporário do cartaz (só para imprimir os PDFs): porta livre, ou QR_PORTA. Nunca a 4180 dos testes.
export const PORTA_CARTAZ = Number(process.env.QR_PORTA) || 0;

const CARVAO = '#1A1414';
const CREME = '#FFF6E0';
const MARGEM = 4; // zona de silêncio, em módulos
const FOLGA = 0.6; // respiro creme entre a borda do selo e o módulo mais próximo, em módulos
const LIMITE_AREA = 0.2; // plano: o selo ocupa no máximo 20% da área do símbolo
const LADO_PNG = 2048;
// Selo do centro: a logo oficial (scripts/logo.mjs). No SVG entra o logo-selo.svg (vetor + bitmaps originais, a arte
// inteira dentro do círculo inscrito); no PNG, a logo renderizada direto do PDF no tamanho final. Sem o poppler
// (pdftocairo), o PNG usa o mesmo logo-selo.svg rasterizado pelo sharp.
const SELO = join(RAIZ, 'public', 'assets', 'logo-selo.svg');
const TEM_PDFTOCAIRO = !spawnSync('pdftocairo', ['-v'], { stdio: 'ignore' }).error;

// ---------- base e destino ----------

export function lerEnv(arquivo = join(RAIZ, '.env.production')) {
  const env = {};
  if (!existsSync(arquivo)) return env;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

export function normalizarBase(base) {
  let url;
  try {
    url = new URL(String(base || '').trim());
  } catch {
    throw new Error(`Base inválida: "${base}". Use algo como https://mineiro-lanches.vercel.app`);
  }
  if (!/^https?:$/.test(url.protocol) || url.search || url.hash) throw new Error(`Base inválida: "${base}" (só http/https, sem ? nem #)`);
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

export function lerBase(base) {
  const valor = base || process.env.QR_BASE || lerEnv().VITE_SITE_URL;
  if (!valor) throw new Error('Sem base: passe --base https://dominio ou defina VITE_SITE_URL no .env.production');
  return normalizarBase(valor);
}

export const destinoDe = (base, mesa) => `${base}/q${mesa ? `/${mesa}` : ''}`;

export function lerMesas(texto) {
  if (!texto) return [];
  const mesas = new Set();
  for (const parte of String(texto).split(',')) {
    const m = parte.trim().match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
    if (!m) throw new Error(`--mesas inválido: "${texto}". Use 1-10 ou 1,3,5`);
    const [ini, fim] = [Number(m[1]), Number(m[2] || m[1])];
    if (ini < 1 || fim < ini) throw new Error(`--mesas inválido: "${parte}"`);
    for (let n = ini; n <= fim; n++) mesas.add(n);
  }
  return [...mesas].sort((a, b) => a - b);
}

// ---------- QR ----------

const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Distância do centro (k, k) até o ponto mais próximo do módulo (l, c), em módulos.
const distModulo = (l, c, k) => Math.hypot(Math.max(c - k, 0, k - c - 1), Math.max(l - k, 0, k - l - 1));

// Bloco de Reed-Solomon de cada palavra-código, na ordem intercalada em que ela entra no símbolo.
function blocosRs(qr) {
  const total = Utils.getSymbolTotalCodewords(qr.version);
  const nBlocos = ECCode.getBlocksCount(qr.version, qr.errorCorrectionLevel);
  const dados = total - ECCode.getTotalCodewordsCount(qr.version, qr.errorCorrectionLevel);
  const grupo1 = nBlocos - (total % nBlocos);
  const dados1 = Math.floor(dados / nBlocos);
  const ecPorBloco = Math.floor(total / nBlocos) - dados1;
  const blocoDe = [];
  for (let i = 0; i <= dados1; i++) for (let b = 0; b < nBlocos; b++) if (i < dados1 || b >= grupo1) blocoDe.push(b);
  for (let i = 0; i < ecPorBloco; i++) for (let b = 0; b < nBlocos; b++) blocoDe.push(b);
  return { blocoDe, nBlocos, total, corrige: Math.floor(ecPorBloco / 2) };
}

// Palavra-código de cada módulo (mesmo zigue-zague do pacote qrcode); -1 nos padrões de função e nos bits de sobra.
function palavraDeCadaModulo(m, total) {
  const n = m.size;
  const palavra = new Int32Array(n * n).fill(-1);
  let linha = n - 1;
  let passo = -1;
  let bit = 0;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m.isReserved(linha, col - c)) continue;
        if (bit >> 3 < total) palavra[linha * n + col - c] = bit >> 3;
        bit++;
      }
      linha += passo;
      if (linha < 0 || linha >= n) {
        linha -= passo;
        passo = -passo;
        break;
      }
    }
  }
  return palavra;
}

// Matriz do QR com o centro limpo para o selo. O tamanho do selo e a máscara saem de uma conta:
// o selo apaga palavras-código (módulo escuro que vira claro), e cada bloco só corrige "corrige" delas.
// Fica o maior selo (até 20% da área) que gasta no máximo metade dessa correção; a outra metade
// sobra para a vida real (luz fraca à noite, reflexo, foco, papel amassado).
export function montarQr(texto, { raioSelo } = {}) {
  const padrao = QRCode.create(texto, { errorCorrectionLevel: 'H' });
  const opcoes = [padrao]; // a máscara padrão (menor penalidade) vem primeiro e ganha os empates
  for (let p = 0; p < 8; p++)
    if (p !== padrao.maskPattern) opcoes.push(QRCode.create(texto, { errorCorrectionLevel: 'H', maskPattern: p }));
  const n = padrao.modules.size;
  const k = n / 2;
  const rs = blocosRs(padrao);
  const palavra = palavraDeCadaModulo(padrao.modules, rs.total);
  const raios = [];
  if (raioSelo) raios.push(raioSelo);
  else for (let r = Math.floor(n * Math.sqrt(LIMITE_AREA / Math.PI) * 4) / 4; r >= 2.5; r -= 0.25) raios.push(r);

  for (const r of raios) {
    const limpo = (l, c) => distModulo(l, c, k) < r + FOLGA;
    let limpos = 0;
    let tocaFuncao = false;
    for (let l = 0; l < n; l++)
      for (let c = 0; c < n; c++)
        if (limpo(l, c)) {
          limpos++;
          // Localizador, alinhamento e temporização nunca podem sumir.
          if (padrao.modules.isReserved(l, c)) tocaFuncao = true;
        }
    if (tocaFuncao || limpos / (n * n) > LIMITE_AREA) continue;

    let melhor = null;
    for (const qr of opcoes) {
      const estragadas = new Set();
      for (let l = 0; l < n; l++)
        for (let c = 0; c < n; c++) if (limpo(l, c) && qr.modules.get(l, c) && palavra[l * n + c] >= 0) estragadas.add(palavra[l * n + c]);
      const dano = new Array(rs.nBlocos).fill(0);
      for (const w of estragadas) dano[rs.blocoDe[w]]++;
      const max = Math.max(...dano);
      if (!melhor || max < melhor.max || (max === melhor.max && estragadas.size < melhor.soma))
        melhor = { qr, dano, max, soma: estragadas.size };
    }
    if (!raioSelo && melhor.max > Math.floor(rs.corrige / 2)) continue;

    const m = melhor.qr.modules;
    const escuro = Array.from({ length: n }, (_, l) => Array.from({ length: n }, (_, c) => !limpo(l, c) && Boolean(m.get(l, c))));
    const lado = n + 2 * MARGEM;
    return {
      texto,
      versao: padrao.version,
      mascara: melhor.qr.maskPattern,
      n,
      lado,
      escuro,
      centro: lado / 2,
      raioSelo: r,
      raioLimpo: r + FOLGA,
      fracaoSelo: (Math.PI * r * r) / (n * n),
      fracaoLimpa: limpos / (n * n),
      dano: melhor.dano,
      corrige: rs.corrige
    };
  }
  throw new Error(`Não coube o selo no QR de "${texto}" sem gastar mais da metade da correção de erro; encurte a base`);
}

function caminhoModulos(q) {
  let d = '';
  q.escuro.forEach((linha, l) => {
    for (let c = 0; c < q.n; c++) {
      if (!linha[c]) continue;
      let fim = c;
      while (fim + 1 < q.n && linha[fim + 1]) fim++;
      d += `M${c + MARGEM} ${l + MARGEM}h${fim - c + 1}v1h-${fim - c + 1}z`;
      c = fim;
    }
  });
  return d;
}

function seloInterno() {
  const svg = readFileSync(SELO, 'utf8');
  const abre = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  const miolo = svg
    .slice(abre, svg.lastIndexOf('</svg>'))
    .replace(/<title>[^<]*<\/title>/, '')
    .trim();
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
  if (viewBox !== `0 0 ${LADO_SELO} ${LADO_SELO}`) throw new Error(`logo-selo.svg fora do padrão (viewBox ${viewBox}): rode node scripts/logo.mjs`);
  return { viewBox, miolo };
}

// SVG do QR. comSelo=false devolve só o fundo e os módulos (base do PNG, que recebe o selo via sharp).
export function svgDoQr(q, { comSelo = true, larguraPx = 1024 } = {}) {
  const r = (v) => Math.round(v * 1000) / 1000;
  const xSelo = r(q.centro - q.raioSelo);
  const ladoSelo = r(q.raioSelo * 2);
  let selo = '';
  if (comSelo) {
    const { viewBox, miolo } = seloInterno();
    selo = `<svg x="${xSelo}" y="${xSelo}" width="${ladoSelo}" height="${ladoSelo}" viewBox="${viewBox}">${miolo}</svg>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${q.lado} ${q.lado}" width="${larguraPx}" height="${larguraPx}" role="img" aria-label="QR code: ${escapar(q.texto)}">` +
    `<title>Cardápio Mineiro Lanche: ${escapar(q.texto)}</title>` +
    `<rect width="${q.lado}" height="${q.lado}" fill="${CREME}"/>` +
    `<path fill="${CARVAO}" d="${caminhoModulos(q)}"/>` +
    `<circle cx="${r(q.centro)}" cy="${r(q.centro)}" r="${r(q.raioLimpo)}" fill="${CREME}"/>` +
    selo +
    '</svg>\n'
  );
}

// PNG: rasteriza os módulos e compõe por cima a logo renderizada direto do PDF, com o círculo que contém a arte
// inteira do tamanho do selo (o mesmo enquadramento do logo-selo.svg).
export async function pngDoQr(q, lado = LADO_PNG) {
  const base = await sharp(Buffer.from(svgDoQr(q, { comSelo: false, larguraPx: lado })))
    .flatten({ background: CREME })
    .png()
    .toBuffer();
  const pxPorModulo = lado / q.lado;
  if (!TEM_PDFTOCAIRO) {
    const ladoSelo = Math.round(2 * q.raioSelo * pxPorModulo);
    const selo = await sharp(SELO, { density: (72 * ladoSelo) / LADO_SELO })
      .resize(ladoSelo, ladoSelo)
      .png()
      .toBuffer();
    const canto = Math.round(q.centro * pxPorModulo - ladoSelo / 2);
    return sharp(base)
      .composite([{ input: selo, left: canto, top: canto }])
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  const dados = await lerDados();
  const escala = (q.raioSelo * pxPorModulo) / dados.raio; // px por pt
  const logo = renderizarLogo(dados, escala);
  const centro = q.centro * pxPorModulo;
  return sharp(base)
    .composite([
      {
        input: logo.png,
        left: Math.round(centro - (dados.centro.x * escala - logo.x)),
        top: Math.round(centro - (dados.centro.y * escala - logo.y))
      }
    ])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function gerarQr(texto, pasta, nome) {
  const q = montarQr(texto);
  writeFileSync(join(pasta, `${nome}.svg`), svgDoQr(q));
  writeFileSync(join(pasta, `${nome}.png`), await pngDoQr(q));
  return q;
}

// ---------- cartaz (PDF via Playwright) ----------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf'
};

// Servidor estático mínimo (o equivalente a "python3 -m http.server") para a pasta public/.
// cabecalhos: extras em toda resposta (o teste usa para servir o cartaz com a CSP do site).
export function servirPasta(pasta = join(RAIZ, 'public'), porta = PORTA_CARTAZ, cabecalhos = {}) {
  const raiz = resolve(pasta);
  const servidor = createServer((req, res) => {
    let caminho;
    try {
      caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    let arquivo = resolve(join(raiz, caminho));
    if (arquivo !== raiz && !arquivo.startsWith(raiz + sep)) return res.writeHead(403).end();
    if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, 'index.html');
    if (!existsSync(arquivo)) return res.writeHead(404).end('não encontrado');
    res.writeHead(200, {
      ...cabecalhos,
      'content-type': TIPOS[extname(arquivo)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(readFileSync(arquivo));
  });
  const ouvir = (p) =>
    new Promise((ok, erro) => {
      servidor.once('error', erro);
      servidor.listen(p, '127.0.0.1', () => ok());
    });
  return ouvir(porta)
    .catch((e) => {
      if (e.code !== 'EADDRINUSE' || porta === 0) throw e;
      console.warn(`Porta ${porta} ocupada; usando uma livre.`);
      return ouvir(0);
    })
    .then(() => ({
      url: `http://127.0.0.1:${servidor.address().port}`,
      fechar: () => new Promise((ok) => servidor.close(() => ok()))
    }));
}

export async function abrirNavegador() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
}

// Abre o cartaz e espera fontes e imagens (o QR e o logo) antes de imprimir ou capturar.
export async function abrirCartaz(navegador, url, opcoes = {}, preparar = null) {
  const pagina = await navegador.newPage(opcoes);
  if (preparar) preparar(pagina);
  await pagina.goto(url, { waitUntil: 'load' });
  await pagina.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => (img.complete ? null : new Promise((ok) => img.addEventListener('load', ok, { once: true }))))
    );
  });
  return pagina;
}

// cartaz-a6.pdf e cartaz-a5.pdf; com mesas, também cartaz-mesa-N.pdf (A6, para a mesa).
export async function gerarPdfsDoCartaz(pasta = PASTA_QR, mesas = []) {
  const servidor = await servirPasta(join(RAIZ, 'public'));
  const navegador = await abrirNavegador();
  const pedidos = [
    ['cartaz-a6.pdf', 'tamanho=a6'],
    ['cartaz-a5.pdf', 'tamanho=a5'],
    ...mesas.map((mesa) => [`cartaz-mesa-${mesa}.pdf`, `tamanho=a6&mesa=${mesa}`])
  ];
  try {
    for (const [arquivo, consulta] of pedidos) {
      const pagina = await abrirCartaz(navegador, `${servidor.url}/qr/cartaz.html?${consulta}`);
      await pagina.pdf({ path: join(pasta, arquivo), printBackground: true, preferCSSPageSize: true });
      await pagina.close();
      console.log(`  ${arquivo}`);
    }
  } finally {
    await navegador.close();
    await servidor.fechar();
  }
}

// ---------- LEIA-ME ----------

function leiaMe(base, q, mesas) {
  const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
  const comMargem = (cm) => ((cm * q.lado) / q.n).toFixed(1).replace('.', ',');
  return `QR CODE DO CARDÁPIO · MINEIRO LANCHE
=====================================

Destino do QR: ${destinoDe(base, null)}
  O /q redireciona (vercel.json) para o cardápio com origem=qrcode. Assim o
  impresso continua valendo mesmo que a rota do cardápio mude.
${
  mesas.length
    ? `Mesas: ${mesas.join(', ')} → ${destinoDe(base, 'N')} (mesa-N.svg, mesa-N.png e cartaz-mesa-N.pdf em A6)\n`
    : 'Mesas: nenhuma gerada (use --mesas 1-10 se o cliente quiser um QR por mesa).\n'
}
ARQUIVOS
  cardapio.svg     vetor para a gráfica (amplia sem perder qualidade)
  cardapio.png     ${LADO_PNG} x ${LADO_PNG} px, para uso digital
  cartaz.html      cartaz para imprimir em A6 (?tamanho=a5 para A5; ?mesa=3 para a mesa 3)
  cartaz-a6.pdf    cartaz pronto em A6 (10,5 x 14,8 cm)
  cartaz-a5.pdf    cartaz pronto em A5 (14,8 x 21 cm)

ESPECIFICAÇÃO
  Correção de erro H · versão ${q.versao} (${q.n} x ${q.n} módulos) · máscara ${q.mascara} · margem de ${MARGEM} módulos
  Módulos carvão ${CARVAO} sobre creme ${CREME}
  Selo no centro: a logo oficial (design/logo/LOGOTIPO_MINEIRO.pdf, sem alteração), inteira dentro
  de um círculo de ${pct(q.fracaoSelo)} da área do símbolo (limite do plano: 20%), sobre um círculo
  creme sem módulos (${pct(q.fracaoLimpa)} da área).
  O tamanho do selo é calculado: ele estraga no máximo ${Math.max(...q.dano)} das ${q.corrige} palavras que cada
  bloco de correção consegue recuperar. O resto fica de reserva para luz fraca, reflexo
  e foco ruim. Selo maior que isso deixa o QR frágil.

IMPRESSÃO
  - Só imprima depois de definir o domínio final.
  - Lado mínimo: 4 cm só do código, sem contar a margem creme (com a margem, ${comMargem(4)} cm).
    Os cartazes A6 e A5 já passam disso.
  - Regra prática: a distância de leitura é cerca de 10 vezes o lado do QR. Para ler a
    1 m, use 10 cm ou mais.
  - Não troque as cores nem tire a margem creme em volta: o leitor precisa do contraste
    e da zona de silêncio.
  - O selo do SVG é a logo oficial: textos em vetor e o disco, o anel e as estrelas em
    bitmap (JPEG/PNG embutidos). Nada depende de fonte instalada. Se o programa da gráfica
    não abrir imagem embutida em SVG, mande o PDF do cartaz ou o PNG.

COMO REGENERAR
  npm run qrcode -- --base https://dominio-final
  npm run qrcode -- --base https://dominio-final --mesas 1-10
  Sem --base, usa VITE_SITE_URL do .env.production. O comando refaz os SVG, os PNG, este
  arquivo e os dois PDFs (--sem-pdf pula os PDFs).
  Depois confira: QR_BASE=https://dominio-final node --test tests/qrcode.test.mjs
`;
}

// ---------- linha de comando ----------

export function lerArgs(argv) {
  const args = { base: null, mesas: [], saida: PASTA_QR, pdf: true };
  for (let i = 0; i < argv.length; i++) {
    const [chave, valorJunto] = argv[i].split(/=(.*)/s);
    const valor = () => valorJunto ?? argv[++i];
    if (chave === '--base') args.base = valor();
    else if (chave === '--mesas') args.mesas = lerMesas(valor());
    else if (chave === '--saida') args.saida = resolve(valor());
    else if (chave === '--sem-pdf') args.pdf = false;
    else if (chave === '--ajuda' || chave === '-h') args.ajuda = true;
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = lerArgs(argv);
  if (args.ajuda) {
    console.log('Uso: npm run qrcode -- [--base https://dominio] [--mesas 1-10] [--saida pasta] [--sem-pdf]');
    return;
  }
  const base = lerBase(args.base);
  mkdirSync(args.saida, { recursive: true });
  const pastaRel = relative(RAIZ, args.saida) || '.';
  console.log(`Destino: ${destinoDe(base)}  →  ${pastaRel}/`);

  const q = await gerarQr(destinoDe(base), args.saida, 'cardapio');
  console.log(
    `  cardapio.svg / cardapio.png (versão ${q.versao}, ${q.n} módulos, máscara ${q.mascara}, selo ${(q.fracaoSelo * 100).toFixed(1)}% da área, ` +
      `dano por bloco ${q.dano.join('/')} de ${q.corrige} corrigíveis)`
  );
  for (const mesa of args.mesas) {
    await gerarQr(destinoDe(base, mesa), args.saida, `mesa-${mesa}`);
    console.log(`  mesa-${mesa}.svg / mesa-${mesa}.png → ${destinoDe(base, mesa)}`);
  }
  // QR (e cartaz) de mesa que sobrou de outra geração pode apontar para a base antiga: sai.
  for (const arq of readdirSync(args.saida)) {
    const m = arq.match(/^(?:mesa-(\d+)\.(?:svg|png)|cartaz-mesa-(\d+)\.pdf)$/);
    if (m && !args.mesas.includes(Number(m[1] || m[2]))) {
      unlinkSync(join(args.saida, arq));
      console.log(`  removido ${arq} (não pedido nesta geração)`);
    }
  }
  writeFileSync(join(args.saida, 'LEIA-ME.txt'), leiaMe(base, q, args.mesas));
  console.log('  LEIA-ME.txt');

  if (!args.pdf) return;
  if (resolve(args.saida) !== PASTA_QR) {
    console.log('PDFs do cartaz não gerados: o cartaz usa public/qr (rode sem --saida).');
    return;
  }
  try {
    await gerarPdfsDoCartaz(args.saida, args.mesas);
  } catch (e) {
    console.warn(`Aviso: PDFs do cartaz não gerados (${e.message.split('\n')[0]}). Os QR estão prontos.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
