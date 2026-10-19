/* global window, document, indexedDB */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'estação de impressão do computador'));
test.beforeAll(() => {
  execFileSync('psql', [PG, '-X', '-At', '-q', '-c', "insert into equipe (user_id,nome) select id,'Equipe teste' from auth.users where email='equipe@teste.local' on conflict do nothing"]);
});

function pedido(n, extra = {}) {
  const em = new Date(Date.now() + n * 10).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    token: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, numero: n,
    criado_em: em, origem: 'cardapio', cliente_nome: 'Cliente de teste', cliente_telefone: '11999990000',
    modo: 'entrega', endereco: 'Rua de teste, 10', referencia: '', pagamento: 'Pix', troco: '', obs: 'Conferir observação',
    itens: [{ produtoId: 'x-burguer', nome: 'Lanche de teste', tipo: 'lanche', qtd: 1, completo: true, removidos: [], prensado: true,
      combo: { ativo: false }, adicionais: [], sabor: '', resumo: 'Completo', precoBase: 10, precoUnit: 10, subtotal: 10 }],
    total: 14, taxa_entrega: 4, distancia_km: 1, status: 'novo', historico: [{ status: 'novo', em }], ...extra
  };
}
async function preparar({ page, context }, iniciais = []) {
  let rows = iniciais;
  await context.route('**/rest/v1/pedidos?*', r => r.request().method() === 'GET' ? r.fulfill({ json: rows }) : r.fallback());
  await context.addInitScript(() => {
    window.__cupons = [];
    window.__reterImpressao = false;
    window.__errosImpressao = [];
    document.addEventListener('securitypolicyviolation', e => window.__errosImpressao.push(e.effectiveDirective));
    window.print = () => {
      const c = document.querySelector('.pn-auto-folha .pn-comanda') || document.querySelector('.pn-comanda');
      window.__cupons.push({ id: c?.dataset.pedidoId || null, texto: c?.textContent, largura: c?.getBoundingClientRect().width,
        logo: c?.querySelector('img')?.complete, pagina: [...document.querySelectorAll('style')].map(s => s.textContent).find(s => /@page \{ size: 72mm/.test(s)) });
      if (!window.__reterImpressao) setTimeout(() => window.dispatchEvent(new Event('afterprint')), 10);
    };
  });
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.pn-auto-resumo')).toContainText('Impressão automática desligada');
  return {
    async mudar(novas) { rows = novas; await page.evaluate(() => window.ML.store.recarregar()); },
    definir(novas) { rows = novas; }
  };
}
async function ativar(page) {
  await page.getByRole('button', { name: 'Configurar impressão', exact: true }).click();
  await page.getByRole('button', { name: 'Testar impressão', exact: true }).click();
  await expect(page.getByRole('button', { name: 'O teste saiu: ativar neste computador' })).toBeEnabled();
  await page.getByRole('button', { name: 'O teste saiu: ativar neste computador' }).click();
  await expect(page.locator('.pn-auto-resumo')).toContainText('Impressão automática ativa');
}
const cupons = page => page.evaluate(() => window.__cupons.filter(c => c.id));
async function estados(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const abrir = indexedDB.open('mineiro-impressao-v1', 1);
    abrir.onsuccess = () => {
      const db = abrir.result, tx = db.transaction('trabalhos'), r = tx.objectStore('trabalhos').getAll();
      r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
    };
    abrir.onerror = () => reject(abrir.error);
  }));
}

test('ativa após teste, ignora pedidos antigos e imprime o próximo pedido com logo, QR e 72 mm sem mudar seu status', async ({ page, context }) => {
  const api = await preparar({ page, context }, [pedido(1)]);
  await page.getByRole('button', { name: 'Configurar impressão', exact: true }).click();
  await expect(page.getByRole('button', { name: 'O teste saiu: ativar neste computador' })).toBeDisabled();
  await ativar(page);
  expect(await cupons(page)).toHaveLength(0);
  await api.mudar([pedido(1), pedido(2)]);
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  const [cupom] = await cupons(page);
  expect(cupom.id).toBe(pedido(2).id);
  expect(cupom.texto).toContain('ENTREGADOR: LEIA AO ENTREGAR');
  expect(cupom.texto).toContain('Conferir observação');
  expect(cupom.logo).toBe(true);
  expect(Math.abs(cupom.largura - 72 * 96 / 25.4)).toBeLessThan(1);
  expect(cupom.pagina).toMatch(/size: 72mm \d+mm; margin: 0/);
  expect(await page.evaluate(() => window.ML.store.pedidos().find(p => p.numero === 2).status)).toBe('novo');
  await expect(page.locator('.pn-auto-folha')).toHaveCount(0);
  expect(await page.evaluate(() => window.__errosImpressao)).toEqual([]);
});

