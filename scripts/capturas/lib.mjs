// Harness único de capturas e medidas (A9a/A9b, B-ck/B19, P10a). Cada alvo (cliente, site, painel) é um módulo que exporta:
//   alvo, larguras, preparar?(), ligar?(page, variante, dados), telas(page, variante, dados, tela), limpar?(dados)
// e chama tela(nome, { elemento?, cheia? }) quando a tela está pronta. Quem decide o que fazer com a tela é o chamador:
// capturar (scripts/capturas.mjs) salva o PNG, medir (scripts/capturas/medir.mjs) mede o DOM e a captura.
//
// Banco: o Supabase local real (Postgres :54322, API :54321). Nada de API de mentira. As únicas intervenções na rede são
// page.route sobre respostas reais: estado_cardapio com loja.modo = 'auto' (a luz depende só do relógio fixo) e, no painel,
// a lista de pedidos filtrada para os pedidos de captura e envelhecida para o relógio fixo (o banco usa a hora real).
//
// Uso (Git Bash): source scripts/supabase-local/ambiente-windows.sh && node scripts/capturas.mjs cliente|site|painel|tudo
import { chromium } from '@playwright/test';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

/* global document, DocumentTimeline, requestAnimationFrame, innerWidth, innerHeight, scrollX, scrollY, scrollTo, devicePixelRatio */ // código que roda dentro da página (page.evaluate)

export const RAIZ = resolve(import.meta.dirname, '../..');
export const PASTA = join(RAIZ, 'capturas');
export const PORTA = Number(process.env.PORTA_CAPTURAS || 4185);
export const BASE = `http://localhost:${PORTA}`;
const VITE = join(RAIZ, 'node_modules/vite/bin/vite.js');

