import { UUID, assinaturaValida, criarOrder, conferirOrder } from '../_shared/mercado-pago.js';

const permitidos = new Set([
  'nao_encontrado',
  'email_invalido',
  'pagamento_encerrado',
  'sem_permissao',
  'cancele_antes_de_estornar',
  'pagamento_divergente',
  'pagamento_em_criacao',
  'pagamento_online_ativo'
]);
const falhar = (codigo, status = 503) => Object.assign(new Error(codigo), { codigo, status });
export function criarPagamentos(
  config,
  { webhook = false, fetcher = fetch, registrarErro = (evento) => console.error(JSON.stringify(evento)) } = {}
) {
  const { supabaseUrl, serviceKey, accessToken, webhookSecret, accountId, applicationId, mode, siteUrl } = config;
  const base = String(supabaseUrl || '').replace(/\/$/, '');
  const origens = new Set([
    'https://mineirolanches.store',
    'https://mineiro-lanches.vercel.app',
    'http://localhost:4180',
    'http://localhost:5173'
  ]);
  try {
    origens.add(new URL(siteUrl).origin);
  } catch {
    /* configuração validada antes das operações */
  }
  async function http(url, op = {}) {
    const ctl = new AbortController(),
      timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetcher(url, { ...op, signal: ctl.signal });
      if (!r.ok) {
        let j = {};
        try {
          j = await r.json();
        } catch {
          /* sem corpo */
        }
        const codigo = permitidos.has(j.message) ? j.message : 'pagamento_indisponivel';
        const erro = falhar(
          codigo,
          codigo === 'sem_permissao' ? 403 : codigo === 'nao_encontrado' ? 404 : codigo === 'pagamento_indisponivel' ? 503 : 422
        );
        erro.servico = url.startsWith('https://api.mercadopago.com/') ? 'mercado_pago' : 'supabase';
        erro.httpStatus = r.status;
        throw erro;
      }
      return r.status === 204 ? null : await r.json();
    } catch (e) {
      throw e.codigo ? e : falhar('pagamento_indisponivel');
    } finally {
      clearTimeout(timer);
    }
  }
  const db = (path, body) =>
    http(base + '/rest/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  const rpc = (nome, body) => db('rpc/' + nome, body);
  const mp = (path, body, idem) =>
    http('https://api.mercadopago.com' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        ...(idem ? { 'X-Idempotency-Key': idem } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  async function registrar(order, p) {
    const campos = conferirOrder(order, p, accountId, mode);
    if (String(order.integration_data?.application_id) !== String(applicationId))
      throw Object.assign(falhar('pagamento_divergente', 422), { etapa: 'validacao_aplicacao' });
    const r = await rpc('registrar_pagamento_mp', campos);
    return { ...p, estado: r.estado, order_id: order.id, checkout_url: campos.p_checkout || p.checkout_url };
  }
  async function consultar(p) {
    return registrar(await mp('/v1/orders/' + encodeURIComponent(p.order_id)), p);
  }
  function publico(p) {
    return {
      estado: p.estado,
      checkoutUrl: p.pedido_status !== 'cancelado' && ['pendente', 'recusado'].includes(p.estado) ? p.checkout_url || null : null,
      processando: !p.order_id && !!p.id,
      ...(!p.order_id && p.id ? { tentarEmMs: Math.max(1000, Math.min(30000, Date.parse(p.criando_ate) - Date.now() + 200 || 2000)) } : {})
    };
  }
  return async (req) => {
    const origin = req.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (!webhook && origin && origens.has(origin))
      Object.assign(headers, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      });
    const resposta = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!webhook && origin && !origens.has(origin)) return resposta(403, { codigo: 'origem_invalida' });
    if (req.method === 'OPTIONS' && !webhook) return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return resposta(405, { codigo: 'metodo_invalido' });
    if (
      !base ||
      !serviceKey ||
      !accessToken ||
      (webhook && !webhookSecret) ||
      !/^\d+$/.test(String(accountId || '')) ||
      !/^\d+$/.test(String(applicationId || '')) ||
      !['test', 'production'].includes(mode) ||
      !siteUrl
    )
      return resposta(503, { codigo: 'pagamento_nao_configurado' });
    try {
      if (webhook && !(await assinaturaValida(req, webhookSecret))) return resposta(401, { codigo: 'assinatura_invalida' });
      if (Number(req.headers.get('content-length') || 0) > 16384) return resposta(413, { codigo: 'dados_invalidos' });
      const raw = await req.text();
      if (raw.length > 16384) return resposta(413, { codigo: 'dados_invalidos' });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return resposta(400, { codigo: 'dados_invalidos' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return resposta(400, { codigo: 'dados_invalidos' });
      if (webhook) {
        const id = new URL(req.url).searchParams.get('data.id');
        if (!['order', 'orders_v2'].includes(body.type) || String(body.data?.id || '').toLowerCase() !== id.toLowerCase())
          return resposta(400, { codigo: 'notificacao_invalida' });
        const order = await mp('/v1/orders/' + encodeURIComponent(id));
        if (!UUID.test(order.external_reference || '')) return resposta(200, { ignorado: true });
        const rows = await db('pagamentos_mp?id=eq.' + order.external_reference + '&select=*');
        if (!rows.length) return resposta(200, { ignorado: true });
        await registrar(order, rows[0]);
        return resposta(200, { ok: true });
      }
      if (body.acao === 'reconciliar') {
        // Além do gateway JWT, a manutenção exige a credencial de backend, nunca a chave pública.
        if (req.headers.get('authorization') !== 'Bearer ' + serviceKey) return resposta(403, { codigo: 'sem_permissao' });
        const rows = await rpc('reservar_conciliacao_mp', {});
        const resultados = await Promise.allSettled(rows.map((p) => consultar(p)));
        const falhas = resultados.filter((r) => r.status === 'rejected').length;
        return resposta(falhas ? 503 : 200, { processados: resultados.length - falhas, falhas });
      }
      if (body.acao === 'pagar_na_entrega') {
        if (!UUID.test(body.pedidoId || '')) return resposta(422, { codigo: 'dados_invalidos' });
        const jwt = req.headers.get('authorization');
        if (!jwt?.startsWith('Bearer ') || jwt === 'Bearer ' + serviceKey) return resposta(401, { codigo: 'sessao' });
        const user = await http(base + '/auth/v1/user', { headers: { apikey: serviceKey, Authorization: jwt } });
        if (!UUID.test(user.id || '')) return resposta(401, { codigo: 'sessao' });
        const args = { p_autor: user.id, p_id: body.pedidoId };
        let p = await rpc('autorizar_pagamento_entrega_mp', args);
        if (p.naEntrega) return resposta(200, { naEntrega: true });
        try {
          if (p.order_id) {
            p = await consultar(p);
            if (['pendente', 'recusado'].includes(p.estado)) {
              const cancelKey = (parseInt(p.id[0], 16) ^ 4).toString(16) + p.id.slice(1);
              try {
                await mp('/v1/orders/' + encodeURIComponent(p.order_id) + '/cancel', {}, cancelKey);
              } catch {
                /* consulta confirma o resultado; erro/timeout nunca libera a conversão */
              }
              p = await consultar(p);
            }
            if (p.estado !== 'cancelado') throw falhar(p.estado === 'aprovado' ? 'pagamento_encerrado' : 'pagamento_online_ativo', 422);
          }
          await rpc('autorizar_pagamento_entrega_mp', { ...args, p_finalizar: true });
          return resposta(200, { naEntrega: true });
        } finally {
          await rpc('liberar_reserva_pagamento_entrega_mp', args).catch(() => {});
        }
      }
      if (body.acao === 'estornar') {
        if (!UUID.test(body.pedidoId || '')) return resposta(422, { codigo: 'dados_invalidos' });
        const jwt = req.headers.get('authorization');
        if (!jwt?.startsWith('Bearer ') || jwt === 'Bearer ' + serviceKey) return resposta(401, { codigo: 'sessao' });
        const user = await http(base + '/auth/v1/user', { headers: { apikey: serviceKey, Authorization: jwt } });
        if (!UUID.test(user.id || '')) return resposta(401, { codigo: 'sessao' });
        const p = await rpc('autorizar_reembolso_mp', { p_autor: user.id, p_id: body.pedidoId });
        const antes = await consultar(p);
        if (antes.estado !== 'aprovado') return resposta(200, { estado: antes.estado });
        // Chave estável e namespace diferente da criação; reenvio não estorna duas vezes.
        const refundKey = (parseInt(p.id[0], 16) ^ 8).toString(16) + p.id.slice(1);
        await mp('/v1/orders/' + encodeURIComponent(p.order_id) + '/refund', {}, refundKey);
        const atual = await consultar(p);
        return resposta(200, { estado: atual.estado });
      }
      if (!['iniciar', 'consultar'].includes(body.acao) || !UUID.test(body.token || ''))
        return resposta(422, { codigo: 'dados_invalidos' });
      let p = await rpc('preparar_pagamento_mp', { p_token: body.token, p_email: body.email || null, p_iniciar: body.acao === 'iniciar' });
      if (p.criar) {
        const order = await mp('/v1/orders', criarOrder(p, siteUrl), p.id);
        p = await registrar(order, p);
      } else if (p.order_id && p.consultar) p = await consultar(p);
      return resposta(p.id && !p.order_id ? 202 : 200, publico(p));
    } catch (e) {
      const codigo =
        e.codigo ||
        (['pagamento_divergente', 'checkout_invalido', 'valor_invalido'].includes(e.message)
          ? 'pagamento_divergente'
          : 'pagamento_indisponivel');
      // Somente metadados internos: nunca registrar payload, e-mail, token, URL ou credenciais.
      try {
        registrarErro({ evento: 'pagamento_falhou', codigo, etapa: e.etapa || 'operacao', servico: e.servico, httpStatus: e.httpStatus });
      } catch {
        /* uma falha na observabilidade não muda a resposta financeira */
      }
      return resposta(e.status || (codigo === 'pagamento_divergente' ? 422 : 503), { codigo });
    }
  };
}
