/* Mineiro Lanche · painel sempre na versão publicada.
   O painel fica aberto por dias e não recarrega sozinho: depois de uma publicação seguia rodando o código anterior
   (30/10: um dia depois da retirada do motoboy, o quadro ainda mostrava "Aguardando saída do motoboy", sem o botão).
   A cada 5 min, ao voltar para a aba e ao reconectar, lê /painel/ sem cache e compara o script de entrada com o que está rodando.
   Versão nova: aviso fixo com "Atualizar agora". Recarrega sozinho só com a loja fechada (sem pedido novo chegando, o som
   não faz falta), na tela de Pedidos ou Histórico, sem ninguém mexer há 1 min, nada sendo digitado, nenhuma janela ou
   detalhe aberto e sem comanda em envio (segura a trava da impressão automática até a página sair).
   Depois de recarregar, o navegador só libera o som de pedido novo num toque: o aviso pede esse toque. */

const PAGINA = '/painel/';
const INTERVALO = 5 * 60_000;
const QUIETO = 60_000;
const TRAVA_IMPRESSAO = 'mineiro-impressao-local-v1'; // a mesma de impressao-automatica.js
const CHAVE_ATUALIZADO = 'mineiro:v2:painel-atualizado'; // sessionStorage: não começa com a chave da sessão (o Sair apaga por prefixo)

const entrada = doc => doc.querySelector('script[type="module"][src]')?.getAttribute('src') || '';

export function acompanharVersao() {
  const atual = entrada(document);
  if (!atual) return;
  const quadro = document.getElementById('view-painel');
  let nova = false, conferindo = false, saindo = false, conferidoEm = Date.now(), ultimoToque = Date.now(), aviso = null;

  function mostrarAviso(tipo, html) {
    if (!aviso || !aviso.isConnected) {
      aviso = document.createElement('div');
      aviso.className = 'pn-versao';
      aviso.setAttribute('role', 'status');
      document.body.appendChild(aviso);
    }
    aviso.dataset.versao = tipo;
    aviso.innerHTML = html;
  }
  function tirarAviso() {
    if (aviso) aviso.remove();
    aviso = null;
  }

  function recarregar(sozinho) {
    if (saindo) return;
    const ir = () => {
      saindo = true;
      try { sessionStorage.setItem(CHAVE_ATUALIZADO, '1'); } catch { /* sem o aviso do som depois de recarregar */ }
      location.reload();
      return new Promise(() => {}); // a trava só sai com a página: a impressão não começa uma comanda no meio da troca
    };
    if (!navigator.locks) { ir(); return; }
    // Sozinho: pula se uma comanda estiver em envio e tenta no próximo minuto. No botão: espera a comanda terminar.
    navigator.locks.request(TRAVA_IMPRESSAO, { ifAvailable: !!sozinho }, lock => (lock ? ir() : undefined)).catch(() => {});
  }

  async function conferir() {
    if (nova || conferindo || !navigator.onLine) return;
    conferindo = true;
    conferidoEm = Date.now();
    try {
      const r = await fetch(PAGINA, { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const publicada = entrada(new DOMParser().parseFromString(await r.text(), 'text/html'));
      if (!publicada || publicada === atual) return;
      nova = true;
      mostrarAviso('nova', '<p>Saiu uma versão nova do painel.</p><button type="button" class="pn-btn pn-btn--prim" data-versao-atualizar>Atualizar agora</button>');
      tentarSozinho();
    } catch {
      /* sem rede ou resposta inesperada: confere de novo no próximo ciclo */
    } finally {
      conferindo = false;
    }
  }

  function lojaFechada() {
    if (!quadro || quadro.hidden) return true; // login ou "Sem acesso": o quadro não está tocando pedidos
    try { return !window.ML.horario.situacao().aberto; } catch { return false; }
  }
  function seguro() {
    const foco = document.activeElement;
    if (foco && foco.matches('input, textarea, select, [contenteditable="true"]')) return false;
    if (document.querySelector('.pn-modal, .pn-lateral--aberta')) return false;
    if (quadro && !quadro.hidden && !document.querySelector('.pn-sec[data-view="pedidos"]:not([hidden]), .pn-sec[data-view="historico"]:not([hidden])')) return false;
    return Date.now() - ultimoToque > QUIETO;
  }
  function tentarSozinho() {
    if (nova && lojaFechada() && seguro()) recarregar(true);
  }

  try {
    if (sessionStorage.getItem(CHAVE_ATUALIZADO)) {
      sessionStorage.removeItem(CHAVE_ATUALIZADO);
      mostrarAviso('som', '<p>Painel atualizado. Toque na tela para ligar o som dos pedidos.</p>');
    }
  } catch { /* sem sessionStorage: segue sem o aviso */ }

  const tocou = () => {
    ultimoToque = Date.now();
    // o som é liberado pelo próprio painel no primeiro toque com o quadro montado (painel.js, marcarInteracao)
    if (aviso && aviso.dataset.versao === 'som' && quadro && !quadro.hidden) tirarAviso();
  };
  document.addEventListener('pointerdown', tocou, true);
  document.addEventListener('keydown', tocou, true);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-versao-atualizar]')) recarregar(false);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
  window.addEventListener('online', conferir);
  setInterval(() => {
    if (nova) tentarSozinho();
    else if (Date.now() - conferidoEm >= INTERVALO) conferir();
  }, QUIETO);
}
