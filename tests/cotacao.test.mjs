import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarPostal,
  candidatoAwesome,
  candidatoGeoapify,
  referenciaGeoapify,
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
function geoapify(tipo = 'building', numero = '100', cidade = 'Suzano') {
  return {
    results: [
      {
        ...ponto,
        country_code: 'br',
        state_code: 'SP',
        city: cidade,
        street: postal.rua,
        housenumber: numero,
        postcode: postal.cep,
        result_type: tipo,
        rank: { confidence: 1, match_type: 'full_match' }
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
test('Geoapify só aceita endereço completo, número e confiança alta; full_match sozinho não basta', () => {
  assert.equal(candidatoGeoapify(geoapify(), postal, entrada.rua).fonte, 'geoapify');
  for (const patch of [
    { result_type: 'street' },
    { result_type: 'postcode' },
    { housenumber: '101' },
    { city: 'Poá' },
    { state_code: 'RJ' },
    { country_code: 'ar' },
    { street: 'Rua Outra' },
    { postcode: '08615051' },
    { rank: { confidence: 0.6, match_type: 'full_match' } },
    { rank: { confidence: 1, match_type: 'match_by_building' } },
    { lat: null }
  ])
    assert.equal(candidatoGeoapify({ results: [{ ...geoapify().results[0], ...patch }] }, postal, entrada.rua), null);
  assert.equal(candidatoGeoapify(geoapify(), { ...postal, rua: '' }, entrada.rua), null);
});
test('grafias divergentes no mapa recorrem à base CEP sem cobrar ponto não confirmado', async () => {
  const r = await localizar(entrada, postal, {
    geoapifyKey: 'teste',
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
test('rota Geoapify falha e provedor independente recupera a distância', async () => {
  const orig = { lat: -23.54, lon: -46.31 };
  const r = await rotear(orig, ponto, {
    geoapifyKey: 'g',
    orsKey: 'o',
    tentativas: 1,
    fetcher: async (u) =>
      String(u).includes('geoapify.com') ? new Response('', { status: 503 }) : json({ routes: [{ summary: { distance: 3200 } }] })
  });
  assert.deepEqual(r, { km: 3.2, fonte: 'ors' });
});
test('nenhum provedor: nunca inventa distância em linha reta nem taxa zero', async () => {
  await assert.rejects(rotear(ponto, ponto, {}), { codigo: 'mapas_nao_configurados' });
  await assert.rejects(
    rotear({ lat: -23.54, lon: -46.31 }, ponto, {
      geoapifyKey: 'g',
      tentativas: 1,
      fetcher: async () => json({ results: [{ distance: 1, distance_units: 'Meters' }] })
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
  const handler = criarHandler({ supabaseUrl: 'https://banco.invalid', serviceKey: 'secreto', geoapifyKey: 'mais-secreto' });
  const r = await handler(new Request('https://local.invalid', { method: 'POST', body: '{"acao":"saude"}' }));
  assert.deepEqual(await r.json(), { rotasConfiguradas: true, geoapifyConfigurado: true, alternativaConfigurada: false });
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
                localizacao: { ponto: { ...ponto, fonte: 'geoapify' } },
                local_valida_ate: localAte,
                distancia_km: 3.2,
                rota_valida_ate: rotaAte,
                origem,
                fonte_rota: 'geoapify'
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

test('rota Geoapify valida unidades, coordenadas lat/lon e não mistura milhas com metros', async () => {
  const origem = { lat: -23.54, lon: -46.31 };
  const fetcher = async (u) => {
    const url = new URL(u);
    assert.equal(url.origin, 'https://api.geoapify.com');
    assert.equal(url.searchParams.get('mode'), 'drive');
    assert.equal(url.searchParams.get('waypoints'), `${origem.lat},${origem.lon}|${ponto.lat},${ponto.lon}`);
    return json({ results: [{ distance: 3200, distance_units: 'Meters' }] });
  };
  assert.deepEqual(await rotear(origem, ponto, { geoapifyKey: 'privada', fetcher }), { km: 3.2, fonte: 'geoapify' });
  for (const patch of [{ distance_units: 'Miles' }, { distance: null }, { distance: '3200' }, { distance: -1 }]) {
    await assert.rejects(
      rotear(origem, ponto, {
        geoapifyKey: 'privada',
        fetcher: async () => json({ results: [{ distance: 3200, distance_units: 'Meters', ...patch }] })
      }),
      { codigo: 'rota_indisponivel' }
    );
  }
});
test('CEP genérico com ponto marcado confere município por Geoapify; outro município é recusado', async () => {
  const generico = { ...postal, rua: '' };
  for (const cidade of ['Suzano', 'Poá']) {
    const op = {
      geoapifyKey: 'privada',
      fetcher: async (u) =>
        String(u).includes('/reverse') ? json({ results: [{ country_code: 'br', state_code: 'BR-SP', city: cidade }] }) : json({})
    };
    const tentativa = localizar({ ...entrada, ponto, confirmado: true }, generico, op);
    if (cidade === 'Suzano') assert.deepEqual((await tentativa).ponto, { ...ponto, fonte: 'cliente', confirmado: true });
    else await assert.rejects(tentativa, { codigo: 'localizacao_invalida' });
  }
});

test('HTTP funciona sem AbortSignal.any no runtime Edge e preserva o cancelamento', async () => {
  const { jsonHTTP } = await import('../supabase/functions/_shared/entrega.js');
  const original = AbortSignal.any;
  AbortSignal.any = undefined;
  try {
    assert.deepEqual(
      await jsonHTTP('https://provedor.invalid', {
        signal: new AbortController().signal,
        fetcher: async () => json({ ok: true })
      }),
      { ok: true }
    );
    const ctl = new AbortController();
    const aguardando = jsonHTTP('https://provedor.invalid', {
      signal: ctl.signal,
      fetcher: async (u, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    });
    ctl.abort(new DOMException('Consulta cancelada', 'AbortError'));
    await assert.rejects(aguardando, { name: 'AbortError' });
    await assert.rejects(
      jsonHTTP('https://provedor.invalid', {
        prazo: 5,
        tentativas: 1,
        fetcher: async (u, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          })
      }),
      { name: 'TimeoutError' }
    );
  } finally {
    AbortSignal.any = original;
  }
});

test('Geoapify reconhece metros no retorno real e rejeita milhas', async () => {
  for (const units of ['meters', 'Meters']) {
    assert.deepEqual(
      await rotear({ lat: -23.54, lon: -46.31 }, ponto, {
        geoapifyKey: 'privada',
        fetcher: async () => json({ results: [{ distance: 3200, distance_units: units }] })
      }),
      { km: 3.2, fonte: 'geoapify' }
    );
  }
});
test('limite da base auxiliar recupera referência Geoapify com confirmação obrigatória', async () => {
  let geocodes = 0;
  const resposta = geoapify('street');
  resposta.results[0].rank.confidence = 0.6;
  const op = {
    geoapifyKey: 'privada',
    tentativas: 1,
    fetcher: async (u) => {
      if (String(u).includes('awesomeapi')) return new Response('{}', { status: 429 });
      geocodes++;
      return json(resposta);
    }
  };
  const local = await localizar(entrada, postal, op);
  assert.equal(local.estado, 'confirmar');
  assert.equal(local.ponto.fonte, 'geoapify');
  assert.equal(local.ponto.confirmado, false);
  assert.equal(geocodes, 1, 'reaproveita a consulta existente');
  const forcar = await localizar({ ...entrada, forcarConfirmacao: true }, postal, op);
  assert.equal(forcar.estado, 'confirmar');
  assert.equal(forcar.ponto.confirmado, false);
  for (const patch of [{ city: 'Poá' }, { result_type: 'city' }, { postcode: '08500000', street: 'Rua Outra' }])
    assert.equal(referenciaGeoapify({ results: [{ ...resposta.results[0], ...patch }] }, postal), null);
});

test('referência sem número nem CEP no mapa é procurada pela rua e município antes de pedir GPS', async () => {
  let geocodes = 0;
  const local = await localizar({ ...entrada, forcarConfirmacao: true }, postal, {
    geoapifyKey: 'privada',
    tentativas: 1,
    fetcher: async (u) => {
      const url = new URL(u);
      if (url.hostname.includes('awesomeapi')) return new Response('{}', { status: 429 });
      geocodes++;
      if (url.searchParams.get('type') !== 'street') return json({ results: [] });
      assert.equal(url.searchParams.get('text'), 'Rua Professor Jeremia, Suzano, SP, Brasil');
      const ref = geoapify('street');
      delete ref.results[0].postcode;
      return json(ref);
    }
  });
  assert.equal(geocodes, 2);
  assert.equal(local.estado, 'confirmar');
  assert.equal(local.ponto.confirmado, false);
});
