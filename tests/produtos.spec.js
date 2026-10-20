/* global window, document, localStorage */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { montarSeed, carregarCore } from '../scripts/gerar-seed.mjs';
const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const sql = (s) => execFileSync('psql', [PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
const equipe = '00000000-0000-4000-8000-000000000001';
const moto = '30000000-0000-4000-8000-000000000009';
const ids = new Set(),
  categoriasTeste = new Set();
let modo;
const gravar = (dados, versao = null) =>
  JSON.parse(
    sql(
      `begin;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);select salvar_produto('${JSON.stringify(dados).replaceAll("'", "''")}'::jsonb,${versao ? `'${versao}'` : 'null'});commit;`
    )
      .split('\n')
      .at(-1)
  );
const dadosProduto = () => ({
  id: 'produto-' + randomUUID(),
  nome: 'Vitrine autoteste',
  categoria: 'artesanais',
  preco: 12.34,
  tipo: 'lanche',
  foto: null,
  ingredientes: ['Queijo', 'Tomate'],
  ordem: 900,
  ativo: true,
  detalhes: { base: 'Pão de teste', nota: '', inclui: [], sabor: false, escolheRefri: false }
});
async function entrar(page) {
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.locator('[data-nav="cardapio"]:visible, [data-usuarios-ir="cardapio"]:visible').click();
  await expect(page.locator('.pn-produtos:visible').getByRole('button', { name: 'Novo produto', exact: true })).toBeEnabled();
}
test.beforeAll(() => {
  modo = sql('select modo from loja where id=1');
  sql(`insert into equipe(user_id,nome) values('${equipe}','Equipe teste') on conflict do nothing;
    insert into auth.users(id,email) values('${moto}','catalogo-motoboy@teste.local') on conflict do nothing;
    insert into motoboys(user_id,nome) values('${moto}','Motoboy catálogo') on conflict do nothing;
    update loja set modo='aberta';`);
});
test.afterEach(() => {
  for (const id of ids) sql(`delete from produtos_eventos where produto_id='${id}';delete from produtos where id='${id}';`);
  ids.clear();
  for (const id of categoriasTeste) sql(`delete from categorias_produtos where id='${id}';`);
  categoriasTeste.clear();
  sql("delete from pedidos where cliente_telefone='11955500111';delete from clientes where telefone='11955500111';");
});
test.afterAll(() => {
  sql(`delete from auth.users where id='${moto}';update loja set modo='${modo}';`);
});

test('equipe cadastra, edita e oculta produto; cliente compra pelo preço atual do servidor', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await entrar(page);
  const area = page.locator('.pn-produtos:visible');
  await area.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const form = area.locator('[data-p-form]');
  await form.getByLabel('Nome do produto', { exact: true }).fill('Vitrine autoteste');
  await form.getByRole('combobox', { name: 'Categoria', exact: true }).selectOption('artesanais');
  await form.getByLabel('Preço (R$)').fill('12.34');
  await form.getByLabel('Descrição / base').fill('Pão de teste');
  await form.getByLabel('Ingredientes (um por linha)').fill('Queijo\nTomate');
  await form.getByRole('button', { name: 'Salvar produto', exact: true }).click();
  await expect(area.locator('[data-p-aviso]')).toContainText('Produto salvo');
  const p = JSON.parse(sql("select to_jsonb(p)::text from produtos p where nome='Vitrine autoteste' order by atualizado_em desc limit 1"));
  ids.add(p.id);
  const card = area.locator(`[data-produto="${p.id}"]`);
  await expect(card).toContainText('R$ 12,34');
  await expect(card).toContainText('Artesanais');
  await page.screenshot({ path: test.info().outputPath('produtos-lista.png'), fullPage: false });
  const cliente = await context.newPage();
  await cliente.goto('/#cardapio/artesanais');
  await expect(cliente.locator(`[data-abrir="${p.id}"]`)).toContainText('Vitrine autoteste');
  await cliente.locator(`[data-abrir="${p.id}"]`).click();
  await expect(cliente.locator('#ficha')).toContainText('Queijo');
  await expect(cliente.locator('#ficha')).toContainText('Tomate');
  await expect(cliente.locator('#ficha-add')).toContainText('12,34');
  await cliente.locator('#ficha-add').click();
  await expect.poll(() => cliente.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:sacola') || '[]').length)).toBe(1);
  await cliente.goto('/#sacola');
  await expect(cliente.locator('#sacola-linhas')).toContainText('Vitrine autoteste');
  await cliente.reload();
  await expect(cliente.locator('#sacola-linhas')).toContainText('Vitrine autoteste');
  await cliente.goto('/#cardapio/artesanais');
  await card.getByRole('button', { name: 'Editar Vitrine autoteste', exact: true }).click();
  await form.getByLabel('Preço (R$)').fill('34.90');
  await form.getByRole('button', { name: 'Salvar produto', exact: true }).click();
  await expect(card).toContainText('R$ 34,90');
  await cliente.reload();
  await expect(cliente.locator(`[data-abrir="${p.id}"]`)).toContainText('R$ 34,90');
  const pedido = JSON.parse(
    sql(
      `select criar_pedido('${JSON.stringify({ cliente: { nome: 'Cliente catálogo', telefone: '11955500111' }, modo: 'local', itens: [{ produtoId: p.id, qtd: 1, precoUnit: 0.01 }], idempotencia: randomUUID() })}'::jsonb)`
    )
  );
  expect(pedido.total).toBe(34.9);
  await card.getByRole('switch').click();
  await expect(card).toContainText('Esgotado hoje');
  await cliente.reload();
  await expect(cliente.locator(`[data-abrir="${p.id}"]`)).toContainText('Esgotado hoje');
  await card.getByRole('switch').click();
  await expect(card).toContainText('Disponível');
  await card.getByRole('button', { name: 'Editar Vitrine autoteste', exact: true }).click();
  await form.getByLabel('Disponível no cardápio', { exact: true }).uncheck();
  await form.getByRole('button', { name: 'Salvar produto', exact: true }).click();
  await expect(card).toContainText('Oculto do cardápio');
  await cliente.reload();
  await expect.poll(() => cliente.evaluate((id) => window.ML.produtos[id]?.inativo, p.id)).toBe(true);
  await expect(cliente.locator(`[data-abrir="${p.id}"]`)).toHaveCount(0);
  expect(sql(`select count(*) from produtos_eventos where produto_id='${p.id}'`)).toBe('3');
  expect(sql(`select total from pedidos where id='${pedido.id}'`)).toBe('34.90');
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('foto é convertida e enviada; aparece no cardápio e na ficha após recarregar', async ({ page, context }) => {
  const p = gravar(dadosProduto());
  ids.add(p.id);
  const foto = readFileSync('public/assets/fotos/gran-egg-bacon-q.webp');
  let upload = '';
  // O Postgres local não possui Storage HTTP. Este teste exercita a conversão e o contrato do upload.
  await page.route('**/storage/v1/object/produtos-fotos/**', async (route) => {
    upload = route.request().url().split('/produtos-fotos/')[1];
    expect(route.request().postDataBuffer().toString()).toContain('Content-Type: image/webp');
    expect(route.request().postDataBuffer().byteLength).toBeGreaterThan(100);
    await route.fulfill({ status: 200, json: { Key: 'produtos-fotos/' + upload } });
  });
  await context.route('**/storage/v1/object/public/produtos-fotos/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: foto })
  );
  await entrar(page);
  const area = page.locator('.pn-produtos:visible');
  await area
    .locator(`[data-produto="${p.id}"]`)
    .getByRole('button', { name: /Editar/ })
    .click();
  const form = area.locator('[data-p-form]');
  await form.getByLabel('Foto do produto', { exact: false }).setInputFiles({ name: 'lanche.webp', mimeType: 'image/webp', buffer: foto });
  await form.getByRole('button', { name: 'Salvar produto', exact: true }).click();
  await expect(area.locator('[data-p-aviso]')).toContainText('Produto salvo');
  expect(upload).toMatch(/^uploads\/[a-f0-9-]{36}\.webp$/);
  expect(sql(`select foto from produtos where id='${p.id}'`)).toBe(upload);
  const cliente = await context.newPage();
  await cliente.goto('/#cardapio');
  const card = cliente.locator(`[data-abrir="${p.id}"]`);
  await expect(card.locator('img')).toHaveAttribute('src', new RegExp(upload));
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => card.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await card.click();
  await expect(cliente.locator('.ficha-foto img')).toHaveAttribute('src', new RegExp(upload));
});

test('conflito entre aparelhos preserva edição recente e o seed não sobrescreve produtos gerenciados', async ({ page }) => {
  const p = gravar(dadosProduto());
  ids.add(p.id);
  await entrar(page);
  const area = page.locator('.pn-produtos:visible');
  await area
    .locator(`[data-produto="${p.id}"]`)
    .getByRole('button', { name: /Editar/ })
    .click();
  const form = area.locator('[data-p-form]');
  await form.getByLabel('Preço (R$)').fill('22.00');
  gravar({ ...p, preco: 45 }, p.atualizado_em);
  await form.getByRole('button', { name: 'Salvar produto', exact: true }).click();
  await expect(area.locator('[data-p-erro]')).toContainText('mudou em outro aparelho');
  await expect(form.getByLabel('Preço (R$)')).toHaveValue('22.00');
  expect(sql(`select preco from produtos where id='${p.id}'`)).toBe('45.00');
  const seed = montarSeed(carregarCore().CONFIG);
  const apenasProdutos = seed.slice(0, seed.indexOf('insert into public.adicionais'));
  sql(apenasProdutos);
  expect(sql(`select ativo::text||':'||preco::text from produtos where id='${p.id}'`)).toBe('true:45.00');
  const original = JSON.parse(sql("select to_jsonb(p)::text from produtos p where id='gran-burger'"));
  const atualizado = JSON.stringify({ ...original, preco: 98.76, ativo: false }).replaceAll("'", "''");
  expect(
    sql(
      `begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);select salvar_produto('${atualizado}'::jsonb,'${original.atualizado_em}');${apenasProdutos}select ativo::text||':'||preco::text from produtos where id='gran-burger';rollback;`
    )
      .split('\n')
      .at(-1)
  ).toBe('false:98.76');
});

test('visitante e motoboy não podem editar; validação recusa dados inválidos e não grava auditoria', async () => {
  const p = dadosProduto();
  ids.add(p.id);
  const j = JSON.stringify(p);
  for (const role of ['anon', 'authenticated']) {
    const claims = role === 'anon' ? '{"role":"anon"}' : `{"role":"authenticated","sub":"${moto}"}`;
    expect(() =>
      sql(
        `begin;set local role ${role};select set_config('request.jwt.claims','${claims}',true);select salvar_produto('${j}'::jsonb,null);commit;`
      )
    ).toThrow();
  }
  for (const invalido of [
    { ...p, preco: -1 },
    { ...p, categoria: 'inexistente' },
    { ...p, foto: 'https://site.test/foto.svg' },
    { ...p, ingredientes: [''] }
  ]) {
    expect(() => gravar(invalido)).toThrow();
  }
  expect(sql(`select count(*) from produtos where id='${p.id}'`)).toBe('0');
  expect(sql(`select count(*) from produtos_eventos where produto_id='${p.id}'`)).toBe('0');
});

test('atualização de preço durante o toque preserva o botão e abre os opcionais com o valor novo', async ({ page }) => {
  let responder;
  const liberar = new Promise((resolve) => {
    responder = resolve;
  });
  await page.route('**/rest/v1/rpc/estado_cardapio', async (route) => {
    const r = await route.fetch(),
      j = await r.json();
    j.precos['gran-burger'] = 28.76;
    j.catalogo.produtos.find((p) => p.id === 'gran-burger').preco = 28.76;
    await liberar;
    await route.fulfill({ response: r, json: j });
  });
  await page.goto('/#cardapio/artesanais');
  const alvo = page.locator('#prod-gran-burger .prod-nome');
  await alvo.scrollIntoViewIfNeeded();
  const caixa = await alvo.boundingBox();
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    window.__botaoCatalogo = document.querySelector('#prod-gran-burger');
  });
  responder();
  await expect.poll(() => page.evaluate(() => window.ML.produtos['gran-burger'].preco)).toBe(28.76);
  expect(await page.evaluate(() => window.__botaoCatalogo === document.querySelector('#prod-gran-burger'))).toBe(true);
  await page.mouse.up();
  await expect(page.locator('#ficha')).toHaveAttribute('open', '');
  await expect(page.locator('#ficha-total')).toHaveText('R$ 28,76');
});

test('equipe esgota e libera a categoria inteira sem alterar outras categorias', async ({ page }) => {
  const cat = 'cat-' + randomUUID();
  categoriasTeste.add(cat);
  sql(`insert into categorias_produtos(id,label,ordem) values('${cat}','Categoria estoque teste',9999);`);
  const p = gravar({ ...dadosProduto(), categoria: cat });
  ids.add(p.id);
  const antes = sql("select esgotado_dia::text from produtos where id='gran-burger'");
  await entrar(page);
  const area = page.locator('.pn-produtos:visible');
  await area.locator('[data-p-categoria]').selectOption(cat);
  await area.getByRole('button', { name: /Esgotar categoria inteira/ }).click();
  await expect(area.locator(`[data-produto="${p.id}"]`)).toContainText('Esgotado hoje');
  expect(sql("select esgotado_dia::text from produtos where id='gran-burger'")).toBe(antes);
  await area.getByRole('button', { name: /Liberar categoria inteira/ }).click();
  await expect(area.locator(`[data-produto="${p.id}"]`)).toContainText('Disponível');
  expect(sql(`select esgotado_dia is null from produtos where id='${p.id}'`)).toBe('t');
});
