// Fluxo completo com o Supabase local e dois aparelhos ao mesmo tempo: celular do cliente e computador do painel.
// Antes de tudo recria o banco local (iniciar.sh --reset + supabase/setup.sql), põe a equipe e deixa a loja aberta.
// Não há Realtime local: tudo chega pelo plano B (painel consulta a cada 5 s, acompanhamento a cada 10 s).
// Uso: npx playwright test --project=e2e
/* global window, localStorage, location */
import { test, expect, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const PG = 'postgresql://postgres@localhost:54322/postgres';
const API = 'http://localhost:54321';
const EQUIPE = 'equipe@teste.local';
const FORA = 'fora@teste.local';
const CELULAR = { ...devices['Pixel 7'] };
const COMPUTADOR = { viewport: { width: 1280, height: 800 } };
const RE_TOKEN = /#pedido\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const psql = (sql) => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

// erros de console e de página. Sem Realtime local, o WebSocket do supabase-js falha e tenta de novo:
// esse erro é do ambiente de teste (em produção o canal conecta), então fica de fora.
function vigiar(page, nome, erros) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket connection to '[^']*\/realtime\/v1\//.test(m.text())) erros.push(`${nome}: ${m.text()}`);
  });
  page.on('pageerror', (e) => erros.push(`${nome}: ${e.message}`));
}

// pedido feito por um cliente (anon) direto na API, sem passar pelo cardápio
async function criarPedidoApi(nome, telefone) {
  const r = await fetch(API + '/rest/v1/rpc/criar_pedido', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'sb_publishable_local' },
    body: JSON.stringify({
      p: { cliente: { nome, telefone }, modo: 'retirada', origem: 'cardapio', itens: [{ produtoId: 'x-burguer', qtd: 1 }] }
    })
  });
  if (!r.ok) throw new Error('criar_pedido: ' + r.status + ' ' + (await r.text()));
  return r.json();
}
// a linha crua da tabela pedidos, como o Realtime manda nos eventos
const linhaDoPedido = (id) => JSON.parse(psql(`select to_jsonb(p) from pedidos p where id = '${id}'`));

// Realtime de mentira (page.routeWebSocket): responde ao join como o servidor e deixa o teste mandar
// eventos de postgres_changes. Guarda os joins e os access_token que o cliente mandou.
async function realtimeFalso(page) {
  const rt = { joins: [], tokens: [], ws: null, canal: null };
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    rt.ws = ws;
    ws.onMessage((txt) => {
      const m = JSON.parse(String(txt));
      const responder = (resposta) =>
        ws.send(
          JSON.stringify({
            topic: m.topic,
            event: 'phx_reply',
            ref: m.ref,
            join_ref: m.join_ref,
            payload: { status: 'ok', response: resposta }
          })
        );
      if (m.event === 'phx_join') {
        rt.joins.push(m);
        const pg = (m.payload.config && m.payload.config.postgres_changes) || [];
        const comId = pg.map((f, i) => Object.assign({}, f, { id: i + 1 }));
        if (/mineiro-painel/.test(m.topic)) rt.canal = { topic: m.topic, ids: Object.fromEntries(comId.map((f) => [f.table, f.id])) };
        responder({ postgres_changes: comId });
      } else if (m.event === 'access_token') rt.tokens.push(m.payload.access_token);
      else if (m.event === 'heartbeat' || m.event === 'phx_leave') responder({});
    });
  });
  return rt;
}
function enviarMudanca(rt, tabela, tipo, linha) {
  rt.ws.send(
    JSON.stringify({
      topic: rt.canal.topic,
      event: 'postgres_changes',
      ref: null,
      payload: {
        ids: [rt.canal.ids[tabela]],
        data: {
          schema: 'public',
          table: tabela,
          commit_timestamp: new Date().toISOString(),
          type: tipo,
          columns: [],
          record: linha,
          old_record: {},
          errors: null
        }
      }
    })
  );
}

async function entrarNoPainel(page, email) {
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('qualquer-senha');
  await page.getByRole('button', { name: 'Entrar' }).click();
}

