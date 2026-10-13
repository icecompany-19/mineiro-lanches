// Pipeline das fotos do cliente: liga cada foto ao produto, gera as variantes que o app usa e as texturas de parede.
//
// Uso:  node scripts/fotos.mjs [pasta]               (padrão: fotos-originais/)
//         --saida <pasta>      variantes WebP           (padrão: public/assets/fotos)
//         --json <arquivo>     fotos.json a atualizar   (padrão: public/assets/fotos.json)
//         --mapa <arquivo>     mapa manual              (padrão: <pasta>/mapa.json)
//         --texturas <pasta>   texturas de parede       (padrão: public/assets/texturas)
//         --core <arquivo>     core.js com o CONFIG     (padrão: src/core.js)
//         --simular            só mostra o relatório, sem gravar nada
//       node scripts/fotos.mjs --svg-tijolo [arquivo]   refaz o tijolinho desenhado em código
//                                                       (padrão: public/assets/texturas/tijolo.svg)
//
// Como cada arquivo é ligado ao produto (nessa ordem):
//   1. mapa.json, "arquivos": nome do arquivo (com ou sem extensão) → produto; null ignora o arquivo.
//   2. Nome do arquivo igual ao id de um produto do CONFIG (ex.: dog-max.jpeg).
//   3. Horário do nome do WhatsApp ("WhatsApp Image 2026-10-09 at 18.58.12 (1).jpeg") na tabela ENVIOS abaixo,
//      copiada de docs/CLIENTE-2026-10.md, com tolerância de ±2 min. O minuto exato ganha; fora dele vale o envio
//      mais próximo, e empate entre dois envios diferentes fica sem produto (ambíguo, resolve no mapa.json).
// Várias fotos do mesmo produto (álbum, segunda foto, foto antiga): vale a principal nova; depois a alternativa nova;
// depois a antiga. A reserva (Combo Casal fora do cenário) só entra se não houver outra, nem a provisória que já está
// no fotos.json. As que sobram aparecem no relatório como alternativas.
//
// Variantes, no padrão que src/app.js já usa: <slug>-q.webp 360×360 (o maior quadrado com o ponto focal no centro,
// sem sair da foto),
// <slug>-540.webp e <slug>-1080.webp com largura min(540|1080, original) e altura proporcional, nunca ampliadas.
// WebP q80. A orientação EXIF é aplicada e TODO o metadado sai (EXIF com GPS, XMP, IPTC, ICC). A cor é levada a
// sRGB pelo perfil da própria foto, sem ajuste de cor, brilho ou nitidez: só recorte e redimensionamento.
//
// fotos.json (lido pelo plugin virtual:fotos do vite.config.js e por src/app.js):
//   { slug: { w, h, cor, foco, origem, arquivo } }
// w e h são do original já girado (o app monta o srcset com eles), cor é a média da foto (fundo enquanto carrega),
// foco é o ponto focal ("x% y%" da foto: o centro do lanche), origem é 'nova' (cenário de tijolinho) ou 'antiga' e arquivo é o
// original. As fotos que não estão na pasta ficam como estão (sem origem ganham 'antiga').
// Foco: o do mapa.json; senão o que já está no fotos.json, se a foto é a mesma (mesmo nome de arquivo); senão
// foco_padrao.
//
// Texturas: mapa.json, "paredes": [{ arquivo, x, y, w, h, nome? }] recorta um trecho de parede de cada foto (pixels do
// original já girado) e grava <texturas>/<nome ou tijolo-N>.webp, sem retoque.
//
// Recortes: mapa.json, "recortes": { slug: { x, y, w, h } } tira da foto do produto o que não deve aparecer (um papel com anotação no
// canto, por exemplo), em pixels do original já girado. As três variantes saem do trecho (w e h do fotos.json são os do trecho) e o foco
// do mapa vale para o trecho. Só recorte: nada é pintado, ampliado nem retocado.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { carregarCore } from './gerar-seed.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PADRAO = {
  pasta: join(RAIZ, 'fotos-originais'),
  saida: join(RAIZ, 'public', 'assets', 'fotos'),
  json: join(RAIZ, 'public', 'assets', 'fotos.json'),
  texturas: join(RAIZ, 'public', 'assets', 'texturas'),
  core: join(RAIZ, 'src', 'core.js')
};
export const TOLERANCIA_MIN = 2;
export const LADO_Q = 360;
export const LARGURAS = [540, 1080];
export const QUALIDADE = 80;
export const LARGURA_BOA = 1080; // abaixo disso a -1080 sai menor que 1080 px e a ficha borra em tela densa
export const LARGURA_TEXTURA = 1600; // trecho de parede mais largo que isso é reduzido
const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const SEM_FOTO_ESPERADA = new Set(['bebidas']); // categorias que não entram em "produtos sem foto"