test('serializa um lote, não repete em recargas e recupera pedidos recebidos com o painel fechado', async ({ page, context }) => {
  const api = await preparar({ page, context }); await ativar(page);
  const rows = [pedido(5), pedido(3), pedido(4)];
  await api.mudar(rows);
  await expect.poll(async () => (await cupons(page)).length, { timeout: 15000 }).toBe(3);
  expect((await cupons(page)).map(c => c.id)).toEqual([3, 4, 5].map(n => pedido(n).id));
  await expect.poll(async () => (await estados(page)).filter(t => t.estado === 'enviado').length).toBe(3);
  await api.mudar(rows); await api.mudar(rows);
  expect(await cupons(page)).toHaveLength(3);
  api.definir([...rows, pedido(6)]);
  await page.reload();
  await expect(page.locator('.pn-app')).toBeVisible();
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  expect((await cupons(page))[0].id).toBe(pedido(6).id);
});

test('pausa preserva a fila e não imprime automaticamente pedidos recebidos enquanto pausada', async ({ page, context }) => {
  const api = await preparar({ page, context }); await ativar(page);
  // Modal aberto impede que o envio interrompa uma conferência em andamento.
  await api.mudar([pedido(7)]);
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Pausar impressão automática' }).click();
  await expect(page.locator('.pn-auto-resumo')).toContainText('desligada');
  await api.mudar([pedido(7), pedido(8)]);
  await page.getByRole('button', { name: 'O teste saiu: ativar neste computador' }).click();
  await api.mudar([pedido(7), pedido(8), pedido(9)]);
  await expect.poll(async () => (await cupons(page)).length).toBe(2);
  expect((await cupons(page)).map(c => c.id)).toEqual([pedido(7).id, pedido(9).id]);
});

test('não imprime cancelados nem exemplos e espera o fechamento de um modal sem roubar seu conteúdo', async ({ page, context }) => {
  const api = await preparar({ page, context }, [pedido(10)]); await ativar(page);
  await page.locator('[data-nav="pedidos"]').click();
  await page.locator(`.pn-card[data-id="${pedido(10).id}"] [data-act="imprimir"]`).click();
  await expect(page.locator('.pn-modal')).toBeVisible();
  await api.mudar([pedido(10), pedido(11), pedido(12, { origem: 'exemplo' }), pedido(13, { status: 'cancelado' })]);
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(11).id)?.estado).toBe('pendente');
  expect(await cupons(page)).toHaveLength(0);
  await api.mudar([pedido(10), pedido(11, { status: 'cancelado' }), pedido(12, { origem: 'exemplo' }), pedido(13, { status: 'cancelado' }), pedido(14)]);
  await page.locator('.pn-modal [data-m="fechar"]').click();
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  expect((await cupons(page))[0].id).toBe(pedido(14).id);
});

test('impressão interrompida exige conferência antes de reenviar, e a decisão persiste', async ({ page, context }) => {
  const api = await preparar({ page, context }); await ativar(page);
  await page.evaluate(() => { window.__reterImpressao = true; });
  await api.mudar([pedido(15)]);
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  await expect.poll(async () => (await estados(page))[0]?.estado).toBe('enviando');
  await page.reload();
  await expect(page.locator('.pn-auto-resumo')).toContainText('precisam de conferência');
  expect(await cupons(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Conferir comandas' }).click();
  await page.getByRole('button', { name: 'Já saiu no papel' }).click();
  await expect(page.locator('.pn-auto-resumo')).toContainText('Impressão automática ativa');
  await page.reload();
  await expect(page.locator('.pn-auto-resumo')).toContainText('Impressão automática ativa');
  expect(await cupons(page)).toHaveLength(0);
});

test('envia novamente só por ação explícita depois de uma falha e libera a próxima comanda', async ({ page, context }) => {
  const api = await preparar({ page, context }); await ativar(page);
  await page.evaluate(() => { window.print = () => { throw new Error('Impressora indisponível'); }; });
  await api.mudar([pedido(16), pedido(17)]);
  await expect(page.locator('.pn-auto-resumo')).toContainText('precisam de conferência');
  expect(await cupons(page)).toHaveLength(0);
  await page.reload();
  await expect(page.locator('.pn-auto-resumo')).toContainText('precisam de conferência');
  await page.getByRole('button', { name: 'Conferir comandas' }).click();
  await page.getByRole('button', { name: 'Enviar novamente', exact: true }).click();
  await expect.poll(async () => (await cupons(page)).length).toBe(2);
  expect((await cupons(page)).map(c => c.id)).toEqual([pedido(16).id, pedido(17).id]);
});

test('duas abas do mesmo navegador compartilham fila e não enviam o mesmo pedido duas vezes', async ({ page, context }) => {
  const api = await preparar({ page, context }); await ativar(page);
  const outra = await context.newPage();
  await outra.goto('/painel/');
  await expect(outra.locator('.pn-auto-resumo')).toContainText('Impressão automática ativa');
  await api.mudar([pedido(18)]);
  await outra.evaluate(() => window.ML.store.recarregar());
  await expect.poll(async () => (await cupons(page)).length + (await cupons(outra)).length).toBe(1);
  await expect.poll(async () => (await estados(outra))[0]?.estado).toBe('enviado');
  await Promise.all([page.evaluate(() => window.ML.store.recarregar()), outra.evaluate(() => window.ML.store.recarregar())]);
  expect((await cupons(page)).length + (await cupons(outra)).length).toBe(1);
});

test('sair interrompe a fila, remove a comanda do documento e não imprime novos pedidos acima do login', async ({ page, context }) => {
  const api = await preparar({ page, context }); await ativar(page);
  await page.evaluate(() => { window.__reterImpressao = true; });
  await api.mudar([pedido(19), pedido(20)]);
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Sair', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.locator('.pn-auto-folha')).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-pn-auto-print')).toBeNull();
  expect((await estados(page)).find(t => t.id === pedido(20).id)?.estado).toBe('pendente');
  // Sair recarrega o documento; o espião recomeça vazio e a fila continua persistida.
  expect(await cupons(page)).toHaveLength(0);
});

