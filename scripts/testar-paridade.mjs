// Paridade core.js ⇄ banco: monta seleções variadas, calcula item, resumo e total com o próprio core.js (node:vm)
// e compara com o que o criar_pedido devolve pela API HTTP local, centavo a centavo e caractere a caractere.
// Confere também o horário (situacaoNo × horario_aberto), o "Preço a confirmar" (preco null no CONFIG: o banco
// guarda null, o estado_cardapio devolve null e o criar_pedido recusa) e o acesso pela API (anon, logado e equipe).
// Uso: node scripts/testar-paridade.mjs [caminho/do/core.js]
//   API_URL (padrão http://localhost:54321), PG_URL (padrão postgresql://postgres@localhost:54322/postgres), SEMENTE
// Pré-requisito: bash scripts/supabase-local/iniciar.sh e o supabase/setup.sql aplicado.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { carregarCore, caminhoCore } from './gerar-seed.mjs';

const API = process.env.API_URL || 'http://localhost:54321';
const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const CHAVE = 'sb_publishable_local';
const SEGREDO_LOCAL = process.env.JWT_SECRET || 'segredo-local-de-teste-com-mais-de-32-caracteres'; // só do Supabase local
const EQUIPE = '00000000-0000-4000-8000-000000000001';
const SEMENTE = Number(process.env.SEMENTE || 20261008);

let falhas = 0;
let oks = 0;
function ok(cond, msg, detalhe) {
  if (cond) {
    oks++;
    return true;
  }
  falhas++;
  console.log('FALHOU: ' + msg + (detalhe ? '\n  ' + detalhe : ''));
  return false;
}

function sql(comando) {
  return execFileSync('psql', [PG, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: comando,
    encoding: 'utf8'
  }).trim();
}

