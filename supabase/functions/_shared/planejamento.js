import { erro, jsonHTTP, pontoValido, distanciaReta } from './entrega.js';

// O índice zero é a loja. Matriz orientada: mão única pode mudar o trajeto de volta.
export async function calcularMatriz(pontos, { geoapifyKey, ...op }) {
  if (!geoapifyKey) throw erro('mapas_nao_configurados', 503);
  if (!Array.isArray(pontos) || pontos.length < 2 || pontos.length > 13 || !pontos.every(pontoValido))
    throw erro('dados_invalidos');
  const u = new URL('https://api.geoapify.com/v1/routematrix');
  u.searchParams.set('apiKey', geoapifyKey);
  const locais = pontos.map((p) => ({ location: [p.lon, p.lat] }));
  const j = await jsonHTTP(u, { ...op, headers: { ...op.headers, 'Content-Type': 'application/json' },
    body: { mode: 'drive', traffic: 'approximated', sources: locais, targets: locais }, prazo: 12000 });
  const matriz = j?.sources_to_targets;
  if (!Array.isArray(matriz) || matriz.length !== pontos.length ||
      !matriz.every((linha) => Array.isArray(linha) && linha.length === pontos.length)) throw erro('rota_indisponivel', 503);
  return matriz.map((linha, i) => linha.map((v, k) => {
    if (i === k) return { segundos: 0, metros: 0 };
    if (!v || typeof v.time !== 'number' || typeof v.distance !== 'number' ||
        !Number.isFinite(v.time) || !Number.isFinite(v.distance) || v.time < 0 || v.distance < 0 || v.distance > 100000 ||
        v.distance / 1000 + 0.15 < distanciaReta(pontos[i], pontos[k]) ||
        (v.source_index != null && v.source_index !== i) || (v.target_index != null && v.target_index !== k)) return null;
    return { segundos: v.time, metros: v.distance };
  }));
}

export function regrasValidas(r) {
  return r && Number.isInteger(r.maxPedidos) && r.maxPedidos >= 1 && r.maxPedidos <= 6 &&
    ['esperaMin', 'trajetoMin', 'desvioMin', 'paradaMin'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k])) &&
    r.esperaMin >= 1 && r.esperaMin <= 120 && r.trajetoMin >= 1 && r.trajetoMin <= 180 &&
    r.desvioMin >= 0 && r.desvioMin <= 120 && r.paradaMin >= 0 && r.paradaMin <= 15;
}

export function avaliarSequencia(ordem, matriz, regras) {
  let anterior = 0, segundos = 0, metros = 0;
  const paradas = [];
  for (const indice of ordem) {
    const trecho = matriz[anterior]?.[indice], direto = matriz[0]?.[indice];
    if (!trecho || !direto) return null;
    segundos += trecho.segundos;
    metros += trecho.metros;
    if (segundos > regras.trajetoMin * 60 || segundos - direto.segundos > regras.desvioMin * 60) return null;
    paradas.push({ indice, chegadaSeg: Math.ceil(segundos), trechoSeg: Math.ceil(trecho.segundos), trechoMetros: Math.round(trecho.metros) });
    segundos += regras.paradaMin * 60;
    anterior = indice;
  }
  const volta = matriz[anterior]?.[0];
  if (!volta) return null;
  return { ordem, paradas, segundos: Math.ceil(segundos + volta.segundos), metros: Math.round(metros + volta.metros), ultimaEntregaSeg: paradas.at(-1)?.chegadaSeg || 0 };
}

