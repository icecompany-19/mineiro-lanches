// Trava dos seletores e textos que os testes usam (docs/DIRECAO-VISUAL.md §5.0): node --test tests/seletores.test.mjs
// Sem navegador nem banco. Falha se algum id, data-*, classe ou texto protegido sumir do front (index.html,
// src/**/*.js, src/**/*.css, painel/index.html, motoboy/index.html). Renomear um deles quebra o Playwright; aqui o aviso vem em 1 s.
import { test as teste } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// O Playwright (testDir: tests) também importa *.test.mjs: lá estes testes do node:test não rodam.
const NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT) || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
const test = NODE_TEST ? teste : () => {};

const RAIZ = resolve(fileURLToPath(import.meta.url), '..', '..');

function arquivos(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.(js|mjs|css)$/.test(nome) ? [caminho] : [];
  });
}

const FONTES = NODE_TEST
  ? [join(RAIZ, 'index.html'), join(RAIZ, 'painel', 'index.html'), join(RAIZ, 'motoboy', 'index.html'), ...arquivos(join(RAIZ, 'src'))].map((f) => ({
      f: f.slice(RAIZ.length + 1),
      txt: readFileSync(f, 'utf8')
    }))
  : [];
const tudo = FONTES.map((x) => x.txt).join('\n');
const escapa = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// §5.0. "#cardapio", "#site" e "#pedido" são rotas (hash), não ids de elemento.
const ROTAS = ['cardapio', 'site', 'pedido'];
const IDS = ['view-site', 'ficha', 'ficha-add', 'ficha-total', 'ficha-add-txt', 'btn-continuar', 'btn-enviar', 'f-nome', 'f-tel', 'ped-num', 'ped-msg', 'ped-status', 'ped-total', 'envio-erro'];
const DATA = ['screen', 'nav', 'act', 'modo', 'combo', 'combo-preco', 'adic', 'total', 'status', 'semana', 'fq', 'fechar-ficha', 'completo', 'prensado', 'ing', 'id', 'vazio', 'fechar-story', 'editar', 'd', 'contador', 'confirma-t'];
const TELAS = ['menu', 'checkout'];
const CLASSES = ['bio-ctas', 'faixa', 'faixa-combo', 'selo-combo', 'selo-esgotado', 'story-btn', 's-hero', 'passo', 'atual', 'pn-app', 'pn-card', 'pn-desktop', 'pn-mobile', 'pn-acesso', 'pn-modal', 'pn-num', 'pn-tag--mesa', 'pn-tag--qr', 'pn-toast', 'pn-total'];
const TEXTOS = ['Fazer pedido', 'Conheça o truck', 'Na chapa'];

test('rotas protegidas continuam existindo', () => {
  const faltam = ROTAS.filter((r) => !new RegExp(`['"\`]#?${escapa(r)}\\b`).test(tudo));
  assert.deepEqual(faltam, [], 'rotas sumiram: ' + faltam.join(', '));
});

test('ids protegidos continuam existindo (no HTML ou montados pelo JS)', () => {
  const faltam = IDS.filter((id) => !new RegExp(`id=\\\\?["']${escapa(id)}["'\\\\]|['"\`]#${escapa(id)}\\b|getElementById\\(['"]${escapa(id)}['"]`).test(tudo));
  assert.deepEqual(faltam, [], 'ids sumiram: ' + faltam.join(', '));
});

test('atributos data-* protegidos continuam existindo', () => {
  const faltam = DATA.filter((d) => !new RegExp(`data-${escapa(d)}(?![\\w-])|dataset\\.${escapa(d.replace(/-(\w)/g, (_, c) => c.toUpperCase()))}\\b`).test(tudo));
  assert.deepEqual(faltam, [], 'data-* sumiram: ' + faltam.join(', '));
  const telas = TELAS.filter((t) => !new RegExp(`data-screen=\\\\?["']${t}`).test(tudo));
  assert.deepEqual(telas, [], 'telas sumiram: ' + telas.join(', '));
});

test('classes protegidas continuam existindo', () => {
  const faltam = CLASSES.filter((c) => !new RegExp(`(?<![\\w-])${escapa(c)}(?![\\w-])`).test(tudo));
  assert.deepEqual(faltam, [], 'classes sumiram: ' + faltam.join(', '));
  assert.ok(/pn-selo--\w/.test(tudo), 'nenhuma .pn-selo--* encontrada');
  // .pn-col--novos é montada pelo painel a partir de COLS (`pn-col--${c.id}`)
  assert.ok(tudo.includes('pn-col--${') && /id: *'novos'/.test(tudo), '.pn-col--novos sumiu');
});

test('textos protegidos continuam existindo', () => {
  const faltam = TEXTOS.filter((t) => !tudo.includes(t));
  assert.deepEqual(faltam, [], 'textos sumiram: ' + faltam.join(', '));
});
