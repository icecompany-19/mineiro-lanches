// Tela do entregador (/motoboy/): login, confirmação por link (#<uuid>), leitor de QR pela câmera e lista "Em rota".
// Sem banco: o Supabase inteiro é simulado por page.route (login, tabela motoboys e as RPCs entregas_em_rota e
// confirmar_entrega, no formato do contrato C1). Qualquer chamada que não foi simulada falha o teste e nunca chega ao
// banco local. A câmera é falsa (getUserMedia devolve um canvas.captureStream() com o QR desenhado).
// O documento da página sai com a CSP e a Permissions-Policy de produção (vercel.json), então violação de CSP aparece aqui.
// Uso: PORTA_TESTE=4184 npx playwright test tests/motoboy.spec.js --project=celular --project=desktop
/* global window, document, localStorage, location, getComputedStyle */
import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Nestes dois smokes de acesso, toda a API passa por page.route. No WebKit,
// um worker que assume a página faz Auth escapar desse mock para a rede real.
// Os cenários de funcionamento offline conservam o worker habilitado.
const testarAcesso = test.extend({ serviceWorkers: 'block' });

const RAIZ = resolve(import.meta.dirname, '..');
const lerEnv = (arq) =>
  Object.fromEntries(
    readFileSync(join(RAIZ, arq), 'utf8')
      .split('\n')
      .filter((l) => /^\w+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
  );
// o build dos testes é --mode development: o Supabase é o local, mas nada chega nele (tudo passa por page.route)
const API = new URL(lerEnv('.env.development').VITE_SUPABASE_URL).origin;
const HOST_PRODUCAO = new URL(lerEnv('.env.production').VITE_SUPABASE_URL).host;

// CSP e Permissions-Policy de produção de /motoboy/ (regra própria do entregador, que repete os cabeçalhos da global),
// com o host do Supabase trocado pelo do build de teste e sem o upgrade-insecure-requests (a página de teste é http://localhost)
const VERCEL = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'));
const cabecalho = (fonte, chave) => VERCEL.headers.find((r) => r.source === fonte).headers.find((h) => h.key === chave).value;
const CSP = cabecalho('/motoboy/(.*)', 'Content-Security-Policy')
  .replaceAll('https://' + HOST_PRODUCAO, API)
  .replaceAll('wss://' + HOST_PRODUCAO, API.replace(/^http/, 'ws'))
  .replace(/;\s*upgrade-insecure-requests/, '');
const PERMISSOES = cabecalho('/motoboy/(.*)', 'Permissions-Policy');

const ID_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ID_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const ID_C = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';
const MOTO = { id: '00000000-0000-4000-8000-000000000003', email: 'moto@teste.local' };

// ---------- dados do contrato C1 ----------
const pedido = (extra) => ({
  id: ID_A,
  numero: 11,
  status: 'entregue',
  cliente: { nome: 'Maria Souza', telefone: '11900000000' },
  endereco: 'Rua das Flores, 120, Centro, Suzano/SP',
  referencia: 'Portão azul',
  obs: '',
  total: 38.5,
  taxaEntrega: 8,
  distanciaKm: 4.1,
  atribuicao: '30000000-0000-4000-8000-000000000001',
  saiuEm: '2026-10-17T21:30:00-03:00',
  entregueEm: null,
  ...extra
});
const emRota = (extra) => pedido({ status: 'rota', ...extra });
const resumoTaxas = (dias = 1, taxas = {}) => ({
  dias,
  inicio: '2026-10-17T07:00:00Z',
  servidorEm: '2026-10-17T23:00:00Z',
  taxas: { concluidas: 0, emAberto: 0, qtdConcluidas: 0, qtdEmAberto: 0, semTaxaConcluidas: 0, semTaxaEmAberto: 0, ...taxas }
});
// já entregue (migration 20261017000002): o pedido volta só com id, numero e status, sem dados do cliente
const confirmou =
  (jaEntregue = false) =>
  (corpo) => ({
    json: { ok: true, jaEntregue, pedido: jaEntregue ? { id: corpo.p_id, numero: 11, status: 'entregue' } : pedido({ id: corpo.p_id }) }
  });
// erro de regra do banco: raise exception '<codigo>' (P0001), o texto da mensagem é só o código
const recusa = (codigo) => () => ({ status: 400, json: { code: 'P0001', details: null, hint: null, message: codigo } });

// ---------- Supabase simulado ----------
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': '*'
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessao(usuario) {
  const agora = Math.floor(Date.now() / 1000);
  const jwt = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: usuario.id, email: usuario.email, role: 'authenticated', aud: 'authenticated', iat: agora, exp: agora + 3600 }),
    Buffer.from('assinatura-de-teste').toString('base64url')
  ].join('.');
  return {
    access_token: jwt,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: agora + 3600,
    refresh_token: 'refresh-de-teste',
    user: {
      id: usuario.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: usuario.email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-10-01T12:00:00Z'
    }
  };
}

