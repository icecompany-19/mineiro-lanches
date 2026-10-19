// A confirmação só sai da fila depois do reconhecimento do servidor. Cada evento tem sua própria chave:
// duas abas não regravam uma lista inteira nem apagam uma confirmação adicionada pela outra.
export function abrirArmazenamento(usuario, indexedDB = globalThis.indexedDB) {
  let banco;
  const pronto = new Promise((resolve, reject) => {
    const r = indexedDB.open('mineiro-entregas-v1', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('fila', { keyPath: 'evento' });
      r.result.createObjectStore('cache', { keyPath: 'usuario' });
    };
    r.onsuccess = () => { banco = r.result; resolve(); };
    r.onerror = () => reject(r.error);
  });
  async function executar(tabela, modo, operacao) {
    await pronto;
    return new Promise((resolve, reject) => {
      const tx = banco.transaction(tabela, modo);
      const r = operacao(tx.objectStore(tabela));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Armazenamento indisponível'));
    });
  }
  return {
    async listar() { return (await executar('fila', 'readonly', s => s.getAll())).filter(e => e.usuario === usuario); },
    salvar(e) { return executar('fila', 'readwrite', s => s.put({ ...e, usuario })); },
    remover(evento) { return executar('fila', 'readwrite', s => s.delete(evento)); },
    async cache() { return (await executar('cache', 'readonly', s => s.get(usuario))) || { lista: [] }; },
    guardarCache(lista) { return executar('cache', 'readwrite', s => s.put({ usuario, lista, em: new Date().toISOString() })); },
    async taxas(dias) { return (await executar('cache', 'readonly', s => s.get(`${usuario}:taxas:${dias}`)))?.resumo || null; },
    guardarTaxas(dias, resumo) { return executar('cache', 'readwrite', s => s.put({ usuario: `${usuario}:taxas:${dias}`, resumo })); },
    async operacaoRotas() {
      const registro = await executar('cache', 'readonly', s => s.get(`${usuario}:rotas`));
      const resumo = registro?.resumo || null, viagem = resumo?.viagem;
      if (viagem) {
        let mudou = false;
        if (viagem.geometria && Date.parse(viagem.geometriaAte) <= Date.now()) { viagem.geometria = null; mudou = true; }
        for (const p of viagem.paradas || []) if (p.ponto && Date.parse(p.pontoAte) <= Date.now()) { p.ponto = null; mudou = true; }
        if (mudou) await executar('cache', 'readwrite', s => s.put(registro)).catch(() => {});
      }
      return resumo;
    },
    guardarOperacaoRotas(resumo) { return executar('cache', 'readwrite', s => s.put({ usuario: `${usuario}:rotas`, resumo })); },
    async fechar() { await pronto; banco.close(); }
  };
}

export function criarFila({ armazenamento, enviar, aoMudar = () => {}, aoConfirmar = () => {}, agora = Date.now, uuid = () => crypto.randomUUID() }) {
  let enviando = false, parado = false;
  async function avisar() { const lista = await armazenamento.listar(); if (!parado) aoMudar(lista); return lista; }
  return {
    async adicionar(pedido) {
      const existente = (await armazenamento.listar()).find(e => e.id === pedido.id);
      if (existente) return existente;
      const e = { evento: uuid(), id: pedido.id, numero: pedido.numero ?? null, atribuicao: pedido.atribuicao || null,
        confirmadoEm: new Date(agora()).toISOString(), estado: 'pendente', tentativas: 0, proxima: 0 };
      await armazenamento.salvar(e); // erro de disco/quota deve chegar à tela, nunca fingir sucesso
      await avisar();
      return e;
    },
    listar: avisar,
    async reconhecerCancelamento(evento, reconhecer) {
      const e = (await armazenamento.listar()).find(e => e.evento === evento && e.codigo === 'pedido_cancelado');
      if (!e || parado || enviando) throw new Error('Aguarde a sincronização e tente novamente');
      enviando = true;
      try {
        const r = await reconhecer(e);
        if (r?.ok !== true || r.ocorrencia !== true || r.evento !== evento) throw new Error('Ocorrência não reconhecida');
        await armazenamento.remover(evento);
      } finally { enviando = false; await avisar(); }
    },
    async sincronizar(forcar = false) {
      if (enviando || parado) return;
      enviando = true;
      try {
        for (const e of await armazenamento.listar()) {
          if (parado) break;
          if (!forcar && (e.estado === 'atencao' || e.proxima > agora())) continue;
          try {
            const r = await enviar(e);
            if (r?.ok !== true || r.pedido?.id !== e.id || r.pedido?.status !== 'entregue') {
              throw Object.assign(new Error('Resposta sem reconhecimento'), { codigo: 'rede' });
            }
            await armazenamento.remover(e.evento);
            if (!parado) aoConfirmar(r);
          } catch (erro) {
            e.codigo = erro.codigo || 'rede';
            e.estado = e.codigo === 'rede' ? 'pendente' : 'atencao';
            e.tentativas++;
            e.proxima = agora() + Math.min(60000, 2000 * 2 ** Math.min(e.tentativas, 5));
            await armazenamento.salvar(e);
            // Falha de rede/sessão afeta a fila inteira: não martelar o servidor.
            if (['rede', 'sessao', 'sem_permissao'].includes(e.codigo)) break;
          }
        }
      } finally {
        enviando = false;
        await avisar();
      }
    },
    parar() { parado = true; }
  };
}