// cardápio → ficha → sacola → checkout preenchido (sem enviar)
async function montarPedido(page, { produto, nome, telefone, escolhas, local }) {
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
  await page.locator(`#prod-${produto}`).click();
  const ficha = page.locator('#ficha');
  await expect(ficha).toBeVisible();
  if (escolhas) await escolhas(ficha);
  await page.locator('#ficha-add').click();
  await expect(ficha).toBeHidden();
  await page.locator('#barra .btn').click();
  await expect(page.locator('[data-screen="sacola"]')).toBeVisible();
  await page.locator('#btn-continuar').click();
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
  if (local) await page.locator('[data-modo="local"]').click();
  await page.locator('#f-nome').fill(nome);
  await page.locator('#f-tel').fill(telefone);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  execFileSync('bash', ['scripts/supabase-local/iniciar.sh', '--reset'], { cwd: RAIZ, stdio: 'pipe' });
  execFileSync('psql', [PG, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/setup.sql'], { cwd: RAIZ, stdio: 'pipe' });
  psql(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000002', '${FORA}') on conflict do nothing;
        insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = '${EQUIPE}' on conflict do nothing;
        update loja set modo = 'aberta' where id = 1;
        notify pgrst, 'reload schema';`);
  // o PostgREST recarrega o schema em segundo plano: espera a API responder
  for (let i = 0; i < 100; i++) {
    const r = await fetch(API + '/rest/v1/rpc/estado_cardapio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).catch(() => null);
    if (r && r.ok) return;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  throw new Error('a API local não respondeu depois do reset');
});

test('painel: sem login só aparece o login; e-mail inexistente dá erro; fora da equipe vê "Sem acesso"', async ({ browser }) => {
  const ctx = await browser.newContext(COMPUTADOR);
  const page = await ctx.newPage();
  await page.goto('/painel/');
  await expect(page.getByRole('heading', { name: 'Painel de pedidos' })).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.locator('#view-painel')).toBeHidden();
  await expect(page.locator('.pn-app')).toHaveCount(0);

  // sem preencher
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Preencha o e-mail e a senha.');

  // e-mail que não existe
  await page.getByLabel('E-mail').fill('ninguem@teste.local');
  await page.getByLabel('Senha').fill('errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
  await expect(page.locator('.pn-app')).toHaveCount(0);

  // logado, mas fora da equipe
  await page.getByLabel('E-mail').fill(FORA);
  await page.getByLabel('Senha').fill('qualquer');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sem acesso' })).toBeVisible();
  await expect(page.getByText(FORA)).toBeVisible();
  await expect(page.locator('.pn-app')).toHaveCount(0);

  // a sessão fica guardada: recarregar continua em "Sem acesso"; Sair volta ao login
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sem acesso' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await ctx.close();
});

test('pedido pelo QR da mesa 3 chega ao painel com os selos, e o status volta ao celular', async ({ browser }) => {
  test.setTimeout(120_000);
  const erros = [];
  const pc = await browser.newContext(COMPUTADOR);
  const cel = await browser.newContext(CELULAR);
  const painel = await pc.newPage();
  const celular = await cel.newPage();
  vigiar(painel, 'painel', erros);
  vigiar(celular, 'celular', erros);

  // painel logado e aberto antes do pedido (sessão persistente: recarregar não pede login de novo)
  await entrarNoPainel(painel, EQUIPE);
  await expect(painel.locator('.pn-desktop')).toBeVisible();
  await expect(painel.locator('.pn-vazio[data-vazio]')).toBeVisible();
  await expect(painel.locator('[data-act="simular"]')).toBeVisible(); // VITE_DEMO=1 no .env.development
  await painel.reload();
  await expect(painel.locator('.pn-desktop')).toBeVisible();
  await expect(painel.getByLabel('E-mail')).toHaveCount(0);
  await expect(painel.locator('.pn-lado .pn-sessao-u')).toHaveText(EQUIPE);

  // celular pelo QR da mesa 3: abre direto no cardápio
  await celular.goto('/?origem=qrcode&mesa=3');
  await montarPedido(celular, {
    produto: 'gran-bacon-onion',
    nome: 'Ana Teste',
    telefone: '(11) 98572-0150',
    escolhas: async (ficha) => {
      await ficha.getByRole('button', { name: 'Tirar algum item' }).click();
      await ficha.locator('[data-ing="Cebola roxa"]').click();
      await ficha.locator('[data-prensado="1"]').click();
      await ficha.locator('[data-combo]').click();
      await ficha.locator('#f-refri').fill('Guaraná');
      await ficha.locator('[data-adic="bacon"][data-d="1"]').click();
      await expect(celular.locator('#ficha-total')).toHaveText('R$ 57,30');
    }
  });
  // mesa do QR já marcada; aviso de privacidade (LGPD) visível
  await expect(celular.locator('[data-modo="local"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(celular.locator('[data-modo="local"] strong')).toHaveText('Comer no local · Mesa 3');
  await expect(celular.getByText('Usamos seus dados só para preparar e entregar este pedido.')).toBeVisible();
  const totalCheckout = (await celular.locator('[data-screen="checkout"] .resumo .total [data-total]').textContent()).trim();
  expect(totalCheckout).toBe('R$ 57,30');

  // envio com a resposta atrasada: o botão fica travado em "enviando"
  await celular.route('**/rest/v1/rpc/criar_pedido', async (r) => {
    await new Promise((ok) => setTimeout(ok, 700));
    await r.continue();
  });
  await celular.locator('#btn-enviar').click();
  await expect(celular.locator('#btn-enviar')).toHaveAttribute('aria-disabled', 'true');
  await expect(celular.locator('#btn-enviar')).toContainText('Enviando');
  await expect(celular.locator('[data-screen="pedido"]')).toBeVisible();
  await celular.unroute('**/rest/v1/rpc/criar_pedido');
  await expect(celular).toHaveURL(RE_TOKEN);

  // número e total exibidos = os do servidor
  const [numero, total, origem, mesa, modo] = psql(
    "select numero, total, origem, mesa, modo from pedidos where cliente_nome = 'Ana Teste' order by criado_em desc limit 1"
  ).split('|');
  expect([origem, mesa, modo]).toEqual(['qrcode', '3', 'local']);
  expect(Number(total)).toBe(57.3);
  await expect(celular.locator('#ped-num')).toHaveText('#' + numero.padStart(4, '0'));
  await expect(celular.locator('#ped-total')).toHaveText(brl(total));
  expect(totalCheckout).toBe(brl(total));
  // sacola vazia depois do envio; o pedido fica em "Meus pedidos" deste aparelho
  await expect(celular.locator('[data-contador]').first()).toBeHidden();
  expect(await celular.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:meus')).length)).toBe(1);

  // painel: o card chega (plano B de 5 s) com os selos
  const card = painel.locator('.pn-col--novos .pn-card', { hasText: 'Ana Teste' });
  await expect(card).toBeVisible({ timeout: 8_000 });
  await expect(card.locator('.pn-num')).toHaveText('#' + numero.padStart(4, '0'));
  await expect(card.locator('.pn-tag--qr')).toHaveText('QR');
  await expect(card.locator('.pn-tag--mesa')).toHaveText('Mesa 3');
  await expect(card.locator('.pn-selo--prensado')).toHaveText('Prensado');
  await expect(card.locator('.pn-selo--combo')).toHaveText('Combo + Guaraná');
  await expect(card.locator('.pn-selo--sem')).toHaveText('Sem: Cebola roxa');
  await expect(card.locator('.pn-selo--mais')).toHaveText('Bacon');
  await expect(card.locator('.pn-total')).toHaveText(brl(total));
  await expect(painel.locator('.pn-toast', { hasText: 'Novo pedido #' + numero.padStart(4, '0') })).toBeVisible();

  // relatório: pedidos por origem
  await painel.locator('[data-nav="relatorio"]').click();
  await expect(painel.locator('[aria-label="Pedidos por origem"]')).toContainText('QR code do truck');
  await painel.locator('[data-nav="pedidos"]').click();

  // avança no painel → o celular vê "Na chapa" / "Em preparo" (acompanhamento a cada 10 s)
  await card.getByRole('button', { name: 'Aceitar e preparar' }).click();
  await expect(painel.locator('.pn-col--preparo .pn-card', { hasText: 'Ana Teste' })).toBeVisible();
  await expect.poll(() => psql(`select status from pedidos where numero = ${numero}`)).toBe('preparo');
  await expect(celular.locator('.passo.atual')).toContainText('Na chapa', { timeout: 15_000 });
  await expect(celular.locator('#ped-status')).toHaveText('Status do pedido: Em preparo');
  await expect(celular.locator('#ped-msg')).toHaveText('Seu lanche está na chapa');

  // o link do pedido pode ser aberto em outro aparelho (sem "Meus pedidos")
  const link = celular.url();
  const outro = await browser.newContext(CELULAR);
  const outraPagina = await outro.newPage();
  vigiar(outraPagina, 'link', erros);
  await outraPagina.goto(link);
  await expect(outraPagina.locator('#ped-num')).toHaveText('#' + numero.padStart(4, '0'));
  await expect(outraPagina.locator('.passo.atual')).toContainText('Na chapa');
  await expect(outraPagina.locator('#ped-total')).toHaveText(brl(total));
  await expect(outraPagina.locator('#ped-itens .tag.combo')).toContainText('Guaraná');
  await outro.close();

  // sair do painel volta ao login
  await painel.getByRole('button', { name: 'Sair' }).click();
  await expect(painel.getByLabel('E-mail')).toBeVisible();
  await expect(painel.locator('.pn-app')).toHaveCount(0);

  expect(erros, 'erros no console').toEqual([]);
  await pc.close();
  await cel.close();
});

test('esgotar no painel aparece no cardápio do celular', async ({ browser }) => {
  const erros = [];
  const pc = await browser.newContext(COMPUTADOR);
  const cel = await browser.newContext(CELULAR);
  const painel = await pc.newPage();
  const celular = await cel.newPage();
  vigiar(painel, 'painel', erros);
  vigiar(celular, 'celular', erros);

  await celular.goto('/#cardapio');
  await expect(celular.locator('#prod-gran-crispy')).not.toHaveClass(/esgotado/);

  await entrarNoPainel(painel, EQUIPE);
  await painel.locator('[data-nav="cardapio"]').click();
  const chave = painel.locator('[data-act="esgotar"][data-id="gran-crispy"]');
  await chave.click();
  await expect(chave).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => psql("select esgotado_dia is not null from produtos where id = 'gran-crispy'")).toBe('t');

  // sem Realtime: chega pelo plano B (60 s) ou ao recarregar / voltar para a aba
  await celular.reload();
  const item = celular.locator('#prod-gran-crispy');
  await expect(item).toHaveClass(/esgotado/);
  await expect(item.locator('.selo-esgotado')).toHaveText('Esgotado hoje');
  await item.click();
  await expect(celular.locator('#ficha-add')).toHaveAttribute('aria-disabled', 'true');
  await expect(celular.locator('#ficha-add-txt')).toHaveText('Esgotado hoje');
  await celular.locator('[data-fechar-ficha]').first().click();

  // libera de novo: o celular volta a ver o item disponível
  await chave.click();
  await expect(chave).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => psql("select esgotado_dia is null from produtos where id = 'gran-crispy'")).toBe('t');
  await celular.reload();
  await expect(celular.locator('#prod-gran-crispy')).not.toHaveClass(/esgotado/);

  expect(erros, 'erros no console').toEqual([]);
  await pc.close();
  await cel.close();
});

test('servidor fora do ar: o checkout oferece o WhatsApp com o pedido e a sacola continua', async ({ browser }) => {
  const cel = await browser.newContext(CELULAR);
  const celular = await cel.newPage();
  await celular.goto('/#cardapio');
  await montarPedido(celular, { produto: 'x-burguer', nome: 'Bruno Teste', telefone: '11 91234-5678', local: true });
  await celular.locator('#f-obs').fill('sem pressa');

  await celular.route('**/rest/v1/rpc/criar_pedido', (r) => r.abort('internetdisconnected'));
  await celular.locator('#btn-enviar').click();
  const erro = celular.locator('#envio-erro');
  await expect(erro).toBeVisible();
  await expect(erro).toContainText('Não conseguimos falar com o truck');
  const wa = celular.getByRole('link', { name: 'Enviar pelo WhatsApp' });
  await expect(wa).toBeVisible();
  const href = await wa.getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/5511985720150\?text=/);
  const msg = decodeURIComponent(href.split('?text=')[1]);
  expect(msg).toContain('1× X-Burguer — R$ 16,90');
  expect(msg).toContain('Nome: Bruno Teste');
  expect(msg).toContain('Observação: sem pressa');
  expect(msg).toContain('Total: R$ 16,90');
  // nada se perdeu: botão destravado, formulário preenchido, sacola guardada
  await expect(celular.locator('#btn-enviar')).toHaveAttribute('aria-disabled', 'false');
  await expect(celular.locator('#f-nome')).toHaveValue('Bruno Teste');
  await expect(celular.locator('[data-screen="checkout"]')).toBeVisible();
  expect(await celular.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:sacola')).length)).toBe(1);
  expect(psql("select count(*) from pedidos where cliente_nome = 'Bruno Teste'")).toBe('0');

  // o pedido chega ao servidor, mas a resposta se perde: "Tentar de novo" usa o mesmo uuid e não duplica
  await celular.unroute('**/rest/v1/rpc/criar_pedido');
  await celular.route('**/rest/v1/rpc/criar_pedido', async (r) => {
    await r.fetch();
    await r.abort('connectionreset');
  });
  await celular.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(erro).toBeVisible();
  await expect.poll(() => psql("select count(*) from pedidos where cliente_nome = 'Bruno Teste'")).toBe('1');
  await celular.unroute('**/rest/v1/rpc/criar_pedido');
  await celular.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(celular.locator('[data-screen="pedido"]')).toBeVisible();
  const numero = psql("select numero from pedidos where cliente_nome = 'Bruno Teste'");
  await expect(celular.locator('#ped-num')).toHaveText('#' + numero.padStart(4, '0'));
  expect(psql("select count(*) from pedidos where cliente_nome = 'Bruno Teste'")).toBe('1');
  await cel.close();
});

test('item que esgotou depois de entrar na sacola e loja fechada: o servidor recusa e o checkout explica', async ({ browser }) => {
  const cel = await browser.newContext(CELULAR);
  const celular = await cel.newPage();
  await celular.goto('/#cardapio');
  await montarPedido(celular, { produto: 'gran-chicken', nome: 'Diego Teste', telefone: '11933332222', local: true });

  // esgota no banco sem o celular saber (sem Realtime e antes da consulta de 60 s)
  psql("update produtos set esgotado_dia = dia_operacional() where id = 'gran-chicken'");
  await celular.locator('#btn-enviar').click();
  const erro = celular.locator('#envio-erro');
  await expect(erro).toContainText('Um item da sacola esgotou');
  await expect(erro).toContainText('Gran Chicken acabou de esgotar hoje');
  await expect(celular.getByRole('button', { name: 'Tentar de novo' })).toBeHidden();
  await expect(celular.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toBeVisible();
  await celular.getByRole('button', { name: 'Ajustar a sacola' }).click();
  const linha = celular.locator('#sacola-linhas .linha');
  await expect(linha).toHaveClass(/esgotado/);
  await expect(linha.locator('.tag.esgotado')).toHaveText('Esgotado hoje');
  expect(psql("select count(*) from pedidos where cliente_nome = 'Diego Teste'")).toBe('0');

  // troca por outro item e tenta com a loja fechada pelo painel
  psql("update produtos set esgotado_dia = null where id = 'gran-chicken'; update loja set modo = 'fechada' where id = 1");
  await celular.reload();
  await expect(celular.locator('#sacola-linhas .linha')).not.toHaveClass(/esgotado/);
  await celular.locator('#btn-continuar').click();
  await expect(celular.locator('#f-nome')).toHaveValue('Diego Teste'); // rascunho do checkout guardado
  await expect(celular.locator('#aviso-fechado')).toContainText('Fechado agora');
  await celular.locator('#btn-enviar').click();
  await expect(erro).toContainText('O truck não está recebendo pedidos agora');
  await expect(erro).toContainText('o truck pausou os pedidos');
  await expect(celular.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toBeVisible();
  psql("update loja set modo = 'aberta' where id = 1");
  expect(psql("select count(*) from pedidos where cliente_nome = 'Diego Teste'")).toBe('0');
  await cel.close();
});

test('painel: simular pedido de exemplo, apagar os exemplos e sessão expirada volta ao login', async ({ browser }) => {
  const erros = [];
  const pc = await browser.newContext(COMPUTADOR);
  const painel = await pc.newPage();
  vigiar(painel, 'painel', erros);
  await entrarNoPainel(painel, EQUIPE);
  await expect(painel.locator('.pn-desktop')).toBeVisible();

  // demonstração (VITE_DEMO=1): o pedido de exemplo é gravado pela RPC com origem 'exemplo'
  const antes = Number(psql("select count(*) from pedidos where origem = 'exemplo'"));
  await painel.getByRole('button', { name: 'Simular pedido' }).click();
  await expect(painel.locator('.pn-col--novos .pn-card', { hasText: '(exemplo)' })).toBeVisible();
  await expect.poll(() => Number(psql("select count(*) from pedidos where origem = 'exemplo'"))).toBe(antes + 1);

  await painel.locator('[data-nav="config"]').click();
  await painel.getByRole('button', { name: 'Apagar todos os pedidos de teste' }).click();
  await expect(painel.locator('[data-confirma-t]')).toContainText('pedido de exemplo');
  await painel.getByRole('button', { name: 'Apagar tudo' }).click();
  await expect.poll(() => psql("select count(*) from pedidos where origem = 'exemplo'")).toBe('0');
  expect(Number(psql("select count(*) from pedidos where origem <> 'exemplo'"))).toBeGreaterThan(0); // pedidos de clientes ficam
  await painel.locator('[data-nav="pedidos"]').click();
  await expect(painel.locator('.pn-card', { hasText: '(exemplo)' })).toHaveCount(0);
  expect(erros, 'erros no console').toEqual([]);

  // comanda aberta (nome, telefone, endereço) quando a sessão cai: não pode ficar por cima do login
  await painel.locator('.pn-card [data-act="imprimir"]').first().click();
  await expect(painel.locator('.pn-modal')).toBeVisible();

  // o servidor passa a recusar o token e a renovação falha: o painel volta para o login
  await painel.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }) })
  );
  await painel.route('**/auth/v1/token?grant_type=refresh_token', (r) =>
    r.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
    })
  );
  await expect(painel.getByText('Sua sessão expirou. Entre de novo para continuar.')).toBeVisible({ timeout: 12_000 });
  await expect(painel.locator('#view-painel')).toBeHidden();
  await expect(painel.locator('.pn-modal'), 'comanda fechada junto com o quadro').toHaveCount(0);
  await expect(painel.locator('.pn-toast')).toHaveCount(0);
  await painel.unroute('**/rest/v1/**');
  await painel.unroute('**/auth/v1/token?grant_type=refresh_token');
  await painel.getByLabel('E-mail').fill(EQUIPE);
  await painel.getByLabel('Senha').fill('outra');
  await painel.getByRole('button', { name: 'Entrar' }).click();
  await expect(painel.locator('.pn-desktop')).toBeVisible();
  await expect(painel.locator('.pn-card').first()).toBeVisible();
  await pc.close();
});

test('preço adulterado no navegador: vale o total do servidor', async ({ browser }) => {
  const cel = await browser.newContext(CELULAR);
  const celular = await cel.newPage();
  await celular.goto('/#cardapio');
  // espera o estado do cardápio chegar (senão ele reaplicaria o preço do banco por cima da adulteração)
  await expect.poll(() => celular.evaluate(() => window.ML.store.loja().modo)).toBe('aberta');
  await celular.evaluate(() => {
    window.ML.produtos['gran-burger'].preco = 1;
  });
  await montarPedido(celular, { produto: 'gran-burger', nome: 'Carla Teste', telefone: '11955554444', local: true });
  await expect(celular.locator('[data-screen="checkout"] .resumo .total [data-total]')).toHaveText('R$ 1,00');
  await celular.locator('#btn-enviar').click();
  await expect(celular.locator('[data-screen="pedido"]')).toBeVisible();
  const total = psql("select total from pedidos where cliente_nome = 'Carla Teste'");
  expect(Number(total)).toBe(25.9);
  await expect(celular.locator('#ped-total')).toHaveText('R$ 25,90');
  // pedido enviado: nome, telefone e endereço não ficam guardados no aparelho (só o modo escolhido)
  expect(await celular.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:rascunho')))).toEqual({ modo: 'local' });
  await celular.goto('about:blank');
  await celular.goto('/#cardapio');
  await celular.locator('#prod-x-burguer').click();
  await celular.locator('#ficha-add').click();
  await celular.locator('#barra .btn').click();
  await celular.locator('#btn-continuar').click();
  await expect(celular.locator('[data-screen="checkout"]')).toBeVisible();
  await expect(celular.locator('#f-nome')).toHaveValue('');
  await expect(celular.locator('#f-tel')).toHaveValue('');
  await expect(celular.locator('[data-modo="local"]')).toHaveAttribute('aria-pressed', 'true');
  await cel.close();
});

test('sem pedido guardado, #pedido leva ao cardápio; token inexistente avisa', async ({ page }) => {
  await page.goto('/#pedido');
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
  await page.goto('about:blank');
  await page.goto('/#pedido/00000000-0000-4000-8000-00000000abcd');
  await expect(page.locator('#ped-msg')).toHaveText('Pedido não encontrado. Confira o link ou faça um pedido novo.');
  expect(await page.evaluate(() => location.hash)).toBe('#pedido/00000000-0000-4000-8000-00000000abcd');
});

test('painel: o canal Realtime entra com o JWT da equipe e a consulta periódica não desfaz o que chegou depois', async ({ browser }) => {
  const erros = [];
  const pc = await browser.newContext(COMPUTADOR);
  const painel = await pc.newPage();
  vigiar(painel, 'painel', erros);
  const rt = await realtimeFalso(painel);
  const a = await criarPedidoApi('Rita Realtime', '11977770001');
  await entrarNoPainel(painel, EQUIPE);
  await expect(painel.locator('.pn-col--novos .pn-card', { hasText: 'Rita Realtime' })).toBeVisible();

  // o phx_join do canal do painel leva o JWT da sessão: sem ele o Realtime usa a apikey (anon) e o RLS de
  // pedidos barra todos os eventos, com o canal SUBSCRIBED (o painel passaria a consultar só a cada 60 s)
  await expect.poll(() => rt.canal).toBeTruthy();
  const join = rt.joins.find((j) => j.topic === rt.canal.topic);
  const token = await painel.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:sessao')).access_token);
  expect(join.payload.access_token, 'access_token no phx_join').toBe(token);

  // eventos da store a partir daqui (pedido novo, status, pedidos que somem)
  await painel.evaluate(() => {
    window.__ev = [];
    window.ML.store.ouvir((e) => window.__ev.push([e.tipo, (e.dados && e.dados.id) || null, (e.dados && e.dados.status) || null]));
  });
  // a consulta periódica tira a foto do banco e a resposta demora; enquanto isso um pedido chega pelo Realtime
  // e o painel aceita outro (RPC). A foto velha não pode tirar o pedido novo do quadro nem voltar o status.
  let soltar;
  const segura = new Promise((ok) => (soltar = ok));
  let fotos = 0;
  await painel.route(/\/rest\/v1\/pedidos\?/, async (route) => {
    const resposta = await route.fetch();
    fotos++;
    await segura;
    await route.fulfill({ response: resposta });
  });
  const recarga = painel.evaluate(() => window.ML.store.recarregar());
  await expect.poll(() => fotos).toBeGreaterThan(0);

  const b = await criarPedidoApi('Beto Realtime', '11977770002');
  enviarMudanca(rt, 'pedidos', 'INSERT', linhaDoPedido(b.id));
  await expect(painel.locator('.pn-col--novos .pn-card', { hasText: 'Beto Realtime' })).toBeVisible();
  const respostaRpc = painel.waitForResponse(/\/rest\/v1\/rpc\/mudar_status/);
  await painel.locator('.pn-col--novos .pn-card', { hasText: 'Rita Realtime' }).getByRole('button', { name: 'Aceitar e preparar' }).click();
  await respostaRpc;
  await expect.poll(() => psql(`select status from pedidos where id = '${a.id}'`)).toBe('preparo');
  await painel.waitForTimeout(300); // a resposta da RPC é aplicada antes de a foto velha chegar

  soltar();
  await recarga;
  await painel.evaluate(() => window.ML.store.recarregar()); // garante que a foto velha já foi aplicada
  await painel.unroute(/\/rest\/v1\/pedidos\?/);
  await expect(painel.locator('.pn-col--preparo .pn-card', { hasText: 'Rita Realtime' })).toBeVisible();
  await expect(painel.locator('.pn-col--novos .pn-card', { hasText: 'Beto Realtime' })).toBeVisible();
  // e uma consulta nova (com o pedido novo) não o anuncia de novo
  await painel.evaluate(() => window.ML.store.recarregar());
  const ev = await painel.evaluate(() => window.__ev);
  expect(
    ev.filter((e) => e[0] === 'pedidos:limpos'),
    'nenhum pedido sumiu do quadro'
  ).toEqual([]);
  expect(ev.filter((e) => e[0] === 'pedido:novo' && e[1] === b.id).length, 'pedido novo anunciado uma vez só (um som)').toBe(1);
  expect(
    ev.filter((e) => e[0] === 'pedido:status' && e[1] === a.id).map((e) => e[2]),
    'o status não volta'
  ).toEqual(['preparo']);

  // uma mudança feita em outro aparelho chega pelo Realtime; um eco atrasado (versão mais velha) não a desfaz
  const antes = linhaDoPedido(b.id);
  psql(
    `update pedidos set status = 'preparo', historico = historico || jsonb_build_array(jsonb_build_object('status', 'preparo', 'em', now())) where id = '${b.id}'`
  );
  enviarMudanca(rt, 'pedidos', 'UPDATE', linhaDoPedido(b.id));
  await expect(painel.locator('.pn-col--preparo .pn-card', { hasText: 'Beto Realtime' })).toBeVisible();
  enviarMudanca(rt, 'pedidos', 'UPDATE', antes);
  await painel.waitForTimeout(300);
  await expect(painel.locator('.pn-col--preparo .pn-card', { hasText: 'Beto Realtime' })).toBeVisible();

  expect(erros, 'erros no console').toEqual([]);
  await pc.close();
});

test('painel: login de novo depois de uma sessão recusada logo na primeira carga abre o quadro', async ({ browser }) => {
  const pc = await browser.newContext(COMPUTADOR);
  const painel = await pc.newPage();
  // o servidor recusa o token ao ler os pedidos e a renovação falha: volta ao login antes de montar o quadro
  await painel.route(/\/rest\/v1\/pedidos\?/, (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }) })
  );
  await painel.route('**/auth/v1/token?grant_type=refresh_token', (r) =>
    r.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
    })
  );
  await entrarNoPainel(painel, EQUIPE);
  await expect(painel.getByText('Sua sessão expirou. Entre de novo para continuar.')).toBeVisible({ timeout: 12_000 });
  await painel.unroute(/\/rest\/v1\/pedidos\?/);
  await painel.unroute('**/auth/v1/token?grant_type=refresh_token');
  await painel.getByLabel('E-mail').fill(EQUIPE);
  await painel.getByLabel('Senha').fill('outra');
  await painel.getByRole('button', { name: 'Entrar' }).click();
  await expect(painel.locator('.pn-desktop')).toBeVisible({ timeout: 10_000 });
  await expect(painel.getByText('Carregando os pedidos…')).toBeHidden();
  await pc.close();
});

test('painel: Sair sem rede (ou com o servidor de login fora) apaga a sessão do aparelho', async ({ browser }) => {
  for (const falha of ['rede', '503']) {
    const pc = await browser.newContext(COMPUTADOR);
    const painel = await pc.newPage();
    await entrarNoPainel(painel, EQUIPE);
    await expect(painel.locator('.pn-desktop')).toBeVisible();
    await painel.evaluate(() =>
      localStorage.setItem('mineiro:v2:rascunho', JSON.stringify({ nome: 'Cliente Anterior', tel: '11900000000' }))
    );
    await painel.route('**/auth/v1/logout**', (r) =>
      falha === 'rede' ? r.abort('internetdisconnected') : r.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    );
    await painel.locator('.pn-desktop [data-act="sair"]').click();
    await expect(painel.getByLabel('E-mail'), `login depois de sair (${falha})`).toBeVisible({ timeout: 10_000 });
    await expect(painel.locator('.pn-app')).toHaveCount(0);
    const guardado = await painel.evaluate(() => Object.keys(localStorage).filter((k) => /^mineiro:v2:(sessao|rascunho)/.test(k)));
    expect(guardado, `nada da sessão nem do rascunho fica no aparelho (${falha})`).toEqual([]);
    await pc.close();
  }
});
