import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ = import.meta.dirname;
const SPRITE = resolve(RAIZ, 'src/partials/sprite.svg');
const MARCADOR = '<!-- sprite -->';
const FOTOS = resolve(RAIZ, 'public/assets/fotos.json');

// Injeta o sprite de ícones (src/partials/sprite.svg) no lugar de <!-- sprite --> das três páginas.
// Os <use href="#i-…"> continuam apontando para o mesmo documento.
function sprite() {
  const ler = () =>
    readFileSync(SPRITE, 'utf8')
      .replace(/^\s*<!--[\s\S]*?-->\s*/, '')
      .trim();
  return {
    name: 'ml-sprite',
    configureServer(server) {
      server.watcher.add(SPRITE);
      server.watcher.on('change', (f) => {
        if (resolve(f) === SPRITE) server.ws.send({ type: 'full-reload' });
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!html.includes(MARCADOR)) throw new Error(`${ctx.path}: falta o marcador ${MARCADOR}`);
        return html.replace(MARCADOR, () => ler());
      }
    }
  };
}

// import FOTOS from 'virtual:fotos' entrega public/assets/fotos.json (largura, altura e cor de cada foto)
// sem importar da pasta public, que o Vite reserva para arquivos servidos como estão.
function fotos() {
  const ID = 'virtual:fotos';
  return {
    name: 'ml-fotos',
    resolveId(id) {
      if (id === ID) return '\0' + ID;
    },
    load(id) {
      if (id !== '\0' + ID) return;
      this.addWatchFile(FOTOS);
      return 'export default ' + JSON.stringify(JSON.parse(readFileSync(FOTOS, 'utf8'))) + ';';
    }
  };
}

// No build, pré-carrega a Lilita One (letreiro do logo e títulos) e o Oswald 600 (preços e rótulos da primeira tela).
function preloadLetreiro() {
  const FONTES = [/lilita-one-latin-400-normal[^/]*\.woff2$/, /oswald-latin-600-normal[^/]*\.woff2$/];
  return {
    name: 'ml-preload-letreiro',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const nomes = Object.keys(ctx.bundle || {});
        const fontes = FONTES.map((re) => nomes.find((n) => re.test(n))).filter(Boolean);
        if (!fontes.length) return html;
        return fontes.map((fonte) => ({
          tag: 'link', attrs: { rel: 'preload', href: '/' + fonte, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head'
        }));
      }
    }
  };
}

// Três páginas: cliente (bio, cardápio, site, acompanhar), painel (equipe, com login) e motoboy (entregador, com login).
// Os bundles do Vite vão para /_app (hash no nome, cache imutável); as fotos ficam em /assets (public/).
function motoboyOffline() {
  return {
    name: 'ml-motoboy-offline',
    apply: 'build',
    generateBundle(_, bundle) {
      const arquivos = Object.keys(bundle).filter(n => /\.(js|css|woff2?)$/.test(n)).map(n => '/' + n);
      arquivos.push('/motoboy/', '/assets/logo/selo-256.webp');
      const versao = createHash('sha256').update(arquivos.join('|') + readFileSync(resolve(RAIZ, 'motoboy/index.html'), 'utf8') + readFileSync(SPRITE, 'utf8')).digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'motoboy/sw.js', source: `
const CACHE='mineiro-motoboy-${versao}';
const ARQUIVOS=${JSON.stringify(arquivos)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ARQUIVOS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('mineiro-motoboy-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  if(e.request.mode==='navigate'&&u.pathname==='/motoboy/'){
    e.respondWith(fetch(e.request).catch(()=>caches.match('/motoboy/')));return;
  }
  if(ARQUIVOS.includes(u.pathname))e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
` });
    }
  };
}

export default defineConfig({
  plugins: [sprite(), fotos(), preloadLetreiro(), motoboyOffline()],
  build: {
    assetsDir: '_app',
    target: 'es2020',
    rollupOptions: {
      input: {
        cliente: resolve(RAIZ, 'index.html'),
        painel: resolve(RAIZ, 'painel/index.html'),
        motoboy: resolve(RAIZ, 'motoboy/index.html')
      }
    }
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true }
});
