/* Mineiro Lanche · tela do entregador (/motoboy/). Montada por src/painel/acesso.js (aoAbrir) depois do login.
   Três caminhos para marcar uma entrega, do mais rápido ao plano B:
   1. Link da comanda (/motoboy/#<id do pedido>), aberto pela câmera nativa do celular: ao abrir, o uuid do hash
      grava a confirmação na fila persistente e limpa o hash; o painel só muda após reconhecimento do servidor. Se o link chega antes do login, o uuid
      fica guardado e a confirmação sai logo depois de entrar.
   2. Botão "Ler QR da comanda": a câmera da própria tela (leitor.js) acha o uuid e confirma do mesmo jeito.
   3. Lista "Em rota", sem câmera: um botão "Entregue" em cada pedido (o toque é a confirmação).
   Usa as RPCs limitadas de entrega.js e a fila persistente de fila.js: sem store, sem Realtime. */
import { entregasEmRota, enviarConfirmacao, consultarEntregaMotoboy, reconhecerCancelamento, MENSAGENS } from './entrega.js';
import { abrirArmazenamento, criarFila } from './fila.js';
import { criarLeitor, uuidDoTexto } from './leitor.js';

let pendente = null; // uuid do link que chegou antes de a tela abrir
let aberta = null; // estado da tela enquanto ela está montada

