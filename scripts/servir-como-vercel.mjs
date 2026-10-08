// Servidor estático que imita a Vercel para testar o build localmente.
// Lê do vercel.json: cleanUrls, trailingSlash, redirects e headers (na mesma ordem da Vercel:
// cleanUrls → trailingSlash → redirects → headers → arquivos).
// Uso: node scripts/servir-como-vercel.mjs [porta=4300] [--dir dist]
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const iDir = args.indexOf('--dir');
const PASTA = resolve(RAIZ, iDir >= 0 ? args[iDir + 1] : 'dist');
const PORTA = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--dir') ?? 4300);
const CONFIG = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'));

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm'
};

/* ---------- padrões "source" da Vercel (subconjunto do path-to-regexp 6, modo estrito) ---------- */
const esc = (s) => s.replace(/[.+*?^${}()|[\]\\/]/g, '\\$&');

export function compilarFonte(fonte) {
  let re = '^',
    anon = 0,
    i = 0;
  const nomes = [];
  while (i < fonte.length) {
    const comPrefixo = fonte[i] === '/' && (fonte[i + 1] === ':' || fonte[i + 1] === '(');
    let j = comPrefixo ? i + 1 : i;
    if (fonte[j] !== ':' && fonte[j] !== '(') {
      re += esc(fonte[i]);
      i++;
      continue;
    }
    let nome,
      padrao = '[^\\/#\\?]+?';
    if (fonte[j] === ':') {
      const m = /^:(\w+)/.exec(fonte.slice(j));
      nome = m[1];
      j += m[0].length;
    } else nome = String(anon++);
    if (fonte[j] === '(') {
      let prof = 0,
        k = j;
      for (; k < fonte.length; k++) {
        if (fonte[k] === '\\') k++;
        else if (fonte[k] === '(') prof++;
        else if (fonte[k] === ')' && --prof === 0) break;
      }
      padrao = fonte.slice(j + 1, k);
      j = k + 1;
    }
    const mod = '?*+'.includes(fonte[j] || '-') ? fonte[j++] : '';
    const p = comPrefixo ? '\\/' : '';
    nomes.push(nome);
    if (mod === '*' || mod === '+') re += `(?:${p}((?:${padrao})(?:${p}(?:${padrao}))*))${mod === '*' ? '?' : ''}`;
    else re += `(?:${p}(${padrao}))${mod}`;
    i = j;
  }
  return { re: new RegExp(re + '$'), nomes };
}

function casar(fonte, caminho) {
  const { re, nomes } = compilarFonte(fonte);
  const m = re.exec(caminho);
  if (!m) return null;
  const params = {};
  nomes.forEach((n, k) => (params[n] = m[k + 1] ?? ''));
  return params;
}

const decodificar = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// Troca :nome no destino; na query string o valor vai codificado.
function montarDestino(destino, params, queryOriginal) {
  const [caminho, query = ''] = destino.split('?');
  const trocar = (s, codificar) =>
    s.replace(/:(\w+)/g, (t, n) => (n in params ? (codificar ? encodeURIComponent(decodificar(params[n])) : params[n]) : t));
  const final = new URLSearchParams(trocar(query, true));
  for (const [k, v] of new URLSearchParams(queryOriginal)) if (!final.has(k)) final.append(k, v);
  const q = final.toString();
  return trocar(caminho, false) + (q ? '?' + q : '');
}

/* ---------- etapas da Vercel ---------- */
function redirecionamentoDoSistema(caminho) {
  if (CONFIG.cleanUrls) {
    let m = /^\/(?:(.+)\/)?index(?:\.html)?\/?$/.exec(caminho);
    if (m) return '/' + (m[1] || '');
    m = /^\/(.*)\.html\/?$/.exec(caminho);
    if (m) return '/' + m[1];
  }
  if (CONFIG.trailingSlash === true && !caminho.endsWith('/') && !/\.\w+$/.test(caminho)) return caminho + '/';
  if (CONFIG.trailingSlash === false && caminho.length > 1 && caminho.endsWith('/')) return caminho.replace(/\/+$/, '');
  return null;
}

function cabecalhosPara(caminho) {
  const saida = {};
  for (const regra of CONFIG.headers || []) {
    if (regra.has || regra.missing) continue; // condições não são imitadas
    if (casar(regra.source, caminho)) for (const h of regra.headers) saida[h.key] = h.value;
  }
  return saida;
}

function arquivoDe(caminho) {
  let rel;
  try {
    rel = decodeURIComponent(caminho);
  } catch {
    return null;
  }
  const alvo = resolve(PASTA, '.' + rel);
  if (alvo !== PASTA && !alvo.startsWith(PASTA + sep)) return null;
  const tentativas = rel.endsWith('/')
    ? [join(alvo, 'index.html')]
    : [alvo, CONFIG.cleanUrls ? alvo + '.html' : null, join(alvo, 'index.html')];
  for (const t of tentativas) {
    try {
      if (t && statSync(t).isFile()) return t;
    } catch {
      // não existe: tenta a próxima
    }
  }
  return null;
}

function responder(req, res) {
  const url = new URL(req.url, 'http://local');
  const caminho = url.pathname;
  const query = url.search.slice(1);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const sistema = redirecionamentoDoSistema(caminho);
  if (sistema !== null) {
    res.writeHead(308, { Location: sistema + url.search }).end();
    return;
  }

  for (const r of CONFIG.redirects || []) {
    if (r.has || r.missing) continue;
    const params = casar(r.source, caminho);
    if (!params) continue;
    const status = r.statusCode || (r.permanent ? 308 : 307);
    res.writeHead(status, { Location: montarDestino(r.destination, params, query) }).end();
    return;
  }

  const cab = cabecalhosPara(caminho);
  const arquivo = arquivoDe(caminho);
  if (!arquivo) {
    const pagina404 = join(PASTA, '404.html');
    let corpo = 'Não encontrado';
    let tipo = 'text/plain; charset=utf-8';
    try {
      corpo = readFileSync(pagina404);
      tipo = TIPOS['.html'];
    } catch {
      // sem 404.html: texto simples
    }
    res.writeHead(404, { ...cab, 'Content-Type': tipo }).end(req.method === 'HEAD' ? undefined : corpo);
    return;
  }
  const tipo = TIPOS[extname(arquivo).toLowerCase()] || 'application/octet-stream';
  const { size } = statSync(arquivo);
  res.writeHead(200, { 'Cache-Control': 'public, max-age=0, must-revalidate', ...cab, 'Content-Type': tipo, 'Content-Length': size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(arquivo).pipe(res);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    statSync(PASTA);
  } catch {
    console.error(`Pasta ${PASTA} não existe. Rode "npm run build" antes.`);
    process.exit(1);
  }
  createServer((req, res) => {
    try {
      responder(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  }).listen(PORTA, () => console.log(`Servindo ${PASTA} como a Vercel em http://localhost:${PORTA}`));
}
