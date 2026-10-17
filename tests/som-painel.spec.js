// Aviso sonoro de pedido novo no painel (cliente, 16/10/2026: "o som precisa ser mais alto para identificar o pedido"):
// três "ding-dong" em onda quadrada (1568 e 2093 Hz), no ganho máximo do navegador, com compressor; "Testar o som" em Configurações.
// O AudioContext é trocado por um gravador (o teste não depende de som de verdade). Quadro simulado por page.route.
// Também o contrário (17/10): pedido entregue em outro aparelho (o motoboy) ganha só um aviso discreto, sem som.
// Uso: npx playwright test tests/som-painel.spec.js --project=desktop   (precisa do Supabase local no ar)
/* global window */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';

// eslint-disable-next-line no-empty-pattern -- o Playwright exige o padrão de desestruturação no primeiro argumento
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'desktop', 'painel de computador: só no desktop'));
test.beforeAll(() => {
  try {
    execFileSync('psql', [PG, '-X', '-At', '-q', '-c', "insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = 'equipe@teste.local' on conflict do nothing"]);
  } catch {
    /* sem psql: o login mostraria "Sem acesso" e o teste diria isso */
  }
});

const linha = (n, em = new Date().toISOString()) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, numero: n, token: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  criado_em: em, origem: 'cardapio', mesa: null, cliente_nome: 'Cliente ' + n, cliente_telefone: '11985720150', modo: 'local', endereco: '', referencia: '', pagamento: null, troco: '', obs: '',
  itens: [{ produtoId: 'x-burguer', nome: 'X-Burguer', tipo: 'lanche', precoBase: 16.9, precoUnit: 16.9, qtd: 1, completo: true, removidos: [], prensado: false, combo: { ativo: false, refri: '' }, adicionais: [], sabor: '', resumo: 'Completo', subtotal: 16.9 }],
  total: 16.9, distancia_km: null, taxa_entrega: null, status: 'novo', historico: [{ status: 'novo', em }]
});

// grava o que o painel toca: cada oscilador (tipo, frequência, ganho máximo, início e fim) e o compressor
async function espiarAudio(page) {
  await page.addInitScript(() => {
    window.__som = { osc: [], compressor: 0 };
    class Falso {
      constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createDynamicsCompressor() { window.__som.compressor++; return { threshold: {}, ratio: {}, attack: {}, release: {}, connect() {} }; }
      createGain() {
        const reg = { pico: 0 };
        const gain = { value: 0, setValueAtTime(v) { reg.pico = Math.max(reg.pico, v); }, exponentialRampToValueAtTime(v) { reg.pico = Math.max(reg.pico, v); } };
        return { gain, connect() {}, __reg: reg };
      }
      createOscillator() {
        const o = { type: 'sine', frequency: { value: 0 }, connect(g) { o.__g = g; }, start(t) { o.__ini = t; }, stop(t) { o.__fim = t; window.__som.osc.push({ tipo: o.type, freq: o.frequency.value, pico: o.__g.__reg.pico, ini: o.__ini, fim: t }); } };
        return o;
      }
    }
    window.AudioContext = Falso;
    window.webkitAudioContext = Falso;
  });
}
async function entrar(page, dados) {
  await page.route('**/rest/v1/pedidos?*', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: dados.pedidos }) : r.fallback()));
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sem acesso' })).toHaveCount(0);
  await expect(page.locator('#view-painel .pn-app')).toBeAttached({ timeout: 25_000 });
  await page.waitForTimeout(600);
}
const resumo = async (page) => page.evaluate(() => {
  const o = window.__som.osc;
  return { n: o.length, tipos: [...new Set(o.map((x) => x.tipo))], freqs: [...new Set(o.map((x) => x.freq))].sort((a, b) => a - b), pico: Math.max(0, ...o.map((x) => x.pico)), dur: o.length ? Math.max(...o.map((x) => x.fim)) - Math.min(...o.map((x) => x.ini)) : 0, compressor: window.__som.compressor };
});

test('"Testar o som" toca o aviso alto: 3 ding-dong em onda quadrada, ganho 0,9 e compressor', async ({ page }) => {
  await espiarAudio(page);
  await entrar(page, { pedidos: [] });
  await page.locator('[data-nav="config"]').click();
  await page.getByRole('button', { name: 'Testar o som' }).click();
  const r = await resumo(page);
  expect(r.n).toBe(6);
  expect(r.tipos).toEqual(['square']);
  expect(r.freqs).toEqual([1568, 2093]);
  expect(r.pico).toBeGreaterThanOrEqual(0.9);
  expect(r.dur).toBeGreaterThan(1.7); // aviso longo o bastante para ser notado
  expect(r.compressor).toBe(1);
});

