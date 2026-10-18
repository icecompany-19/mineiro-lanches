// Regras puras e adaptadores HTTP. Nenhuma credencial, estado de navegador ou chamada ao banco.
export const normalizar = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const erro = (codigo, status = 422) => Object.assign(new Error(codigo), { codigo, status });
export function pontoValido(p) {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180 &&
    (p.lat !== 0 || p.lon !== 0)
  );
}
export function distanciaReta(a, b) {
  const r = Math.PI / 180,
    dlat = (b.lat - a.lat) * r,
    dlon = (b.lon - a.lon) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function validarEntrada(p) {
  if (
    !p ||
    typeof p !== 'object' ||
    !/^\d{8}$/.test(p.cep) ||
    typeof p.endereco !== 'string' ||
    p.endereco.trim().length < 5 ||
    p.endereco.length > 200 ||
    typeof p.rua !== 'string' ||
    p.rua.length > 110
  )
    throw erro('dados_invalidos');
  if (p.ponto != null && (!pontoValido(p.ponto) || p.confirmado !== true)) throw erro('localizacao_invalida');
}
export function ruaCompativel(rua, postal) {
  const r = normalizar(rua),
    s = normalizar(postal);
  // Número e complemento podem vir depois do nome postal; outra rua não herda suas coordenadas.
  return s.length >= 4 && (r === s || r.startsWith(s + ' '));
}
export function candidatoAwesome(j, postal) {
  const p = { lat: Number(j?.lat), lon: Number(j?.lng) };
  if (
    !j?.lat ||
    !j?.lng ||
    !pontoValido(p) ||
    j.cep !== postal.cep ||
    normalizar(j.city) !== normalizar(postal.cidade) ||
    j.state !== postal.uf ||
    (postal.rua && !ruaCompativel(j.address, postal.rua))
  )
    return null;
  return { ...p, fonte: 'cep', confirmado: false };
}
export function enderecoPostal(rua, postal) {
  const cep = postal.cep.slice(0, 5) + '-' + postal.cep.slice(5);
  return [rua.trim(), postal.bairro, postal.cidade + '/' + postal.uf, 'CEP ' + cep].filter(Boolean).join(', ').slice(0, 200);
}
export function candidatoGoogle(j, postal, rua) {
  if (j?.status !== 'OK' || !Array.isArray(j.results)) return null;
  for (const g of j.results) {
    const componentes = g.address_components || [];
    const obter = (tipo, curto = false) => {
      const c = componentes.find((c) => c.types?.includes(tipo));
      return c?.[curto ? 'short_name' : 'long_name'] || '';
    };
    const p = { lat: g.geometry?.location?.lat, lon: g.geometry?.location?.lng };
    const cidade = obter('administrative_area_level_2') || obter('locality');
    if (
      !pontoValido(p) ||
      g.partial_match ||
      obter('country', true) !== 'BR' ||
      obter('administrative_area_level_1', true) !== postal.uf ||
      normalizar(cidade) !== normalizar(postal.cidade) ||
      obter('postal_code').replace(/\D/g, '') !== postal.cep ||
      !ruaCompativel(obter('route'), postal.rua)
    )
      continue;
    // Só o número identificado com precisão segue automaticamente. Rua/CEP não é porta.
    const numero = normalizar(rua)
      .slice(normalizar(postal.rua).length)
      .trim()
      .match(/^\d+[a-z]?\b/)?.[0];
    if (g.geometry.location_type !== 'ROOFTOP' || !numero || normalizar(obter('street_number')) !== numero) continue;
    return { ...p, fonte: 'google', confirmado: false };
  }
  return null;
}
export async function jsonHTTP(url, { fetcher = fetch, signal, body, headers = {}, prazo = 8000, tentativas = 2 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    let status = 0,
      espera = 300;
    try {
      const limite = AbortSignal.timeout(prazo);
      const r = await fetcher(url, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, limite]) : limite
      });
      status = r.status;
      if (!r.ok) {
        const retry = r.headers.get('Retry-After');
        if (retry) espera = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
        throw erro('provedor_indisponivel', 503);
      }
      return await r.json();
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      if (i === tentativas - 1 || (status && status !== 429 && status < 500) || espera > 2000) throw e;
      await new Promise((resolve) => setTimeout(resolve, Math.max(300, espera)));
    }
  }
}
export async function buscarPostal(cep, op = {}) {
  let j,
    invalido = false;
  try {
    j = await jsonHTTP(`https://viacep.com.br/ws/${cep}/json/`, op);
    if (j?.erro) invalido = true;
    if (j?.localidade && j.uf && String(j.cep).replace(/\D/g, '') === cep)
      return { cep, rua: j.logradouro || '', bairro: j.bairro || '', cidade: j.localidade, uf: j.uf };
  } catch {
    /* consulta a fonte independente */
  }
  try {
    j = await jsonHTTP(`https://cep.awesomeapi.com.br/json/${cep}`, op);
    if (j?.cep === cep && j.city && j.state) return { cep, rua: j.address || '', bairro: j.district || '', cidade: j.city, uf: j.state };
  } catch {
    /* erro uniforme, sem revelar detalhes do fornecedor */
  }
  throw erro(invalido ? 'cep_invalido' : 'cep_indisponivel', invalido ? 422 : 503);
}
export async function localizar(p, postal, { googleKey, ...op }) {
  if (postal.rua && !ruaCompativel(p.rua, postal.rua)) throw erro('endereco_divergente');
  let candidato = null;
  // A segunda base é independente dos nomes das vias OSM; nunca aceita seu ponto sem confirmação.
  if (!p.ponto && !p.forcarConfirmacao && googleKey) {
    try {
      const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      u.search = new URLSearchParams({
        address: p.rua,
        components: `country:BR|administrative_area:SP|postal_code:${p.cep}`,
        key: googleKey,
        language: 'pt-BR'
      });
      candidato = candidatoGoogle(await jsonHTTP(u, op), postal, p.rua);
      if (candidato) return { ponto: candidato };
    } catch {
      /* tenta fonte independente */
    }
  }
  let centro;
  try {
    centro = candidatoAwesome(await jsonHTTP(`https://cep.awesomeapi.com.br/json/${p.cep}`, op), postal);
  } catch {
    /* sem candidato confiável */
  }
  if (p.ponto) {
    if (centro && postal.rua && distanciaReta(centro, p.ponto) > 3) throw erro('localizacao_invalida');
    if (!centro || !postal.rua) {
      // CEP de município/área: o ponto é escolhido pelo cliente, e a cidade é conferida no servidor.
      if (!googleKey) throw erro('localizacao_invalida');
      const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      u.search = new URLSearchParams({ latlng: p.ponto.lat + ',' + p.ponto.lon, key: googleKey, language: 'pt-BR' });
      const j = await jsonHTTP(u, op);
      const cidadeValida =
        j?.status === 'OK' &&
        j.results?.some((g) => {
          const c = (t) => g.address_components?.find((c) => c.types?.includes(t));
          return (
            c('country')?.short_name === 'BR' &&
            c('administrative_area_level_1')?.short_name === postal.uf &&
            normalizar(c('administrative_area_level_2')?.long_name || c('locality')?.long_name) === normalizar(postal.cidade)
          );
        });
      if (!cidadeValida) throw erro('localizacao_invalida');
    }
    return { ponto: { ...p.ponto, fonte: 'cliente', confirmado: true } };
  }
  return { estado: 'confirmar', ponto: centro };
}
export async function rotear(origem, destino, { googleKey, orsKey, ...op }) {
  const conferir = (metros) => {
    const km = Math.round(metros) / 1000;
    if (!Number.isFinite(km) || km <= 0 || km > 100 || km + 0.15 < distanciaReta(origem, destino)) throw erro('rota_invalida');
    return km;
  };
  if (googleKey) {
    try {
      const ll = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
      const j = await jsonHTTP('https://routes.googleapis.com/directions/v2:computeRoutes', {
        ...op,
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey, 'X-Goog-FieldMask': 'routes.distanceMeters' },
        body: {
          origin: ll(origem),
          destination: ll(destino),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          computeAlternativeRoutes: false
        }
      });
      return { km: conferir(j?.routes?.[0]?.distanceMeters), fonte: 'google' };
    } catch {
      /* outro provedor ou erro recuperável */
    }
  }
  if (orsKey) {
    try {
      const j = await jsonHTTP('https://api.openrouteservice.org/v2/directions/driving-car', {
        ...op,
        headers: { 'Content-Type': 'application/json', Authorization: orsKey },
        body: {
          coordinates: [
            [origem.lon, origem.lat],
            [destino.lon, destino.lat]
          ]
        }
      });
      return { km: conferir(j?.routes?.[0]?.summary?.distance), fonte: 'ors' };
    } catch {
      /* não usar distância em linha reta como rota */
    }
  }
  throw erro(googleKey || orsKey ? 'rota_indisponivel' : 'mapas_nao_configurados', 503);
}
