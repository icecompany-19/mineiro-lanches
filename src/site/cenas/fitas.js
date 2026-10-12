/* S1 · fitas de letreiro (dono: site-II). Seção: div.fitas, entre os marcadores [S1] do index.html.
   Duas faixas que correm em laço (translateX em CSS) e aceleram com a velocidade da rolagem (playbackRate, 1 a 6x):
   a = os produtos com foto 'nova' (o CONFIG manda; ★ entre eles); b = o prensado, o combo e o domingo do CONFIG.
   O HTML traz a mesma lista como reserva (paradas, sem CLS); aqui o texto só é refeito se mudou (o preço do combo vem
   do estado do banco) e cada trilho ganha uma cópia aria-hidden: o laço anda -50%, exatamente um grupo.
   Sem laço com movimento reduzido (o CSS cuida) e pausa fora da tela (.pausa, em site.js). */
import { registrar } from '../base.js';

let montada = false;

// os nomes do cardápio com foto 'nova', um por foto (dog-max serve a Médio, Max e Super: fica o Hot Dog Max)
function produtos(ctx) {
  const vistos = {};
  const nomes = [];
  ctx.C.categorias.forEach((c) =>
    c.itens.forEach((p) => {
      if (!p.foto || vistos[p.foto] || !ctx.foto.nova(p.foto)) return;
      vistos[p.foto] = 1;
      const dono = ctx.foto.produtoDe(p.foto) || p;
      if (!dono.inativo) nomes.push(dono.nome);
    })
  );
  return nomes;
}

// "à meia-noite", "à 1h", "às 23h" e "das 19h", "da 1h"
const fem = (min) => min % 1440 === 0 || (min % 1440 >= 60 && min % 1440 < 120);

// prensado, combo e domingo, do CONFIG (o combo e os horários podem vir do banco)
function avisos(ctx) {
  const C = ctx.C;
  const prensado = C.regras.prensado.texto;
  const dom = ctx.ML.horario.turnos[0];
  const hora = ctx.ML.fmt.hora;
  return [
    'Prensado? Avise antes: ' + prensado.charAt(0).toLowerCase() + prensado.slice(1),
    'Qualquer lanche vira combo +' + ctx.brl(C.regras.combo.preco),
    dom
      ? 'Domingo também, ' + (fem(dom.abre) ? 'da ' : 'das ') + hora(dom.abre) + (fem(dom.fecha) ? ' à ' : ' às ') + hora(dom.fecha)
      : C.horarioTexto.join(' · ')
  ];
}

// o trilho mostra a lista; é refeito (grupo + cópia aria-hidden) só se o texto mudou
function montar(ctx, trilho, lista) {
  // o grupo precisa passar da largura da tela: a lista se repete se a estimativa (por letra) ficar curta
  const largura = lista.reduce((s, t) => s + t.length * (window.innerWidth > 879 ? 22 : 15) + 56, 0);
  const n = Math.max(1, Math.ceil((window.screen.width * 1.05) / largura));
  const grupo = ctx.$('.fita__grupo', trilho);
  if (grupo && trilho.children.length > 1 && grupo.textContent === lista.join('').repeat(n)) return;
  const itens = lista.map((t) => '<span class="fita__item">' + ctx.esc(t) + '</span>').join('').repeat(n);
  trilho.innerHTML = '<span class="fita__grupo">' + itens + '</span><span class="fita__grupo" aria-hidden="true">' + itens + '</span>';
}

function atualizar(ctx, sec) {
  const nomes = produtos(ctx);
  const a = ctx.$('[data-fita="a"]', sec);
  const b = ctx.$('[data-fita="b"]', sec);
  if (a && nomes.length) montar(ctx, a, nomes);
  if (b) montar(ctx, b, avisos(ctx));
  sec.classList.add('pronta'); // o laço só corre com o trilho montado
}

export function iniciar(ctx) {
  const sec = ctx.$('.fitas');
  if (!sec || montada) return;
  montada = true;
  atualizar(ctx, sec);
  // o combo e o horário seguem o banco: refaz quando o estado do cardápio chega
  ctx.ML.store.ouvir((ev) => {
    if (ev.tipo === 'cardapio:estado') atualizar(ctx, sec);
  });
  const trilhos = ctx.$$('.fita__trilho', sec);
  // a velocidade da rolagem (px por quadro, suavizada no laço da base) vira o playbackRate da animação do trilho
  registrar(sec, {
    quadro(p, info) {
      const taxa = 1 + Math.min(info.vel / 6, 5);
      trilhos.forEach((tr) => {
        const an = tr.getAnimations()[0];
        if (an && an.playbackRate !== taxa) an.playbackRate = taxa;
      });
    }
  });
}