// Envios do dono pelo WhatsApp (docs/CLIENTE-2026-10.md, "Fotos novas"). Horário local do nome do arquivo.
// papel: 'principal' (padrão), 'alternativa' (segunda foto do mesmo produto) ou 'reserva' (só se não houver outra).
// produto null: envio sem legenda, identificar pela imagem e declarar no mapa.json.
// de/ate: faixa de horário; origem 'antiga' são as fotos de antes do cenário de tijolinho.
export const ENVIOS = [
  { quando: '2026-10-09 18:58', produto: 'gran-bacon', legenda: 'Gran Bacon' },
  { quando: '2026-10-09 19:43', produto: 'dog-max', legenda: 'Dog Max' },
  { quando: '2026-10-09 20:02', produto: 'exagerado-x-salada-egg-bacon', legenda: 'Exagerado X Egg Bacon' },
  { quando: '2026-10-09 20:27', produto: 'gran-bacon-onion', legenda: 'Gran Bacon Onion' },
  { quando: '2026-10-09 20:28', produto: 'combo-gran-bacon-onion', legenda: 'Combo Gran Bacon Onion' },
  { quando: '2026-10-09 20:36', produto: 'porcao-batata', legenda: 'Porção de batata turbinada (álbum, 3 fotos)', album: 3 },
  { quando: '2026-10-09 21:03', produto: 'dog-cbo-turbo', legenda: 'Hot Dog CBO Turbo' },
  { quando: '2026-10-09 21:04', produto: 'x-salada', legenda: 'X-Salada Tradicional' },
  { quando: '2026-10-09 21:05', produto: 'gran-salada', legenda: 'Gran Salada' },
  { quando: '2026-10-09 21:06', produto: 'ultra-x-salada-bacon', legenda: 'Ultra X Salada Bacon' },
  { quando: '2026-10-09 21:08', produto: 'combo-gran-bacon-onion', legenda: 'Combo Gran Onion Bacon (2ª foto)', papel: 'alternativa' },
  { quando: '2026-10-09 21:15', produto: 'combo-casal', legenda: 'Combo Casal (fora do cenário)', papel: 'reserva' },
  { quando: '2026-10-09 23:26', produto: 'x-churrasco', legenda: 'X Churrasco' },
  { quando: '2026-10-09 23:46', produto: 'big-mineiro', legenda: 'Big Mineiro' },
  { quando: '2026-10-10 18:03', produto: null, legenda: 'sem legenda: identificar pela imagem' },
  { quando: '2026-10-12 00:15', produto: null, legenda: 'sem legenda: identificar pela imagem' },
  { quando: '2026-10-12 00:18', produto: 'gran-crispy', legenda: 'Gran Crispy' },
  {
    de: '2026-10-08 10:44', ate: '2026-10-08 10:51', produto: null, origem: 'antiga',
    legenda: 'antigas (Hot Dog Super Pizza, Gran Salada, Gran Egg, Gran Bacon): identificar pela imagem; só valem para dog-pizza e gran-egg'
  }
];

// ================= nomes do WhatsApp e tabela de envios =================
// "WhatsApp Image 2026-10-09 at 18.58.12.jpeg", "... at 18.58.12 (1).jpeg", "... at 6.58.12 PM.jpeg"
const RE_WHATSAPP = /WhatsApp Image (\d{4})-(\d{2})-(\d{2}) at (\d{1,2})[.:](\d{2})[.:](\d{2})(?:\s*([AaPp])\.?\s?[Mm]\.?)?(?:\s*\((\d+)\))?/;
const doisDig = (n) => String(n).padStart(2, '0');

export function lerNomeWhatsApp(nome) {
  const m = RE_WHATSAPP.exec(nome);
  if (!m) return null;
  let h = Number(m[4]);
  if (m[7]) {
    const pm = m[7].toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5]), Number(m[6]));
  return { ms, minuto: Math.floor(ms / 60000), seq: m[8] ? Number(m[8]) : 0, texto: `${m[3]}/${m[2]} ${doisDig(h)}:${m[5]}:${m[6]}` };
}

// '2026-10-09 18:58' → minutos desde 1970 (mesma base de lerNomeWhatsApp)
function minutoDe(quando) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(quando || '');
  if (!m) throw new Error(`horário inválido na tabela de envios: "${quando}" (use AAAA-MM-DD HH:MM)`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000;
}

function textoEnvio(e) {
  const hm = (q) => q.slice(11);
  const dia = (e.quando || e.de).slice(8, 10) + '/' + (e.quando || e.de).slice(5, 7);
  return `${dia} ${e.quando ? hm(e.quando) : hm(e.de) + '–' + hm(e.ate)} «${e.legenda || e.produto}»`;
}

