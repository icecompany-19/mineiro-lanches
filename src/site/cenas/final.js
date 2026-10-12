/* S9 · final (dono: site-I). Seção: section.s-final.parede, entre os marcadores [S9] do index.html.
   O HTML traz a parede, a placa (markup da bio, sem data-placa), a frase, o neon, os CTAs e o rodapé; src/app.js escreve o
   WhatsApp e o Instagram ([data-wa], [data-insta]) e o endereço e o horário do rodapé ([data-endereco], [data-horario-txt]) a
   partir do CONFIG. Aqui:
   - a frase do h2 é a do CONFIG (CONFIG.frases.fome);
   - o neon ([data-fim-status]) diz "O Mineiro tá aceso" com o truck aberto e "Volta às {hh}h. A chapa espera." fechado (a próxima
     abertura dos turnos, como no herói); com a pausa manual do truck, "Pausa na chapa." (o mesmo texto do herói, porque a volta
     dele não tem hora). Refeito no evento da loja e a cada virada de minuto, e só com a view do site no ar;
   - a placa reacende UMA vez ao entrar na tela: um IntersectionObserver põe .entra nela (o CSS faz a entrada: a arte pisca 2 vezes,
     o halo sobe, o anel aparece) e, 700 ms depois, o brilho passa uma vez (ML.app.passarBrilho). Movimento reduzido: placa estática. */
import { reduz } from '../base.js';

let montada = false;
let ctx = null;
let sec = null;
let neon = null;
let placa = null;
let acendeu = false;
let sai = null; // desliga a escuta da loja
let timer = 0;

export function iniciar(c) {
  const s = c.$('.s-final');
  if (!s) return;
  ctx = c;
  if (!montada) {
    montada = true;
    sec = s;
    montar();
  }
  ligar();
}

// a view do site saiu de cena: sem relógio nem escuta da loja rodando
export function parar() {
  if (sai) sai();
  sai = null;
  clearTimeout(timer);
  timer = 0;
}

function montar() {
  neon = ctx.$('[data-fim-status]', sec);
  placa = ctx.$('.placa', sec);
  frase();
  vigiarPlaca();
}

// a cada entrada no site: refaz o neon e liga a escuta da loja e o relógio de minuto
function ligar() {
  atualizar();
  if (!sai) {
    sai = ctx.ML.store.ouvir((ev) => {
      // os horários chegam com o estado do cardápio; o modo (aberta, fechada, auto) tem evento próprio
      if (ev && (ev.tipo === 'loja:modo' || ev.tipo === 'cardapio:estado')) atualizar();
    });
  }
  agendar();
}

function agendar() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    atualizar();
    agendar();
  }, 60000 - (Date.now() % 60000) + 50);
}

// ---------- textos ----------
// o HTML traz a mesma frase para quem chega sem JS; aqui ela passa a ser a do CONFIG
function frase() {
  const h2 = ctx.$('#fim-tit', sec);
  const txt = ctx.C.frases && ctx.C.frases.fome;
  if (h2 && txt && h2.textContent !== txt) h2.textContent = txt;
}

// a próxima abertura dos turnos, em minutos desde a meia-noite (hoje, se ainda não abriu; senão o próximo dia com turno)
function proximaAbertura() {
  const H = ctx.ML.horario;
  const a = H.agora();
  const hoje = H.turnos[a.dia];
  if (hoje && a.min < hoje.abre) return hoje.abre;
  for (let i = 1; i <= 7; i++) {
    const t = H.turnos[(a.dia + i) % 7];
    if (t) return t.abre;
  }
  return null;
}

// o neon: aberto, "O Mineiro tá aceso"; fechado, "Volta às {hh}h. A chapa espera."; pausa manual, "Pausa na chapa."
function atualizar() {
  if (!neon) return;
  const s = ctx.ML.horario.situacao();
  const loja = ctx.ML.store.loja();
  let txt;
  if (s.aberto) txt = 'O Mineiro tá aceso';
  else if (loja && loja.modo === 'fechada') txt = 'Pausa na chapa.';
  else {
    const min = proximaAbertura();
    txt = min == null ? 'Pausa na chapa.' : 'Volta às ' + ctx.ML.fmt.hora(min) + '. A chapa espera.';
  }
  if (neon.textContent !== txt) neon.textContent = txt;
  neon.classList.toggle('aberto', s.aberto);
  neon.classList.toggle('fechado', !s.aberto);
}

// ---------- placa ----------
// a placa reacende uma vez, quando mais da metade dela entra na tela (com a view escondida, no carregamento ocioso, nada entra)
function vigiarPlaca() {
  if (!placa || reduz() || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      acender();
    },
    { threshold: 0.6 }
  );
  io.observe(placa);
}

function acender() {
  if (acendeu || reduz()) return;
  acendeu = true;
  placa.classList.add('entra');
  setTimeout(() => ctx.app.passarBrilho(placa), 700);
}
