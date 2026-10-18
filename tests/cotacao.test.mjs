import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarPostal,
  candidatoAwesome,
  candidatoGoogle,
  enderecoPostal,
  localizar,
  rotear,
  pontoValido,
  validarEntrada
} from '../supabase/functions/_shared/entrega.js';
import { criarHandler } from '../supabase/functions/cotar-entrega/handler.js';

const postal = { cep: '08615050', rua: 'Rua Professor Jeremia', bairro: 'Vila Urupês', cidade: 'Suzano', uf: 'SP' };
const ponto = { lat: -23.5437745, lon: -46.2954576 };
const awesome = {
  cep: postal.cep,
  address: postal.rua,
  city: postal.cidade,
  state: postal.uf,
  lat: String(ponto.lat),
  lng: String(ponto.lon)
};
const entrada = { cep: postal.cep, rua: postal.rua + ', 100', endereco: '', dispositivo: '00000000-0000-4000-8000-000000000001' };
entrada.endereco = enderecoPostal(entrada.rua, postal);
const json = (j) => new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } });
function google(tipo = 'ROOFTOP', numero = '100', cidade = 'Suzano') {
  const c = (long_name, types, short_name = long_name) => ({ long_name, types: [types], short_name });
  return {
    status: 'OK',
    results: [
      {
        geometry: { location: { lat: ponto.lat, lng: ponto.lon }, location_type: tipo },
        address_components: [
          c('Brasil', 'country', 'BR'),
          c('São Paulo', 'administrative_area_level_1', 'SP'),
          c(cidade, 'administrative_area_level_2'),
          c(postal.rua, 'route'),
          c(numero, 'street_number'),
          c(postal.cep, 'postal_code')
        ]
      }
    ]
  };
}
test('entrada rejeita coordenadas falsas, sem confirmação e endereço excessivo', () => {
  assert.throws(() => validarEntrada({ ...entrada, ponto: { lat: 0, lon: 0 }, confirmado: true }));
  assert.throws(() => validarEntrada({ ...entrada, ponto }));
  assert.throws(() => validarEntrada({ ...entrada, endereco: 'x'.repeat(201) }));
  assert.equal(pontoValido({ lat: '-23', lon: -46 }), false);
});
test('coordenadas de CEP são candidatos e exigem CEP, rua, cidade e UF coerentes', () => {
  assert.equal(candidatoAwesome(awesome, postal).confirmado, false);
  for (const patch of [
    { cep: '08615051' },
    { city: 'Poá' },
    { address: 'Rua Outra' },
    { state: 'RJ' },
    { lat: '0', lng: '0' },
    { lat: null }
  ])
    assert.equal(candidatoAwesome({ ...awesome, ...patch }, postal), null);
});
test('Google aceita só porta identificada no município e número pedidos', () => {
  assert.equal(candidatoGoogle(google(), postal, entrada.rua).fonte, 'google');
  assert.equal(candidatoGoogle(google('APPROXIMATE'), postal, entrada.rua), null);
  assert.equal(candidatoGoogle(google('RANGE_INTERPOLATED'), postal, entrada.rua), null);
  assert.equal(candidatoGoogle(google('ROOFTOP', '101'), postal, entrada.rua), null);
  assert.equal(candidatoGoogle(google('ROOFTOP', '100', 'Poá'), postal, entrada.rua), null);
});
test('grafias divergentes no mapa recorrem à base CEP sem cobrar ponto não confirmado', async () => {
  const r = await localizar(entrada, postal, {
    googleKey: 'teste',
    fetcher: async (u) => (String(u).includes('geocode') ? json({ status: 'ZERO_RESULTS' }) : json(awesome))
  });
  assert.equal(r.estado, 'confirmar');
  assert.equal(r.ponto.fonte, 'cep');
});
test('ponto explicitamente marcado perto do CEP pode seguir; ponto distante é recusado', async () => {
  const fetcher = async () => json(awesome);
  const r = await localizar({ ...entrada, ponto, confirmado: true }, postal, { fetcher });
  assert.equal(r.ponto.confirmado, true);
  await assert.rejects(localizar({ ...entrada, ponto: { lat: -22, lon: -46 }, confirmado: true }, postal, { fetcher }), {
    codigo: 'localizacao_invalida'
  });
});
test('rua editada para outra não usa coordenadas do CEP anterior', async () => {
  await assert.rejects(localizar({ ...entrada, rua: 'Rua Outra, 100' }, postal, { fetcher: async () => json(awesome) }), {
    codigo: 'endereco_divergente'
  });
});
test('falha do ViaCEP recupera dados pela segunda fonte', async () => {
  const p = await buscarPostal(postal.cep, {
    tentativas: 1,
    fetcher: async (u) => (String(u).includes('viacep') ? new Response('', { status: 503 }) : json({ ...awesome, district: postal.bairro }))
  });
  assert.deepEqual(p, postal);
});
test('CEP ausente em uma base é consultado na fonte alternativa antes de recusar', async () => {
  const p = await buscarPostal(postal.cep, {
    fetcher: async (u) => (String(u).includes('viacep') ? json({ erro: true }) : json({ ...awesome, district: postal.bairro }))
  });
  assert.deepEqual(p, postal);
});
test('CEP genérico só oferece ponto para confirmação; não aceita centro da cidade como porta', async () => {
  const r = await localizar(entrada, { ...postal, rua: '' }, { fetcher: async () => json(awesome) });
  assert.equal(r.estado, 'confirmar');
  assert.equal(r.ponto.confirmado, false);
});
test('rota Google falha e provedor independente recupera a distância', async () => {
  const orig = { lat: -23.54, lon: -46.31 };
  const r = await rotear(orig, ponto, {
    googleKey: 'g',
    orsKey: 'o',
    tentativas: 1,
    fetcher: async (u) =>
      String(u).includes('googleapis') ? new Response('', { status: 503 }) : json({ routes: [{ summary: { distance: 3200 } }] })
  });
  assert.deepEqual(r, { km: 3.2, fonte: 'ors' });
});
test('nenhum provedor: nunca inventa distância em linha reta nem taxa zero', async () => {
  await assert.rejects(rotear(ponto, ponto, {}), { codigo: 'mapas_nao_configurados' });
  await assert.rejects(
    rotear({ lat: -23.54, lon: -46.31 }, ponto, {
      googleKey: 'g',
      tentativas: 1,
      fetcher: async () => json({ routes: [{ distanceMeters: 1 }] })
    }),
    { codigo: 'rota_indisponivel' }
  );
});
test('handler não permite associar distância de uma rua ao texto de outra', async () => {
  const fetcher = async (u, op) => {
    const s = String(u);
    if (s.includes('loja?')) return json([{ entrega_origem: { lat: -23.54, lon: -46.31 } }]);
    if (s.includes('reservar_entrega')) return json(true);
    if (s.includes('entrega_cache?')) return json([]);
    if (s.includes('viacep'))
      return json({ cep: '08615-050', logradouro: postal.rua, bairro: postal.bairro, localidade: postal.cidade, uf: postal.uf });
    if (s.includes('entrega_travas') || s.includes('entrega_eventos')) return json([]);
    assert.fail('Chamada inesperada: ' + s + ' ' + op?.method);
  };
  const handler = criarHandler({ supabaseUrl: 'https://banco.invalid', serviceKey: 'teste', fetcher });
  const r = await handler(
    new Request('https://local.invalid', { method: 'POST', body: JSON.stringify({ ...entrada, endereco: 'Outra rua, 100' }) })
  );
  assert.equal(r.status, 422);
  assert.equal((await r.json()).codigo, 'endereco_divergente');
});
test('saúde revela somente presença das configurações e CORS recusa outra origem', async () => {
  const handler = criarHandler({ supabaseUrl: 'https://banco.invalid', serviceKey: 'secreto', googleKey: 'mais-secreto' });
  const r = await handler(new Request('https://local.invalid', { method: 'POST', body: '{"acao":"saude"}' }));
  assert.deepEqual(await r.json(), { rotasConfiguradas: true, googleConfigurado: true, alternativaConfigurada: false });
  const negado = await handler(
    new Request('https://local.invalid', { method: 'POST', headers: { Origin: 'https://outro.invalid' }, body: '{}' })
  );
  assert.equal(negado.status, 403);
});