// Acha o envio de um arquivo pelo horário. Devolve { envio, distancia } ou { motivo } quando não liga.
export function envioDoHorario(info, envios = ENVIOS, tolerancia = TOLERANCIA_MIN) {
  const perto = envios
    .map((e) => {
      const de = minutoDe(e.de || e.quando);
      const ate = minutoDe(e.ate || e.quando);
      const distancia = info.minuto < de ? de - info.minuto : info.minuto > ate ? info.minuto - ate : 0;
      return { envio: e, distancia };
    })
    .filter((c) => c.distancia <= tolerancia)
    .sort((a, b) => a.distancia - b.distancia);
  if (!perto.length) return { motivo: `${info.texto}: fora da tabela de envios (±${tolerancia} min)` };
  const empatados = perto.filter((c) => c.distancia === perto[0].distancia);
  const chave = (e) => `${e.produto}|${e.papel || 'principal'}|${e.origem || 'nova'}`;
  if (new Set(empatados.map((c) => chave(c.envio))).size > 1) {
    return { motivo: `${info.texto}: ambíguo entre ${empatados.map((c) => textoEnvio(c.envio)).join(' e ')}` };
  }
  return perto[0];
}

// ================= mapa.json =================
export function lerMapa(arquivo) {
  const vazio = { arquivos: {}, compartilhadas: {}, foco: {}, focoPadrao: '50% 50%', paredes: [], recortes: {}, slugs: {}, envios: [] };
  if (!arquivo || !existsSync(arquivo)) return { ...vazio, ausente: true };
  let m;
  try {
    m = JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    throw new Error(`mapa.json inválido (${arquivo}): ${e.message}`);
  }
  const semComentarios = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));
  return {
    arquivos: semComentarios(m.arquivos),
    compartilhadas: semComentarios(m.compartilhadas),
    foco: semComentarios(m.foco),
    focoPadrao: m.foco_padrao || '50% 50%',
    paredes: Array.isArray(m.paredes) ? m.paredes : [],
    recortes: semComentarios(m.recortes),
    slugs: semComentarios(m.slugs),
    envios: Array.isArray(m.envios) ? m.envios : []
  };
}

// Ponto focal: "50% 40%", "50 40" ou { x, y } → "50% 40%" (x e y em % da largura e da altura da foto).
// "auto" deixa o sharp achar a região de interesse.
export function normalizarFoco(foco) {
  if (foco === 'auto') return 'auto';
  let x, y;
  if (foco && typeof foco === 'object') ({ x, y } = foco);
  else {
    const m = /^\s*(-?[\d.]+)%?\s+(-?[\d.]+)%?\s*$/.exec(String(foco || ''));
    if (m) [x, y] = [Number(m[1]), Number(m[2])];
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    throw new Error(`foco inválido: ${JSON.stringify(foco)} (use "50% 40%", de 0 a 100)`);
  }
  return `${Math.round(x)}% ${Math.round(y)}%`;
}

function entradaManual(mapa, nome) {
  const semExt = basename(nome, extname(nome));
  for (const k of [nome, semExt]) if (Object.prototype.hasOwnProperty.call(mapa.arquivos, k)) return { valor: mapa.arquivos[k] };
  return null;
}

// ================= CONFIG =================
function produtosDoConfig(core) {
  const { CONFIG } = carregarCore(core);
  const lista = [];
  CONFIG.categorias.forEach((c) => c.itens.forEach((p) => lista.push({ id: p.id, nome: p.nome, foto: p.foto || null, cat: c.id })));
  return lista;
}

// ================= ligação arquivo → produto =================
// Devolve { candidatos, semProduto }. Cada candidato: { nome, caminho, produto, origem, papel, via, detalhe, wa, foco }.
export function ligarArquivos(nomes, { mapa, produtos, envios = ENVIOS, tolerancia = TOLERANCIA_MIN }) {
  const ids = new Set((produtos || []).map((p) => p.id));
  const tabela = envios.concat(mapa.envios || []);
  const candidatos = [];
  const semProduto = [];
  for (const nome of nomes) {
    const wa = lerNomeWhatsApp(nome);
    const achado = wa ? envioDoHorario(wa, tabela, tolerancia) : null;
    const envio = achado && achado.envio;
    const manual = entradaManual(mapa, nome);
    const semExt = basename(nome, extname(nome));
    if (manual) {
      const v = manual.valor;
      if (v === null || v === false) {
        semProduto.push({ nome, motivo: 'ignorado no mapa.json' });
        continue;
      }
      const o = typeof v === 'string' ? { produto: v } : v;
      if (!o || !o.produto) {
        semProduto.push({ nome, motivo: 'entrada do mapa.json sem "produto"' });
        continue;
      }
      candidatos.push({
        nome, produto: o.produto, via: 'mapa', wa,
        origem: o.origem || (envio && envio.origem) || 'nova',
        papel: o.papel || 'principal',
        foco: o.foco,
        detalhe: 'mapa.json' + (wa ? ` (${wa.texto})` : '')
      });
    } else if (ids.has(semExt)) {
      candidatos.push({ nome, produto: semExt, via: 'nome', wa, origem: 'nova', papel: 'principal', detalhe: 'nome do arquivo' });
    } else if (!wa) {
      semProduto.push({ nome, motivo: 'nome sem data e hora do WhatsApp e fora do mapa.json' });
    } else if (!envio) {
      semProduto.push({ nome, motivo: achado.motivo });
    } else if (!envio.produto) {
      semProduto.push({ nome, motivo: `${wa.texto}: ${textoEnvio(envio)}`, origem: envio.origem || 'nova' });
    } else {
      candidatos.push({
        nome, produto: envio.produto, via: 'horario', wa, envio,
        origem: envio.origem || 'nova',
        papel: envio.papel || 'principal',
        detalhe: `${wa.texto} → ${textoEnvio(envio)}` + (achado.distancia ? ` (±${achado.distancia} min)` : '')
      });
    }
  }
  return { candidatos, semProduto };
}