// opc.motoboy: false = o usuário não está na tabela motoboys (RLS devolve []).
// opc.equipe: o mesmo para a tabela equipe (só o teste do painel usa).
// opc.rota: lista de entregas_em_rota (ou função que devolve { status, json } / { abort }).
// opc.confirmar: (corpo) => { status?, json } | { abort: true } | { pendente: true }.
async function simular(page, opc = {}) {
  const usuario = opc.usuario || MOTO;
  const c = { login: 0, logout: 0, rota: 0, taxas: [], confirmar: [], motoboys: 0, equipe: 0, naoSimuladas: [] };
  const estado = {
    rota: opc.rota || [],
    confirmar: opc.confirmar || confirmou(),
    taxas: opc.taxas || ((dias) => ({ json: resumoTaxas(dias) }))
  };
  const responder = async (route, r) => {
    if (r.abort) return route.abort('internetdisconnected');
    if (r.pendente) return new Promise(() => {}); // nunca responde
    return route.fulfill({ status: r.status || 200, headers: CORS, json: r.json === undefined ? {} : r.json });
  };
  const preflight = (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : null);

  // o que não foi simulado falha o teste (e nunca chega ao banco local)
  await page.route(/\/(auth|rest|realtime|storage|functions)\/v1\//, (route) => {
    if (preflight(route)) return;
    c.naoSimuladas.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({ status: 404, headers: CORS, json: { message: 'não simulado' } });
  });
  await page.route('**/auth/v1/token*', async (route) => {
    if (preflight(route)) return;
    c.login++;
    const corpo = route.request().postDataJSON() || {};
    if (corpo.password === 'senha-errada') {
      return responder(route, { status: 400, json: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } });
    }
    return responder(route, { json: sessao(usuario) });
  });
  await page.route('**/auth/v1/logout*', async (route) => {
    if (preflight(route)) return;
    c.logout++;
    return route.fulfill({ status: 204, headers: CORS });
  });
  await page.route('**/rest/v1/motoboys*', async (route) => {
    if (preflight(route)) return;
    c.motoboys++;
    return responder(route, { json: opc.motoboy === false ? [] : [{ user_id: usuario.id }] });
  });
  await page.route('**/rest/v1/equipe*', async (route) => {
    if (preflight(route)) return;
    c.equipe++;
    return responder(route, { json: opc.equipe === false ? [] : [{ user_id: usuario.id }] });
  });
  await page.route('**/rest/v1/rpc/entregas_em_rota', async (route) => {
    if (preflight(route)) return;
    c.rota++;
    const r = estado.rota;
    return responder(route, typeof r === 'function' ? r() : { json: r });
  });
  await page.route('**/rest/v1/rpc/minhas_taxas_entrega', async (route) => {
    if (preflight(route)) return;
    const dias = route.request().postDataJSON().p_dias;
    c.taxas.push(dias);
    return responder(route, estado.taxas(dias));
  });
  await page.route('**/rest/v1/rpc/minha_operacao_rotas', async (route) => {
    if (preflight(route)) return;
    return responder(route, {
      json: {
        servidorEm: new Date().toISOString(),
        modo: 'desligado',
        entregador: { id: usuario.id, nome: usuario.email, declarado: 'fora', situacao: 'fora', qtdAbertas: 0, elegivel: false },
        viagem: null
      }
    });
  });
  await page.route('**/rest/v1/rpc/consultar_entrega_motoboy', async (route) => {
    if (preflight(route)) return;
    return responder(route, { json: emRota({ id: route.request().postDataJSON().p_id }) });
  });
  await page.route('**/rest/v1/rpc/confirmar_entrega_offline', async (route) => {
    if (preflight(route)) return;
    const corpo = route.request().postDataJSON() || {};
    c.confirmar.push(corpo.p_id);
    return responder(route, estado.confirmar(corpo));
  });
  return { c, estado, responder };
}

// ---------- página ----------
// Entrega o documento com a CSP e a Permissions-Policy de /motoboy/ e vigia console, CSP e domínios de fora.
async function preparar(page, baseURL) {
  const v = { erros: [], externas: [], csp: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') v.erros.push(m.text());
  });
  page.on('pageerror', (e) => v.erros.push('pageerror: ' + e.message));
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (/^https?:$/.test(u.protocol) && u.hostname !== new URL(baseURL).hostname) v.externas.push(req.url());
  });
  await page.route('**/motoboy/', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const r = await route.fetch();
    await route.fulfill({ response: r, headers: { ...r.headers(), 'content-security-policy': CSP, 'permissions-policy': PERMISSOES } });
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener(
      'securitypolicyviolation',
      (e) => window.__csp.push(`${e.effectiveDirective} bloqueou ${e.blockedURI || 'inline'}`),
      true
    );
  });
  v.fechar = async () => {
    v.csp = await page.evaluate(() => window.__csp || []).catch(() => []);
  };
  return v;
}

