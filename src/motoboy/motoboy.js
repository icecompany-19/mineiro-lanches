/* Mineiro Lanche · tela do entregador (/motoboy/). Montada por src/painel/acesso.js (aoAbrir) depois do login.
   Três caminhos para marcar uma entrega, do mais rápido ao plano B:
   1. Link da comanda (/motoboy/#<id do pedido>), aberto pela câmera nativa do celular: ao abrir, o uuid do hash
      grava a confirmação na fila persistente e limpa o hash; o painel só muda após reconhecimento do servidor. Se o link chega antes do login, o uuid
      fica guardado e a confirmação sai logo depois de entrar.
   2. Botão "Ler QR da comanda": a câmera da própria tela (leitor.js) acha o uuid e confirma do mesmo jeito.
   3. Lista "Em rota", sem câmera: um botão "Entregue" em cada pedido (o toque é a confirmação).
   Usa as RPCs limitadas de entrega.js e a fila persistente de fila.js: sem store, sem Realtime. */
import {
  entregasEmRota,
  enviarConfirmacao,
  consultarEntregaMotoboy,
  reconhecerCancelamento,
  consultarTaxasEntrega,
  MENSAGENS
} from './entrega.js';
import { abrirArmazenamento, criarFila } from './fila.js';
import { criarLeitor, uuidDoTexto } from './leitor.js';
import { consultarOperacaoRotas } from './entrega.js';
import { montarOperacaoRotas } from './operacao-rotas.js';

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
        <p class="mb-marca">Mineiro Lanches · na rua</p>
        <h1 class="mb-titulo">Entregas</h1>
        <p class="mb-usuario">${esc(usuario.email || '')}</p>
      </div>
      <button type="button" class="pn-btn mb-sair" data-act="sair">Sair</button>
    </header>
    <section class="mb-giro" aria-label="Resumo da sua rota">
      <div class="mb-giro-cab"><p>Sua rota, na mão.</p><span class="mb-rede" data-rede>Conferindo conexão</span></div>
      <div class="mb-numeros"><div><b data-mb-rota>—</b><span>em entrega</span></div><div><b data-mb-espera>—</b><span>aguardando saída</span></div><div><b data-mb-fila>—</b><span>aguardando envio</span></div></div>
    </section>
    <section class="mb-taxas" aria-label="Suas taxas de entrega" data-taxas>
      <div class="mb-taxas-cab"><h2>Suas taxas de entrega</h2><label><span class="pn-sr">Período das taxas</span><select data-taxas-periodo><option value="1">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label></div>
      <div class="mb-taxas-valores"><p><span>Concluídas no período</span><b data-taxas-concluidas>—</b></p><p><span>Em aberto</span><b data-taxas-aberto>—</b></p></div>
      <p class="mb-taxas-estado" data-taxas-estado role="status" aria-live="polite">Consultando taxas…</p>
      <p class="mb-taxas-dica">Concluídas após recebimento pelo servidor; o dia vira às 4h. Em aberto inclui pedidos de qualquer data. Confirmações offline entram após o envio.</p>
    </section>
    <section class="mb-sync" aria-label="Sincronização">
      <div class="mb-sync-cab"><span class="mb-sync-icone">${ic('check')}</span><p data-sync role="status" aria-live="polite">Conferindo confirmações salvas…</p></div>
      <button type="button" class="pn-btn mb-sincronizar" data-act="sincronizar">${ic('relogio')}<span>Sincronizar agora</span></button>
      <p data-preparo>Preparando acesso sem internet…</p><div data-pendencias></div>
    </section>
    <section class="mb-res" data-res role="status" aria-live="polite" hidden></section>
    <div data-operacao-rotas></div>
    <button type="button" class="pn-btn pn-btn--prim mb-ler" data-act="ler-qr">${ic('completo')}<span>Ler QR da comanda</span>${ic('avancar')}</button>
    <section class="mb-leitor" data-leitor aria-label="Leitor de QR" hidden>
      <div class="mb-video-caixa"><video class="mb-video" data-video playsinline muted autoplay></video></div>
      <canvas data-canvas hidden></canvas>
      <p class="mb-dica" data-dica role="status"></p>
      <button type="button" class="pn-btn mb-fechar" data-act="fechar-leitor">Fechar câmera</button>
    </section>
    <section class="mb-rota" aria-labelledby="mb-rota-t">
      <div class="mb-rota-cab">
        <div><p class="mb-secao-label">Seus pedidos</p><h2 class="mb-rota-t" id="mb-rota-t">Em rota</h2></div>
        <button type="button" class="pn-btn" data-act="atualizar">${ic('relogio')} Atualizar</button>
      </div>
      <div class="mb-filtros" role="group" aria-label="Filtrar seus pedidos"><button type="button" data-act="filtrar" data-filtro="todos" aria-pressed="true">Todos <span data-mb-todos>0</span></button><button type="button" data-act="filtrar" data-filtro="rota" aria-pressed="false">Em entrega</button><button type="button" data-act="filtrar" data-filtro="fila" aria-pressed="false">No aparelho</button></div>
      <div data-lista></div>
    </section>
    <footer class="mb-retorno">${ic('info')}<p>Ao voltar, abra esta tela conectado e confira <b>Tudo sincronizado</b> antes de encerrar.</p></footer>
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
    filtro: 'todos',
    estado: 'carregando', // carregando | ok | erro
    carregando: false, // a consulta da lista está no ar
    erroLista: '',
    diasTaxas: 1,
    taxas: new Map(),
    consultasTaxas: new Set(),
    refazerTaxas: new Set(),
    errosTaxas: new Set(),
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
      if (
        t.pendencias.length &&
        !window.confirm('Há confirmações neste aparelho aguardando envio. Elas serão preservadas para este usuário. Sair mesmo assim?')
      )
        return;
      esconderMotoboy();
      el.innerHTML = '<p class="mb-vazio" role="status">Saindo…</p>';
      sair();
    } else if (acao === 'ler-qr') abrirLeitor(t);
    else if (acao === 'fechar-leitor') fecharLeitor(t);
    else if (acao === 'atualizar') {
      carregarLista(t);
      carregarTaxas(t, true);
    } else if (acao === 'sincronizar') sincronizar(t, true);
    else if (acao === 'filtrar') {
      t.filtro = b.dataset.filtro;
      el.querySelectorAll('[data-act="filtrar"]').forEach((btn) =>
        btn.setAttribute('aria-pressed', String(btn.dataset.filtro === t.filtro))
      );
      desenharLista(t);
    } else if (acao === 'conferir-cancelamento') {
      if (
        !window.confirm(
          'Você conferiu este cancelamento com a equipe? O pedido continuará cancelado e a ocorrência será registrada no servidor.'
        )
      )
        return;
      t.fila
        .reconhecerCancelamento(b.dataset.evento, (e) => reconhecerCancelamento(t.sb, e))
        .then(() => mostrarRes(t, { tipo: 'aviso', texto: 'Cancelamento conferido e registrado. O pedido continua cancelado.' }))
        .catch(() =>
          mostrarRes(t, {
            tipo: 'erro',
            mensagem: 'Não foi possível registrar a conferência. A confirmação permanece guardada neste aparelho.'
          })
        );
    } else if (acao === 'entregue') confirmar(t, b.dataset.id, 'lista', b);
    else if (acao === 'tentar') confirmar(t, b.dataset.id, 'link');
  };
  el.addEventListener('click', t.aoClicar);
  t.aoAlterar = (e) => {
    if (!e.target.matches('[data-taxas-periodo]')) return;
    t.diasTaxas = Number(e.target.value);
    carregarTaxas(t);
  };
  el.addEventListener('change', t.aoAlterar);
  aberta = t;
  t.operacao = montarOperacaoRotas(q('[data-operacao-rotas]'), {
    consultar: (nome, args) => consultarOperacaoRotas(sb, nome, args),
    armazenamento: t.armazenamento,
    pedidosCarregados: () => t.lista,
    pendencias: () => t.pendencias,
    cachePronto: () => !!t.cacheEm && !t.erroPreparo && !!navigator.serviceWorker?.controller,
    atualizarPedidos: () => carregarLista(t)
  });

  t.fila = criarFila({
    armazenamento: t.armazenamento,
    enviar: (e) => enviarConfirmacao(sb, e),
    aoMudar: (lista) => {
      if (aberta !== t) return;
      t.pendencias = lista;
      desenharSincronizacao(t);
      desenharLista(t);
    },
    aoConfirmar: (r) => {
      if (aberta !== t) return;
      t.entregues.add(r.pedido.id);
      t.lista = t.lista.filter((p) => p.id !== r.pedido.id);
      mostrarRes(t, { tipo: r.jaEntregue ? 'ja' : 'ok', pedido: r.pedido });
    }
  });
  t.retomar = () => {
    if (!document.hidden) sincronizar(t, true);
  };
  window.addEventListener('online', t.retomar);
  window.addEventListener('offline', t.retomar);
  window.addEventListener('focus', t.retomar);
  document.addEventListener('visibilitychange', t.retomar);
  t.intervalo = setInterval(() => {
    if (!document.hidden) sincronizar(t);
  }, 10000);
  t.relogio = setInterval(() => {
    if (!document.hidden) atualizarResumo(t);
  }, 1000);
  iniciar(t);
}