// ordem de preferência entre fotos do mesmo slug (menor ganha)
function chaveOrdem(c) {
  return [
    c.papel === 'reserva' ? 1 : 0,
    c.origem === 'nova' ? 0 : 1,
    c.papel === 'alternativa' ? 1 : 0,
    c.via === 'mapa' ? 0 : 1,
    c.wa ? c.wa.ms : 0,
    c.wa ? c.wa.seq : 0
  ];
}
function compararCandidatos(a, b) {
  const ka = chaveOrdem(a);
  const kb = chaveOrdem(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return a.nome.localeCompare(b.nome);
}

// ================= imagem =================
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => doisDig(Math.round(v).toString(16))).join('');

// Abre a foto já girada pela orientação EXIF, em sRGB e sem metadado nenhum (PNG sem perda, só na memória).
async function abrirGirada(caminho) {
  const { data, info } = await sharp(caminho, { failOn: 'none' })
    .rotate()
    .png({ compressionLevel: 0 })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

async function focoAutomatico(buf, w, h) {
  const lado = Math.min(w, h);
  const { info } = await sharp(buf)
    .resize(LADO_Q, LADO_Q, { fit: 'cover', position: sharp.strategy.attention })
    .toBuffer({ resolveWithObject: true });
  // deslocamento do recorte escolhido (na escala reduzida) → centro do recorte na foto original
  const escala = lado / LADO_Q;
  const cx = Math.abs(info.cropOffsetLeft || 0) * escala + lado / 2;
  const cy = Math.abs(info.cropOffsetTop || 0) * escala + lado / 2;
  return normalizarFoco({ x: Math.min(100, (cx / w) * 100), y: Math.min(100, (cy / h) * 100) });
}

// recorte quadrado do -q: o maior quadrado com o ponto focal no centro, empurrado para dentro da foto
export function recorteQ(w, h, foco) {
  const [fx, fy] = foco.split(' ').map((v) => parseFloat(v));
  const lado = Math.min(w, h);
  const ajustar = (centro, total) => Math.min(total - lado, Math.max(0, Math.round((total * centro) / 100 - lado / 2)));
  return { left: ajustar(fx, w), top: ajustar(fy, h), width: lado, height: lado };
}

// tamanhos das variantes -540 e -1080, com a mesma conta de arquivos() em src/app.js
export function tamanhosVariantes(w, h) {
  return LARGURAS.map((L) => {
    const nw = Math.min(L, w);
    return { tam: String(L), w: nw, h: Math.round((h * nw) / w) };
  });
}

// Gera <slug>-q, -540 e -1080 e devolve a entrada do fotos.json.
// recorte: { x, y, w, h } em pixels do original já girado (inteiros, dentro da foto); devolve o objeto validado
export function validarRecorte(recorte, w, h) {
  const r = ['x', 'y', 'w', 'h'].map((k) => Number(recorte && recorte[k]));
  if (r.some((v) => !Number.isInteger(v) || v < 0) || r[2] < 1 || r[3] < 1 || r[0] + r[2] > w || r[1] + r[3] > h) {
    throw new Error(`recorte ${JSON.stringify(recorte)} fora da foto (${w}×${h})`);
  }
  return { x: r[0], y: r[1], w: r[2], h: r[3] };
}

async function gerarVariantes(caminho, slug, focoPedido, origem, saida, simular, recorte = null) {
  const arquivo = (relative(RAIZ, caminho).startsWith('..') ? basename(caminho) : relative(RAIZ, caminho)).split(sep).join('/'); // barra normal também no Windows
  let { buf, w, h } = await abrirGirada(caminho);
  if (recorte) {
    const r = validarRecorte(recorte, w, h);
    buf = await sharp(buf).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).png({ compressionLevel: 0 }).toBuffer();
    w = r.w;
    h = r.h;
  }
  const foco = focoPedido === 'auto' ? await focoAutomatico(buf, w, h) : focoPedido;
  const q = recorteQ(w, h, foco);
  const { channels } = await sharp(buf).stats();
  const arquivos = [];
  const tarefas = [
    { arq: `${slug}-q.webp`, img: () => sharp(buf).extract(q).resize(LADO_Q, LADO_Q) },
    ...tamanhosVariantes(w, h).map((t) => ({ arq: `${slug}-${t.tam}.webp`, img: () => sharp(buf).resize(t.w, t.h, { fit: 'cover' }) }))
  ];
  if (!simular) mkdirSync(saida, { recursive: true });
  for (const t of tarefas) {
    const destino = join(saida, t.arq);
    if (!simular) await t.img().webp({ quality: QUALIDADE }).toFile(destino);
    arquivos.push(destino);
  }
  const media = channels.map((c) => c.mean);
  const [r, g, b] = media.length >= 3 ? media : [media[0], media[0], media[0]]; // tons de cinza: um canal (e alfa)
  const cor = hex({ r, g, b });
  return { entrada: { w, h, cor, foco, origem, arquivo }, arquivos };
}

