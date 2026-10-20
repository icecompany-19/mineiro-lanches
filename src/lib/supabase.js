/* Mineiro Lanche · cliente do Supabase, criado sob demanda.
   O pacote (@supabase/supabase-js) só é baixado na primeira chamada: no cardápio isso acontece depois da
   primeira pintura (main-cliente.js), então a bio e o cardápio não esperam por ele.
   URL e chave vêm do .env (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY): a chave publishable é pública,
   quem protege os dados é o RLS do banco. */

const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL;
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY;
// onde o login do painel fica guardado (o supabase-js grava também chaves com este prefixo)
export const CHAVE_SESSAO = 'mineiro:v2:sessao';

let promessa = null;

export async function consultarPagamento(body, jwt) {
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),25000);
  try {
  const r=await fetch(URL_SUPABASE+'/functions/v1/mercado-pago',{
    method:'POST',headers:{apikey:CHAVE,Authorization:'Bearer '+(jwt||CHAVE),'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:ctl.signal
  });
  const j=await r.json();
  if(!r.ok)throw Object.assign(new Error(j.codigo||'pagamento_indisponivel'),{codigo:j.codigo||'pagamento_indisponivel'});
  return j;
  }finally{clearTimeout(timer);}
}

// O SDK instalado não encaminha AbortSignal no functions.invoke. Esta chamada usa fetch com prazo real.
// A sessão aqui só fornece o token; a Edge Function valida o usuário e a autorização no servidor.
export async function consultarPlanejamento(body, signal) {
  const sb = await obterSupabase({ sessao: true });
  const { data, error } = await sb.auth.getSession();
  if (error || !data?.session?.access_token) throw Object.assign(new Error('sessao'), { codigo: 'sessao' });
  const r = await fetch(URL_SUPABASE + '/functions/v1/planejar-entregas', {
    method: 'POST',
    headers: { apikey: CHAVE, Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || typeof j.estado !== 'string') throw Object.assign(new Error(j?.codigo || 'rede'), { codigo: j?.codigo || 'rede' });
  return j;
}

// Cotação pública com chave publishable/anon, sem expor credenciais do backend.
export async function consultarEntrega(body, signal) {
  const ctl = new AbortController(),
    abortar = () => ctl.abort();
  const timer = setTimeout(abortar, 60000);
  signal?.addEventListener('abort', abortar, { once: true });
  if (signal?.aborted) abortar();
  try {
    const r = await fetch(URL_SUPABASE + '/functions/v1/cotar-entrega', {
      method: 'POST',
      headers: { apikey: CHAVE, Authorization: 'Bearer ' + CHAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.codigo || 'rede'), { codigo: j.codigo || 'rede' });
    return j;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortar);
  }
}

// opc.sessao: true no painel e na tela do entregador (login guardado no aparelho e renovado sozinho); false no cliente (sem login).
// opc.chave: onde a sessão fica guardada (padrão CHAVE_SESSAO); o entregador usa a própria, que não pode começar por
// CHAVE_SESSAO (o Sair do painel apaga por prefixo).
// Vale a opção da primeira chamada: cada página tem um cliente só.
export function obterSupabase(opc) {
  const sessao = !!(opc && opc.sessao);
  if (!promessa) {
    promessa = import('@supabase/supabase-js')
      .then(({ createClient }) =>
        createClient(URL_SUPABASE, CHAVE, {
          auth: sessao
            ? { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: (opc && opc.chave) || CHAVE_SESSAO }
            : { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 5 } }
        })
      )
      .catch((e) => {
        // sem rede para baixar o pacote: a próxima chamada tenta de novo
        promessa = null;
        throw e;
      });
  }
  return promessa;
}
