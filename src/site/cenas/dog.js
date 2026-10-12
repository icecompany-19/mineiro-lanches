/* S4 · hot dog: 1, 2 ou 3 salsichas (dono: site-II). Seção: section.s-dog, entre os marcadores [S4] do index.html.
   A foto 'nova' do primeiro de ROTEIRO.dog (hoje o Dog Max; o cliente pediu a mesma para os três tamanhos; o HTML já
   traz essa foto) fica parada e inteira. O radiogroup 1/2/3 escolhe Médio, Max ou Super (nomes, preços e a base vêm de
   ML.produtos); o preço rola como odômetro (WAAPI, translateY por dígito, 240 ms) e as salsichas, desenhadas em CSS,
   caem na bandeja com mola. "Adicionar" é a adição rápida do tamanho escolhido (ML.app.adicionarRapido, que põe o
   toast) e "Personalizar" abre a ficha. O preço escrito é [data-preco-de] do tamanho escolhido: o app o mantém igual
   ao do banco. O card do CBO Turbo é "Preço a confirmar": fora da sacola, só consulta no WhatsApp.
   Movimento reduzido: troca direta de preço e salsichas paradas. */
import { ROTEIRO, primeiroComFotoNova, temFotoNova } from '../roteiro.js';
import { reduz } from '../base.js';

const IDS = ['dog-medio', 'dog-max', 'dog-super'];
const CBO = 'dog-cbo-turbo';
const USO = '(min-width:880px) 440px, 90vw';
const MOLA = 'cubic-bezier(.34,1.56,.64,1)';
let montada = false;