async function gerarTextura(caminho, p, destino, simular) {
  const { buf, w, h } = await abrirGirada(caminho);
  const r = ['x', 'y', 'w', 'h'].map((k) => Number(p[k]));
  if (r.some((v) => !Number.isInteger(v) || v < 0) || r[2] < 1 || r[3] < 1 || r[0] + r[2] > w || r[1] + r[3] > h) {
    throw new Error(`região ${JSON.stringify({ x: p.x, y: p.y, w: p.w, h: p.h })} fora da foto (${w}×${h})`);
  }
  let img = sharp(buf).extract({ left: r[0], top: r[1], width: r[2], height: r[3] });
  let tw = r[2];
  let th = r[3];
  if (tw > LARGURA_TEXTURA) {
    th = Math.round((th * LARGURA_TEXTURA) / tw);
    tw = LARGURA_TEXTURA;
    img = img.resize(tw, th, { fit: 'cover' });
  }
  if (!simular) {
    mkdirSync(dirname(destino), { recursive: true });
    await img.webp({ quality: QUALIDADE }).toFile(destino);
  }
  return { w: tw, h: th };
}

// ================= fotos.json =================
export function lerFotosJson(arquivo) {
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) : {};
}

// Junta as entradas novas mantendo a ordem das chaves (slug novo entra no fim). Sem origem vira 'antiga'.
export function juntarFotosJson(atual, novas) {
  const saida = {};
  for (const k of Object.keys(atual)) {
    if (novas[k]) saida[k] = novas[k];
    else saida[k] = atual[k].origem ? atual[k] : { ...atual[k], origem: 'antiga' };
  }
  for (const k of Object.keys(novas)) if (!saida[k]) saida[k] = novas[k];
  return saida;
}