// câmera falsa: getUserMedia devolve um canvas.captureStream() com o QR desenhado (módulos da lib qrcode, gerados aqui no Node)
async function camera(page, { texto, erro } = {}) {
  let modulos = null;
  let n = 0;
  if (texto) {
    const q = QRCode.create(texto, { errorCorrectionLevel: 'M' });
    n = q.modules.size;
    modulos = Array.from(q.modules.data);
  }
  await page.addInitScript(
    ({ modulos, n, erro }) => {
      window.__camera = { pedidos: 0, constraints: null, faixas: [] };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints) => {
          window.__camera.pedidos++;
          window.__camera.constraints = constraints;
          if (erro) throw new DOMException('câmera simulada', erro);
          const margem = 4;
          const escala = 10;
          const lado = (n + 2 * margem) * escala;
          const tela = document.createElement('canvas');
          tela.width = tela.height = lado;
          const g = tela.getContext('2d');
          const desenhar = () => {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, lado, lado);
            g.fillStyle = '#000';
            for (let y = 0; y < n; y++)
              for (let x = 0; x < n; x++) if (modulos[y * n + x]) g.fillRect((x + margem) * escala, (y + margem) * escala, escala, escala);
          };
          desenhar();
          const fluxo = tela.captureStream(15);
          const relogio = setInterval(desenhar, 100); // quadros novos o tempo todo
          fluxo.getTracks().forEach((t) => {
            const parar = t.stop.bind(t);
            t.stop = () => {
              clearInterval(relogio);
              parar();
            };
            window.__camera.faixas.push(t);
          });
          return fluxo;
        }
      });
    },
    { modulos, n, erro: erro || null }
  );
}
const faixasParadas = (page) =>
  page.evaluate(() => window.__camera.faixas.length > 0 && window.__camera.faixas.every((t) => t.readyState === 'ended'));

async function entrar(page, email = MOTO.email, senha = 'senha-de-teste') {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
// abre /motoboy/ (com o hash, se vier) e faz o login
async function abrirLogado(page, hash = '') {
  await page.goto('/motoboy/' + hash);
  await entrar(page);
  await expect(page.locator('.mb-app')).toBeVisible();
}
const resultado = (page) => page.locator('.mb-res');
const semHash = (page) => expect.poll(() => page.evaluate(() => location.hash)).toBe('');

// ---------- testes ----------

test('restauração pendente da sessão não prende o acesso do entregador', async ({ page }) => {
  await page.clock.install();
  await simular(page);
  const salva = { ...sessao(MOTO), expires_at: Math.floor(Date.now() / 1000) - 120 };
  await page.addInitScript((s) => {
    localStorage.setItem('mineiro:v2:moto', JSON.stringify(s));
    localStorage.setItem('motoboy:preservar-teste', 'confirmacoes-preservadas');
  }, salva);
  let renovacoes = 0;
  await page.route('**/auth/v1/token*', () => {
    renovacoes++;
    return new Promise(() => {});
  });
  await page.goto('/motoboy/');
  await expect.poll(() => renovacoes).toBeGreaterThan(0);
  await page.clock.runFor(15100);
  await expect(page.getByRole('alert')).toContainText('O acesso demorou para responder');
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(page.locator('.mb-app')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('motoboy:preservar-teste'))).toBe('confirmacoes-preservadas');
});

test('conferência pendente do motoboy informa falha sem conceder acesso', async ({ page }) => {
  await page.clock.install();
  await simular(page);
  await page.addInitScript((s) => localStorage.setItem('mineiro:v2:moto', JSON.stringify(s)), sessao(MOTO));
  let consultas = 0;
  await page.route('**/rest/v1/motoboys*', () => {
    consultas++;
    return new Promise(() => {});
  });
  await page.goto('/motoboy/');
  await expect.poll(() => consultas).toBeGreaterThan(0);
  await page.clock.runFor(15100);
  await expect(page.getByRole('alert')).toContainText('O acesso demorou para responder');
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(page.locator('.mb-app')).toHaveCount(0);
});

test('módulo do entregador indisponível conserva instrução de recarregar', async ({ page }) => {
  await page.route(/\/(?:src\/main-motoboy\.js|_app\/motoboy-[^/]+\.js)(?:\?.*)?$/, (route) => route.abort());
  await page.goto('/motoboy/');
  await expect(page.locator('#view-motoboy')).toContainText('Abrindo o acesso do entregador');
  await expect(page.getByRole('link', { name: 'recarregue o acesso' })).toHaveAttribute('href', '/motoboy/');
});

test('primeira carga pendente do painel termina espera e ignora resposta atrasada', async ({ page }) => {
  await page.clock.install();
  await simular(page);
  await page.addInitScript((s) => localStorage.setItem('mineiro:v2:sessao', JSON.stringify(s)), sessao(MOTO));
  let pendente;
  await page.route('**/rest/v1/rpc/estado_cardapio', (route) => {
    pendente = route;
    return new Promise(() => {});
  });
  await page.route('**/rest/v1/pedidos*', (route) => route.fulfill({ headers: CORS, json: [] }));
  await page.goto('/painel/');
  await expect.poll(() => !!pendente).toBe(true);
  await page.clock.runFor(15100);
  await expect(page.getByRole('alert')).toContainText('O acesso demorou para responder');
  await expect(page.locator('#view-painel')).toBeHidden();
  await pendente.fulfill({ headers: CORS, json: { loja: {}, adicionais: {} } });
  await page.clock.runFor(100);
  await expect(page.locator('#view-painel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
});

test('taxas próprias acompanham o período e preservam a última consulta se a rede falhar', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page, {
    taxas: (dias) => ({
      json: resumoTaxas(dias, {
        concluidas: dias === 1 ? 11.35 : 14.7,
        emAberto: 9,
        qtdConcluidas: dias === 1 ? 3 : 4,
        qtdEmAberto: 2,
        semTaxaConcluidas: 1
      })
    })
  });
  await abrirLogado(page);
  await expect(page.locator('[data-taxas-concluidas]')).toHaveText(/R\$\s*11,35/);
  await expect(page.locator('[data-taxas-aberto]')).toHaveText(/R\$\s*9,00/);
  await expect(page.locator('[data-taxas-estado]')).toContainText('1 pedido sem taxa registrada');
  await page.getByLabel('Período das taxas').selectOption('7');
  await expect(page.locator('[data-taxas-concluidas]')).toHaveText(/R\$\s*14,70/);
  await expect(page.locator('[data-taxas]')).toHaveAttribute('aria-busy', 'false');
  s.estado.taxas = () => ({ abort: true });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.locator('[data-taxas-estado]')).toContainText('Não foi possível atualizar');
  await expect(page.locator('[data-taxas-concluidas]')).toHaveText(/R\$\s*14,70/);
  expect(s.c.taxas).toContain(7);
  expect(s.c.naoSimuladas).toEqual([]);
});

