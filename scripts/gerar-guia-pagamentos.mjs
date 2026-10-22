// Renderiza o guia público em PDF A4, sem acessar banco nem criar pedidos.
// Uso: PW_CHROMIUM=/usr/bin/chromium node scripts/gerar-guia-pagamentos.mjs
/* global document */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const guia = process.argv[2] || 'pagamentos';
if (!['pagamentos', 'entregas'].includes(guia)) throw new Error('Use pagamentos ou entregas.');
const entrada = guia === 'entregas' ? 'guia-entregas-automaticas.html' : 'guia-pagamentos.html';
const saida = guia === 'entregas' ? 'guia-entregas-automaticas-mineiro-lanche.pdf' : 'guia-pagamentos-mineiro-lanche.pdf';
const tipos = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const servidor = createServer((req, res) => {
  const arquivo = resolve(raiz, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!arquivo.startsWith(raiz + sep) || !tipos[extname(arquivo)]) { res.writeHead(404); return res.end(); }
  try {
    const conteudo = readFileSync(arquivo);
    res.writeHead(200, { 'Content-Type': tipos[extname(arquivo)] }); res.end(conteudo);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
let navegador;
try {
  navegador = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const pagina = await navegador.newPage();
  await pagina.goto(`http://127.0.0.1:${servidor.address().port}/docs/guias/${entrada}`);
  await pagina.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.decode()));
  });
  const paginasComProblema = await pagina.locator('.page').evaluateAll(paginas => paginas.flatMap((p, indice) => {
    const rodape = p.querySelector('.footer');
    const limite = rodape.getBoundingClientRect().top - 5;
    const excesso = Math.max(0, ...[...p.children].filter(el => el !== rodape)
      .map(el => el.getBoundingClientRect().bottom - limite));
    return p.scrollHeight > p.clientHeight + 1 || excesso > 0
      ? [`página ${indice + 1}: excesso de ${Math.ceil(excesso)} px`] : [];
  }));
  if (paginasComProblema.length) throw new Error('Ajuste o HTML antes de gerar o PDF: ' + paginasComProblema.join('; '));
  mkdirSync(resolve(raiz, 'public/guias'), { recursive: true });
  const destino = resolve(raiz, 'public/guias', saida);
  await pagina.pdf({ path: destino, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  console.log(destino);
} finally {
  await navegador?.close();
  await new Promise(ok => servidor.close(ok));
}
