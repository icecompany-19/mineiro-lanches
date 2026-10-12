// Orçamento do site imersivo (docs/DIRECAO-VISUAL.md 6.3), medido no build (dist/).
// Uso: npm run build && node scripts/orcamento-site.mjs [pasta-dist]
// Imprime quatro números (gzip, nível padrão do zlib, como o relatório do Vite) e sai com 0 se todos estiverem
// dentro do limite, 1 se algum passar (ou se o chunk do site não existir):
//   1. JS do site: _app/site-*.js (o chunk que src/app.js pede por import())          ≤ 12 KB gz
//   2. CSS do site: _app/site-*.css (os .css que src/site/site.js importa)             ≤ 10 KB gz
//   3. JS do cliente no total: todo .js que index.html alcança (imports estáticos e
//      dinâmicos, o Supabase inclusive), menos o que só o chunk do site alcança        < 120 KB gz
//   4. Primeira vista de /#site (estimativa, cache vazio, abrindo direto em /#site):    ≤ 150 KB
//      caminho crítico da primeira dobra = HTML + CSS do index + JS da entrada e dos imports estáticos
//      + chunk do site (JS e CSS) + fontes com preload no HTML + imagens da S0 (todo <img> entre os marcadores
//      [S0] do index.html, lazy ou não: na primeira dobra elas baixam já; o maior candidato do srcset, que é o do
//      celular em DPR 3) + preloads de imagem que public/rota.js faz para #site + texturas que o CSS das classes
//      da section da S0 pede (url() ou var(--x) com url()). Texto, CSS e JS contam com gzip; imagens e fontes,
//      o tamanho do arquivo.
//      Ficam de fora (impressos à parte, informativos): o pacote do Supabase, que a store só pede depois da
//      primeira pintura (main-cliente.js), e as fontes sem preload, que baixam quando o texto delas aparece.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const DIST = resolve(RAIZ, process.argv[2] || 'dist');
const APP = join(DIST, '_app');
const LIMITES = { siteJs: 12, siteCss: 10, clienteJs: 120, primeiraVista: 150 }; // KB (1 KB = 1000 bytes, como o Vite)

if (!existsSync(join(DIST, 'index.html')) || !existsSync(APP)) {
  console.error(`orcamento-site: ${DIST} sem index.html ou _app/. Rode "npm run build" antes.`);
  process.exit(1);
}