testarAcesso('login do entregador: tela Entregas, sessão em chave própria e nada do painel carregado', async ({ page, baseURL }) => {
  const v = await preparar(page, baseURL);
  const s = await simular(page);
  await page.goto('/motoboy/');
  await expect(page).toHaveTitle('Entregas · Mineiro Lanche');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/motoboy/manifest.webmanifest');
  const acesso = page.locator('.pn-acesso');
  await expect(acesso.getByRole('heading', { name: 'Entregas' })).toBeVisible();
  await expect(acesso.locator('.pn-acesso-sub')).toHaveText('Mineiro Lanche · acesso do entregador');
  await expect(page.locator('.mb-app')).toHaveCount(0);

  // campos vazios e senha errada: as mesmas mensagens do painel
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Preencha o e-mail e a senha.' })).toBeVisible();
  await entrar(page, MOTO.email, 'senha-errada');
  await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos.' })).toBeVisible();

  await entrar(page);
  const app = page.locator('.mb-app');
  await expect(app.getByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible();
  await expect(app.locator('.mb-usuario')).toHaveText(MOTO.email);
  await expect(app.getByRole('button', { name: 'Ler QR da comanda' })).toBeVisible();
  await expect(app.getByRole('heading', { name: 'Em rota' })).toBeVisible();
  await expect(app.getByText('Nenhuma entrega em rota agora.')).toBeVisible();
  await expect(app.getByRole('button', { name: 'Atualizar', exact: true })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Sair' })).toBeVisible();
  await expect(acesso).toBeHidden();

  // sessão na chave do entregador (a do painel começa por mineiro:v2:sessao e o Sair do painel apaga por prefixo)
  const chaves = await page.evaluate(() => Object.keys(localStorage));
  expect(chaves.filter((k) => k.startsWith('mineiro:v2:moto')).length).toBeGreaterThan(0);
  expect(chaves.filter((k) => k.startsWith('mineiro:v2:sessao'))).toEqual([]);
  // a tela do entregador não monta o painel nem a store (nenhum pedido, nenhum estado_cardapio, nenhum Realtime)
  expect(await page.evaluate(() => typeof window.MLPainel)).toBe('undefined');
  expect(s.c.motoboys).toBe(1);
  expect(s.c.equipe).toBe(0);
  expect(s.c.rota).toBe(1);
  expect(s.c.confirmar).toEqual([]);

  await v.fechar();
  expect(s.c.naoSimuladas, 'chamadas ao Supabase sem simulação').toEqual([]);
  expect(v.csp, 'violações de CSP').toEqual([]);
  // o único erro esperado é o 400 da senha errada que o teste digitou de propósito
  expect(
    v.erros.filter((e) => !/status of 400/.test(e)),
    'erros no console'
  ).toEqual([]);
  expect(v.externas, 'requisições a outros domínios').toEqual([]);
});

testarAcesso('sem acesso: usuário fora da tabela motoboys não vê entregas', async ({ page, baseURL }) => {
  const v = await preparar(page, baseURL);
  const s = await simular(page, { motoboy: false, usuario: { id: '00000000-0000-4000-8000-000000000009', email: 'outro@teste.local' } });
  await page.goto('/motoboy/#' + ID_A);
  await entrar(page, 'outro@teste.local');
  const sem = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Sem acesso' }) });
  await expect(sem).toBeVisible();
  await expect(sem).toContainText('Este usuário não está na lista de entregadores.');
  await expect(sem).toContainText('outro@teste.local');
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  await expect(page.locator('.mb-app')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ler QR da comanda' })).toHaveCount(0);
  // nada de entregas nem de confirmação para quem não é entregador (o link com o uuid fica sem efeito)
  expect(s.c.rota).toBe(0);
  expect(s.c.confirmar).toEqual([]);
  expect(s.c.equipe).toBe(0);
  expect(s.c.naoSimuladas).toEqual([]);
  await v.fechar();
  expect(v.csp).toEqual([]);
  expect(v.externas).toEqual([]);
});

test('Sair apaga a sessão do entregador (mesmo sem rede) e deixa a do painel em paz', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page);
  await abrirLogado(page);
  // uma sessão do painel no mesmo aparelho (outra origem de chave: mineiro:v2:sessao…) não pode sumir
  await page.evaluate(() => localStorage.setItem('mineiro:v2:sessao', '{"painel":true}'));
  // sem rede: o supabase-js não apaga nada sozinho quando o /logout falha, a tela apaga pelo prefixo da chave
  await page.route('**/auth/v1/logout*', (r) => r.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.locator('.pn-acesso').getByLabel('E-mail')).toBeVisible();
  const chaves = await page.evaluate(() => Object.keys(localStorage));
  expect(chaves.filter((k) => k.startsWith('mineiro:v2:moto'))).toEqual([]);
  expect(chaves).toContain('mineiro:v2:sessao');
  expect(s.c.naoSimuladas).toEqual([]);
});

test('link da comanda (#uuid) depois do login: confirma na hora, mostra Entregue e limpa o hash', async ({ page, baseURL }) => {
  const v = await preparar(page, baseURL);
  const s = await simular(page);
  await abrirLogado(page);
  await expect(page.getByText('Nenhuma entrega em rota agora.')).toBeVisible();
  // a câmera nativa do celular abre o link; com a tela já aberta só o hash muda
  await page.evaluate((id) => (location.hash = '#' + id), ID_A);
  const r = resultado(page);
  await expect(r.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(r).toContainText('#0011');
  await expect(r).toContainText('Maria Souza');
  expect(s.c.confirmar).toEqual([ID_A]);
  await semHash(page);
  // o tamanho da letra é de ler de longe
  const px = await r.locator('.mb-res-t').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(px).toBeGreaterThanOrEqual(36);
  await v.fechar();
  expect(s.c.naoSimuladas).toEqual([]);
  expect(v.csp).toEqual([]);
  expect(v.erros).toEqual([]);
});

test('link da comanda antes do login: guarda o uuid e confirma logo depois de entrar', async ({ page, baseURL }) => {
  const v = await preparar(page, baseURL);
  const s = await simular(page);
  await page.goto('/motoboy/#' + ID_A);
  await expect(page.locator('.pn-acesso').getByLabel('E-mail')).toBeVisible();
  expect(s.c.confirmar, 'nada é confirmado antes do login').toEqual([]);
  expect(await page.evaluate(() => location.hash), 'o hash fica na barra durante o login').toBe('#' + ID_A);
  await entrar(page);
  await expect(resultado(page).getByText('Entregue', { exact: true })).toBeVisible();
  await expect(resultado(page)).toContainText('#0011');
  expect(s.c.confirmar).toEqual([ID_A]);
  await semHash(page);
  await v.fechar();
  expect(s.c.naoSimuladas).toEqual([]);
  expect(v.csp).toEqual([]);
  expect(v.erros).toEqual([]);
});

test('link da comanda com a sessão já guardada: abre direto na confirmação, sem pedir login', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page);
  await abrirLogado(page);
  await page.goto('about:blank'); // carga nova
  await page.goto('/motoboy/#' + ID_B);
  await expect(resultado(page).getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.locator('.pn-acesso')).toBeHidden();
  expect(s.c.confirmar).toEqual([ID_B]);
  expect(s.c.login, 'um login só').toBe(1);
  await semHash(page);
});