async function iniciar(t) {
  carregarTaxas(t);
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
    if (aberta === t)
      mostrarRes(t, {
        tipo: 'erro',
        mensagem: 'Não foi possível acessar o armazenamento do celular. Não confirme entregas neste aparelho até corrigir o problema.'
      });
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
  t.operacao?.parar();
  clearInterval(t.intervalo);
  clearInterval(t.relogio);
  window.removeEventListener('online', t.retomar);
  window.removeEventListener('offline', t.retomar);
  window.removeEventListener('focus', t.retomar);
  document.removeEventListener('visibilitychange', t.retomar);
  t.el.removeEventListener('click', t.aoClicar);
  t.el.removeEventListener('change', t.aoAlterar);
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
    if (!t.lista.some((p) => p.id === id) && navigator.onLine) await carregarLista(t);
    const p = t.lista.find((p) => p.id === id) || (navigator.onLine ? await consultarEntregaMotoboy(t.sb, id) : null);
    if (!p) throw new Error('Pedido não carregado ou não atribuído a você. Conecte o aparelho e confira com a equipe.');
    if (!['rota', 'entregue'].includes(p.status)) throw new Error('A equipe ainda não registrou a saída deste pedido.');
    await t.fila.adicionar(p);
    if (aberta !== t) return;
    mostrarRes(t, { tipo: 'aviso', texto: 'Confirmada neste aparelho — aguardando envio' });
    await sincronizar(t, true);
    if (origem === 'lista') window.scrollTo(0, 0);
  } catch (e) {
    if (aberta === t)
      mostrarRes(t, {
        tipo: 'erro',
        mensagem: e.mensagem || e.message || 'Não foi possível salvar a confirmação neste aparelho. Confira com a equipe.'
      });
  } finally {
    t.emVoo.delete(id);
    if (botao?.isConnected) botao.disabled = false;
  }
}

