/* Mineiro Lanche · ML.store sobre o Supabase (docs/CONTRATO-API.md).
   Mesmo contrato da store da prévia (docs/CONTRATO-PAINEL.md), para app.js e painel.js quase não mudarem:
   - leituras síncronas (pedidos, esgotados, loja) de um cache em memória carregado do servidor;
   - escritas pelas RPCs, com atualização otimista; se o servidor recusar, desfaz e avisa ('store:erro');
   - os mesmos eventos de antes (pedido:novo, pedido:status, pedidos:limpos, cardapio:esgotados, loja:modo,
     config), achados comparando id e status a cada recarga. A carga inicial não dispara pedido:novo.
   Mudanças chegam pelo Realtime; enquanto o canal não está SUBSCRIBED (ou no Supabase local, que não tem
   Realtime), o plano B consulta de tempos em tempos: painel a cada 5 s, cardápio a cada 60 s, e sempre ao
   voltar para a aba ou ao voltar a rede. Config (som e tempos) continua local, por aparelho.
   Pedidos nunca voltam no tempo: o historico só cresce (+1 a cada mudança de status), então uma versão com
   historico menor que a do cache é mais velha; e a foto de uma consulta não desfaz o que chegou (Realtime ou
   RPC) enquanto ela estava no ar. */
import { obterSupabase, consultarEntrega } from './supabase.js';

const NS = 'mineiro:v2:';
const CODIGOS = [
  'dados_invalidos',
  'produto_invalido',
  'produto_esgotado',
  'loja_fechada',
  'muitos_pedidos',
  'sem_permissao',
  'transicao_invalida',
  'nao_encontrado',
  'cotacao_necessaria',
  'cotacao_expirada',
  'cotacao_endereco_divergente'
];
const JANELA_MS = 48 * 3600e3; // o painel lê os pedidos das últimas 48 h
const TEMPO_LIMITE = 15000; // RPC sem resposta em 15 s conta como falta de rede
const CONFIG_PADRAO = { som: true, atencaoMin: 15, atrasoMin: 25 };

// avisos do painel quando o servidor recusa uma mudança (a tela já foi desfeita)
const AVISO = {
  transicao_invalida: 'Esse pedido já tinha mudado em outro aparelho. O quadro foi atualizado.',
  nao_encontrado: 'Esse pedido não está mais no servidor. O quadro foi atualizado.',
  sem_permissao: 'Este usuário não tem permissão para isso.',
  dados_invalidos: 'O servidor recusou a mudança. Confira e tente de novo.',
  produto_esgotado: 'Um item do pedido está esgotado hoje.',
  produto_invalido: 'Um item do pedido não está no cardápio.',
  sessao: 'O login precisou ser renovado e a mudança não foi salva. Tente de novo.',
  rede: 'Sem conexão com o servidor: a mudança não foi salva. Tente de novo.'
};

// ---------- localStorage com prefixo (por aparelho) ----------
function ler(k, padrao) {
  try {
    const v = localStorage.getItem(NS + k);
    return v == null ? padrao : JSON.parse(v);
  } catch {
    return padrao;
  }
}
function gravar(k, v) {
  try {
    localStorage.setItem(NS + k, JSON.stringify(v));
  } catch {
    /* sem storage: fica só em memória */
  }
}

