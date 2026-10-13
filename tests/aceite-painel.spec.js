// Aceite do painel da equipe (docs/DIRECAO-VISUAL.md §8 e §5.7; plano P10a, parte de spec):
//   1. alvos de toque ≥ 48×48 px (login, quadro, histórico, cardápio, relatório, configurações, a lista de 390 px e os
//      painéis que abrem por cima: detalhe, comanda, CSV, cancelar e a confirmação de apagar);
//   2. nenhuma rolagem horizontal (scrollWidth === clientWidth) em 390 e 1280;
//   3. animações paradas com movimento reduzido (document.getAnimations() vazio) e com a aba oculta (as infinitas pausam);
//   4. @keyframes só com transform, opacity e clip-path (o CSS do painel e tudo o que roda numa jornada);
//   5. nenhuma violação de CSP (a CSP do vercel.json é posta na resposta do HTML; um script inline injetado prova que vale).
// Uso: npx playwright test tests/aceite-painel.spec.js --project=celular --project=desktop
//      (precisa do Supabase local no ar e da equipe@teste.local na tabela equipe; o proxy local aceita qualquer senha)
//
// O banco não é alterado pelos testes: o login é o do proxy local e os pedidos do quadro vêm de page.route sobre a
// resposta de GET /rest/v1/pedidos (um quadro com um pedido novo, um em atenção, um em atraso, e os demais status).
// Nenhum botão que grava (avançar, cancelar-ok, apagar-ok, simular, gerar exemplos) é clicado. Única escrita: se faltar a
// linha da equipe, ela é inserida com `on conflict do nothing`, como o tests/e2e.spec.js faz.
// Interface de computador (quadro, abas, painéis) só no projeto desktop; a lista de 390 px, no projeto celular.
//   6. cabeçalho: o celular (390) tem o selo de 64 px e o status da loja; o de 1280 não muda de lugar de uma tela para outra.
/* global document, window, matchMedia */
import { test as base, expect as expectBase } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  JANELAS,
  larguraDoProjeto,
  instalarApoio,
  rolagemHorizontal,
  alvosPequenos,
  lerAnimacoes,
  propriedadesProibidas,
  keyframesDoCss,
  instalarGravador,
  lerGravacao,
  ocultarAba,
  mostrarAba,
  vigiarCsp
} from './apoio/aceite.js';

// o Supabase local é compartilhado com outros agentes: 10 s em vez de 5 nas esperas
const expect = expectBase.configure({ timeout: 10_000 });

const test = base.extend({
  largura: [
    async ({ page }, use, testInfo) => {
      const l = larguraDoProjeto(testInfo);
      await page.setViewportSize(JANELAS[l]);
      await instalarApoio(page);
      await use(l);
    },
    { auto: true }
  ]
});

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const ALVO = 48;
const VIEWS = ['pedidos', 'historico', 'cardapio', 'relatorio', 'config'];

test.beforeAll(() => {
  try {
    execFileSync(
      'psql',
      [
        PG,
        '-X',
        '-At',
        '-q',
        '-c',
        "insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = 'equipe@teste.local' on conflict do nothing"
      ],
      { encoding: 'utf8' }
    );
  } catch (e) {
    // sem psql no PATH: segue; se a equipe não existir o login mostra "Sem acesso" e o teste diz isso
    console.log('aceite-painel: não foi possível garantir a linha de equipe (' + String(e.message).split('\n')[0] + ')');
  }
});