test('reutilizar cache não renova indefinidamente a validade da localização e da rota', async () => {
  const inicio = Date.now(),
    origem = { lat: -23.54, lon: -46.31 };
  const localAte = new Date(inicio + 86400000).toISOString();
  const rotaAte = new Date(inicio + 60000).toISOString();
  let consultas = 0,
    salvo;
  const fetcher = async (url, op) => {
    const s = String(url);
    if (s.includes('loja?')) return json([{ entrega_origem: origem }]);
    if (s.includes('reservar_entrega')) return json(true);
    if (s.includes('entrega_cache?')) {
      return json(
        consultas++ === 0
          ? [
              {
                localizacao: { ponto: { ...ponto, fonte: 'google' } },
                local_valida_ate: localAte,
                distancia_km: 3.2,
                rota_valida_ate: rotaAte,
                origem,
                fonte_rota: 'google'
              }
            ]
          : [{ localizacao: { postal }, local_valida_ate: localAte }]
      );
    }
    if (s.includes('emitir_cotacao_entrega'))
      return json({ id: 'teste', expiraEm: new Date(inicio + 900000).toISOString(), estado: 'ok', taxa: 8, distanciaKm: 3.2 });
    if (s.endsWith('/entrega_cache')) {
      salvo = JSON.parse(op.body);
      return json([]);
    }
    if (s.includes('entrega_travas') || s.includes('entrega_eventos')) return json([]);
    assert.fail('Cache válido não deve consultar provedor: ' + s);
  };
  const handler = criarHandler({ supabaseUrl: 'https://banco.invalid', serviceKey: 'teste', fetcher, agora: () => inicio });
  const r = await handler(new Request('https://local.invalid', { method: 'POST', body: JSON.stringify(entrada) }));
  assert.equal(r.status, 200);
  assert.equal(salvo.local_valida_ate, localAte);
  assert.equal(salvo.rota_valida_ate, rotaAte);
});