test('ler de novo: "Já estava entregue" sem erro', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page, { confirmar: confirmou(true) });
  await abrirLogado(page, '#' + ID_A);
  const r = resultado(page);
  await expect(r.getByText('Já estava entregue')).toBeVisible();
  await expect(r).toContainText('#0011');
  await expect(r.locator('.mb-res-nome'), 'sem o nome do cliente (o banco não manda mais)').toHaveCount(0);
  await expect(r.getByRole('button')).toHaveCount(0);
  expect(s.c.confirmar).toEqual([ID_A]);
});

for (const [codigo, texto] of [
  ['nao_e_entrega', 'Esse pedido é de retirada'],
  ['pedido_cancelado', 'Pedido cancelado'],
  ['transicao_invalida', 'Ainda não foi aceito pela cozinha'],
  ['nao_encontrado', 'Pedido não encontrado'],
  ['sem_permissao', 'Este usuário não tem permissão para confirmar entregas'],
  ['dados_invalidos', 'Esse código não é de um pedido']
])
  test('recusa fica preservada na fila para conferência: ' + codigo, async ({ page, baseURL }) => {
    await preparar(page, baseURL);
    const s = await simular(page, { confirmar: recusa(codigo) });
    await abrirLogado(page, '#' + ID_A);
    await expect(page.locator('[data-pendencias]')).toContainText(texto);
    await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
    await expect(resultado(page).getByText('Entregue', { exact: true })).toHaveCount(0);
    expect(s.c.confirmar).toEqual([ID_A]);
    expect(s.c.naoSimuladas).toEqual([]);
  });

test('sem rede: avisa e deixa tentar de novo (a confirmação é idempotente no servidor)', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page, { confirmar: () => ({ abort: true }) });
  await abrirLogado(page, '#' + ID_A);
  const r = resultado(page);
  await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  // O aviso aparece ao gravar no aparelho, antes da primeira tentativa de rede.
  await expect.poll(() => s.c.confirmar).toEqual([ID_A]);
  await expect(page.getByRole('button', { name: 'Sincronizar agora' })).toBeEnabled();
  s.estado.confirmar = confirmou();
  await page.getByRole('button', { name: 'Sincronizar agora' }).click();
  await expect(r.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(r).toContainText('#0011');
  expect(s.c.confirmar).toEqual([ID_A, ID_A]);
});