// ---------- ambiente (Windows: psql do pacote de ferramentas, como scripts/supabase-local/ambiente-windows.sh) ----------
if (process.env.LOCALAPPDATA) {
  const ferr = process.env.MINEIRO_FERRAMENTAS || join(process.env.LOCALAPPDATA, 'mineiro-ferramentas');
  const dirs = [join(ferr, 'pgsql/bin'), join(ferr, 'postgrest')].filter(existsSync);
  if (dirs.length && !(process.env.PATH || process.env.Path || '').includes(dirs[0])) {
    const chave = 'PATH' in process.env ? 'PATH' : 'Path';
    process.env[chave] = dirs.join(';') + ';' + (process.env[chave] || '');
  }
}
process.env.PGCLIENTENCODING = process.env.PGCLIENTENCODING || 'UTF8';
export const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const ENV_DEV = Object.fromEntries(
  readFileSync(join(RAIZ, '.env.development'), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
export const API = process.env.API_URL || ENV_DEV.VITE_SUPABASE_URL || 'http://localhost:54321';
export const CHAVE = ENV_DEV.VITE_SUPABASE_ANON_KEY || 'sb_publishable_local';
export const EQUIPE = 'equipe@teste.local';
// senha de teste do login fake do proxy local (a mesma do tests/e2e.spec.js): o proxy aceita qualquer uma
const SENHA_TESTE = 'qualquer-senha';

// ---------- variantes: largura × estado × movimento ----------
// 20:00 de terça (13/10/2026): dentro do turno; 14:00: fora. Fuso de São Paulo nos dois.
export const ESTADOS = { aberto: '2026-10-13T20:00:00-03:00', fechado: '2026-10-13T14:00:00-03:00' };
export const CONTEXTOS = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
};
export function variantes(larguras) {
  const v = [];
  for (const largura of larguras) for (const estado of Object.keys(ESTADOS)) for (const reduzido of [false, true]) v.push({ largura, estado, reduzido });
  return v;
}
export const rotuloVariante = (v) => `${v.largura}-${v.estado}${v.reduzido ? '-reduzido' : ''}`;
export const caminhoCaptura = (alvo, tela, v) => join(PASTA, alvo, `${tela}-${rotuloVariante(v)}.png`);

// ---------- erros de console ----------
// Sem Realtime local o WebSocket do supabase-js falha e tenta de novo: erro do ambiente (em produção o canal conecta).
const RE_REALTIME = /WebSocket connection to '[^']*\/realtime\/v1\//;
function vigiar(page, rotulo, erros) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !RE_REALTIME.test(m.text())) erros.push(`[${rotulo}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => erros.push(`[${rotulo}] pageerror: ${e.message}`));
}

// ---------- servidor: build de desenvolvimento + vite preview na porta própria ----------
async function responde(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.status > 0;
  } catch {
    return false;
  }
}
export async function subirServidor({ build = true } = {}) {
  if (await responde(BASE)) {
    throw new Error(`A porta ${PORTA} já tem um servidor. Derrube-o (netstat -ano | grep :${PORTA}; taskkill //PID <pid> //F) e rode de novo.`);
  }
  if (build) {
    console.log('> vite build --mode development');
    const r = spawnSync(process.execPath, [VITE, 'build', '--mode', 'development'], { cwd: RAIZ, stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) throw new Error('vite build falhou');
  }
  const filho = spawn(process.execPath, [VITE, 'preview', '--mode', 'development', '--port', String(PORTA), '--strictPort'], {
    cwd: RAIZ,
    stdio: ['ignore', 'ignore', 'inherit']
  });
  let parado = false;
  const parar = () => {
    if (parado) return;
    parado = true;
    try {
      filho.kill();
    } catch {
      /* já saiu */
    }
  };
  process.on('exit', parar);
  const fim = Date.now() + 30_000;
  while (!(await responde(BASE))) {
    if (Date.now() > fim || filho.exitCode !== null) {
      parar();
      throw new Error('vite preview não subiu na porta ' + PORTA);
    }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  return { parar };
}

// ---------- banco real ----------
export const psql = (sql) => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();

export async function rpc(nome, args, jwt) {
  const r = await fetch(`${API}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CHAVE, ...(jwt ? { authorization: 'Bearer ' + jwt } : {}) },
    body: JSON.stringify(args || {})
  });
  const txt = await r.text();
  let corpo = null;
  try {
    corpo = txt ? JSON.parse(txt) : null;
  } catch {
    corpo = txt;
  }
  if (!r.ok) {
    const e = new Error(`${nome}: ${r.status} ${txt}`);
    e.status = r.status;
    e.corpo = corpo;
    throw e;
  }
  return corpo;
}

// JWT da equipe pelo login fake do proxy local (qualquer senha). Garante a linha em equipe (insert ... on conflict do nothing).
export async function jwtDaEquipe() {
  psql(`insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = '${EQUIPE}' on conflict do nothing`);
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CHAVE },
    body: JSON.stringify({ email: EQUIPE, password: SENHA_TESTE })
  });
  if (!r.ok) throw new Error('login da equipe: ' + r.status + ' ' + (await r.text()));
  return (await r.json()).access_token;
}

// Cria um pedido pela RPC criar_pedido como o cardápio faz (chave publishable, papel anon). A RPC só aceita com a loja aberta:
// se recusar por loja_fechada, repete como equipe, que a RPC deixa passar (docs/CONTRATO-API.md), sem mexer na tabela loja.
export async function criarPedidoReal({ nome, telefone, modo = 'local', endereco = '', itens, obs = 'captura', pagamento = null, mesa = null }) {
  const p = { cliente: { nome, telefone }, modo, endereco, obs, origem: 'cardapio', mesa, pagamento, itens };
  try {
    return await rpc('criar_pedido', { p });
  } catch (e) {
    if (!/loja_fechada|muitos_pedidos/.test(String(e.message))) throw e;
    return rpc('criar_pedido', { p }, await jwtDaEquipe());
  }
}
export const apagarPedidosDeCaptura = () => psql(`delete from pedidos where obs = 'captura'`);

// ---------- páginas ----------
// Espera fontes, imagens visíveis e um respiro para as animações de entrada assentarem.
export async function estabilizar(page, espera = 900) {
  await page.evaluate(async () => {
    const limite = (p, ms) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);
    await limite(document.fonts.ready, 4000);
    // imagem lazy que ainda não começou a baixar nunca fica pronta: só espera as que já estão a caminho
    const imgs = Array.from(document.images).filter((i) => i.currentSrc && (i.loading !== 'lazy' || i.getBoundingClientRect().top < innerHeight * 2));
    await limite(
      Promise.all(
        imgs.map((i) =>
          i.complete
            ? i.naturalWidth && i.decode
              ? i.decode().catch(() => {})
              : null
            : new Promise((ok) => {
                i.addEventListener('load', ok, { once: true });
                i.addEventListener('error', ok, { once: true });
              })
        )
      ),
      5000
    );
  });
  await page.waitForTimeout(espera);
}

// Rola a página de ponta a ponta (dispara imagens lazy e entradas por IntersectionObserver) e volta ao topo.
export async function rolarTudo(page) {
  await page.evaluate(async () => {
    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const passo = Math.max(200, Math.floor(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += passo) {
      scrollTo(0, y);
      await pausa(120);
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await pausa(200);
    scrollTo(0, 0);
    await pausa(150);
  });
}

// Leva ao fim as animações finitas e espera 2 quadros. Sem isso, os PNG saíam com elas no quadro inicial (barras e anel do relatório a
// ~20%, selo de contagem em escala 1,3), o que faz os dados parecerem errados. Só a linha do tempo do documento: o que anda com a
// rolagem (scroll-driven) fica como está, e as infinitas continuam rodando. Só nas capturas: o medir.mjs conta as animações vivas
// e não pode ver isso. O que termina sem fill (pn-bump, as piscadas) volta ao estado de repouso, que é o certo para o PNG.
async function terminarAnimacoes(page) {
  await page.evaluate(async () => {
    document.getAnimations().forEach((a) => {
      const t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming();
      if (t && t.iterations !== Infinity && a.timeline instanceof DocumentTimeline) {
        try {
          a.finish();
        } catch {
          /* animação que não pode terminar (pausada com atraso infinito etc.) */
        }
      }
    });
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  });
}

// Altura máxima de um PNG (px do dispositivo): acima de ~16 mil px o Chromium falha ou sai em branco.
const ALTURA_MAX_PX = 15000;
// Salva o PNG. Sem opções: a página inteira (limitada); com elemento: só o retângulo dele (também limitado).
// alongar: estica a janela até a altura da página antes da foto e a devolve depois. Serve às telas com barra lateral sticky de 100vh
// (painel em 1280): no navegador ela acompanha a rolagem, mas numa foto de página inteira ela acabaria em 800 px e deixaria uma faixa vazia.
export async function salvarPng(page, caminho, { elemento = null, cheia = true, alongar = false } = {}) {
  mkdirSync(dirname(caminho), { recursive: true });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const maxCss = Math.floor(ALTURA_MAX_PX / dpr);
  if (!cheia && !elemento) {
    await terminarAnimacoes(page);
    await page.screenshot({ path: caminho });
    return { cortada: false };
  }
  const medirCaixa = () =>
    page.evaluate((el) => {
      const de = document.documentElement;
      const larg = Math.max(de.clientWidth, innerWidth);
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.left + scrollX), y: r.top + scrollY, width: Math.min(r.width, larg), height: r.height };
      }
      return { x: 0, y: 0, width: larg, height: Math.max(de.scrollHeight, innerHeight) };
    }, elemento);
  let caixa = await medirCaixa();
  const janela = page.viewportSize();
  const esticar = alongar && janela && !elemento && caixa.height > janela.height;
  try {
    if (esticar) {
      await page.setViewportSize({ width: janela.width, height: Math.ceil(Math.min(caixa.height, maxCss)) });
      caixa = await medirCaixa(); // o 100vh das barras sticky mudou: confere a altura de novo
    }
    await terminarAnimacoes(page);
    const cortada = caixa.height > maxCss;
    const clip = { x: caixa.x, y: caixa.y, width: Math.max(1, Math.floor(caixa.width)), height: Math.max(1, Math.floor(Math.min(caixa.height, maxCss))) };
    await page.screenshot({ path: caminho, fullPage: true, clip });
    return { cortada, alturaCss: caixa.height };
  } finally {
    if (esticar) await page.setViewportSize(janela);
  }
}

// ---------- execução ----------
// Percorre todas as variantes do módulo. aoTela({ page, alvo, nome, variante, elemento, cheia }) é chamado a cada tela pronta.
// Erros de uma variante não impedem as outras; tudo é devolvido ao final.
export async function executar(modulo, aoTela, opcoes = {}) {
  const { build = true, apenas = null, servidor: jaSubiu = null } = opcoes;
  const erros = [];
  const falhas = [];
  const servidor = jaSubiu || (await subirServidor({ build }));
  const navegador = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  let dados;
  // O banco local é compartilhado: outro agente pode apagar pedidos no meio da rodada. Por isso cada variante confere os dados
  // (modulo.garantir) antes de começar e, se falhar, roda uma segunda vez do início.
  const rodar = async (v, rotulo) => {
    if (modulo.garantir) await modulo.garantir(dados);
    const contexto = await navegador.newContext({ ...CONTEXTOS[v.largura], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const page = await contexto.newPage();
    page.setDefaultTimeout(15_000);
    vigiar(page, `${modulo.alvo} ${rotulo}`, erros);
    try {
      await page.clock.setFixedTime(new Date(ESTADOS[v.estado]));
      await page.emulateMedia({ reducedMotion: v.reduzido ? 'reduce' : 'no-preference' });
      if (modulo.ligar) await modulo.ligar(page, v, dados);
      await modulo.telas(page, v, dados, async (nome, extra = {}) => {
        await estabilizar(page, extra.espera);
        await aoTela({ page, alvo: modulo.alvo, nome, variante: v, ...extra });
      });
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await contexto.close();
    }
  };
  try {
    dados = modulo.preparar ? await modulo.preparar() : undefined;
    for (const v of variantes(modulo.larguras)) {
      const rotulo = rotuloVariante(v);
      if (apenas && !rotulo.includes(apenas)) continue;
      try {
        try {
          await rodar(v, rotulo);
        } catch (e) {
          console.log(`  (de novo) ${modulo.alvo} ${rotulo}: ${e.message.split('\n')[0]}`);
          await rodar(v, rotulo);
        }
        console.log(`  ok  ${modulo.alvo} ${rotulo}`);
      } catch (e) {
        falhas.push(`[${modulo.alvo} ${rotulo}] ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n')}`);
        console.log(`  ERRO ${modulo.alvo} ${rotulo}: ${e.message.split('\n')[0]}`);
      }
    }
  } finally {
    try {
      if (modulo.limpar) await modulo.limpar(dados);
    } finally {
      await navegador.close();
      if (!jaSubiu) servidor.parar();
    }
  }
  return { erros, falhas };
}