// Inserção de menor acréscimo para grupos pequenos. Prioridade começa pelo pronto há mais tempo.
// Não prevê saída para motoboy fora da loja nem modifica uma viagem já em andamento.
export function planejarViagens({ pedidos, entregadores, regras, agora = Date.now(), ordemFixa = false }, matriz) {
  if (!regrasValidas(regras)) throw erro('configuracao_rotas_pendente');
  if (!Array.isArray(pedidos) || pedidos.length > 12 || !Array.isArray(entregadores)) throw erro('dados_invalidos');
  const indices = new Map(pedidos.map((p, i) => [p.id, i + 1]));
  const fila = [...pedidos].sort((a, b) => Date.parse(a.prontoEm) - Date.parse(b.prontoEm) || a.id.localeCompare(b.id));
  const disponiveis = [...entregadores].sort((a, b) =>
    Date.parse(a.disponivelDesde) - Date.parse(b.disponivelDesde) || a.qtdConcluidas - b.qtdConcluidas || a.id.localeCompare(b.id));
  const viagens = [], impedidos = [];
  while (fila.length && disponiveis.length) {
    const primeiro = fila.shift(), indice = indices.get(primeiro.id);
    let rota = avaliarSequencia([indice], matriz, regras);
    if (!rota) { impedidos.push({ id: primeiro.id, motivo: 'trajeto_fora_limite' }); continue; }
    const urgente = agora - Date.parse(primeiro.prontoEm) >= regras.esperaMin * 60000;
    if (ordemFixa) {
      const ordem = pedidos.map((p) => indices.get(p.id));
      rota = ordem.length <= regras.maxPedidos ? avaliarSequencia(ordem, matriz, regras) : null;
      if (!rota) return { viagens: [], impedidos: pedidos.map((p) => ({ id: p.id, motivo: 'sequencia_fora_limite' })) };
      fila.length = 0;
    } else if (!urgente) {
      while (rota.ordem.length < regras.maxPedidos && fila.length) {
        let melhor = null;
        for (const candidato of fila) for (let pos = 0; pos <= rota.ordem.length; pos++) {
          const ordem = [...rota.ordem]; ordem.splice(pos, 0, indices.get(candidato.id));
          const proposta = avaliarSequencia(ordem, matriz, regras);
          if (proposta && (!melhor || proposta.segundos < melhor.rota.segundos ||
              (proposta.segundos === melhor.rota.segundos &&
                proposta.paradas.find(p => p.indice === indice).chegadaSeg < melhor.rota.paradas.find(p => p.indice === indice).chegadaSeg)))
            melhor = { candidato, rota: proposta };
        }
        if (!melhor) break;
        fila.splice(fila.indexOf(melhor.candidato), 1);
        rota = melhor.rota;
      }
    }
    const entregador = disponiveis.shift();
    viagens.push({ motoboyId: entregador.id, urgente,
      paradas: rota.paradas.map((p) => ({ ...p, id: pedidos[p.indice - 1].id })),
      segundos: rota.segundos, metros: rota.metros, ultimaEntregaSeg: rota.ultimaEntregaSeg });
  }
  impedidos.push(...fila.map((p) => ({ id: p.id, motivo: 'sem_entregador_disponivel' })));
  return { viagens, impedidos };
}

export async function calcularCaminho(pontos, { geoapifyKey, ...op }) {
  if (!geoapifyKey || pontos.length < 2 || !pontos.every(pontoValido)) throw erro('mapas_nao_configurados', 503);
  const u = new URL('https://api.geoapify.com/v1/routing');
  u.search = new URLSearchParams({ apiKey: geoapifyKey, mode: 'drive', traffic: 'approximated', waypoints: pontos.map((p) => `${p.lat},${p.lon}`).join('|') });
  const j = await jsonHTTP(u, { ...op, prazo: 12000 });
  const g = j?.features?.[0]?.geometry;
  const linhas = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : null;
  if (!Array.isArray(linhas) || !linhas.length || linhas.length > 16 ||
      !linhas.every((l) => Array.isArray(l) && l.length >= 2 && l.length <= 20000 && l.every((c) =>
        Array.isArray(c) && c.length >= 2 && pontoValido({ lon: c[0], lat: c[1] })))) throw erro('rota_indisponivel', 503);
  return { type: 'MultiLineString', coordinates: linhas };
}