function desenharSincronizacao(t) {
  const esc = window.ML.fmt.esc;
  const n = t.pendencias.length;
  const atencao = t.pendencias.some((e) => e.estado === 'atencao');
  t.el.querySelector('.mb-sync').classList.toggle('mb-sync--pendente', n > 0);
  t.el.querySelector('.mb-sync').classList.toggle('mb-sync--atencao', atencao);
  const status = n
    ? `${n} ${n === 1 ? 'confirmação aguardando envio' : 'confirmações aguardando envio'}${atencao ? ' — confira as ocorrências abaixo' : ''}`
    : 'Tudo sincronizado';
  const texto = t.el.querySelector('[data-sync]');
  if (texto.textContent !== status) texto.textContent = status;
  const pendenciasHTML = t.pendencias
    .map((e) => {
      const p = t.lista.find((p) => p.id === e.id);
      return `<div class="mb-pendencia ${e.estado === 'atencao' ? 'pn-erro' : ''}"><b>${esc((p?.numero ?? e.numero) != null ? window.ML.fmt.numero(p?.numero ?? e.numero) : e.id)}</b><p>${esc(e.estado === 'atencao' ? MENSAGENS[e.codigo] || 'Confira com a equipe' : 'Confirmada neste aparelho — aguardando envio')}</p>${e.codigo === 'pedido_cancelado' ? `<button class="pn-btn" type="button" data-act="conferir-cancelamento" data-evento="${esc(e.evento)}">Conferi o cancelamento com a equipe</button>` : ''}</div>`;
    })
    .join('');
  if (t.pendenciasHTML !== pendenciasHTML) {
    t.el.querySelector('[data-pendencias]').innerHTML = pendenciasHTML;
    t.pendenciasHTML = pendenciasHTML;
  }
  const preparo = t.el.querySelector('[data-preparo]');
  preparo.textContent =
    t.erroPreparo ||
    (!navigator.onLine
      ? 'Sem internet. O painel só será atualizado após o envio.'
      : t.cacheEm && navigator.serviceWorker?.controller
        ? 'Pedidos carregados neste aparelho para consulta sem internet. Confira as pendências ao retornar.'
        : 'Mantenha esta tela aberta até concluir a preparação sem internet.');
  atualizarResumo(t);
}

