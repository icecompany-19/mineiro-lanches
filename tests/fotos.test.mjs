// Testes do pipeline de fotos (scripts/fotos.mjs): node --test tests/fotos.test.mjs
// Monta numa pasta temporária cópias das fotos atuais (public/assets/fotos/*-1080.webp) com nomes falsos do WhatsApp
// nos horários da tabela de docs/CLIENTE-2026-10.md, mais arquivos fora de horário, ambíguos, antigos, um álbum e um
// com EXIF de GPS e orientação, e roda o pipeline com saída também temporária. Nada em public/ é gravado.
import { after as depois, before as antes, test as teste } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// O Playwright (testDir: tests) também importa *.test.mjs: lá estes testes do node:test não rodam.
const NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT) || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
const nada = () => {};
const test = NODE_TEST ? teste : nada;
const before = NODE_TEST ? antes : nada;
const after = NODE_TEST ? depois : nada;
const F = NODE_TEST ? await import('../scripts/fotos.mjs') : {};

const RAIZ = resolve(fileURLToPath(import.meta.url), '../..');
const FOTOS_ATUAIS = join(RAIZ, 'public', 'assets', 'fotos');
const WA = (quando, resto = '') => `WhatsApp Image ${quando}${resto}.jpeg`;
const GPS_DATUM = 'WGS-84-TESTE';

let tmp, pasta, saida, json, texturas, rel, texto;
const caminhos = () => ({ pasta, saida, json, texturas, mapa: join(pasta, 'mapa.json') });

// fotos atuais (-1080) em JPEG, com o nome que quisermos
async function copiar(slug, nome, { largura } = {}) {
  let img = sharp(join(FOTOS_ATUAIS, `${slug}-1080.webp`));
  if (largura) img = img.resize({ width: largura });
  if (nome.endsWith('.png')) await img.png().toFile(join(pasta, nome));
  else await img.jpeg({ quality: 90 }).toFile(join(pasta, nome));
}

// as fotos atuais com o -1080, da mais retrato para a mais paisagem
async function fotosAtuais() {
  const slugs = readdirSync(FOTOS_ATUAIS).filter((n) => n.endsWith('-1080.webp')).map((n) => n.replace(/-1080\.webp$/, ''));
  const lista = [];
  for (const slug of slugs) {
    const m = await sharp(join(FOTOS_ATUAIS, `${slug}-1080.webp`)).metadata();
    lista.push({ slug, w: m.width, h: m.height });
  }
  return lista.sort((a, b) => b.h / b.w - a.h / a.w);
}