// ---------- pedidos de mentira (a resposta do GET, não o banco) ----------
const ITEM = (nome, subtotal, extra = {}) => ({
  produtoId: 'x-burguer',
  nome,
  tipo: 'lanche',
  precoBase: subtotal,
  precoUnit: subtotal,
  qtd: 1,
  completo: true,
  removidos: [],
  prensado: false,
  combo: { ativo: false, refri: '' },
  adicionais: [],
  sabor: '',
  resumo: 'Completo',
  subtotal,
  ...extra
});
function linha(n, status, minutosAtras, extra = {}) {
  const em = new Date(Date.now() - minutosAtras * 60000).toISOString();
  const id = `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  return {
    id,
    numero: n,
    token: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    criado_em: em,
    origem: 'cardapio',
    mesa: null,
    cliente_nome: 'Cliente ' + n,
    cliente_telefone: '11985720150',
    modo: 'entrega',
    endereco: 'Rua Eliziel Alves Costa, 300',
    referencia: 'Portão azul',
    pagamento: null,
    troco: '',
    obs: '',
    itens: [
      ITEM('X-Burguer', 16.9),
      ITEM('Gran Burger', 25.9, { prensado: true, combo: { ativo: true, refri: 'Cola' }, adicionais: [{ id: 'bacon', nome: 'Bacon', qtd: 1, preco: 7.5 }], removidos: ['Cebola'] })
    ],
    total: 50.3,
    status,
    historico: [{ status: 'novo', em }],
    ...extra
  };
}
// atenção a partir de 15 min e atraso a partir de 25 (config padrão da store)
const quadro = () => [
  linha(1, 'novo', 2),
  linha(2, 'novo', 18, { origem: 'qrcode', mesa: '3', modo: 'local', endereco: '', referencia: '' }), // atenção + QR · Mesa
  linha(3, 'preparo', 30), // atraso
  linha(4, 'pronto', 8),
  linha(5, 'rota', 12),
  linha(6, 'entregue', 60, { obs: 'Sem pimenta' }),
  linha(7, 'cancelado', 90, { historico: [{ status: 'novo', em: new Date(Date.now() - 90 * 60000).toISOString() }, { status: 'cancelado', em: new Date(Date.now() - 88 * 60000).toISOString(), motivo: 'Cliente desistiu' }] })
];

// entra no painel pelo login do proxy local; `dados.pedidos` é a lista que o GET devolve (troque-a e chame recarregar)
async function entrar(page, { pedidos = quadro() } = {}) {
  const dados = { pedidos };
  await page.route('**/rest/v1/pedidos?*', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: dados.pedidos }) : r.fallback()));
  await page.goto('/painel/');
  await page.getByLabel('E-mail').fill('equipe@teste.local');
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sem acesso' }), 'equipe@teste.local precisa estar na tabela equipe').toHaveCount(0);
  // login + conferência da equipe + primeira carga: com o banco local ocupado passa dos 5 s do expect
  await expect(page.locator('#view-painel .pn-app')).toBeAttached({ timeout: 25_000 });
  await page.waitForTimeout(800);
  return dados;
}
const ir = async (page, view) => {
  await page.locator(`[data-nav="${view}"]`).click();
  await expect(page.locator(`[data-nav="${view}"]`)).toHaveAttribute('aria-current', 'page');
  await page.waitForTimeout(500);
};
// novo pedido chegando: a lista do GET ganha o #8 e a store recarrega (o Realtime local não existe; o painel faria o mesmo a cada 5 s)
async function chegaPedido(page, dados) {
  dados.pedidos = [...dados.pedidos, linha(8, 'novo', 0)];
  await page.evaluate(() => window.ML.store.recarregar());
  await expect(page.locator('.pn-card[data-id$="08"]')).toBeVisible();
}

// ---------- 2. sem rolagem horizontal ----------
test.describe('sem rolagem horizontal (390 e 1280)', () => {
  const conferir = async (page, onde) => {
    for (const l of [1280, 390]) {
      await page.setViewportSize(JANELAS[l]);
      await page.waitForTimeout(300);
      const m = await rolagemHorizontal(page);
      expect(m.scrollWidth, `${onde} em ${l}: scrollWidth do <html> = clientWidth`).toBe(m.clientWidth);
      expect(m.andou, `${onde} em ${l}: scrollTo para a direita não anda`).toBe(0);
    }
  };

  test('login', async ({ page }) => {
    await page.goto('/painel/');
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await conferir(page, 'login');
  });

  test('quadro de pedidos e a lista de 390 px', async ({ page }) => {
    await page.setViewportSize(JANELAS[1280]);
    await entrar(page);
    await expect(page.locator('.pn-desktop')).toBeVisible();
    await conferir(page, 'pedidos');
    await expect(page.locator('.pn-mobile')).toBeVisible();
  });

  test('quadro vazio', async ({ page }) => {
    await page.setViewportSize(JANELAS[1280]);
    await entrar(page, { pedidos: [] });
    await conferir(page, 'quadro vazio');
  });

  for (const view of VIEWS.slice(1)) {
    test(view, async ({ page }) => {
      await page.setViewportSize(JANELAS[1280]);
      await entrar(page);
      await ir(page, view);
      await conferir(page, view);
    });
  }
});

// ---------- 1. alvos de toque ----------
test.describe(`alvos de toque ≥ ${ALVO}×${ALVO}`, () => {
  const sem = async (page, raiz, onde, minimoConferidos = 3) => {
    await page.waitForTimeout(450); // os painéis entram com opacidade 0 (até 400 ms) e checkVisibility os esconde
    const { pequenos, conferidos } = await alvosPequenos(page, raiz, ALVO);
    expect(conferidos, `${onde}: controles visíveis conferidos`).toBeGreaterThanOrEqual(minimoConferidos);
    expect(
      pequenos.map((p) => `${p.quem} "${p.texto}" ${p.medida}`),
      `${onde}: controles com menos de ${ALVO}×${ALVO}`
    ).toEqual([]);
  };

  test('login (390 e 1280)', async ({ page, largura }) => {
    await page.goto('/painel/');
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await sem(page, null, `login em ${largura}`);
  });

  test('lista de 390 px, com pedidos e vazia', async ({ page, largura }) => {
    test.skip(largura !== 390, 'a lista é a interface de 390 px');
    const dados = await entrar(page);
    await expect(page.locator('.pn-mobile')).toBeVisible();
    await sem(page, '.pn-mobile', 'lista de 390 px com pedidos');
    dados.pedidos = [];
    await page.evaluate(() => window.ML.store.recarregar());
    await expect(page.locator('.pn-mobile .pn-vazio')).toBeVisible();
    await sem(page, null, 'lista de 390 px vazia', 1);
  });

  test.describe('computador', () => {
    test.beforeEach(async ({ largura }) => {
      test.skip(largura !== 1280, 'interface de computador');
    });

    test('quadro de pedidos, vazio e com um pedido novo chegando', async ({ page }) => {
      const dados = await entrar(page);
      await expect(page.locator('.pn-card')).toHaveCount(6); // cancelado fica fora do quadro
      await sem(page, null, 'quadro de pedidos', 40);
      await chegaPedido(page, dados);
      await sem(page, null, 'quadro com o pedido novo chegando', 40);
      dados.pedidos = [];
      await page.evaluate(() => window.ML.store.recarregar());
      await expect(page.locator('.pn-card')).toHaveCount(0);
      await sem(page, null, 'quadro vazio');
    });

    for (const view of VIEWS.slice(1)) {
      test(view, async ({ page }) => {
        await entrar(page);
        await ir(page, view);
        await sem(page, null, view);
      });
    }

    test('cancelar (mini-diálogo dentro do card)', async ({ page }) => {
      await entrar(page);
      await page.locator('.pn-card[data-id$="01"] [data-act="cancelar"]').click();
      await expect(page.locator('.pn-cancel')).toBeVisible();
      await sem(page, '.pn-cancel', 'cancelar');
    });

    test('comanda para imprimir', async ({ page }) => {
      await entrar(page);
      await page.locator('.pn-card[data-id$="01"] [data-act="imprimir"]').click();
      await expect(page.locator('.pn-modal')).toBeVisible();
      await sem(page, '.pn-modal', 'comanda', 2);
    });

    test('detalhe do pedido (painel lateral) e CSV', async ({ page }) => {
      await entrar(page);
      await ir(page, 'historico');
      await page.locator('[data-act="detalhe"]').first().click();
      await expect(page.locator('[data-lateral].pn-lateral--aberta')).toBeVisible();
      await sem(page, '[data-lateral]', 'detalhe do pedido');
      await page.locator('[data-lateral] [data-act="fechar-lateral"]').click();
      await page.locator('[data-act="csv-ver"]').click();
      await expect(page.locator('.pn-modal')).toBeVisible();
      await sem(page, '.pn-modal', 'CSV');
    });

    test('confirmação de apagar os pedidos de teste', async ({ page }) => {
      await entrar(page);
      await ir(page, 'config');
      await page.locator('[data-act="apagar"]').click(); // só abre a confirmação: nada é apagado
      await expect(page.locator('[data-confirma]')).toBeVisible();
      await sem(page, '[data-confirma]', 'confirmação de apagar', 1);
      await sem(page, null, 'configurações com a confirmação aberta');
    });
  });

  test('controle: um botão de 40×40 aparece', async ({ page }) => {
    await page.goto('/painel/');
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'planta-pequena';
      b.style.cssText = 'width:40px;height:40px;position:fixed;right:4px;bottom:4px;z-index:9';
      b.setAttribute('aria-label', 'planta');
      document.body.appendChild(b);
    });
    const { pequenos } = await alvosPequenos(page, null, ALVO);
    expect(pequenos.map((p) => p.quem)).toContain('button#planta-pequena');
  });
});

// ---------- 3. movimento reduzido e aba oculta ----------
test.describe('movimento reduzido: nenhuma animação (document.getAnimations() vazio)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
  const parado = async (page, onde) => {
    await page.waitForTimeout(300);
    expect(
      (await lerAnimacoes(page)).map((a) => `${a.nome} (${a.estado}) em ${a.alvo}`),
      `${onde}: document.getAnimations()`
    ).toEqual([]);
  };

  test('login', async ({ page }) => {
    await page.goto('/painel/');
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await parado(page, 'login');
  });

  test('lista de 390 px, com pedidos e vazia', async ({ page, largura }) => {
    test.skip(largura !== 390, 'a lista é a interface de 390 px');
    const dados = await entrar(page);
    await parado(page, 'lista de 390 px');
    dados.pedidos = [];
    await page.evaluate(() => window.ML.store.recarregar());
    await expect(page.locator('.pn-mobile .pn-vazio')).toBeVisible();
    await parado(page, 'lista vazia (o ícone do truck não flutua)');
  });

  test.describe('computador', () => {
    test.beforeEach(async ({ largura }) => {
      test.skip(largura !== 1280, 'interface de computador');
    });

    test('quadro (com atraso), pedido novo chegando e as abas', async ({ page }) => {
      const dados = await entrar(page);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      await expect(page.locator('.pn-tempo[data-nivel="atraso"]')).toBeVisible();
      await parado(page, 'quadro com pedido em atraso');
      await chegaPedido(page, dados);
      await expect(page.locator('.pn-card[data-id$="08"]')).toHaveClass(/pn-destaque/); // vira só borda fixa
      await parado(page, 'pedido novo chegando (destaque, toast e contador)');
      for (const view of VIEWS.slice(1)) {
        await ir(page, view);
        await parado(page, view);
      }
    });

    test('painéis por cima e quadro vazio', async ({ page }) => {
      const dados = await entrar(page);
      await page.locator('.pn-card[data-id$="01"] [data-act="cancelar"]').click();
      await expect(page.locator('.pn-cancel')).toBeVisible();
      await parado(page, 'cancelar');
      await page.locator('.pn-card[data-id$="01"] [data-act="imprimir"]').click();
      await expect(page.locator('.pn-modal')).toBeVisible();
      await parado(page, 'comanda');
      await page.keyboard.press('Escape');
      dados.pedidos = [];
      await page.evaluate(() => window.ML.store.recarregar());
      await expect(page.locator('.pn-card')).toHaveCount(0);
      await parado(page, 'quadro vazio (o ícone do truck não flutua)');
    });
  });
});

test.describe('aba oculta pausa as animações infinitas', () => {
  const infinitas = async (page) => (await lerAnimacoes(page)).filter((a) => a.infinita);
  async function pausa(page, onde) {
    const aVista = await infinitas(page);
    expect(aVista.length, `${onde}: animações infinitas na tela`).toBeGreaterThan(0);
    expect(aVista.filter((a) => a.estado !== 'running').map((a) => a.nome), `${onde}: com a aba visível todas rodam`).toEqual([]);
    await ocultarAba(page);
    await expect(page.locator('html')).toHaveClass(/pn-aba-oculta/);
    await page.waitForTimeout(200);
    expect(
      (await infinitas(page)).filter((a) => a.estado !== 'paused').map((a) => `${a.nome} em ${a.alvo} (${a.estado})`),
      `${onde}: infinitas que seguem rodando com a aba oculta`
    ).toEqual([]);
    await mostrarAba(page);
    await expect(page.locator('html')).not.toHaveClass(/pn-aba-oculta/);
    await page.waitForTimeout(200);
    expect((await infinitas(page)).filter((a) => a.estado === 'running').length, `${onde}: voltando à aba, voltam a rodar`).toBeGreaterThan(0);
  }

  test('quadro com pedido em atraso (zumbido do status da loja e respiração do tempo)', async ({ page, largura }) => {
    test.skip(largura !== 1280, 'interface de computador');
    await entrar(page);
    await expect(page.locator('.pn-tempo[data-nivel="atraso"]')).toBeVisible();
    const nomes = (await infinitas(page)).map((a) => a.nome);
    expect(nomes).toEqual(expect.arrayContaining(['pn-zumbido', 'pn-respira']));
    await pausa(page, 'quadro');
  });

  test('quadro vazio (o ícone do truck flutua)', async ({ page, largura }) => {
    test.skip(largura !== 1280, 'interface de computador');
    await entrar(page, { pedidos: [] });
    expect((await infinitas(page)).map((a) => a.nome)).toContain('pn-flutua');
    await pausa(page, 'quadro vazio');
  });

  test('lista de 390 px vazia (o ícone do truck flutua)', async ({ page, largura }) => {
    test.skip(largura !== 390, 'a lista é a interface de 390 px');
    await entrar(page, { pedidos: [] });
    await expect(page.locator('.pn-mobile .pn-vazio')).toBeVisible();
    expect((await infinitas(page)).map((a) => a.nome)).toContain('pn-flutua');
    await pausa(page, 'lista vazia');
  });
});

// ---------- 4. só transform, opacity e clip-path ----------
test.describe('keyframes só com transform, opacity e clip-path', () => {
  test('todo @keyframes do CSS do painel', async ({ page }) => {
    await page.goto('/painel/');
    const todos = await keyframesDoCss(page);
    expect(todos.length, '@keyframes lidos das folhas de estilo').toBeGreaterThan(8);
    expect(
      todos.filter((k) => propriedadesProibidas(k.props).length).map((k) => `${k.nome}: ${propriedadesProibidas(k.props).join(', ')}`),
      '@keyframes que animam outra propriedade'
    ).toEqual([]);
    // as três que animavam box-shadow e stroke-dasharray seguem existindo, agora só com opacity
    for (const nome of ['pn-pisca', 'pn-respira', 'pn-anel']) expect(todos.map((k) => k.nome), `@keyframes ${nome}`).toContain(nome);
  });

  test('animações vivas da jornada', async ({ page, largura }) => {
    test.skip(largura !== 1280, 'interface de computador');
    test.setTimeout(90_000);
    await instalarGravador(page);
    const dados = await entrar(page);
    await page.waitForTimeout(800);
    await chegaPedido(page, dados); // entra, destaque, contador e toast
    await page.waitForTimeout(1800);
    await page.locator('.pn-card[data-id$="01"] [data-act="cancelar"]').click(); // mini-diálogo entra
    await page.waitForTimeout(500);
    await page.locator('.pn-card[data-id$="01"] [data-act="imprimir"]').click(); // modal
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await ir(page, 'relatorio'); // anel, barras e colunas crescem
    await page.waitForTimeout(1200);
    await ir(page, 'historico');
    await page.locator('[data-act="detalhe"]').first().click();
    await page.waitForTimeout(600);
    const g = await lerGravacao(page);
    const nomes = Object.keys(g);
    for (const esperado of ['pn-zumbido', 'pn-respira', 'pn-entra', 'pn-pisca', 'pn-anel', 'pn-cresce'])
      expect(nomes, `animação "${esperado}" vista na jornada`).toContain(esperado);
    const ruins = Object.entries(g)
      .filter(([, v]) => propriedadesProibidas(v.props).length)
      .map(([nome, v]) => `${nome} (${v.alvos.join(' | ')}): ${propriedadesProibidas(v.props).join(', ')}`);
    expect(ruins, 'animações vivas que mexem em outra propriedade').toEqual([]);
  });
});

// ---------- 5. CSP ----------
test.describe("nenhuma violação de CSP (script-src 'self', sem script nem handler inline, sem iframe)", () => {
  async function semViolacao(page, csp, onde) {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const inline = await page.evaluate(() => ({
      scripts: [...document.scripts].filter((s) => !s.src && s.type !== 'application/ld+json' && s.textContent.trim()).length,
      handlers: [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName.toLowerCase()}[${a.name}]`)),
      iframes: document.querySelectorAll('iframe').length,
      javascript: [...document.querySelectorAll('[href^="javascript:" i]')].length
    }));
    expect(inline, `${onde}: script ou handler inline, iframe`).toEqual({ scripts: 0, handlers: [], iframes: 0, javascript: 0 });
    expect(await csp.todas(), `${onde}: violações de CSP`).toEqual([]);
  }

  test('login', async ({ page }) => {
    const csp = await vigiarCsp(page);
    await page.goto('/painel/');
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await semViolacao(page, csp, 'login');
    expect(await csp.canarioBloqueado(), 'a CSP está valendo (um script inline injetado não roda)').toBe(true);
  });

  test('quadro, abas e painéis por cima', async ({ page, largura }) => {
    const csp = await vigiarCsp(page);
    await entrar(page);
    if (largura === 1280) {
      await expect(page.locator('.pn-desktop')).toBeVisible();
      for (const view of VIEWS.slice(1)) await ir(page, view);
      await ir(page, 'pedidos');
      await page.locator('.pn-card[data-id$="01"] [data-act="imprimir"]').click();
      await expect(page.locator('.pn-modal')).toBeVisible();
    } else {
      await expect(page.locator('.pn-mobile')).toBeVisible();
    }
    await semViolacao(page, csp, 'painel');
    expect(await csp.canarioBloqueado(), 'a CSP está valendo (um script inline injetado não roda)').toBe(true);
  });
});

