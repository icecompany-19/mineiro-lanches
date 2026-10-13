/* S5 · vira combo + pilha de combos (dono: site-II). Seção: section.s-combos.parede, entre os marcadores [S5] do
   index.html. A parede acende quando a seção entra (.visivel, em CSS) com o véu sempre acima de .70 sob o texto. O neon
   "Qualquer lanche vira combo +R$ …" segue o combo do estado do banco; o inclui é [data-combo-inclui] (o app o
   mantém). Os chips são os lanches de foto 'nova' que podem virar combo (um por foto, com preço); "Escolher e virar
   combo" abre a ficha do chip escolhido com o combo ligado (ML.app.abrirFicha(id, { combo: true })).
   A pilha tem as cartas de ROTEIRO.combos, na ordem do roteiro e sem o Combo Casal (a foto dele está fora do cenário);
   as cartas ficam presas (sticky) e a coberta encolhe e escurece pelo --sob (0 a 1), que o laço de base.js escreve:
   transform e uma camada de opacidade, nunca filter. Os preços das cartas são [data-preco-de] (o app os mantém).
   Movimento reduzido: lista comum (o CSS solta as cartas e o laço não roda). */
import { ROTEIRO } from '../roteiro.js';
import { registrar } from '../base.js';

const FORA = ['combo-casal'];
let montada = false;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function iniciar(ctx) {
  const sec = ctx.$('.s-combos');
  if (!sec || montada) return;
  montada = true;
  const P = ctx.ML.produtos;
  const $ = (s) => ctx.$(s, sec);
  const box = $('#combo-chips');
  const pilha = $('#pilha');
  const marcado = ctx.$('[data-combo-de][aria-pressed="true"]', sec);
  let sel = marcado ? marcado.getAttribute('data-combo-de') : null;

  // os lanches de foto 'nova' que viram combo, um por foto (dog-max serve os três tamanhos: fica o Hot Dog Max)
  function lanches() {
    const vistos = {};
    const lista = [];
    ctx.C.categorias.forEach((c) =>
      c.itens.forEach((p) => {
        if (!p.foto || vistos[p.foto] || !ctx.foto.nova(p.foto)) return;
        vistos[p.foto] = 1;
        const d = ctx.foto.produtoDe(p.foto) || p;
        if (!d.inativo && ctx.ML.regras.podeCombo(d) && ctx.ML.regras.temPreco(d)) lista.push(d);
      })
    );
    return lista;
  }
  function marcar() {
    ctx.$$('[data-combo-de]', box).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-combo-de') === sel)));
  }
  // o HTML já traz os chips; só são refeitos se a lista mudou (preço ou item saindo do cardápio vêm do banco)
  function chips() {
    const lista = lanches();
    const atual = ctx.$$('[data-combo-de]', box).map((b) => b.getAttribute('data-combo-de'));
    if (lista.map((p) => p.id).join() !== atual.join()) {
      if (!lista.some((p) => p.id === sel)) sel = lista[0] ? lista[0].id : null;
      box.innerHTML = lista.map((p) => '<button type="button" class="chip" aria-pressed="false" data-combo-de="' + p.id + '">' + ctx.esc(p.nome) + '</button>').join('');
      marcar();
    }
    $('.combo-escolha').hidden = !lista.length;
  }

  // as cartas: na ordem do roteiro, sem o Casal nem o que saiu do cardápio; "Esgotado hoje" quando acabou
  function cartas() {
    const ordem = ROTEIRO.combos.filter((id) => !FORA.includes(id));
    const todas = ctx.$$('[data-carta]', pilha);
    ordem.forEach((id) => {
      const c = todas.find((x) => x.getAttribute('data-carta') === id);
      if (c) pilha.append(c);
    });
    let i = 0;
    ctx.$$('[data-carta]', pilha).forEach((c) => {
      const id = c.getAttribute('data-carta');
      const p = P[id];
      c.hidden = !ordem.includes(id) || !p || !!p.inativo;
      if (c.hidden) return;
      c.style.setProperty('--i', i++);
      const off = ctx.app.indisponivel(id);
      c.classList.toggle('off', off);
      const pedir = $('[data-abrir]', c);
      if (pedir) pedir.lastChild.textContent = off ? 'Esgotado hoje' : 'Pedir';
    });
  }
  function neon() {
    $('[data-neon-preco]').textContent = ctx.brl(ctx.C.regras.combo.preco);
  }

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-combo-de]');
    if (!b) return;
    sel = b.getAttribute('data-combo-de');
    marcar();
  });
  $('#combo-escolher').addEventListener('click', () => {
    if (sel) ctx.app.abrirFicha(sel, { combo: true });
  });

  neon();
  chips();
  cartas();
  ctx.ML.store.ouvir((ev) => {
    if (ev.tipo === 'cardapio:estado' || ev.tipo === 'cardapio:esgotados') {
      neon();
      chips();
      cartas();
    }
  });

  // a carta coberta pela próxima encolhe e escurece: --sob de 0 a 1 (lê todas as posições antes de escrever)
  registrar(sec, {
    semP: true,
    quadro() {
      const vis = ctx.$$('[data-carta]:not([hidden])', pilha);
      const topo = vis.map((c) => c.getBoundingClientRect().top);
      const alto = vis.map((c) => c.offsetHeight);
      vis.forEach((c, i) => {
        const sob = i + 1 < vis.length ? clamp01((topo[i] + alto[i] - topo[i + 1]) / alto[i]) : 0;
        const v = sob.toFixed(3);
        if (c.getAttribute('data-sob') !== v) {
          c.setAttribute('data-sob', v);
          c.style.setProperty('--sob', v);
        }
      });
    }
  });
}
