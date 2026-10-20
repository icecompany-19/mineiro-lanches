import { mensagemRota } from '../lib/rotas-api.js';
import './operacao-rotas.css';

const SITUACOES = {
  na_loja: 'Na loja',
  fora: 'Fora do turno',
  pausado: 'Pausado',
  reservada: 'Aguardando saída',
  em_rota: 'Em rota',
  retornando: 'Retornando'
};
export function montarOperacaoRotas(el, { consultar, armazenamento, pedidosCarregados, pendencias, cachePronto, atualizarPedidos }) {
  let dados = null,
    ativa = true,
    lendo = false,
    ocupado = false,
    geracao = 0,
    erro = '',
    carregada = false,
    reconhecendo = false,
    versaoCacheLocal = null,
    assinatura = '',
    timer;
  const esc = window.ML.fmt.esc;
  function render() {
    if (!ativa) return;
    const v = dados?.viagem,
      e = dados?.entregador,
      offline = !navigator.onLine,
      n = pendencias().length;
    const proxima = v?.paradas.find((p) => !['entregue', 'cancelado'].includes(p.status) && !pendencias().some((e) => e.id === p.id));
    const bloqueado = ocupado || offline;
    const html = `<section class="mb-operacao" aria-label="Turno e viagem"><div class="mb-operacao-cab"><div><p class="mb-secao-label">${v ? 'Sua viagem' : 'Seu turno'}</p><h2>${esc(e ? SITUACOES[e.situacao] || 'Indisponível' : 'Conferindo viagem…')}</h2></div><button type="button" class="pn-btn" data-v="atualizar" ${ocupado ? 'disabled' : ''}>Recarregar viagem</button></div>
      ${dados ? `<p class="mb-operacao-consulta">Consulta ${esc(new Date(dados.servidorEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}${offline ? ' · Sem internet; mostrando a última consulta.' : ''}</p>` : ''}
      <p class="mb-operacao-erro" role="alert" ${erro ? '' : 'hidden'}>${esc(erro)}</p>
      ${
        !dados
          ? '<p>Abra esta tela conectado para consultar o turno e a viagem.</p>'
          : v
            ? `
        <div class="mb-viagem-resumo"><b>${v.paradas.length} paradas</b><span>${(v.metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km com retorno à loja</span></div>
        ${v.estado === 'reservada' ? `<p>${carregada ? 'Viagem carregada no aparelho. Confira os pedidos antes de sair.' : 'Carregando a viagem e os pedidos neste aparelho…'}</p>${v.revisaoPendente ? '<p class="mb-operacao-erro">A equipe precisa revisar esta viagem antes da saída.</p>' : ''}<button type="button" class="pn-btn pn-btn--prim" data-v="sair" ${bloqueado || !carregada || v.revisaoPendente || n ? 'disabled' : ''}>Registrar saída da viagem</button>` : ''}
        ${v.estado === 'em_rota' && proxima ? `<p class="mb-proxima">Próxima parada <b>${esc(window.ML.fmt.numero(proxima.numero))} · ${esc(proxima.nome)}</b></p><button type="button" class="pn-btn pn-btn--prim" data-v="pedido" data-v-id="${esc(proxima.id)}">Ver próxima entrega</button><p>Ao entregar, toque em “Entregue” no pedido. Sem internet, a confirmação fica guardada neste celular.</p>` : ''}
        ${v.estado === 'em_rota' && !proxima && n ? '<p class="mb-proxima">Todas as paradas foram confirmadas neste celular. Conecte-se e toque em “Sincronizar agora” antes de registrar o retorno.</p>' : ''}
        <details class="mb-viagem-detalhes" ${v.estado === 'reservada' ? 'open' : ''}><summary>Sequência de paradas</summary><ol class="mb-viagem-paradas">${v.paradas.map((p) => `<li class="${['entregue', 'cancelado'].includes(p.status) ? 'mb-parada-feita' : ''}"><span>${p.ordem}</span><div><b>${esc(window.ML.fmt.numero(p.numero))}</b><p>${esc(p.endereco)}</p><small>${p.status === 'entregue' ? 'Entregue' : p.status === 'cancelado' ? 'Cancelado' : pendencias().some((e) => e.id === p.id) ? 'Confirmada no aparelho — aguardando envio' : 'Parada da viagem'}</small></div><button type="button" class="pn-btn" data-v="pedido" data-v-id="${esc(p.id)}" aria-label="Ver pedido ${esc(window.ML.fmt.numero(p.numero))}" ${['entregue', 'cancelado'].includes(p.status) ? 'disabled' : ''}>Ver</button></li>`).join('')}</ol></details>
        <button type="button" class="pn-btn" data-v="mapa" ${!v.geometria || offline ? 'disabled' : ''}>Ver percurso da viagem</button>
        ${v.estado === 'retornando' ? `<p>As baixas chegaram ao servidor. Registre o retorno quando estiver de volta à loja.</p><button type="button" class="pn-btn pn-btn--prim" data-v="retornar" ${bloqueado || n ? 'disabled' : ''}>Retornei à loja</button>` : ''}
        ${n ? '<p>Sincronize as confirmações pendentes antes de sair novamente ou registrar o retorno.</p>' : ''}
      `
            : `<p>${e.qtdAbertas ? 'Você tem pedidos atribuídos. Confira as entregas e pendências abaixo antes de se declarar disponível.' : e.declarado === 'na_loja' ? 'Você informou que está na loja e pode receber uma viagem.' : 'Informe quando estiver na loja e disponível para uma saída.'}</p><div class="mb-turno-acoes">${e.declarado !== 'na_loja' ? `<button type="button" class="pn-btn pn-btn--prim" data-v="na_loja" ${bloqueado || e.qtdAbertas || n ? 'disabled' : ''}>${e.declarado === 'fora' ? 'Começar turno na loja' : 'Estou disponível na loja'}</button>` : `<button type="button" class="pn-btn" data-v="pausado" ${bloqueado ? 'disabled' : ''}>Pausar entregas</button>`}${e.declarado !== 'fora' ? `<button type="button" class="pn-btn" data-v="fora" ${bloqueado ? 'disabled' : ''}>Encerrar turno</button>` : ''}</div>`
      }
    </section>`;
    if (assinatura === html) return;
    const foco = el.contains(document.activeElement)
      ? { acao: document.activeElement.dataset.v, id: document.activeElement.dataset.vId }
      : null;
    const detalhes = el.querySelector('.mb-viagem-detalhes')?.open;
    el.innerHTML = html;
    assinatura = html;
    if (detalhes != null && el.querySelector('.mb-viagem-detalhes')) el.querySelector('.mb-viagem-detalhes').open = detalhes;
    if (foco?.acao)
      el.querySelector(`[data-v="${CSS.escape(foco.acao)}"]${foco.id ? `[data-v-id="${CSS.escape(foco.id)}"]` : ''}`)?.focus({
        preventScroll: true
      });
  }
  async function conferirCarga() {
    const v = dados?.viagem;
    const lista = pedidosCarregados();
    const completa =
      !!v &&
      cachePronto() &&
      v.paradas.every((p) => lista.some((l) => l.id === p.id && l.atribuicao === p.atribuicao && l.versaoViagem === v.versao));
    carregada = completa && versaoCacheLocal === v?.versao && v?.carregadaVersao === v?.versao;
    if (
      !v ||
      v.estado !== 'reservada' ||
      v.revisaoPendente ||
      carregada ||
      reconhecendo ||
      pendencias().length ||
      !navigator.onLine ||
      !cachePronto()
    )
      return render();
    if (!completa) return render();
    reconhecendo = true;
    try {
      await armazenamento.guardarOperacaoRotas(dados);
      versaoCacheLocal = v.versao;
      await consultar('reconhecer_carregamento_viagem', { p_id: v.id, p_versao: v.versao });
      if (!ativa || dados?.viagem?.id !== v.id || dados.viagem.versao !== v.versao) return;
      dados.viagem.carregadaVersao = v.versao;
      carregada = true;
      await armazenamento.guardarOperacaoRotas(dados);
    } catch (e) {
      erro = mensagemRota(e);
    } finally {
      reconhecendo = false;
    }
    render();
  }
  async function atualizar() {
    if (!ativa || lendo) return;
    lendo = true;
    const g = geracao;
    try {
      if (!dados) {
        dados = await armazenamento.operacaoRotas().catch(() => null);
        versaoCacheLocal = dados?.viagem?.versao || null;
      }
      if (!ativa || g !== geracao) return;
      render();
      if (navigator.onLine) {
        const r = await consultar('minha_operacao_rotas');
        if (!ativa || g !== geracao) return;
        dados = r;
        erro = '';
        await armazenamento.guardarOperacaoRotas(dados).catch(() => {});
      }
      await conferirCarga();
    } catch (e) {
      if (ativa) erro = mensagemRota(e);
    } finally {
      lendo = false;
      render();
      if (ativa && g !== geracao) atualizar();
    }
  }
  async function operar(nome, args) {
    if (ocupado || !navigator.onLine) return;
    ocupado = true;
    geracao++;
    erro = '';
    render();
    let erroEscrita = '';
    try {
      await consultar(nome, args);
      await atualizarPedidos();
    } catch (e) {
      erroEscrita = mensagemRota(e);
    } finally {
      ocupado = false;
    }
    await atualizar();
    erro = erroEscrita || erro;
    render();
  }
  async function clicar(e) {
    const b = e.target.closest('[data-v]');
    if (!b || ocupado) return;
    const v = dados?.viagem;
    switch (b.dataset.v) {
      case 'atualizar':
        await atualizarPedidos();
        return atualizar();
      case 'na_loja':
      case 'pausado':
      case 'fora':
        return operar('definir_disponibilidade_entregador', { p_situacao: b.dataset.v });
      case 'sair':
        if (!carregada || pendencias().length) return;
        return operar('iniciar_viagem_entrega', { p_id: v.id, p_versao: v.versao });
      case 'retornar':
        if (pendencias().length) return;
        return operar('retornar_viagem_entrega', { p_id: v.id, p_versao: v.versao });
      case 'pedido': {
        const seletor = `.mb-item[data-id="${CSS.escape(b.dataset.vId)}"]`;
        let item = document.querySelector(seletor);
        if (navigator.onLine && (!item || item.querySelector('button')?.disabled)) {
          await atualizarPedidos();
          await atualizar();
          item = document.querySelector(seletor);
        }
        if (item) {
          item.scrollIntoView({
            block: 'center',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
          });
          item.focus({ preventScroll: true });
        }
        return;
      }
      case 'mapa':
        try {
          const { abrirMapaViagem } = await import('../lib/mapa-viagem.js');
          abrirMapaViagem(v);
        } catch {
          erro = 'Não foi possível abrir o mapa. Confira a conexão.';
          render();
        }
    }
  }
  el.addEventListener('click', clicar);
  render();
  atualizar();
  timer = setInterval(() => {
    if (!document.hidden) atualizar();
  }, 30000);
  return {
    atualizar,
    conferirCarga,
    render,
    parar() {
      ativa = false;
      geracao++;
      clearInterval(timer);
      el.removeEventListener('click', clicar);
    }
  };
}