async function media(buf) {
  const { channels } = await sharp(buf).stats();
  return channels.slice(0, 3).map((c) => c.mean);
}
async function diferenca(a, b, lado = 64) {
  const [x, y] = await Promise.all([a, b].map((i) => sharp(i).resize(lado, lado, { fit: 'fill' }).removeAlpha().raw().toBuffer()));
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return d / x.length;
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'fotos-teste-'));
  pasta = join(tmp, 'originais');
  saida = join(tmp, 'fotos');
  json = join(tmp, 'fotos.json');
  texturas = join(tmp, 'texturas');
  mkdirSync(pasta);

  const atuais = await fotosAtuais();
  assert.ok(atuais.length >= 6, 'precisa de pelo menos 6 fotos atuais em public/assets/fotos');
  // a mais alta com boa resolução: o foco vertical faz diferença
  const retrato = (atuais.find((f) => f.w >= 1000 && f.h > f.w) || atuais[0]).slug;
  const qualquer = (i) => atuais[(i + 1) % atuais.length].slug;

  await copiar(retrato, WA('2026-10-09 at 18.58.12')); // gran-bacon (foco do mapa: 50% 30%)
  await copiar(qualquer(1), WA('2026-10-09 at 19.45.03')); // dog-max, 2 min depois de 19:43
  await copiar(qualquer(2), WA('2026-10-09 at 20.27.40')); // gran-bacon-onion
  await copiar(qualquer(3), WA('2026-10-09 at 20.28.05')); // combo-gran-bacon-onion (principal)
  await copiar(qualquer(4), WA('2026-10-09 at 21.08.30')); // combo-gran-bacon-onion (2ª foto: alternativa)
  await copiar(qualquer(1), WA('2026-10-09 at 20.36.10')); // álbum da porção: 3 fotos
  await copiar(qualquer(2), WA('2026-10-09 at 20.36.10', ' (1)'));
  await copiar(qualquer(3), WA('2026-10-09 at 20.36.11'));
  await copiar(qualquer(4), WA('2026-10-09 at 21.04.00'), { largura: 480 }); // x-salada, resolução baixa
  await copiar(qualquer(1), WA('2026-10-09 at 21.07.00')); // ambíguo: 21:06 Ultra X ou 21:08 Combo
  await copiar(qualquer(2), WA('2026-10-09 at 15.00.00')); // fora de horário
  await copiar(qualquer(3), WA('2026-10-10 at 18.03.33')); // sem legenda: identificar pela imagem
  await copiar(qualquer(4), WA('2026-10-09 at 21.15.00')); // combo-casal reserva (já existe no fotos.json)
  await copiar(qualquer(1), WA('2026-10-08 at 10.45.00')); // antiga → dog-pizza pelo mapa
  await copiar(qualquer(2), WA('2026-10-08 at 10.47.00')); // antiga → gran-bacon pelo mapa (perde para a nova)
  await copiar(qualquer(3), WA('2026-10-08 at 10.49.00')); // antiga sem mapa
  await copiar(qualquer(4), 'gran-crispy.png'); // nome igual ao id do produto
  writeFileSync(join(pasta, 'notas.txt'), 'não é foto');

  // 23:26 no formato de 12 horas, com GPS e orientação EXIF 6 (guardada deitada 800×600: em pé fica 600×800).
  // Metade esquerda vermelha e direita azul: girada 90° no sentido horário, o vermelho fica em cima.
  const deitada = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#1f3fd0' } })
    .composite([{ input: { create: { width: 400, height: 600, channels: 3, background: '#d02020' } }, left: 0, top: 0 }])
    .png()
    .toBuffer();
  await sharp(deitada)
    .jpeg({ quality: 92 })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'TesteGPS', Model: 'Celular do dono' },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 32/1 30/1', GPSLongitudeRef: 'W', GPSLongitude: '46/1 18/1 39/1', GPSMapDatum: GPS_DATUM }
    })
    .toFile(join(pasta, 'WhatsApp Image 2026-10-09 at 11.26.20 PM.jpeg'));

  writeFileSync(
    join(pasta, 'mapa.json'),
    JSON.stringify({
      arquivos: {
        _como: 'comentário',
        [WA('2026-10-08 at 10.45.00')]: 'dog-pizza',
        'WhatsApp Image 2026-10-08 at 10.47.00': { produto: 'gran-bacon' }
      },
      compartilhadas: { 'dog-medio': 'dog-max', 'dog-super': 'dog-max' },
      foco: { 'gran-bacon': '50% 30%' },
      paredes: [
        { arquivo: WA('2026-10-09 at 18.58.12'), x: 10, y: 20, w: 300, h: 200 },
        { arquivo: 'nao-existe.jpeg', x: 0, y: 0, w: 10, h: 10, nome: 'tijolo-x' }
      ]
    })
  );
  // fotos.json de partida: uma provisória sem origem, uma antiga e um recorte (o app ignora "recorte:*")
  writeFileSync(
    json,
    JSON.stringify(
      { 'combo-casal': { w: 1600, h: 1372, cor: '#e8e8d8' }, 'dog-doritos': { w: 481, h: 643, cor: '#485858', origem: 'antiga' }, 'recorte:gran-chicken': { w: 720, h: 665 } },
      null,
      1
    )
  );
  rel = await F.processar(caminhos());
  texto = F.formatarRelatorio(rel);
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('nomes do WhatsApp: data, hora, (n) e formato de 12 horas', () => {
  const a = F.lerNomeWhatsApp('WhatsApp Image 2026-10-09 at 18.58.12.jpeg');
  assert.equal(a.texto, '09/10 18:58:12');
  assert.equal(a.seq, 0);
  assert.equal(F.lerNomeWhatsApp('WhatsApp Image 2026-10-09 at 18.58.12 (2).jpeg').seq, 2);
  assert.equal(F.lerNomeWhatsApp('WhatsApp Image 2026-10-09 at 6.58.12 PM.jpeg').texto, '09/10 18:58:12');
  assert.equal(F.lerNomeWhatsApp('WhatsApp Image 2026-10-12 at 12.15.00 AM (1).jpeg').texto, '12/10 00:15:00');
  assert.equal(F.lerNomeWhatsApp('IMG-20261009-WA0012.jpg'), null);
});