const ic = (n) => `<svg class="pn-ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;

function limparHash() {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* sem history: o hash fica na barra */
  }
}

// ---------- entrada: o hash da página ----------
// Chamado por main-motoboy.js antes do login.
export function prepararMotoboy() {
  lerHash();
  window.addEventListener('hashchange', lerHash);
}

function lerHash() {
  const id = uuidDoTexto(location.hash);
  if (!id) return;
  if (aberta) {
    limparHash();
    confirmar(aberta, id, 'link');
  } else {
    pendente = id; // o hash fica na barra até a confirmação: recarregar a página durante o login não perde o pedido
  }
}

// ---------- montagem ----------
export function montarMotoboy(el, usuario, { sb, sair }) {
  esconderMotoboy();
  const ML = window.ML;
  const esc = ML.fmt.esc;
  el.innerHTML = `<div class="mb-app">
    <header class="mb-topo">
      <img class="mb-logo" src="/assets/logo/selo-256.webp" alt="" width="48" height="48">
      <div class="mb-topo-t">
        <h1 class="mb-titulo">Entregas</h1>
        <p class="mb-usuario">${esc(usuario.email || '')}</p>
      </div>
      <button type="button" class="pn-btn mb-sair" data-act="sair">Sair</button>
    </header>
    <section class="mb-sync" aria-label="Sincronização">
      <p data-sync role="status" aria-live="polite">Conferindo confirmações salvas…</p>
      <button type="button" class="pn-btn" data-act="sincronizar">Sincronizar agora</button>
      <p data-preparo>Preparando acesso sem internet…</p><div data-pendencias></div>
    </section>
    <section class="mb-res" data-res role="status" aria-live="polite" hidden></section>
    <button type="button" class="pn-btn pn-btn--prim mb-ler" data-act="ler-qr">${ic('moto')}<span>Ler QR da comanda</span></button>
    <section class="mb-leitor" data-leitor aria-label="Leitor de QR" hidden>
      <div class="mb-video-caixa"><video class="mb-video" data-video playsinline muted autoplay></video></div>
      <canvas data-canvas hidden></canvas>
      <p class="mb-dica" data-dica role="status"></p>
      <button type="button" class="pn-btn mb-fechar" data-act="fechar-leitor">Fechar câmera</button>
    </section>
    <section class="mb-rota" aria-labelledby="mb-rota-t">
      <div class="mb-rota-cab">
        <h2 class="mb-rota-t" id="mb-rota-t">Em rota</h2>
        <button type="button" class="pn-btn" data-act="atualizar">Atualizar</button>
      </div>
      <div data-lista></div>
    </section>
  </div>`;

  const q = (s) => el.querySelector(s);
  const t = {
    el,
    sb,
    sair,
    usuario: usuario.id,
    armazenamento: abrirArmazenamento(usuario.id),
    fila: null,
    pendencias: [],
    lista: [],
    estado: 'carregando', // carregando | ok | erro
    carregando: false, // a consulta da lista está no ar
    erroLista: '',
    emVoo: new Set(),
    entregues: new Set(), // confirmados nesta tela: uma lista que chega atrasada não os traz de volta
    res: q('[data-res]'),
    areaLista: q('[data-lista]'),
    botaoLer: q('[data-act="ler-qr"]'),
    areaLeitor: q('[data-leitor]'),
    dica: q('[data-dica]'),
    atualizar: q('[data-act="atualizar"]'),
    leitor: null,
    aoClicar: null
  };
  t.leitor = criarLeitor({
    video: q('[data-video]'),
    canvas: q('[data-canvas]'),
    aoLer: (id) => {
      fecharLeitor(t);
      confirmar(t, id, 'qr');
    },
    aoNaoComanda: () => {
      t.dica.textContent = 'Esse QR não é de uma comanda do ' + ML.CONFIG.nome + '. Aponte para o QR da comanda.';
    },
    aoParar: () => {
      fecharLeitor(t);
      mostrarRes(t, {
        tipo: 'aviso',
        texto: 'A câmera foi desligada porque a tela saiu de cena. Toque em Ler QR da comanda para abrir de novo.'
      });
    }
  });
  t.aoClicar = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const acao = b.dataset.act;
    if (acao === 'sair') {
      if (t.pendencias.length && !window.confirm('Há confirmações neste aparelho aguardando envio. Elas serão preservadas para este usuário. Sair mesmo assim?')) return;
      esconderMotoboy();
      el.innerHTML = '<p class="mb-vazio" role="status">Saindo…</p>';
      sair();
    }
    else if (acao === 'ler-qr') abrirLeitor(t);
    else if (acao === 'fechar-leitor') fecharLeitor(t);
    else if (acao === 'atualizar') carregarLista(t);
    else if (acao === 'sincronizar') sincronizar(t, true);
    else if (acao === 'conferir-cancelamento') {
      if (!window.confirm('Você conferiu este cancelamento com a equipe? O pedido continuará cancelado e a ocorrência será registrada no servidor.')) return;
      t.fila.reconhecerCancelamento(b.dataset.evento, e => reconhecerCancelamento(t.sb, e))
        .then(() => mostrarRes(t, { tipo: 'aviso', texto: 'Cancelamento conferido e registrado. O pedido continua cancelado.' }))
        .catch(() => mostrarRes(t, { tipo: 'erro', mensagem: 'Não foi possível registrar a conferência. A confirmação permanece guardada neste aparelho.' }));
    }
    else if (acao === 'entregue') confirmar(t, b.dataset.id, 'lista', b);
    else if (acao === 'tentar') confirmar(t, b.dataset.id, 'link');
  };
  el.addEventListener('click', t.aoClicar);
  aberta = t;

  t.fila = criarFila({
    armazenamento: t.armazenamento,
    enviar: e => enviarConfirmacao(sb, e),
    aoMudar: lista => {
      if (aberta !== t) return;
      t.pendencias = lista;
      desenharSincronizacao(t);
      desenharLista(t);
    },
    aoConfirmar: r => {
      if (aberta !== t) return;
      t.entregues.add(r.pedido.id);
      t.lista = t.lista.filter(p => p.id !== r.pedido.id);
      mostrarRes(t, { tipo: r.jaEntregue ? 'ja' : 'ok', pedido: r.pedido });
    }
  });
  t.retomar = () => { if (!document.hidden) sincronizar(t, true); };
  window.addEventListener('online', t.retomar);
  window.addEventListener('offline', t.retomar);
  window.addEventListener('focus', t.retomar);
  document.addEventListener('visibilitychange', t.retomar);
  t.intervalo = setInterval(() => { if (!document.hidden) sincronizar(t); }, 10000);
  iniciar(t);
}

async function iniciar(t) {
  try {
    await t.fila.listar();
    const cache = await t.armazenamento.cache();
    if (aberta !== t) return;
    t.lista = cache.lista || [];
    t.cacheEm = cache.em;
    t.estado = 'ok';
    desenharLista(t);
    await carregarLista(t);
    await sincronizar(t);
  } catch {
    if (aberta === t) mostrarRes(t, { tipo: 'erro', mensagem: 'Não foi possível acessar o armazenamento do celular. Não confirme entregas neste aparelho até corrigir o problema.' });
  }
  if (pendente && aberta === t) {
    const id = pendente;
    pendente = null;
    limparHash();
    confirmar(t, id, 'link');
  }
}

// Chamado por acesso.js quando a sessão expira com a tela aberta (e antes de remontar).
export function esconderMotoboy() {
  const t = aberta;
  if (!t) return;
  aberta = null;
  t.leitor.parar();
  t.fila?.parar();
  clearInterval(t.intervalo);
  window.removeEventListener('online', t.retomar);
  window.removeEventListener('offline', t.retomar);
  window.removeEventListener('focus', t.retomar);
  document.removeEventListener('visibilitychange', t.retomar);
  t.el.removeEventListener('click', t.aoClicar);
  t.el.innerHTML = '';
}

// ---------- resultado (faixa grande no alto) ----------
function mostrarRes(t, r) {
  if (aberta !== t) return;
  const { esc, numero } = window.ML.fmt;
  let html;
  if (r.tipo === 'ok' || r.tipo === 'ja') {
    const p = r.pedido || {};
    html = `<p class="mb-res-t">${r.tipo === 'ok' ? 'Entregue' : 'Já estava entregue'}</p>
      ${p.numero != null ? `<p class="mb-res-num">${esc(numero(p.numero))}</p>` : ''}
      ${p.nome ? `<p class="mb-res-nome">${esc(p.nome)}</p>` : ''}`;
  } else if (r.tipo === 'erro') {
    html = `<p class="mb-res-t">${esc(r.mensagem)}</p>
      ${r.tentar ? `<button type="button" class="pn-btn pn-btn--prim mb-res-b" data-act="tentar" data-id="${esc(r.tentar)}">Tentar de novo</button>` : ''}`;
  } else {
    html = `<p class="mb-res-t">${esc(r.texto)}</p>`;
  }
  t.res.className = 'mb-res mb-res--' + r.tipo;
  t.res.setAttribute('role', r.tipo === 'erro' ? 'alert' : 'status');
  t.res.innerHTML = html;
  t.res.hidden = false;
}
function limparRes(t) {
  t.res.hidden = true;
  t.res.innerHTML = '';
}

// ---------- confirmar uma entrega ----------
// origem: 'link' (hash da página), 'qr' (leitor da tela) ou 'lista' (botão do pedido, em `botao`)
async function confirmar(t, id, origem, botao) {
  if (aberta !== t || t.emVoo.has(id)) return;
  t.emVoo.add(id);
  if (botao) botao.disabled = true;
  try {
    // QR recebido antes da carga: tenta obter a atribuição antes de gravar o evento.
    if (!t.lista.some(p => p.id === id) && navigator.onLine) await carregarLista(t);
    const p = t.lista.find(p => p.id === id) || (navigator.onLine ? await consultarEntregaMotoboy(t.sb, id) : null);
    if (!p) throw new Error('Pedido não carregado ou não atribuído a você. Conecte o aparelho e confira com a equipe.');
    if (!['rota', 'entregue'].includes(p.status)) throw new Error('A equipe ainda não registrou a saída deste pedido.');
    await t.fila.adicionar(p);
    if (aberta !== t) return;
    mostrarRes(t, { tipo: 'aviso', texto: 'Confirmada neste aparelho — aguardando envio' });
    await sincronizar(t, true);
    if (origem === 'lista') window.scrollTo(0, 0);
  } catch (e) {
    if (aberta === t) mostrarRes(t, { tipo: 'erro', mensagem: e.mensagem || e.message || 'Não foi possível salvar a confirmação neste aparelho. Confira com a equipe.' });
  } finally {
    t.emVoo.delete(id);
    if (botao?.isConnected) botao.disabled = false;
  }
}

function desenharSincronizacao(t) {
  const esc = window.ML.fmt.esc;
  const n = t.pendencias.length;
  const atencao = t.pendencias.some(e => e.estado === 'atencao');
  t.el.querySelector('[data-sync]').textContent = n
    ? `${n} ${n === 1 ? 'confirmação aguardando envio' : 'confirmações aguardando envio'}${atencao ? ' — confira as ocorrências abaixo' : ''}`
    : 'Tudo sincronizado';
  t.el.querySelector('[data-pendencias]').innerHTML = t.pendencias.map(e => {
    const p = t.lista.find(p => p.id === e.id);
    return `<p class="${e.estado === 'atencao' ? 'pn-erro' : ''}">${esc((p?.numero ?? e.numero) != null ? window.ML.fmt.numero(p?.numero ?? e.numero) : e.id)} · ${esc(e.estado === 'atencao' ? MENSAGENS[e.codigo] || 'Confira com a equipe' : 'Confirmada neste aparelho — aguardando envio')}</p>${e.codigo === 'pedido_cancelado' ? `<button class="pn-btn" type="button" data-act="conferir-cancelamento" data-evento="${esc(e.evento)}">Conferi o cancelamento com a equipe</button>` : ''}`;
  }).join('');
  const preparo = t.el.querySelector('[data-preparo]');
  preparo.textContent = t.erroPreparo || (!navigator.onLine
    ? 'Sem internet. O painel só será atualizado após o envio.'
    : t.cacheEm && navigator.serviceWorker?.controller
      ? 'Pedidos carregados neste aparelho para consulta sem internet. Confira as pendências ao retornar.'
      : 'Mantenha esta tela aberta até concluir a preparação sem internet.');
}

async function sincronizar(t, forcar = false) {
  if (aberta !== t || t.sincronizando) return;
  t.sincronizando = true;
  const b = t.el.querySelector('[data-act="sincronizar"]');
  b.disabled = true;
  try {
    if (navigator.onLine) {
      await t.fila.sincronizar(forcar);
      if (!t.ultimaCarga || Date.now() - t.ultimaCarga > 30000 || forcar) await carregarLista(t);
    } else await t.fila.listar();
    if (aberta === t) desenharSincronizacao(t);
  } catch {
    if (aberta === t) mostrarRes(t, { tipo: 'erro', mensagem: 'Não foi possível acessar as confirmações salvas. Confira com a equipe antes de sair.' });
  } finally {
    t.sincronizando = false;
    b.disabled = false;
  }
}

// ---------- leitor de QR ----------
async function abrirLeitor(t) {
  if (t.leitor.ativo) return;
  limparRes(t);
  t.botaoLer.hidden = true;
  t.areaLeitor.hidden = false;
  t.dica.textContent = 'Abrindo a câmera…';
  try {
    await t.leitor.iniciar();
    if (aberta === t && t.leitor.ativo) t.dica.textContent = 'Aponte a câmera para o QR da comanda.';
  } catch (e) {
    if (aberta !== t || t.areaLeitor.hidden) return; // fechou a câmera enquanto a permissão estava na tela
    fecharLeitor(t);
    mostrarRes(t, { tipo: 'erro', mensagem: e.mensagem || 'Não foi possível abrir a câmera' });
  }
}
function fecharLeitor(t) {
  if (aberta !== t) return;
  t.leitor.parar();
  t.areaLeitor.hidden = true;
  t.botaoLer.hidden = false;
}

// ---------- lista Em rota ----------
async function carregarLista(t) {
  if (t.carregando) return;
  t.carregando = true;
  t.estado = 'carregando';
  desenharLista(t);
  try {
    if (!navigator.onLine) throw new Error('Sem internet');
    const lista = await entregasEmRota(t.sb);
    if (aberta !== t) return;
    const carregada = lista.filter((p) => !t.entregues.has(p.id));
    await t.armazenamento.guardarCache(carregada);
    t.lista = carregada;
    t.erroPreparo = '';
    t.cacheEm = new Date().toISOString();
    t.ultimaCarga = Date.now();
    t.estado = 'ok';
  } catch (e) {
    t.estado = t.lista.length && !['sem_permissao', 'sessao'].includes(e.codigo) ? 'ok' : 'erro';
    if (!e.codigo && navigator.onLine) t.erroPreparo = 'Não foi possível guardar os pedidos neste aparelho. Confira o armazenamento antes de sair.';
    t.erroLista = e.mensagem || 'Não foi possível carregar as entregas';
  }
  t.carregando = false;
  if (aberta === t) { desenharLista(t); desenharSincronizacao(t); }
}

function desenharLista(t) {
  if (aberta !== t) return;
  const { esc, brl, numero } = window.ML.fmt;
  t.atualizar.disabled = t.estado === 'carregando';
  if (t.estado === 'carregando') {
    t.areaLista.innerHTML = '<p class="mb-vazio" role="status">Carregando as entregas…</p>';
    return;
  }
  if (t.estado === 'erro') {
    t.areaLista.innerHTML = `<p class="pn-erro mb-vazio" role="alert">${esc(t.erroLista)}</p>`;
    return;
  }
  if (!t.lista.length) {
    t.areaLista.innerHTML = '<p class="mb-vazio">Nenhuma entrega em rota agora.</p>';
    return;
  }
  t.areaLista.innerHTML =
    '<ul class="mb-lista">' +
    t.lista
      .map((p) => {
        const fone = p.telefone.replace(/\D/g, '');
        const pendencia = t.pendencias.find(e => e.id === p.id);
        return `<li class="mb-item" data-id="${esc(p.id)}">
          <div class="mb-item-cab"><span class="mb-item-num">${p.numero == null ? '' : esc(numero(p.numero))}</span><span class="mb-item-nome">${esc(p.nome)}</span></div>
          ${p.endereco ? `<p class="mb-item-end">${esc(p.endereco)}</p>` : ''}
          ${p.referencia ? `<p class="mb-item-ref"><b>Ref.:</b> ${esc(p.referencia)}</p>` : ''}
          ${p.obs ? `<p class="mb-item-obs"><b>Obs.:</b> ${esc(p.obs)}</p>` : ''}
          ${p.total == null ? '' : `<p class="mb-item-total">Total do pedido <b>${esc(brl(p.total))}</b></p>`}
          <p>${p.status === 'rota' ? `Em entrega · saída ${p.saiuEm ? esc(new Date(p.saiuEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) : 'registrada'}` : 'Atribuído — aguardando saída'}</p>
          ${pendencia ? '<p role="status">Confirmada neste aparelho — aguardando envio</p>' : ''}
          <p class="pn-erro" role="alert" data-erro hidden></p>
          <div class="mb-item-acoes">
            ${fone.length >= 8 ? `<a class="pn-btn mb-ligar" href="tel:${esc(fone)}">Ligar</a>` : ''}
            <button type="button" class="pn-btn pn-btn--prim mb-entregue" data-act="entregue" data-id="${esc(p.id)}" ${pendencia || p.status !== 'rota' ? 'disabled' : ''}>${ic('check')}<span>Entregue</span></button>
          </div>
        </li>`;
      })
      .join('') +
    '</ul>';
}
