import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const psql = (sql) => execFileSync('psql', [PG, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
let origem;
// eslint-disable-next-line no-empty-pattern -- fixture exigida pelo Playwright
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'configuração da equipe'));
test.beforeAll(() => {
  origem = psql('select entrega_origem from loja where id=1');
  psql("insert into equipe(user_id,nome) select id,'Equipe teste' from auth.users where email='equipe@teste.local' on conflict do nothing");
});
test.afterAll(() => psql("update loja set entrega_origem='" + origem.replace(/'/g, "''") + "'::jsonb where id=1"));
async function entrar(page) {
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.locator('[data-nav="config"]').click();
}
test('equipe consulta os resultados dos cálculos sem acessar dados pessoais', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Verificar cálculos das últimas 24 horas' }).click();
  await expect(page.locator('[data-entrega-diagnostico]')).toContainText('cotações calculadas');
  await expect(page.locator('[data-entrega-diagnostico]')).toContainText('tentativas com falha');
});
test('equipe confirma o ponto do truck pelo GPS e as próximas rotas usam a nova origem', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -23.5409, longitude: -46.3129, accuracy: 10 });
  await entrar(page);
  await page.getByRole('button', { name: 'Confirmar posição atual do truck' }).click();
  await expect(page.locator('[data-entrega-diagnostico]')).toContainText('Posição do truck atualizada');
  expect(JSON.parse(psql('select entrega_origem from loja where id=1')).lat).toBe(-23.5409);
});
test('Abrir no Maps usa o ponto confirmado, preservando a busca por texto nos pedidos antigos', async ({ page }) => {
  const base = {
    id: '00000000-0000-4000-8000-000000000901',
    numero: 901,
    criado_em: new Date().toISOString(),
    origem: 'cardapio',
    cliente_nome: 'Local confirmado',
    cliente_telefone: '11900000000',
    modo: 'entrega',
    endereco: 'Rua Exemplo, 100',
    referencia: '',
    itens: [],
    total: 24.9,
    taxa_entrega: 8,
    distancia_km: 3.2,
    status: 'novo',
    historico: []
  };
  await page.route('**/rest/v1/pedidos?*', (r) =>
    r.fulfill({
      json: [
        { ...base, entrega_destino: { lat: -23.54, lon: -46.31 } },
        { ...base, id: '00000000-0000-4000-8000-000000000902', numero: 902 }
      ]
    })
  );
  await entrar(page);
  await page.locator('[data-nav="pedidos"]').click();
  await expect(page.getByRole('link', { name: 'Abrir endereço do pedido #0901 no Maps' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=-23.54%2C-46.31'
  );
  await expect(page.getByRole('link', { name: 'Abrir endereço do pedido #0902 no Maps' })).toHaveAttribute('href', /query=Rua%20Exemplo/);
});