test('tabela de envios: minuto exato, tolerância de ±2 min e empate ambíguo', () => {
  const quando = (n) => F.envioDoHorario(F.lerNomeWhatsApp(WA(n)));
  assert.equal(quando('2026-10-09 at 21.05.59').envio.produto, 'gran-salada');
  assert.equal(quando('2026-10-09 at 21.04.00').envio.produto, 'x-salada');
  const perto = quando('2026-10-09 at 19.41.10');
  assert.equal(perto.envio.produto, 'dog-max');
  assert.equal(perto.distancia, 2);
  assert.match(quando('2026-10-09 at 21.07.00').motivo, /ambíguo/);
  assert.match(quando('2026-10-09 at 21.12.00').motivo, /fora da tabela/);
  assert.equal(quando('2026-10-08 at 10.50.00').envio.origem, 'antiga');
});

test('liga cada arquivo ao produto (horário, mapa.json e nome) e escolhe a melhor foto', () => {
  assert.deepEqual(rel.erros, []);
  const ligadas = Object.fromEntries(rel.ligadas.map((x) => [x.slug, x]));
  const esperado = {
    'gran-bacon': WA('2026-10-09 at 18.58.12'),
    'dog-max': WA('2026-10-09 at 19.45.03'),
    'gran-bacon-onion': WA('2026-10-09 at 20.27.40'),
    'combo-gran-bacon-onion': WA('2026-10-09 at 20.28.05'),
    'porcao-batata': WA('2026-10-09 at 20.36.10'),
    'x-salada': WA('2026-10-09 at 21.04.00'),
    'x-churrasco': 'WhatsApp Image 2026-10-09 at 11.26.20 PM.jpeg',
    'dog-pizza': WA('2026-10-08 at 10.45.00'),
    'gran-crispy': 'gran-crispy.png'
  };
  assert.deepEqual(Object.keys(ligadas).sort(), Object.keys(esperado).sort());
  for (const [slug, nome] of Object.entries(esperado)) assert.equal(ligadas[slug].nome, nome, slug);
  assert.equal(ligadas['dog-pizza'].origem, 'antiga');
  assert.equal(ligadas['dog-pizza'].via, 'mapa');
  assert.equal(ligadas['gran-crispy'].via, 'nome');
  assert.equal(ligadas['gran-bacon'].origem, 'nova');

  const naoUsadas = Object.fromEntries(rel.naoUsadas.map((x) => [x.nome, x]));
  assert.equal(naoUsadas[WA('2026-10-09 at 21.08.30')].slug, 'combo-gran-bacon-onion');
  assert.equal(naoUsadas[WA('2026-10-09 at 20.36.10', ' (1)')].slug, 'porcao-batata');
  assert.equal(naoUsadas[WA('2026-10-09 at 20.36.11')].slug, 'porcao-batata');
  assert.match(naoUsadas[WA('2026-10-08 at 10.47.00')].motivo, /antiga: há foto nova/);
  assert.match(naoUsadas[WA('2026-10-09 at 21.15.00')].motivo, /reserva/);

  const sem = Object.fromEntries(rel.semProduto.map((x) => [x.nome, x.motivo]));
  assert.match(sem[WA('2026-10-09 at 21.07.00')], /ambíguo/);
  assert.match(sem[WA('2026-10-09 at 15.00.00')], /fora da tabela/);
  assert.match(sem[WA('2026-10-10 at 18.03.33')], /identificar pela imagem/);
  assert.match(sem[WA('2026-10-08 at 10.49.00')], /antigas/);
  assert.equal(Object.keys(sem).length, 4);
  assert.ok(!rel.ligadas.concat(rel.semProduto).some((x) => x.nome === 'notas.txt'));
});

