import test from 'node:test';
import assert from 'node:assert/strict';
import { planejarViagens, avaliarSequencia, calcularMatriz, calcularCaminho } from '../supabase/functions/_shared/planejamento.js';
const regras = { maxPedidos: 3, esperaMin: 10, trajetoMin: 30, desvioMin: 5, paradaMin: 1 };
const agora = Date.parse('2026-10-19T00:00:00Z');
const pedidos = ['a', 'b', 'c'].map((id, i) => ({ id, prontoEm: new Date(agora - (4 - i) * 60000).toISOString() }));
const entregadores = [
  { id: 'm1', disponivelDesde: '2026-10-18T23:00:00Z', qtdConcluidas: 2 },
  { id: 'm2', disponivelDesde: '2026-10-18T23:30:00Z', qtdConcluidas: 0 }
];
// A e B no mesmo corredor; C exige voltar ao lado oposto.
const segundos = [
  [0, 240, 300, 360],
  [250, 0, 60, 720],
  [310, 70, 0, 780],
  [360, 730, 790, 0]
];
const matriz = segundos.map((l) => l.map((s) => ({ segundos: s, metros: s * 6 })));
test('agrupa destinos compatíveis e separa direção oposta, respeitando espera e disponibilidade', () => {
  const r = planejarViagens({ pedidos, entregadores, regras, agora }, matriz);
  assert.deepEqual(
    r.viagens.map((v) => v.paradas.map((p) => p.id)),
    [['a', 'b'], ['c']]
  );
  assert.deepEqual(
    r.viagens.map((v) => v.motoboyId),
    ['m1', 'm2']
  );
  assert.deepEqual(r.impedidos, []);
  assert.equal(r.viagens[0].segundos, 730); // ida, parada em cada cliente e volta assimétrica
});
test('pedido que já esperou o limite sai em proposta individual', () => {
  const antigos = pedidos.map((p, i) => ({ ...p, prontoEm: new Date(agora - (i === 0 ? 20 : 2) * 60000).toISOString() }));
  const r = planejarViagens({ pedidos: antigos, entregadores, regras, agora }, matriz);
  assert.deepEqual(
    r.viagens[0].paradas.map((p) => p.id),
    ['a']
  );
  assert.equal(r.viagens[0].urgente, true);
});
test('limita a carga e conserva o pedido sem entregador em vez de atribuir a alguém ocupado', () => {
  const r = planejarViagens({ pedidos, entregadores: entregadores.slice(0, 1), regras: { ...regras, maxPedidos: 1 }, agora }, matriz);
  assert.equal(r.viagens[0].paradas.length, 1);
  assert.equal(r.impedidos.length, 2);
  assert(r.impedidos.every((p) => p.motivo === 'sem_entregador_disponivel'));
});
test('sem caminho ou fora do tempo configurado não inventa rota', () => {
  const m = structuredClone(matriz);
  m[0][1] = null;
  const r = planejarViagens({ pedidos, entregadores, regras, agora }, m);
  assert(r.impedidos.some((p) => p.id === 'a' && p.motivo === 'trajeto_fora_limite'));
  assert.equal(avaliarSequencia([3], matriz, { ...regras, trajetoMin: 2 }), null);
});
test('ordem ajustada pela equipe só vira proposta se o caminho respeitar os limites', () => {
  const r = planejarViagens({ pedidos, entregadores, regras, agora, ordemFixa: true }, matriz);
  assert.equal(r.viagens.length, 0);
  assert(r.impedidos.every((p) => p.motivo === 'sequencia_fora_limite'));
  assert.throws(
    () => planejarViagens({ pedidos, entregadores, regras: { ...regras, maxPedidos: null }, agora }, matriz),
    /configuracao_rotas_pendente/
  );
});
test('matriz usa ruas orientadas e trata par sem caminho como indisponível', async () => {
  const pontos = [
    { lat: -23.5, lon: -46.3 },
    { lat: -23.5005, lon: -46.3005 }
  ];
  const m = await calcularMatriz(pontos, {
    geoapifyKey: 'teste',
    tentativas: 1,
    fetcher: async (url, op) => {
      assert.equal(new URL(url).pathname, '/v1/routematrix');
      assert.equal(op.method, 'POST');
      assert.equal(op.headers['Content-Type'], 'application/json');
      assert.equal(JSON.parse(op.body).mode, 'drive');
      return new Response(
        JSON.stringify({
          sources_to_targets: [
            [
              { time: 0, distance: 0 },
              { time: 90, distance: 500 }
            ],
            [null, { time: 0, distance: 0 }]
          ]
        })
      );
    }
  });
  assert.equal(m[0][1].segundos, 90);
  assert.equal(m[1][0], null);
  await assert.rejects(
    () => calcularMatriz(pontos, { geoapifyKey: 'teste', tentativas: 1, fetcher: async () => new Response('{}') }),
    /rota_indisponivel/
  );
});
test('caminho do mapa exige geometria real e mantém a chave somente na chamada do servidor', async () => {
  const pontos = [
    { lat: -23.5, lon: -46.3 },
    { lat: -23.6, lon: -46.4 }
  ];
  const g = await calcularCaminho(pontos, {
    geoapifyKey: 'teste',
    tentativas: 1,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-46.3, -23.5],
                  [-46.4, -23.6]
                ]
              }
            }
          ]
        })
      )
  });
  assert.equal(g.type, 'MultiLineString');
  await assert.rejects(
    () => calcularCaminho(pontos, { geoapifyKey: 'teste', tentativas: 1, fetcher: async () => new Response('{}') }),
    /rota_indisponivel/
  );
});