function atualizarResumo(t) {
  if (aberta !== t) return;
  t.operacao?.render();
  const n = t.pendencias.length;
  t.el.querySelector('[data-mb-rota]').textContent = t.lista.filter(
    (p) => p.status === 'rota' && !t.pendencias.some((e) => e.id === p.id)
  ).length;
  t.el.querySelector('[data-mb-espera]').textContent = t.lista.filter((p) => p.status !== 'rota').length;
  t.el.querySelector('[data-mb-fila]').textContent = n;
  t.el.querySelector('[data-mb-todos]').textContent = t.lista.length;
  const rede = t.el.querySelector('[data-rede]');
  rede.textContent = !navigator.onLine ? 'Sem internet' : t.estado === 'erro' ? 'Sem contato com servidor' : 'Rede disponível';
  rede.classList.toggle('mb-rede--offline', !navigator.onLine || t.estado === 'erro');
  for (const el of t.el.querySelectorAll('[data-mb-tempo]')) {
    const ms = Math.max(0, Date.now() - new Date(el.dataset.mbTempo));
    const minutos = Math.floor(ms / 60000),
      segundos = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    el.textContent = `${minutos}:${segundos}`;
  }
}

async function sincronizar(t, forcar = false) {
  if (aberta !== t || t.sincronizando) return;
  t.sincronizando = true;
  const b = t.el.querySelector('[data-act="sincronizar"]');
  b.disabled = true;
  b.setAttribute('aria-busy', 'true');
  try {
    if (navigator.onLine) {
      await t.fila.sincronizar(forcar);
      if (!t.ultimaCarga || Date.now() - t.ultimaCarga > 30000 || forcar) {
        await carregarLista(t);
        carregarTaxas(t, forcar);
      }
    } else {
      await t.fila.listar();
      carregarTaxas(t);
    }
    if (aberta === t) {
      desenharSincronizacao(t);
      t.operacao?.atualizar();
    }
  } catch {
    if (aberta === t)
      mostrarRes(t, { tipo: 'erro', mensagem: 'Não foi possível acessar as confirmações salvas. Confira com a equipe antes de sair.' });
  } finally {
    t.sincronizando = false;
    b.disabled = false;
    b.setAttribute('aria-busy', 'false');
  }
}

async function carregarTaxas(t, forcar = false) {
  if (aberta !== t) return;
  const dias = t.diasTaxas;
  if (t.consultasTaxas.has(dias)) {
    if (forcar) t.refazerTaxas.add(dias);
    return;
  }
  t.consultasTaxas.add(dias);
  t.errosTaxas.delete(dias);
  desenharTaxas(t);
  try {
    if (!t.taxas.has(dias)) {
      const cache = await t.armazenamento.taxas(dias).catch(() => null);
      if (aberta !== t) return;
      if (cache) t.taxas.set(dias, cache);
      desenharTaxas(t);
    }
    if (!navigator.onLine || aberta !== t) return;
    const r = await consultarTaxasEntrega(t.sb, dias);
    if (aberta !== t) return;
    t.taxas.set(dias, r);
    // O valor recebido continua válido na tela se faltar espaço para guardar esta consulta.
    await t.armazenamento.guardarTaxas(dias, r).catch(() => {});
  } catch {
    t.errosTaxas.add(dias);
  } finally {
    t.consultasTaxas.delete(dias);
    desenharTaxas(t);
    if (t.refazerTaxas.delete(dias) && t.diasTaxas === dias) carregarTaxas(t);
  }
}

