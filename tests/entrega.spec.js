// Endereço por CEP, taxa de entrega por distância e prazo (cliente, 16/10/2026):
//   - CEP → rua, bairro e cidade vêm sozinhos (ViaCEP); o cliente completa o número;
//   - taxa = km da rota (sempre para cima) × R$ 1 + R$ 4, mostrada no checkout, no total e gravada pelo banco;
//   - se a rota falha, a taxa fica "a combinar" e o pedido segue;
//   - prazo de espera de até 50 minutos, podendo chegar antes.
// As três consultas externas (ViaCEP, Nominatim, OSRM) são simuladas com page.route; o pedido vai de verdade ao Supabase local.
// Uso: npx playwright test tests/entrega.spec.js --project=celular   (precisa do Supabase local no ar)
/* global window, localStorage */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const psql = (sql) => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const NOME = 'Entrega Teste';

// eslint-disable-next-line no-empty-pattern -- o Playwright exige o padrão de desestruturação no primeiro argumento
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'celular', 'fluxo do cliente: só no celular'));
test.beforeAll(() => psql("update loja set modo = 'aberta'"));
test.afterAll(() => {
  psql(`delete from pedidos where cliente_nome like '${NOME}%'`);
  psql("update loja set modo = 'auto'");
});

const VIACEP = { cep: '08674-185', logradouro: 'Rua Eliziél Alves Costa', bairro: 'Centro', localidade: 'Suzano', uf: 'SP' };

// simula as consultas externas; rota = metros que o OSRM devolve (null = falha)
async function simular(page, { cep = VIACEP, metros = 3200, achaEndereco = true } = {}) {
  const chamadas = { viacep: 0, nominatim: 0, osrm: 0 };
  await page.route('https://viacep.com.br/**', (r) => {
    chamadas.viacep++;
    return r.fulfill({ json: cep || { erro: true } });
  });
  await page.route('https://nominatim.openstreetmap.org/**', (r) => {
    chamadas.nominatim++;
    return r.fulfill({ json: achaEndereco ? [{ lat: '-23.55', lon: '-46.33' }] : [] });
  });
  await page.route('https://router.project-osrm.org/**', (r) => {
    chamadas.osrm++;
    return metros == null ? r.abort() : r.fulfill({ json: { code: 'Ok', routes: [{ distance: metros }] } });
  });
  return chamadas;
}

async function irAoCheckout(page, { nome = NOME } = {}) {
  await page.goto('/#cardapio');
  await expect.poll(() => page.evaluate(() => window.ML.store.loja().modo)).toBe('aberta');
  await page.locator('#prod-x-burguer').click();
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').click();
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
  await page.locator('#f-nome').fill(nome);
  await page.locator('#f-tel').fill('11985720150');
  await page.locator('[data-modo="entrega"]').click();
}
const totalCheckout = (page) => page.locator('[data-screen="checkout"] .resumo .total [data-total]');
const digitar = async (page, sufixo) => {
  const campo = page.locator('#f-end');
  await campo.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(sufixo);
};

test('regra da taxa: km sempre para cima × R$ 1 + R$ 4', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => {
    const t = window.ML.entrega.taxa;
    return { dez: t(10), tresDois: t(3.2), tres: t(3), meio: t(0.4), mil: t(3.001), dec: t(3.0004), zero: t(0), neg: t(-1), txt: window.ML.entrega.prazo() };
  });
  expect(r).toEqual({ dez: 14, tresDois: 8, tres: 7, meio: 5, mil: 8, dec: 7, zero: null, neg: null, txt: 'até 50 minutos, podendo chegar antes' });
});

test('prazo de até 50 minutos, podendo chegar antes, no checkout e no acompanhamento', async ({ page }) => {
  await simular(page);
  await irAoCheckout(page, { nome: NOME + ' prazo' });
  await expect(page.locator('[data-screen="checkout"] [data-prazo]')).toHaveText('Prazo de espera: até 50 minutos, podendo chegar antes.');
  await page.locator('[data-modo="local"]').click();
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  await expect(page.locator('[data-screen="pedido"] [data-prazo]')).toHaveText('Prazo de espera: até 50 minutos, podendo chegar antes.');
});

