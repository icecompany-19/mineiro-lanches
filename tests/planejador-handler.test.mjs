import test from 'node:test';
import assert from 'node:assert/strict';
import { criarPlanejador } from '../supabase/functions/planejar-entregas/handler.js';
const autor = '43000000-0000-4000-8000-000000000001',
  moto = '43000000-0000-4000-8000-000000000003';
const ids = ['43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000012'];
const contexto = () => ({
  id: '43000000-0000-4000-8000-000000000099',
  estado: 'calcular',
  origem: { lat: -23.54, lon: -46.31 },
  regras: { maxPedidos: 3, esperaMin: 10, trajetoMin: 30, desvioMin: 5, paradaMin: 1 },
  agora: '2026-10-19T00:00:00Z',
  pedidos: ids.map((id, i) => ({ id, ponto: { lat: -23.54 + i * 0.0002, lon: -46.309 }, prontoEm: '2026-10-18T23:58:00Z' })),
  entregadores: [{ id: moto, disponivelDesde: '2026-10-18T23:00:00Z', qtdConcluidas: 0 }],
  matriz: [
    [0, 120, 150],
    [120, 0, 30],
    [150, 30, 0]
  ].map((l) => l.map((s) => ({ segundos: s, metros: s * 6 })))
});
const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
function preparar({ permitido = true, autenticado = true, geometria = true, erroContexto = null } = {}) {
  const chamadas = [];
  const handler = criarPlanejador({
    supabaseUrl: 'https://db.invalid',
    serviceKey: 'privada-servidor',
    geoapifyKey: 'mapas-servidor',
    esperar: async () => {},
    fetcher: async (url, op = {}) => {
      const endereco = String(url),
        body = op.body ? JSON.parse(op.body) : null;
      chamadas.push({ url: endereco, op, body });
      if (endereco.endsWith('/auth/v1/user')) return json(autenticado ? { id: autor } : {}, autenticado ? 200 : 401);
      if (endereco.endsWith('/iniciar_planejamento_entregas'))
        return erroContexto ? json({ message: erroContexto }, 400) : permitido ? json(contexto()) : json({ message: 'sem_permissao' }, 403);
      if (endereco.endsWith('/concluir_planejamento_entregas'))
        return json({ estado: body.p_erro ? 'erro' : 'concluida', planos: body.p_planos.length });
      if (endereco.startsWith('https://api.geoapify.com/v1/routing'))
        return json(
          geometria
            ? {
                features: [
                  {
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [-46.31, -23.54],
                        [-46.309, -23.54]
                      ]
                    }
                  }
                ]
              }
            : {}
        );
      assert.fail('Chamada inesperada: ' + endereco);
    }
  });
  return {
    chamadas,
    enviar: (p, headers = { Authorization: 'Bearer usuario-real' }) =>
      handler(new Request('https://local.invalid', { method: 'POST', headers, body: JSON.stringify(p) })),
    handler
  };
}
test('somente equipe autenticada calcula; origem e papel são checados antes de consultar mapas', async () => {
  for (const op of [{ autenticado: false }, { permitido: false }]) {
    const { enviar, chamadas } = preparar(op),
      r = await enviar({ acao: 'calcular' });
    assert.equal(r.status, op.autenticado === false ? 401 : 403);
    assert(!chamadas.some((c) => c.url.includes('geoapify')));
  }
  const { enviar, chamadas } = preparar();
  assert.equal((await enviar({ acao: 'calcular' }, { Origin: 'https://externo.invalid' })).status, 403);
  assert.equal(chamadas.length, 0);
});
test('autor e localização vêm do servidor; resposta não expõe credenciais ou matriz', async () => {
  const { enviar, chamadas } = preparar();
  const r = await enviar({ acao: 'calcular', p_autor: moto, origem: { lat: 0, lon: 0 }, pedidos: ids });
  assert.equal(r.status, 200);
  const inicio = chamadas.find((c) => c.url.endsWith('/iniciar_planejamento_entregas'));
  assert.equal(inicio.body.p_autor, autor);
  assert.deepEqual(inicio.body.p_pedidos, ids);
  const fim = chamadas.find((c) => c.url.endsWith('/concluir_planejamento_entregas'));
  assert.equal(fim.body.p_planos.length, 1);
  assert.deepEqual(
    fim.body.p_planos[0].paradas.map((p) => p.id),
    ids
  );
  assert(
    chamadas.filter((c) => c.url.includes('geoapify')).every((c) => !c.url.includes('usuario-real') && !c.url.includes('privada-servidor'))
  );
  const texto = await r.text();
  assert(!/privada-servidor|mapas-servidor|matriz|pedidos/.test(texto));
});
test('geometria ausente encerra execução sem publicar ou reservar parte da viagem', async () => {
  const { enviar, chamadas } = preparar({ geometria: false }),
    r = await enviar({ acao: 'calcular' });
  assert.equal(r.status, 503);
  const fim = chamadas.find((c) => c.url.endsWith('/concluir_planejamento_entregas'));
  assert.deepEqual(fim.body.p_planos, []);
  assert.equal(fim.body.p_erro, 'rota_indisponivel');
});
test('orçamento e token do cron são validados no banco antes de usar o provedor', async () => {
  const { enviar, chamadas } = preparar({ erroContexto: 'orcamento_rotas_esgotado' });
  assert.equal((await enviar({ acao: 'calcular' })).status, 429);
  assert(!chamadas.some((c) => c.url.includes('geoapify')));
  const job = preparar({ permitido: false });
  assert.equal((await job.enviar({ acao: 'automatico', tokenJob: 'invalido' }, {})).status, 403);
  assert(!job.chamadas.some((c) => c.url.endsWith('/auth/v1/user') || c.url.includes('geoapify')));
});
test('seleção duplicada, pedido inválido e tentativa de automatizar pelo navegador são recusados', async () => {
  const { enviar, chamadas } = preparar();
  for (const p of [
    { acao: 'calcular', pedidos: [ids[0], ids[0]] },
    { acao: 'calcular', pedidos: ['pedido'] },
    { acao: 'calcular', ordemFixa: 'sim' }
  ])
    assert.equal((await enviar(p)).status, 422);
  assert.equal((await enviar({ acao: 'automatico' })).status, 403);
  assert.equal(chamadas.length, 0);
});

test('despacho individual devolve resultado do banco sem chave, matriz ou chamada de mapas', async () => {
  const chamadas = [];
  const resultado = { estado: 'concluida', tipoDespacho: 'individual', planos: 0, reservadas: 1, expiradas: 0 };
  const handler = criarPlanejador({
    supabaseUrl: 'https://db.invalid',
    serviceKey: 'privada-servidor',
    fetcher: async (url, op) => {
      chamadas.push(String(url));
      assert(String(url).endsWith('/iniciar_planejamento_entregas'));
      assert.equal(JSON.parse(op.body).p_token, 'token-job');
      return json(resultado);
    }
  });
  const r = await handler(new Request('https://local.invalid', {
    method: 'POST', body: JSON.stringify({ acao: 'automatico', tokenJob: 'token-job' })
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), resultado);
  assert.equal(chamadas.length, 1);
});