const gz = (buf) => gzipSync(buf).length;
const ler = (f) => readFileSync(f);
const kb = (b) => (b / 1000).toFixed(1).replace('.', ',') + ' KB';
const arquivos = readdirSync(APP);
const tamanho = (f) => (existsSync(f) ? statSync(f).size : 0);
const publico = (url) => join(RAIZ, 'public', url.replace(/^\//, '').split(/[?#]/)[0]);
const doDist = (url) => join(DIST, url.replace(/^\//, '').split(/[?#]/)[0]);

// ---------- grafo de imports do JS ----------
// os chunks do Vite citam os outros como "./nome-hash.js" (import estático, import() e a lista do __vitePreload)
const RE_ESTATICO = /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]+from\s*)?["']\.\/([\w.-]+\.js)["']/g;
const RE_QUALQUER = /["']\.\/([\w.-]+\.(?:js|css))["']/g;
function citados(nome, re) {
  const txt = ler(join(APP, nome)).toString('utf8');
  const out = new Set();
  for (const m of txt.matchAll(re)) out.add(m[1]);
  return out;
}
function alcanca(entradas, { soEstatico = false, parar = () => false } = {}) {
  const vistos = new Set();
  const fila = [...entradas];
  while (fila.length) {
    const n = fila.shift();
    if (vistos.has(n) || parar(n) || !arquivos.includes(n)) continue;
    vistos.add(n);
    if (n.endsWith('.js')) for (const c of citados(n, soEstatico ? RE_ESTATICO : RE_QUALQUER)) fila.push(c);
  }
  return vistos;
}

const html = ler(join(DIST, 'index.html')).toString('utf8');
const doIndex = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\/_app\//, ''));
const entradasJs = doIndex(/<script[^>]+type="module"[^>]+src="([^"]+)"/g).concat(doIndex(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g));
const cssIndex = doIndex(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g);
const fontesPreload = doIndex(/<link[^>]+rel="preload"[^>]+href="([^"]+)"[^>]+as="font"/g);

const siteJs = arquivos.filter((n) => /^site-[\w-]+\.js$/.test(n));
const siteCss = arquivos.filter((n) => /^site-[\w-]+\.css$/.test(n));
if (!siteJs.length) {
  console.error('orcamento-site: não achei _app/site-*.js (o import() de src/site/site.js em src/app.js sumiu?).');
  process.exit(1);
}

// JS do cliente: tudo que o index alcança sem passar pelo chunk do site
const clienteJs = [...alcanca(entradasJs, { parar: (n) => siteJs.includes(n) })].filter((n) => n.endsWith('.js'));
// o que o chunk do site traz de JS próprio (se o Rollup separar um pedaço só dele, conta aqui)
const doSite = [...alcanca(siteJs)].filter((n) => !clienteJs.includes(n));
const siteJsTodos = doSite.filter((n) => n.endsWith('.js'));
const siteCssTodos = [...new Set(siteCss.concat(doSite.filter((n) => n.endsWith('.css'))))];
// JS da entrada e dos imports estáticos (o que roda antes de qualquer import())
const estaticos = [...alcanca(entradasJs, { soEstatico: true, parar: (n) => siteJs.includes(n) })].filter((n) => n.endsWith('.js'));
const depoisDaPintura = clienteJs.filter((n) => !estaticos.includes(n));

const soma = (lista, f) => lista.reduce((t, n) => t + f(n), 0);
const gzApp = (n) => gz(ler(join(APP, n)));

const nSiteJs = soma(siteJsTodos, gzApp);
const nSiteCss = soma(siteCssTodos, gzApp);
const nClienteJs = soma(clienteJs, gzApp);
const nClienteCss = soma(cssIndex, gzApp);

// ---------- primeira vista de /#site ----------
const ini = html.indexOf('<!-- [S0] inicio');
const fim = html.indexOf('<!-- [S0] fim');
const s0 = ini >= 0 && fim > ini ? html.slice(ini, fim) : (html.match(/<section class="s-hero[\s\S]*?<\/section>/) || [''])[0];
// maior candidato do srcset (é o que o celular de DPR 3 pede) ou o src
function maiorCandidato(tag) {
  const srcset = (tag.match(/\ssrcset="([^"]+)"/) || [])[1];
  if (srcset) {
    const cands = srcset.split(',').map((c) => c.trim().split(/\s+/));
    cands.sort((a, b) => parseFloat(b[1] || '1') - parseFloat(a[1] || '1'));
    return cands[0][0];
  }
  return (tag.match(/\ssrc="([^"]+)"/) || [])[1];
}
const imagens = new Set();
for (const m of s0.matchAll(/<img\b[^>]*>/g)) {
  const u = maiorCandidato(m[0]);
  if (u && u.startsWith('/')) imagens.add(u);
}
// preloads de imagem do public/rota.js no ramo de #site (href ou o maior do imagesrcset)
const rota = existsSync(join(RAIZ, 'public/rota.js')) ? readFileSync(join(RAIZ, 'public/rota.js'), 'utf8') : '';
const ramoSite = (rota.match(/if \(tela === 'site'\) \{([\s\S]*?)\n {2}\}/) || [])[1] || '';
for (const m of ramoSite.matchAll(/(?:href = |'imagesrcset', )'([^']+)'/g)) {
  const u = maiorCandidato(m[0].startsWith('href') ? ` src="${m[1]}"` : ` srcset="${m[1]}"`);
  if (u) imagens.add(u);
}
// texturas que o CSS das classes da section da S0 pede
const classesS0 = ((s0.match(/<section class="([^"]+)"/) || [])[1] || 's-hero').split(/\s+/).filter(Boolean);
const cssTodo = cssIndex
  .concat(siteCssTodos)
  .map((n) => ler(join(APP, n)).toString('utf8'))
  .join('\n');
const vars = {};
for (const m of cssTodo.matchAll(/(--[\w-]+)\s*:\s*url\(["']?([^"')]+)["']?\)/g)) vars[m[1]] = m[2];
for (const regra of cssTodo.split('}')) {
  const [sel, decl] = regra.split('{');
  if (!decl || !classesS0.some((c) => new RegExp('\\.' + c + '(?![\\w-])').test(sel))) continue;
  for (const m of decl.matchAll(/url\(["']?([^"')]+)["']?\)/g)) if (m[1].startsWith('/')) imagens.add(m[1]);
  for (const m of decl.matchAll(/var\((--[\w-]+)\)/g)) if (vars[m[1]]) imagens.add(vars[m[1]]);
}
const tamImg = (u) => tamanho(doDist(u)) || tamanho(publico(u));
const nHtml = gz(Buffer.from(html));
const nEstaticos = soma(estaticos, gzApp);
const nFontesPreload = soma(fontesPreload, (n) => tamanho(join(APP, n)));
const nImagens = [...imagens].reduce((t, u) => t + tamImg(u), 0);
const nPrimeira = nHtml + nClienteCss + nEstaticos + nSiteJs + nSiteCss + nFontesPreload + nImagens;
// informativos
const fontesTodas = arquivos.filter((n) => n.endsWith('.woff2') && !fontesPreload.includes(n));
const nFontesResto = soma(fontesTodas, (n) => tamanho(join(APP, n)));
const nDepois = soma(depoisDaPintura, gzApp);

// ---------- relatório ----------
const linhas = [
  ['JS do site (chunk)', nSiteJs, LIMITES.siteJs, siteJsTodos],
  ['CSS do site (chunk)', nSiteCss, LIMITES.siteCss, siteCssTodos],
  ['JS do cliente no total', nClienteJs, LIMITES.clienteJs, clienteJs],
  ['Primeira vista de /#site', nPrimeira, LIMITES.primeiraVista, null]
];
let ok = true;
console.log('Orçamento do site (docs/DIRECAO-VISUAL.md 6.3), gzip:');
for (const [nome, v, lim, lista] of linhas) {
  // o total do cliente é "menor que"; os outros, "até"
  const dentro = nome.startsWith('JS do cliente') ? v < lim * 1000 : v <= lim * 1000;
  if (!dentro) ok = false;
  console.log(`  ${dentro ? 'ok  ' : 'PASSA'} ${nome.padEnd(26)} ${kb(v).padStart(9)}  (limite ${lim} KB)${lista ? '  ' + lista.join(', ') : ''}`);
}
console.log('  primeira vista, por parte:');
console.log(`    HTML ${kb(nHtml)} · CSS do index ${kb(nClienteCss)} (${cssIndex.join(', ')}) · JS estático ${kb(nEstaticos)} (${estaticos.join(', ')})`);
console.log(`    chunk do site ${kb(nSiteJs + nSiteCss)} · fontes com preload ${kb(nFontesPreload)} (${fontesPreload.join(', ') || 'nenhuma'})`);
console.log(`    imagens da S0 ${kb(nImagens)}: ${[...imagens].map((u) => u + ' ' + kb(tamImg(u))).join(', ') || 'nenhuma'}`);
console.log('  fora da primeira vista (informativo):');
console.log(`    JS pedido depois da primeira pintura ${kb(nDepois)} (${depoisDaPintura.join(', ') || 'nenhum'})`);
console.log(`    fontes sem preload ${kb(nFontesResto)} (${fontesTodas.length} arquivos .woff2; baixam quando o texto delas aparece)`);
console.log(`  CSS do cliente (index): ${kb(nClienteCss)}`);
console.log(ok ? 'Dentro do orçamento.' : 'Fora do orçamento: veja as linhas marcadas PASSA.');
process.exit(ok ? 0 : 1);