test('CEP preenche rua, bairro e cidade; com o número vem a taxa e ela entra no total e no banco', async ({ page }) => {
  const chamadas = await simular(page);
  await irAoCheckout(page, { nome: NOME + ' cep' });
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 1 por km + R$ 4');
  await page.locator('#f-cep').fill('08674185');
  await expect(page.locator('#f-cep')).toHaveValue('08674-185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await expect(page.locator('#f-bairro')).toHaveValue('Centro · Suzano/SP');
  await expect(page.locator('#cep-dica')).toHaveText('Agora é só informar o número da casa.');
  // sem o número ainda não calcula
  await expect(page.locator('#taxa-msg')).toHaveText('Informe o número da casa para calcular a taxa de entrega.');
  expect(chamadas.osrm).toBe(0);
  await digitar(page, '300');
  // 3,2 km → 4 km × R$ 1 + R$ 4 = R$ 8,00
  await expect(page.locator('#taxa-msg')).toContainText('Taxa de entrega: R$ 8,00 · 4 km (distância de 3,2 km, sempre arredondada para cima)');
  await expect(page.locator('#chk-taxa')).toHaveText('R$ 8,00');
  await expect(totalCheckout(page)).toHaveText('R$ 24,90'); // X-Burguer 16,90 + 8,00
  await expect(page.locator('#btn-enviar .btn-valor')).toHaveText('R$ 24,90');
  expect(chamadas.viacep).toBe(1);
  await page.locator('#f-ref').fill('Portão azul');
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  const linha = psql(`select endereco, referencia, distancia_km, taxa_entrega, total from pedidos where cliente_nome = '${NOME} cep'`);
  expect(linha).toBe('Rua Eliziél Alves Costa, 300, Centro, Suzano/SP, CEP 08674-185|Portão azul|3.200|8.00|24.90');
  await expect(page.locator('#ped-total')).toHaveText('R$ 24,90 (com entrega de R$ 8,00)');
});

test('mudar o número recalcula a taxa; resultado repetido vem do cache (sem nova consulta)', async ({ page }) => {
  const chamadas = await simular(page, { metros: 10_000 });
  await irAoCheckout(page);
  await page.locator('#f-cep').fill('08674-185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await digitar(page, '12');
  await expect(page.locator('#taxa-msg')).toContainText('R$ 14,00 · 10 km'); // 10 km exatos: sem "arredondada"
  await expect(page.locator('#taxa-msg')).not.toContainText('arredondada');
  expect(chamadas.osrm).toBe(1);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await digitar(page, '12');
  await expect(page.locator('#taxa-msg')).toContainText('R$ 14,00');
  expect(chamadas.osrm).toBe(1);
});

test('sem o número da casa o envio é recusado com a mensagem certa', async ({ page }) => {
  await simular(page);
  await irAoCheckout(page);
  await page.locator('#f-cep').fill('08674185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await page.locator('#btn-enviar').click();
  await expect(page.locator('#erro-end')).toHaveText('Informe o número da casa (ou S/N, se não tiver).');
  await expect(page.locator('#f-end')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-end')).toBeFocused();
});

test('rota indisponível: taxa a combinar e o pedido segue sem taxa', async ({ page }) => {
  await simular(page, { metros: null });
  await irAoCheckout(page, { nome: NOME + ' rota' });
  await page.locator('#f-cep').fill('08674185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await digitar(page, '300');
  await expect(page.locator('#taxa-msg')).toContainText('Não conseguimos calcular a taxa agora');
  await expect(page.locator('#chk-taxa')).toHaveText('a combinar');
  await expect(totalCheckout(page)).toHaveText('R$ 16,90');
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  expect(psql(`select taxa_entrega is null, distancia_km is null, total from pedidos where cliente_nome = '${NOME} rota'`)).toBe('t|t|16.90');
  await expect(page.locator('#ped-total')).toHaveText('R$ 16,90 + entrega');
});

test('endereço que o mapa não acha: taxa a combinar', async ({ page }) => {
  await simular(page, { achaEndereco: false });
  await irAoCheckout(page);
  await page.locator('#f-cep').fill('08674185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await digitar(page, '999');
  await expect(page.locator('#taxa-msg')).toContainText('Não conseguimos calcular a taxa agora', { timeout: 10_000 });
  await expect(totalCheckout(page)).toHaveText('R$ 16,90');
});

test('CEP inexistente: avisa e deixa escrever o endereço à mão (sem taxa)', async ({ page }) => {
  await simular(page, { cep: null });
  await irAoCheckout(page, { nome: NOME + ' manual' });
  await page.locator('#f-cep').fill('99999999');
  await expect(page.locator('#cep-dica')).toHaveText('CEP não encontrado. Confira os números ou escreva o endereço abaixo.');
  await page.locator('#f-end').fill('Rua das Flores, 100, Centro');
  await expect(page.locator('#taxa-msg')).toBeHidden();
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  expect(psql(`select endereco, taxa_entrega is null from pedidos where cliente_nome = '${NOME} manual'`)).toBe('Rua das Flores, 100, Centro|t');
});

test('comer no local não tem taxa nem pede CEP', async ({ page }) => {
  await simular(page);
  await irAoCheckout(page);
  await page.locator('[data-modo="local"]').click();
  await expect(page.locator('#bloco-endereco')).toBeHidden();
  await expect(page.locator('#chk-taxa')).toHaveText('sem taxa');
  await expect(totalCheckout(page)).toHaveText('R$ 16,90');
});

test('banco ainda sem a taxa (antes da migration): fica "a combinar" e o total não diverge do servidor', async ({ page }) => {
  const chamadas = await simular(page);
  await page.route('**/rest/v1/rpc/estado_cardapio', async (route) => {
    const resposta = await route.fetch();
    const json = await resposta.json();
    delete json.loja.taxaKm;
    delete json.loja.taxaFixa;
    await route.fulfill({ response: resposta, json });
  });
  await irAoCheckout(page, { nome: NOME + ' antigo' });
  await page.locator('#f-cep').fill('08674185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await digitar(page, '300');
  await expect(page.locator('#chk-taxa')).toHaveText('a combinar');
  await expect(page.locator('#taxa-msg')).toBeHidden();
  await expect(totalCheckout(page)).toHaveText('R$ 16,90');
  expect(chamadas.osrm).toBe(0);
  await page.locator('#btn-enviar').click();
  await expect(page.locator('[data-screen="pedido"]')).toBeVisible();
  expect(psql(`select taxa_entrega is null, total from pedidos where cliente_nome = '${NOME} antigo'`)).toBe('t|16.90');
});

test('rota acima de 100 km (o banco só aceita até 100): taxa a combinar', async ({ page }) => {
  await simular(page, { metros: 150_000 });
  await irAoCheckout(page);
  await page.locator('#f-cep').fill('08674185');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, ');
  await digitar(page, '300');
  await expect(page.locator('#taxa-msg')).toContainText('Não conseguimos calcular a taxa agora');
  await expect(totalCheckout(page)).toHaveText('R$ 16,90');
});

test('rascunho com CEP: refaz a busca só no checkout e mantém a rua e o número digitados', async ({ page }) => {
  const chamadas = await simular(page);
  await page.addInitScript(() => localStorage.setItem('mineiro:v2:rascunho', JSON.stringify({ nome: 'Rascunho', tel: '11985720150', cep: '08674-185', end: 'Rua Eliziél Alves Costa, 77', ref: '', obs: '', modo: 'entrega' })));
  await page.goto('/#cardapio');
  await expect.poll(() => page.evaluate(() => window.ML.store.loja().modo)).toBe('aberta');
  expect(chamadas.viacep, 'nada de consulta de CEP fora do checkout').toBe(0);
  await page.locator('#prod-x-burguer').click();
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').click();
  await expect(page.locator('#f-bairro')).toHaveValue('Centro · Suzano/SP');
  await expect(page.locator('#f-end')).toHaveValue('Rua Eliziél Alves Costa, 77');
  await expect(page.locator('#taxa-msg')).toContainText('Taxa de entrega: R$ 8,00');
  expect(chamadas.viacep).toBe(1);
});