export function iniciar(ctx) {
  const sec = ctx.$('.s-dog');
  if (!sec || montada) return;
  montada = true;
  // a gaveta #ficha mora dentro de #view-app, que fica escondido no site (e a gaveta com ele): sai de lá para aparecer
  const gaveta = document.getElementById('ficha');
  if (gaveta && gaveta.closest('#view-app')) document.body.append(gaveta);
  const P = ctx.ML.produtos;
  const $ = (s) => ctx.$(s, sec);
  const seg = $('.dog-seg');
  const opts = ctx.$$('[data-dog]', sec);
  const preco = $('#dog-preco');
  const bandeja = $('#dog-bandeja');
  const salsichas = ctx.$$('.dog-salsicha', bandeja);
  const add = $('#dog-add');
  const rot = $('#dog-add-rot');
  const cena = $('.dog-cena');
  let sel = 'dog-max';
  let mostrado = preco.textContent; // o texto do preço no repouso (durante o rolar o elemento tem dígitos a mais)
  let ficha = 0; // anula o fim de um rolar que ficou para trás

  // a foto: se o roteiro apontar para outro produto que o do HTML, troca; sem foto nova, só o texto
  const id = primeiroComFotoNova(ROTEIRO.dog);
  const dono = $('#dog-foto');
  if (!id) sec.classList.add('sem-foto');
  else if (dono.getAttribute('data-dog-foto') !== id) {
    dono.innerHTML = ctx.foto.visual(P[id], '540', null, { uso: USO, carga: 'lazy' });
    dono.setAttribute('data-dog-foto', id);
    ctx.foto.marcarCarregadas(sec);
  }

  const quantas = (p) => +(/(\d+) salsicha/.exec(p.base || '') || [0, 1])[1];

  // odômetro: cada dígito que mudou vira uma coluna (do menor ao maior) que sobe ou desce até o valor novo
  function rolar(de, para) {
    const k = ++ficha;
    if (reduz() || de.length !== para.length) {
      preco.textContent = para;
      return;
    }
    preco.textContent = '';
    const fim = [];
    Array.from(para).forEach((b, i) => {
      const a = de[i];
      if (a === b || !/\d/.test(a + b)) return preco.append(b);
      const x = Math.min(+a, +b);
      const n = Math.abs(+b - +a) + 1;
      const col = document.createElement('span');
      const fita = document.createElement('span');
      col.className = 'odo';
      col.setAttribute('aria-hidden', 'true');
      fita.className = 'odo-f';
      for (let d = 0; d < n; d++) fita.insertAdjacentHTML('beforeend', '<span>' + (x + d) + '</span>');
      col.append(fita);
      preco.append(col);
      const topo = '0em';
      const base = -(n - 1) + 'em';
      const sobe = +b > +a; // vai para os dígitos maiores, que estão embaixo na coluna
      fim.push(
        fita.animate([{ transform: 'translateY(' + (sobe ? topo : base) + ')' }, { transform: 'translateY(' + (sobe ? base : topo) + ')' }], {
          duration: 240,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: 'both'
        }).finished
      );
    });
    Promise.all(fim).then(
      () => {
        if (k === ficha) preco.textContent = para;
      },
      () => {}
    );
  }

  // as salsichas de de a ate-1 caem na bandeja com mola, escalonadas; as outras somem
  function cair(de, ate) {
    salsichas.forEach((s, i) => {
      s.classList.toggle('on', i < ate);
      if (i >= de && i < ate && !reduz())
        s.animate([{ transform: 'translateY(-130px) rotate(-7deg)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'none', opacity: 1 }], {
          duration: 560,
          delay: (i - de) * 90,
          easing: MOLA,
          fill: 'backwards'
        });
    });
  }

  // "Esgotado hoje" no botão e nas opções (o app abre a ficha, que explica)
  function disponibilidade() {
    opts.forEach((b) => b.classList.toggle('off', ctx.app.indisponivel(b.getAttribute('data-dog'))));
    const off = ctx.app.indisponivel(sel);
    add.classList.toggle('esgotado', off);
    rot.textContent = off ? 'Esgotado hoje' : 'Adicionar';
  }

  // o preço e a base do tamanho escolhido; o texto fixo do HTML segue o banco por [data-preco-de]
  function mostrar() {
    const p = P[sel];
    $('#dog-nome').textContent = p.nome;
    $('#dog-base').textContent = p.base;
    preco.setAttribute('data-preco-de', sel);
    ficha++;
    mostrado = ctx.brl(p.preco);
    preco.textContent = mostrado;
    disponibilidade();
  }

  function escolher(novo, falar) {
    if (!P[novo] || novo === sel) return;
    const antes = quantas(P[sel]);
    sel = novo;
    const p = P[sel];
    const i = IDS.indexOf(sel);
    seg.style.setProperty('--i', i);
    opts.forEach((b, k) => {
      b.setAttribute('aria-checked', String(k === i));
      b.tabIndex = k === i ? 0 : -1;
    });
    $('#dog-nome').textContent = p.nome;
    $('#dog-base').textContent = p.base;
    preco.setAttribute('data-preco-de', sel);
    const para = ctx.brl(p.preco);
    rolar(mostrado, para);
    mostrado = para;
    cair(antes, quantas(p));
    disponibilidade();
    if (falar) $('#dog-fala').textContent = p.nome + ', ' + p.base + ', ' + para;
  }

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dog]');
    if (b) escolher(b.getAttribute('data-dog'), true);
  });
  seg.addEventListener('keydown', (e) => {
    const passo = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? IDS.length - 1 : passo ? IDS.indexOf(sel) + passo : -1;
    if (i < 0 || i >= IDS.length) return;
    e.preventDefault();
    escolher(IDS[i], true);
    opts[i].focus();
  });
  add.addEventListener('click', () => ctx.app.adicionarRapido(sel, cena));
  $('#dog-pers').addEventListener('click', () => ctx.app.abrirFicha(sel, { origem: cena }));

  // o CBO Turbo: sem preço no CONFIG nem no banco, fica "Preço a confirmar" e consulta pelo WhatsApp; com preço, vira "Pedir"
  function cbo() {
    const p = P[CBO];
    const card = $('#dog-cbo');
    if (!p || p.inativo) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    card.classList.toggle('sem-foto', !temFotoNova(CBO));
    const tem = ctx.ML.regras.temPreco(p);
    $('#dog-cbo-preco').textContent = tem ? ctx.brl(p.preco) : 'Preço a confirmar';
    $('#dog-cbo-preco').classList.toggle('tem', tem);
    const wa = $('#dog-cbo-wa');
    wa.hidden = tem;
    wa.href = ctx.ML.whatsapp.link(ctx.ML.whatsapp.consulta(p));
    $('#dog-cbo-pedir').hidden = !tem;
    const comp = ctx.app.ingTexto(p);
    if ($('.dog-cbo__base').textContent !== comp) $('.dog-cbo__base').textContent = comp;
  }

  // a base comum dos três tamanhos e a dica (do CONFIG)
  const ings = (P['dog-max'].ing || []).map((x) => '<li>' + ctx.esc(x) + '</li>').join('');
  if ($('#dog-ings').innerHTML !== ings) $('#dog-ings').innerHTML = ings;
  if (P['dog-max'].nota) $('#dog-dica').textContent = P['dog-max'].nota;
  mostrar();
  cbo();
  ctx.ML.store.ouvir((ev) => {
    if (ev.tipo === 'cardapio:estado' || ev.tipo === 'cardapio:esgotados') {
      mostrar();
      cbo();
    }
  });

  // na primeira vez que a bandeja aparece, as salsichas caem (o HTML já as traz no lugar)
  if (!reduz() && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        cair(0, quantas(P[sel]));
      },
      { threshold: 0.6 }
    );
    io.observe(bandeja);
  }
}
