import { obterSupabase } from '../lib/supabase.js';
import './entregadores.css';

const ERROS = {
  sem_permissao: 'Seu acesso não permite operar entregadores.',
  motivo_obrigatorio: 'Informe o motivo da baixa manual (até 200 caracteres).',
  entrega_em_andamento: 'Este pedido já saiu. Confira a entrega com o motoboy antes de encerrar.',
  entregador_inativo: 'Esse entregador está inativo. Atualize a lista.',
  transicao_invalida: 'O pedido mudou de situação. Atualize a lista.',
  nao_encontrado: 'Pedido não encontrado. Atualize a lista.'
};
export async function consultarEntregadores(nome, args = {}) {
  const sb = await obterSupabase({ sessao: true });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const { data, error } = await sb.rpc(nome, args).abortSignal(ctl.signal);
    if (error) throw error;
    return data;
  } finally { clearTimeout(timer); }
}

export const minutosEntrega = (p) => {
  if (p.encerramento !== 'motoboy' || p.horarioInconsistente || !p.saiuEm || !p.confirmadoEm) return null;
  const ms = new Date(p.confirmadoEm) - new Date(p.saiuEm);
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
};

export function montarEntregadores(root, { consultar = consultarEntregadores } = {}) {
  const slots = [...root.querySelectorAll('[data-entregadores]')], esc = window.ML.fmt.esc;
  let dados = null, dias = 1, filtro = 'todos', erro = '', aviso = '', aberto = false, ocupado = false;
  let formulario = null, historico = null, intervalo = null, carregando = false, geracao = 0;
  let alerta = 45;
  try { alerta = Number(localStorage.getItem('mineiro:v2:entregadores:alerta')) || 45; } catch { /* padrão operacional */ }
  const hora = v => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem registro';
  const tempo = v => v ? Math.max(0, Math.floor((Date.now() - new Date(v)) / 60000)) : null;
  const nome = p => p.motoboyNome || 'Sem entregador';
  const ativos = () => (dados?.pedidos || []).filter(p => ['preparo', 'pronto', 'rota'].includes(p.status));
  function render() {
    const pedidos = dados?.pedidos || [], entregadores = [...(dados?.entregadores || [])];
    for (const p of pedidos) if (p.motoboyId && !entregadores.some(e => e.id === p.motoboyId)) entregadores.push({ id: p.motoboyId, nome: p.motoboyNome, ativo: false });
    const visiveis = pedidos.filter(p => filtro === 'todos' || (filtro === 'sem' ? !p.atribuicao : p.motoboyId === filtro));
    const abertos = ativos().length;
    const corpo = `<div class="pn-entregadores">
      <div class="pn-entregadores-topo"><div><h2>Entregadores</h2><p>Acompanhe atribuições, saídas e confirmações recebidas.</p></div><button class="pn-btn" type="button" data-e="atualizar" ${ocupado ? 'disabled' : ''}>Atualizar</button></div>
      <p class="pn-erro" role="alert" ${erro ? '' : 'hidden'}>${esc(erro)}</p><p role="status" aria-live="polite">${esc(aviso)}</p>
      <div class="pn-entregadores-filtros">
        <label class="pn-campo"><span>Período</span><select class="pn-input" data-e-periodo>${[[1,'Hoje'],[7,'Últimos 7 dias'],[30,'Últimos 30 dias']].map(([v,t])=>`<option value="${v}" ${dias === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="pn-campo"><span>Entregador</span><select class="pn-input" data-e-filtro><option value="todos">Todos</option><option value="sem" ${filtro === 'sem' ? 'selected' : ''}>Sem atribuição</option>${entregadores.map(e=>`<option value="${esc(e.id)}" ${filtro === e.id ? 'selected' : ''}>${esc(e.nome)}${e.ativo ? '' : ' (inativo)'}</option>`).join('')}</select></label>
        <label class="pn-campo"><span>Alerta após (min)</span><input class="pn-input" type="number" min="1" max="1440" value="${alerta}" data-e-alerta></label>
      </div>
      <p class="pn-cfg-dica">Confirmações sem internet só aparecem após o envio. Última comunicação é o último contato recebido, sem indicar disponibilidade.</p>
      ${!dados ? '<p role="status">Carregando entregadores…</p>' : `<p>Atualizado em ${esc(hora(dados.servidorEm))}. Período a partir de ${esc(hora(dados.inicio))}; o dia operacional vira às 4h. Entregas abertas de dias anteriores continuam visíveis.</p>
      <details class="pn-entregadores-retorno"><summary>Conferência no retorno · ${abertos} ${abertos === 1 ? 'entrega aberta' : 'entregas abertas'}</summary><p>Peça ao motoboy para abrir a tela conectado e conferir “Tudo sincronizado”. Depois confira as entregas abertas abaixo. ${abertos} ${abertos === 1 ? 'entrega aberta' : 'entregas abertas'} no sistema.</p><button class="pn-btn" type="button" data-e="retorno">Conferir pendências do painel</button></details>
      <div class="pn-entregadores-resumos">${entregadores.filter(e=>filtro==='todos'||filtro===e.id).map(e=>{
        const seus=pedidos.filter(p=>p.motoboyId===e.id), abertas=seus.filter(p=>['preparo','pronto','rota'].includes(p.status));
        const concluidas=seus.filter(p=>p.status==='entregue'), validas=concluidas.map(minutosEntrega).filter(v=>v!==null);
        const media=validas.length ? `${Math.round(validas.reduce((a,b)=>a+b,0)/validas.length)} min` : 'Sem amostra';
        return `<article class="pn-entregador-resumo"><h3>${esc(e.nome || 'Entregador')}${e.ativo ? '' : ' · inativo'}</h3><p>${abertas.length} atribuídas abertas · ${abertas.filter(p=>p.status==='rota').length} em entrega · ${concluidas.length} concluídas no período</p><p>Tempo médio: <b>${media}</b> (${validas.length} confirmações válidas)</p><p>Última comunicação: <b>${esc(hora(e.ultimaEm))}</b></p></article>`;
      }).join('') || '<p>Nenhum entregador neste filtro. Administradores cadastram entregadores na aba Usuários.</p>'}</div>
      <details class="pn-cfg-dica"><summary>Como os indicadores são calculados</summary><p>Média: da saída registrada até o horário informado pelo celular. Baixas manuais e horários inconsistentes ficam fora da média; o relógio do aparelho pode afetar a medida. Concluídas são contadas uma vez, na data de recebimento pelo servidor.</p></details>
      <div class="pn-entregadores-lista">${visiveis.map(p=>pedidoHTML(p,entregadores)).join('') || '<p>Nenhuma entrega neste filtro.</p>'}</div>`}
      ${historico ? `<section class="pn-entrega-historico" aria-label="Histórico da entrega"><h3>Histórico ${esc(historico.numero)}</h3><button class="pn-btn" type="button" data-e="fechar-historico">Fechar histórico</button>${historico.eventos.map(e=>`<p><b>${esc(e.tipo)}</b> · ${esc(hora(e.em))}<br>Responsável: ${esc(e.responsavel)}${e.dados?.motivo ? `<br>Motivo: ${esc(e.dados.motivo)}` : ''}${e.dados?.nome ? `<br>Entregador: ${esc(e.dados.nome)}` : ''}${e.dados?.confirmadoEm ? `<br>Confirmado no aparelho: ${esc(hora(e.dados.confirmadoEm))}` : ''}</p>`).join('') || '<p>Sem eventos operacionais registrados para este pedido antigo.</p>'}</section>` : ''}
    </div>`;
    for (const el of slots) el.innerHTML = corpo;
  }
  function pedidoHTML(p, entregadores) {
    const emAberto=['preparo','pronto','rota'].includes(p.status), demora=tempo(p.saiuEm), num=window.ML.fmt.numero(p.numero);
    const longo=p.status==='rota'&&demora!==null&&demora>=alerta;
    return `<article class="pn-entrega ${longo ? 'pn-entrega--alerta' : ''}" data-entrega="${esc(p.id)}"><div><h3>${esc(num)} · ${esc(p.nome)}</h3><p><b>${p.status==='rota' ? 'Em entrega' : p.status==='entregue' ? 'Entregue' : p.status==='cancelado' ? 'Cancelado' : 'Aguardando saída'}</b> · ${esc(nome(p))}</p>
      ${p.saiuEm ? `<p>Saída: ${esc(hora(p.saiuEm))}${p.status==='rota' ? ` · ${demora} min em andamento` : ''}</p>` : ''}
      ${longo ? '<p role="status"><b>Entrega aberta há muito tempo — confira com o entregador.</b></p>' : ''}
      ${p.recebidoEm ? `<p>Recebida pelo servidor: ${esc(hora(p.recebidoEm))} · ${p.encerramento==='manual' ? 'Baixa manual' : esc(p.encerramento || '')}</p>` : ''}
      ${p.confirmadoEm ? `<p>Confirmada no aparelho: ${esc(hora(p.confirmadoEm))}${p.horarioInconsistente ? ' · horário inconsistente, fora da média' : ''}</p>` : ''}
      ${p.motivo ? `<p>Motivo: ${esc(p.motivo)}</p>` : ''}
      </div><div class="pn-entrega-acoes">
      ${emAberto && (!p.atribuicao || !p.saiuEm) ? `<form data-e-form="atribuir"><label class="pn-campo"><span>Entregador do ${esc(num)}</span><select class="pn-input" name="motoboy" required><option value="">Selecionar entregador</option>${entregadores.filter(e=>e.ativo).map(e=>`<option value="${esc(e.id)}" ${p.motoboyId===e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></label><button class="pn-btn" ${ocupado ? 'disabled' : ''}>${p.atribuicao ? 'Atualizar atribuição' : 'Atribuir'}</button></form>` : ''}
      ${emAberto&&p.atribuicao&&!p.saiuEm ? `<button class="pn-btn pn-btn--prim" type="button" data-e="sair" ${ocupado ? 'disabled' : ''}>Registrar saída ${esc(num)}</button>` : ''}
      ${p.status==='rota' ? `<button class="pn-btn" type="button" data-e="manual" ${ocupado ? 'disabled' : ''}>Baixa manual ${esc(num)}</button>` : ''}
      <button class="pn-btn" type="button" data-e="historico" ${ocupado ? 'disabled' : ''}>Histórico ${esc(num)}</button></div>
      ${formulario===p.id ? `<form class="pn-entrega-baixa" data-e-form="manual"><p>A baixa será registrada com seu usuário e preservada se houver sincronização posterior.</p><label class="pn-campo"><span>Motivo da baixa manual ${esc(num)}</span><input class="pn-input" name="motivo" required maxlength="200" minlength="3" autocomplete="off"></label><button class="pn-btn pn-btn--prim" ${ocupado ? 'disabled' : ''}>Confirmar baixa manual</button><button class="pn-btn" type="button" data-e="cancelar">Voltar</button></form>` : ''}</article>`;
  }
  async function carregar(silencioso = false) {
    if (carregando || ocupado || !aberto) return;
    carregando = true;
    const g=geracao;
    try {
      const r=await consultar('painel_entregadores',{p_dias:dias});
      if (!aberto || g!==geracao) return;
      dados=r; erro='';
      if (!silencioso || (!formulario && !slots.some(el=>el.contains(document.activeElement)&&document.activeElement.matches('input,select')))) render();
    } catch(e) {
      if (aberto && g===geracao) { erro=ERROS[e.message]||'Não foi possível atualizar. Os dados exibidos podem estar desatualizados. Confira a conexão e tente novamente.'; render(); }
    } finally { carregando=false; if (aberto && g!==geracao) carregar(); }
  }
  async function executar(nomeRpc,args) {
    if (ocupado) return;
    ocupado=true; erro=''; aviso=''; render();
    try {
      await consultar(nomeRpc,args);
      formulario=null; aviso='Alteração registrada no servidor.';
    } catch(e) { erro=ERROS[e.message]||'Não foi possível registrar. Confira a conexão, atualize a lista e tente novamente.'; }
    finally { ocupado=false; }
    // Não apagar a mensagem de erro de escrita ao atualizar a fotografia.
    const erroEscrita=erro;
    await carregar();
    erro=erroEscrita||erro; render();
  }
  root.addEventListener('click', async e=>{
    const b=e.target.closest('[data-e]'); if (!b?.closest('[data-entregadores]')||ocupado) return;
    const id=b.closest('[data-entrega]')?.dataset.entrega, p=dados?.pedidos.find(p=>p.id===id);
    if (b.dataset.e==='atualizar') return carregar();
    if (b.dataset.e==='retorno') { await carregar(); aviso=`${ativos().length} entregas abertas no painel. Confira também “Tudo sincronizado” no celular de cada motoboy.`; render(); return; }
    if (b.dataset.e==='sair') return executar('atribuir_entrega',{p_id:id,p_motoboy:p.motoboyId,p_sair:true});
    if (b.dataset.e==='manual') { formulario=id; render(); slots.find(el=>el.offsetParent!==null)?.querySelector('[data-e-form="manual"] input')?.focus(); }
    if (b.dataset.e==='cancelar') { formulario=null; render(); }
    if (b.dataset.e==='fechar-historico') { historico=null; render(); }
    if (b.dataset.e==='historico') {
      try { historico={numero:window.ML.fmt.numero(p.numero),eventos:await consultar('historico_entrega',{p_id:id})}; render(); slots.find(el=>el.offsetParent!==null)?.querySelector('.pn-entrega-historico')?.scrollIntoView({block:'nearest'}); }
      catch { erro='Não foi possível carregar o histórico.'; render(); }
    }
  });
  root.addEventListener('submit',e=>{
    const f=e.target.closest('[data-e-form]'); if (!f) return;
    e.preventDefault(); if (ocupado||!f.reportValidity()) return;
    const id=f.closest('[data-entrega]').dataset.entrega,d=new FormData(f);
    if (f.dataset.eForm==='atribuir') executar('atribuir_entrega',{p_id:id,p_motoboy:d.get('motoboy'),p_sair:false});
    else executar('baixar_entrega_manual',{p_id:id,p_motivo:d.get('motivo').trim()});
  });
  root.addEventListener('change',e=>{
    if (!e.target.closest('[data-entregadores]')) return;
    if (e.target.matches('[data-e-periodo]')) { dias=Number(e.target.value); geracao++; carregar(); }
    if (e.target.matches('[data-e-filtro]')) { filtro=e.target.value; render(); }
    if (e.target.matches('[data-e-alerta]')&&e.target.reportValidity()) {
      alerta=Number(e.target.value); try { localStorage.setItem('mineiro:v2:entregadores:alerta',String(alerta)); } catch { /* por tela */ } render();
    }
  });
  render();
  return {
    abrir() { aberto=true; carregar(); if (!intervalo) intervalo=setInterval(()=>{if (!document.hidden) carregar(true);},15000); },
    esconder() { aberto=false; geracao++; clearInterval(intervalo); intervalo=null; formulario=null; historico=null; },
  };
}
window.MLEntregadores = { montar: montarEntregadores };