// ================= pipeline =================
export async function processar(opcoes = {}) {
  const op = { ...PADRAO, ...opcoes };
  op.pasta = resolve(op.pasta);
  op.mapa = op.mapa ? resolve(op.mapa) : join(op.pasta, 'mapa.json');
  const rel = {
    pasta: op.pasta, saida: resolve(op.saida), json: resolve(op.json), texturasPasta: resolve(op.texturas), simular: Boolean(op.simular),
    vazia: false, ligadas: [], naoUsadas: [], semProduto: [], produtosSemFoto: [], comFotoAntiga: [], baixa: [],
    config: [], texturas: [], erros: [], avisos: [], gravados: []
  };
  if (!existsSync(op.pasta) || !statSync(op.pasta).isDirectory()) {
    rel.erros.push(`pasta não encontrada: ${op.pasta}`);
    return rel;
  }
  let mapa;
  try {
    mapa = lerMapa(op.mapa);
  } catch (e) {
    rel.erros.push(e.message);
    return rel;
  }
  if (mapa.ausente) rel.avisos.push(`sem mapa.json em ${op.mapa}: só nome e horário ligam as fotos`);

  let produtos = null;
  try {
    produtos = produtosDoConfig(op.core);
  } catch (e) {
    rel.avisos.push(`não deu para ler o CONFIG (${e.message}): sem conferência de produtos`);
  }
  const porId = new Map((produtos || []).map((p) => [p.id, p]));

  const nomes = readdirSync(op.pasta)
    .filter((n) => EXTENSOES.has(extname(n).toLowerCase()) && statSync(join(op.pasta, n)).isFile())
    .sort((a, b) => a.localeCompare(b));
  if (!nomes.length) {
    rel.vazia = true;
    return rel;
  }

  const { candidatos, semProduto } = ligarArquivos(nomes, { mapa, produtos });
  rel.semProduto = semProduto;

  // slug do arquivo de foto: mapa.json "slugs"; quem está em "compartilhadas" e recebe foto própria usa o próprio id;
  // senão o campo foto do CONFIG ou o id do produto
  const slugDe = (id) => {
    if (mapa.slugs[id]) return mapa.slugs[id];
    if (mapa.compartilhadas[id]) return id;
    return (porId.get(id) && porId.get(id).foto) || id;
  };
  // álbum: confere se chegaram todas as fotos do envio
  for (const e of ENVIOS.concat(mapa.envios).filter((x) => x.album)) {
    const n = candidatos.filter((c) => c.envio === e).length;
    if (n && n !== e.album) rel.avisos.push(`${textoEnvio(e)}: o álbum tinha ${e.album} fotos e chegaram ${n}`);
  }
  const atual = lerFotosJson(op.json);
  const grupos = new Map();
  for (const c of candidatos) {
    if (produtos && !porId.has(c.produto)) rel.avisos.push(`${c.nome}: o produto "${c.produto}" não existe no CONFIG (a foto sai mesmo assim)`);
    c.slug = slugDe(c.produto);
    if (!grupos.has(c.slug)) grupos.set(c.slug, []);
    grupos.get(c.slug).push(c);
  }

  const novas = {};
  for (const [slug, lista] of grupos) {
    lista.sort(compararCandidatos);
    let escolhida = lista[0];
    if (escolhida.papel === 'reserva' && atual[slug]) {
      rel.naoUsadas.push({ ...escolhida, motivo: 'reserva: já existe foto no fotos.json (para usar, declare no mapa.json com papel "principal")' });
      escolhida = null;
    }
    for (const c of lista.slice(1)) {
      const motivo = c.origem === 'antiga' && escolhida && escolhida.origem === 'nova' ? 'antiga: há foto nova' : 'alternativa';
      rel.naoUsadas.push({ ...c, motivo });
    }
    if (!escolhida) continue;
    const anterior = atual[slug] && atual[slug].arquivo && basename(atual[slug].arquivo) === escolhida.nome ? atual[slug].foco : null;
    let foco;
    try {
      foco = normalizarFoco(escolhida.foco || mapa.foco[slug] || mapa.foco[escolhida.produto] || anterior || mapa.focoPadrao);
    } catch (e) {
      rel.erros.push(`${escolhida.nome}: ${e.message}`);
      continue;
    }
    try {
      const { entrada, arquivos } = await gerarVariantes(join(op.pasta, escolhida.nome), slug, foco, escolhida.origem, rel.saida, rel.simular, mapa.recortes[slug] || mapa.recortes[escolhida.produto] || null);
      novas[slug] = entrada;
      rel.ligadas.push({ ...escolhida, ...entrada });
      if (!rel.simular) rel.gravados.push(...arquivos);
      if (entrada.w < LARGURA_BOA) {
        const lado = Math.min(entrada.w, entrada.h);
        rel.baixa.push({ slug, nome: escolhida.nome, w: entrada.w, h: entrada.h, nota: `-1080 sai com ${entrada.w} px` + (lado < LADO_Q ? `; -q ampliado (lado ${lado} < ${LADO_Q})` : '') });
      }
    } catch (e) {
      const heic = /\.hei[cf]$/i.test(escolhida.nome);
      rel.erros.push(`${escolhida.nome}: não abriu (${heic ? 'HEIC: converta para JPEG antes' : e.message})`);
    }
  }

  // texturas de parede (só das fotos que estão na pasta)
  mapa.paredes.forEach((p, i) => {
    rel.texturas.push({ ...p, nome: p.nome || `tijolo-${i + 1}` });
  });
  for (const t of rel.texturas) {
    const nome = nomes.find((n) => n === t.arquivo || basename(n, extname(n)) === t.arquivo);
    if (!nome) {
      t.erro = `arquivo "${t.arquivo}" não está na pasta`;
      rel.avisos.push(`parede ${t.nome}: ${t.erro}`);
      continue;
    }
    const destino = join(rel.texturasPasta, `${t.nome}.webp`);
    try {
      const final = await gerarTextura(join(op.pasta, nome), t, destino, rel.simular);
      Object.assign(t, { saida: final, destino });
      if (!rel.simular) rel.gravados.push(destino);
    } catch (e) {
      t.erro = e.message;
      rel.erros.push(`parede ${t.nome} (${t.arquivo}): ${e.message}`);
    }
  }

  // fotos.json
  const final = juntarFotosJson(atual, novas);
  if (!rel.simular && Object.keys(novas).length) {
    mkdirSync(dirname(rel.json), { recursive: true });
    writeFileSync(rel.json, JSON.stringify(final, null, 1) + '\n');
    rel.gravados.push(rel.json);
  }

  // conferência com o CONFIG: produtos sem foto, com foto antiga e campo foto a ajustar
  if (produtos) {
    for (const p of produtos) {
      if (SEM_FOTO_ESPERADA.has(p.cat)) continue;
      const alvo = mapa.compartilhadas[p.id];
      const slug = alvo && !novas[p.id] ? slugDe(alvo) : slugDe(p.id);
      const f = final[slug];
      if (!f) rel.produtosSemFoto.push({ id: p.id, nome: p.nome });
      else if (f.origem !== 'nova') rel.comFotoAntiga.push({ id: p.id, nome: p.nome, slug });
      if (f && p.foto !== slug) rel.config.push({ id: p.id, atual: p.foto, slug });
    }
  }
  return rel;
}

