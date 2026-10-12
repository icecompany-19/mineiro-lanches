/* S6 · Letreiro da noite (dono: site-I). Seção: section.s-noite.parede, entre os marcadores [S6] do index.html.
   O HTML traz o título, o horário do CONFIG ([data-horario-txt]), as 7 lâmpadas ([data-semana]) e o status ([data-status]);
   os três últimos são escritos por src/app.js (atualizarStatus, a cada minuto e no evento loja:modo). Aqui:
   - o relógio de Suzano ([data-relogio], ML.horario.agora) anda por minuto, na virada do minuto (um timeout, sem laço);
   - a régua "Simule um horário" (0 a 1435, passo 5) é do dia de hoje: ela segue o relógio até o visitante mexer; ao mexer, a
     parede da seção acende ou apaga (--luz e data-sim na própria seção, por ML.horario.situacaoNo) e o texto diz o horário
     simulado e se estaria aberto. Isso muda só esta seção: nunca o status real, nem html[data-luz], nem o resto do site;
   - o trilho da régua mostra os turnos do dia (--faixas: verde onde abre), refeito com os horários que o banco mandar;
   - aria-valuetext da régua: "sábado, 23h30" (dia da semana e hora, como no resto do site). "Voltar para agora" desfaz a simulação.
   Sem movimento a mais: a transição da parede é a do CSS (e some com prefers-reduced-motion). */

const PASSO = 5;
const MAX = 1435; // 23h55: o último passo do dia

let montada = false;
let ctx = null;
let sec = null;
let hora = null;
let regua = null;
let texto = null;
let volta = null;
let dica = '';
let simulando = false;
let diaFaixas = -1;
let sai = null; // desliga a escuta da loja
let timer = 0;

export function iniciar(c) {
  const s = c.$('.s-noite');
  if (!s) return;
  ctx = c;
  if (!montada) {
    montada = true;
    sec = s;
    montar();
  }
  ligar();
}

// a view do site saiu de cena: sem relógio nem escuta da loja, e a parede volta ao estado real
export function parar() {
  if (!montada) return;
  if (sai) sai();
  sai = null;
  clearTimeout(timer);
  timer = 0;
  if (simulando) desfazer();
}

function montar() {
  hora = ctx.$('[data-relogio]', sec);
  regua = ctx.$('#noite-regua', sec);
  texto = ctx.$('[data-sim-txt]', sec);
  volta = ctx.$('[data-sim-volta]', sec);
  if (!hora || !regua || !texto || !volta) return;
  dica = texto.textContent;
  regua.disabled = false; // o HTML a entrega desligada: sem JS ela não faria nada
  regua.addEventListener('input', () => simular(+regua.value));
  volta.addEventListener('click', () => {
    desfazer();
    regua.focus();
  });
}

// a cada entrada no site: refaz o relógio e a régua e liga a escuta da loja e o relógio de minuto
function ligar() {
  if (!regua) return;
  tick();
  if (!sai) {
    sai = ctx.ML.store.ouvir((ev) => {
      // os horários chegam com o estado do cardápio; o modo da loja tem evento próprio
      if (ev && (ev.tipo === 'loja:modo' || ev.tipo === 'cardapio:estado')) {
        diaFaixas = -1;
        tick();
      }
    });
  }
  agendar();
}

function agendar() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    tick();
    agendar();
  }, 60000 - (Date.now() % 60000) + 50);
}

// relógio de agora; a régua acompanha o relógio enquanto ninguém simula
function tick() {
  const a = ctx.ML.horario.agora();
  const txt = ctx.ML.fmt.relogio(a.min);
  if (hora.textContent !== txt) {
    hora.textContent = txt;
    hora.setAttribute('datetime', txt);
  }
  if (a.dia !== diaFaixas) desenharFaixas(a.dia);
  if (!simulando) {
    regua.value = String(Math.min(MAX, a.min - (a.min % PASSO)));
    textoDe(a.dia, +regua.value);
  }
}

// "sábado, 23h30" (aria-valuetext) para o dia de hoje e o minuto da régua
function textoDe(dia, min) {
  const t = ctx.ML.fmt.dia(dia) + ', ' + ctx.ML.fmt.hora(min);
  regua.setAttribute('aria-valuetext', t);
  return t;
}

// o visitante mexeu na régua: a parede desta seção acende (aberto nesse horário) ou apaga (fechado)
function simular(min) {
  simulando = true;
  const a = ctx.ML.horario.agora();
  const aberto = ctx.ML.horario.situacaoNo(a.dia, min).aberto;
  const t = textoDe(a.dia, min);
  sec.style.setProperty('--luz', aberto ? '1' : '.35'); // os mesmos valores de html[data-luz] (app.css)
  sec.setAttribute('data-sim', aberto ? 'aberto' : 'fechado');
  texto.textContent = t + ' · ' + (aberto ? 'aberto' : 'fechado');
  texto.className = 'noite__sim ' + (aberto ? 'aberto' : 'fechado');
  volta.classList.add('on');
}

// de volta ao agora: a parede segue o estado real (html[data-luz]) e a régua, o relógio
function desfazer() {
  simulando = false;
  sec.style.removeProperty('--luz');
  sec.removeAttribute('data-sim');
  texto.textContent = dica;
  texto.className = 'noite__sim';
  volta.classList.remove('on');
  tick();
}

// o trilho da régua: verde onde o truck abre naquele minuto (turno de hoje e a sobra da madrugada do turno de ontem)
function desenharFaixas(dia) {
  diaFaixas = dia;
  const H = ctx.ML.horario;
  const cortes = [[0, H.situacaoNo(dia, 0).aberto]];
  for (let m = PASSO; m <= MAX; m += PASSO) {
    const aberto = H.situacaoNo(dia, m).aberto;
    if (aberto !== cortes[cortes.length - 1][1]) cortes.push([m, aberto]);
  }
  const pos = (m) => ((m / MAX) * 100).toFixed(2) + '%';
  const partes = cortes.map((c, i) => (c[1] ? 'var(--neon-aberto)' : 'rgba(255,243,224,.14)') + ' ' + pos(c[0]) + ' ' + (i + 1 < cortes.length ? pos(cortes[i + 1][0]) : '100%'));
  regua.style.setProperty('--faixas', 'linear-gradient(90deg,' + partes.join(',') + ')');
}