function desenharTaxas(t) {
  if (aberta !== t) return;
  const r = t.taxas.get(t.diasTaxas),
    taxas = r?.taxas,
    carregando = t.consultasTaxas.has(t.diasTaxas),
    erro = t.errosTaxas.has(t.diasTaxas);
  t.el.querySelector('[data-taxas]').setAttribute('aria-busy', String(carregando));
  t.el.querySelector('[data-taxas-concluidas]').textContent = taxas ? window.ML.fmt.brl(taxas.concluidas) : '—';
  t.el.querySelector('[data-taxas-aberto]').textContent = taxas ? window.ML.fmt.brl(taxas.emAberto) : '—';
  const dataHora = (v) =>
    new Date(v).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  const hora = r ? dataHora(r.servidorEm) : '';
  const semTaxa = (taxas?.semTaxaConcluidas || 0) + (taxas?.semTaxaEmAberto || 0);
  const estado = taxas
    ? `${taxas.qtdConcluidas} ${taxas.qtdConcluidas === 1 ? 'entrega concluída' : 'entregas concluídas'} desde ${dataHora(r.inicio)} · Consulta ${hora}.${!navigator.onLine ? ' Sem internet; valores da última consulta.' : erro ? ' Não foi possível atualizar; valores da última consulta.' : carregando ? ' Atualizando…' : ''}${semTaxa ? ` ${semTaxa} ${semTaxa === 1 ? 'pedido sem taxa registrada' : 'pedidos sem taxa registrada'}.` : ''}`
    : carregando
      ? 'Consultando taxas…'
      : 'Conecte-se e toque em Atualizar para consultar suas taxas.';
  const texto = t.el.querySelector('[data-taxas-estado]');
  if (texto.textContent !== estado) texto.textContent = estado;
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
function carregarLista(t) {
  if (t.promessaCarga) {
    t.recarregarDepois = true;
    return t.promessaCarga;
  }
  t.promessaCarga = (async () => {
    do {
      t.recarregarDepois = false;
      await carregarListaUmaVez(t);
    } while (t.recarregarDepois && aberta === t);
  })().finally(() => { t.promessaCarga = null; });
  return t.promessaCarga;
}
async function carregarListaUmaVez(t) {
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
    if (!e.codigo && navigator.onLine)
      t.erroPreparo = 'Não foi possível guardar os pedidos neste aparelho. Confira o armazenamento antes de sair.';
    t.erroLista = e.mensagem || 'Não foi possível carregar as entregas';
  }
  t.carregando = false;
  if (aberta === t) {
    desenharLista(t);
    desenharSincronizacao(t);
    t.operacao?.conferirCarga();
  }
}

