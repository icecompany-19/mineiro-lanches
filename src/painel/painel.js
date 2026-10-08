/* Mineiro Lanche · painel de pedidos (desktop)
   Formato do pedido: docs/CONTRATO-API.md. Usa apenas window.ML (core.js) e o ML.store do Supabase, instalado por
   main-painel.js depois do login. Expõe window.MLPainel { montar(el, opcoes), mostrar, esconder }.
   opcoes: { demo (mostra "Simular pedido" e "Gerar exemplos"), usuario (e-mail), aoSair() }. */
(function () {
  'use strict';

  const ML = window.ML;
  if (!ML) {
    window.MLPainel = { montar() {}, mostrar() {}, esconder() {} };
    return;
  }

  const esc = ML.fmt.esc;
  const brl = ML.fmt.brl;
  const pad = (n, t = 2) => String(n).padStart(t, '0');
  const ATIVOS = ['novo', 'preparo', 'pronto', 'rota'];
  const VIEWS = {
    pedidos: { t: 'Pedidos', i: 'quadro' },
    historico: { t: 'Histórico', i: 'lista' },
    cardapio: { t: 'Cardápio', i: 'burger' },
    relatorio: { t: 'Relatório', i: 'grafico' },
    config: { t: 'Configurações', i: 'config' }
  };
  const MODO_IC = { entrega: 'moto', retirada: 'sacola', local: 'mesa' };
  const COLS = [
    { id: 'novos', titulo: 'Novos' },
    { id: 'preparo', titulo: 'Em preparo' },
    { id: 'saida', titulo: 'Pronto / Em rota' },
    { id: 'concluidos', titulo: 'Concluídos hoje' }
  ];
  const COL_DO_STATUS = { novo: 'novos', preparo: 'preparo', pronto: 'saida', rota: 'saida', entregue: 'concluidos' };
  const DIA_OP_OFFSET = 4 * 3600e3; // o "dia" do truck vira às 4h (atende após a meia-noite)

  const S = {
    root: null, montado: false, visivel: false, view: 'pedidos',
    pedidos: [], cfg: ML.store.config(), cards: new Map(), conhecidos: null, iniciou: false,
    destacar: new Set(), naoVistos: new Set(), tituloBase: null,
    recolhido: false, boardOk: false, detalhe: null, focoId: null, sujo: false,
    hq: '', hst: 'todos', hper: 'hoje', tickId: null, tickN: 0, agendado: null,
    interagiu: false, audio: null, toasts: null, lateralAnt: null, arrastando: null,
    opc: {}, offline: false
  };
  let modalAtual = null;

  /* ---------- utilidades ---------- */
  const ic = (n, cls) => `<svg class="pn-ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const q = (sel, r) => (r || S.root).querySelector(sel);
  const qa = (sel, r) => Array.from((r || S.root).querySelectorAll(sel));
  const reduz = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const diaOp = d => { const x = new Date(new Date(d).getTime() - DIA_OP_OFFSET); return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
  const ehHoje = iso => diaOp(iso) === diaOp(Date.now());
  const hhmm = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const dataHora = iso => { const d = new Date(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hhmm(iso); };
  const modoLabel = m => { const x = ML.CONFIG.modos.find(o => o.id === m); return x ? x.label : m; };
  const statusPainel = s => (ML.STATUS[s] || { painel: s }).painel;
  const nomeCli = p => (p.cliente && p.cliente.nome) || 'Sem nome';
  const itensTxt = p => p.itens.map(i => i.qtd + '× ' + i.nome).join(', ');

  function tempoTxt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
  }
  function nivelDe(ms) {
    const min = ms / 60000;
    if (min >= S.cfg.atrasoMin) return 'atraso';
    if (min >= S.cfg.atencaoMin) return 'atencao';
    return 'ok';
  }
  const NIVEL_TXT = { ok: '', atencao: 'Atenção', atraso: 'Atrasado' };

  function pedidoPorId(id) { return S.pedidos.find(p => p.id === id) || ML.store.pedido(id); }
  function concluidoEm(p) {
    const h = (p.historico || []).filter(x => x.status === 'entregue').pop();
    return h ? h.em : p.criadoEm;
  }
  function colDe(p) {
    if (p.status === 'entregue') return ehHoje(concluidoEm(p)) ? 'concluidos' : null;
    return COL_DO_STATUS[p.status] || null;
  }
  function colAlvo(p) {
    const n = ML.regras.proximoStatus(p);
    return n ? COL_DO_STATUS[n] : null;
  }
  function rotuloAvanco(p) {
    if (p.status === 'novo') return 'Aceitar e preparar';
    if (p.status === 'preparo') return p.modo === 'entrega' ? 'Saiu para entrega' : 'Marcar pronto';
    if (p.status === 'pronto' || p.status === 'rota') return 'Concluir';
    return '';
  }
  function telWa(p) {
    const t = String((p.cliente && p.cliente.telefone) || '').replace(/\D/g, '');
    if (!t) return '';
    return t.length <= 11 ? '55' + t : t;
  }
  function linkWa(p) {
    const txt = 'Olá, ' + nomeCli(p) + '! Aqui é o ' + ML.CONFIG.nome + ' sobre o seu pedido ' + ML.fmt.numero(p.numero) + '.';
    return ML.whatsapp.link(txt, telWa(p));
  }
  function linkMaps(p) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.endereco); }

  /* ---------- toast, som, título ---------- */
  function toast(msg, opc) {
    if (!S.toasts) return;
    const o = opc || {};
    const t = document.createElement('div');
    t.className = 'pn-toast' + (o.tipo ? ' pn-toast--' + o.tipo : '');
    t.textContent = msg;
    S.toasts.appendChild(t);
    while (S.toasts.children.length > 4) S.toasts.removeChild(S.toasts.firstChild);
    setTimeout(() => {
      t.classList.add('pn-toast--sai');
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, reduz() ? 0 : 260);
    }, o.dur || 4500);
  }

  function marcarInteracao() {
    S.interagiu = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !S.audio) S.audio = new AC();
      if (S.audio && S.audio.state === 'suspended') S.audio.resume();
    } catch { S.audio = null; }
  }
  function tocar() {
    if (!S.cfg.som || !S.interagiu || !S.audio) return;
    try {
      const ac = S.audio, t0 = ac.currentTime + 0.02;
      [[880, 0], [1318.5, 0.16]].forEach(par => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = par[0];
        g.gain.setValueAtTime(0.0001, t0 + par[1]);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + par[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + par[1] + 0.22);
        o.connect(g); g.connect(ac.destination);
        o.start(t0 + par[1]); o.stop(t0 + par[1] + 0.25);
      });
    } catch { /* sem áudio */ }
  }
  function atualizarTitulo() {
    qaIds();
    const n = S.naoVistos.size;
    if (n > 0) {
      if (S.tituloBase === null) S.tituloBase = document.title;
      document.title = '(' + n + ') Novo pedido · ' + ML.CONFIG.nome;
    } else if (S.tituloBase !== null) {
      document.title = S.tituloBase; S.tituloBase = null;
    }
  }
  function qaIds() {
    S.naoVistos.forEach(id => { const p = S.pedidos.find(x => x.id === id); if (!p || p.status !== 'novo') S.naoVistos.delete(id); });
  }
  function limparNaoVistos() { S.naoVistos.clear(); atualizarTitulo(); }

  function copiar(txt) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.setAttribute('readonly', ''); ta.className = 'pn-fora';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(() => true).catch(() => fallback());
    }
    return Promise.resolve(fallback());
  }

  /* ---------- números animados ---------- */
  function animarNum(el, para, fmt) {
    const de = el._v == null ? 0 : el._v;
    el._v = para;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (reduz() || de === para || !S.visivel) { el.textContent = fmt(para); return; }
    const t0 = performance.now(), dur = 650;
    const passo = agora => {
      const k = Math.min(1, (agora - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(de + (para - de) * e);
      if (k < 1) el._raf = requestAnimationFrame(passo); else el._raf = null;
    };
    el._raf = requestAnimationFrame(passo);
  }

  /* ---------- HTML: peças ---------- */
  function selosHTML(it) {
    const s = [];
    if (it.prensado) s.push(['prensado', 'prensa', 'Prensado']);
    if (it.combo && it.combo.ativo) s.push(['combo', 'combo', 'Combo' + (it.combo.refri ? ' + ' + it.combo.refri : '')]);
    if (it.removidos && it.removidos.length) s.push(['sem', 'tesoura', 'Sem: ' + it.removidos.join(', ')]);
    (it.adicionais || []).forEach(a => s.push(['mais', 'mais', (a.qtd > 1 ? a.qtd + '× ' : '') + a.nome]));
    if (it.sabor) s.push(['sabor', 'lata', it.sabor]);
    if (!s.length) return '';
    return '<div class="pn-selos">' + s.map(x => `<span class="pn-selo pn-selo--${x[0]}">${ic(x[1])}${esc(x[2])}</span>`).join('') + '</div>';
  }
  function itensHTML(p, comPreco) {
    return '<ul class="pn-itens">' + p.itens.map(it =>
      `<li class="pn-item"><span class="pn-qtd">${it.qtd}×</span><div class="pn-item-c"><b class="pn-item-nome">${esc(it.nome)}</b>${comPreco ? `<span class="pn-item-preco">${brl(it.subtotal)}</span>` : ''}${selosHTML(it)}</div></li>`
    ).join('') + '</ul>';
  }
  function tempoHTML(p) {
    if (ATIVOS.includes(p.status)) {
      const ms = Date.now() - new Date(p.criadoEm).getTime(), n = nivelDe(ms);
      return `<span class="pn-tempo" data-t="${esc(p.criadoEm)}" data-nivel="${n}" title="Tempo desde o pedido">${ic('relogio')}<span class="pn-tempo-v">${tempoTxt(ms)}</span><span class="pn-tempo-r">${NIVEL_TXT[n]}</span></span>`;
    }
    return `<span class="pn-tempo pn-tempo--fixo" title="Hora do pedido">${ic('relogio')}<span class="pn-tempo-v">${hhmm(p.criadoEm)}</span></span>`;
  }
  const pagTxt = p => 'Pagamento: ' + (p.pagamento || 'a combinar') + (p.troco ? ' · troco para ' + p.troco : '');
  const tagExemplo = p => p.origem === 'exemplo' ? '<span class="pn-tag pn-tag--exemplo">Pedido de exemplo</span>' : '';
  // quem pediu pelo QR do truck (e de qual mesa)
  const tagsOrigem = p => (p.origem === 'qrcode' ? '<span class="pn-tag pn-tag--qr">QR</span>' : '') +
    (p.mesa ? `<span class="pn-tag pn-tag--mesa">Mesa ${esc(p.mesa)}</span>` : '');
  const ORIGEM_TXT = { cardapio: 'Link da bio / site', qrcode: 'QR code do truck', exemplo: 'Exemplo' };
  const textoVazio = () => S.opc.demo ? "Nenhum pedido agora. Use 'Simular pedido' ou faça um pedido pelo cardápio ao lado." : 'Nenhum pedido agora. Os pedidos feitos pelo cardápio aparecem aqui na hora, com som.';

  function cardHTML(p) {
    const st = p.status, num = ML.fmt.numero(p.numero), nome = nomeCli(p), n = ATIVOS.includes(st) ? nivelDe(Date.now() - new Date(p.criadoEm).getTime()) : 'ok';
    const prox = ML.regras.proximoStatus(p), tel = telWa(p);
    const end = p.modo === 'entrega' && p.endereco ? `<div class="pn-end">${ic('pino')}<div class="pn-end-t"><span>${esc(p.endereco)}</span>${p.referencia ? `<small>${esc(p.referencia)}</small>` : ''}</div>
        <div class="pn-end-b"><button type="button" class="pn-btn pn-btn--peq" data-act="copiar" data-id="${esc(p.id)}" aria-label="Copiar endereço do pedido ${num}">Copiar</button>
        <a class="pn-btn pn-btn--peq" href="${esc(linkMaps(p))}" target="_blank" rel="noopener" aria-label="Abrir endereço do pedido ${num} no Maps">Abrir no Maps</a></div></div>` : '';
    return `<article class="pn-card" data-id="${esc(p.id)}" data-status="${st}" data-nivel="${n}" tabindex="-1"${prox ? ' draggable="true"' : ''} aria-label="Pedido ${num}, ${esc(nome)}, ${esc(statusPainel(st))}">
      <header class="pn-card-topo"><span class="pn-num">${num}</span>${tempoHTML(p)}</header>
      <div class="pn-card-sub"><strong class="pn-cli">${esc(nome)}</strong><span class="pn-modo pn-modo--${esc(p.modo)}">${ic(MODO_IC[p.modo] || 'sacola')}${esc(modoLabel(p.modo))}</span></div>
      <div class="pn-tags"><span class="pn-st pn-st--${st}">${esc(statusPainel(st))}</span>${tagsOrigem(p)}${tagExemplo(p)}</div>
      ${itensHTML(p, false)}
      ${p.obs ? `<p class="pn-obs"><strong>Obs:</strong> ${esc(p.obs)}</p>` : ''}
      ${end}
      <div class="pn-rodape"><span class="pn-pag">${esc(pagTxt(p))}</span><strong class="pn-total">${brl(p.total)}</strong></div>
      <div class="pn-acoes">
        ${prox ? `<button type="button" class="pn-btn pn-btn--prim pn-avancar" data-act="avancar" data-id="${esc(p.id)}">${ic('seta')}${esc(rotuloAvanco(p))}</button>` : ''}
        <div class="pn-acoes-sec">
          <button type="button" class="pn-btn" data-act="imprimir" data-id="${esc(p.id)}" aria-label="Imprimir comanda do pedido ${num}">${ic('impressora')}Imprimir</button>
          ${tel ? `<a class="pn-btn" href="${esc(linkWa(p))}" target="_blank" rel="noopener" aria-label="Chamar ${esc(nome)} no WhatsApp">${ic('chat')}WhatsApp</a>` : ''}
          ${ATIVOS.includes(st) ? `<button type="button" class="pn-btn pn-btn--perigo" data-act="cancelar" data-id="${esc(p.id)}" aria-label="Cancelar pedido ${num}">${ic('x')}Cancelar</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  /* ---------- esqueleto ---------- */
  function sairHTML() {
    if (!S.opc.aoSair) return '';
    return `<div class="pn-sessao">${S.opc.usuario ? `<span class="pn-sessao-u" title="${esc(S.opc.usuario)}">${esc(S.opc.usuario)}</span>` : ''}<button type="button" class="pn-btn pn-btn--peq" data-act="sair">Sair</button></div>`;
  }
  function esqueleto() {
    const nav = Object.keys(VIEWS).map(k => `<button type="button" class="pn-nav-b" data-nav="${k}">${ic(VIEWS[k].i)}<span>${VIEWS[k].t}</span>${k === 'pedidos' ? '<span class="pn-badge" data-badge hidden aria-live="polite"></span>' : ''}</button>`).join('');
    const colsHTML = COLS.map(c => `<section class="pn-col pn-col--${c.id}" data-col="${c.id}" aria-labelledby="pn-h-${c.id}">
        <header class="pn-col-topo"><h3 class="pn-col-tit" id="pn-h-${c.id}">${c.titulo}</h3>
          <span class="pn-cont" aria-live="polite" aria-atomic="true"><span class="pn-sr">${c.titulo}: </span><b data-cont="${c.id}">0</b></span>
          ${c.id === 'concluidos' ? `<button type="button" class="pn-btn pn-btn--ico" data-act="recolher" aria-expanded="true" aria-label="Recolher coluna Concluídos hoje">${ic('menos')}</button>` : ''}</header>
        <div class="pn-lista" data-lista="${c.id}"></div>
        <p class="pn-col-vazio">Sem pedidos</p>
      </section>`).join('');
    const kpis = [['n', 'Pedidos hoje'], ['fat', 'Faturamento hoje'], ['tm', 'Ticket médio'], ['prep', 'Itens em preparo']].map(k =>
      `<div class="pn-kpi pn-kpi--${k[0]}"><span class="pn-kpi-rot">${k[1]}</span><span class="pn-kpi-val" data-kpi="${k[0]}" aria-hidden="true">0</span><span class="pn-sr" data-kpi-sr="${k[0]}">0</span></div>`).join('');
    const stOpts = '<option value="todos">Todos os status</option>' + Object.keys(ML.STATUS).map(k => `<option value="${k}">${esc(ML.STATUS[k].painel)}</option>`).join('');
    return `<div class="pn-app">
    <div class="pn-desktop">
      <aside class="pn-lado">
        <div class="pn-marca"><img class="pn-selo-logo" src="/assets/logo-selo.svg" alt="${esc(ML.CONFIG.nome)}" width="64" height="64"><span class="pn-marca-t">Painel<br>de pedidos</span></div>
        <nav class="pn-nav" aria-label="Seções do painel">${nav}</nav>
        ${sairHTML()}
        <p class="pn-rodape">Mineiro Lanche · Painel de pedidos</p>
      </aside>
      <div class="pn-main">
        <header class="pn-topo">
          <h2 class="pn-titulo" data-titulo tabindex="-1">Pedidos</h2>
          <div class="pn-loja">
            <div class="pn-seg" role="group" aria-label="Status da loja">
              <button type="button" class="pn-seg-b" data-loja="auto" title="Automático pelo horário">Automático</button>
              <button type="button" class="pn-seg-b" data-loja="aberta">Aberta</button>
              <button type="button" class="pn-seg-b" data-loja="fechada">Fechada</button>
            </div>
            <span class="pn-loja-txt" data-lojatxt role="status"></span>
          </div>
          <time class="pn-relogio" data-relogio>--:--:--</time>
          <button type="button" class="pn-btn pn-btn--ico" data-act="som" aria-pressed="true" aria-label="Som de novo pedido"></button>
          ${S.opc.demo ? `<button type="button" class="pn-btn" data-act="simular">${ic('play')}Simular pedido</button>` : ''}
          <button type="button" class="pn-btn" data-act="abrir-cardapio">${ic('janela')}Abrir cardápio ao lado</button>
        </header>
        <div class="pn-conteudo">
          <section class="pn-sec" data-view="pedidos" aria-label="Pedidos">
            <div class="pn-kpis" aria-live="polite" aria-label="Indicadores do dia">${kpis}</div>
            <div class="pn-vazio" data-vazio hidden>${ic('truck', 'pn-vazio-ic')}<p>${esc(textoVazio())}</p></div>
            <div class="pn-board" data-board>${colsHTML}</div>
          </section>
          <section class="pn-sec" data-view="historico" aria-label="Histórico" hidden>
            <div class="pn-barra-f">
              <label class="pn-campo pn-campo--busca"><span class="pn-sr">Buscar por nome, número ou item</span>${ic('busca')}<input type="search" class="pn-input" data-f="q" placeholder="Buscar por nome, número ou item" autocomplete="off"></label>
              <label class="pn-campo"><span class="pn-campo-r">Status</span><select class="pn-input" data-f="st">${stOpts}</select></label>
              <label class="pn-campo"><span class="pn-campo-r">Período</span><select class="pn-input" data-f="per"><option value="hoje">Hoje</option><option value="todos">Todos</option></select></label>
              <button type="button" class="pn-btn pn-btn--prim" data-act="csv">${ic('download')}Exportar CSV</button>
              <button type="button" class="pn-btn" data-act="csv-ver">Ver CSV</button>
            </div>
            <p class="pn-hist-n" data-histn role="status"></p>
            <div class="pn-tabela-w"><table class="pn-tabela"><thead><tr><th scope="col">Nº</th><th scope="col">Hora</th><th scope="col">Cliente</th><th scope="col">Modo</th><th scope="col">Itens</th><th scope="col" class="pn-r">Total</th><th scope="col">Status</th></tr></thead><tbody data-histbody></tbody></table></div>
          </section>
          <section class="pn-sec" data-view="cardapio" aria-label="Cardápio" hidden><div data-slot="cardapio"></div></section>
          <section class="pn-sec" data-view="relatorio" aria-label="Relatório" hidden><div data-slot="relatorio"></div></section>
          <section class="pn-sec" data-view="config" aria-label="Configurações" hidden>
            <div class="pn-cfg">
              <div class="pn-card-cfg"><h3>Som</h3>
                <button type="button" class="pn-sw" role="switch" aria-checked="true" data-act="cfg-som"><span class="pn-sw-rot">Som de novo pedido</span><span class="pn-sw-trilho" aria-hidden="true"><span class="pn-sw-bola"></span></span></button></div>
              <div class="pn-card-cfg"><h3>Tempo de espera</h3>
                <div class="pn-cfg-l">
                  <label class="pn-campo"><span class="pn-campo-r">Atenção a partir de (min)</span><input type="number" min="1" max="240" class="pn-input" data-cfg="atencaoMin"></label>
                  <label class="pn-campo"><span class="pn-campo-r">Atraso a partir de (min)</span><input type="number" min="2" max="480" class="pn-input" data-cfg="atrasoMin"></label>
                </div>
                <p class="pn-erro" data-cfgerro role="alert" hidden>O atraso precisa ser maior que a atenção.</p></div>
              <div class="pn-card-cfg" data-cfg-exemplos${S.opc.demo ? '' : ' hidden'}><h3>Pedidos de exemplo</h3>
                <div class="pn-cfg-l">
                  ${S.opc.demo ? `<button type="button" class="pn-btn" data-act="gerar15">${ic('mais')}Gerar 15 pedidos de exemplo</button>` : ''}
                  <button type="button" class="pn-btn pn-btn--perigo" data-act="apagar">${ic('lixo')}Apagar todos os pedidos de teste</button>
                </div>
                <div class="pn-confirma" data-confirma hidden role="alertdialog" aria-label="Confirmar exclusão">
                  <p data-confirma-t></p>
                  <div class="pn-cfg-l"><button type="button" class="pn-btn pn-btn--prim" data-act="apagar-ok">Apagar tudo</button><button type="button" class="pn-btn" data-act="apagar-no">Voltar</button></div>
                </div></div>
              <div class="pn-card-cfg pn-card-cfg--nota"><h3>Pedidos no servidor</h3><p>Os pedidos ficam no servidor e sincronizam entre aparelhos: o que é feito em qualquer celular chega a todo painel aberto com login da equipe.</p></div>
            </div>
          </section>
        </div>
      </div>
      <div class="pn-fundo" data-fundo></div>
      <aside class="pn-lateral" data-lateral role="dialog" aria-modal="true" aria-label="Detalhe do pedido" inert aria-hidden="true"></aside>
    </div>
    <div class="pn-mobile">
      <p class="pn-aviso-m" role="note"><strong>O painel foi pensado para computador</strong></p>
      <div data-mobile></div>
      ${sairHTML()}
    </div>
    </div>`;
  }

  /* ---------- renderização ---------- */
  function renderChrome() {
    const cfg = S.cfg, loja = ML.store.loja(), sit = ML.horario.situacao();
    qa('[data-loja]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.loja === loja.modo)));
    const lt = q('[data-lojatxt]');
    lt.textContent = sit.txt;
    lt.className = 'pn-loja-txt ' + (sit.aberto ? 'pn-loja-txt--on' : 'pn-loja-txt--off');
    const som = q('[data-act="som"]');
    som.setAttribute('aria-pressed', String(!!cfg.som));
    som.innerHTML = ic(cfg.som ? 'som' : 'som-off');
    som.setAttribute('title', cfg.som ? 'Som ligado' : 'Som desligado');
    const n = S.pedidos.filter(p => p.status === 'novo').length, b = q('[data-badge]');
    b.hidden = n === 0; b.textContent = n ? String(n) : '';
    b.setAttribute('aria-label', n + (n === 1 ? ' pedido novo' : ' pedidos novos'));
    const sw = q('[data-act="cfg-som"]'); sw.setAttribute('aria-checked', String(!!cfg.som));
    q('[data-cfg-exemplos]').hidden = !S.opc.demo && !S.pedidos.some(p => p.origem === 'exemplo');
    ['atencaoMin', 'atrasoMin'].forEach(k => { const i = q('[data-cfg="' + k + '"]'); if (i && document.activeElement !== i) i.value = cfg[k]; });
  }

  function renderKpis() {
    const hoje = S.pedidos.filter(p => p.status !== 'cancelado' && ehHoje(p.criadoEm));
    const n = hoje.length, fat = hoje.reduce((s, p) => s + p.total, 0), tm = n ? fat / n : 0;
    const prep = S.pedidos.filter(p => p.status === 'preparo').reduce((s, p) => s + p.itens.reduce((a, i) => a + i.qtd, 0), 0);
    const set = (k, v, fmt) => { animarNum(q('[data-kpi="' + k + '"]'), v, fmt); q('[data-kpi-sr="' + k + '"]').textContent = fmt(v); };
    const inteiro = v => String(Math.round(v));
    set('n', n, inteiro); set('fat', fat, brl); set('tm', tm, brl); set('prep', prep, inteiro);
  }

  function criarCard(p) {
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHTML(p);
    const el = tmp.firstElementChild;
    if (S.boardOk && S.view === 'pedidos') {
      el.classList.add('pn-entra');
      if (S.destacar.has(p.id)) {
        el.classList.add('pn-destaque');
        setTimeout(() => el.classList.remove('pn-destaque'), 3200);
      }
    }
    return el;
  }

  function renderBoard() {
    const grupos = { novos: [], preparo: [], saida: [], concluidos: [] };
    S.pedidos.forEach(p => { const c = colDe(p); if (c) grupos[c].push(p); });
    const t = p => new Date(p.criadoEm).getTime();
    grupos.novos.sort((a, b) => t(b) - t(a));
    grupos.preparo.sort((a, b) => t(a) - t(b));
    grupos.saida.sort((a, b) => t(a) - t(b));
    grupos.concluidos.sort((a, b) => new Date(concluidoEm(b)) - new Date(concluidoEm(a)));
    const vistos = new Set();
    let total = 0;
    COLS.forEach(col => {
      const lista = q('[data-lista="' + col.id + '"]'), ps = grupos[col.id];
      const els = ps.map(p => {
        vistos.add(p.id);
        const sig = JSON.stringify(p), c = S.cards.get(p.id);
        if (c && c.sig === sig) return c.el;
        const el = criarCard(p);
        S.cards.set(p.id, { el, sig });
        return el;
      });
      els.forEach((el, i) => { if (lista.children[i] !== el) lista.insertBefore(el, lista.children[i] || null); });
      while (lista.children.length > els.length) lista.removeChild(lista.lastChild);
      const cont = q('[data-cont="' + col.id + '"]'), novo = String(ps.length);
      if (cont.textContent !== novo) {
        cont.textContent = novo;
        cont.classList.remove('pn-bump'); void cont.offsetWidth; cont.classList.add('pn-bump');
      }
      total += ps.length;
    });
    S.cards.forEach((c, id) => { if (!vistos.has(id)) S.cards.delete(id); });
    q('[data-vazio]').hidden = total !== 0;
    q('[data-board]').hidden = total === 0;
    S.destacar.clear();
    S.boardOk = true;
    if (S.focoId) {
      const c = S.cards.get(S.focoId);
      if (c && c.el.isConnected) c.el.focus({ preventScroll: false });
      S.focoId = null;
    }
    tickTempos();
  }

  function statusChip(st) { return `<span class="pn-st pn-st--${st}">${esc(statusPainel(st))}</span>`; }

  function filtrarHist() {
    const qq = norm(S.hq).replace(/^#/, '').trim();
    return S.pedidos.filter(p => {
      if (S.hper === 'hoje' && !ehHoje(p.criadoEm)) return false;
      if (S.hst !== 'todos' && p.status !== S.hst) return false;
      if (qq) {
        const h = norm([ML.fmt.numero(p.numero), p.numero, nomeCli(p)].concat(p.itens.map(i => i.nome)).join(' '));
        if (h.indexOf(qq) < 0) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  }
  function renderHist() {
    const lista = filtrarHist();
    q('[data-histn]').textContent = lista.length + (lista.length === 1 ? ' pedido' : ' pedidos');
    const body = q('[data-histbody]');
    if (!lista.length) { body.innerHTML = '<tr><td colspan="7" class="pn-tab-vazio">Nenhum pedido com esses filtros.</td></tr>'; return; }
    body.innerHTML = lista.map(p => {
      const hora = ehHoje(p.criadoEm) ? hhmm(p.criadoEm) : pad(new Date(p.criadoEm).getDate()) + '/' + pad(new Date(p.criadoEm).getMonth() + 1) + ' ' + hhmm(p.criadoEm);
      return `<tr class="pn-lin" data-id="${esc(p.id)}"><th scope="row"><button type="button" class="pn-link" data-act="detalhe" data-id="${esc(p.id)}" aria-label="Abrir detalhe do pedido ${ML.fmt.numero(p.numero)}">${ML.fmt.numero(p.numero)}</button></th>
        <td>${hora}</td><td>${esc(nomeCli(p))}${p.origem === 'exemplo' ? ' <span class="pn-tag pn-tag--exemplo">exemplo</span>' : ''}</td>
        <td><span class="pn-modo">${ic(MODO_IC[p.modo] || 'sacola')}${esc(modoLabel(p.modo))}</span></td>
        <td class="pn-tab-itens">${esc(itensTxt(p))}</td><td class="pn-r">${brl(p.total)}</td><td>${statusChip(p.status)}</td></tr>`;
    }).join('');
  }

  function renderCardapio() {
    const esg = ML.store.esgotados();
    q('[data-slot="cardapio"]').innerHTML = ML.CONFIG.categorias.map(cat => {
      const n = cat.itens.filter(i => esg[i.id]).length, todos = n === cat.itens.length;
      return `<section class="pn-cat" aria-label="${esc(cat.label)}"><header class="pn-cat-topo">${ic(cat.icone || 'burger')}<h3>${esc(cat.label)}</h3><span class="pn-cat-n">${n} de ${cat.itens.length} esgotados</span>
        <button type="button" class="pn-btn" data-act="esgotar-cat" data-cat="${esc(cat.id)}" data-todos="${todos ? 1 : 0}">${todos ? 'Liberar categoria' : 'Esgotar categoria inteira'}</button></header>
        <ul class="pn-prods">${cat.itens.map(i => {
          const e = !!esg[i.id];
          return `<li class="pn-prod${e ? ' pn-prod--esg' : ''}"><div class="pn-prod-t"><b>${esc(i.nome)}</b><span>${brl(i.preco)}</span></div>
            <button type="button" class="pn-sw" role="switch" aria-checked="${e}" data-act="esgotar" data-id="${esc(i.id)}" aria-label="Esgotado hoje: ${esc(i.nome)}"><span class="pn-sw-rot">Esgotado hoje</span><span class="pn-sw-trilho" aria-hidden="true"><span class="pn-sw-bola"></span></span></button></li>`;
        }).join('')}</ul></section>`;
    }).join('');
  }

  function renderRel() {
    const slot = q('[data-slot="relatorio"]');
    const ps = S.pedidos.filter(p => p.status !== 'cancelado');
    if (!ps.length) {
      slot.innerHTML = `<div class="pn-vazio">${ic('grafico', 'pn-vazio-ic')}<p>${S.opc.demo ? "Ainda não há pedidos. Use 'Simular pedido' ou faça um pedido pelo cardápio." : 'Ainda não há pedidos nas últimas 48 horas.'}</p></div>`;
      return;
    }
    const tem = ps.some(p => p.origem === 'exemplo');
    const soma = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };
    const itens = {}, adics = {}, modos = {}, horas = {}, origens = {};
    let lanches = 0, combos = 0, prensaveis = 0, prensados = 0, fat = 0;
    ps.forEach(p => {
      fat += p.total; soma(modos, p.modo, 1); soma(origens, ORIGEM_TXT[p.origem] || p.origem, 1);
      soma(horas, new Date(p.criadoEm).getHours(), 1);
      p.itens.forEach(i => {
        soma(itens, i.nome, i.qtd);
        (i.adicionais || []).forEach(a => soma(adics, a.nome, a.qtd * i.qtd));
        if (i.tipo === 'lanche') { lanches += i.qtd; if (i.combo && i.combo.ativo) combos += i.qtd; }
        if (i.tipo === 'lanche' || i.tipo === 'combo') { prensaveis += i.qtd; if (i.prensado) prensados += i.qtd; }
      });
    });
    const top = (o, n) => Object.keys(o).map(k => [k, o[k]]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    const barras = lista => {
      if (!lista.length) return '<p class="pn-rel-vazio">Sem dados.</p>';
      const max = Math.max.apply(null, lista.map(x => x[1]));
      return '<ol class="pn-barras">' + lista.map(x => `<li class="pn-barra"><span class="pn-barra-rot">${esc(x[0])}</span><span class="pn-barra-trilho"><span class="pn-barra-v" style="width:${(x[1] / max * 100).toFixed(1)}%"></span></span><b class="pn-barra-num">${x[1]}</b></li>`).join('') + '</ol>';
    };
    // horas na ordem do dia do truck (4h..3h)
    const hs = Object.keys(horas).map(Number), idx = h => (h + 20) % 24;
    const iMin = Math.max(0, Math.min.apply(null, hs.map(idx)) - 1), iMax = Math.min(23, Math.max.apply(null, hs.map(idx)) + 1);
    const maxH = Math.max.apply(null, hs.map(h => horas[h]));
    let cols = '';
    for (let i = iMin; i <= iMax; i++) {
      const h = (i + 4) % 24, v = horas[h] || 0;
      cols += `<li class="pn-col-h"><span class="pn-col-h-n">${v || ''}</span><span class="pn-col-h-bar"><span class="pn-col-h-v" style="height:${(v / maxH * 100).toFixed(1)}%"></span></span><span class="pn-col-h-r">${h}h</span></li>`;
    }
    const totalModos = ps.length, modoCores = { entrega: 'amarelo', retirada: 'vermelho', local: 'laranja' };
    const seg = ML.CONFIG.modos.map(m => ({ id: m.id, label: m.label, n: modos[m.id] || 0 }));
    const R = 52, C = 2 * Math.PI * R, pc = pct(combos, lanches);
    slot.innerHTML = `
      ${tem ? '<p class="pn-aviso-ex">Inclui pedidos de exemplo</p>' : ''}
      <div class="pn-rel-grid">
        <section class="pn-graf pn-graf--combo" aria-label="Taxa de combo">
          <h3>Taxa de combo</h3>
          <div class="pn-combo">
            <svg class="pn-anel" viewBox="0 0 120 120" role="img" aria-label="${pc}% dos lanches viraram combo"><circle class="pn-anel-f" cx="60" cy="60" r="${R}"/><circle class="pn-anel-v" cx="60" cy="60" r="${R}" stroke-dasharray="${(C * pc / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle" class="pn-anel-t">${pc}%</text></svg>
            <p><strong>${combos} de ${lanches}</strong> lanches viraram combo<br><span class="pn-peq">Combo = +${brl(ML.CONFIG.regras.combo.preco)} por lanche · ${brl(combos * ML.CONFIG.regras.combo.preco)} a mais no caixa</span></p>
          </div>
        </section>
        <section class="pn-graf" aria-label="Resumo"><h3>Resumo</h3>
          <dl class="pn-resumo"><div><dt>Pedidos</dt><dd>${ps.length}</dd></div><div><dt>Faturamento</dt><dd>${brl(fat)}</dd></div><div><dt>Ticket médio</dt><dd>${brl(fat / ps.length)}</dd></div></dl>
          <h3 class="pn-sub">Prensados</h3>
          <div class="pn-prens"><b>${pct(prensados, prensaveis)}%</b><span class="pn-barra-trilho"><span class="pn-barra-v" style="width:${pct(prensados, prensaveis)}%"></span></span></div>
          <p class="pn-peq">${prensados} de ${prensaveis} lanches e combos</p>
        </section>
        <section class="pn-graf pn-graf--larga" aria-label="Itens mais vendidos"><h3>Itens mais vendidos</h3>${barras(top(itens, 8))}</section>
        <section class="pn-graf pn-graf--larga" aria-label="Pedidos por hora"><h3>Pedidos por hora</h3><ol class="pn-horas">${cols}</ol></section>
        <section class="pn-graf" aria-label="Divisão por modo"><h3>Divisão por modo</h3>
          <div class="pn-empil" role="img" aria-label="${seg.map(s => modoLabel(s.id) + ' ' + pct(s.n, totalModos) + '%').join(', ')}">${seg.filter(s => s.n).map(s => `<span class="pn-empil-s pn-cor-${modoCores[s.id] || 'amarelo'}" style="flex:${s.n}"></span>`).join('')}</div>
          <ul class="pn-leg">${seg.map(s => `<li><span class="pn-leg-c pn-cor-${modoCores[s.id] || 'amarelo'}" aria-hidden="true"></span>${ic(MODO_IC[s.id] || 'sacola')}<span>${esc(s.label)}</span><b>${s.n} · ${pct(s.n, totalModos)}%</b></li>`).join('')}</ul>
        </section>
        <section class="pn-graf" aria-label="Adicionais mais pedidos"><h3>Adicionais mais pedidos</h3>${barras(top(adics, 6))}</section>
        <section class="pn-graf" aria-label="Pedidos por origem"><h3>Pedidos por origem</h3>${barras(top(origens, 4))}</section>
      </div>`;
  }

  function renderMobile() {
    const lista = S.pedidos.filter(p => ATIVOS.includes(p.status) || (p.status !== 'cancelado' && ehHoje(p.criadoEm)))
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    q('[data-mobile]').innerHTML = lista.length ? '<ul class="pn-m-lista">' + lista.map(p => {
      const prox = ML.regras.proximoStatus(p);
      return `<li class="pn-m-item"><div class="pn-m-t"><b class="pn-num">${ML.fmt.numero(p.numero)}</b> <span>${esc(nomeCli(p))}</span> ${statusChip(p.status)}${tagsOrigem(p)}</div>
        <p>${esc(itensTxt(p))}</p><div class="pn-m-b"><strong>${brl(p.total)}</strong>${prox ? `<button type="button" class="pn-btn pn-btn--prim" data-act="avancar" data-id="${esc(p.id)}">${esc(rotuloAvanco(p))}</button>` : ''}</div></li>`;
    }).join('') + '</ul>' : `<div class="pn-vazio">${ic('truck', 'pn-vazio-ic')}<p>${esc(textoVazio())}</p></div>`;
  }

  function renderTudo() {
    renderChrome();
    renderMobile();
    if (S.view === 'pedidos') { renderKpis(); renderBoard(); }
    else if (S.view === 'historico') renderHist();
    else if (S.view === 'cardapio') renderCardapio();
    else if (S.view === 'relatorio') renderRel();
    if (S.detalhe) renderDetalhe();
    atualizarTitulo();
  }

  /* ---------- dados ---------- */
  function atualizar() {
    S.cfg = ML.store.config();
    S.pedidos = ML.store.pedidos();
    const ids = new Set(S.pedidos.map(p => p.id));
    if (!S.iniciou) { S.conhecidos = ids; S.iniciou = true; }
    else {
      const novos = S.pedidos.filter(p => !S.conhecidos.has(p.id) && p.status === 'novo');
      S.conhecidos = ids;
      if (novos.length) anunciar(novos);
    }
    if (!S.visivel) { S.sujo = true; atualizarTitulo(); return; }
    S.sujo = false;
    renderTudo();
  }
  function agendar() {
    if (S.agendado) return;
    S.agendado = setTimeout(() => { S.agendado = null; atualizar(); }, 0);
  }
  function aoEvento(ev) {
    const tipo = ev && ev.tipo;
    if (tipo === 'store:erro') { toast(ev.dados.mensagem, { tipo: 'erro', dur: 6000 }); agendar(); return; }
    if (tipo === 'store:conexao') {
      if (ev.dados.online === S.offline) {
        S.offline = !ev.dados.online;
        toast(S.offline ? 'Sem conexão com o servidor. Tentando de novo…' : 'Conexão com o servidor de volta', { tipo: S.offline ? 'erro' : '', dur: S.offline ? 8000 : 3000 });
      }
      return;
    }
    agendar();
  }
  function anunciar(novos) {
    novos.forEach(p => S.destacar.add(p.id));
    if (novos.length === 1) {
      const p = novos[0];
      toast('Novo pedido ' + ML.fmt.numero(p.numero) + ' · ' + nomeCli(p) + ' · ' + brl(p.total), { tipo: 'novo' });
    } else {
      toast(novos.length + ' novos pedidos', { tipo: 'novo' });
    }
    tocar();
    const fora = document.hidden || !document.hasFocus() || !S.visivel;
    if (fora) novos.forEach(p => S.naoVistos.add(p.id));
  }

  /* ---------- tick de 1 s ---------- */
  function tickTempos() {
    qa('.pn-tempo[data-t]').forEach(el => {
      const ms = Date.now() - new Date(el.dataset.t).getTime(), n = nivelDe(ms);
      const v = el.querySelector('.pn-tempo-v'), r = el.querySelector('.pn-tempo-r'), tx = tempoTxt(ms);
      if (v.textContent !== tx) v.textContent = tx;
      if (el.dataset.nivel !== n) {
        el.dataset.nivel = n; r.textContent = NIVEL_TXT[n];
        const card = el.closest('.pn-card'); if (card) card.dataset.nivel = n;
      }
    });
  }
  function tick() {
    const d = new Date(), r = q('[data-relogio]');
    r.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    r.setAttribute('datetime', d.toISOString());
    tickTempos();
    if (++S.tickN % 15 === 0) renderChrome();
  }

  /* ---------- navegação ---------- */
  function irPara(v) {
    if (!VIEWS[v]) return;
    S.view = v;
    qa('.pn-sec').forEach(s => { s.hidden = s.dataset.view !== v; });
    qa('[data-nav]').forEach(b => { if (b.dataset.nav === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    q('[data-titulo]').textContent = VIEWS[v].t;
    if (S.visivel) { S.cfg = ML.store.config(); S.pedidos = ML.store.pedidos(); renderTudo(); }
  }

  /* ---------- modal ---------- */
  const FOCAVEIS = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
  function prenderFoco(e, cont) {
    if (e.key !== 'Tab') return;
    const f = Array.from(cont.querySelectorAll(FOCAVEIS)).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
  function abrirModal(rotulo, corpo, classe) {
    fecharModal();
    const ant = document.activeElement;
    const m = document.createElement('div');
    m.className = 'pn-modal';
    m.innerHTML = `<div class="pn-modal-caixa ${classe || ''}" role="dialog" aria-modal="true" aria-label="${esc(rotulo)}">${corpo}</div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => {
      if (e.target === m) { fecharModal(); return; }
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'fechar') fecharModal();
      else if (b.dataset.m === 'imprimir') { try { window.print(); } catch { toast('A impressão não está disponível aqui. Use a visualização da comanda.'); } }
      else if (b.dataset.m === 'copiar-csv') { const ta = m.querySelector('textarea'); copiar(ta.value).then(ok => { if (!ok) ta.select(); toast(ok ? 'CSV copiado' : 'Selecione o texto e copie com Ctrl+C'); }); }
    });
    m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); fecharModal(); } else prenderFoco(e, m); });
    modalAtual = { el: m, ant };
    const foco = m.querySelector('[data-foco]') || m.querySelector('button');
    if (foco) foco.focus();
    return m;
  }
  function fecharModal() {
    if (!modalAtual) return;
    const { el, ant } = modalAtual;
    modalAtual = null;
    if (el.parentNode) el.parentNode.removeChild(el);
    if (ant && ant.isConnected && ant.focus) ant.focus();
  }

  /* ---------- comanda (80 mm) ---------- */
  function comandaHTML(p) {
    const itens = p.itens.map(it => {
      const l = [];
      if (it.prensado) l.push('[PRENSADO]');
      if (it.combo && it.combo.ativo) l.push('[COMBO' + (it.combo.refri ? ' + ' + it.combo.refri : '') + ']');
      if (it.removidos && it.removidos.length) l.push('SEM: ' + it.removidos.join(', '));
      (it.adicionais || []).forEach(a => l.push('+ ' + (a.qtd > 1 ? a.qtd + 'x ' : '') + a.nome));
      if (it.sabor) l.push(it.sabor);
      return `<div class="pn-c-item"><div class="pn-c-lin"><span>${it.qtd}x ${esc(it.nome)}</span><span>${brl(it.subtotal)}</span></div>${l.length ? `<div class="pn-c-sel">${esc(l.join('  '))}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pn-comanda" data-comanda>
      <p class="pn-c-loja">${esc(ML.CONFIG.nome)}</p>
      ${p.origem === 'exemplo' ? '<p class="pn-c-ex">** PEDIDO DE EXEMPLO **</p>' : ''}
      <p class="pn-c-num">${ML.fmt.numero(p.numero)}</p>
      <p class="pn-c-modo">${esc(modoLabel(p.modo))}${p.mesa ? ' · MESA ' + esc(p.mesa) : ''}${p.origem === 'qrcode' ? ' · QR' : ''}</p>
      <p class="pn-c-peq">${esc(dataHora(p.criadoEm))}</p><hr>
      <p><b>Cliente:</b> ${esc(nomeCli(p))}</p>
      ${p.cliente && p.cliente.telefone ? `<p><b>Tel:</b> ${esc(p.cliente.telefone)}</p>` : ''}
      ${p.modo === 'entrega' && p.endereco ? `<p><b>Endereço:</b> ${esc(p.endereco)}</p>` : ''}
      ${p.referencia ? `<p><b>Ref.:</b> ${esc(p.referencia)}</p>` : ''}
      <hr>${itens}<hr>
      ${p.obs ? `<p class="pn-c-obs"><b>OBS:</b> ${esc(p.obs)}</p><hr>` : ''}
      <p>${esc(pagTxt(p))}</p>
      <p class="pn-c-total"><span>TOTAL</span><span>${brl(p.total)}</span></p>
    </div>`;
  }
  function abrirComanda(id) {
    const p = pedidoPorId(id); if (!p) return;
    abrirModal('Comanda do pedido ' + ML.fmt.numero(p.numero), comandaHTML(p) +
      `<div class="pn-modal-acoes"><button type="button" class="pn-btn pn-btn--prim" data-m="imprimir" data-foco>${ic('impressora')}Imprimir</button><button type="button" class="pn-btn" data-m="fechar">Fechar</button></div>`, 'pn-modal-caixa--comanda');
  }

  /* ---------- detalhe lateral ---------- */
  function renderDetalhe() {
    const p = pedidoPorId(S.detalhe), lat = q('[data-lateral]');
    if (!p) { fecharDetalhe(); return; }
    const num = ML.fmt.numero(p.numero), tel = telWa(p);
    lat.innerHTML = `<header class="pn-lat-topo"><div><span class="pn-num">${num}</span> ${statusChip(p.status)} ${tagsOrigem(p)} ${tagExemplo(p)}</div><button type="button" class="pn-btn pn-btn--ico" data-act="fechar-lateral" aria-label="Fechar detalhe">${ic('x')}</button></header>
      <div class="pn-lat-corpo">
        <dl class="pn-dl">
          <div><dt>Cliente</dt><dd>${esc(nomeCli(p))}${p.cliente && p.cliente.telefone ? ' · ' + esc(p.cliente.telefone) : ''}</dd></div>
          <div><dt>Modo</dt><dd><span class="pn-modo">${ic(MODO_IC[p.modo] || 'sacola')}${esc(modoLabel(p.modo))}${p.mesa ? ' · Mesa ' + esc(p.mesa) : ''}</span></dd></div>
          <div><dt>Origem</dt><dd>${esc(ORIGEM_TXT[p.origem] || p.origem)}</dd></div>
          <div><dt>Feito em</dt><dd>${esc(dataHora(p.criadoEm))}</dd></div>
          ${p.modo === 'entrega' && p.endereco ? `<div><dt>Endereço</dt><dd>${esc(p.endereco)}${p.referencia ? ' (' + esc(p.referencia) + ')' : ''}</dd></div>` : ''}
          <div><dt>Pagamento</dt><dd>${esc(pagTxt(p).replace('Pagamento: ', ''))}</dd></div>
        </dl>
        ${itensHTML(p, true)}
        ${p.obs ? `<p class="pn-obs"><strong>Obs:</strong> ${esc(p.obs)}</p>` : ''}
        <p class="pn-lat-total"><span>Total</span><strong>${brl(p.total)}</strong></p>
        <h3 class="pn-sub">Histórico do pedido</h3>
        <ol class="pn-linha">${(p.historico || []).map(h => `<li><span class="pn-linha-h">${esc(dataHora(h.em))}</span><b>${esc((ML.STATUS[h.status] || { label: h.status }).label)}</b>${h.motivo ? `<small>Motivo: ${esc(h.motivo)}</small>` : ''}</li>`).join('')}</ol>
      </div>
      <footer class="pn-lat-acoes"><button type="button" class="pn-btn" data-act="imprimir" data-id="${esc(p.id)}">${ic('impressora')}Imprimir comanda</button>
        ${tel ? `<a class="pn-btn" href="${esc(linkWa(p))}" target="_blank" rel="noopener">${ic('chat')}WhatsApp</a>` : ''}</footer>`;
  }
  function abrirDetalhe(id) {
    S.lateralAnt = document.activeElement;
    S.detalhe = id;
    renderDetalhe();
    const lat = q('[data-lateral]');
    lat.removeAttribute('inert'); lat.setAttribute('aria-hidden', 'false');
    lat.classList.add('pn-lateral--aberta'); q('[data-fundo]').classList.add('pn-fundo--on');
    const f = lat.querySelector('[data-act="fechar-lateral"]'); if (f) f.focus();
  }
  function fecharDetalhe() {
    if (!S.detalhe && !q('[data-lateral]').classList.contains('pn-lateral--aberta')) return;
    S.detalhe = null;
    const lat = q('[data-lateral]');
    lat.classList.remove('pn-lateral--aberta'); q('[data-fundo]').classList.remove('pn-fundo--on');
    lat.setAttribute('inert', ''); lat.setAttribute('aria-hidden', 'true');
    if (S.lateralAnt && S.lateralAnt.isConnected && S.lateralAnt.focus) S.lateralAnt.focus();
    S.lateralAnt = null;
  }

  /* ---------- CSV ---------- */
  function gerarCSV(lista) {
    const cel = v => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const cab = ['Numero', 'Data e hora', 'Cliente', 'Telefone', 'Modo', 'Itens', 'Total', 'Pagamento', 'Status', 'Origem', 'Mesa'];
    const linhas = lista.map(p => [ML.fmt.numero(p.numero), dataHora(p.criadoEm), nomeCli(p), (p.cliente && p.cliente.telefone) || '', modoLabel(p.modo),
      p.itens.map(i => i.qtd + 'x ' + i.nome + (i.resumo ? ' (' + i.resumo + ')' : '')).join(' | '), p.total.toFixed(2).replace('.', ','), p.pagamento || 'a combinar', statusPainel(p.status), p.origem, p.mesa || ''].map(cel).join(';'));
    return '﻿' + [cab.map(cel).join(';')].concat(linhas).join('\r\n');
  }
  function mostrarCSV(csv) {
    abrirModal('CSV do histórico', `<h3 class="pn-modal-t">CSV do histórico</h3><textarea class="pn-input pn-csv" readonly rows="12" data-foco>${esc(csv)}</textarea>
      <div class="pn-modal-acoes"><button type="button" class="pn-btn pn-btn--prim" data-m="copiar-csv">Copiar</button><button type="button" class="pn-btn" data-m="fechar">Fechar</button></div>`);
  }
  function exportarCSV() {
    const lista = filtrarHist(), csv = gerarCSV(lista), d = new Date();
    const nome = 'pedidos-mineiro-lanche-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.csv';
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = nome; a.className = 'pn-fora';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(lista.length + ' pedidos exportados');
    } catch { mostrarCSV(csv); }
  }

  /* ---------- ações ---------- */
  function avancar(id) {
    const p = pedidoPorId(id), prox = p && ML.regras.proximoStatus(p);
    if (!prox) return;
    S.focoId = id;
    ML.store.avancar(id);
    toast(ML.fmt.numero(p.numero) + ': ' + statusPainel(prox), { dur: 2500 });
    S.naoVistos.delete(id); atualizarTitulo();
    agendar();
  }
  function abrirCancelar(id, card) {
    if (card.querySelector('.pn-cancel')) { card.querySelector('.pn-cancel input').focus(); return; }
    const p = pedidoPorId(id), num = ML.fmt.numero(p.numero);
    const d = document.createElement('div');
    d.className = 'pn-cancel'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Cancelar pedido ' + num);
    d.innerHTML = `<label class="pn-campo"><span class="pn-campo-r">Motivo do cancelamento</span><input type="text" class="pn-input" maxlength="120" autocomplete="off"></label>
      <p class="pn-erro" role="alert" hidden>Informe o motivo.</p>
      <div class="pn-cancel-b"><button type="button" class="pn-btn pn-btn--perigo" data-act="cancelar-ok" data-id="${esc(id)}">Confirmar cancelamento</button><button type="button" class="pn-btn" data-act="cancelar-voltar">Voltar</button></div>`;
    card.appendChild(d);
    card.removeAttribute('draggable');
    d.querySelector('input').focus();
  }
  function fecharCancelar(card) {
    const d = card.querySelector('.pn-cancel'); if (d) d.remove();
    const p = pedidoPorId(card.dataset.id);
    if (p && ML.regras.proximoStatus(p)) card.setAttribute('draggable', 'true');
    const b = card.querySelector('[data-act="cancelar"]'); if (b) b.focus();
  }
  function confirmarCancelar(id, card) {
    const d = card.querySelector('.pn-cancel'), inp = d.querySelector('input'), motivo = inp.value.trim();
    if (!motivo) { d.querySelector('.pn-erro').hidden = false; inp.focus(); return; }
    const p = pedidoPorId(id);
    ML.store.atualizarStatus(id, 'cancelado', motivo);
    toast(ML.fmt.numero(p.numero) + ' cancelado', { dur: 2500 });
    agendar();
  }

  // demonstração (VITE_DEMO=1): um pedido de exemplo realista, gravado no servidor como 'novo'
  function simular() {
    ML.store.gerarExemplos(1).then(agendar, () => { /* o aviso já veio pela store (store:erro) */ });
  }

  function abrirCardapio() {
    // o cardápio vive na página do cliente (/), não no /painel/
    const url = location.origin + '/#cardapio';
    let w = null;
    try { w = window.open('/#cardapio', 'ml-cardapio', 'width=430,height=860'); } catch { w = null; }
    if (!w) toast('Abra o cardápio em outra aba: ' + url, { dur: 9000 });
  }

  /* ---------- eventos ---------- */
  function onClick(e) {
    marcarInteracao();
    const t = e.target;
    const nav = t.closest('[data-nav]'); if (nav) { irPara(nav.dataset.nav); return; }
    const lj = t.closest('[data-loja]'); if (lj) { ML.store.definirLoja(lj.dataset.loja); agendar(); return; }
    const b = t.closest('[data-act]');
    if (!b) {
      const tr = t.closest('tr[data-id]');
      if (tr) abrirDetalhe(tr.dataset.id);
      return;
    }
    const act = b.dataset.act, id = b.dataset.id, card = b.closest('.pn-card');
    switch (act) {
      case 'avancar': avancar(id); break;
      case 'imprimir': abrirComanda(id); break;
      case 'cancelar': abrirCancelar(id, card); break;
      case 'cancelar-ok': confirmarCancelar(id, card); break;
      case 'cancelar-voltar': fecharCancelar(card); break;
      case 'copiar': { const p = pedidoPorId(id); copiar(p.endereco).then(ok => toast(ok ? 'Endereço copiado' : 'Não foi possível copiar o endereço')); break; }
      case 'recolher': {
        S.recolhido = !S.recolhido;
        q('[data-board]').classList.toggle('pn-board--rec', S.recolhido);
        q('.pn-col--concluidos').classList.toggle('pn-col--rec', S.recolhido);
        b.setAttribute('aria-expanded', String(!S.recolhido));
        b.setAttribute('aria-label', (S.recolhido ? 'Expandir' : 'Recolher') + ' coluna Concluídos hoje');
        b.innerHTML = ic(S.recolhido ? 'mais' : 'menos');
        break;
      }
      case 'som': ML.store.salvarConfig({ som: !S.cfg.som }); S.cfg = ML.store.config(); renderChrome(); if (S.cfg.som) { marcarInteracao(); tocar(); } break;
      case 'cfg-som': ML.store.salvarConfig({ som: !S.cfg.som }); S.cfg = ML.store.config(); renderChrome(); break;
      case 'simular': simular(); break;
      case 'abrir-cardapio': abrirCardapio(); break;
      case 'detalhe': abrirDetalhe(id); break;
      case 'fechar-lateral': fecharDetalhe(); break;
      case 'csv': exportarCSV(); break;
      case 'csv-ver': mostrarCSV(gerarCSV(filtrarHist())); break;
      case 'esgotar': ML.store.marcarEsgotado(id, b.getAttribute('aria-checked') !== 'true'); agendar(); break;
      case 'esgotar-cat': {
        const cat = ML.CONFIG.categorias.find(c => c.id === b.dataset.cat), alvo = b.dataset.todos !== '1';
        if (cat) cat.itens.forEach(i => ML.store.marcarEsgotado(i.id, alvo));
        agendar(); break;
      }
      case 'gerar15': {
        b.disabled = true;
        ML.store.gerarExemplos(15).then(() => toast('15 pedidos de exemplo criados'), () => {}).then(() => { b.disabled = false; agendar(); });
        break;
      }
      case 'apagar': {
        const c = q('[data-confirma]'), n = ML.store.pedidos().filter(p => p.origem === 'exemplo').length;
        q('[data-confirma-t]').textContent = n ? 'Apagar ' + n + (n === 1 ? ' pedido de exemplo' : ' pedidos de exemplo') + '? Os pedidos de clientes não são apagados. Isso não pode ser desfeito.' : 'Não há pedidos de exemplo para apagar.';
        c.hidden = false; q('[data-act="apagar-ok"]').hidden = !n;
        (n ? q('[data-act="apagar-ok"]') : q('[data-act="apagar-no"]')).focus();
        break;
      }
      case 'apagar-ok': ML.store.removerTestes().then(n => toast(n === 1 ? '1 pedido de exemplo apagado' : n + ' pedidos de exemplo apagados'), () => {}); q('[data-confirma]').hidden = true; q('[data-act="apagar"]').focus(); agendar(); break;
      case 'sair': b.disabled = true; if (S.opc.aoSair) S.opc.aoSair(); break;
      case 'apagar-no': q('[data-confirma]').hidden = true; q('[data-act="apagar"]').focus(); break;
      default: break;
    }
  }
  function onInput(e) {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    if (f === 'q') S.hq = e.target.value; else if (f === 'st') S.hst = e.target.value; else if (f === 'per') S.hper = e.target.value;
    renderHist();
  }
  function onChangeCfg(e) {
    const k = e.target.dataset && e.target.dataset.cfg;
    if (!k) return;
    const aten = k === 'atencaoMin' ? +e.target.value : +q('[data-cfg="atencaoMin"]').value;
    const atra = k === 'atrasoMin' ? +e.target.value : +q('[data-cfg="atrasoMin"]').value;
    const erro = q('[data-cfgerro]');
    if (!(aten >= 1) || !(atra > aten)) { erro.hidden = false; return; }
    erro.hidden = true;
    ML.store.salvarConfig({ atencaoMin: aten, atrasoMin: atra });
    S.cfg = ML.store.config(); tickTempos();
  }
  function onKey(e) {
    if (e.key === 'Escape' && S.detalhe && !modalAtual) { fecharDetalhe(); return; }
    if (S.detalhe && !modalAtual) prenderFoco(e, q('[data-lateral]'));
    const t = e.target;
    if (t.closest && t.closest('.pn-cancel')) {
      const card = t.closest('.pn-card');
      if (e.key === 'Escape') { e.stopPropagation(); fecharCancelar(card); }
      else if (e.key === 'Enter' && t.tagName === 'INPUT') { e.preventDefault(); confirmarCancelar(card.dataset.id, card); }
    }
    if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('pn-lin')) { abrirDetalhe(t.dataset.id); }
  }

  /* arrastar e soltar */
  function ligarArraste(board) {
    const limpar = () => {
      S.arrastando = null;
      board.classList.remove('pn-dragging');
      qa('.pn-col', board).forEach(c => c.classList.remove('pn-col--ok', 'pn-col--sobre'));
      qa('.pn-arrastando', board).forEach(c => c.classList.remove('pn-arrastando'));
    };
    board.addEventListener('dragstart', e => {
      const c = e.target.closest && e.target.closest('.pn-card');
      if (!c) return;
      const p = pedidoPorId(c.dataset.id);
      if (!p || !ML.regras.proximoStatus(p)) { e.preventDefault(); return; }
      S.arrastando = p.id;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', p.id); } catch { /* ignorado */ }
      const alvo = colAlvo(p);
      board.classList.add('pn-dragging');
      qa('.pn-col', board).forEach(col => col.classList.toggle('pn-col--ok', col.dataset.col === alvo));
      setTimeout(() => c.classList.add('pn-arrastando'), 0);
    });
    board.addEventListener('dragover', e => {
      const col = e.target.closest && e.target.closest('.pn-col');
      if (!col || !S.arrastando) return;
      if (col.classList.contains('pn-col--ok')) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        col.classList.add('pn-col--sobre');
      } else e.dataTransfer.dropEffect = 'none';
    });
    board.addEventListener('dragleave', e => {
      const col = e.target.closest && e.target.closest('.pn-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('pn-col--sobre');
    });
    board.addEventListener('drop', e => {
      const col = e.target.closest && e.target.closest('.pn-col');
      if (!col || !S.arrastando || !col.classList.contains('pn-col--ok')) return;
      e.preventDefault();
      const id = S.arrastando;
      limpar();
      avancar(id);
    });
    board.addEventListener('dragend', e => {
      const c = e.target.closest && e.target.closest('.pn-card');
      const solto = e.dataTransfer && e.dataTransfer.dropEffect !== 'none';
      limpar();
      if (c && !solto) { c.classList.remove('pn-treme'); void c.offsetWidth; c.classList.add('pn-treme'); }
    });
    board.addEventListener('animationend', e => {
      if (e.animationName === 'pn-treme') e.target.classList.remove('pn-treme');
      if (e.animationName === 'pn-entra') e.target.classList.remove('pn-entra');
    });
  }

  /* ---------- API pública ---------- */
  function montar(el, opcoes) {
    if (S.montado || !el) return;
    S.montado = true;
    S.opc = opcoes || {};
    S.root = el;
    el.classList.add('painel');
    el.innerHTML = esqueleto();
    S.toasts = document.createElement('div');
    S.toasts.className = 'pn-toasts'; S.toasts.setAttribute('aria-live', 'polite'); S.toasts.setAttribute('role', 'status');
    document.body.appendChild(S.toasts);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', e => { onInput(e); onChangeCfg(e); });
    el.addEventListener('keydown', onKey);
    el.addEventListener('error', ev => { if (ev.target && ev.target.tagName === 'IMG') ev.target.style.visibility = 'hidden'; }, true);
    q('[data-fundo]').addEventListener('click', fecharDetalhe);
    ligarArraste(q('[data-board]'));
    document.addEventListener('pointerdown', marcarInteracao);
    document.addEventListener('keydown', marcarInteracao);
    window.addEventListener('focus', () => { if (S.visivel) limparNaoVistos(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.visivel) limparNaoVistos(); });
    ML.store.ouvir(aoEvento);
    S.cfg = ML.store.config();
    S.pedidos = ML.store.pedidos();
    S.conhecidos = new Set(S.pedidos.map(p => p.id)); S.iniciou = true;
    irPara('pedidos');
    renderChrome();
  }
  function mostrar() {
    if (!S.montado) return;
    S.visivel = true;
    limparNaoVistos();
    if (!S.tickId) S.tickId = setInterval(tick, 1000);
    S.cfg = ML.store.config(); S.pedidos = ML.store.pedidos();
    renderTudo(); S.sujo = false;
    tick();
    const a = document.activeElement;
    if (!a || a === document.body) q('[data-titulo]').focus({ preventScroll: true });
  }
  // sessão expirada (acesso.js): nada com dados de cliente fica por cima do login. O modal (comanda, CSV) vive
  // no body, fora do quadro escondido; o detalhe lateral e os avisos também saem
  function esconder() {
    S.visivel = false;
    if (S.tickId) { clearInterval(S.tickId); S.tickId = null; }
    qa('[data-kpi]').forEach(k => { if (k._raf) { cancelAnimationFrame(k._raf); k._raf = null; } });
    fecharModal();
    fecharDetalhe();
    if (S.toasts) S.toasts.textContent = '';
  }

  window.MLPainel = { montar, mostrar, esconder };
})();
