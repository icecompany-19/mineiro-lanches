// Só identificadores e estado operacional neste aparelho. Nunca guarda o conteúdo da comanda.
const DB = 'mineiro-impressao-v1';
const ESTADO = 'config';
const TRABALHOS = 'trabalhos';

export function abrirFilaImpressao(idb = globalThis.indexedDB) {
  if (!idb) return Promise.reject(new Error('armazenamento'));
  return new Promise((resolve, reject) => {
    const pedido = idb.open(DB, 1);
    pedido.onupgradeneeded = () => {
      pedido.result.createObjectStore(ESTADO);
      pedido.result.createObjectStore(TRABALHOS, { keyPath: 'id' });
    };
    pedido.onerror = () => reject(pedido.error);
    pedido.onblocked = () => reject(new Error('armazenamento_bloqueado'));
    pedido.onsuccess = () => {
      const db = pedido.result;
      db.onversionchange = () => db.close();
      function transacao(acao) {
        return new Promise((ok, falha) => {
          const tx = db.transaction([ESTADO, TRABALHOS], 'readwrite');
          const config = tx.objectStore(ESTADO), trabalhos = tx.objectStore(TRABALHOS);
          const cfg = config.get('local'), lista = trabalhos.getAll();
          let resultado;
          tx.oncomplete = () => ok(resultado);
          tx.onerror = () => falha(tx.error);
          tx.onabort = () => falha(tx.error || new Error('armazenamento'));
          lista.onsuccess = () => {
            // Os dois reads pertencem à mesma transação e são concluídos nesta ordem.
            const c = cfg.result || { ativa: false };
            resultado = acao({ c, lista: lista.result, config, trabalhos });
          };
        });
      }
      resolve({
        async observar(pedidos, ativar) {
          return transacao(({ c, lista, config, trabalhos }) => {
            const existentes = new Map(lista.map(t => [t.id, t]));
            const base = ativar !== undefined;
            for (const p of pedidos) {
              const antes = existentes.get(p.id);
              if (!antes) trabalhos.put({ id: p.id, numero: p.numero, criadoEm: p.criadoEm,
                estado: !base && c.ativa && p.status === 'novo' && p.origem !== 'exemplo' ? 'pendente' : 'ignorado' });
              else if (p.status === 'cancelado' && ['pendente', 'conferir'].includes(antes.estado)) {
                // A store é otimista: um cancelamento recusado pode voltar ao estado anterior.
                trabalhos.put({ ...antes, estado: 'cancelado', antesCancelamento: antes.estado });
              } else if (p.status !== 'cancelado' && antes?.estado === 'cancelado') {
                trabalhos.put({ ...antes, estado: antes.antesCancelamento || 'pendente', antesCancelamento: undefined });
              }
            }
            if (base) config.put({ ...c, ativa: ativar }, 'local');
          });
        },
        async resumo() {
          return transacao(({ c, lista }) => ({ ativa: c.ativa,
            trabalhos: lista.filter(t => ['pendente', 'enviando', 'conferir'].includes(t.estado))
              .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)) || a.id.localeCompare(b.id)) }));
        },
        async iniciarEnvio(id) {
          return transacao(({ c, lista, trabalhos }) => {
            const t = lista.find(t => t.id === id);
            if (!c.ativa || t?.estado !== 'pendente') return false;
            trabalhos.put({ ...t, estado: 'enviando', motivo: '' });
            return true;
          });
        },
        async marcar(id, estado, motivo = '', permitidos) {
          return transacao(({ lista, trabalhos }) => {
            const t = lista.find(t => t.id === id);
            if (t && (!permitidos || permitidos.includes(t.estado))) trabalhos.put({ ...t, estado, motivo });
          });
        },
        async recuperarInterrompidas() {
          return transacao(({ lista, trabalhos }) => {
            for (const t of lista.filter(t => t.estado === 'enviando')) {
              trabalhos.put({ ...t, estado: 'conferir', motivo: 'A impressão foi interrompida. Confira se o cupom saiu antes de enviar novamente.' });
            }
          });
        },
        fechar: () => db.close()
      });
    };
  });
}