// ================= relatório =================
export function formatarRelatorio(rel) {
  const L = [];
  const rp = (c) => (relative(process.cwd(), c).startsWith('..') ? c : relative(process.cwd(), c) || '.');
  const secao = (titulo, itens, linha) => {
    L.push('', `${titulo} (${itens.length})`);
    if (!itens.length) L.push('  nenhum');
    itens.forEach((x) => L.push('  ' + linha(x)));
  };
  L.push(`Fotos: ${rp(rel.pasta)} → ${rp(rel.saida)}${rel.simular ? '  [simulação: nada foi gravado]' : ''}`);
  rel.avisos.forEach((a) => L.push(`  aviso: ${a}`));
  if (rel.vazia) {
    L.push('', `Nenhuma foto em ${rp(rel.pasta)}. Nada foi gravado (veja fotos-originais/README.md).`);
    return L.join('\n');
  }
  const larg = Math.max(8, ...rel.ligadas.map((x) => x.slug.length));
  secao('Ligadas', rel.ligadas, (x) => `${x.slug.padEnd(larg)} ← ${x.nome}  [${x.origem}, ${x.detalhe}] ${x.w}×${x.h} foco ${x.foco}`);
  secao('Não usadas (alternativas e reservas)', rel.naoUsadas, (x) => `${x.slug} ← ${x.nome}  [${x.motivo}; ${x.detalhe}]`);
  secao('Sem produto', rel.semProduto, (x) => `${x.nome}  (${x.motivo})`);
  secao('Produtos sem foto', rel.produtosSemFoto, (x) => `${x.id} (${x.nome})`);
  secao('Produtos ainda com foto antiga', rel.comFotoAntiga, (x) => `${x.id} → ${x.slug}`);
  secao(`Resolução baixa (largura < ${LARGURA_BOA} px)`, rel.baixa, (x) => `${x.slug} ← ${x.nome}: ${x.w}×${x.h} (${x.nota})`);
  secao('Campo foto a ajustar no CONFIG (src/core.js)', rel.config, (x) => `${x.id}: foto: '${x.slug}'${x.atual ? ` (hoje '${x.atual}')` : ' (hoje sem foto)'}`);
  secao('Texturas de parede', rel.texturas, (x) =>
    x.erro ? `${x.nome}: ${x.erro}` : `${x.nome}.webp ← ${x.arquivo} (região ${x.x},${x.y} ${x.w}×${x.h}; sai ${x.saida.w}×${x.saida.h})`
  );
  if (rel.erros.length) secao('ERROS', rel.erros, (x) => x);
  L.push('', rel.simular ? 'Simulação: nada foi gravado.' : `Gravados: ${rel.gravados.length} arquivo(s).`);
  return L.join('\n');
}

// ================= tijolinho desenhado em código (plano B até a textura real) =================
// Aparelho comum (cada fiada deslocada meio tijolo), rejunte, variação de tom por tijolo, manchas largas e grão fino.
// Escuro e discreto: feito para ficar atrás de uma camada escura. O ladrilho emenda sem costura (o tijolo que corta a
// borda é o mesmo dos dois lados e o ruído usa stitchTiles). Sem IA: tudo sai daqui, com semente fixa.
function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// hsl (graus, %, %) → #rrggbb
function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}

