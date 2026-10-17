// Horário automático (contrato C5 da fase 3): node --test tests/horario.test.mjs
// Aberto todos os dias das 18h à meia-noite (sexta e sábado também fecham à meia-noite); quarta fechada.
// Sem banco nem navegador: avalia o core.js (node:vm, como o seed) e lê o index.html e o src/ como texto.
import { test as teste } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { carregarCore } from '../scripts/gerar-seed.mjs';

// O Playwright (testDir: tests) também importa *.test.mjs: lá estes testes do node:test não rodam.
const NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT) || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
const test = NODE_TEST ? teste : () => {};

const RAIZ = resolve(fileURLToPath(import.meta.url), '..', '..');
const { ML, CONFIG } = NODE_TEST ? carregarCore(join(RAIZ, 'src', 'core.js')) : {};

// o core.js roda em outro contexto (node:vm): objetos e listas de lá não são iguais, para o deepEqual, aos daqui
const plano = (x) => JSON.parse(JSON.stringify(x));
const ABRE = 18 * 60; // 1080
const QUARTA = 3;

test('7 dias x 288 instantes (de 5 em 5 min): aberto das 18h à meia-noite, menos a quarta', () => {
  let n = 0;
  for (let d = 0; d < 7; d++) {
    for (let m = 0; m < 1440; m += 5) {
      const s = ML.horario.situacaoNo(d, m);
      assert.equal(s.aberto, d !== QUARTA && m >= ABRE, `dia ${d}, minuto ${m} (${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')})`);
      n++;
    }
  }
  assert.equal(n, 7 * 288);
});

test('as fronteiras: 17:59 fechado, 18:00 aberto, 23:59 aberto; a madrugada nunca é sobra do turno de ontem', () => {
  for (const d of [0, 1, 2, 4, 5, 6]) {
    assert.equal(ML.horario.situacaoNo(d, ABRE - 1).aberto, false, `dia ${d} 17:59`);
    assert.equal(ML.horario.situacaoNo(d, ABRE).aberto, true, `dia ${d} 18:00`);
    assert.equal(ML.horario.situacaoNo(d, 1439).aberto, true, `dia ${d} 23:59`);
    assert.equal(ML.horario.situacaoNo(d, 0).aberto, false, `dia ${d} 00:00 (o turno de ontem acaba à meia-noite)`);
    assert.equal(ML.horario.situacaoNo(d, 30).aberto, false, `dia ${d} 00:30`);
  }
  // quarta: o dia todo fechado; a terça acaba à meia-noite e a quinta só abre às 18h
  for (const m of [0, 720, ABRE, 20 * 60, 1439]) assert.equal(ML.horario.situacaoNo(QUARTA, m).aberto, false, `quarta ${m}`);
});

test('CONFIG: quarta é null (fechada) e os outros dias são 18:00 a 00:00', () => {
  assert.equal(CONFIG.horarios[QUARTA], null);
  for (const d of [0, 1, 2, 4, 5, 6]) assert.deepEqual(plano(CONFIG.horarios[d]), ['18:00', '00:00'], `dia ${d}`);
  assert.equal(ML.horario.turnos[QUARTA], null);
  assert.deepEqual(plano(ML.horario.turnos[5]), { abre: ABRE, fecha: 1440 }, 'sexta fecha à meia-noite (nada passa de 1440)');
  assert.deepEqual(plano(ML.horario.turnos[6]), { abre: ABRE, fecha: 1440 }, 'sábado fecha à meia-noite');
  assert.deepEqual(plano(CONFIG.horarioTexto), ['Todos os dias, das 18h à meia-noite', 'Fechado às quartas']);
});

