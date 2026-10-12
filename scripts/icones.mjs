// Favicon e ícones do app a partir da logo oficial (design/logo/LOGOTIPO_MINEIRO.pdf, via scripts/logo.mjs).
// Nada é redesenhado: cada ícone é a logo inteira renderizada direto do PDF na escala do ícone e centrada.
// Uso: node scripts/icones.mjs   (se o PDF mudar, rode antes node scripts/logo.mjs)
// Saída: public/favicon.svg e public/icons/{favicon-32,icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
//
// - favicon.svg: o SVG recortado da logo (texto em vetor, bitmaps originais) num viewBox quadrado. Escala para
//   qualquer tamanho, por isso pode ficar como ícone "any" no manifest.
// - favicon-32: transparente, a logo ocupando a largura (a aba do navegador pode ser clara ou escura).
// - icon-192, icon-512 e apple-touch-icon: fundo carvão da marca (o iOS não aceita transparência) com respiro.
// - icon-maskable-512: a arte inteira dentro do círculo seguro de 80% do lado (o Android recorta o resto).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { CARVAO, PASTA_LOGO, RAIZ, lerDados, recorteNaEscala, reenquadrarSvg, renderizarLogo } from './logo.mjs';

export const PUBLICO = join(RAIZ, 'public');
export const ICONES = join(PUBLICO, 'icons');

// ajuste 'caixa': a caixa da logo ocupa `fracao` do lado (na maior dimensão, a largura).
// ajuste 'circulo': o círculo que contém a arte inteira tem diâmetro `fracao` do lado (zona segura do maskable).
export const ESPECIFICACOES = [
  { nome: 'favicon-32.png', lado: 32, ajuste: 'caixa', fracao: 1, fundo: null },
  { nome: 'icon-192.png', lado: 192, ajuste: 'caixa', fracao: 0.84, fundo: CARVAO },
  { nome: 'icon-512.png', lado: 512, ajuste: 'caixa', fracao: 0.84, fundo: CARVAO },
  { nome: 'icon-maskable-512.png', lado: 512, ajuste: 'circulo', fracao: 0.74, fundo: CARVAO }, // círculo seguro: 0,8
  { nome: 'apple-touch-icon.png', lado: 180, ajuste: 'caixa', fracao: 0.82, fundo: CARVAO }
];

// Escala (px por pt) e posição da logo renderizada dentro do ícone.
export function layoutDoIcone(dados, { lado, ajuste, fracao }) {
  let escala = ajuste === 'circulo' ? (lado * fracao) / 2 / dados.raio : (lado * fracao) / Math.max(dados.caixa.w, dados.caixa.h);
  // O recorte vai de pixel inteiro a pixel inteiro (até 1 px a mais que a arte): se passar do lado, encolhe um pouco.
  while (recorteNaEscala(dados.caixa, escala).largura > lado || recorteNaEscala(dados.caixa, escala).altura > lado) escala *= 0.998;
  const r = recorteNaEscala(dados.caixa, escala);
  // centro da caixa no meio do ícone (arredondado ao pixel: o recorte já está na grade da página)
  const esquerda = Math.min(lado - r.largura, Math.max(0, Math.round(lado / 2 - (dados.centro.x * escala - r.x))));
  const topo = Math.min(lado - r.altura, Math.max(0, Math.round(lado / 2 - (dados.centro.y * escala - r.y))));
  return { escala, recorte: r, esquerda, topo };
}

export async function gerarIcone(dados, esp) {
  const { escala, esquerda, topo } = layoutDoIcone(dados, esp);
  const logo = renderizarLogo(dados, escala);
  const fundo = esp.fundo || { r: 0, g: 0, b: 0, alpha: 0 };
  return sharp({ create: { width: esp.lado, height: esp.lado, channels: 4, background: fundo } })
    .composite([{ input: logo.png, left: esquerda, top: topo }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// favicon.svg: o SVG recortado com o viewBox quadrado em volta do centro da caixa.
export function faviconSvg(dados) {
  const lado = Math.max(dados.caixa.w, dados.caixa.h);
  const svg = readFileSync(join(PASTA_LOGO, 'logo.svg'), 'utf8');
  return reenquadrarSvg(svg, { x: dados.centro.x - lado / 2, y: dados.centro.y - lado / 2, w: lado, h: lado }, 64, 64);
}

export async function main() {
  const dados = await lerDados();
  mkdirSync(ICONES, { recursive: true });
  const fav = faviconSvg(dados);
  writeFileSync(join(PUBLICO, 'favicon.svg'), fav);
  console.log(`favicon.svg (${(fav.length / 1024).toFixed(1).replace('.', ',')} KB, logo em vetor)`);
  for (const esp of ESPECIFICACOES) {
    const png = await gerarIcone(dados, esp);
    writeFileSync(join(ICONES, esp.nome), png);
    console.log(`icons/${esp.nome} ${esp.lado}×${esp.lado} (${(png.length / 1024).toFixed(1).replace('.', ',')} KB)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
