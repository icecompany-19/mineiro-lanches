/* S0 · herói "Acende" (dono: site-I). Seção: section.s-hero, entre os marcadores [S0] do index.html.
   O HTML traz a parede, a placa, os 3 títulos (aberto, fechado e pausa) e o status; o CSS mostra o título do estado
   da luz (html[data-luz] e [data-luz-motivo], escritos por src/app.js). Aqui:
   - as letras de cada título são embrulhadas a partir do texto do HTML e acendem em sequência (base.js);
   - [data-abre] diz a hora da próxima abertura dos turnos (ML.horario.turnos + ML.fmt.hora) e, quando ela não é hoje,
     [data-abre-dia] diz o dia, como o neon do final: "A chapa acende amanhã às 19h." ou "A chapa acende quinta às 19h." (numa
     quarta, que não tem turno). Refeito no evento da loja e a cada virada de minuto, e o aria-label do h1 acompanha o título visível;
   - tocar na placa: 2 piscadas, 1 brilho e um sopro de fumaça (como a bio, via ML.app);
   - a placa balança com a rolagem (mola amortecida, rAF só enquanto mexe);
   - em 1024+ com mouse, o cone da arandela segue o ponteiro (--mx na seção; o CSS faz o resto).
   Movimento reduzido: tudo estático e aceso (sem balanço, sem entrada, sem cone seguindo o mouse). */
import { embrulharLetras, proximaAbertura, quandoAbre, registrar, reduz } from '../base.js';

const CHAVE_PLACA = 'mineiro:v2:placa-acesa'; // a mesma da bio (src/app.js): a placa acende uma vez por sessão
const DESKTOP = window.matchMedia('(min-width: 1024px)');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let montada = false;
let ctx = null;
let sec = null;
let h1 = null;
let abre = null;
let abreDia = null;
let letrado = false;
let sai = null; // desliga a escuta da loja
let timer = 0;
const bal = { ang: 0, vel: 0, rodando: false };

export function iniciar(c) {
  const s = c.$('.s-hero');
  if (!s) return;
  ctx = c;
  if (!montada) {
    montada = true;
    sec = s;
    montar();
  }
  ligar();
}

// a view do site saiu de cena: nada de relógio nem de escuta da loja rodando
export function parar() {
  if (sai) sai();
  sai = null;
  clearTimeout(timer);
  timer = 0;
}

function montar() {
  h1 = ctx.$('#s-tit', sec);
  abre = ctx.$('[data-abre]', sec);
  abreDia = ctx.$('[data-abre-dia]', sec);
  const placa = ctx.$('[data-placa]', sec);
  // o dia e a hora certos antes de embrulhar as letras: o título "fechado" já nasce com o --i em sequência
  escreverAbre();
  horarioTexto();
  // cada título embrulha as próprias letras; o aria-label fica no h1 (acompanha o título do estado, ver atualizar)
  ctx.$$('[data-estado]', h1).forEach((t) => {
    embrulharLetras(t);
    t.removeAttribute('aria-label');
  });
  letrado = true;
  // balanço da placa pela velocidade da rolagem (base.js só chama o quadro com a seção na tela e sem movimento reduzido)
  registrar(sec, {
    semP: true,
    quadro(p, info) {
      balancar(placa, info.dy);
    }
  });
  if (placa) placa.addEventListener('click', () => tocar(placa));
  // o cone da arandela segue o mouse (1024+); o transform é do CSS (.hero-cone)
  sec.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !DESKTOP.matches || reduz()) return;
    const r = sec.getBoundingClientRect();
    sec.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
  });
  sec.addEventListener('pointerleave', () => {
    if (sec.style.getPropertyValue('--mx')) sec.style.setProperty('--mx', '0');
  });
}

// a cada entrada no site: liga a escuta da loja e o relógio de minuto, refaz os textos e acende a placa (1x por sessão)
function ligar() {
  atualizar();
  if (!sai) {
    sai = ctx.ML.store.ouvir((ev) => {
      // os horários chegam com o estado do cardápio; o modo (aberta, fechada, auto) tem evento próprio
      if (ev && (ev.tipo === 'loja:modo' || ev.tipo === 'cardapio:estado')) atualizar();
    });
  }
  agendar();
  if (!ctx.raiz.hidden) acender(ctx.$('[data-placa]', sec));
}

