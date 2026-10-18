import { erro, buscarPostal, validarEntrada, localizar, rotear, distanciaReta, enderecoPostal } from '../_shared/entrega.js';

const ORIGENS = new Set([
  'https://mineirolanches.store',
  'https://www.mineirolanches.store',
  'https://mineiro-lanches.vercel.app',
  'http://localhost:4180',
  'http://localhost:5173'
]);
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function sha256(s) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, '0')).join('');
}

export function criarHandler({ supabaseUrl, serviceKey, anonKey, googleKey, orsKey, fetcher = fetch, agora = () => Date.now() }) {
  const base = supabaseUrl + '/rest/v1/';
  const headers = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  async function banco(path, body, method) {
    const r = await fetcher(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(7000)
    });
    const text = await r.text();
    let j;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      throw erro('servidor_indisponivel', 503);
    }
    if (!r.ok)
      throw erro(
        j?.message === 'muitas_cotacoes' ? 'muitas_cotacoes' : 'servidor_indisponivel',
        j?.message === 'muitas_cotacoes' ? 429 : 503
      );
    return j;
  }
  const rpc = (nome, p) => banco('rpc/' + nome, p);
  async function cache(chave) {
    return (await banco('entrega_cache?chave=eq.' + chave + '&limit=1'))[0] || null;
  }
  return async function handler(req) {
    const origem = req.headers.get('Origin');
    const cors = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods': 'POST,OPTIONS'
    };
    if (origem && !ORIGENS.has(origem)) return new Response('{}', { status: 403, headers: cors });
    if (origem) cors['Access-Control-Allow-Origin'] = origem;
    const responder = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return responder({ codigo: 'metodo_invalido' }, 405);
    if (anonKey && req.headers.get('apikey') !== anonKey) return responder({ codigo: 'sem_permissao' }, 401);
    let chave,
      dono,
      codigo = 'falha',
      fonte = '',
      p,
      config;
    const inicio = agora();
    const op = { fetcher, signal: AbortSignal.timeout(45000) };
    try {
      const raw = await req.text();
      if (raw.length > 4096) throw erro('dados_invalidos');
      try {
        p = JSON.parse(raw);
      } catch {
        throw erro('dados_invalidos');
      }
      if (p.acao === 'saude')
        return responder({ rotasConfiguradas: !!(googleKey || orsKey), googleConfigurado: !!googleKey, alternativaConfigurada: !!orsKey });
      if (!/^\d{8}$/.test(p.cep) || !uuid(p.dispositivo)) throw erro('dados_invalidos');
      if (p.acao !== 'cep') validarEntrada(p);
      config = (await banco('loja?id=eq.1&select=entrega_origem,taxa_km,taxa_fixa&limit=1'))[0];
      if (!config) throw erro('servidor_indisponivel', 503);
      const endereco = String(p.endereco || '').trim();
      chave = await sha256(
        p.acao === 'cep' ? 'cep:' + p.cep : ['endereco', p.dispositivo, p.cep, endereco.toLowerCase().replace(/\s+/g, ' ')].join('|')
      );
      dono = crypto.randomUUID();
      // O IP é pseudonimizado com um segredo; não entra nos registros de diagnóstico.
      const ip = (req.headers.get('x-forwarded-for') || 'desconhecido').split(',')[0].trim();
      const cliente = await sha256(serviceKey + '|' + ip);
      const reservado = await rpc('reservar_entrega', { p_chave: chave, p_cliente: cliente, p_dono: dono });
      if (!reservado) {
        dono = null;
        throw erro('consulta_em_andamento', 429);
      }
      const c = await cache(chave);
      if (p.acao === 'cep') {
        const postal = c && Date.parse(c.local_valida_ate) > agora() ? c.localizacao.postal : await buscarPostal(p.cep, op);
        if (!postal) throw erro('cep_indisponivel', 503);
        if (!c || Date.parse(c.local_valida_ate) <= agora())
          await banco('entrega_cache', {
            chave,
            localizacao: { postal },
            local_valida_ate: new Date(agora() + 86400000).toISOString(),
            origem: {}
          });
        codigo = 'cep_ok';
        return responder(postal);
      }
      const [pc] = await banco('entrega_cache?chave=eq.' + (await sha256('cep:' + p.cep)) + '&limit=1');
      const postal = pc && Date.parse(pc.local_valida_ate) > agora() ? pc.localizacao.postal : await buscarPostal(p.cep, op);
      if (endereco !== enderecoPostal(p.rua, postal)) throw erro('endereco_divergente');
      const mesmoPonto = p.ponto && c?.localizacao?.ponto && distanciaReta(p.ponto, c.localizacao.ponto) < 0.005;
      let ponto = c && Date.parse(c.local_valida_ate) > agora() && (!p.ponto || mesmoPonto) ? c.localizacao.ponto : null;
      const usouLocalCache = !!ponto;
      if (!ponto) {
        const local = await localizar(p, postal, { ...op, googleKey });
        if (!local.ponto || local.estado === 'confirmar') {
          codigo = 'confirmar_localizacao';
          return responder({ estado: 'confirmar', ponto: local.ponto || null });
        }
        ponto = local.ponto;
      }
      // Endereço devolvido ao cliente é exatamente o vinculado à cotação, sem dados de outros clientes.
      if (distanciaReta(config.entrega_origem, ponto) > 100) throw erro('fora_do_alcance');
      let rota;
      const usouRotaCache =
        usouLocalCache &&
        c &&
        (!p.ponto || mesmoPonto) &&
        Date.parse(c.rota_valida_ate) > agora() &&
        JSON.stringify(c.origem) === JSON.stringify(config.entrega_origem) &&
        c.distancia_km > 0;
      if (usouRotaCache) {
        rota = { km: Number(c.distancia_km), fonte: c.fonte_rota };
      } else rota = await rotear(config.entrega_origem, ponto, { ...op, googleKey, orsKey });
      fonte = rota.fonte;
      const q = await rpc('emitir_cotacao_entrega', {
        p_endereco: endereco,
        p_km: rota.km,
        p_origem: config.entrega_origem,
        p_fonte: fonte
      });
      await banco('entrega_cache', {
        chave,
        localizacao: { ponto },
        local_valida_ate: usouLocalCache
          ? c.local_valida_ate
          : new Date(agora() + (ponto.fonte === 'google' ? 27 : 30) * 86400000).toISOString(),
        distancia_km: rota.km,
        rota_valida_ate: usouRotaCache ? c.rota_valida_ate : q.expiraEm,
        origem: config.entrega_origem,
        fonte_rota: fonte,
        atualizado_em: new Date(agora()).toISOString()
      });
      codigo = 'cotacao_ok';
      return responder({ ...q, fonte: fonte === 'google' ? 'Google Maps' : 'OpenRouteService' });
    } catch (e) {
      codigo = e.codigo || 'servico_indisponivel';
      return responder({ codigo }, e.status || 503);
    } finally {
      if (dono && chave) {
        try {
          await banco('entrega_travas?chave=eq.' + chave + '&dono=eq.' + dono, undefined, 'DELETE');
        } catch {
          /* expira em 90 s */
        }
      }
      if (p?.acao !== 'saude') {
        try {
          await banco('entrega_eventos', { codigo, fonte, duracao_ms: Math.max(0, Math.round(agora() - inicio)) });
        } catch {
          /* diagnóstico não impede a compra */
        }
      }
    }
  };
}