test('pedido novo toca o aviso alto; com o som desligado não toca', async ({ page }) => {
  await espiarAudio(page);
  const dados = { pedidos: [linha(21, new Date(Date.now() - 3600_000).toISOString())] };
  await entrar(page, dados);
  await page.locator('[data-nav="config"]').click(); // um clique: o navegador só libera o som depois
  expect((await resumo(page)).n).toBe(0);
  dados.pedidos = [...dados.pedidos, linha(22)];
  await page.evaluate(() => window.ML.store.recarregar());
  await expect.poll(async () => (await resumo(page)).n).toBe(6);
  const r = await resumo(page);
  expect(r.tipos).toEqual(['square']);
  expect(r.pico).toBeGreaterThanOrEqual(0.9);
  // som desligado: o terceiro pedido chega e nada toca
  await page.locator('[data-act="som"]').click(); // desliga (e não toca ao desligar)
  await page.locator('[data-nav="pedidos"]').click();
  dados.pedidos = [...dados.pedidos, linha(23)];
  await page.evaluate(() => window.ML.store.recarregar());
  await expect(page.locator('.pn-card[data-id$="23"]')).toBeVisible();
  expect((await resumo(page)).n).toBe(6);
});

test('pedido entregue em outro aparelho (o motoboy): aviso discreto e sem som; o que o próprio painel conclui não repete o aviso', async ({ page }) => {
  await espiarAudio(page);
  const hora = new Date(Date.now() - 1800_000).toISOString();
  const emRota = (n) => {
    const l = linha(n, hora);
    return Object.assign(l, { modo: 'entrega', endereco: 'Rua Teste, 1', status: 'rota', historico: ['novo', 'preparo', 'rota'].map((status) => ({ status, em: hora })) });
  };
  const dados = { pedidos: [emRota(31), emRota(32)] };
  // a RPC do avanço responde o pedido como o servidor (pedido_json) e a lista seguinte já vem com ele concluído
  await page.route('**/rest/v1/rpc/mudar_status', async (r) => {
    const { p_id: id, p_status: status } = r.request().postDataJSON();
    const i = dados.pedidos.findIndex((p) => p.id === id);
    const p = (dados.pedidos[i] = Object.assign({}, dados.pedidos[i], { status, historico: [...dados.pedidos[i].historico, { status, em: new Date().toISOString() }] }));
    await r.fulfill({ json: Object.assign({}, p, { criadoEm: p.criado_em, cliente: { nome: p.cliente_nome, telefone: p.cliente_telefone } }) });
  });
  await entrar(page, dados);
  await page.locator('[data-nav="config"]').click(); // um clique: o som ficaria liberado, e mesmo assim não toca
  await page.locator('[data-nav="pedidos"]').click();
  await expect(page.locator('.pn-col--saida .pn-card')).toHaveCount(2);

  // o motoboy confirma o #0031 (confirmar_entrega grava "por": "motoboy"): o cartão vai para Concluídos com o aviso
  const p31 = dados.pedidos[0];
  dados.pedidos[0] = Object.assign({}, p31, { status: 'entregue', historico: [...p31.historico, { status: 'entregue', em: new Date().toISOString(), por: 'motoboy' }] });
  await page.evaluate(() => window.ML.store.recarregar());
  await expect(page.locator('.pn-col--concluidos .pn-card[data-id$="31"]')).toBeVisible();
  const aviso = page.locator('.pn-toast', { hasText: '#0031 entregue pelo motoboy · Cliente 31' });
  await expect(aviso).toBeVisible();
  await expect(aviso).not.toHaveClass(/pn-toast--(novo|erro)/);
  expect((await resumo(page)).n, 'sem som').toBe(0);

  // a equipe conclui o #0032 aqui mesmo: só o aviso do avanço ("#0032: Entregue"), nenhum "entregue pelo"
  await page.locator('.pn-col--saida .pn-card[data-id$="32"]').getByRole('button', { name: 'Concluir' }).click();
  await expect(page.locator('.pn-col--concluidos .pn-card[data-id$="32"]')).toBeVisible();
  await page.evaluate(() => window.ML.store.recarregar());
  await page.waitForTimeout(400);
  await expect(page.locator('.pn-toast', { hasText: /#0032 entregue/ })).toHaveCount(0);
  expect((await resumo(page)).n, 'sem som').toBe(0);
});