test('servidor que não responde: desiste em 15 s e conta como falta de rede', async ({ page, baseURL }) => {
  await page.clock.install();
  await preparar(page, baseURL);
  const s = await simular(page, { confirmar: () => ({ pendente: true }) });
  await abrirLogado(page, '#' + ID_A);
  const r = resultado(page);
  await expect(r).toContainText('Confirmada neste aparelho');
  await page.clock.fastForward(14_000);
  await expect(r).toContainText('Confirmada neste aparelho');
  await page.clock.fastForward(2_000);
  await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  expect(s.c.confirmar).toEqual([ID_A]);
});

test('lista Em rota: dados do pedido e um botão Entregue em cada um (plano B sem câmera)', async ({ page, baseURL }) => {
  const v = await preparar(page, baseURL);
  const s = await simular(page, {
    rota: [
      emRota(),
      emRota({
        id: ID_B,
        numero: 12,
        cliente: { nome: 'João <b>Lima</b>', telefone: '' },
        endereco: 'Avenida Paulista, 1000',
        referencia: '',
        obs: 'Deixar na portaria',
        total: 52
      })
    ]
  });
  await abrirLogado(page);
  const itens = page.locator('.mb-item');
  await expect(itens).toHaveCount(2);
  const a = itens.nth(0);
  await expect(a).toContainText('#0011');
  await expect(a).toContainText('Maria Souza');
  await expect(a).toContainText('Rua das Flores, 120, Centro, Suzano/SP');
  await expect(a).toContainText('Portão azul');
  await expect(a).toContainText('R$ 38,50');
  await expect(a.getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:11900000000');
  const b = itens.nth(1);
  await expect(b).toContainText('#0012');
  await expect(b.locator('.mb-item-nome')).toHaveText('João <b>Lima</b>'); // texto, nunca HTML
  await expect(b.locator('b', { hasText: 'Lima' })).toHaveCount(0);
  await expect(b).toContainText('Deixar na portaria');
  await expect(b.getByRole('link', { name: 'Ligar' }), 'sem telefone, sem Ligar').toHaveCount(0);

  // o toque em Entregue é a confirmação
  await a.getByRole('button', { name: 'Entregue' }).click();
  const r = resultado(page);
  await expect(r.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(r).toContainText('#0011');
  await expect(itens).toHaveCount(1);
  await expect(itens.first()).toContainText('#0012');
  expect(s.c.confirmar).toEqual([ID_A]);

  // Atualizar consulta de novo
  s.estado.rota = [];
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByText('Nenhuma entrega em rota agora.')).toBeVisible();
  expect(s.c.rota).toBe(3);
  await v.fechar();
  expect(s.c.naoSimuladas).toEqual([]);
  expect(v.csp).toEqual([]);
  expect(v.erros).toEqual([]);
});

test('lista Em rota: erro na confirmação fica no pedido; falha ao carregar pede Atualizar', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page, { rota: () => ({ abort: true }), confirmar: recusa('transicao_invalida') });
  await abrirLogado(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Sem conexão com o servidor' })).toBeVisible();
  s.estado.rota = [emRota()];
  await page.getByRole('button', { name: 'Atualizar' }).click();
  const item = page.locator('.mb-item');
  await expect(item).toHaveCount(1);
  await item.getByRole('button', { name: 'Entregue' }).click();
  await expect(page.locator('[data-pendencias]')).toContainText('Ainda não foi aceito pela cozinha');
  await expect(item.getByRole('button', { name: 'Entregue' })).toBeDisabled();
  await expect(item, 'o pedido continua na lista').toHaveCount(1);
  // corrigiu no servidor: o mesmo evento persistido é reenviado
  s.estado.confirmar = confirmou();
  await page.getByRole('button', { name: 'Sincronizar agora' }).click();
  await expect(resultado(page).getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.locator('.mb-item')).toHaveCount(0);
  expect(s.c.confirmar).toEqual([ID_A, ID_A]);
});

