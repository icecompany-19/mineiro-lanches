// Telefone primeiro, reconhecimento neste aparelho e vários endereços por cliente.
/* global localStorage, document */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const psql = sql => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const TELEFONE = '11912345670';
const CASA = { cep: '08674185', end: 'Rua das Flores, 100', ref: 'Casa' };
const TRABALHO = { cep: '08674185', end: 'Rua das Flores, 200', ref: 'Recepção' };

test.beforeAll(() => psql("update loja set modo = 'aberta'"));
test.afterAll(() => {
  psql("delete from pedidos where cliente_nome like 'Cadastro Teste%'");
  psql("update loja set modo = 'auto'");
});

async function iniciar(page, perfis = {}) {
  await page.addInitScript(dados => {
    if (!localStorage.getItem('mineiro:v2:cadastros')) localStorage.setItem('mineiro:v2:cadastros', JSON.stringify(dados));
  }, perfis);
  await page.route('https://viacep.com.br/**', r => r.fulfill({ json: { logradouro: 'Rua das Flores', bairro: 'Centro', localidade: 'Suzano', uf: 'SP' } }));
  await page.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({ json: [{ lat: '-23.55', lon: '-46.33' }] }));
  await page.route('https://router.project-osrm.org/**', r => r.fulfill({ json: { code: 'Ok', routes: [{ distance: 3200 }] } }));
  await checkout(page);
}

async function checkout(page) {
  await page.goto('/#cardapio');
  await page.locator('#prod-x-burguer').click();
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').click();
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
}

async function preencherEndereco(page, endereco) {
  await page.locator('#f-cep').fill(endereco.cep);
  await expect(page.locator('#f-end')).toHaveValue('Rua das Flores, ');
  await page.locator('#f-end').fill(endereco.end);
  await page.locator('#f-ref').fill(endereco.ref);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 8,00');
}

test('cliente novo começa pelo telefone e salva o cadastro somente após o pedido aceito', async ({ page }) => {
  await iniciar(page);
  await expect(page.locator('#form-pedido input').first()).toHaveAttribute('id', 'f-tel');
  await page.locator('#f-tel').fill(TELEFONE);
  await expect(page.locator('#f-nome')).toHaveValue('');
  await expect(page.locator('#f-end')).toHaveValue('');
  await expect(page.locator('#enderecos-salvos')).toBeHidden();
  await expect(page.locator('#pagamentos')).toBeEmpty();
  await expect(page.locator('#pag-tit')).toBeHidden();
  await page.locator('#f-nome').fill('Cadastro Teste Novo');
  await preencherEndereco(page, CASA);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:cadastros')))).toEqual({});
  await page.route('**/rest/v1/rpc/criar_pedido', r => r.fulfill({ status: 503, json: { message: 'indisponível' } }));
  await page.locator('#btn-enviar').click();
  await expect(page.locator('#envio-erro')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mineiro:v2:cadastros')))).toEqual({});
  await page.unroute('**/rest/v1/rpc/criar_pedido');
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  const salvo = await page.evaluate(tel => JSON.parse(localStorage.getItem('mineiro:v2:cadastros'))[tel], TELEFONE);
  expect(salvo).toEqual({ nome: 'Cadastro Teste Novo', enderecos: [CASA] });
});

test('cliente conhecido adiciona outro endereço sem perder o anterior e pode voltar a escolhê-lo', async ({ page }) => {
  await iniciar(page, { [TELEFONE]: { nome: 'Cadastro Teste Dois', enderecos: [CASA] } });
  await page.locator('#f-tel').fill('+55 (11) 91234-5670');
  await expect(page.locator('#f-nome')).toHaveValue('Cadastro Teste Dois');
  await expect(page.locator('#f-end')).toHaveValue(CASA.end);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 8,00');
  await page.locator('#btn-novo-endereco').click();
  await expect(page.locator('#f-cep')).toBeFocused();
  await expect(page.locator('#f-end')).toHaveValue('');
  await expect(page.locator('#f-ref')).toHaveValue('');
  await expect(page.locator('#chk-taxa')).toHaveText('taxa calculada pelo endereço');
  await expect(page.locator('#f-nome')).toHaveValue('Cadastro Teste Dois');
  await preencherEndereco(page, TRABALHO);
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  expect(await page.evaluate(tel => JSON.parse(localStorage.getItem('mineiro:v2:cadastros'))[tel].enderecos, TELEFONE)).toEqual([TRABALHO, CASA]);

  // Mesmo depois de recarregar, conserva os dois endereços e recalcula o selecionado.
  await checkout(page);
  await page.locator('#f-endereco-salvo').selectOption('1');
  await expect(page.locator('#f-end')).toHaveValue(CASA.end);
  await expect(page.locator('#f-ref')).toHaveValue(CASA.ref);
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 8,00');
  const largura = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(largura[0]).toBe(largura[1]);
});

test('trocar de telefone limpa os dados e a taxa; uma consulta antiga de CEP não preenche o cliente novo', async ({ page }) => {
  await iniciar(page, { [TELEFONE]: { nome: 'Cadastro Teste Anterior', enderecos: [CASA] } });
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  await page.route('https://viacep.com.br/**', async r => {
    await espera;
    await r.fulfill({ json: { logradouro: 'Rua das Flores', bairro: 'Centro', localidade: 'Suzano', uf: 'SP' } });
  });
  const consulta = page.waitForRequest('https://viacep.com.br/**');
  await page.locator('#f-tel').fill(TELEFONE);
  await consulta;
  await expect(page.locator('#f-end')).toHaveValue(CASA.end);
  await page.locator('#f-tel').fill('11900000009');
  await expect(page.locator('#f-nome')).toHaveValue('');
  await expect(page.locator('#f-end')).toHaveValue('');
  await expect(page.locator('#f-ref')).toHaveValue('');
  await expect(page.locator('#enderecos-salvos')).toBeHidden();
  const resposta = page.waitForResponse('https://viacep.com.br/**');
  liberar();
  await resposta;
  await expect(page.locator('#f-end')).toHaveValue('');
  await expect(page.locator('#f-bairro')).toHaveValue('');
  await expect(page.locator('#chk-taxa')).toHaveText('taxa calculada pelo endereço');
});

test('adicionar novo endereço e recarregar conserva o formulário novo, sem voltar ao endereço antigo', async ({ page }) => {
  await iniciar(page, { [TELEFONE]: { nome: 'Cadastro Teste Rascunho', enderecos: [CASA] } });
  await page.locator('#f-tel').fill(TELEFONE);
  await expect(page.locator('#f-end')).toHaveValue(CASA.end);
  await page.locator('#btn-novo-endereco').click();
  await page.reload();
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
  await expect(page.locator('#f-nome')).toHaveValue('Cadastro Teste Rascunho');
  await expect(page.locator('#f-end')).toHaveValue('');
  await expect(page.locator('#f-cep')).toHaveValue('');
  await expect(page.locator('#f-endereco-salvo')).toHaveValue('');
  await expect(page.locator('#f-endereco-salvo option')).toHaveCount(2);
});