// ---------- intervenções na rede (sempre sobre a resposta REAL do banco local) ----------
// page.route que não deixa rejeição solta quando o contexto fecha no meio de uma consulta periódica do app.
export async function interceptar(page, padrao, tratar) {
  await page.route(padrao, async (route) => {
    try {
      await tratar(route);
    } catch {
      /* contexto fechado com a consulta em andamento */
    }
  });
}
// A luz do truck depende só do relógio fixo: o estado_cardapio real vem com loja.modo = 'auto' (o banco compartilhado pode estar em 'aberta').
export async function modoAuto(page) {
  await interceptar(page, '**/rest/v1/rpc/estado_cardapio', async (route) => {
    const resposta = await route.fetch();
    const json = await resposta.json();
    if (json && json.loja) json.loja.modo = 'auto';
    await route.fulfill({ response: resposta, json });
  });
}
export const agoraFalso = (v) => new Date(ESTADOS[v.estado]).getTime();
// Desloca os carimbos de tempo de um pedido (criadoEm/criado_em, atualizado_em, historico[].em) em delta ms.
// O banco grava com a hora real (12/10); o relógio fixo das capturas é 13/10 20:00 ou 14:00.
export function deslocarTempos(pedido, delta) {
  const mover = (s) => {
    const t = Date.parse(String(s).replace(' ', 'T'));
    return Number.isNaN(t) ? s : new Date(t + delta).toISOString();
  };
  const novo = { ...pedido };
  for (const k of ['criadoEm', 'criado_em', 'atualizado_em', 'atualizadoEm']) if (novo[k]) novo[k] = mover(novo[k]);
  if (Array.isArray(novo.historico)) novo.historico = novo.historico.map((h) => (h && h.em ? { ...h, em: mover(h.em) } : h));
  return novo;
}
export const criadoEmDe = (pedido) => Date.parse(String(pedido.criadoEm || pedido.criado_em).replace(' ', 'T'));
