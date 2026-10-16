// Painel na tela do celular (lista de pedidos do dia): botão de WhatsApp para chamar o cliente (cliente, 16/10/2026).
// O quadro vem de page.route sobre o GET dos pedidos (o banco não é alterado).
// Uso: npx playwright test tests/painel-celular.spec.js --project=celular   (precisa do Supabase local no ar)
/* global document */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';

// eslint-disable-next-line no-empty-pattern -- o Playwright exige o padrão de desestruturação no primeiro argumento
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'celular', 'lista do celular: só no projeto celular'));
test.beforeAll(() => {
  try {
    execFileSync('psql', [PG, '-X', '-At', '-q', '-c', "insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = 'equipe@teste.local' on conflict do nothing"]);
  } catch {
    /* sem psql: o login mostraria "Sem acesso" e o teste diria isso */
  }
});

const linha = (n, extra = {}) => {
  const em = new Date(Date.now() - 5 * 60000).toISOString();
  return {
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, numero: n, token: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    criado_em: em, origem: 'cardapio', mesa: null, cliente_nome: 'Marina Souza', cliente_telefone: '11985720150', modo: 'entrega', endereco: 'Rua das Flores, 100', referencia: '', pagamento: null, troco: '', obs: '',
    itens: [{ produtoId: 'x-burguer', nome: 'X-Burguer', tipo: 'lanche', precoBase: 16.9, precoUnit: 16.9, qtd: 1, completo: true, removidos: [], prensado: false, combo: { ativo: false, refri: '' }, adicionais: [], sabor: '', resumo: 'Completo', subtotal: 16.9 }],
    total: 16.9, distancia_km: null, taxa_entrega: null, status: 'novo', historico: [{ status: 'novo', em }], ...extra
  };
};

test('lista do celular: botão de WhatsApp chama o cliente (só quando há telefone) ao lado do avanço', async ({ page }) => {
  const pedidos = [linha(31), linha(32, { cliente_nome: 'Sem Telefone', cliente_telefone: '' }), linha(33, { cliente_nome: 'João Prado', cliente_telefone: '5511999990033', status: 'preparo' })];
  await page.route('**/rest/v1/pedidos?*', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: pedidos }) : r.fallback()));
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sem acesso' })).toHaveCount(0);
  await expect(page.locator('.pn-mobile .pn-m-item').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.pn-mobile .pn-m-item')).toHaveCount(3);

  const item = (n) => page.locator('.pn-m-item', { hasText: '#00' + n });
  const wa = item(31).getByRole('link', { name: /Chamar Marina Souza no WhatsApp/ });
  await expect(wa).toBeVisible();
  await expect(wa).toHaveText('WhatsApp');
  const href = await wa.getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/5511985720150\?text=/);
  expect(decodeURIComponent(href)).toContain('pedido #0031');
  await expect(wa).toHaveAttribute('target', '_self');
  await expect(wa).toHaveAttribute('rel', /noopener/);
  // telefone que já vem com 55 não duplica o código do país
  expect(await item(33).getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5511999990033\?/);
  // sem telefone: sem botão; o avanço continua
  await expect(item(32).getByRole('link', { name: /WhatsApp/ })).toHaveCount(0);
  await expect(item(32).getByRole('button', { name: 'Aceitar e preparar' })).toBeVisible();

  // alvo de toque de 48 px e nada de rolagem horizontal
  const caixa = await wa.boundingBox();
  expect(caixa.height).toBeGreaterThanOrEqual(48);
  expect(caixa.width).toBeGreaterThanOrEqual(48);
  const largura = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(largura.s).toBe(largura.c);
  // o botão ao lado do avanço: lado a lado ou empilhado, mas dentro do cartão
  const cartao = await item(31).boundingBox();
  const avanco = await item(31).getByRole('button', { name: 'Aceitar e preparar' }).boundingBox();
  expect(caixa.x).toBeGreaterThanOrEqual(cartao.x);
  expect(avanco.x + avanco.width).toBeLessThanOrEqual(cartao.x + cartao.width + 1);

  // O clique sai na própria aba, com o telefone e a mensagem corretos, sem abrir popup.
  // Intercepta o destino para não abrir o app nem contactar o WhatsApp durante o teste.
  await page.route('https://wa.me/**', r => r.fulfill({ contentType: 'text/html', body: '<p>WhatsApp de teste</p>' }));
  await wa.click();
  await expect(page).toHaveURL(href);
  expect(page.context().pages()).toHaveLength(1);
});
