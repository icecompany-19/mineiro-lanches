import { abrirFilaImpressao } from './fila-impressao.js';
import './impressao-automatica.css';

const TRAVA = 'mineiro-impressao-local-v1';
const PRAZO = 120000;

// O retorno de print/afterprint confirma apenas a passagem pelo navegador, nunca o papel.
export async function enviarComanda(html, { antesDeEnviar = async () => {}, valida = () => true, signal } = {}) {
  const folha = document.createElement('div');
  folha.className = 'pn-auto-folha';
  folha.setAttribute('aria-hidden', 'true');
  folha.innerHTML = html;
  document.body.append(folha);
  const regra = document.createElement('style');
  try {
    const imagens = [...folha.querySelectorAll('img')];
    let tempoImagem;
    await Promise.race([
      Promise.all(imagens.map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve())),
      new Promise(ok => { tempoImagem = setTimeout(ok, 2000); })
    ]);
    clearTimeout(tempoImagem);
    if (!valida() || signal?.aborted) return false;
    const cupom = folha.querySelector('.pn-comanda');
    if (!cupom) throw new Error('comanda');
    const altura = Math.max(40, Math.ceil(cupom.getBoundingClientRect().height * 25.4 / 96) + 2);
    regra.textContent = `@page { size: 72mm ${altura}mm; margin: 0; }`;
    if (await antesDeEnviar() === false) return false;
    if (!valida() || signal?.aborted) return false;
    document.head.append(regra);
    document.body.dataset.pnAutoPrint = 'true';
    await new Promise((ok, falha) => {
      const limpar = () => { clearTimeout(limite); window.removeEventListener('afterprint', terminou); signal?.removeEventListener('abort', cancelou); };
      const terminou = () => { limpar(); ok(); };
      const cancelou = () => { limpar(); falha(new Error('sessao')); };
      const limite = setTimeout(() => { limpar(); falha(new Error('sem_retorno')); }, PRAZO);
      window.addEventListener('afterprint', terminou, { once: true });
      signal?.addEventListener('abort', cancelou, { once: true });
      try { window.print(); } catch (e) { limpar(); falha(e); }
    });
    return true;
  } finally {
    folha.remove(); regra.remove(); delete document.body.dataset.pnAutoPrint;
  }
}