test('variantes no padrão do app: -q 360×360, -540 e -1080 sem ampliar', async () => {
  const fotos = JSON.parse(readFileSync(json, 'utf8'));
  for (const x of rel.ligadas) {
    const f = fotos[x.slug];
    const q = await sharp(join(saida, `${x.slug}-q.webp`)).metadata();
    assert.deepEqual([q.format, q.width, q.height], ['webp', 360, 360], `${x.slug}-q`);
    // mesma conta de arquivos() em src/app.js: largura min(540|1080, w) e altura proporcional
    for (const L of [540, 1080]) {
      const m = await sharp(join(saida, `${x.slug}-${L}.webp`)).metadata();
      const w = Math.min(L, f.w);
      assert.deepEqual([m.width, m.height], [w, Math.round((f.h * w) / f.w)], `${x.slug}-${L}`);
    }
  }
  const baixa = fotos['x-salada'];
  assert.equal(baixa.w, 480);
  assert.equal((await sharp(join(saida, 'x-salada-1080.webp')).metadata()).width, 480);
  // relatório de resolução baixa: exatamente as ligadas com menos de 1080 px de largura (x-salada e a do GPS, 600 px)
  const pequenas = rel.ligadas.filter((x) => x.w < 1080).map((x) => x.slug).sort();
  assert.deepEqual(rel.baixa.map((x) => x.slug).sort(), pequenas);
  assert.ok(pequenas.includes('x-salada') && pequenas.includes('x-churrasco'));
});

test('orientação EXIF aplicada e TODO o EXIF (com GPS) removido', async () => {
  const original = await sharp(join(pasta, 'WhatsApp Image 2026-10-09 at 11.26.20 PM.jpeg')).metadata();
  assert.equal(original.orientation, 6);
  assert.ok(original.exif && original.exif.includes(GPS_DATUM), 'a foto de teste tem GPS no EXIF');

  const f = JSON.parse(readFileSync(json, 'utf8'))['x-churrasco'];
  assert.deepEqual([f.w, f.h], [600, 800]);
  const img = join(saida, 'x-churrasco-540.webp');
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const [rCima, , bCima] = px(270, 100);
  const [rBaixo, , bBaixo] = px(270, 620);
  assert.ok(rCima > 150 && bCima < 90, `em cima vermelho (${px(270, 100)})`);
  assert.ok(bBaixo > 150 && rBaixo < 90, `embaixo azul (${px(270, 620)})`);

  const gerados = readdirSync(saida).map((n) => join(saida, n)).concat(readdirSync(texturas).map((n) => join(texturas, n)));
  assert.ok(gerados.length >= 27);
  for (const arq of gerados) {
    const m = await sharp(arq).metadata();
    assert.equal(m.exif, undefined, `${arq}: EXIF`);
    assert.equal(m.xmp, undefined, `${arq}: XMP`);
    assert.equal(m.iptc, undefined, `${arq}: IPTC`);
    assert.equal(m.icc, undefined, `${arq}: ICC`);
    assert.equal(m.orientation, undefined, `${arq}: orientação`);
    const bytes = readFileSync(arq);
    const sobrou = [GPS_DATUM, 'TesteGPS', 'Exif\0', 'EXIF', 'XMP '].filter((t) => bytes.includes(t));
    assert.deepEqual(sobrou, [], `${arq}: sobrou metadado`);
  }
});