export function svgTijolo({ semente = 11 } = {}) {
  const r = aleatorio(semente);
  const entre = (a, b) => a + (b - a) * r();
  // proporção da parede das fotos novas: tijolo comprido (≈3,4 : 1) e rejunte largo (≈1/4 da altura)
  const TW = 150; // face do tijolo
  const TH = 44;
  const J = 12; // rejunte
  const MW = TW + J;
  const MH = TH + J;
  const COLS = 6;
  const FIADAS = 12;
  const W = COLS * MW; // 972
  const H = FIADAS * MH; // 672
  const n1 = (v) => Math.round(v * 10) / 10;
  const tijolos = [];
  for (let l = 0; l < FIADAS; l++) {
    const desloc = l % 2 ? MW / 2 : 0;
    for (let c = 0; c < COLS; c++) {
      // tom: terracota escuro com variação curta; poucos mais queimados e poucos mais claros
      const sorte = r();
      const luz = sorte < 0.05 ? entre(11.5, 13) : sorte > 0.95 ? entre(19, 20.5) : entre(14, 17.5);
      const cor = hsl(entre(15, 23), entre(40, 50), luz);
      const w = n1(TW + entre(-2.5, 2));
      const h = n1(TH + entre(-2, 1.5));
      const x = n1(c * MW + desloc + J / 2 + entre(-1.5, 1.5));
      const y = n1(l * MH + J / 2 + entre(-1.2, 1.2));
      const rx = n1(entre(1.5, 3.5));
      // o tijolo que passa da borda direita é desenhado de novo na esquerda (mesma cor e tamanho)
      for (const dx of x + w > W ? [0, -W] : [0]) {
        tijolos.push(`<rect x="${n1(x + dx)}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${cor}"/>`);
      }
    }
  }
  const regiao = `x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`;
  // ruído que emenda nas bordas do ladrilho; a matriz leva o vermelho do ruído para a transparência
  const ruido = (id, freq, oitavas, semente, matriz) =>
    `<filter id="${id}" ${regiao}><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oitavas}" seed="${semente}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="${matriz}"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<!-- Tijolinho desenhado em código (scripts/fotos.mjs, opção svg-tijolo): aparelho comum, rejunte salpicado, borda
     irregular, superfície áspera, tom variando por tijolo, manchas largas e grão fino. Escuro, para ficar atrás de uma
     camada escura. Plano B da textura real (public/assets/texturas/tijolo-*.webp, das fotos do cliente). -->
<defs>
${ruido('pintas-escuras', '0.9', 1, 3, '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  7 0 0 0 -4.2')}
${ruido('pintas-claras', '0.8', 1, 17, '0 0 0 0 0.7  0 0 0 0 0.68  0 0 0 0 0.65  -7 0 0 0 2.8')}
${ruido('manchas', '0.005 0.009', 3, 4, '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2 0 0 0 -0.9')}
${ruido('grao', '0.75', 2, 9, '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -1.75')}
<filter id="borda" x="-40" y="-10" width="${W + 80}" height="${H + 20}" filterUnits="userSpaceOnUse">
<feTurbulence type="fractalNoise" baseFrequency="0.045 0.09" numOctaves="2" seed="13" result="r"/>
<feDisplacementMap in="SourceGraphic" in2="r" scale="4.5" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="relevo" x="-40" y="-10" width="${W + 80}" height="${H + 20}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
<feOffset dx="0.6" dy="2.2" result="sombra"/>
<feFlood flood-color="#000" flood-opacity="0.6"/>
<feComposite in2="sombra" operator="in"/>
<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="aspero" ${regiao}>
<feTurbulence type="fractalNoise" baseFrequency="0.16 0.32" numOctaves="4" seed="5" stitchTiles="stitch" result="ruido"/>
<feDiffuseLighting in="ruido" surfaceScale="1.5" diffuseConstant="1" lighting-color="#fff" result="luz"><feDistantLight azimuth="250" elevation="58"/></feDiffuseLighting>
<feComposite in="SourceGraphic" in2="luz" operator="arithmetic" k1="1.17" k2="0" k3="0" k4="0"/>
</filter>
</defs>
<g filter="url(#aspero)">
<rect width="${W}" height="${H}" fill="${hsl(30, 5, 26)}"/>
<rect width="${W}" height="${H}" filter="url(#pintas-escuras)" opacity="0.75"/>
<rect width="${W}" height="${H}" filter="url(#pintas-claras)" opacity="0.4"/>
<g filter="url(#relevo)"><g filter="url(#borda)">
${tijolos.join('\n')}
</g></g>
</g>
<rect width="${W}" height="${H}" filter="url(#manchas)" opacity="0.35"/>
<rect width="${W}" height="${H}" filter="url(#grao)" opacity="0.4"/>
</svg>
`;
}

// ================= linha de comando =================
function lerArgs(args) {
  const op = {};
  const valor = (i) => {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`falta o valor de ${args[i]}`);
    return args[i + 1];
  };
  const chaves = { '--saida': 'saida', '--json': 'json', '--mapa': 'mapa', '--texturas': 'texturas', '--core': 'core' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (chaves[a]) op[chaves[a]] = valor(i++);
    else if (a === '--simular') op.simular = true;
    else if (a.startsWith('--')) throw new Error(`opção desconhecida: ${a}`);
    else if (!op.pasta) op.pasta = a;
    else throw new Error(`argumento a mais: ${a}`);
  }
  return op;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--svg-tijolo') {
    const destino = resolve(args[1] || join(PADRAO.texturas, 'tijolo.svg'));
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, svgTijolo());
    console.log(`tijolinho desenhado em código: ${relative(process.cwd(), destino)}`);
    return;
  }
  const rel = await processar(lerArgs(args));
  console.log(formatarRelatorio(rel));
  if (rel.erros.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
