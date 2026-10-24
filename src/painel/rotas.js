import { calcularRotas, mensagemRota } from '../lib/rotas-api.js';
import './rotas.css';

const SITUACOES = {
  na_loja: 'Na loja',
  fora: 'Fora do turno',
  pausado: 'Pausado',
  reservada: 'Aguardando saída',
  em_rota: 'Em rota',
  retornando: 'Retornando'
};
const minuto = (s) => (Number.isFinite(s) ? `${Math.ceil(s / 60)} min` : 'Tempo não calculado');
const distancia = (m) =>
  Number.isFinite(m) ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : 'Distância não calculada';

export function montarPlanejamento(hosts, { consultar, aoAlterar = () => {}, aoConsultar = () => {} }) {
  const esc = window.ML.fmt.esc,
    numero = window.ML.fmt.numero;
  let dados = null,
    aberto = false,
    lendo = false,
    ocupado = false,
    geracao = 0,
    intervalo,
    relogio,
    aviso = '',
    erro = '';
  let configAberta = false,
    rascunho = null,
    selecionados = [],
    ordemFixa = false,
    desvio = 0;
  const campos = new Map();
  const agora = () => Date.now() + desvio;
  const elegiveis = () => (dados?.entregadores || []).filter((e) => e.elegivel);
  const pedidosEmViagens = (r) => [...new Set((r?.viagens || []).flatMap((v) => v.paradas.map((p) => p.id)))].sort().join(',');
  const viagemDoPedido = (id) => (dados?.viagens || []).find((v) => v.paradas.some((p) => p.id === id));
  const quantidade = (n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`;
  const estimativa = (v) =>
    Number.isFinite(v.metros) && Number.isFinite(v.segundos)
      ? `${distancia(v.metros)} com retorno · ${minuto(v.segundos)} estimados`
      : 'Distância e tempo não calculados';
  function despachoHTML() {
    const c = dados.config;
    return `<details class="rt-despacho-config" data-r-detail="despacho"><summary>Ajustar despacho automático</summary><p>O despacho individual envia um pedido por saída ao próximo motoboy disponível, sem depender do cálculo de mapas.</p><p>Os pedidos já reservados ou em entrega continuam com o mesmo motoboy ao pausar a automação.</p><button type="button" class="pn-btn" data-r="despacho" data-r-key="despacho" ${ocupado || (!c.despachoIndividualAtivo && !c.automacaoDisponivel) ? 'disabled' : ''}>${c.despachoIndividualAtivo ? 'Pausar despacho individual' : 'Ativar despacho individual'}</button>${!c.automacaoDisponivel ? '<p>O agendamento automático precisa estar disponível no servidor.</p>' : ''}</details>`;
  }
  function configHTML() {
    const c = dados.config,
      r = rascunho || { ...c.regras, modo: c.modo, limite: c.limiteCreditosDia, versao: c.versao };
    return `<details class="rt-config" data-r-detail="config" ${configAberta ? 'open' : ''}><summary>Configurar rotas</summary><form data-r-form="config" novalidate>
      <p>Defina os limites usados para agrupar pedidos. A saída real continua sendo registrada pela equipe ou pelo motoboy.</p>
      <label>Funcionamento<select name="r_modo" data-r-cfg="modo" data-r-key="modo">${[
        ['desligado', 'Desligado'],
        ['assistido', 'Sugestões com liberação pela equipe'],
        ['automatico', 'Vincular viagens automaticamente']
      ]
        .map(
          ([v, t]) =>
            `<option value="${v}" ${r.modo === v ? 'selected' : ''} ${v === 'automatico' && !c.automacaoDisponivel ? 'disabled' : ''}>${t}</option>`
        )
        .join('')}</select></label>
      <div class="rt-config-campos">${[
        ['maxPedidos', 'Pedidos por saída', 1, 6, 1],
        ['esperaMin', 'Priorizar saída individual após (min)', 1, 120, 1],
        ['trajetoMin', 'Máximo até a última entrega (min)', 1, 180, 1],
        ['desvioMin', 'Desvio máximo por pedido (min)', 0, 120, 1],
        ['paradaMin', 'Atendimento por endereço (min)', 0, 15, 0.5]
      ]
        .map(
          ([k, t, min, max, step]) =>
            `<label>${t}<input name="r_${k}" data-r-cfg="${k}" data-r-key="cfg-${k}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(r[k] ?? '')}" required></label>`
        )
        .join('')}</div>
      <details data-r-detail="avancado"><summary>Limite de uso dos mapas</summary><label>Limite diário de créditos estimados<input name="r_limite" data-r-cfg="limite" data-r-key="cfg-limite" type="number" min="20" max="100000" step="1" value="${esc(r.limite)}"></label><p>Controle interno de consumo. A disponibilidade também depende do saldo do serviço de mapas.</p></details>
      <p>A espera indica quando priorizar a saída. Falta de motoboy ou liberação pode atrasá-la.</p>
      ${!c.origemConfirmada ? '<p class="rt-atencao">Confirme o ponto de saída usando a localização do aparelho, estando na loja.</p><button type="button" class="pn-btn" data-r="origem">Confirmar saída na loja</button>' : ''}
      <div class="rt-acoes"><button type="submit" class="pn-btn pn-ent-prim" ${ocupado ? 'disabled' : ''}>Salvar configuração</button><button type="button" class="pn-btn" data-r="verificar" ${ocupado ? 'disabled' : ''}>Verificar mapas</button></div>
    </form></details>`;
  }
  function entregadorHTML(e, ajustes = true) {
    const recente = e.ultimaEm && agora() - Date.parse(e.ultimaEm) < 120000;
    return `<article class="rt-pessoa" data-r-entregador="${esc(e.id)}"><div><b>${esc(e.nome)}</b><span class="rt-situacao ${e.elegivel ? 'rt-situacao--livre' : ''}">${esc(e.ativo ? SITUACOES[e.situacao] || 'Indisponível' : 'Cadastro inativo')}</span></div><p>${e.elegivel ? 'Recebe a próxima saída automaticamente' : e.qtdAbertas && !e.viagemId ? 'Tem pedidos atribuídos abertos' : !dados.config.despachoIndividualAtivo && !recente ? 'Sem comunicação recente para receber uma rota' : e.situacao === 'fora' ? 'Precisa começar o turno no celular' : e.situacao === 'pausado' ? 'Precisa informar disponibilidade no celular' : 'Acompanhe a saída e o retorno abaixo.'}</p>${
      ajustes && e.ativo && !e.viagemId
        ? `<details data-r-detail="pessoa-${esc(e.id)}"><summary>Registrar situação</summary><form data-r-form="situacao" data-r-id="${esc(e.id)}"><label>Situação<select name="r_situacao" data-r-field="estado-${esc(e.id)}" data-r-key="estado-${esc(e.id)}">${[
            ['na_loja', 'Na loja'],
            ['pausado', 'Pausado'],
            ['fora', 'Fora do turno']
          ]
            .map(([v, t]) => `<option value="${v}" ${(campos.get('estado-' + e.id) || e.declarado) === v ? 'selected' : ''}>${t}</option>`)
            .join(
              ''
            )}</select></label><label>Motivo<input name="r_motivo" data-r-field="pessoa-${esc(e.id)}" data-r-key="pessoa-${esc(e.id)}" maxlength="200" required value="${esc(campos.get('pessoa-' + e.id) || '')}"></label><button class="pn-btn" ${ocupado ? 'disabled' : ''}>Registrar situação</button></form></details>`
        : ''
    }</article>`;
  }
  function paradasHTML(v) {
    return `<ol class="rt-paradas">${v.paradas.map((p) => `<li><span class="rt-ordem">${p.ordem}</span><div><b>${esc(numero(p.numero))} · ${esc(p.nome)}</b><p>${esc(p.endereco)}</p><span>${p.status === 'entregue' ? 'Entregue' : p.status === 'cancelado' ? 'Cancelado' : Number.isFinite(p.chegadaSeg) ? `Chegada estimada em ${minuto(p.chegadaSeg)} após a saída` : 'Tempo de chegada não calculado'}</span></div></li>`).join('')}</ol>`;
  }
  function mapaHTML(v) {
    return `<button type="button" class="pn-btn" data-r="mapa" data-r-id="${esc(v.id)}" ${!v.geometria || !navigator.onLine ? 'disabled' : ''}>Ver percurso no mapa</button>`;
  }
  function planoHTML(p) {
    const escolhido = campos.get('plano-' + p.id) || p.motoboyId;
    return `<article class="rt-viagem rt-viagem--sugestao" data-r-plano="${esc(p.id)}" data-r-key="plano-${esc(p.id)}" tabindex="-1"><div class="rt-viagem-cab"><div><span class="rt-kicker">Sugestão de viagem</span><h4>${esc(p.motoboyNome)}</h4></div><span>${p.urgente ? 'Saída individual prioritária' : 'Pedidos com percurso compatível'}</span></div><p class="rt-estimativa">${distancia(p.metros)} com retorno · ${minuto(p.segundos)} de viagem estimada</p>${paradasHTML(p)}<p class="rt-validade" data-r-valido="${esc(p.validoAte)}"></p><label>Entregador<select data-r-field="plano-${esc(p.id)}" data-r-key="plano-${esc(p.id)}">${(
      dados.entregadores || []
    )
      .filter((e) => e.elegivel || e.id === p.motoboyId)
      .map((e) => `<option value="${esc(e.id)}" ${escolhido === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`)
      .join(
        ''
      )}</select></label><div class="rt-acoes">${mapaHTML(p)}<button type="button" class="pn-btn pn-ent-prim" data-r="reservar" data-r-id="${esc(p.id)}" data-r-expira="${esc(p.validoAte)}" ${ocupado ? 'disabled' : ''}>Vincular viagem</button></div></article>`;
  }
  function viagemHTML(v) {
    return `<article class="rt-viagem" data-r-viagem="${esc(v.id)}" data-r-tipo="${esc(v.tipoDespacho || 'rotas')}" data-r-key="viagem-${esc(v.id)}" tabindex="-1"><div class="rt-viagem-cab"><div><span class="rt-kicker">${esc(SITUACOES[v.estado] || v.estado)}</span><h4>${esc(v.motoboyNome)}</h4></div><span>${v.tipoDespacho === 'individual' ? 'Despacho individual automático' : v.automatica ? 'Vínculo automático' : 'Liberada pela equipe'}</span></div><p class="rt-quantidade">${quantidade(v.paradas.length)} nesta saída</p><p class="rt-estimativa">${estimativa(v)}</p>${paradasHTML(v)}
      ${v.revisaoPendente ? '<p class="rt-atencao">Um pedido mudou. Desfaça e recalcule esta viagem antes de sair.</p>' : ''}
      ${v.estado === 'reservada' ? `<p>${v.carregadaVersao === v.versao ? `Pedidos carregados. O motoboy deve tocar em “Sair com ${quantidade(v.paradas.length)}” quando sair da loja.` : 'Aguardando o motoboy abrir a tela conectado e carregar os pedidos.'}</p>${v.reservaAte ? `<p class="rt-reserva" data-r-reserva="${esc(v.reservaAte)}">Reserva até ${esc(new Date(v.reservaAte).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))}. Sem saída, o pedido volta à fila e o motoboy fica pausado.</p>` : ''}` : ''}
      ${v.estado === 'retornando' ? '<p>Entregas sincronizadas. O motoboy deve tocar em “Voltei à loja” quando retornar.</p>' : ''}
      ${v.geometria ? `<div class="rt-acoes">${mapaHTML(v)}</div>` : ''}
      ${v.estado === 'reservada' ? `<details data-r-detail="saida-${esc(v.id)}"><summary>Registrar saída pela equipe</summary><p>Use somente após conferir a saída física do motoboy.</p><button type="button" class="pn-btn" data-r="sair" data-r-id="${esc(v.id)}" ${ocupado || v.revisaoPendente || v.carregadaVersao !== v.versao ? 'disabled' : ''}>Registrar saída da viagem</button></details>` : ''}
      ${v.estado === 'reservada' ? `<details data-r-detail="desfazer-${esc(v.id)}"><summary>Replanejar esta viagem</summary><form data-r-form="desfazer" data-r-id="${esc(v.id)}"><p>Os pedidos continuarão prontos e ficarão pausados na seleção automática. Você poderá calcular a seleção corrigida ou liberá-los novamente.</p><label>Motivo<input name="r_motivo" data-r-field="viagem-${esc(v.id)}" data-r-key="viagem-${esc(v.id)}" required maxlength="200" value="${esc(campos.get('viagem-' + v.id) || '')}"></label><button class="pn-btn" ${ocupado ? 'disabled' : ''}>Desfazer viagem para replanejar</button></form></details>` : ''}
      ${v.estado === 'retornando' ? `<details data-r-detail="retorno-${esc(v.id)}"><summary>Conferir retorno à loja</summary><form data-r-form="retornar" data-r-id="${esc(v.id)}"><p>Confirme presencialmente o retorno e peça ao motoboy para conferir “Tudo sincronizado” no celular.</p><label>Motivo da conferência<input name="r_motivo" data-r-field="retorno-${esc(v.id)}" data-r-key="retorno-${esc(v.id)}" required maxlength="200" value="${esc(campos.get('retorno-' + v.id) || '')}"></label><button class="pn-btn" ${ocupado ? 'disabled' : ''}>Registrar retorno conferido</button></form></details>` : ''}
    </article>`;
  }
  function prontosHTML() {
    return `<div class="rt-prontos"><div class="rt-secao-cab"><h4>Prontos sem viagem</h4><span>${dados.prontos.length} pedidos</span></div><p>Selecione até 6 pedidos para calcular um grupo específico. Sem seleção, o sistema considera os prontos há mais tempo.</p><div class="rt-prontos-lista">${dados.prontos.map((p) => `<article class="rt-pronto"><label><input type="checkbox" data-r-selecao="${esc(p.id)}" ${selecionados.includes(p.id) ? 'checked' : ''} ${!p.pontoValido ? 'disabled' : ''}><span><b>${esc(numero(p.numero))} · ${esc(p.nome)}</b><span>${esc(p.endereco)}</span><span class="rt-espera" data-r-pronto="${esc(p.prontoEm || '')}"></span>${p.pausado ? '<em>Pausado na seleção automática</em>' : ''}${!p.pontoValido ? '<em>Confira o ponto de entrega antes de planejar</em>' : ''}</span></label>${!p.pontoValido ? `<details data-r-detail="destino-${esc(p.id)}"><summary>Conferir localização</summary><form data-r-form="destino" data-r-id="${esc(p.id)}"><label>Motivo da conferência<input name="r_motivo" maxlength="200" required data-r-field="destino-${esc(p.id)}" data-r-key="destino-${esc(p.id)}" value="${esc(campos.get('destino-' + p.id) || '')}"></label><button class="pn-btn">Marcar entrada no mapa</button></form></details>` : ''}</article>`).join('') || '<p class="rt-vazio">Nenhum pedido pronto aguardando planejamento.</p>'}</div>
      ${
        selecionados.length
          ? `<div class="rt-selecao"><h4>Seleção e ordem</h4><ol>${selecionados
              .map((id, i) => {
                const p = dados.prontos.find((p) => p.id === id);
                return `<li><b>${esc(numero(p.numero))}</b><div><button type="button" class="pn-btn" data-r="subir" data-r-id="${esc(id)}" aria-label="Antecipar pedido ${esc(numero(p.numero))}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="pn-btn" data-r="descer" data-r-id="${esc(id)}" aria-label="Adiar pedido ${esc(numero(p.numero))}" ${i === selecionados.length - 1 ? 'disabled' : ''}>↓</button></div></li>`;
              })
              .join(
                ''
              )}</ol><label class="rt-check"><input type="checkbox" data-r-ordem ${ordemFixa ? 'checked' : ''}>Usar esta ordem de paradas, respeitando os limites</label><div class="rt-acoes"><button type="button" class="pn-btn" data-r="limpar">Limpar seleção</button><button type="button" class="pn-btn" data-r="liberar" ${ocupado ? 'disabled' : ''}>Liberar seleção para automação</button></div></div>`
          : ''
      }
    </div>`;
  }
  function execucaoHTML() {
    const e = dados.ultimaExecucao;
    if (!e) return '';
    const motivos = {
      trajeto_fora_limite: 'pedido fora dos limites de trajeto',
      sem_entregador_disponivel: 'pedido aguardando entregador',
      sequencia_fora_limite: 'pedido fora dos limites da sequência escolhida'
    };
    const grupos = new Map();
    for (const p of e.impedidos || []) grupos.set(p.motivo, (grupos.get(p.motivo) || 0) + 1);
    motivos.revalidacao_falhou = 'pedido alterado durante o cálculo; confira e calcule novamente';
    return `<div class="rt-execucao ${e.estado === 'erro' || grupos.size ? 'rt-atencao' : ''}"><p>${e.estado === 'calculando' ? 'Calculando sugestões de viagem…' : e.estado === 'erro' ? mensagemRota({ message: e.erro }) : e.verificacao ? 'Serviço de mapas verificado.' : 'Último cálculo concluído.'}</p>${[...grupos].map(([k, n]) => `<p>${n} ${esc(motivos[k] || 'pedido precisa de conferência')}.</p>`).join('')}</div>`;
  }
  function proximoPassoHTML() {
    if (dados.config.despachoIndividualAtivo) {
      if (dados.viagens.some((v) => v.estado === 'reservada'))
        return '<div class="rt-proximo" data-r-proximo="saida"><b>O pedido já tem motoboy</b><p>Ele confere a embalagem e registra a saída pelo celular. Você pode continuar preparando os próximos pedidos.</p></div>';
      if (!dados.prontos.length)
        return '<div class="rt-proximo" data-r-proximo="pronto"><b>Seu próximo passo é marcar o pedido pronto</b><p>Quando estiver embalado, use “Marcar pronto” na aba Pedidos. O sistema escolhe o próximo motoboy disponível.</p></div>';
      if (!elegiveis().length)
        return '<div class="rt-proximo" data-r-proximo="motoboy"><b>Aguardando um motoboy disponível</b><p>Ao chegar à loja, ele deve abrir o celular e tocar em “Começar turno” ou “Voltei à loja”. Você não precisa atribuir cada pedido.</p></div>';
      return '<div class="rt-proximo" data-r-proximo="automatico"><b>O sistema está preparando a próxima saída</b><p>Os pedidos prontos seguem pela ordem de espera, um por saída. O motoboy aparecerá aqui automaticamente.</p></div>';
    }
    if (dados.config.modo === 'desligado')
      return '<div class="rt-proximo" data-r-proximo="pausado"><b>O despacho automático está pausado</b><p>Ative o despacho individual para enviar um pedido por saída, sem escolher motoboy nem configurar mapas.</p><button type="button" class="pn-btn" data-r="abrir-despacho">Ajustar despacho automático</button></div>';
    if (dados.viagens.some((v) => v.estado === 'reservada'))
      return '<div class="rt-proximo"><b>Agora, confira os pedidos da viagem</b><p>Peça ao motoboy para abrir a tela no celular. Quando aparecer “Viagem carregada”, registre a saída no cartão da viagem.</p></div>';
    if (dados.viagens.some((v) => v.estado === 'retornando'))
      return '<div class="rt-proximo"><b>Confira quem já voltou à loja</b><p>As entregas chegaram ao sistema. O motoboy precisa registrar “Retornei à loja” para receber a próxima viagem.</p></div>';
    if (dados.planos.length)
      return '<div class="rt-proximo"><b>Confira a viagem sugerida</b><p>Confira o motoboy e a sequência dos pedidos logo abaixo. Se estiver tudo certo, toque em “Vincular viagem”.</p></div>';
    if (!dados.prontos.length)
      return '<div class="rt-proximo"><b>O próximo passo é deixar o pedido pronto</b><p>Na aba Pedidos, use “Marcar pronto” quando o lanche estiver embalado. Ele aparecerá aqui para montar a viagem.</p></div>';
    if (!dados.prontos.some((p) => p.pontoValido))
      return '<div class="rt-proximo"><b>Confira onde os pedidos serão entregues</b><p>Use “Conferir localização” no pedido abaixo para marcar a entrada correta no mapa.</p></div>';
    if (!elegiveis().length)
      return '<div class="rt-proximo"><b>Aguardando um motoboy disponível na loja</b><p>Peça para ele abrir a tela e tocar em “Começar turno na loja”. Se estiver voltando de uma viagem, ele deve sincronizar as entregas e registrar o retorno.</p></div>';
    return `<div class="rt-proximo"><b>${dados.config.modo === 'automatico' ? 'Os pedidos serão organizados automaticamente' : 'Tudo pronto para montar a próxima viagem'}</b><p>${dados.config.modo === 'automatico' ? 'Acompanhe a viagem abaixo. O motoboy só sai depois de carregar os pedidos no celular e registrar a saída.' : 'Toque em “Sugerir viagens”, confira os pedidos e use “Vincular viagem”. Não é preciso selecionar cada pedido.'}</p></div>`;
  }
  function render() {
    for (const [i, host] of hosts.entries()) {
      const foco = host.contains(document.activeElement) ? document.activeElement.dataset.rKey : null;
      const detalhes = [...host.querySelectorAll('details[open]')].map((d) => d.dataset.rDetail);
      const noTurno = (dados?.entregadores || []).filter((e) => e.ativo && (e.declarado !== 'fora' || e.viagemId || e.qtdAbertas));
      host.innerHTML = `<section class="rt-central" data-r-central aria-labelledby="rt-t-${i}"><div class="rt-cab"><div><p class="rt-kicker">Operação de entregas</p><h3 id="rt-t-${i}" tabindex="-1" data-r-key="titulo">Saídas da loja</h3><p>Marque o pedido pronto. O sistema organiza a saída.</p></div><button type="button" class="pn-btn" data-r="atualizar" ${ocupado ? 'disabled' : ''}>Atualizar saídas</button></div><p class="rt-erro" role="alert" tabindex="-1" data-r-key="erro" ${erro ? '' : 'hidden'}>${esc(erro)}</p><p class="rt-aviso" role="status" ${aviso ? '' : 'hidden'}>${esc(aviso)}</p>${
        !dados
          ? '<p>Consultando planejamento…</p>'
          : `
        <div class="rt-operacao"><span class="rt-modo" data-r-modo>${dados.config.despachoIndividualAtivo ? 'Despacho individual automático ativo' : dados.config.modo === 'automatico' ? 'Vínculo automático de rotas ativo' : dados.config.modo === 'assistido' ? 'Rotas com liberação pela equipe' : 'Despacho automático pausado'}</span></div>
        <div class="rt-resumo" aria-label="Situação das saídas"><div><b data-r-disponiveis>${elegiveis().length}</b><span>motoboys disponíveis</span></div><div><b data-r-prontos-total>${dados.prontos.length}</b><span>prontos sem saída</span></div><div><b data-r-viagens-total>${dados.viagens.filter((v) => v.estado === 'em_rota').length}</b><span>viagens em entrega</span></div></div>
        ${proximoPassoHTML()}
        <div class="rt-viagens rt-viagens--ativas" data-r-saidas>${dados.viagens.map(viagemHTML).join('') || '<p class="rt-vazio">Nenhuma viagem em andamento.</p>'}</div>
        <section class="rt-turno" aria-label="Motoboys do turno"><div class="rt-secao-cab"><h4>Motoboys do turno</h4><span>Presença informada na loja</span></div><div class="rt-pessoas">${noTurno.map((e) => entregadorHTML(e, false)).join('') || '<p class="rt-vazio">O motoboy deve tocar em “Começar turno” no celular ao chegar à loja.</p>'}</div></section>
        ${despachoHTML()}
        <details class="rt-avancado" data-r-detail="rotas"><summary>Viagens e rotas: opções avançadas</summary><p>Agrupe vários pedidos pelas ruas após configurar a capacidade e os limites da operação. O despacho individual continua disponível sem mapas.</p>${dados.config.modo === 'desligado' ? '<button type="button" class="pn-btn" data-r="preparar">Preparar rotas da loja</button>' : ''}${configHTML()}
          <details class="rt-equipe" data-r-detail="equipe"><summary>Quem está na loja?</summary><div class="rt-pessoas">${dados.entregadores.map((e) => entregadorHTML(e)).join('')}</div></details>
          ${dados.config.modo !== 'desligado' ? `<div class="rt-viagens rt-viagens--sugestoes">${dados.planos.map(planoHTML).join('')}</div>${prontosHTML()}<div class="rt-acoes rt-calcular"><button type="button" class="pn-btn pn-ent-prim" data-r="calcular" ${ocupado || !elegiveis().length || !dados.prontos.some((p) => p.pontoValido) ? 'disabled' : ''}>${ocupado ? 'Aguarde…' : selecionados.length ? 'Calcular seleção' : 'Sugerir viagens'}</button><p>Confira a sequência antes de liberar. O mapa mostra o percurso previsto pelas ruas.</p></div>${execucaoHTML()}` : ''}
        </details>`
      }</section>`;
      for (const d of host.querySelectorAll('details[data-r-detail]')) if (detalhes.includes(d.dataset.rDetail)) d.open = true;
      if (foco) host.querySelector(`[data-r-key="${CSS.escape(foco)}"]`)?.focus({ preventScroll: true });
    }
    atualizarPrazos();
  }
  function atualizarPrazos() {
    hosts.forEach((h) => {
      for (const t of h.querySelectorAll('[data-r-valido]')) {
        const s = Math.ceil((Date.parse(t.dataset.rValido) - agora()) / 1000);
        t.textContent = s > 0 ? `Sugestão válida por ${s} s` : 'Sugestão expirada. Calcule novamente.';
      }
      for (const b of h.querySelectorAll('[data-r-expira]')) b.disabled = ocupado || Date.parse(b.dataset.rExpira) <= agora();
      for (const t of h.querySelectorAll('[data-r-pronto]')) {
        const mins = Math.max(0, Math.floor((agora() - Date.parse(t.dataset.rPronto)) / 60000));
        t.textContent = Number.isFinite(mins) ? `Pronto há ${mins} min` : 'Horário de prontidão indisponível';
        t.classList.toggle('rt-espera--urgente', mins >= (dados?.config.regras.esperaMin ?? Infinity));
      }
    });
  }
  async function atualizar(silencioso = false) {
    if (!aberto || lendo) return;
    lendo = true;
    const g = geracao;
    try {
      const r = await consultar('painel_rotas_entregas');
      if (!aberto || g !== geracao) return;
      const mudouVinculo = !dados || pedidosEmViagens(r) !== pedidosEmViagens(dados);
      const mudou = JSON.stringify({ ...r, servidorEm: null }) !== JSON.stringify(dados ? { ...dados, servidorEm: null } : null);
      dados = r;
      desvio = Date.parse(r.servidorEm) - Date.now();
      selecionados = selecionados.filter((id) => r.prontos.some((p) => p.id === id));
      const editando = hosts.some((h) => h.contains(document.activeElement) && document.activeElement.matches('input,select,textarea'));
      if (!silencioso || (mudou && !editando)) render();
      if (mudouVinculo) aoConsultar();
    } catch (e) {
      if (aberto && g === geracao) {
        erro = mensagemRota(e);
        if (!silencioso) render();
      }
    } finally {
      lendo = false;
      if (aberto && g !== geracao) atualizar();
    }
  }
  function focarElemento(seletor) {
    const h = hosts.find((h) => h.getClientRects().length);
    const destino = h?.querySelector(seletor);
    destino?.scrollIntoView({ block: 'center', behavior: 'auto' });
    destino?.focus({ preventScroll: true });
  }
  async function escrever(acao, foco = null) {
    if (ocupado) return;
    ocupado = true;
    geracao++;
    erro = '';
    aviso = '';
    render();
    let resultado;
    try {
      const r = await acao();
      resultado = r;
      if (r !== false) aviso = 'Operação registrada. Confira a viagem antes da saída.';
    } catch (e) {
      erro = mensagemRota(e);
    } finally {
      ocupado = false;
    }
    await atualizar();
    render();
    aoAlterar();
    if (erro) focarElemento('.rt-erro');
    else if (foco) focarElemento(typeof foco === 'function' ? foco(resultado) : foco);
  }
  async function clicar(e) {
    const b = e.target.closest('[data-r]');
    if (!b || ocupado) return;
    const id = b.dataset.rId,
      v = dados?.viagens.find((v) => v.id === id),
      p = dados?.planos.find((p) => p.id === id);
    switch (b.dataset.r) {
      case 'preparar':
        configAberta = true;
        rascunho ||= { ...dados.config.regras, modo: 'assistido', limite: dados.config.limiteCreditosDia, versao: dados.config.versao };
        render();
        for (const h of hosts)
          if (h.getClientRects().length) {
            h.querySelector('.rt-config').scrollIntoView({ block: 'start', behavior: 'auto' });
            h.querySelector('[name="r_maxPedidos"]')?.focus({ preventScroll: true });
          }
        return;
      case 'atualizar':
        return atualizar();
      case 'abrir-despacho':
        for (const host of hosts) {
          const detalhe = host.querySelector('[data-r-detail="despacho"]');
          if (detalhe) detalhe.open = true;
        }
        focarElemento('[data-r="despacho"]');
        return;
      case 'despacho':
        return escrever(async () => {
          const ativar = !dados.config.despachoIndividualAtivo;
          await consultar('configurar_despacho_entregas', {
            p_ativo: ativar,
            p_versao: dados.config.versao,
            p_janela_agrupamento_seg: dados.config.janelaAgrupamentoSeg || 0,
            p_prazo_reserva_seg: dados.config.prazoReservaSeg || 300
          });
          aviso = ativar
            ? 'Despacho individual ativado. O motoboy deve começar o turno no celular.'
            : 'Despacho individual pausado. As saídas existentes foram preservadas.';
          return false;
        });
      case 'calcular':
        return escrever(async () => {
          const r = await calcularRotas({ acao: 'calcular', pedidos: selecionados.length ? selecionados : null, ordemFixa });
          if (['sem_pedidos', 'sem_entregador', 'calculando', 'aguarde'].includes(r?.estado)) throw new Error(r.estado);
          if (r?.estado === 'expirado') throw new Error('plano_expirado');
          if (r?.estado === 'erro') throw new Error('rota_indisponivel');
          if (r?.estado === 'concluida' && !r.planos) throw new Error('sem_rota_compativel');
        }, '[data-r-plano]');
      case 'verificar':
        return escrever(async () => {
          const r = await calcularRotas({ acao: 'verificar' });
          if (['calculando', 'aguarde'].includes(r?.estado)) throw new Error(r.estado);
          if (r?.estado === 'expirado') throw new Error('plano_expirado');
          if (r?.estado !== 'concluida' || !r.verificacao) throw new Error('rota_indisponivel');
          aviso = 'Serviço de mapas verificado.';
          return false;
        });
      case 'reservar':
        return escrever(
          () => consultar('reservar_viagem_entrega', { p_plano: id, p_motoboy: campos.get('plano-' + id) || p.motoboyId }),
          (r) => `[data-r-viagem="${CSS.escape(r.id)}"]`
        );
      case 'sair':
        return escrever(() => consultar('iniciar_viagem_entrega', { p_id: id, p_versao: v.versao }));
      case 'liberar':
        return escrever(() => consultar('liberar_planejamento_pedidos', { p_ids: selecionados }));
      case 'limpar':
        selecionados = [];
        render();
        return;
      case 'subir':
      case 'descer': {
        const i = selecionados.indexOf(id),
          j = i + (b.dataset.r === 'subir' ? -1 : 1);
        if (j >= 0 && j < selecionados.length) [selecionados[i], selecionados[j]] = [selecionados[j], selecionados[i]];
        render();
        return;
      }
      case 'mapa': {
        try {
          const { abrirMapaViagem } = await import('../lib/mapa-viagem.js');
          abrirMapaViagem(v || p);
        } catch {
          erro = 'Não foi possível abrir o mapa. Confira a conexão.';
          render();
        }
        return;
      }
      case 'origem':
        return escrever(async () => {
          if (!navigator.geolocation) throw new Error('localizacao_indisponivel');
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('localizacao_negada')), {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            })
          );
          if (pos.coords.accuracy > 50) throw new Error('localizacao_imprecisa');
          await window.ML.store.definirOrigemEntrega({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        });
    }
  }
  async function submeter(e) {
    const f = e.target.closest('[data-r-form]');
    if (!f) return;
    e.preventDefault();
    if (ocupado) return;
    const form = new FormData(f),
      id = f.dataset.rId,
      tipo = f.dataset.rForm;
    if (tipo !== 'config' || form.get('r_modo') !== 'desligado') if (!f.reportValidity()) return;
    if (tipo === 'config') {
      const regras = Object.fromEntries(
        ['maxPedidos', 'esperaMin', 'trajetoMin', 'desvioMin', 'paradaMin'].map((k) => [k, Number(form.get('r_' + k))])
      );
      const versao = rascunho?.versao || dados.config.versao;
      return escrever(async () => {
        await consultar('configurar_rotas', {
          p_modo: form.get('r_modo'),
          p_regras: form.get('r_modo') === 'desligado' ? dados.config.regras : regras,
          p_limite: form.get('r_modo') === 'desligado' ? dados.config.limiteCreditosDia : Number(form.get('r_limite')),
          p_versao: versao
        });
        rascunho = null;
      });
    }
    if (tipo === 'situacao')
      return escrever(() =>
        consultar('definir_disponibilidade_entregador', {
          p_situacao: form.get('r_situacao'),
          p_motoboy: id,
          p_motivo: form.get('r_motivo').trim()
        })
      );
    const v = dados.viagens.find((v) => v.id === id);
    if (tipo === 'desfazer' || tipo === 'retornar')
      return escrever(() =>
        consultar(tipo === 'desfazer' ? 'desfazer_viagem_entrega' : 'retornar_viagem_entrega', {
          p_id: id,
          p_versao: v.versao,
          p_motivo: form.get('r_motivo').trim()
        })
      );
    if (tipo === 'destino')
      return escrever(async () => {
        const { abrirMapaEntrega } = await import('../lib/mapa-entrega.js');
        const ponto = await abrirMapaEntrega({ ponto: dados.config.origem });
        if (ponto)
          await consultar('conferir_destino_pedido', {
            p_id: id,
            p_lat: ponto.lat,
            p_lon: ponto.lon,
            p_motivo: form.get('r_motivo').trim()
          });
        else return false;
      });
  }
  for (const h of hosts) {
    h.addEventListener('click', clicar);
    h.addEventListener('submit', submeter);
    h.addEventListener('input', (e) => {
      if (e.target.dataset.rField) campos.set(e.target.dataset.rField, e.target.value);
      if (e.target.dataset.rCfg) {
        rascunho ||= {
          ...dados.config.regras,
          modo: dados.config.modo,
          limite: dados.config.limiteCreditosDia,
          versao: dados.config.versao
        };
        rascunho[e.target.dataset.rCfg] = e.target.value;
      }
    });
    h.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.rField) campos.set(t.dataset.rField, t.value);
      if (t.dataset.rSelecao) {
        const id = t.dataset.rSelecao;
        selecionados = t.checked ? [...selecionados, id] : selecionados.filter((v) => v !== id);
        if (selecionados.length > 6) {
          selecionados.pop();
          t.checked = false;
          erro = 'Selecione até 6 pedidos por cálculo manual.';
        }
        render();
      }
      if (t.matches('[data-r-ordem]')) ordemFixa = t.checked;
      if (t.dataset.rCfg) {
        rascunho ||= {
          ...dados.config.regras,
          modo: dados.config.modo,
          limite: dados.config.limiteCreditosDia,
          versao: dados.config.versao
        };
        rascunho[t.dataset.rCfg] = t.value;
      }
    });
    h.addEventListener(
      'toggle',
      (e) => {
        if (e.target.dataset.rDetail === 'config') configAberta = e.target.open;
      },
      true
    );
  }
  render();
  return {
    hosts,
    temDados: () => !!dados,
    viagemDoPedido,
    focar() {
      const h = hosts.find((h) => h.getClientRects().length);
      h?.querySelector('.rt-central')?.scrollIntoView({ block: 'start', behavior: 'auto' });
      h?.querySelector('[data-r-key="titulo"]')?.focus({ preventScroll: true });
    },
    atualizar,
    abrir() {
      aberto = true;
      atualizar();
      intervalo ||= setInterval(() => {
        if (!document.hidden) atualizar(true);
      }, 15000);
      relogio ||= setInterval(atualizarPrazos, 1000);
    },
    esconder() {
      aberto = false;
      geracao++;
      clearInterval(intervalo);
      clearInterval(relogio);
      intervalo = null;
      relogio = null;
    }
  };
}