test('Ler QR com a câmera falsa: lê o uuid, confirma, para a câmera e não segue a URL', async ({ page, baseURL }) => {
  const v = await preparar(page, baseURL);
  const s = await simular(page);
  // o QR da comanda: https://<domínio>/motoboy/#<id do pedido>. A URL lida nunca é aberta (nem o domínio é chamado)
  await camera(page, { texto: 'https://mineirolanches.store/motoboy/#' + ID_A });
  await abrirLogado(page);
  const urlAntes = page.url();
  expect(await page.evaluate(() => window.__camera.pedidos), 'a câmera só abre por toque').toBe(0);
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
  const r = resultado(page);
  await expect(r.getByText('Entregue', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(r).toContainText('#0011');
  await expect(r).toContainText('Maria Souza');
  expect(s.c.confirmar).toEqual([ID_A]);
  expect(await page.evaluate(() => window.__camera.pedidos)).toBe(1);
  expect(await page.evaluate(() => window.__camera.constraints)).toEqual({ audio: false, video: { facingMode: { ideal: 'environment' } } });
  // ao ler: faixas paradas, vídeo solto, leitor fechado e o botão de volta
  expect(await faixasParadas(page), 'faixas da câmera paradas').toBe(true);
  expect(await page.evaluate(() => document.querySelector('video')?.srcObject ?? null)).toBeNull();
  await expect(page.locator('.mb-leitor')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Ler QR da comanda' })).toBeVisible();
  expect(page.url(), 'não navegou para a URL do QR').toBe(urlAntes);
  expect(v.externas, 'nenhuma requisição ao domínio do QR').toEqual([]);
  // o vídeo é playsinline, mudo e sem blob: (createObjectURL)
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
  const video = page.locator('video');
  await expect(video).toHaveAttribute('playsinline', '');
  expect(await video.evaluate((el) => ({ muted: el.muted, autoplay: el.autoplay, src: el.getAttribute('src') }))).toEqual({
    muted: true,
    autoplay: true,
    src: null
  });
  await v.fechar();
  expect(s.c.naoSimuladas).toEqual([]);
  expect(v.csp, 'violações de CSP').toEqual([]);
  expect(v.erros).toEqual([]);
});

test('Ler QR: QR de outra coisa avisa e segue procurando; Fechar câmera para as faixas', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  const s = await simular(page);
  await camera(page, { texto: 'https://exemplo.com.br/cardapio' });
  await abrirLogado(page);
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
  await expect(page.locator('.mb-dica')).toContainText('Esse QR não é de uma comanda', { timeout: 15_000 });
  await expect(page.locator('.mb-leitor'), 'o leitor continua aberto').toBeVisible();
  expect(s.c.confirmar).toEqual([]);
  await page.getByRole('button', { name: 'Fechar câmera' }).click();
  await expect(page.locator('.mb-leitor')).toBeHidden();
  expect(await faixasParadas(page)).toBe(true);
});

test('Ler QR: a câmera desliga ao esconder a aba e no pagehide', async ({ page, baseURL }) => {
  await preparar(page, baseURL);
  await simular(page);
  await camera(page); // câmera sem QR nenhum na frente
  await abrirLogado(page);
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
  await expect(page.locator('.mb-dica')).toContainText('Aponte a câmera');
  expect(await page.evaluate(() => window.__camera.faixas.some((t) => t.readyState === 'live'))).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.mb-leitor')).toBeHidden();
  expect(await faixasParadas(page)).toBe(true);
  await expect(resultado(page)).toContainText('A câmera foi desligada');
  // de novo, agora saindo da página
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }));
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
  await expect(page.locator('.mb-dica')).toContainText('Aponte a câmera');
  expect(await page.evaluate(() => window.__camera.pedidos)).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await faixasParadas(page)).toBe(true);
});

for (const [erro, trecho] of [
  ['NotAllowedError', 'A câmera está bloqueada para este site'],
  ['NotFoundError', 'Este aparelho não tem uma câmera disponível'],
  ['NotReadableError', 'A câmera está em uso por outro app']
]) {
  test(`Ler QR sem câmera (${erro}): explica e oferece o caminho alternativo`, async ({ page, baseURL }) => {
    await preparar(page, baseURL);
    const s = await simular(page, { rota: [emRota()] });
    await camera(page, { erro });
    await abrirLogado(page);
    await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
    const r = resultado(page);
    await expect(r).toHaveClass(/mb-res--erro/);
    await expect(r).toContainText(trecho);
    await expect(r).toContainText('câmera do celular');
    await expect(r).toContainText('lista Em rota');
    await expect(page.locator('.mb-leitor')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Ler QR da comanda' })).toBeVisible();
    // o plano B continua de pé
    await expect(page.locator('.mb-item').getByRole('button', { name: 'Entregue' })).toBeVisible();
    expect(s.c.confirmar).toEqual([]);
  });
}

test('sem script inline, sem handler inline e sem violação de CSP em nenhuma tela', async ({ page, baseURL, request }) => {
  const v = await preparar(page, baseURL);
  await simular(page, { rota: [emRota()] });
  await camera(page, { texto: 'https://mineirolanches.store/motoboy/#' + ID_C });
  const html = await (await request.get('/motoboy/')).text();
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
    ([, attrs, corpo]) => !/\bsrc=/.test(attrs) && corpo.trim()
  );
  expect(inline.length, 'script inline em motoboy/index.html').toBe(0);
  await page.goto('/motoboy/');
  const inlineNaPagina = () =>
    page.evaluate(() => ({
      scripts: document.querySelectorAll('script:not([src])').length,
      handlers: document.querySelectorAll('[onclick],[onerror],[onload],[onchange],[onsubmit],[oninput],[onfocus],[onkeydown]').length,
      javascript: document.querySelectorAll('[href^="javascript:" i]').length
    }));
  expect(await inlineNaPagina(), 'login').toEqual({ scripts: 0, handlers: 0, javascript: 0 });
  await entrar(page);
  await expect(page.locator('.mb-item')).toHaveCount(1);
  expect(await inlineNaPagina(), 'tela').toEqual({ scripts: 0, handlers: 0, javascript: 0 });
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click(); // carrega o chunk do jsQR sob a CSP
  await expect(resultado(page).getByText('Entregue', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await inlineNaPagina(), 'depois da leitura').toEqual({ scripts: 0, handlers: 0, javascript: 0 });
  await v.fechar();
  expect(v.csp, 'violações de CSP').toEqual([]);
  expect(v.erros, 'erros no console').toEqual([]);
});

test('390 px: sem rolagem horizontal e alvos de toque de pelo menos 48 px', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preparar(page, baseURL);
  await simular(page, {
    rota: [
      emRota({
        endereco: 'Rua Doutor Joaquim Francisco de Albuquerque Mello Neto Sobrinho Filho, 12345, Jardim Cidade Boa Vista, Suzano/SP',
        referencia: 'Em frente ao supermercado de esquina com o portão verde-escuro'
      }),
      emRota({ id: ID_B, numero: 12, cliente: { nome: 'Fulano de Tal da Silva Sauro Ferreira Albuquerque', telefone: '11900000001' } })
    ]
  });
  await camera(page); // câmera sem QR nenhum na frente
  const medir = async (tela, escopo, minimo) => {
    const r = await page.evaluate((esc) => {
      const raiz = document.querySelector(esc);
      const alvos = [...raiz.querySelectorAll('button, a[href], input')].filter(
        (el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
      );
      return {
        n: alvos.length,
        rolagem: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pequenos: alvos
          .map((el) => {
            const b = el.getBoundingClientRect();
            return { el: el.tagName + '.' + el.className, w: Math.round(b.width), h: Math.round(b.height) };
          })
          .filter((a) => a.w < 48 || a.h < 48)
      };
    }, escopo);
    expect(r.n, `${tela}: alvos encontrados`).toBeGreaterThan(0);
    expect(r.rolagem, `${tela}: rolagem horizontal`).toBeLessThanOrEqual(0);
    expect(r.pequenos, `${tela}: alvos menores que ${minimo} px`).toEqual([]);
  };
  await page.goto('/motoboy/');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await medir('login', '.pn-acesso', 48);
  await entrar(page);
  await expect(page.locator('.mb-item')).toHaveCount(2);
  await medir('tela', '.mb-app', 48);
  // a tela inteira usa 56 px ou mais nos botões
  const menores = await page.evaluate(() =>
    [...document.querySelectorAll('.mb-app button, .mb-app a[href]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getBoundingClientRect().height)
      .filter((h) => h < 55.5)
  );
  expect(menores, 'botões da tela com menos de 56 px de altura').toEqual([]);
  await page.getByRole('button', { name: 'Ler QR da comanda' }).click();
  await expect(page.locator('.mb-dica')).toContainText('Aponte a câmera');
  await medir('leitor aberto', '.mb-app', 48);
  await page.getByRole('button', { name: 'Fechar câmera' }).click();
  await page.evaluate((id) => (location.hash = '#' + id), ID_A);
  await expect(resultado(page).getByText('Entregue', { exact: true })).toBeVisible();
  await medir('resultado', '.mb-app', 48);
});

test('só cores dos tokens e nada de animação fora de transform/opacity na tela do entregador', async () => {
  const css = readFileSync(join(RAIZ, 'src/motoboy/motoboy.css'), 'utf8');
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g), 'cores hexadecimais soltas').toBeNull();
  expect(css.match(/\b(?:rgb|rgba|hsl|hsla)\(/g), 'cores funcionais soltas').toBeNull();
  const propriedades = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]).join('\n');
  expect(
    propriedades
      .replace(/\b(?:from|to|\d+%)\b/g, '')
      .match(/[a-z-]+(?=\s*:)/g)
      ?.filter((p) => !['transform', 'opacity'].includes(p)) ?? []
  ).toEqual([]);
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
});

