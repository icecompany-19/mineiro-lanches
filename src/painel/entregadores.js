import { obterSupabase } from '../lib/supabase.js';
import './entregadores.css';
import { montarPlanejamento } from './rotas.js';
import { ERROS_ROTAS } from '../lib/rotas-api.js';

const ERROS = {
  ...ERROS_ROTAS,
  sem_permissao: 'Seu acesso não permite operar entregadores.',
  motivo_obrigatorio: 'Informe o motivo da baixa manual (até 200 caracteres).',
  entrega_em_andamento: 'Este pedido já saiu. Confira a entrega com o motoboy antes de encerrar.',
  entregador_inativo: 'Esse entregador está inativo. Atualize a lista.',
  transicao_invalida: 'O pedido mudou de situação. Atualize a lista.',
  nao_encontrado: 'Pedido não encontrado. Atualize a lista.'
};
const ic = (n) => `<svg class="pn-ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const emAberto = (p) => ['preparo', 'pronto', 'rota'].includes(p.status);
const normalizar = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const hora = (v) =>
  v
    ? new Date(v).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Sem registro';
const relogio = (v) =>
  v ? new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '—';
const duracao = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}h ` : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export async function consultarEntregadores(nome, args = {}) {
  const sb = await obterSupabase({ sessao: true });
  const ctl = new AbortController(),
    timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const { data, error } = await sb.rpc(nome, args).abortSignal(ctl.signal);
    if (error) throw error;
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export const minutosEntrega = (p) => {
  if (p.encerramento !== 'motoboy' || p.horarioInconsistente || !p.saiuEm || !p.confirmadoEm) return null;
  const ms = new Date(p.confirmadoEm) - new Date(p.saiuEm);
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
};

export function montarEntregadores(root, { consultar = consultarEntregadores } = {}) {
  const slots = [...root.querySelectorAll('[data-entregadores]')],
    esc = window.ML.fmt.esc;
  let dados = null,
    dias = 1,
    filtro = 'todos',
    etapa = 'atribuir',
    busca = '',
    limite = 12;
  let erro = '',
    aviso = '',
    aberto = false,
    ocupado = false,
    formulario = null,
    historico = null,
    atribuicaoConfirmada = false;
  let intervalo = null,
    tic = null,
    carregando = false,
    geracao = 0,
    desvio = 0,
    retorno = false;
  let pararEventos = null,
    atualizacaoAgendada = null,
    alertasAnteriores = '';
  const rascunhos = new Map(),
    atribuicoes = new Map();
  const planejamento = montarPlanejamento(
    slots.map(() => document.createElement('div')),
    {
      consultar,
      aoAlterar: () => {
        carregar();
        render();
      }
    }
  );
  let alerta = 45;
  try {
    const v = Number(localStorage.getItem('mineiro:v2:entregadores:alerta'));
    if (v >= 1 && v <= 1440) alerta = v;
  } catch {
    /* padrão */
  }
  const agora = () => Date.now() + desvio;
  const pedidos = () => dados?.pedidos || [];
  const longo = (p) => p.status === 'rota' && p.saiuEm && agora() - new Date(p.saiuEm) >= alerta * 60000;
  const filtrados = () => pedidos().filter((p) => filtro === 'todos' || (filtro === 'sem' ? !p.motoboyId : p.motoboyId === filtro));
  function entregadores() {
    const lista = [...(dados?.entregadores || [])];
    for (const p of pedidos())
      if (p.motoboyId && !lista.some((e) => e.id === p.motoboyId)) lista.push({ id: p.motoboyId, nome: p.motoboyNome, ativo: false });
    return lista;
  }
  const precisaAtribuir = (p) => emAberto(p) && !p.atribuicao && !p.motoboyId && !planejamento.viagemDoPedido(p.id);
  const contagem = (lista = filtrados()) => ({
    atribuir: lista.filter(precisaAtribuir).length,
    todos: lista.length,
    rota: lista.filter((p) => p.status === 'rota').length,
    espera: lista.filter((p) => ['preparo', 'pronto'].includes(p.status)).length,
    entregue: lista.filter((p) => p.status === 'entregue').length,
    atencao: lista.filter((p) => longo(p) || (emAberto(p) && !p.atribuicao)).length,
    anteriores: lista.filter((p) => p.legado).length
  });
  function kpi(tipo, titulo, icone, dica) {
    return `<button class="pn-ent-kpi pn-ent-kpi--${tipo}" type="button" data-e="etapa" data-etapa="${tipo}" data-e-key="kpi-${tipo}" aria-pressed="${etapa === tipo}"><span class="pn-ent-kpi-cab">${ic(icone)}${titulo}</span><strong data-e-contagem="${tipo}">${dados ? contagem()[tipo] : '—'}</strong><span class="pn-ent-kpi-dica">${dica}${ic('avancar')}</span></button>`;
  }
  function render() {
    const foco = document.activeElement,
      slotFoco = slots.findIndex((s) => s.contains(foco));
    const chaveFoco = foco?.dataset.eKey;
    const chaveRota = foco?.dataset.rKey;
    const detalhes = slots.map((s) => [...s.querySelectorAll('details[open]')].map((d) => d.dataset.eDetalhe));
    const c = contagem(),
      abertas = pedidos().filter(emAberto).length,
      legado = pedidos().filter((p) => p.legado).length;
    const total = c.entregue + c.rota + c.espera;
    const cabecalho = `
      <header class="pn-ent-cab">
        <div><p class="pn-ent-kicker">${ic('moto')} Operação de entregas</p><h2>Entregadores<span>.</span></h2><p class="pn-ent-sub">Cada saída, cada confirmação. Tudo à vista.</p></div>
        <div class="pn-ent-cab-acoes"><label class="pn-ent-periodo"><span>Período</span><select data-e-periodo data-e-key="periodo">${[
          [1, 'Hoje'],
          [7, 'Últimos 7 dias'],
          [30, 'Últimos 30 dias']
        ]
          .map(([v, t]) => `<option value="${v}" ${dias === v ? 'selected' : ''}>${t}</option>`)
          .join(
            ''
          )}</select></label><button class="pn-btn" type="button" data-e="organizar" data-e-key="organizar" ${!dados ? 'disabled' : ''}>${ic('moto')} Organizar saída</button><button class="pn-btn pn-ent-atualizar" type="button" data-e="atualizar" data-e-key="atualizar" ${ocupado ? 'disabled' : ''}>${ic('relogio')} Atualizar</button></div>
      </header>
      <div class="pn-ent-vivo"><span class="pn-ent-conexao" data-e-conexao>Consultando servidor…</span><span>Atualização automática a cada 15 s</span><span data-e-atualizado></span></div>
    `;
    const corpo = `<div class="pn-entregadores${etapa === 'atribuir' ? ' pn-entregadores--atribuir' : ''}">
      ${etapa !== 'atribuir' ? cabecalho : ''}
      <p class="pn-ent-erro" role="alert" ${erro ? '' : 'hidden'}>${ic('info')}${esc(erro)}</p><p class="pn-ent-aviso" role="status" aria-live="polite" ${aviso ? '' : 'hidden'}><span>${esc(aviso)}</span>${atribuicaoConfirmada ? '<button class="pn-btn" type="button" data-e="ver-atribuidos">Ver atribuídos</button>' : ''}</p>
      ${
        dados
          ? `
      <section class="pn-ent-central pn-ent-central--primeiro" aria-label="Central de entregas">
        <div class="pn-ent-secao-cab"><div><p class="pn-ent-kicker">${etapa === 'atribuir' ? 'Próxima ação' : 'Acompanhamento'}</p><h3>${etapa === 'atribuir' ? 'Atribuir motoboy' : 'Central de entregas'}</h3></div><button type="button" class="pn-btn" data-e="retorno" data-e-key="retorno">${ic('completo')} Conferir retorno</button></div>
        <div class="pn-entregadores-retorno" ${retorno ? '' : 'hidden'}><div>${ic('check')}<b>Conferência no retorno</b></div><p>Peça ao motoboy para abrir a tela conectado e conferir “Tudo sincronizado”. Há <b>${abertas} ${abertas === 1 ? 'entrega aberta' : 'entregas abertas'}</b> no sistema. Confira as pendências abaixo.</p><button class="pn-btn" type="button" data-e="fechar-retorno">Entendi</button></div>
        ${etapa === 'atribuir' ? '<p class="pn-ent-atribuir-dica">Escolha o entregador do pedido e toque em Atribuir.</p>' : ''}
        <div class="pn-ent-toolbar"><label class="pn-ent-busca">${ic('busca')}<span class="pn-sr">Buscar pedido ou cliente</span><input type="search" placeholder="Buscar pedido ou cliente" value="${esc(busca)}" data-e-busca data-e-key="busca"></label><label class="pn-ent-filtro"><span class="pn-sr">Entregador</span><select data-e-filtro data-e-key="filtro"><option value="todos">Todos os entregadores</option><option value="sem" ${filtro === 'sem' ? 'selected' : ''}>Sem atribuição</option>${entregadores()
          .map(
            (e) => `<option value="${esc(e.id)}" ${filtro === e.id ? 'selected' : ''}>${esc(e.nome)}${e.ativo ? '' : ' (inativo)'}</option>`
          )
          .join(
            ''
          )}</select></label><details class="pn-ent-ajustes" data-e-detalhe="ajustes"><summary aria-label="Ajustar alerta">${ic('config')} Alerta</summary><label>Alertar após (min)<input type="number" min="1" max="1440" value="${alerta}" required data-e-alerta data-e-key="alerta"></label><p>Limite interno de acompanhamento. Não é prazo de entrega.</p></details></div>
        <div class="pn-ent-etapas" role="group" aria-label="Filtrar situação">${[
          ['atribuir', 'Atribuir motoboy'],
          ['todos', 'Todas'],
          ['rota', 'Em entrega'],
          ['espera', 'Aguardando'],
          ['entregue', 'Concluídas'],
          ['atencao', 'Atenção'],
          ['anteriores', 'Anteriores']
        ]
          .map(
            ([v, t]) =>
              `<button type="button" data-e="etapa" data-etapa="${v}" data-e-key="etapa-${v}" aria-pressed="${etapa === v}">${t}<span data-e-contagem="${v}">${c[v]}</span></button>`
          )
          .join('')}</div>
        <div class="pn-ent-resultados"><p data-e-resultados></p><button type="button" data-e="limpar" data-e-key="limpar" ${filtro === 'todos' && ['todos', 'atribuir'].includes(etapa) && !busca ? 'hidden' : ''}>Limpar filtros</button></div>
        <div class="pn-entregadores-lista" data-e-lista></div>
      </section>
      `
          : ''
      }
      ${etapa === 'atribuir' ? cabecalho : ''}
      <section class="pn-ent-kpis" aria-label="Resumo das entregas">${kpi('rota', 'Em entrega', 'moto', 'Acompanhar em andamento')}${kpi('espera', 'Aguardando saída', 'sacola', 'Preparar próxima saída')}${kpi('entregue', 'Concluídas', 'check', 'Recebidas no período')}${kpi('atencao', 'Precisam de atenção', 'sino', 'Sem atribuição ou tempo alto')}</section>
      ${
        !dados
          ? `<div class="pn-ent-carregando" role="status">${ic('moto')}<p>Carregando entregadores…</p><span>Consultando a operação no servidor.</span></div>`
          : `
      <div class="pn-ent-progresso"><span><b>${c.entregue}</b> de ${total} entregas concluídas neste recorte</span><progress max="${Math.max(total, 1)}" value="${c.entregue}" aria-label="Entregas concluídas neste recorte"></progress><span>${total ? Math.round((c.entregue / total) * 100) : 0}%</span></div>
      ${legado ? `<div class="pn-ent-legado">${ic('info')}<p><b>${legado} ${legado === 1 ? 'entrega anterior recuperada' : 'entregas anteriores recuperadas'}.</b> O histórico foi preservado. O sistema anterior não identificava qual motoboy confirmou.</p><button type="button" data-e="anteriores" data-e-key="anteriores">Ver histórico anterior ${ic('avancar')}</button></div>` : ''}
      <section class="pn-ent-equipe" aria-label="Entregadores no período"><div class="pn-ent-secao-cab"><div><p class="pn-ent-kicker">Equipe de entrega</p><h3>Quem está com os pedidos</h3></div><span class="pn-ent-nota">Último contato recebido pelo sistema</span></div><div class="pn-entregadores-resumos">${
        entregadores()
          .map((e) => entregadorHTML(e))
          .join('') || '<p class="pn-ent-vazio">Nenhum entregador cadastrado. Administradores podem cadastrar em Usuários.</p>'
      }</div></section>
      <div data-planejamento-slot></div>
      <footer class="pn-ent-rodape"><p>${ic('info')} Confirmações offline aparecem após o envio. Última comunicação não indica localização ou disponibilidade.</p><details data-e-detalhe="indicadores"><summary>Como os indicadores são calculados</summary><p>Período a partir de ${esc(hora(dados.inicio))}; o dia operacional vira às 4h. Entregas abertas de qualquer data continuam visíveis. A média usa a saída e o horário consistente do celular; exclui baixas manuais e histórico anterior. O relógio do aparelho pode afetar a medida. Concluídas são contadas uma vez no recebimento pelo servidor; o histórico anterior usa o horário de conclusão já gravado.</p><p>Taxas concluídas somam as taxas de entrega dos pedidos atribuídos ao motoboy e concluídos no período, inclusive baixas manuais. Em aberto inclui pedidos atribuídos de qualquer data. Cancelamentos e entregas sem vínculo individual ficam fora. Taxas não registradas são sinalizadas; o total não presume um valor para elas.</p></details></footer>`
      }
      ${historico ? historicoHTML() : ''}
    </div>`;
    slots.forEach((el, i) => {
      el.innerHTML = corpo;
      el.querySelector('[data-planejamento-slot]')?.replaceWith(planejamento.hosts[i]);
      for (const d of el.querySelectorAll('details[data-e-detalhe]')) if (detalhes[i].includes(d.dataset.eDetalhe)) d.open = true;
    });
    atualizarLista();
    pulsar();
    if (chaveFoco && slotFoco >= 0)
      slots[slotFoco].querySelector(`[data-e-key="${CSS.escape(chaveFoco)}"]`)?.focus({ preventScroll: true });
    else if (chaveRota && slotFoco >= 0)
      slots[slotFoco].querySelector(`[data-r-key="${CSS.escape(chaveRota)}"]`)?.focus({ preventScroll: true });
  }
  function entregadorHTML(e) {
    const seus = pedidos().filter((p) => p.motoboyId === e.id),
      rotas = seus.filter((p) => p.status === 'rota').length;
    const abertas = seus.filter(emAberto).length,
      concluidas = seus.filter((p) => p.status === 'entregue').length;
    const validas = seus.map(minutosEntrega).filter((v) => v !== null),
      media = validas.length ? `${Math.round(validas.reduce((a, b) => a + b, 0) / validas.length)} min` : '—';
    const iniciais = (e.nome || 'Entregador')
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .slice(0, 2)
      .join('');
    const antigo = e.ultimaEm && agora() - new Date(e.ultimaEm) > 5 * 60000;
    const taxas = e.taxas,
      semTaxa = (taxas?.semTaxaConcluidas || 0) + (taxas?.semTaxaEmAberto || 0),
      valor = (v) => (typeof v === 'number' && Number.isFinite(v) ? esc(window.ML.fmt.brl(v)) : '—');
    return `<button type="button" class="pn-entregador-resumo" data-e="entregador" data-motoboy="${esc(e.id)}" data-e-key="moto-${esc(e.id)}" aria-pressed="${filtro === e.id}"><span class="pn-entregador-cab"><span class="pn-ent-avatar">${esc(iniciais)}</span><span><b>${esc(e.nome || 'Entregador')}</b><span class="pn-ent-cadastro">${e.ativo ? 'Cadastro ativo' : 'Cadastro inativo'}</span></span>${ic('avancar')}</span><span class="pn-entregador-numeros"><span><b>${rotas}</b>em entrega</span><span><b>${abertas}</b>abertas</span><span><b>${concluidas}</b>concluídas</span></span><span class="pn-entregador-taxas"><span>Taxas concluídas <b data-e-taxas="concluidas">${valor(taxas?.concluidas)}</b></span><span>Taxas em aberto <b data-e-taxas="aberto">${valor(taxas?.emAberto)}</b></span>${semTaxa ? `<span class="pn-ent-taxas-pendentes">${semTaxa} ${semTaxa === 1 ? 'pedido sem taxa registrada' : 'pedidos sem taxa registrada'}</span>` : ''}</span><span class="pn-entregador-base"><span>Tempo médio <b>${media}</b></span><span class="${antigo ? 'pn-ent-contato-antigo' : ''}" title="${esc(hora(e.ultimaEm))}">${ic('relogio')}<span>Última comunicação: ${e.ultimaEm ? esc(hora(e.ultimaEm)) : 'sem registro'}</span></span></span></button>`;
  }
  function visiveis() {
    const prioridade = (p) => (longo(p) ? 0 : p.status === 'rota' ? 1 : emAberto(p) ? 2 : p.status === 'entregue' ? 3 : 4);
    return filtrados()
      .filter((p) => {
        const situacao =
          etapa === 'todos' ||
          (etapa === 'atribuir'
            ? precisaAtribuir(p)
            : etapa === 'anteriores'
              ? p.legado
              : etapa === 'espera'
                ? ['preparo', 'pronto'].includes(p.status)
                : etapa === 'atencao'
                  ? longo(p) || (emAberto(p) && !p.atribuicao)
                  : p.status === etapa);
        return (
          situacao && normalizar(`${p.numero} ${window.ML.fmt.numero(p.numero)} ${p.nome} ${p.motoboyNome}`).includes(normalizar(busca))
        );
      })
      .sort(
        (a, b) =>
          prioridade(a) - prioridade(b) ||
          (emAberto(a)
            ? new Date(a.saiuEm || a.atribuidoEm || 0) - new Date(b.saiuEm || b.atribuidoEm || 0)
            : new Date(b.recebidoEm || 0) - new Date(a.recebidoEm || 0))
      );
  }
  function atualizarLista() {
    if (!dados) return;
    const lista = visiveis(),
      html = lista
        .slice(0, limite)
        .map((p) => (etapa === 'atribuir' ? atribuicaoHTML(p) : pedidoHTML(p)))
        .join('');
    for (const el of slots) {
      const area = el.querySelector('[data-e-lista]');
      if (!area) continue;
      area.innerHTML =
        html ||
        `<div class="pn-ent-vazio">${ic('check')}<h4>${etapa === 'atribuir' ? 'Nenhum pedido aguardando motoboy' : 'Nenhuma entrega neste filtro'}</h4><p>${etapa === 'atribuir' ? 'Pedidos em preparo ou prontos aparecem aqui quando precisam de um entregador. Use Aguardando para conferir os já atribuídos.' : 'Altere os filtros ou aguarde novas atribuições.'}</p></div>`;
      if (lista.length > limite)
        area.insertAdjacentHTML(
          'beforeend',
          `<button type="button" class="pn-btn pn-ent-mais" data-e="mais">Mostrar mais ${Math.min(12, lista.length - limite)} entregas (${lista.length - limite} restantes)</button>`
        );
      el.querySelector('[data-e-resultados]').textContent =
        `${lista.length} ${etapa === 'atribuir' ? (lista.length === 1 ? 'pedido para atribuir' : 'pedidos para atribuir') : lista.length === 1 ? 'entrega encontrada' : 'entregas encontradas'}${filtro !== 'todos' ? ' neste entregador' : ''}`;
      el.querySelector('[data-e="limpar"]').hidden = filtro === 'todos' && ['todos', 'atribuir'].includes(etapa) && !busca;
    }
    pulsar();
  }
  function formularioAtribuicao(p) {
    const num = window.ML.fmt.numero(p.numero),
      chave = esc(p.id);
    const ativos = entregadores().filter((e) => e.ativo);
    return `<form data-e-form="atribuir"><label><span>Entregador do ${esc(num)}</span><select name="motoboy" required data-e-key="atribuir-${chave}" ${ocupado || !ativos.length ? 'disabled' : ''}><option value="">Selecionar entregador</option>${ativos.map((e) => `<option value="${esc(e.id)}" ${(atribuicoes.get(p.id) || p.motoboyId) === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></label><button class="pn-btn pn-ent-prim" ${ocupado || !ativos.length ? 'disabled' : ''}>${p.atribuicao ? 'Atualizar atribuição' : 'Atribuir'}</button></form>${!ativos.length ? '<p class="pn-ent-origem">Cadastre ou ative um motoboy em Usuários para atribuir este pedido.</p>' : ''}`;
  }
  function atribuicaoHTML(p) {
    return `<article class="pn-entrega pn-ent-atribuir-pedido" data-entrega="${esc(p.id)}"><div class="pn-ent-atribuir-cliente"><span class="pn-entrega-numero">${esc(window.ML.fmt.numero(p.numero))}</span><h4>${esc(p.nome)}</h4><p>${p.status === 'preparo' ? 'Em preparo' : p.status === 'pronto' ? 'Pronto para entrega' : 'Em entrega, sem motoboy'}</p></div><div class="pn-entrega-acoes">${formularioAtribuicao(p)}</div></article>`;
  }
  function pedidoHTML(p) {
    const viagem = planejamento.viagemDoPedido(p.id);
    const num = window.ML.fmt.numero(p.numero),
      espera = ['preparo', 'pronto'].includes(p.status);
    const status =
      p.status === 'rota'
        ? 'Em entrega'
        : p.status === 'entregue'
          ? 'Entregue'
          : p.status === 'cancelado'
            ? 'Cancelado'
            : 'Aguardando saída';
    const etapas = [
      ['Atribuição', p.atribuidoEm],
      ['Saída', p.saiuEm],
      ['Conclusão', p.recebidoEm]
    ];
    const chave = esc(p.id);
    return `<article class="pn-entrega ${longo(p) ? 'pn-entrega--alerta' : ''}" data-entrega="${chave}">
      <div class="pn-entrega-topo"><span class="pn-entrega-numero">${esc(num)}</span><span class="pn-ent-status pn-ent-status--${esc(p.status)}">${ic(p.status === 'rota' ? 'moto' : p.status === 'entregue' ? 'check' : 'relogio')}${status}</span>${p.status === 'rota' ? `<span class="pn-ent-cronometro">${ic('relogio')}<b data-e-tempo="${chave}">${p.saiuEm ? duracao(agora() - new Date(p.saiuEm)) : 'Sem saída registrada'}</b></span>` : ''}</div>
      <div class="pn-entrega-principal"><div class="pn-entrega-cliente"><h4>${esc(p.nome)}</h4><p>${ic('moto')}${esc(p.motoboyNome || 'Sem entregador identificado')}${p.legado ? '<span class="pn-ent-tag">Histórico anterior</span>' : ''}</p></div><ol class="pn-ent-timeline" aria-label="Etapas da entrega">${etapas.map(([t, v]) => `<li class="${v ? 'pn-ent-passou' : ''}"><span></span><small>${t}</small><b>${esc(relogio(v))}</b></li>`).join('')}</ol></div>
      <p class="pn-ent-alerta" data-e-alerta-pedido ${longo(p) ? '' : 'hidden'}>${ic('sino')} Entrega aberta há muito tempo — confira com o entregador.</p>
      ${emAberto(p) && !p.atribuicao ? '<p class="pn-ent-sem">Atribua um entregador para liberar a confirmação no celular.</p>' : ''}
      ${p.legado ? '<p class="pn-ent-origem">Confirmada antes do novo controle. Sem vínculo individual de entregador.</p>' : ''}
      ${viagem ? `<p class="pn-ent-origem">Pedido em viagem planejada. Confira a sequência e a saída em “Viagens e rotas”.</p>` : ''}
      ${p.recebidoEm ? `<p class="pn-ent-origem">Recebida pelo servidor: ${esc(hora(p.recebidoEm))}${p.encerramento === 'manual' ? ' · Baixa manual' : ''}</p>` : ''}
      ${p.confirmadoEm ? `<p class="pn-ent-origem">Confirmada no aparelho: ${esc(hora(p.confirmadoEm))}${p.horarioInconsistente ? ' · horário inconsistente, fora da média' : ''}</p>` : ''}
      ${p.motivo ? `<p class="pn-ent-motivo">${ic('info')} ${esc(p.motivo)}</p>` : ''}
      <div class="pn-entrega-acoes">
        ${emAberto(p) && !viagem && (!p.atribuicao || !p.saiuEm) ? formularioAtribuicao(p) : ''}
        ${espera && !viagem && p.atribuicao && !p.saiuEm ? `<button class="pn-btn pn-ent-prim" type="button" data-e="sair" data-e-key="sair-${chave}" ${ocupado ? 'disabled' : ''}>${ic('moto')} Registrar saída ${esc(num)}</button>` : ''}
        <div class="pn-entrega-secundarias">${p.status === 'rota' ? `<button class="pn-btn pn-ent-discreto" type="button" data-e="manual" data-e-key="manual-${chave}" ${ocupado ? 'disabled' : ''}>${ic('check')} Baixa manual ${esc(num)}</button>` : ''}<button class="pn-btn pn-ent-discreto" type="button" data-e="historico" data-e-key="historico-${chave}" ${ocupado ? 'disabled' : ''}>${ic('lista')} Histórico ${esc(num)}</button></div>
      </div>
      ${formulario === p.id ? `<form class="pn-entrega-baixa" data-e-form="manual"><div><h4>Confirmar baixa manual</h4><p>A baixa fica registrada com seu usuário e será preservada na sincronização posterior.</p></div><label>Motivo da baixa manual ${esc(num)}<input name="motivo" required maxlength="200" minlength="3" autocomplete="off" value="${esc(rascunhos.get(p.id) || '')}" data-e-key="motivo-${chave}"></label><div><button class="pn-btn pn-ent-prim" ${ocupado ? 'disabled' : ''}>Confirmar baixa manual</button><button class="pn-btn" type="button" data-e="cancelar">Voltar</button></div></form>` : ''}
    </article>`;
  }
  function historicoHTML() {
    const tipos = {
      atribuicao: 'Entregador atribuído',
      saida: 'Saída registrada',
      reabertura: 'Entrega reaberta para a rota',
      saida_preservada: 'Horário original de saída preservado',
      motoboy: 'Entrega encerrada pelo motoboy',
      confirmacao: 'Confirmação recebida',
      manual: 'Baixa manual',
      cancelado: 'Pedido cancelado',
      confirmacao_posterior: 'Confirmação posterior preservada',
      cancelamento_conferido: 'Cancelamento conferido',
      viagem_desfeita: 'Viagem desfeita para replanejamento',
      planejamento_liberado: 'Pedido liberado para planejamento',
      destino_conferido: 'Ponto de entrega conferido pela equipe'
    };
    const responsavel = (e) =>
      e.dados?.origem === 'planejamento_automatico'
        ? 'Distribuição automática do sistema'
        : e.dados?.origem === 'ajuste_operacional_assistido'
          ? 'Suporte técnico · solicitação do responsável'
          : e.responsavel;
    return `<section class="pn-entrega-historico" aria-label="Histórico da entrega" tabindex="-1"><div class="pn-ent-secao-cab"><div><p class="pn-ent-kicker">Rastreabilidade</p><h3>Histórico ${esc(historico.numero)}</h3></div><button class="pn-btn" type="button" data-e="fechar-historico">${ic('x')} Fechar histórico</button></div><ol>${historico.eventos.map((e) => `<li><span class="pn-ent-evento-ponto"></span><div><b>${esc(tipos[e.tipo] || e.tipo)}</b><time>${esc(hora(e.em))}</time><p>Responsável: ${esc(responsavel(e))}</p>${e.dados?.motivo ? `<p>Motivo: ${esc(e.dados.motivo)}</p>` : ''}${e.dados?.nome ? `<p>Entregador: ${esc(e.dados.nome)}</p>` : ''}${e.dados?.confirmadoEm ? `<p>Confirmado no aparelho: ${esc(hora(e.dados.confirmadoEm))}</p>` : ''}</div></li>`).join('') || '<li>Sem eventos do novo controle para este pedido. Os horários originais estão no cartão da entrega.</li>'}</ol></section>`;
  }
  // Cronômetros mudam sem recriar os cartões nem interromper quem está preenchendo um formulário.
  function pulsar() {
    const alertas = filtrados()
      .filter(longo)
      .map((p) => p.id)
      .join('|');
    if (alertas !== alertasAnteriores) {
      alertasAnteriores = alertas;
      if (etapa === 'atencao' && !formulario) atualizarLista();
    }
    const c = contagem();
    for (const el of slots) {
      el.querySelectorAll('[data-e-tempo]').forEach((no) => {
        const p = pedidos().find((p) => p.id === no.dataset.eTempo);
        if (!p?.saiuEm) return;
        no.textContent = duracao(agora() - new Date(p.saiuEm));
        const card = no.closest('[data-entrega]');
        card.classList.toggle('pn-entrega--alerta', !!longo(p));
        card.querySelector('[data-e-alerta-pedido]').hidden = !longo(p);
      });
      el.querySelectorAll('[data-e-contagem]').forEach((n) => {
        n.textContent = dados ? c[n.dataset.eContagem] : '—';
      });
      const conexao = el.querySelector('[data-e-conexao]');
      if (conexao) {
        conexao.textContent = erro
          ? 'Conexão pendente'
          : carregando
            ? 'Atualizando dados…'
            : dados
              ? 'Dados recebidos do servidor'
              : 'Consultando servidor…';
        conexao.classList.toggle('pn-ent-conexao--erro', !!erro);
      }
      const atualizado = el.querySelector('[data-e-atualizado]');
      if (atualizado) atualizado.textContent = dados ? `Última atualização ${relogio(dados.servidorEm)}` : '';
    }
  }
  async function carregar(silencioso = false) {
    if (carregando || ocupado || !aberto) return;
    carregando = true;
    pulsar();
    const g = geracao;
    try {
      const r = await consultar('painel_entregadores', { p_dias: dias });
      if (!aberto || g !== geracao) return;
      const mudou = JSON.stringify([r.pedidos, r.entregadores]) !== JSON.stringify([dados?.pedidos, dados?.entregadores]);
      dados = r;
      desvio = new Date(r.servidorEm).getTime() - Date.now();
      erro = '';
      const escrevendo = slots.some((el) => el.contains(document.activeElement) && document.activeElement.matches('input,select'));
      if (!silencioso || (mudou && !escrevendo && !formulario && !historico)) render();
    } catch (e) {
      if (aberto && g === geracao) {
        erro =
          ERROS[e.message] ||
          'Não foi possível atualizar. Confira a conexão e tente novamente. Os dados exibidos podem estar desatualizados.';
        render();
      }
    } finally {
      carregando = false;
      pulsar();
      if (aberto && g !== geracao) carregar();
    }
  }
  async function executar(nome, args) {
    if (ocupado) return;
    ocupado = true;
    erro = '';
    aviso = '';
    atribuicaoConfirmada = false;
    render();
    try {
      await consultar(nome, args);
      formulario = null;
      rascunhos.delete(args.p_id);
      atribuicoes.delete(args.p_id);
      atribuicaoConfirmada = nome === 'atribuir_entrega' && !args.p_sair;
      aviso = atribuicaoConfirmada
        ? `${window.ML.fmt.numero(pedidos().find((p) => p.id === args.p_id)?.numero)} atribuído. Abra Aguardando para registrar a saída.`
        : 'Alteração registrada no servidor.';
    } catch (e) {
      erro = ERROS[e.message] || 'Não foi possível registrar. Confira a conexão e tente novamente.';
    } finally {
      ocupado = false;
    }
    const erroEscrita = erro;
    await carregar();
    erro = erroEscrita || erro;
    render();
  }
  function mostrarCentral() {
    slots
      .find((el) => el.offsetParent !== null)
      ?.querySelector('.pn-ent-central')
      ?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-e]');
    if (!b?.closest('[data-entregadores]') || ocupado) return;
    const id = b.closest('[data-entrega]')?.dataset.entrega,
      p = pedidos().find((p) => p.id === id);
    switch (b.dataset.e) {
      case 'organizar':
        planejamento.focar();
        return;
      case 'atualizar':
        return carregar();
      case 'ver-atribuidos':
        etapa = 'espera';
        filtro = 'todos';
        busca = '';
        limite = 12;
        render();
        mostrarCentral();
        return;
      case 'etapa':
        etapa = b.dataset.etapa;
        if (etapa === 'atribuir') filtro = 'todos';
        limite = 12;
        render();
        if (b.classList.contains('pn-ent-kpi')) mostrarCentral();
        return;
      case 'entregador':
        if (etapa === 'atribuir') etapa = 'todos';
        filtro = filtro === b.dataset.motoboy ? 'todos' : b.dataset.motoboy;
        limite = 12;
        render();
        mostrarCentral();
        return;
      case 'anteriores':
        filtro = 'sem';
        etapa = 'anteriores';
        limite = 12;
        render();
        mostrarCentral();
        return;
      case 'limpar':
        filtro = 'todos';
        etapa = 'todos';
        busca = '';
        limite = 12;
        render();
        return;
      case 'mais':
        limite += 12;
        atualizarLista();
        return;
      case 'retorno':
        retorno = true;
        await carregar();
        render();
        return;
      case 'fechar-retorno':
        retorno = false;
        render();
        return;
      case 'sair':
        return executar('atribuir_entrega', { p_id: id, p_motoboy: p.motoboyId, p_sair: true });
      case 'manual':
        formulario = id;
        render();
        slots
          .find((el) => el.offsetParent !== null)
          ?.querySelector('[data-e-form="manual"] input')
          ?.focus();
        return;
      case 'cancelar':
        formulario = null;
        render();
        slots
          .find((el) => el.offsetParent !== null)
          ?.querySelector(`[data-e-key="manual-${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true });
        return;
      case 'fechar-historico': {
        const id = historico?.id;
        historico = null;
        render();
        slots
          .find((el) => el.offsetParent !== null)
          ?.querySelector(`[data-e-key="historico-${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true });
        return;
      }
      case 'historico':
        try {
          const g = geracao;
          const eventos = await consultar('historico_entrega', { p_id: id });
          if (!aberto || g !== geracao) return;
          historico = { id, numero: window.ML.fmt.numero(p.numero), eventos };
          render();
          const area = slots.find((el) => el.offsetParent !== null)?.querySelector('.pn-entrega-historico');
          area?.focus({ preventScroll: true });
          area?.scrollIntoView({ block: 'nearest' });
        } catch {
          erro = 'Não foi possível carregar o histórico.';
          render();
        }
        break;
    }
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-e-form]');
    if (!f) return;
    e.preventDefault();
    if (ocupado || !f.reportValidity()) return;
    const id = f.closest('[data-entrega]').dataset.entrega,
      d = new FormData(f);
    if (f.dataset.eForm === 'atribuir') executar('atribuir_entrega', { p_id: id, p_motoboy: d.get('motoboy'), p_sair: false });
    else executar('baixar_entrega_manual', { p_id: id, p_motivo: d.get('motivo').trim() });
  });
  root.addEventListener('input', (e) => {
    const alvo = e.target;
    if (!alvo.closest('[data-entregadores]')) return;
    if (alvo.matches('[data-e-busca]')) {
      busca = alvo.value;
      for (const el of slots) el.querySelector('[data-e-busca]').value = busca;
      limite = 12;
      atualizarLista();
    }
    if (alvo.name === 'motivo') rascunhos.set(alvo.closest('[data-entrega]').dataset.entrega, alvo.value);
  });
  root.addEventListener('change', (e) => {
    if (!e.target.closest('[data-entregadores]')) return;
    if (e.target.matches('[data-e-periodo]')) {
      dias = Number(e.target.value);
      geracao++;
      limite = 12;
      carregar();
    }
    if (e.target.matches('[data-e-filtro]')) {
      filtro = e.target.value;
      limite = 12;
      render();
    }
    if (e.target.name === 'motoboy') atribuicoes.set(e.target.closest('[data-entrega]').dataset.entrega, e.target.value);
    if (e.target.matches('[data-e-alerta]') && e.target.reportValidity() && Number(e.target.value) >= 1 && Number(e.target.value) <= 1440) {
      alerta = Number(e.target.value);
      try {
        localStorage.setItem('mineiro:v2:entregadores:alerta', String(alerta));
      } catch {
        /* por aparelho */
      }
      render();
    }
  });
  render();
  return {
    abrir() {
      aberto = true;
      planejamento.abrir();
      carregar();
      if (!pararEventos)
        pararEventos = window.ML.store?.ouvir?.((tipo) => {
          if (tipo.startsWith('pedido:')) {
            clearTimeout(atualizacaoAgendada);
            atualizacaoAgendada = setTimeout(() => carregar(true), 400);
          }
        });
      if (!intervalo)
        intervalo = setInterval(() => {
          if (!document.hidden) carregar(true);
        }, 15000);
      if (!tic)
        tic = setInterval(() => {
          if (!document.hidden) pulsar();
        }, 1000);
    },
    esconder() {
      aberto = false;
      planejamento.esconder();
      geracao++;
      pararEventos?.();
      pararEventos = null;
      clearTimeout(atualizacaoAgendada);
      clearInterval(intervalo);
      clearInterval(tic);
      intervalo = null;
      tic = null;
      formulario = null;
      historico = null;
    }
  };
}
window.MLEntregadores = { montar: montarEntregadores };