test('PDF automático contém só o cupom e mantém uma página de 72 mm com logo e QR', async ({ page, context }, info) => {
  const api = await preparar({ page, context }); await ativar(page);
  await page.evaluate(() => { window.__reterImpressao = true; });
  await api.mudar([pedido(21)]);
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.pn-auto-folha .pn-comanda')).toBeVisible();
  await expect(page.locator('.pn-auto-folha .pn-c-qr')).toBeVisible();
  await expect(page.locator('#view-painel')).toBeHidden();
  await page.screenshot({ path: info.outputPath('cupom-automatico.png'), fullPage: true });
  const pdf = await page.pdf({ path: info.outputPath('cupom-automatico.pdf'), preferCSSPageSize: true, printBackground: true });
  const txt = pdf.toString('latin1');
  expect([...txt.matchAll(/\/Type\s*\/Page[^s]/g)]).toHaveLength(1);
  const largura = Number(txt.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)/)?.[1]);
  expect(Math.abs(largura - 72 / 25.4 * 72)).toBeLessThan(1.5);
  await info.attach('cupom-automatico', { body: pdf, contentType: 'application/pdf' });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.pn-auto-folha')).toHaveCount(0);
});

test('impressão manual de uma comanda pendente evita um segundo envio automático', async ({ page, context }) => {
  const api = await preparar({ page, context }, [pedido(22)]); await ativar(page);
  await page.locator('[data-nav="pedidos"]').click();
  await page.locator(`.pn-card[data-id="${pedido(22).id}"] [data-act="imprimir"]`).click();
  await api.mudar([pedido(22), pedido(23)]);
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(23).id)?.estado).toBe('pendente');
  // A troca entre os dois modais ocorre na mesma tarefa, antes de um tick de impressão.
  await page.evaluate(id => {
    document.querySelector('.pn-modal [data-m="fechar"]').click();
    document.querySelector(`.pn-card[data-id="${id}"] [data-act="imprimir"]`).click();
  }, pedido(23).id);
  await page.locator('.pn-modal [data-m="imprimir"]').click();
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(23).id)?.estado).toBe('enviado');
  await page.locator('.pn-modal [data-m="fechar"]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await api.mudar([pedido(22), pedido(23)]);
  expect((await cupons(page)).filter(c => c.id === pedido(23).id)).toHaveLength(1);
});

test('sem conexão preserva as pendências e só retoma depois da reconexão', async ({ page, context }) => {
  const api = await preparar({ page, context }, [pedido(24)]); await ativar(page);
  await page.locator('[data-nav="pedidos"]').click();
  await page.locator(`.pn-card[data-id="${pedido(24).id}"] [data-act="imprimir"]`).click();
  await api.mudar([pedido(24), pedido(25)]);
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(25).id)?.estado).toBe('pendente');
  await context.setOffline(true);
  await page.locator('.pn-modal [data-m="fechar"]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.pn-auto-resumo')).toContainText('na fila de impressão');
  expect(await cupons(page)).toHaveLength(0);
  await context.setOffline(false);
  await page.evaluate(() => window.ML.store.recarregar());
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  expect((await cupons(page))[0].id).toBe(pedido(25).id);
});

test('cancelamento recusado pelo servidor devolve a comanda à fila sem perdê-la', async ({ page, context }) => {
  const api = await preparar({ page, context }, [pedido(26)]); await ativar(page);
  await page.locator('[data-nav="pedidos"]').click();
  await page.locator(`.pn-card[data-id="${pedido(26).id}"] [data-act="imprimir"]`).click();
  await api.mudar([pedido(26), pedido(27)]);
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(27).id)?.estado).toBe('pendente');
  let liberar;
  const resposta = new Promise(ok => { liberar = ok; });
  await page.route('**/rest/v1/rpc/mudar_status', async r => {
    await resposta;
    await r.fulfill({ status: 400, json: { code: 'P0001', message: 'Mudança recusada no teste' } });
  });
  await page.evaluate(id => window.ML.store.atualizarStatus(id, 'cancelado', 'Conferência de teste'), pedido(27).id);
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(27).id)?.estado).toBe('cancelado');
  liberar();
  await expect.poll(async () => (await estados(page)).find(t => t.id === pedido(27).id)?.estado).toBe('pendente');
  await page.locator('.pn-modal [data-m="fechar"]').click();
  await expect.poll(async () => (await cupons(page)).length).toBe(1);
  expect((await cupons(page))[0].id).toBe(pedido(27).id);
});