test('painel da equipe continua igual: mesmo login e mesma tela Sem acesso', async ({ page }) => {
  // regressão do acesso.js: sem opções novas, o DOM e os textos de hoje (sem banco: equipe vazia)
  const s = await simular(page, { equipe: false, usuario: { id: '00000000-0000-4000-8000-000000000001', email: 'fora@teste.local' } });
  await page.goto('/painel/');
  const acesso = page.locator('.pn-acesso');
  await expect(acesso.getByRole('heading', { name: 'Painel de pedidos' })).toBeVisible();
  await expect(acesso.locator('.pn-acesso-sub')).toHaveText('Mineiro Lanche · acesso da equipe');
  await expect(acesso.locator('label')).toHaveText(['E-mail', 'Senha']);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Preencha o e-mail e a senha.' })).toBeVisible();
  await entrar(page, 'fora@teste.local', 'senha-errada');
  await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos.' })).toBeVisible();
  await entrar(page, 'fora@teste.local');
  const sem = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Sem acesso' }) });
  await expect(sem).toContainText(
    'O usuário fora@teste.local não está na equipe do painel. Peça ao responsável da loja para liberar este e-mail.'
  );
  expect(s.c.equipe).toBe(1);
  expect(s.c.motoboys).toBe(0);
  // a sessão do painel continua na chave de sempre
  const chaves = await page.evaluate(() => Object.keys(localStorage));
  expect(chaves.some((k) => k.startsWith('mineiro:v2:sessao'))).toBe(true);
  expect(chaves.some((k) => k.startsWith('mineiro:v2:moto'))).toBe(false);
  expect(s.c.naoSimuladas).toEqual([]);
});

test('atualização automática sem mudanças mantém o foco no pedido do entregador', async ({ page, baseURL }) => {
  await page.clock.install();
  await preparar(page, baseURL);
  await simular(page, { rota: [emRota()] });
  await abrirLogado(page);
  const sincronizar = page.getByRole('button', { name: 'Sincronizar agora' });
  await expect(sincronizar).toHaveAttribute('aria-busy', 'false');
  const entregar = page.locator('.mb-item').getByRole('button', { name: 'Entregue', exact: true });
  await entregar.focus();
  await expect(entregar).toBeFocused();
  await page.clock.fastForward(11_000);
  await expect(sincronizar).toHaveAttribute('aria-busy', 'false');
  await expect(entregar).toBeFocused();
});