test('o texto de status: antes das 18h diz "abre hoje às 18h"; na quarta (e depois da meia-noite dela) diz "abre amanhã às 18h"', () => {
  // 12/10/2026 é segunda; 13 terça; 14 quarta; 15 quinta. 17h UTC = 14h em São Paulo.
  const em = (iso) => ML.horario.situacao(new Date(iso)).txt;
  assert.equal(em('2026-10-12T17:00:00Z'), 'Fechado agora · abre hoje às 18h');
  assert.equal(em('2026-10-12T23:00:00Z'), 'Aberto agora · até meia-noite');
  assert.equal(em('2026-10-14T23:00:00Z'), 'Fechado agora · abre amanhã às 18h', 'quarta 20h');
  assert.equal(em('2026-10-14T17:00:00Z'), 'Fechado agora · abre amanhã às 18h', 'quarta 14h');
  assert.equal(em('2026-10-13T23:00:00Z'), 'Aberto agora · até meia-noite', 'terça 20h');
  assert.equal(em('2026-10-15T17:00:00Z'), 'Fechado agora · abre hoje às 18h', 'quinta 14h');
});

// ---------- o texto fixo do site: nada de 19h, 19:00 nem "à 1h" ----------
function arquivos(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.(js|mjs|css)$/.test(nome) ? [caminho] : [];
  });
}
// tira os comentários (de bloco, de linha e de HTML): eles podem citar o horário antigo como exemplo; o que vai ao ar não pode.
// "//" só conta como comentário no começo da linha ou depois de espaço (não corta "https://")
const semComentarios = (txt) =>
  txt
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

test('nenhum "19h", "19:00" nem "à 1h" sobrando no index.html e no src/ (fora dos comentários)', () => {
  const alvos = [join(RAIZ, 'index.html'), ...arquivos(join(RAIZ, 'src'))];
  const achados = [];
  for (const f of alvos) {
    const txt = semComentarios(readFileSync(f, 'utf8'));
    txt.split('\n').forEach((linha, i) => {
      if (linha.includes('19h') || linha.includes('19:00') || /à 1h\b/.test(linha)) achados.push(`${f.slice(RAIZ.length + 1)}:${i + 1}: ${linha.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(achados, []);
});

// ---------- o index.html espelha o CONFIG (quem chega sem JS vê o mesmo horário) ----------
const html = NODE_TEST ? readFileSync(join(RAIZ, 'index.html'), 'utf8') : '';
// a mesma marcação que src/app.js escreve em [data-horario-txt]: um .turno por linha, "·" no fim da de cima e palavra com hífen sem quebra
const turnos = (ts) => ts.map((t, i) => '<span class="turno">' + t.replace(/[^ ]+-[^ ]+/g, '<span class="nb">$&</span>') + (i < ts.length - 1 ? '&nbsp;·' : '') + '</span>').join(' ');
const ocorrencias = (txt, trecho) => txt.split(trecho).length - 1;

test('index.html: herói, S6 e rodapé trazem o horarioTexto do CONFIG; o herói começa em 18h', () => {
  const ts = CONFIG.horarioTexto;
  assert.equal(ocorrencias(html, '<p class="hero-horario" data-hero-horario>' + ts.map((t) => '<span>' + t + '</span>').join('') + '</p>'), 1, 'herói');
  assert.equal(ocorrencias(html, '<p class="noite__txt rv" data-horario-txt>' + turnos(ts) + '</p>'), 1, 'S6');
  assert.equal(ocorrencias(html, '<span data-horario-txt>' + turnos(ts) + '</span>'), 1, 'rodapé');
  assert.equal(ocorrencias(html, '<span data-abre>18h</span>'), 1, 'hora do herói');
  assert.equal(ocorrencias(html, '<p class="s-olho rv">Todo dia, menos quarta</p>'), 1, 'olho da S6');
  assert.equal(ocorrencias(html, '<div class="escala" aria-hidden="true"><span>18h</span><span>21h</span><span>0h</span></div>'), 2, 'régua da semana (cardápio e S6)');
});

test('index.html: o JSON-LD tem uma especificação, 18:00 a 00:00, sem a quarta', () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld.openingHoursSpecification, [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Thursday', 'Friday', 'Saturday'], opens: '18:00', closes: '00:00' }
  ]);
});