export function montarImpressaoAutomatica(root, { pedidos: todosPedidos, online, comanda, teste, podeImprimir, configurar }) {
  // A aprovação chega como atualização financeira do mesmo pedido, antes de qualquer avanço operacional.
  const pedidos = () => todosPedidos().filter(p => !p.pagamentoOnline || p.pagamentoOnline === 'aprovado');
  const esc = window.ML.fmt.esc, numero = window.ML.fmt.numero;
  const slot = root.querySelector('[data-impressao-config]');
  const resumo = root.querySelector('[data-impressao-resumo]');
  let fila, ativa = false, visivel = false, ocupada = false, testeOk = false;
  let erro = '', assinatura = '', ultima = '', dados = { ativa: false, trabalhos: [] }, relogio, rodando, abortarImpressao;
  let sincronizando = Promise.resolve();
  const suporte = !!(window.indexedDB && navigator.locks);
  const pronta = abrirFilaImpressao().then(f => { fila = f; }).catch(() => {
    erro = 'O navegador não conseguiu guardar a fila. A impressão automática está indisponível; use Imprimir no pedido.';
  });

  function render() {
    if (!visivel) return;
    const pendentes = dados.trabalhos.filter(t => t.estado === 'pendente');
    const conferir = dados.trabalhos.filter(t => t.estado === 'conferir');
    const texto = conferir.length ? `${conferir.length} comanda(s) precisam de conferência`
      : ocupada ? 'Enviando comanda à impressão…'
      : ativa && pendentes.length ? `${pendentes.length} comanda(s) na fila de impressão`
      : ativa ? 'Impressão automática ativa neste computador' : 'Impressão automática desligada neste computador';
    const html = `<div class="pn-auto-cab"><h3>Impressão automática</h3><span class="pn-auto-estado">${esc(texto)}</span></div>
      <p>Os próximos pedidos novos entram na fila deste navegador. Ative somente no computador ligado à P180 da loja. Pedidos já existentes não são impressos ao ativar.</p>
      <ol class="pn-auto-passos"><li>Defina a impressora da loja como padrão no computador e confira o papel e a conexão.</li><li>Para sair direto no papel, abra o painel pelo atalho de impressão direta. No navegador comum, a janela de impressão continua aparecendo.</li><li>Faça o teste e confira o cupom antes de ativar.</li></ol>
      <div class="pn-auto-acoes"><a class="pn-btn" href="/impressao/Abrir-Mineiro-Impressao.cmd" download>Baixar atalho para Windows</a><a class="pn-btn" href="/impressao/Leia-antes-de-imprimir.txt" target="_blank" rel="noopener">Como preparar o computador</a></div>
      <p class="pn-erro" role="alert" ${erro ? '' : 'hidden'}>${esc(erro)}</p>
      ${!suporte ? '<p class="pn-erro">Use uma versão atual do Chrome ou Edge no computador para ativar com proteção entre abas.</p>' : ''}
      <div class="pn-auto-acoes"><button type="button" class="pn-btn" data-auto="teste" ${ocupada || !suporte || !fila ? 'disabled' : ''}>Testar impressão</button>${ativa ? `<button type="button" class="pn-btn" data-auto="pausar">Pausar impressão automática</button>` : `<button type="button" class="pn-btn pn-btn--prim" data-auto="ativar" ${!testeOk || ocupada || !suporte || !fila || !online() ? 'disabled' : ''}>O teste saiu: ativar neste computador</button>`}</div>
      ${!online() ? '<p class="pn-auto-ajuda">Conecte este computador ao sistema para ativar ou enviar as próximas comandas.</p>' : ''}
      ${testeOk && !ativa ? '<p>Confira o papel. Se o teste saiu na impressora correta, ative no botão acima.</p>' : ''}
      <p class="pn-auto-ajuda">${esc(ultima || 'O navegador não confirma se saiu papel ou se a impressão foi cancelada. Confira a impressora. Mantenha o painel aberto e esta janela visível.')}</p>
      ${dados.trabalhos.length ? `<div class="pn-auto-fila"><h4>Comandas pendentes</h4>${dados.trabalhos.slice(0, 20).map(t => `<div class="pn-auto-item"><div><b>${esc(numero(t.numero))}</b><p>${esc(t.estado === 'pendente' ? 'Aguardando envio à impressão' : t.estado === 'enviando' ? 'Em envio pelo navegador' : t.motivo)}</p></div>${t.estado === 'conferir' ? `<div class="pn-auto-acoes"><button type="button" class="pn-btn" data-auto="reenviar" data-auto-id="${esc(t.id)}" ${ocupada ? 'disabled' : ''}>Enviar novamente</button><button type="button" class="pn-btn" data-auto="conferido" data-auto-id="${esc(t.id)}" ${ocupada ? 'disabled' : ''}>Já saiu no papel</button></div>` : ''}</div>`).join('')}${dados.trabalhos.length > 20 ? '<p>As próximas comandas aparecem conforme a fila avançar.</p>' : ''}</div>` : ''}`;
    if (html !== assinatura) {
      const foco = slot.contains(document.activeElement) ? { acao: document.activeElement.dataset.auto, id: document.activeElement.dataset.autoId } : null;
      slot.innerHTML = html; assinatura = html;
      if (foco?.acao) [...slot.querySelectorAll('[data-auto]')].find(e => e.dataset.auto === foco.acao && e.dataset.autoId === foco.id)?.focus({ preventScroll: true });
    }
    const curto = `<span>${esc(texto)}</span><button type="button" class="pn-btn" data-auto="configurar">${conferir.length ? 'Conferir comandas' : 'Configurar impressão'}</button>`;
    if (resumo.innerHTML !== curto) resumo.innerHTML = curto;
    resumo.classList.toggle('pn-auto-resumo--atencao', !!conferir.length || !!erro);
  }
  async function ler() {
    await pronta;
    if (fila) { dados = await fila.resumo(); ativa = dados.ativa; }
    render();
  }
  function observar() {
    sincronizando = sincronizando.then(async () => {
      await pronta;
      if (visivel && fila && online()) await fila.observar(pedidos());
      await ler();
    }).catch(() => { erro = 'Não foi possível atualizar a fila. Confira o armazenamento do navegador e as comandas pendentes.'; render(); });
    return sincronizando;
  }
  async function ciclo() {
    if (rodando || !visivel || !suporte || document.hidden) return;
    rodando = (async () => {
      await observar();
      if (!fila || !ativa || !online() || !visivel) return;
      await navigator.locks.request(TRAVA, { ifAvailable: true }, async lock => {
        if (!lock || !visivel) return;
        await fila.recuperarInterrompidas();
        await ler();
        if (!ativa || dados.trabalhos.some(t => t.estado === 'conferir') || !podeImprimir()) return;
        const trabalho = dados.trabalhos.find(t => t.estado === 'pendente');
        if (!trabalho) return;
        const p = pedidos().find(p => p.id === trabalho.id);
        if (!p) { await fila.marcar(trabalho.id, 'conferir', 'Pedido não está disponível na consulta atual. Confira o painel antes de reenviar.'); await ler(); return; }
        if (p.status === 'cancelado') { await fila.observar(pedidos()); await ler(); return; }
        ocupada = true; render();
        abortarImpressao = new AbortController();
        try {
          const valida = () => {
            const atual = pedidos().find(a => a.id === p.id);
            return visivel && online() && !document.hidden && podeImprimir() && !!atual && atual.status !== 'cancelado';
          };
          const enviou = await enviarComanda(comanda(p), {
            valida, signal: abortarImpressao.signal,
            antesDeEnviar: () => fila.iniciarEnvio(p.id)
          });
          await fila.marcar(p.id, enviou ? 'enviado' : 'pendente', '', ['enviando']);
          if (enviou) ultima = 'Comanda ' + numero(p.numero) + ' enviada à impressão. Confira se saiu no papel.';
        } catch {
          await fila.marcar(p.id, 'conferir', 'Não foi possível confirmar o retorno da impressão. Confira o papel antes de enviar novamente.', ['enviando', 'pendente']);
        } finally { ocupada = false; abortarImpressao = null; await ler(); }
      });
    })().catch(() => { erro = 'Não foi possível processar a fila. Confira as comandas antes de tentar novamente.'; render(); }).finally(() => { rodando = null; });
    return rodando;
  }
  async function acao(e) {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    const a = b.dataset.auto;
    if (a === 'configurar') { configurar(); return; }
    if (ocupada && a !== 'pausar') return;
    await pronta;
    if (!fila || !visivel) return;
    erro = '';
    try {
      if (a === 'teste') {
        await navigator.locks.request(TRAVA, { ifAvailable: true }, async lock => {
          if (!lock) { erro = 'Outra aba está usando a impressão. Aguarde e tente novamente.'; return; }
          ocupada = true; render();
          abortarImpressao = new AbortController();
          try { testeOk = await enviarComanda(teste(), { valida: () => visivel, signal: abortarImpressao.signal }); }
          catch { erro = 'O teste não retornou. Confira o computador e a impressora antes de tentar novamente.'; }
          finally { ocupada = false; abortarImpressao = null; }
        });
      } else if (a === 'ativar' && testeOk && online()) {
        await observar();
        await fila.observar(pedidos(), true);
        ultima = 'Ativada neste computador. Os próximos pedidos novos entram na fila.';
      } else if (a === 'pausar') {
        await fila.observar(pedidos(), false);
        ultima = 'Impressão automática pausada. As comandas pendentes foram preservadas.';
      } else if (['reenviar', 'conferido'].includes(a)) {
        // A resolução também usa a mesma trava: não pode alterar uma impressão em andamento em outra aba.
        await navigator.locks.request(TRAVA, async () => {
          const atual = await fila.resumo();
          if (!atual.trabalhos.some(t => t.id === b.dataset.autoId && t.estado === 'conferir')) return;
          await fila.marcar(b.dataset.autoId, a === 'reenviar' ? 'pendente' : 'enviado');
        });
      }
      await ler();
      if (a !== 'teste') ciclo();
    } catch { erro = 'Não foi possível salvar a mudança. Confira o navegador e tente novamente.'; render(); }
  }
  root.addEventListener('click', acao);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ciclo(); });
  window.addEventListener('focus', ciclo);
  return {
    atualizar: () => { observar().then(ciclo); },
    mostrar() { visivel = true; observar().then(ciclo); if (!relogio) relogio = setInterval(ciclo, 2000); },
    esconder() { visivel = false; abortarImpressao?.abort(); clearInterval(relogio); relogio = null; slot.textContent = ''; resumo.textContent = ''; assinatura = ''; },
    ocupada: () => ocupada,
    registrarManual(id) { if (id && fila && visivel) fila.marcar(id, 'enviado').then(ler).catch(() => {}); }
  };
}

window.MLImpressao = { montar: montarImpressaoAutomatica };
