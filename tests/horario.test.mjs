// Horário automático (contrato C5 da fase 3): node --test tests/horario.test.mjs
// Seg/ter/qui 19h–0h; sex/sáb/dom 19h–1h do dia seguinte; quarta fechada.
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
const ABRE = 19 * 60;
const QUARTA = 3;

test('7 dias x 288 instantes: turnos às 19h, fim de semana até 1h e quarta fechada', () => {
  let n = 0;
  for (let d = 0; d < 7; d++) {
    for (let m = 0; m < 1440; m += 5) {
      const s = ML.horario.situacaoNo(d, m);
      const esperado = (d !== QUARTA && m >= ABRE) || ([0, 1, 6].includes(d) && m < 60);
      assert.equal(s.aberto, esperado, `dia ${d}, minuto ${m} (${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')})`);
      n++;
    }
  }
  assert.equal(n, 7 * 288);
});

test('fronteiras das 19h, da meia-noite e da 1h, incluindo a madrugada de segunda', () => {
  for (const d of [0, 1, 2, 4, 5, 6]) {
    assert.equal(ML.horario.situacaoNo(d, ABRE - 1).aberto, false, `dia ${d} 18:59`);
    assert.equal(ML.horario.situacaoNo(d, ABRE).aberto, true, `dia ${d} 19:00`);
    assert.equal(ML.horario.situacaoNo(d, 1439).aberto, true, `dia ${d} 23:59`);
    const sobra = [0, 1, 6].includes(d);
    for (const min of [0, 30, 59]) assert.equal(ML.horario.situacaoNo(d, min).aberto, sobra, `dia ${d} minuto ${min}`);
    assert.equal(ML.horario.situacaoNo(d, 60).aberto, false, `dia ${d} 01:00`);
  }
  // quarta: o dia todo fechado; a terça acaba à meia-noite e a quinta só abre às 19h
  for (const m of [0, 720, ABRE, 20 * 60, 1439]) assert.equal(ML.horario.situacaoNo(QUARTA, m).aberto, false, `quarta ${m}`);
});

test('CONFIG: quarta fechada, três noites até meia-noite e três até 1h', () => {
  assert.equal(CONFIG.horarios[QUARTA], null);
  for (const d of [1, 2, 4]) assert.deepEqual(plano(CONFIG.horarios[d]), ['19:00', '00:00'], `dia ${d}`);
  for (const d of [0, 5, 6]) assert.deepEqual(plano(CONFIG.horarios[d]), ['19:00', '01:00'], `dia ${d}`);
  assert.equal(ML.horario.turnos[QUARTA], null);
  assert.deepEqual(plano(ML.horario.turnos[0]), { abre: ABRE, fecha: 1500 }, 'domingo fecha na segunda à 1h');
  assert.deepEqual(plano(ML.horario.turnos[5]), { abre: ABRE, fecha: 1500 }, 'sexta fecha no sábado à 1h');
  assert.deepEqual(plano(ML.horario.turnos[6]), { abre: ABRE, fecha: 1500 }, 'sábado fecha no domingo à 1h');
  assert.deepEqual(plano(CONFIG.horarioTexto), ['Segunda, terça e quinta, das 19h à meia-noite', 'Sexta, sábado e domingo, das 19h à 1h', 'Fechado às quartas']);
});

test('o status mostra abertura às 19h, quarta fechada e domingo até 1h de segunda', () => {
  // 12/10/2026 é segunda; 13 terça; 14 quarta; 15 quinta. 17h UTC = 14h em São Paulo.
  const em = (iso) => ML.horario.situacao(new Date(iso)).txt;
  assert.equal(em('2026-10-12T17:00:00Z'), 'Fechado agora · abre hoje às 19h');
  assert.equal(em('2026-10-12T23:00:00Z'), 'Aberto agora · até meia-noite');
  assert.equal(em('2026-10-14T23:00:00Z'), 'Fechado agora · abre amanhã às 19h', 'quarta 20h');
  assert.equal(em('2026-10-14T17:00:00Z'), 'Fechado agora · abre amanhã às 19h', 'quarta 14h');
  assert.equal(em('2026-10-13T23:00:00Z'), 'Aberto agora · até meia-noite', 'terça 20h');
  assert.equal(em('2026-10-15T17:00:00Z'), 'Fechado agora · abre hoje às 19h', 'quinta 14h');
  assert.equal(em('2026-10-19T03:30:00Z'), 'Aberto agora · até 1h', 'segunda 00h30 ainda é turno de domingo');
  assert.equal(em('2026-10-19T04:00:00Z'), 'Fechado agora · abre hoje às 19h', 'segunda 1h encerra o domingo');
});

// ---------- o texto fixo do site não pode anunciar a abertura antiga ----------
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

test('nenhuma abertura antiga às 18h no index.html e no src/ (fora dos comentários)', () => {
  const alvos = [join(RAIZ, 'index.html'), ...arquivos(join(RAIZ, 'src'))];
  const achados = [];
  for (const f of alvos) {
    const txt = semComentarios(readFileSync(f, 'utf8'));
    txt.split('\n').forEach((linha, i) => {
      if (/18:00|(?:das|às|abre>)18h|(?:das|às) 18h/.test(linha)) achados.push(`${f.slice(RAIZ.length + 1)}:${i + 1}: ${linha.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(achados, []);
});

// ---------- o index.html espelha o CONFIG (quem chega sem JS vê o mesmo horário) ----------
const html = NODE_TEST ? readFileSync(join(RAIZ, 'index.html'), 'utf8') : '';
// a mesma marcação que src/app.js escreve em [data-horario-txt]: um .turno por linha, "·" no fim da de cima e palavra com hífen sem quebra
const turnos = (ts) => ts.map((t, i) => '<span class="turno">' + t.replace(/[^ ]+-[^ ]+/g, '<span class="nb">$&</span>') + (i < ts.length - 1 ? '&nbsp;·' : '') + '</span>').join(' ');
const ocorrencias = (txt, trecho) => txt.split(trecho).length - 1;

test('index.html: herói, S6 e rodapé trazem o horarioTexto do CONFIG; o herói começa em 19h', () => {
  const ts = CONFIG.horarioTexto;
  assert.equal(ocorrencias(html, '<p class="hero-horario" data-hero-horario>' + ts.map((t) => '<span>' + t + '</span>').join('') + '</p>'), 1, 'herói');
  assert.equal(ocorrencias(html, '<p class="noite__txt rv" data-horario-txt>' + turnos(ts) + '</p>'), 1, 'S6');
  assert.equal(ocorrencias(html, '<span data-horario-txt>' + turnos(ts) + '</span>'), 1, 'rodapé');
  assert.equal(ocorrencias(html, '<span data-abre>19h</span>'), 1, 'hora do herói');
  assert.equal(ocorrencias(html, '<p class="s-olho rv">Todo dia, menos quarta</p>'), 1, 'olho da S6');
  assert.equal(ocorrencias(html, '<div class="escala" aria-hidden="true"><span>19h</span><span>22h</span><span>1h</span></div>'), 2, 'régua da semana (cardápio e S6)');
});

test('index.html: JSON-LD separa os turnos de meia-noite e 1h, sem a quarta', () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld.openingHoursSpecification, [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Thursday'], opens: '19:00', closes: '00:00' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Friday', 'Saturday', 'Sunday'], opens: '19:00', closes: '01:00' }
  ]);
});
