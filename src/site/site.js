/* Mineiro Lanche · site imersivo (#site): entrada do chunk (docs/DIRECAO-VISUAL.md 6).
   src/app.js pede este módulo por import() (carregarSite): na primeira visita a #site ou, depois da bio, no ocioso.
   O Rollup separa o chunk sozinho (_app/site-*.js e _app/site-*.css, sem manualChunks): a bio e o cardápio não pagam
   nada pelo site.

   Cenas, na ordem do roteiro: cada uma é um par src/site/cenas/<cena>.js + .css e cuida só da sua seção.
   Contrato de uma cena:
     iniciar(ctx)  chamado a cada entrada no site (e 1x no carregamento ocioso, com a view escondida). Idempotente:
                   monta na primeira vez e liga o que for preciso. Se a seção dela não existe no DOM, não faz nada.
     parar()       opcional; chamado quando a view do site sai de cena (e logo depois do iniciar() ocioso).
   ctx = { raiz, $, $$, ML, C, app, foto, esc, brl, ic } (veja criarCtx). A base comum (laço de --p, .pausa/.visivel,
   revelação, letras) está em ./base.js; o roteiro de fotos, em ./roteiro.js. */
import '../styles/site.css';
import './cenas/hero.css';
import './cenas/fitas.css';
import './cenas/placa.css';
import './cenas/monte.css';
import './cenas/prensa.css';
import './cenas/dog.css';
import './cenas/combos.css';
import './cenas/noite.css';
import './cenas/fotos.css';
import './cenas/onde.css';
import './cenas/final.css';
import * as hero from './cenas/hero.js';
import * as fitas from './cenas/fitas.js';
import * as placa from './cenas/placa.js';
import * as monte from './cenas/monte.js';
import * as prensa from './cenas/prensa.js';
import * as dog from './cenas/dog.js';
import * as combos from './cenas/combos.js';
import * as noite from './cenas/noite.js';
import * as fotos from './cenas/fotos.js';
import * as onde from './cenas/onde.js';
import * as final from './cenas/final.js';
import { observar, revelar } from './base.js';

// S0, S1, S1b, S2, S3, S4, S5, S6, S7, S8, S9
const CENAS = [
  ['hero', hero],
  ['fitas', fitas],
  ['placa', placa],
  ['monte', monte],
  ['prensa', prensa],
  ['dog', dog],
  ['combos', combos],
  ['noite', noite],
  ['fotos', fotos],
  ['onde', onde],
  ['final', final]
];

let ctx = null;

// o que toda cena recebe: a raiz (#view-site), buscas dentro dela e as pontes com o app
function criarCtx(raiz) {
  const ML = window.ML;
  return {
    raiz: raiz, // div#view-site
    $: (sel, el) => (el || raiz).querySelector(sel),
    $$: (sel, el) => Array.from((el || raiz).querySelectorAll(sel)),
    ML: ML, // window.ML: CONFIG, produtos, fmt, horario, regras, precos, store, whatsapp
    C: ML.CONFIG,
    app: ML.app, // abrirFicha, adicionarRapido, irCategoria, foto, ic, ingTexto, contar, soprarFumaca, passarBrilho, indisponivel
    foto: ML.app.foto, // atr, trocar, visual, nova, marcarCarregadas, info, slugs, produtoDe
    esc: ML.fmt.esc,
    brl: ML.fmt.brl,
    ic: ML.app.ic
  };
}

// uma cena com erro não derruba as outras
function rodar(nome, fn, arg) {
  try {
    fn(arg);
  } catch (e) {
    console.error('site: a cena ' + nome + ' falhou', e);
  }
}

export function iniciar() {
  const raiz = document.getElementById('view-site');
  if (!raiz || !window.ML || !window.ML.app) return;
  const primeira = !ctx;
  if (primeira) {
    ctx = criarCtx(raiz);
    // toda seção do site ganha .pausa fora da tela e .visivel na primeira entrada
    raiz.querySelectorAll(':scope > section, :scope > .fitas').forEach(observar);
  }
  CENAS.forEach(([nome, c]) => rodar(nome, c.iniciar, ctx));
  if (primeira) {
    ctx.foto.marcarCarregadas(raiz);
    revelar(raiz);
  }
}

export function parar() {
  if (!ctx) return;
  CENAS.forEach(([nome, c]) => {
    if (c.parar) rodar(nome, c.parar);
  });
}