// ---------- 6. cabeçalho ----------
test.describe('cabeçalho', () => {
  // 14:00 de terça (13/10/2026): fechado, o status mais comprido ("Fechado agora · abre hoje às 19h"). O modo da loja volta a 'auto'
  // só na resposta da API (o banco é compartilhado e pode estar em 'aberta').
  async function fechado(page) {
    await page.clock.setFixedTime(new Date('2026-10-13T14:00:00-03:00'));
    await page.route('**/rest/v1/rpc/estado_cardapio', async (route) => {
      const resposta = await route.fetch();
      const json = await resposta.json();
      if (json && json.loja) json.loja.modo = 'auto';
      await route.fulfill({ response: resposta, json });
    });
  }

  test('celular (390): selo de 64 px e o status da loja no topo da lista', async ({ page, largura }) => {
    test.skip(largura !== 390, 'a lista é a interface de 390 px');
    await fechado(page);
    await entrar(page);
    const selo = page.locator('.pn-mobile .pn-m-topo .pn-selo-logo');
    await expect(selo).toBeVisible();
    const caixa = await selo.boundingBox();
    expect([Math.round(caixa.width), Math.round(caixa.height)], 'selo do cabeçalho em CSS px').toEqual([64, 64]);
    expect(await selo.evaluate((i) => i.currentSrc), 'arte do selo').toMatch(/[/]assets[/]logo[/]selo-(128|256)[.]webp$/);
    const status = page.locator('.pn-mobile [data-lojatxt-m]');
    await expect(status).toHaveClass(/pn-loja-txt--off/);
    await expect(status).toHaveText(/^Fechado/i);
    expect(await status.evaluate((e) => e.textContent), 'o mesmo texto do status do computador').toBe(await page.locator('[data-lojatxt]').evaluate((e) => e.textContent));
    const topo = await page.locator('.pn-mobile .pn-m-topo').boundingBox();
    const m = await rolagemHorizontal(page);
    expect(m.scrollWidth, 'sem rolagem horizontal com o cabeçalho').toBe(m.clientWidth);
    expect(topo.x + topo.width, 'o cabeçalho cabe na janela').toBeLessThanOrEqual(JANELAS[390].width);
  });

  test('computador (1280): a barra superior fica no mesmo lugar em todas as telas, mesmo com o status mais comprido', async ({ page, largura }) => {
    test.skip(largura !== 1280, 'interface de computador');
    await fechado(page);
    await entrar(page);
    const lugares = {};
    for (const view of VIEWS) {
      if (view !== 'pedidos') await ir(page, view);
      const caixa = async (sel) => {
        const b = await page.locator(sel).boundingBox();
        return [Math.round(b.x), Math.round(b.y)];
      };
      lugares[view] = { segmentado: await caixa('.pn-seg'), status: await caixa('[data-lojatxt]'), relogio: await caixa('[data-relogio]'), som: await caixa('[data-act="som"]') };
    }
    const referencia = lugares.pedidos;
    for (const view of VIEWS) expect(lugares[view], `barra superior em ${view} (x, y) contra a de pedidos`).toEqual(referencia);
  });
});
