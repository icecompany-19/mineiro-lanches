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
// Por que o motoboy ainda não pode pegar um pedido da fila (motivo de pedidos_disponiveis_entrega).
const MOTIVOS_FILA = {
  entrega_em_andamento: 'Você já saiu com pedidos. A fila fica aqui só para consulta; pegue outro depois de tocar em “Voltei à loja”.',
  despacho_desligado: 'Pegar pedidos pelo celular está pausado no painel. Peça à equipe para atribuir o pedido a você.',
  limite_viagem: 'Esta saída já tem 6 pedidos, o máximo por viagem.',
  reserva_expirada: 'O prazo da sua reserva terminou. Toque em Atualizar saída e confirme que está disponível na loja.',
  viagem_requer_revisao: 'A equipe precisa revisar sua saída antes de você pegar outro pedido.',
  entregador_em_viagem: 'Sua saída foi montada pela equipe. Peça à equipe para incluir outro pedido.',
  entregador_inativo: 'Seu cadastro de entregador está inativo. Fale com a equipe.'
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
    fila = null, // pedidos_disponiveis_entrega: { servidorEm, motivo, pedidos, emPreparo }
    filaFalhou = false,
    filaIndisponivel = false, // banco sem a RPC: a seção some em vez de acusar erro
    filaErro = '',
    filaAviso = '',
    filaContexto = '',
    filaAberta = true,
    versaoListaPedida = null,
    timer;
  const esc = window.ML.fmt.esc;
  const hora = (iso) =>
    new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  function textoFila(e, v) {
    if (!fila.motivo)
      return v?.estado === 'reservada'
        ? 'Toque em Pegar para levar junto nesta saída. A cada pedido acrescentado, o celular carrega a saída de novo antes de sair.'
        : 'Toque em Pegar para reservar o pedido para você. Depois confira a embalagem e registre a saída.';
    if (fila.motivo === 'entregador_indisponivel')
      return e?.qtdAbertas
        ? 'Conclua os pedidos já atribuídos a você para pegar outro.'
        : 'Informe acima que está disponível na loja para pegar um pedido.';
    return MOTIVOS_FILA[fila.motivo] || 'Agora não é possível pegar pedidos. Confira com a equipe.';
  }
  // Segunda lista da tela: pedidos prontos que ainda não têm entregador.
  function filaHTML(e, v, offline) {
    if (filaIndisponivel || (!fila && !filaFalhou && offline)) return '';
    const pedidos = fila?.pedidos || [];
    const pode = !!fila && !fila.motivo && !offline && !ocupado;
    const contexto = fila?.motivo === 'entrega_em_andamento' ? 'rua' : 'loja';
    if (contexto !== filaContexto) {
      // na rua a fila começa fechada, só para consulta; de volta à loja, aberta
      if (filaContexto) filaAviso = '';
      filaContexto = contexto;
      filaAberta = contexto === 'loja';
    }
    const preparo = fila?.emPreparo || 0;
    return `<details class="mb-disponiveis" data-v-fila ${filaAberta ? 'open' : ''}><summary data-v="fila"><span><span class="mb-secao-label">Fila da loja</span><b>Pedidos disponíveis</b></span><span class="mb-disp-qtd">${fila ? pedidos.length : '…'}</span></summary>
      ${
        !fila
          ? `<p>${filaFalhou ? 'Não foi possível consultar a fila. Toque em Atualizar saída.' : 'Consultando a fila da loja…'}</p>`
          : `
      <p class="mb-disp-estado">${esc(textoFila(e, v))}</p>
      <p class="mb-disp-aviso" role="status" ${filaAviso ? '' : 'hidden'}>${esc(filaAviso)}</p>
      <p class="mb-operacao-erro" role="alert" ${filaErro ? '' : 'hidden'}>${esc(filaErro)}</p>
      ${
        pedidos.length
          ? `<ul class="mb-disp-lista">${pedidos
              .map(
                (p) =>
                  `<li data-v-disp="${esc(p.id)}"><div><p class="mb-disp-cab"><b>${esc(window.ML.fmt.numero(p.numero))}</b>${p.prontoEm ? `<span>Pronto há <b data-mb-tempo="${esc(p.prontoEm)}"></b> min</span>` : ''}</p><p>${esc(p.endereco)}</p>${p.cobrarNaEntrega ? '<small>Cobrar na entrega</small>' : ''}</div><button type="button" class="pn-btn pn-btn--prim" data-v="pegar" data-v-id="${esc(p.id)}" data-v-numero="${esc(window.ML.fmt.numero(p.numero))}" aria-label="Pegar pedido ${esc(window.ML.fmt.numero(p.numero))}" ${pode ? '' : 'disabled'}>Pegar</button></li>`
              )
              .join('')}</ul>`
          : '<p class="mb-disp-vazio">Nenhum pedido pronto aguardando entregador agora.</p>'
      }
      ${preparo ? `<p class="mb-disp-preparo">Mais ${preparo} ${preparo === 1 ? 'pedido de entrega em preparo' : 'pedidos de entrega em preparo'} na cozinha.</p>` : ''}
      <p class="mb-operacao-consulta">Fila consultada ${esc(hora(fila.servidorEm))}${offline ? ' · Sem internet; mostrando a última consulta.' : filaFalhou ? ' · Não foi possível atualizar; mostrando a última consulta.' : ''}</p>`
      }
    </details>`;
  }
  function render() {
    if (!ativa) return;
    const v = dados?.viagem,
      e = dados?.entregador,
      offline = !navigator.onLine,
      n = pendencias().length;
    const proxima = v?.paradas.find((p) => !['entregue', 'cancelado'].includes(p.status) && !pendencias().some((e) => e.id === p.id));
    const bloqueado = ocupado || offline;
    const quantidade = v ? `${v.paradas.length} ${v.paradas.length === 1 ? 'pedido' : 'pedidos'}` : '';
    const estimativa =
      Number.isFinite(v?.metros) && Number.isFinite(v?.segundos)
        ? `${(v.metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km com retorno · ${Math.ceil(v.segundos / 60)} min estimados`
        : 'Distância e tempo não calculados';
    const html = `<section class="mb-operacao" data-v-operacao aria-label="Turno e viagem"><div class="mb-operacao-cab"><div><p class="mb-secao-label">${v ? 'Sua saída' : 'Seu turno'}</p><h2>${esc(e ? SITUACOES[e.situacao] || 'Indisponível' : 'Conferindo viagem…')}</h2></div><button type="button" class="pn-btn" data-v="atualizar" ${ocupado ? 'disabled' : ''}>Atualizar saída</button></div>
      ${dados ? `<p class="mb-operacao-consulta">Consulta ${esc(new Date(dados.servidorEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}${offline ? ' · Sem internet; mostrando a última consulta.' : ''}</p>` : ''}
      <p class="mb-operacao-erro" role="alert" ${erro ? '' : 'hidden'}>${esc(erro)}</p>
      ${
        !dados
          ? '<p>Abra esta tela conectado para consultar o turno e a viagem.</p>'
          : v
            ? `
        <div class="mb-viagem-resumo" data-v-tipo="${esc(v.tipoDespacho || 'rotas')}"><b>${quantidade} nesta saída</b><span>${estimativa}</span></div>
        ${v.estado === 'reservada' ? `<p data-v-carregamento>${carregada ? 'Pedidos carregados neste aparelho. Confira as embalagens e toque abaixo quando sair da loja.' : 'Carregando os pedidos neste aparelho. Aguarde antes de sair.'}</p>${v.revisaoPendente ? '<p class="mb-operacao-erro">A equipe precisa revisar esta viagem antes da saída.</p>' : ''}${offline ? '<p class="mb-operacao-erro">Conecte-se para registrar a saída. A entrega poderá ser confirmada sem internet depois.</p>' : ''}<button type="button" class="pn-btn pn-btn--prim" data-v="sair" ${bloqueado || !carregada || v.revisaoPendente || n ? 'disabled' : ''}>Sair com ${quantidade}</button>${v.reservaAte ? `<p class="mb-reserva">Reserva até ${esc(new Date(v.reservaAte).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))}. Se vencer sem saída, ${v.paradas.length === 1 ? 'o pedido volta' : 'os pedidos voltam'} à fila. Informe que está disponível para receber outra saída.</p>` : ''}` : ''}
        ${v.estado === 'em_rota' && proxima ? `<p class="mb-proxima">Próxima parada <b>${esc(window.ML.fmt.numero(proxima.numero))} · ${esc(proxima.nome)}</b></p><button type="button" class="pn-btn pn-btn--prim" data-v="pedido" data-v-id="${esc(proxima.id)}">Ver próxima entrega</button><p>Ao entregar, toque em “Entregue” no pedido. Sem internet, a confirmação fica guardada neste celular.</p>` : ''}
        ${v.estado === 'em_rota' && !proxima && n ? '<p class="mb-proxima">Todas as paradas foram confirmadas neste celular. Conecte-se e toque em “Sincronizar agora” antes de registrar o retorno.</p>' : ''}
        <details class="mb-viagem-detalhes" ${v.estado === 'reservada' ? 'open' : ''}><summary>Sequência de paradas</summary><ol class="mb-viagem-paradas">${v.paradas.map((p) => `<li class="${['entregue', 'cancelado'].includes(p.status) ? 'mb-parada-feita' : ''}"><span>${p.ordem}</span><div><b>${esc(window.ML.fmt.numero(p.numero))}</b><p>${esc(p.endereco)}</p><small>${p.status === 'entregue' ? 'Entregue' : p.status === 'cancelado' ? 'Cancelado' : pendencias().some((e) => e.id === p.id) ? 'Confirmada no aparelho — aguardando envio' : 'Parada da viagem'}</small></div><button type="button" class="pn-btn" data-v="pedido" data-v-id="${esc(p.id)}" aria-label="Ver pedido ${esc(window.ML.fmt.numero(p.numero))}" ${['entregue', 'cancelado'].includes(p.status) ? 'disabled' : ''}>Ver</button></li>`).join('')}</ol></details>
        <button type="button" class="pn-btn" data-v="mapa" ${!v.geometria || offline ? 'disabled' : ''}>Ver percurso da viagem</button>
        ${v.estado === 'retornando' ? `<p>As entregas chegaram ao servidor. Toque abaixo somente quando estiver de volta à loja.</p><button type="button" class="pn-btn pn-btn--prim" data-v="retornar" ${bloqueado || n ? 'disabled' : ''}>Voltei à loja</button>` : ''}
        ${n ? '<p>Sincronize as confirmações pendentes antes de sair novamente ou registrar o retorno.</p>' : ''}
      `
            : `<p>${e.qtdAbertas ? 'Você tem pedidos atribuídos. Confira as entregas e pendências abaixo antes de se declarar disponível.' : e.declarado === 'na_loja' ? (dados.despachoIndividualAtivo ? 'Você está disponível na loja. O próximo pedido aparecerá aqui automaticamente.' : 'Você informou que está na loja e pode receber uma viagem.') : 'Comece o turno quando estiver na loja, pronto para receber uma saída.'}</p>${offline ? '<p>Conecte-se para receber uma nova saída.</p>' : ''}<div class="mb-turno-acoes">${e.declarado !== 'na_loja' ? `<button type="button" class="pn-btn pn-btn--prim" data-v="na_loja" ${bloqueado || e.qtdAbertas || n ? 'disabled' : ''}>${e.declarado === 'fora' ? 'Começar turno' : 'Estou disponível na loja'}</button>` : `<button type="button" class="pn-btn" data-v="pausado" ${bloqueado ? 'disabled' : ''}>Pausar entregas</button>`}${e.declarado !== 'fora' ? `<button type="button" class="pn-btn" data-v="fora" ${bloqueado ? 'disabled' : ''}>Encerrar turno</button>` : ''}</div>`
      }
    </section>${filaHTML(e, v, offline)}`;
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
        const [r, f] = await Promise.all([consultar('minha_operacao_rotas'), lerFila()]);
        if (!ativa || g !== geracao) return;
        dados = r;
        erro = '';
        if (f) fila = f;
        await armazenamento.guardarOperacaoRotas(dados).catch(() => {});
        // Saída nova ou alterada: carrega os pedidos na hora, sem esperar a próxima carga da lista.
        const v = dados?.viagem;
        if (
          v &&
          v.versao !== versaoListaPedida &&
          !v.paradas.every((p) =>
            pedidosCarregados().some((l) => l.id === p.id && l.atribuicao === p.atribuicao && l.versaoViagem === v.versao)
          )
        ) {
          versaoListaPedida = v.versao;
          await atualizarPedidos();
          if (!ativa || g !== geracao) return;
        }
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
  // A fila não fica no aparelho: sem internet a tela mostra só a última consulta desta sessão.
  async function lerFila() {
    if (filaIndisponivel) return null;
    try {
      const f = await consultar('pedidos_disponiveis_entrega');
      filaFalhou = false;
      return { ...f, pedidos: Array.isArray(f?.pedidos) ? f.pedidos : [] };
    } catch (e) {
      if (['PGRST202', '42883'].includes(e?.causa?.code)) filaIndisponivel = true;
      else filaFalhou = true;
      return null;
    }
  }
  async function pegar(id, numero) {
    if (ocupado || !navigator.onLine) return;
    ocupado = true;
    geracao++;
    filaErro = '';
    filaAviso = '';
    render();
    try {
      await consultar('pegar_pedido_entrega', { p_id: id });
      filaAviso = `Pedido ${numero} reservado para você. Confira a embalagem e aguarde o celular carregar a saída.`;
      await atualizarPedidos();
    } catch (e) {
      filaErro =
        e?.codigo === 'pedido_indisponivel'
          ? 'Outro entregador pegou este pedido primeiro ou ele mudou. A fila foi atualizada.'
          : MOTIVOS_FILA[e?.codigo] || mensagemRota(e);
    } finally {
      ocupado = false;
    }
    await atualizar();
    render();
  }
  async function operar(nome, args) {
    if (ocupado || !navigator.onLine) return;
    ocupado = true;
    geracao++;
    erro = '';
    filaErro = '';
    filaAviso = '';
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
        filaErro = '';
        filaAviso = '';
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
      case 'pegar': {
        const numero = b.dataset.vNumero;
        const destino = v?.estado === 'reservada' ? 'levar junto nesta saída' : 'reservar para você';
        if (!window.confirm(`Pegar o pedido ${numero} para ${destino}?`)) return;
        return pegar(b.dataset.vId, numero);
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
  // toggle não borbulha: captura para lembrar se o motoboy abriu ou fechou a fila
  const alternar = (e) => {
    if (e.target.matches?.('[data-v-fila]')) filaAberta = e.target.open;
  };
  el.addEventListener('click', clicar);
  el.addEventListener('toggle', alternar, true);
  render();
  atualizar();
  // Na loja a reserva e a fila precisam aparecer na hora: consulta a cada 3 s com a tela visível; na rua, a cada 15 s.
  const agendar = () => {
    timer = setTimeout(
      async () => {
        if (!document.hidden) await atualizar();
        if (ativa) agendar();
      },
      ['em_rota', 'retornando'].includes(dados?.viagem?.estado) ? 15000 : 3000
    );
  };
  agendar();
  return {
    atualizar,
    conferirCarga,
    render,
    parar() {
      ativa = false;
      geracao++;
      clearTimeout(timer);
      el.removeEventListener('click', clicar);
      el.removeEventListener('toggle', alternar, true);
    }
  };
}