test('só recorte e redimensionamento: cor média igual e -q recortado no foco', async () => {
  const fonte = join(pasta, WA('2026-10-09 at 18.58.12'));
  const [a, b] = await Promise.all([media(fonte), media(join(saida, 'gran-bacon-1080.webp'))]);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 2.5, `canal ${i}: ${v.toFixed(1)} → ${b[i].toFixed(1)}`));

  const fotos = JSON.parse(readFileSync(json, 'utf8'));
  const { w, h } = fotos['gran-bacon'];
  assert.equal(fotos['gran-bacon'].foco, '50% 30%');
  assert.ok(h > w, 'a foto do teste do foco é retrato');
  const lado = Math.min(w, h);
  const top = Math.min(h - lado, Math.max(0, Math.round(h * 0.3 - lado / 2)));
  const esperado = await sharp(fonte).extract({ left: 0, top, width: lado, height: lado }).toBuffer();
  const centro = await sharp(fonte).extract({ left: 0, top: Math.round((h - lado) / 2), width: lado, height: lado }).toBuffer();
  const q = join(saida, 'gran-bacon-q.webp');
  const noFoco = await diferenca(q, esperado);
  assert.ok(noFoco < 4, `-q bate com o recorte no foco (diferença ${noFoco.toFixed(2)})`);
  if (top !== Math.round((h - lado) / 2)) assert.ok(noFoco < (await diferenca(q, centro)), 'e não com o recorte do centro');
});

test('fotos.json: formato que src/app.js e o virtual:fotos leem, ordem mantida e recortes intactos', () => {
  const fotos = JSON.parse(readFileSync(json, 'utf8'));
  const chaves = Object.keys(fotos);
  assert.deepEqual(chaves.slice(0, 3), ['combo-casal', 'dog-doritos', 'recorte:gran-chicken']);
  assert.deepEqual(fotos['recorte:gran-chicken'], { w: 720, h: 665 });
  assert.deepEqual(fotos['combo-casal'], { w: 1600, h: 1372, cor: '#e8e8d8', origem: 'antiga' });
  for (const k of chaves.filter((c) => !c.startsWith('recorte:'))) {
    const f = fotos[k];
    assert.ok(Number.isInteger(f.w) && f.w > 0 && Number.isInteger(f.h) && f.h > 0, `${k}: w e h`);
    assert.match(f.cor, /^#[0-9a-f]{6}$/, `${k}: cor`);
    assert.ok(['nova', 'antiga'].includes(f.origem), `${k}: origem`);
  }
  for (const x of rel.ligadas) {
    assert.match(fotos[x.slug].foco, /^\d{1,3}% \d{1,3}%$/);
    assert.equal(fotos[x.slug].arquivo, x.nome);
  }
  assert.ok(readFileSync(json, 'utf8').endsWith('}\n'));
});

test('produtos sem foto, compartilhadas e CONFIG', () => {
  const sem = rel.produtosSemFoto.map((p) => p.id);
  assert.ok(sem.includes('gran-egg'));
  for (const id of ['dog-max', 'dog-medio', 'dog-super', 'gran-bacon', 'porcao-batata', 'x-salada']) assert.ok(!sem.includes(id), id);
  assert.ok(!sem.some((id) => id.startsWith('refri')), 'bebidas não entram');
  assert.ok(rel.comFotoAntiga.some((p) => p.id === 'combo-casal'));
  for (const c of rel.config) assert.notEqual(c.atual, c.slug);
});

test('textura de parede recortada da foto real', async () => {
  const m = await sharp(join(texturas, 'tijolo-1.webp')).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['webp', 300, 200]);
  assert.ok(!existsSync(join(texturas, 'tijolo-x.webp')));
  assert.ok(rel.avisos.some((a) => /tijolo-x.*nao-existe/.test(a)));
  const mapaRuim = join(tmp, 'mapa-ruim.json');
  writeFileSync(mapaRuim, JSON.stringify({ paredes: [{ arquivo: 'gran-crispy', x: 0, y: 0, w: 99999, h: 10 }] }));
  const fora = await F.processar({ ...caminhos(), mapa: mapaRuim, simular: true });
  assert.ok(fora.erros.some((e) => /fora da foto/.test(e)));
});