function agendar() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    atualizar();
    agendar();
  }, 60000 - (Date.now() % 60000) + 50);
}

// ---------- textos que seguem os horários ----------
// "19h" em [data-abre] e "amanhã " ou "quinta " em [data-abre-dia] (vazio quando abre hoje). Com as letras já embrulhadas,
// refaz só as letras do trecho que mudou e renumera o --i do título inteiro, para a sequência seguir a ordem de leitura
function escreverAbre() {
  if (!abre) return;
  const prox = proximaAbertura(ctx.ML.horario);
  if (!prox) return;
  let mudou = trocar(abre, ctx.ML.fmt.hora(prox.min));
  if (abreDia) mudou = trocar(abreDia, quandoAbre(prox, ctx.ML.fmt)) || mudou;
  if (mudou && letrado) ctx.$$('.letra', abre.closest('[data-estado]')).forEach((l, i) => l.style.setProperty('--i', i));
}

function trocar(el, txt) {
  if (el.textContent === txt) return false;
  el.textContent = txt;
  if (letrado) {
    el.removeAttribute('data-embrulhado');
    embrulharLetras(el);
    el.removeAttribute('aria-label');
  }
  return true;
}

// as linhas do horário vêm do CONFIG (o HTML traz o mesmo texto para quem chega sem JS)
function horarioTexto() {
  const el = ctx.$('[data-hero-horario]', sec);
  const linhas = ctx.C.horarioTexto || [];
  if (!el || !linhas.length) return;
  const atual = Array.from(el.children).map((s) => s.textContent);
  if (atual.length === linhas.length && atual.every((t, i) => t === linhas[i])) return;
  el.innerHTML = linhas.map((t) => '<span>' + ctx.esc(t) + '</span>').join('');
}

// o título do estado (o mesmo critério de src/app.js: aberto, pausa manual ou antes da abertura)
function estadoAtual() {
  const s = ctx.ML.horario.situacao();
  if (s.aberto) return 'aberto';
  const loja = ctx.ML.store.loja();
  return loja && loja.modo === 'fechada' ? 'pausa' : 'fechado';
}

function atualizar() {
  escreverAbre();
  horarioTexto();
  const estado = estadoAtual();
  const t = ctx.$('[data-estado="' + estado + '"]', h1);
  h1.setAttribute('data-estado', estado);
  if (t) h1.setAttribute('aria-label', t.textContent.replace(/\s+/g, ' ').trim());
}

// ---------- placa ----------
// entrada (uma vez por sessão, com a mesma marca da bio): chega com mola, acende com 2 lampejos e o brilho passa
function acender(placa) {
  if (!placa || reduz()) return;
  let ja = false;
  try {
    ja = sessionStorage.getItem(CHAVE_PLACA) === '1';
    sessionStorage.setItem(CHAVE_PLACA, '1');
  } catch {
    /* sem storage */
  }
  if (ja) return;
  requestAnimationFrame(() => {
    placa.classList.add('entra');
    setTimeout(() => ctx.app.passarBrilho(placa), 1500);
  });
}

// toque: 2 piscadas, 1 brilho e um sopro de fumaça (1x por toque)
function tocar(placa) {
  if (reduz()) return;
  placa.classList.remove('pisca');
  void placa.offsetWidth;
  placa.classList.add('pisca');
  setTimeout(() => ctx.app.passarBrilho(placa), 450);
  ctx.app.soprarFumaca(ctx.$('.fumaca', placa));
}

// balanço: a rolagem dá um empurrão (dy), uma mola amortecida traz de volta; o rAF roda só enquanto mexe
function balancar(placa, dy) {
  if (!placa || !dy || reduz()) return;
  bal.vel += clamp(dy * 0.025, -0.9, 0.9);
  if (bal.rodando) return;
  bal.rodando = true;
  const passo = () => {
    bal.vel += -0.05 * bal.ang;
    bal.vel *= 0.9;
    bal.ang = clamp(bal.ang + bal.vel, -3, 3);
    if (Math.abs(bal.ang) < 0.02 && Math.abs(bal.vel) < 0.02) {
      bal.ang = 0;
      bal.vel = 0;
      bal.rodando = false;
      placa.style.transform = '';
      return;
    }
    placa.style.transform = 'rotate(' + bal.ang.toFixed(2) + 'deg)';
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
