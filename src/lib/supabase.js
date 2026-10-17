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