test('relatório', () => {
  assert.match(texto, /Ligadas \(9\)/);
  assert.match(texto, /Não usadas \(alternativas e reservas\) \(5\)/);
  assert.match(texto, /Sem produto \(4\)/);
  assert.match(texto, /Produtos sem foto \(\d+\)\n(.|\n)*gran-egg/);
  assert.match(texto, new RegExp(`Resolução baixa \\(largura < 1080 px\\) \\(${rel.baixa.length}\\)`));
  assert.match(texto, /\n {2}x-salada ← .*: 480×640 \(-1080 sai com 480 px\)/);
  assert.match(texto, /Texturas de parede \(2\)/);
  assert.match(texto, /porcao-batata .*20\.36\.10\.jpeg/);
  assert.ok(!rel.avisos.some((a) => /álbum/.test(a)), 'o álbum chegou completo');
  for (const g of rel.gravados) assert.ok(g.startsWith(tmp), `gravou fora da pasta temporária: ${g}`);
});

test('linha de comando: --simular não grava e pasta vazia não mexe em nada', () => {
  const outra = join(tmp, 'saida-simulada');
  const antes = readFileSync(json, 'utf8');
  const args = [join(RAIZ, 'scripts', 'fotos.mjs'), pasta, '--simular', '--saida', outra, '--json', json, '--texturas', join(outra, 'tex')];
  const saidaCli = execFileSync(process.execPath, args, { encoding: 'utf8' });
  assert.match(saidaCli, /Ligadas \(9\)/);
  assert.match(saidaCli, /Simulação: nada foi gravado/);
  assert.ok(!existsSync(outra));
  assert.equal(readFileSync(json, 'utf8'), antes);
  // sem a provisória no fotos.json, a reserva (Combo Casal fora do cenário) entra
  const semJson = execFileSync(process.execPath, [...args.slice(0, 6), join(outra, 'nao-existe.json'), ...args.slice(7)], { encoding: 'utf8' });
  assert.match(semJson, /Ligadas \(10\)/);
  assert.match(semJson, /combo-casal +← WhatsApp Image 2026-10-09 at 21\.15\.00\.jpeg/);

  const vazia = join(tmp, 'vazia');
  mkdirSync(vazia);
  const msg = execFileSync(process.execPath, [join(RAIZ, 'scripts', 'fotos.mjs'), vazia, '--saida', outra, '--json', join(outra, 'f.json'), '--texturas', outra], {
    encoding: 'utf8'
  });
  assert.match(msg, /Nenhuma foto/);
  assert.ok(!existsSync(outra));
});

test('HEIC que o sharp não abre vira erro com orientação', async () => {
  const p = join(tmp, 'heic');
  mkdirSync(p);
  writeFileSync(join(p, 'dog-max.heic'), 'não é imagem');
  const r = await F.processar({ pasta: p, saida: join(p, 's'), json: join(p, 'f.json'), texturas: join(p, 't') });
  assert.ok(r.erros.some((e) => /HEIC: converta para JPEG/.test(e)));
  assert.ok(!existsSync(join(p, 'f.json')));
});

test('tijolinho desenhado em código: SVG válido, ladrilho fixo e sem imagem embutida', () => {
  const svg = F.svgTijolo();
  assert.equal(svg, F.svgTijolo(), 'semente fixa: sai sempre igual');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="972" height="672"/);
  assert.ok(!/<image|href=|data:/.test(svg));
  for (const c of svg.match(/<!--[\s\S]*?-->/g) || []) assert.ok(!c.slice(4, -3).includes('--'), 'comentário XML não aceita "--"');
  assert.equal(readFileSync(join(RAIZ, 'public', 'assets', 'texturas', 'tijolo.svg'), 'utf8'), svg, 'public/assets/texturas/tijolo.svg está atualizado');
});
