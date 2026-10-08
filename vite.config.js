import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Duas páginas: cliente (bio, cardápio, site, acompanhar) e painel (equipe, com login).
// Os bundles do Vite vão para /_app (hash no nome, cache imutável); as fotos ficam em /assets (public/).
export default defineConfig({
  build: {
    assetsDir: '_app',
    target: 'es2020',
    rollupOptions: {
      input: {
        cliente: resolve(import.meta.dirname, 'index.html'),
        painel: resolve(import.meta.dirname, 'painel/index.html')
      }
    }
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true }
});