function desenharLista(t) {
  if (aberta !== t) return;
  const { esc, brl, numero } = window.ML.fmt;
  t.atualizar.disabled = t.estado === 'carregando';
  atualizarResumo(t);
  // Uma consulta sem mudanças não substitui os controles que o entregador está usando.
  const assinatura = JSON.stringify([
    t.lista,
    t.pendencias.map((e) => [e.evento, e.estado, e.codigo]),
    t.filtro,
    t.estado === 'carregando' && t.lista.length ? 'ok' : t.estado,
    t.erroLista
  ]);
  if (t.assinaturaLista === assinatura) return;
  t.assinaturaLista = assinatura;
  if (t.estado === 'carregando' && !t.lista.length) {
    t.areaLista.innerHTML = '<p class="mb-vazio" role="status">Carregando as entregas…</p>';
    return;
  }
  if (t.estado === 'erro') {
    t.areaLista.innerHTML = `<p class="pn-erro mb-vazio" role="alert">${esc(t.erroLista)}</p>`;
    return;
  }
  if (!t.lista.length) {
    t.areaLista.innerHTML = `<div class="mb-vazio">${ic('check')}<p>Nenhuma entrega em rota agora.</p><span>Seus pedidos aparecem aqui quando a equipe atribuir a você ou quando você pegar um da fila da loja.</span></div>`;
    return;
  }
  const lista = t.lista.filter(
    (p) =>
      t.filtro === 'todos' ||
      (t.filtro === 'fila' ? t.pendencias.some((e) => e.id === p.id) : p.status === 'rota' && !t.pendencias.some((e) => e.id === p.id))
  );
  if (!lista.length) {
    t.areaLista.innerHTML = '<p class="mb-vazio">Nenhum pedido neste filtro. Toque em Todos para ver os demais.</p>';
    return;
  }
  t.areaLista.innerHTML =
    '<ul class="mb-lista">' +
    lista
      .map((p) => {
        const fone = p.telefone.replace(/\D/g, '');
        const pendencia = t.pendencias.find((e) => e.id === p.id);
        return `<li class="mb-item ${pendencia ? 'mb-item--pendente' : ''}" data-id="${esc(p.id)}" tabindex="-1">
          <div class="mb-item-cab"><span class="mb-item-num">${p.numero == null ? '' : esc(numero(p.numero))}</span><span class="mb-item-status">${pendencia ? 'No aparelho' : p.status === 'rota' ? 'Em entrega' : 'Aguardando saída'}</span>${p.status === 'rota' && p.saiuEm && !pendencia ? `<span class="mb-item-tempo">${ic('relogio')}<b data-mb-tempo="${esc(p.saiuEm)}"></b></span>` : ''}</div>
          <h3 class="mb-item-nome">${esc(p.nome)}</h3>
          ${p.endereco ? `<p class="mb-item-end">${ic('pino')}<span>${esc(p.endereco)}</span></p>` : ''}
          ${p.referencia ? `<p class="mb-item-ref"><b>Ref.:</b> ${esc(p.referencia)}</p>` : ''}
          ${p.obs ? `<p class="mb-item-obs"><b>Obs.:</b> ${esc(p.obs)}</p>` : ''}
          ${p.pagamentoNaEntrega && !p.pagamentoRecebidoEm && !p.pagamentoOnline ? `<p class="mb-item-obs"><b>Cobrar na entrega: ${esc(brl(p.total))}</b>${p.pagamento&&p.pagamento!=='Pagamento na entrega'?`<br>${esc(p.pagamento)}`:''}${p.troco?`<br>${p.troco==='Sem troco'?'Sem troco':'Troco para R$ '+esc(p.troco)}`:''}</p>` : p.pagamentoRecebidoEm ? '<p class="mb-item-obs">Pagamento já recebido pela loja</p>' : p.pagamentoOnline==='aprovado' ? '<p class="mb-item-obs">Pago no Mercado Pago</p>' : ''}
          <div class="mb-item-meta">${p.total == null ? '' : `<p class="mb-item-total">Total do pedido <b>${esc(brl(p.total))}</b></p>`}<p class="mb-item-saida">${p.status === 'rota' ? `Saída ${p.saiuEm ? esc(new Date(p.saiuEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })) : 'registrada'}` : 'Atribuído — aguardando saída'}</p></div>
          ${pendencia ? `<p class="mb-item-guardada" role="status">${ic('check')} Confirmada neste aparelho — aguardando envio</p>` : ''}
          <p class="pn-erro" role="alert" data-erro hidden></p>
          <div class="mb-item-acoes">
            ${fone.length >= 8 ? `<a class="pn-btn mb-ligar" href="tel:${esc(fone)}">Ligar</a>` : ''}
            <button type="button" class="pn-btn pn-btn--prim mb-entregue" data-act="entregue" data-id="${esc(p.id)}" ${pendencia || p.status !== 'rota' ? 'disabled' : ''}>${ic('check')}<span>Entregue</span></button>
          </div>
        </li>`;
      })
      .join('') +
    '</ul>';
  atualizarResumo(t);
}