// ---------- formato dos pedidos ----------
const num = (v) => (v == null || v === '' ? 0 : Number(v));
// timestamptz do PostgREST ("…+00:00") ou do Realtime ("2026-10-08 22:01:02.1+00") → ISO
function isoDe(v) {
  if (!v) return new Date().toISOString();
  let s = String(v).replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
function itemDe(i) {
  return Object.assign({}, i, {
    qtd: num(i.qtd),
    precoBase: num(i.precoBase),
    precoUnit: num(i.precoUnit),
    subtotal: num(i.subtotal),
    removidos: i.removidos || [],
    combo: i.combo || { ativo: false, refri: '' },
    adicionais: (i.adicionais || []).map((a) => Object.assign({}, a, { qtd: num(a.qtd), preco: num(a.preco) })),
    sabor: i.sabor || ''
  });
}
// linha crua da tabela pedidos (select ou Realtime) → formato do pedido_json (contrato do painel)
export function linhaParaPedido(r) {
  return {
    id: r.id,
    numero: num(r.numero),
    token: r.token || null,
    criadoEm: isoDe(r.criado_em),
    origem: r.origem || 'cardapio',
    mesa: r.mesa || null,
    cliente: { nome: r.cliente_nome || '', telefone: r.cliente_telefone || '' },
    modo: r.modo,
    endereco: r.endereco || '',
    referencia: r.referencia || '',
    pagamento: r.pagamento || null,
    troco: r.troco || '',
    obs: r.obs || '',
    itens: (r.itens || []).map(itemDe),
    total: num(r.total),
    // taxa de entrega por distância (null = a combinar): km da rota e valor gravados pelo servidor
    distanciaKm: r.distancia_km == null ? null : Number(r.distancia_km),
    taxaEntrega: r.taxa_entrega == null ? null : Number(r.taxa_entrega),
    status: r.status,
    historico: r.historico || []
  };
}
// saída das RPCs (pedido_json) → mesmo formato, com os números como Number
export function pedidoDoServidor(j) {
  const c = j.cliente || {};
  return linhaParaPedido(
    Object.assign({}, j, { criado_em: j.criadoEm, cliente_nome: c.nome, cliente_telefone: c.telefone, distancia_km: j.distanciaKm, taxa_entrega: j.taxaEntrega })
  );
}
// o que o acompanhamento guarda (sem nome, telefone nem endereço)
function acompanhamentoDe(p) {
  return {
    token: p.token,
    numero: num(p.numero),
    criadoEm: isoDe(p.criadoEm),
    status: p.status,
    historico: p.historico || [],
    modo: p.modo,
    mesa: p.mesa || null,
    total: num(p.total),
    distanciaKm: p.distanciaKm == null ? null : Number(p.distanciaKm),
    taxaEntrega: p.taxaEntrega == null ? null : Number(p.taxaEntrega),
    itens: (p.itens || []).map((i) =>
      i.produtoId ? itemDe(i) : { nome: i.nome, qtd: num(i.qtd), resumo: i.resumo || '', subtotal: num(i.subtotal) }
    )
  };
}

// ---------- erros ----------
// o banco manda só o código na mensagem (raise exception '<codigo>'); o resto vira 'rede' ou 'sessao'
export function codigoDoErro(e) {
  if (!e) return 'rede';
  if (e.codigo) return e.codigo;
  const m = String(e.message || '').trim();
  if (CODIGOS.indexOf(m) >= 0) return m;
  if (/^PGRST30/.test(e.code || '') || /jwt/i.test(m)) return 'sessao';
  if (e.code === '42501') return 'sem_permissao';
  return 'rede';
}
function erroCom(codigo, causa) {
  const e = new Error(codigo);
  e.codigo = codigo;
  e.causa = causa;
  return e;
}

// ---------- pedido do checkout → entrada do criar_pedido ----------
// itens no formato de itemDoPedido do core.js; adicionais como lista [{ id, qtd }], na ordem da escolha
function entradaDoPedido(ML, dados) {
  const t = (v) => String(v == null ? '' : v).trim();
  const cli = dados.cliente || {};
  return {
    cliente: { nome: t(cli.nome), telefone: t(cli.telefone) },
    modo: dados.modo || 'entrega',
    endereco: t(dados.endereco),
    referencia: t(dados.referencia),
    // Compatibilidade de transição. Com cotação ativa o servidor obtém os km da cotação privada.
    distanciaKm: dados.modo !== 'local' && dados.modo !== 'retirada' && Number(dados.distanciaKm) > 0 ? Number(dados.distanciaKm) : null,
    cotacaoId: dados.cotacaoId || null,
    pagamento: dados.pagamento || null,
    troco: t(dados.troco),
    obs: t(dados.obs),
    origem: dados.origem || 'cardapio',
    mesa: dados.mesa || null,
    idempotencia: dados.idempotencia || null,
    itens: (dados.itens || []).map((sel) => {
      const it = ML.precos.item(sel);
      return {
        produtoId: it.produtoId,
        qtd: it.qtd,
        completo: it.completo,
        removidos: it.removidos,
        prensado: it.prensado,
        combo: it.combo,
        adicionais: it.adicionais.map((a) => ({ id: a.id, qtd: a.qtd })),
        sabor: it.sabor
      };
    })
  };
}

// ================= a store =================
// opc.papel: 'cliente' (cardápio e acompanhamento) ou 'painel' (equipe, com login)
// opc.aoSessaoExpirada(): o servidor recusou o login guardado (painel)
export function criarStoreSupabase(opc) {
  opc = opc || {};
  const ML = window.ML;
  const C = ML.CONFIG;
  const painel = opc.papel === 'painel';
  const intervalo = opc.intervalo || (painel ? 5000 : 60000); // plano B sem Realtime
  // conferência com o canal ligado. O cardápio também a cada 60 s (CONTRATO): adicionais não estão no Realtime
  const intervaloComCanal = opc.intervaloComCanal || 60000;
  const cliente = () => obterSupabase({ sessao: painel });

  // estado em memória
  let pedidos = [];
  let esgotados = {};
  let loja = { modo: 'auto', aceitaFechada: false };
  let pedidosCarregados = false;
  let online = true;
  const pendPedidos = new Map(); // id → { p, eco } enquanto a RPC não volta (a recarga não desfaz o otimista)
  // versão local: cada pedido trocado ou apagado no cache (Realtime, RPC, otimista) ganha a próxima versão.
  // Uma consulta guarda a versão do início; o que mudou depois dela vale mais que a foto que ela trouxe.
  let versao = 0;
  const tocado = new Map(); // id → versão da última mudança local
  const pendEsgotados = new Map(); // id → { v }
  let pendLoja = null;
  const acompanhamentos = new Map(); // token → acompanhamento (null = não existe)

  // o cardápio original: o banco pode desativar itens e adicionais (saem da tela) e trocar preços
  const ITENS = {};
  C.categorias.forEach((c) => (ITENS[c.id] = c.itens.slice()));
  const ADICIONAIS = C.adicionais.slice();
  let assinaturaCardapio = assinatura({
    precos: Object.fromEntries(Object.keys(ML.produtos).map((id) => [id, ML.produtos[id].preco])),
    inativos: [],
    adicionais: Object.fromEntries(ADICIONAIS.map((a) => [a.id, a.preco])),
    loja: { aceitaFechada: false, comboPreco: C.regras.combo.preco, taxaKm: C.entrega.taxa.porKm, taxaFixa: C.entrega.taxa.fixa, horarios: C.horarios }
  });

  // ---------- eventos ----------
  let ouvintes = [];
  let fila = null; // durante um lote (gerarExemplos), os eventos esperam e saem juntos no fim
  function emitir(tipo, dados) {
    const ev = { tipo, dados: dados || null, em: Date.now() };
    if (fila) {
      fila.push(ev);
      return;
    }
    ouvintes.slice().forEach((fn) => {
      try {
        fn(ev);
      } catch {
        /* ouvinte com erro não derruba os outros */
      }
    });
  }
  function avisar(e, contexto) {
    const codigo = codigoDoErro(e);
    if (codigo === 'sessao' && opc.aoSessaoExpirada) opc.aoSessaoExpirada();
    emitir('store:erro', { codigo, mensagem: AVISO[codigo] || AVISO.rede, contexto: contexto || null });
  }
  function conexao(ok) {
    if (ok === online) return;
    online = ok;
    emitir('store:conexao', { online: ok });
  }

  // ---------- chamadas ao servidor ----------
  async function rpc(nome, args) {
    let sb;
    try {
      sb = await cliente();
    } catch (e) {
      throw erroCom('rede', e);
    }
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), TEMPO_LIMITE);
    try {
      const { data, error } = await sb.rpc(nome, args || {}).abortSignal(ctrl.signal);
      if (error) throw erroCom(codigoDoErro(error), error);
      return data;
    } catch (e) {
      throw e && e.codigo ? e : erroCom('rede', e);
    } finally {
      clearTimeout(relogio);
    }
  }

  // ---------- pedidos (painel) ----------
  const porData = (a, b) => new Date(a.criadoEm) - new Date(b.criadoEm);
  function aplicarPedidos(lista, inicial) {
    const antes = new Map(pedidos.map((p) => [p.id, p]));
    pedidos = lista.map((p) => (pendPedidos.has(p.id) ? pendPedidos.get(p.id).p : p)).sort(porData);
    if (inicial) return;
    const ids = new Set();
    pedidos.forEach((p) => {
      ids.add(p.id);
      const a = antes.get(p.id);
      if (!a) emitir('pedido:novo', { id: p.id });
      else if (a.status !== p.status) emitir('pedido:status', { id: p.id, status: p.status });
    });
    for (const id of antes.keys()) {
      if (!ids.has(id)) {
        emitir('pedidos:limpos');
        break;
      }
    }
  }
  const hist = (p) => (p && p.historico ? p.historico.length : 0);
  const marcar = (id) => tocado.set(id, ++versao);
  // troca (ou acrescenta) um pedido no cache, sem conferir versão (otimista e desfazer)
  function guardarPedido(p) {
    marcar(p.id);
    const lista = pedidos.filter((x) => x.id !== p.id);
    lista.push(p);
    aplicarPedidos(lista, false);
  }
  // versão que veio do servidor (Realtime ou resposta de RPC): não troca o cache por uma mais velha
  function receberPedido(p) {
    const atual = pedidos.find((x) => x.id === p.id);
    if (atual && hist(atual) > hist(p)) return;
    guardarPedido(p);
  }
  function tirarPedidos(ids) {
    ids.forEach(marcar);
    aplicarPedidos(
      pedidos.filter((p) => ids.indexOf(p.id) < 0),
      false
    );
  }
  // foto da consulta (tirada quando o cache estava na versão "desde") sobre o cache atual:
  // - pedido mexido depois do início da consulta: fica o do cache, a não ser que a foto seja mais nova;
  //   se ele saiu do cache nesse meio-tempo (apagado), não volta; se não veio na foto (chegou depois), fica;
  // - os outros: vale a foto (o servidor já tinha tudo o que o cache sabia quando a consulta saiu).
  function juntarFoto(foto, desde) {
    const recente = (id) => (tocado.get(id) || 0) > desde;
    const cache = new Map(pedidos.map((p) => [p.id, p]));
    const naFoto = new Set();
    const lista = [];
    foto.forEach((p) => {
      naFoto.add(p.id);
      const c = cache.get(p.id);
      if (!c) {
        if (!recente(p.id)) lista.push(p);
        return;
      }
      lista.push(recente(p.id) && hist(p) <= hist(c) ? c : p);
    });
    cache.forEach((c, id) => {
      if (!naFoto.has(id) && recente(id)) lista.push(c);
    });
    // o que mudou antes desta foto já está nela: não precisa mais ser lembrado
    tocado.forEach((v, id) => {
      if (v <= desde) tocado.delete(id);
    });
    return lista;
  }
  async function carregarPedidos() {
    const sb = await cliente();
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), TEMPO_LIMITE);
    const desde = versao;
    try {
      const { data, error } = await sb
        .from('pedidos')
        .select('*')
        .gte('criado_em', new Date(Date.now() - JANELA_MS).toISOString())
        .order('criado_em')
        .abortSignal(ctrl.signal);
      if (error) throw erroCom(codigoDoErro(error), error);
      aplicarPedidos(juntarFoto((data || []).map(linhaParaPedido), desde), !pedidosCarregados);
      pedidosCarregados = true;
    } finally {
      clearTimeout(relogio);
    }
  }

  // ---------- estado do cardápio (todas as páginas) ----------
  function aplicarLoja(l) {
    if (!l) return;
    const antes = loja.modo;
    loja = { modo: l.modo || 'auto', aceitaFechada: !!l.aceitaFechada, cotacaoAtiva: !!l.cotacaoAtiva };
    if (pendLoja) loja.modo = pendLoja.v;
    // vale também na primeira carga: até ela o cardápio supõe 'auto' (pelo horário)
    if (loja.modo !== antes) emitir('loja:modo', { modo: loja.modo });
  }
  // aplica estado_cardapio() sobre o CONFIG: preços, inativos, adicionais, combo, horários, esgotados e loja
  function aplicarEstado(e) {
    if (!e) return;
    const inativos = new Set(e.inativos || []);
    const precos = e.precos || {};
    Object.keys(ML.produtos).forEach((id) => {
      const p = ML.produtos[id];
      if (Object.prototype.hasOwnProperty.call(precos, id)) p.preco = precos[id] == null ? null : Number(precos[id]);
      p.inativo = inativos.has(id);
    });
    C.categorias.forEach((c) => {
      const itens = (ITENS[c.id] || []).filter((p) => !inativos.has(p.id));
      c.itens.splice(0, c.itens.length, ...itens);
    });
    const adic = e.adicionais || {};
    // inativo fica marcado no próprio objeto (é o mesmo de ML.adicionais): a sacola acusa o adicional que saiu
    ADICIONAIS.forEach((a) => {
      if (adic[a.id] != null) a.preco = Number(adic[a.id]);
      a.inativo = adic[a.id] == null;
    });
    C.adicionais.splice(0, C.adicionais.length, ...ADICIONAIS.filter((a) => adic[a.id] != null));
    const l = e.loja || {};
    if (l.comboPreco != null) C.regras.combo.preco = Number(l.comboPreco);
    C.entrega.taxaAtiva = l.taxaKm != null && l.taxaFixa != null; // banco antigo (sem a migration 20261016000001): taxa a combinar
    if (l.taxaKm != null) C.entrega.taxa.porKm = Number(l.taxaKm);
    if (l.taxaFixa != null) C.entrega.taxa.fixa = Number(l.taxaFixa);
    if (l.horarios) ML.horario.definir(l.horarios);

    const nova = assinatura({
      precos,
      inativos: [...inativos].sort(),
      adicionais: adic,
      loja: { aceitaFechada: !!l.aceitaFechada, cotacaoAtiva: !!l.cotacaoAtiva, comboPreco: Number(l.comboPreco), taxaKm: Number(l.taxaKm), taxaFixa: Number(l.taxaFixa), horarios: l.horarios || C.horarios }
    });
    const mudouCardapio = nova !== assinaturaCardapio;
    assinaturaCardapio = nova;

    // esgotados do dia de operação (o banco já descarta os de ontem)
    const esgAntes = esgotados;
    const esg = {};
    (e.esgotados || []).forEach((id) => (esg[id] = true));
    pendEsgotados.forEach((pend, id) => {
      if (pend.v) esg[id] = true;
      else delete esg[id];
    });
    esgotados = esg;
    aplicarLoja(l);
    if (mudouCardapio) emitir('cardapio:estado', null);
    const ids = new Set(Object.keys(esgAntes).concat(Object.keys(esg)));
    ids.forEach((id) => {
      if (!!esgAntes[id] !== !!esg[id]) emitir('cardapio:esgotados', { id, esgotado: !!esg[id] });
    });
  }
  let estadoAgendado = null;
  function agendarEstado() {
    clearTimeout(estadoAgendado);
    estadoAgendado = setTimeout(() => carregarEstado().catch(() => {}), 250);
  }
  async function carregarEstado() {
    aplicarEstado(await rpc('estado_cardapio'));
  }

  // ---------- recarga (com uma só em andamento) ----------
  let emCurso = null;
  let deNovo = false;
  let resolverPrimeira = null;
  const primeiraCarga = new Promise((r) => (resolverPrimeira = r));
  async function carregar() {
    const r = await Promise.allSettled(painel ? [carregarEstado(), carregarPedidos()] : [carregarEstado()]);
    const falha = r.find((x) => x.status === 'rejected');
    if (falha) {
      const codigo = codigoDoErro(falha.reason);
      if (codigo === 'sessao' && opc.aoSessaoExpirada) opc.aoSessaoExpirada();
      conexao(codigo !== 'rede');
      throw falha.reason;
    }
    conexao(true);
    if (resolverPrimeira) {
      resolverPrimeira();
      resolverPrimeira = null;
    }
  }
  function recarregar() {
    if (!ativo) return Promise.resolve();
    if (emCurso) {
      deNovo = true;
      return emCurso;
    }
    emCurso = carregar().finally(() => {
      emCurso = null;
      if (deNovo) {
        deNovo = false;
        recarregar().catch(() => {});
      }
    });
    return emCurso;
  }

  // ---------- Realtime e plano B ----------
  let ativo = false;
  let canal = null;
  let canalOk = false;
  let relogio = null;
  function programar() {
    clearTimeout(relogio);
    if (!ativo) return;
    relogio = setTimeout(
      () => {
        // o cardápio só consulta com a aba visível; o painel sempre (pedido novo toca som com a aba atrás)
        const vai = painel || document.visibilityState === 'visible';
        (vai ? recarregar() : Promise.resolve()).catch(() => {}).then(programar);
      },
      canalOk ? intervaloComCanal : intervalo
    );
  }
  function aoMudarPedido(payload) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old && payload.old.id;
      if (id) tirarPedidos([id]);
      return;
    }
    if (!payload.new || !payload.new.id) return;
    const p = linhaParaPedido(payload.new);
    // com a RPC deste aparelho no ar, guarda o eco mais novo: vale se for mais novo que a resposta da RPC
    const pend = pendPedidos.get(p.id);
    if (pend) {
      if (!pend.eco || hist(p) > hist(pend.eco)) pend.eco = p;
      return;
    }
    receberPedido(p);
  }
  async function ligarCanal() {
    let sb;
    try {
      sb = await cliente();
    } catch {
      return; // sem o pacote: fica no plano B
    }
    if (!ativo || canal) return;
    // O phx_join precisa levar o JWT da equipe. O supabase-js só busca o token depois de abrir o socket, e o
    // join sairia sem access_token: o Realtime usaria a apikey (anon) e o RLS barraria os eventos de pedidos,
    // com o canal SUBSCRIBED (consulta só a cada 60 s). Com o token já no socket, o join e o rejoin o levam;
    // o token renovado segue no heartbeat seguinte. Se demorar (sem rede), segue: o heartbeat tenta de novo.
    if (painel) {
      try {
        await Promise.race([sb.realtime.setAuth(), new Promise((ok) => setTimeout(ok, 5000))]);
      } catch {
        /* segue: o heartbeat tenta de novo */
      }
      if (!ativo || canal) return;
    }
    canal = sb.channel('mineiro-' + (painel ? 'painel' : 'cardapio') + '-' + Math.random().toString(36).slice(2, 8));
    if (painel) canal.on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, aoMudarPedido);
    canal
      .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, agendarEstado)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loja' }, agendarEstado)
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        if (ok === canalOk) return;
        canalOk = ok;
        if (ok) recarregar().catch(() => {}); // pega o que mudou enquanto o canal estava fora
        programar();
      });
  }
  function aoVoltar() {
    if (document.visibilityState === 'visible') recarregar().catch(() => {});
  }
  function aoVoltarRede() {
    recarregar().catch(() => {});
  }

  // ---------- a API (mesmo contrato do ML.store da prévia) ----------
  const store = {
    papel: painel ? 'painel' : 'cliente',
    // liga a store: primeira carga, Realtime e plano B. A promessa resolve na primeira carga que der certo.
    iniciar() {
      if (!ativo) {
        ativo = true;
        recarregar().catch(() => {});
        programar();
        ligarCanal();
        document.addEventListener('visibilitychange', aoVoltar);
        window.addEventListener('online', aoVoltarRede);
      }
      return primeiraCarga;
    },
    parar() {
      ativo = false;
      clearTimeout(relogio);
      clearTimeout(estadoAgendado);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', aoVoltarRede);
      if (canal) {
        const c = canal;
        canal = null;
        canalOk = false;
        cliente()
          .then((sb) => sb.removeChannel(c))
          .catch(() => {});
      }
    },
    recarregar,
    online: () => online,
    buscarCepEntrega(cep, dispositivo, signal) { return consultarEntrega({acao:'cep',cep,dispositivo},signal); },
    cotarEntrega(dados, signal) { return consultarEntrega(dados,signal); },
    resumoEntregas() { return rpc('resumo_entregas',{}); },
    async definirOrigemEntrega(ponto) { await rpc('definir_origem_entrega',{p_lat:ponto.lat,p_lon:ponto.lon});await recarregar(); },

    pedidos: () => pedidos.slice(),
    pedido: (id) => pedidos.find((p) => p.id === id) || null,

    // dados = { cliente: { nome, telefone }, modo, endereco, referencia, pagamento, troco, obs, itens: [sel…],
    //           origem, mesa, idempotencia }. Devolve Promise com o pedido gravado (número e total do servidor).
    // Recusa com Error cujo .codigo é o do banco (loja_fechada, produto_esgotado…) ou 'rede'.
    async criarPedido(dados) {
      const p = pedidoDoServidor(await rpc('criar_pedido', { p: entradaDoPedido(ML, dados) }));
      if (painel) {
        if (!store.pedido(p.id)) guardarPedido(p);
      } else {
        store.lembrarMeu(p);
        emitir('pedido:novo', { id: p.id, token: p.token });
      }
      return p;
    },

    // otimista: o quadro muda na hora; se o servidor recusar, volta e avisa
    atualizarStatus(id, status, motivo) {
      const atual = store.pedido(id);
      if (!atual) return null;
      const evento = { status, em: new Date().toISOString() };
      if (motivo) evento.motivo = motivo;
      const otimista = Object.assign({}, atual, { status, historico: (atual.historico || []).concat([evento]) });
      const anterior = pendPedidos.get(id);
      const marca = { p: otimista, eco: anterior ? anterior.eco : null };
      pendPedidos.set(id, marca);
      guardarPedido(otimista);
      // o eco do Realtime que chegou com a RPC no ar vale se for mais novo (outro aparelho mexeu depois)
      const maisNovo = (p) => (marca.eco && hist(marca.eco) > hist(p) ? marca.eco : p);
      rpc('mudar_status', { p_id: id, p_status: status, p_motivo: motivo || null })
        .then((j) => {
          if (pendPedidos.get(id) === marca) pendPedidos.delete(id);
          if (!pendPedidos.has(id)) guardarPedido(maisNovo(pedidoDoServidor(j)));
        })
        .catch((e) => {
          if (pendPedidos.get(id) === marca) pendPedidos.delete(id);
          if (!pendPedidos.has(id)) guardarPedido(marca.eco && hist(marca.eco) >= hist(atual) ? marca.eco : atual);
          avisar(e, { acao: 'status', id });
          recarregar().catch(() => {});
        });
      return otimista;
    },
    avancar(id) {
      const p = store.pedido(id);
      const n = p && ML.regras.proximoStatus(p);
      return n ? store.atualizarStatus(id, n) : null;
    },
    // apaga só os pedidos de exemplo (origem 'exemplo'); devolve Promise com quantos saíram
    removerTestes() {
      const exemplos = pedidos.filter((p) => p.origem === 'exemplo').map((p) => p.id);
      if (exemplos.length) tirarPedidos(exemplos);
      return rpc('remover_testes').then(
        (n) => {
          recarregar().catch(() => {});
          return Number(n) || 0;
        },
        (e) => {
          avisar(e, { acao: 'remover' });
          recarregar().catch(() => {});
          throw e;
        }
      );
    },
    // demonstração (VITE_DEMO=1): n pedidos de exemplo pela RPC, com os status espalhados como na prévia
    async gerarExemplos(n) {
      const { dadosDeExemplo } = await import('./exemplos.js');
      const criados = [];
      fila = [];
      try {
        for (let i = 0; i < (n || 12); i++) {
          const p = pedidoDoServidor(await rpc('criar_pedido', { p: entradaDoPedido(ML, dadosDeExemplo(ML)) }));
          criados.push(p);
        }
        for (let i = 0; i < criados.length; i++) {
          let p = criados[i];
          const alvo = ['novo', 'preparo', 'preparo', p.modo === 'entrega' ? 'rota' : 'pronto', 'entregue', 'entregue'][i % 6];
          const caminho = ['preparo', p.modo === 'entrega' ? 'rota' : 'pronto', 'entregue'];
          for (let c = 0; c < caminho.length && p.status !== alvo; c++) {
            p = pedidoDoServidor(await rpc('mudar_status', { p_id: p.id, p_status: caminho[c], p_motivo: null }));
          }
          criados[i] = p;
        }
      } finally {
        const lista = pedidos.filter((x) => !criados.some((c) => c.id === x.id)).concat(criados);
        criados.forEach((c) => marcar(c.id));
        const eventos = fila;
        fila = null;
        aplicarPedidos(lista, false);
        eventos.forEach((ev) => emitir(ev.tipo, ev.dados));
      }
      return criados;
    },

    esgotados: () => Object.assign({}, esgotados),
    marcarEsgotado(produtoId, esgotado) {
      const antes = !!esgotados[produtoId];
      const v = !!esgotado;
      const marca = { v };
      pendEsgotados.set(produtoId, marca);
      const trocar = (x) => {
        const e = Object.assign({}, esgotados);
        if (x) e[produtoId] = true;
        else delete e[produtoId];
        esgotados = e;
        emitir('cardapio:esgotados', { id: produtoId, esgotado: x });
      };
      if (antes !== v) trocar(v);
      rpc('marcar_esgotado', { p_produto: produtoId, p_esgotado: v })
        .then(() => {
          if (pendEsgotados.get(produtoId) === marca) pendEsgotados.delete(produtoId);
        })
        .catch((e) => {
          if (pendEsgotados.get(produtoId) !== marca) return;
          pendEsgotados.delete(produtoId);
          if (!!esgotados[produtoId] !== antes) trocar(antes);
          avisar(e, { acao: 'esgotado', id: produtoId });
        });
    },

    // modo 'auto' segue o horário; 'aberta' ou 'fechada' é decisão manual do painel
    loja: () => Object.assign({}, loja),
    definirLoja(modo) {
      const antes = loja.modo;
      const marca = { v: modo };
      pendLoja = marca;
      if (antes !== modo) {
        loja = Object.assign({}, loja, { modo });
        emitir('loja:modo', { modo });
      }
      rpc('definir_loja', { p_modo: modo })
        .then((l) => {
          if (pendLoja === marca) pendLoja = null;
          if (!pendLoja) aplicarLoja(l);
        })
        .catch((e) => {
          if (pendLoja !== marca) return;
          pendLoja = null;
          if (loja.modo !== antes) {
            loja = Object.assign({}, loja, { modo: antes });
            emitir('loja:modo', { modo: antes });
          }
          avisar(e, { acao: 'loja' });
        });
    },

    // som e tempos de atenção do painel: preferência de cada aparelho
    config: () => Object.assign({}, CONFIG_PADRAO, ler('config', {})),
    salvarConfig(c) {
      gravar('config', Object.assign(store.config(), c));
      emitir('config');
    },

    // ---------- cliente: "Meus pedidos" e acompanhamento por token ----------
    // guardados neste aparelho (sem nome, telefone nem endereço), do mais novo para o mais antigo
    meus: () => ler('meus', []).filter((m) => m && m.token),
    lembrarMeu(p) {
      const a = acompanhamentoDe(p);
      acompanhamentos.set(a.token, a);
      gravar('meus', [a].concat(store.meus().filter((m) => m.token !== a.token)).slice(0, 20));
    },
    // o que já se sabe do pedido: undefined = ainda não consultado; null = não existe
    acompanhamento(token) {
      if (acompanhamentos.has(token)) return acompanhamentos.get(token);
      return store.meus().find((m) => m.token === token);
    },
    // consulta acompanhar_pedido(token); emite pedido:status quando o status muda
    async acompanhar(token) {
      const j = await rpc('acompanhar_pedido', { p_token: token });
      const antes = store.acompanhamento(token);
      if (!j) {
        acompanhamentos.set(token, null);
        return null;
      }
      const novo = acompanhamentoDe(Object.assign({}, j, { token }));
      // os itens completos (selos) de quem fez o pedido neste aparelho valem mais que o resumo do servidor
      if (antes && antes.itens && antes.itens.length && antes.itens[0].produtoId) novo.itens = antes.itens;
      if (antes && antes.mesa) novo.mesa = antes.mesa;
      acompanhamentos.set(token, novo);
      const meus = store.meus();
      if (meus.some((m) => m.token === token))
        gravar(
          'meus',
          meus.map((m) => (m.token === token ? novo : m))
        );
      if (!antes || antes.status !== novo.status) emitir('pedido:status', { token, status: novo.status });
      return novo;
    },

    ouvir(fn) {
      ouvintes.push(fn);
      return () => {
        ouvintes = ouvintes.filter((x) => x !== fn);
      };
    }
  };
  return store;
}

// as entradas chamam isto antes de montar a tela: ML.store passa a ser a do Supabase
export function instalarStoreSupabase(opc) {
  const store = criarStoreSupabase(opc);
  window.ML.store = store;
  return store;
}

function assinatura(o) {
  return JSON.stringify(o, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v)
          .sort()
          .reduce((r, x) => ((r[x] = v[x]), r), {})
      : v
  );
}
