// Smoke test da função publicada. Usa somente a chave pública; nunca cria pedidos.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const arquivoEnv = process.argv.includes('--local') ? '../.env.development' : '../.env.production';
const env = Object.fromEntries(
  readFileSync(new URL(arquivoEnv, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '')
      ];
    })
);
const url = env.VITE_SUPABASE_URL + '/functions/v1/cotar-entrega';
async function consultar(p) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(p),
    signal: AbortSignal.timeout(60000)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.codigo || 'HTTP ' + r.status);
  return j;
}
try {
  const saude = await consultar({ acao: 'saude' });
  console.log('Configuração de rotas:', JSON.stringify(saude));
  const cotar = process.argv.includes('--cotacoes');
  if (cotar && !saude.rotasConfiguradas)
    throw new Error('Configure GOOGLE_MAPS_API_KEY ou OPENROUTESERVICE_API_KEY nos secrets antes de testar rotas.');
  const dispositivo = randomUUID();
  for (const cep of ['08680120', '08615050', '08501500', '08676140']) {
    const postal = await consultar({ acao: 'cep', cep, dispositivo });
    console.log('CEP', cep, postal.rua ? 'resolvido' : 'genérico');
    if (!cotar) continue;
    const rua = postal.rua + ', 100';
    const endereco = [rua, postal.bairro, postal.cidade + '/' + postal.uf, 'CEP ' + cep.slice(0, 5) + '-' + cep.slice(5)]
      .filter(Boolean)
      .join(', ')
      .slice(0, 200);
    const p = { cep, rua, endereco, dispositivo, forcarConfirmacao: true };
    const candidato = await consultar(p);
    if (!candidato.ponto) throw new Error('Sem ponto de referência do CEP ' + cep);
    const q = await consultar({ ...p, forcarConfirmacao: false, ponto: candidato.ponto, confirmado: true });
    if (q.estado !== 'ok' || !q.id || !(q.taxa >= 0) || !(q.distanciaKm > 0)) throw new Error('Cotação inválida para ' + cep);
    console.log('Rota de referência', cep, JSON.stringify({ km: q.distanciaKm, taxa: q.taxa, fonte: q.fonte }));
  }
  if (!saude.rotasConfiguradas) {
    console.log('CEPs disponíveis. Ativação das entregas com cotação ainda depende da chave de rotas.');
    process.exitCode = 2;
  }
} catch (e) {
  console.error('Verificação de entrega:', e.message);
  process.exitCode = 1;
}