async function http(metodo, rota, { corpo, token } = {}) {
  const r = await fetch(API + rota, {
    method: metodo,
    headers: { apikey: CHAVE, Authorization: 'Bearer ' + (token || CHAVE), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  return { status: r.status, json, texto };
}

// JWT local (HS256) para simular um usuário logado que não é da equipe
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload);
  return corpo + '.' + crypto.createHmac('sha256', SEGREDO_LOCAL).update(corpo).digest('base64url');
}

// comparação profunda sem depender da ordem das chaves
function canonico(v) {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v)
      .sort()
      .forEach((k) => (o[k] = canonico(v[k])));
    return o;
  }
  return v;
}
const mesmo = (a, b) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
function diferencas(a, b, caminho = '') {
  if (mesmo(a, b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return ks.flatMap((k) => diferencas(a[k], b[k], caminho + '.' + k));
  }
  return [`${caminho || '.'}: servidor ${JSON.stringify(a)} × core ${JSON.stringify(b)}`];
}

// PRNG com semente (mulberry32): a mesma semente gera as mesmas seleções
function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const arquivo = caminhoCore(process.argv[2]);
  const { ML, CONFIG } = carregarCore(arquivo);
  console.log('core: ' + arquivo + ' · semente ' + SEMENTE);

  // ponto de partida: loja aberta e usuário de teste na equipe
  sql(`update loja set modo = 'aberta' where id = 1;
       insert into equipe (user_id, nome) values ('${EQUIPE}', 'Equipe teste') on conflict do nothing;`);
  const ping = await http('GET', '/rest/v1/loja?select=modo');
  if (ping.status !== 200) throw new Error('API local fora do ar ou sem schema (' + ping.status + '): ' + ping.texto);

  // ================= seleções =================
  const rnd = prng(SEMENTE);
  const int = (n) => Math.floor(rnd() * n);
  const escolher = (a) => a[int(a.length)];
  const embaralhar = (a) =>
    a
      .map((x) => [rnd(), x])
      .sort((p, q) => p[0] - q[0])
      .map((p) => p[1]);
  const todos = [];
  CONFIG.categorias.forEach((c) => c.itens.forEach((p) => todos.push(p)));
  // só o que tem preço vai para a sacola; o "Preço a confirmar" (preco null) é conferido à parte
  const produtos = todos.filter((p) => ML.regras.temPreco(p));
  const semPreco = todos.filter((p) => p.preco === null);
  ok(
    produtos.length + semPreco.length === todos.length,
    'CONFIG: todo produto tem preço numérico ou null',
    todos
      .filter((p) => !produtos.includes(p) && !semPreco.includes(p))
      .map((p) => p.id)
      .join(', ')
  );
  const refris = ['', 'Coca-Cola', '  Guaraná  ', 'Fanta Uva', 'Sprite'];
  const sabores = ['Coca-Cola', ' Guaraná ', 'Uva', 'Laranja', 'Limão'];

  function selecao(p, forte) {
    const r = rnd();
    const sel = {
      produtoId: p.id,
      qtd: r < 0.55 ? 1 : r < 0.85 ? 2 + int(3) : r < 0.97 ? 5 + int(10) : 20,
      completo: true,
      removidos: [],
      prensado: rnd() < 0.5, // em porção e bebida o core e o banco descartam
      combo: { ativo: false, refri: '' },
      adicionais: {},
      sabor: ''
    };
    if (p.ing && p.ing.length && rnd() < (forte ? 0.8 : 0.4)) {
      sel.removidos = embaralhar(p.ing).slice(0, 1 + int(Math.min(4, p.ing.length)));
      if (rnd() < 0.3) sel.removidos.push('Abacaxi'); // fora dos ingredientes: descartado
      sel.completo = false;
    }
    if (p.tipo === 'lanche' && rnd() < (forte ? 0.7 : 0.4)) sel.combo = { ativo: true, refri: escolher(refris) };
    if ((p.tipo === 'lanche' || p.tipo === 'combo') && rnd() < (forte ? 0.85 : 0.4)) {
      embaralhar(CONFIG.adicionais)
        .slice(0, 1 + int(forte ? 5 : 3))
        .forEach((a) => (sel.adicionais[a.id] = 1 + int(5)));
    }
    if (p.sabor && rnd() < 0.8) sel.sabor = escolher(sabores);
    return sel;
  }

  // todos os produtos uma vez + 30 lanches e combos com muitas opções
  const sels = produtos.map((p) => selecao(p, false));
  const comOpcoes = produtos.filter((p) => p.tipo === 'lanche' || p.tipo === 'combo');
  for (let i = 0; i < 30; i++) sels.push(selecao(escolher(comOpcoes), true));
  const itensCore = sels.map((s) => {
    const it = JSON.parse(JSON.stringify(ML.precos.item(s)));
    delete it.chave;
    return it;
  });

  // cobertura: cada tipo de opção aparece de verdade
  const cobertura = {
    'tipos (4)': new Set(itensCore.map((i) => i.tipo)).size === 4,
    combo: itensCore.some((i) => i.combo.ativo),
    'combo sem refri': itensCore.some((i) => i.combo.ativo && !i.combo.refri),
    adicionais: itensCore.some((i) => i.adicionais.length > 1),
    'adicional qtd > 1': itensCore.some((i) => i.adicionais.some((a) => a.qtd > 1)),
    removidos: itensCore.some((i) => i.removidos.length > 1),
    'removido inválido descartado': sels.some((s) => s.removidos.includes('Abacaxi')),
    prensado: itensCore.some((i) => i.prensado),
    'prensado descartado': sels.some((s, k) => s.prensado && !itensCore[k].prensado),
    sabor: itensCore.some((i) => i.sabor),
    'qtd > 1': itensCore.some((i) => i.qtd > 1),
    'qtd 20': itensCore.some((i) => i.qtd === 20)
  };
  Object.keys(cobertura).forEach((k) => ok(cobertura[k], 'cobertura das seleções: ' + k));
  ok(sels.length >= 60, 'pelo menos 60 seleções (' + sels.length + ')');

  // ================= pedidos pela API =================
  const base = 10000000 + (Math.floor(Date.now() / 1000) % 800000) * 100;
  const pedidos = [];
  for (let i = 0, n = 0; i < sels.length; n++) {
    const k = 1 + int(4);
    pedidos.push({ idx: n, de: i, ate: Math.min(sels.length, i + k), telefone: '119' + String(base + n).padStart(8, '0') });
    i += k;
  }
  const telefones = pedidos.map((p) => p.telefone);
  const criados = [];
  try {
    for (const ped of pedidos) {
      const modo = escolher(['entrega', 'retirada', 'local']);
      const payload = {
        cliente: { nome: 'Paridade ' + ped.idx, telefone: ped.telefone },
        modo,
        endereco: modo === 'entrega' ? 'Rua das Flores, 123' : '',
        referencia: '',
        pagamento: null,
        troco: '',
        obs: 'paridade',
        origem: escolher(['cardapio', 'qrcode']),
        mesa: modo === 'local' ? String(1 + int(10)) : null,
        idempotencia: crypto.randomUUID(),
        total: 0.01, // adulterado: o servidor ignora
        itens: sels.slice(ped.de, ped.ate).map((s) => ({
          produtoId: s.produtoId,
          qtd: s.qtd,
          completo: s.completo,
          removidos: s.removidos,
          prensado: s.prensado,
          combo: s.combo,
          adicionais: Object.keys(s.adicionais).map((id) => ({ id, qtd: s.adicionais[id], nome: 'adulterado', preco: 0.01 })),
          sabor: s.sabor,
          nome: 'adulterado',
          precoBase: 0.01,
          precoUnit: 0.01,
          subtotal: 0.01,
          resumo: 'adulterado'
        }))
      };
      const r = await http('POST', '/rest/v1/rpc/criar_pedido', { corpo: { p: payload } });
      if (!ok(r.status === 200 && r.json && r.json.id, `pedido ${ped.idx}: criado (HTTP ${r.status})`, r.texto)) continue;
      criados.push({ ped, payload, resp: r.json });
      const esperados = itensCore.slice(ped.de, ped.ate);
      const total = Math.round(esperados.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
      ok(r.json.total === total, `pedido ${ped.idx}: total ${r.json.total} = core ${total}`);
      ok(r.json.itens.length === esperados.length, `pedido ${ped.idx}: ${esperados.length} itens`);
      r.json.itens.forEach((it, j) => {
        const dif = diferencas(it, esperados[j]);
        ok(!dif.length, `pedido ${ped.idx}, item ${j} (${esperados[j].produtoId}): igual ao core.js`, dif.join('\n  '));
      });
      ok(
        r.json.status === 'novo' && r.json.cliente.telefone === ped.telefone && r.json.modo === modo && r.json.origem === payload.origem,
        `pedido ${ped.idx}: status, cliente, modo e origem`
      );
    }
    console.log(`paridade: ${sels.length} seleções em ${pedidos.length} pedidos`);

    // idempotência pela API: reenviar o mesmo pedido devolve o mesmo
    if (criados.length) {
      const c = criados[0];
      const r = await http('POST', '/rest/v1/rpc/criar_pedido', { corpo: { p: c.payload } });
      ok(r.status === 200 && r.json.id === c.resp.id && r.json.numero === c.resp.numero, 'reenvio com o mesmo uuid devolve o mesmo pedido');
    }

    // ================= "Preço a confirmar": core.js × banco =================
    const listaProdutos = await http('GET', '/rest/v1/produtos?select=id,preco,ativo');
    const precoNoBanco = Object.fromEntries((listaProdutos.json || []).map((p) => [p.id, p.preco]));
    const estadoPrecos = await http('POST', '/rest/v1/rpc/estado_cardapio', { corpo: {} });
    for (const p of semPreco) {
      ok(p.id in precoNoBanco && precoNoBanco[p.id] === null, `${p.id}: preco null no banco (seed)`, JSON.stringify(precoNoBanco[p.id]));
      ok(
        estadoPrecos.status === 200 && p.id in estadoPrecos.json.precos && estadoPrecos.json.precos[p.id] === null,
        `${p.id}: estado_cardapio devolve preço null`
      );
      ok(
        ML.fmt.brl(p.preco) === 'Preço a confirmar' && ML.precos.unitario({ produtoId: p.id }) === null,
        `${p.id}: core.js mostra "Preço a confirmar" e não calcula preço`
      );
      const r = await http('POST', '/rest/v1/rpc/criar_pedido', {
        corpo: {
          p: {
            cliente: { nome: 'Paridade sem preço', telefone: telefones[0] },
            modo: 'retirada',
            obs: 'paridade',
            itens: [{ produtoId: p.id, qtd: 1, precoUnit: 30, subtotal: 30 }]
          }
        }
      });
      ok(
        r.status >= 400 && r.json && r.json.message === 'produto_invalido',
        `${p.id}: criar_pedido recusa com produto_invalido (HTTP ${r.status})`,
        r.texto.slice(0, 200)
      );
    }
    const precoDiferente = produtos.filter((p) => precoNoBanco[p.id] !== p.preco);
    ok(
      !precoDiferente.length,
      `preços do banco = CONFIG (${produtos.length} produtos com preço)`,
      precoDiferente.map((p) => `${p.id}: banco ${precoNoBanco[p.id]} × CONFIG ${p.preco}`).join(', ')
    );

    // ================= horário: core.js × banco =================
    if (ML.horario && ML.horario.situacaoNo) {
      const js = [];
      for (let d = 0; d < 7; d++) for (let m = 0; m < 1440; m += 5) js.push(ML.horario.situacaoNo(d, m).aberto ? '1' : '0');
      const banco = sql(`select string_agg(case when horario_aberto(l.horarios,
                           (date '2026-10-11' + d * interval '1 day' + m * interval '1 minute') at time zone 'America/Sao_Paulo')
                         then '1' else '0' end, '' order by d, m)
                         from loja l, generate_series(0, 6) d, generate_series(0, 1435, 5) m`);
      const dif = [];
      for (let k = 0; k < js.length; k++) if (js[k] !== banco[k]) dif.push(`dia ${Math.floor(k / 288)} ${ML.fmt.relogio((k % 288) * 5)}`);
      ok(
        !dif.length && banco.length === js.length,
        `horário: ${js.length} momentos da semana iguais ao ML.horario.situacaoNo`,
        dif.slice(0, 10).join(', ')
      );
    } else {
      console.log('aviso: ML.horario.situacaoNo não existe neste core.js; comparação de horário pulada');
    }

    // ================= acesso pela API =================
    const tabelas = { produtos: 'id', adicionais: 'id', loja: 'id', pedidos: 'id', clientes: 'telefone', equipe: 'user_id' };
    const valor = { id: 'gran-burger', telefone: telefones[0], user_id: EQUIPE };
    for (const t of ['pedidos', 'clientes', 'equipe']) {
      const r = await http('GET', `/rest/v1/${t}?select=*`);
      ok(r.status >= 400, `anon GET /${t}: erro (HTTP ${r.status})`, r.texto.slice(0, 200));
    }
    for (const [t, n] of [
      ['produtos', todos.length],
      ['adicionais', 5],
      ['loja', 1]
    ]) {
      const r = await http('GET', `/rest/v1/${t}?select=*`);
      ok(r.status === 200 && Array.isArray(r.json) && r.json.length === n, `anon GET /${t}: ${n} linhas`);
    }
    for (const [t, col] of Object.entries(tabelas)) {
      const filtro = `?${col}=eq.${t === 'loja' ? 1 : t === 'pedidos' ? criados[0].resp.id : valor[col]}`;
      const post = await http('POST', `/rest/v1/${t}`, { corpo: { [col]: t === 'loja' ? 2 : 'x' } });
      ok(post.status >= 400, `anon POST /${t}: erro (HTTP ${post.status})`);
      const patch = await http('PATCH', `/rest/v1/${t}${filtro}`, {
        corpo: t === 'loja' ? { modo: 'fechada' } : t === 'pedidos' ? { total: 0 } : { nome: 'x' }
      });
      ok(patch.status >= 400, `anon PATCH /${t}: erro (HTTP ${patch.status})`);
      const del = await http('DELETE', `/rest/v1/${t}${filtro}`);
      ok(del.status >= 400, `anon DELETE /${t}: erro (HTTP ${del.status})`);
    }
    ok(
      sql(`select modo from loja`) === 'aberta' && sql(`select count(*) from produtos`) === String(todos.length),
      'depois das tentativas, loja e produtos intactos'
    );
    for (const [fn, args] of [
      ['mudar_status', { p_id: criados[0].resp.id, p_status: 'preparo' }],
      ['marcar_esgotado', { p_produto: 'gran-burger', p_esgotado: true }],
      ['definir_loja', { p_modo: 'fechada' }],
      ['remover_testes', {}],
      ['resumo_item', { p_item: {}, p_combo_preco: 1 }]
    ]) {
      const r = await http('POST', `/rest/v1/rpc/${fn}`, { corpo: args });
      ok(r.status >= 400, `anon rpc/${fn}: erro (HTTP ${r.status})`);
    }
    const estado = await http('POST', '/rest/v1/rpc/estado_cardapio', { corpo: {} });
    ok(
      estado.status === 200 && estado.json.loja.modo === 'aberta' && Object.keys(estado.json.precos).length === todos.length,
      'anon rpc/estado_cardapio'
    );
    const acomp = await http('POST', '/rest/v1/rpc/acompanhar_pedido', { corpo: { p_token: criados[0].resp.token } });
    ok(
      acomp.status === 200 &&
        acomp.json.numero === criados[0].resp.numero &&
        !acomp.texto.includes(telefones[0]) &&
        !acomp.texto.includes('Paridade'),
      'anon rpc/acompanhar_pedido: sem nome e telefone'
    );

    // logado fora da equipe: não vê pedidos e não muda status
    const agora = Math.floor(Date.now() / 1000);
    const estranho = jwt({ sub: crypto.randomUUID(), role: 'authenticated', aud: 'authenticated', iat: agora, exp: agora + 600 });
    const lista = await http('GET', '/rest/v1/pedidos?select=id', { token: estranho });
    ok(lista.status === 200 && Array.isArray(lista.json) && lista.json.length === 0, 'logado fora da equipe: GET /pedidos vem vazio');
    const negado = await http('POST', '/rest/v1/rpc/mudar_status', {
      corpo: { p_id: criados[0].resp.id, p_status: 'preparo' },
      token: estranho
    });
    ok(
      negado.status >= 400 && negado.json && negado.json.message === 'sem_permissao',
      'logado fora da equipe: mudar_status → sem_permissao'
    );

    // equipe pelo login do proxy: lê pedidos e muda status
    const login = await http('POST', '/auth/v1/token?grant_type=password', {
      corpo: { email: 'equipe@teste.local', password: 'qualquer' }
    });
    const token = login.json && login.json.access_token;
    if (ok(login.status === 200 && token, 'login da equipe (equipe@teste.local)')) {
      const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
      const r = await http('GET', `/rest/v1/pedidos?select=*&criado_em=gte.${desde}&order=criado_em`, { token });
      const ids = new Set((r.json || []).map((p) => p.id));
      ok(r.status === 200 && criados.every((c) => ids.has(c.resp.id)), 'equipe: GET /pedidos das últimas 48 h traz os pedidos criados');
      const m = await http('POST', '/rest/v1/rpc/mudar_status', { corpo: { p_id: criados[0].resp.id, p_status: 'preparo' }, token });
      ok(m.status === 200 && m.json.status === 'preparo' && m.json.historico.length === 2, 'equipe: mudar_status novo → preparo');
      const inv = await http('POST', '/rest/v1/rpc/mudar_status', { corpo: { p_id: criados[0].resp.id, p_status: 'novo' }, token });
      ok(inv.status >= 400 && inv.json.message === 'transicao_invalida', 'equipe: preparo → novo → transicao_invalida (código no message)');
    }
  } finally {
    // limpa os pedidos e clientes da paridade (o banco local fica para o agente de integração)
    sql(`delete from pedidos where obs = 'paridade' and cliente_nome like 'Paridade %';
         delete from clientes where telefone in (${telefones.map((t) => `'${t}'`).join(', ')});`);
  }

  console.log(falhas ? `${falhas} falha(s), ${oks} verificações ok` : `paridade ok: ${oks} verificações`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
