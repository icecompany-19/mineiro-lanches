// Aceite das 6 telas do cliente (docs/DIRECAO-VISUAL.md §8: "Movimento e desempenho", "Dados", "Foco e alvos"; plano A10):
// bio, cardápio, ficha, sacola, checkout e acompanhamento. Cada tela é conferida em 390 (projeto celular) e em 1280
// (projeto desktop); a rolagem horizontal olha as duas larguras nos dois projetos.
//   1. nenhuma rolagem horizontal (scrollWidth === clientWidth);
//   2. movimento reduzido: nada em andamento em document.getAnimations(), nem depois de tocar nos botões (WAAPI);
//   3. só transform, opacity e clip-path nos keyframes: os @keyframes do CSS e tudo o que se vê rodar numa jornada;
//   4. aba oculta pausa as animações infinitas (html.aba-oculta);
//   5. a luz segue o truck: loja 'fechada' dentro do horário apaga a parede e o neon diz fechado; 'aberta' fora do
//      horário acende (o relógio é fixado por page.clock e o modo vem da RESPOSTA de estado_cardapio, nunca do banco);
//   6. botões, links, inputs e [role=button] visíveis com ≥ 44×44 px;
//   7. por Tab, outline de 3 px na cor do fio em cada controle;
//   8. nenhuma violação de CSP (a CSP do vercel.json é posta na resposta do HTML; um script inline de teste prova que vale).
// Uso: npx playwright test tests/aceite-cliente.spec.js --project=celular --project=desktop
//      (precisa do Supabase local no ar: a página lê estado_cardapio; nada é gravado no banco)
//
// Como o spec mede (decisões que não estão no plano):
// - alvo de toque = caixa do controle somada à dos pseudo-elementos absolutos dele (o `.filtro` tem 36 px de corpo e o
//   `::after{inset:-6px 0}` o leva a 45, acima dos 44 da DIRECAO 4.2). Link no meio de uma
//   frase é isento (WCAG 2.5.8);
// - o anel de foco na comanda (papel claro) é --placa-escura, não o --fio que some no papel (app.css: `.comanda
//   :focus-visible`); no campo de busca o anel é do <label> (`.busca label:focus-within`), o <input> tem outline:none;
// - "em andamento" = tudo menos o que já terminou (animation-fill-mode: both deixa a animação terminada na lista);
// - as animações da própria View Transition do navegador (-ua-…) não são do app e ficam de fora do gravador.
//
// Os defeitos do front que este spec encontrou foram corrigidos; os casos ficam no fim do arquivo.
/* global document, window, localStorage, getComputedStyle, matchMedia */
import { test as base, expect as expectBase } from '@playwright/test';
import {
  JANELAS,
  buscar,
  larguraDoProjeto,
  instalarApoio,
  rolagemHorizontal,
  alvosPequenos,
  percorrerTab,
  lerAnimacoes,
  emAndamento,
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
  // janela do projeto antes de qualquer navegação, e as ferramentas dentro da página
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

// ---------- dados da página ----------
const FIO = 'rgb(255, 204, 0)';
const PLACA_ESCURA = 'rgb(150, 4, 10)';
const VERMELHO_LUZ = 'rgb(255, 106, 92)';
const NEON_ABERTO = 'rgb(91, 227, 138)';
// quarta-feira, 14/10/2026: o turno é 19h–0h. 20:00 em São Paulo = 23:00Z (aberto); 14:00 = 17:00Z (fechado)
const AS_20H = new Date('2026-10-14T23:00:00Z');
const AS_14H = new Date('2026-10-14T17:00:00Z');
const TOKEN = '8c1f6a52-4b7e-4d3a-9f10-2a6b5c4d3e21';
// saída de acompanhar_pedido (pedido_json): o acompanhamento não grava nada no banco
const pedidoNoStatus = (status) => ({
  numero: 7,
  criadoEm: '2026-10-14T22:52:00+00:00',
  status,
  modo: 'entrega',
  total: 42.8,
  historico: [{ status: 'novo', em: '2026-10-14T22:52:00+00:00' }].concat(status === 'novo' ? [] : [{ status: 'preparo', em: '2026-10-14T22:55:00+00:00' }]),
  itens: [
    { nome: 'Gran Burger', qtd: 1, resumo: 'Completo', subtotal: 25.9 },
    { nome: 'X-Burguer', qtd: 1, resumo: 'Completo', subtotal: 16.9 }
  ]
});
const linhaDaSacola = (produtoId) => ({
  chave: produtoId + '|aceite',
  sel: { produtoId, completo: true, removidos: [], prensado: false, combo: { ativo: false, refri: '' }, adicionais: {}, sabor: '', qtd: 1 }
});

// ---------- como chegar em cada tela ----------
// estado_cardapio real, com a mudança aplicada por cima (o banco fica como está)
async function mudarEstado(page, mudar) {
  await page.route('**/rest/v1/rpc/estado_cardapio', async (r) => {
    const resposta = await buscar(r);
    const j = await resposta.json();
    mudar(j);
    await r.fulfill({ response: resposta, json: j });
  });
}

const TELAS = {
  bio: { tela: '[data-screen="bio"]', raiz: null, paradasMin: 15 },
  cardapio: { tela: '[data-screen="menu"]', raiz: null, paradasMin: 80 },
  ficha: { tela: '#ficha', raiz: '#ficha', paradasMin: 8 },
  sacola: { tela: '[data-screen="sacola"]', raiz: null, paradasMin: 6 },
  checkout: { tela: '[data-screen="checkout"]', raiz: null, paradasMin: 8 },
  pedido: { tela: '[data-screen="pedido"]', raiz: null, paradasMin: 3 },
  // diálogo da bio, conferido junto (alvos e foco)
  story: { tela: '#story', raiz: '#story', paradasMin: 3 }
};
// a ficha abre sobre o cardápio e o story sobre a bio
const FUNDO = { ficha: 'cardapio', story: 'bio' };
const SEIS_TELAS = ['bio', 'cardapio', 'ficha', 'sacola', 'checkout', 'pedido'];

// opcoes: modo da loja (resposta do estado_cardapio), relógio fixo, status do pedido acompanhado
async function abrir(page, nome, { modo = 'auto', hora = AS_20H, status = 'preparo' } = {}) {
  await page.clock.setFixedTime(hora);
  await mudarEstado(page, (j) => {
    j.loja.modo = modo;
  });
  await page.route('**/rest/v1/rpc/acompanhar_pedido', (r) => r.fulfill({ json: pedidoNoStatus(status) }));
  let hash = '/#bio';
  if (nome === 'cardapio' || nome === 'ficha') hash = '/#cardapio';
  if (nome === 'sacola' || nome === 'checkout') {
    // sacola guardada no aparelho antes de a página carregar (só se ainda não houver)
    await page.addInitScript((s) => {
      if (!localStorage.getItem('mineiro:v2:sacola')) localStorage.setItem('mineiro:v2:sacola', JSON.stringify(s));
    }, [linhaDaSacola('gran-burger'), linhaDaSacola('x-burguer')]);
    hash = '/#' + nome;
  }
  if (nome === 'pedido') hash = '/#pedido/' + TOKEN;
  await page.goto(hash);
  await expect(page.locator(TELAS[FUNDO[nome] || nome].tela)).toBeVisible({ timeout: 15_000 });
  // o estado do banco (modo da loja) já foi aplicado
  await page.waitForFunction((m) => window.ML && window.ML.store && window.ML.store.loja().modo === m, modo);
  if (nome === 'ficha') {
    await page.locator('#prod-gran-burger').click();
    await expect(page.locator('#ficha')).toBeVisible();
  }
  if (nome === 'story') {
    await page.locator('.story-btn').first().click();
    await expect(page.locator('#story')).toBeVisible();
  }
  if (nome === 'pedido') await expect(page.locator('#ped-num')).toHaveText('#0007');
  await page.waitForTimeout(300);
}

// rola a página inteira (as imagens lazy entram)
async function rolarTudo(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(window.innerHeight * 0.8)) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
}

// ---------- 1. rolagem horizontal ----------
test.describe('sem rolagem horizontal (390 e 1280)', () => {
  for (const nome of SEIS_TELAS) {
    test(nome, async ({ page }) => {
      await abrir(page, nome);
      for (const l of [390, 1280]) {
        await page.setViewportSize(JANELAS[l]);
        await page.waitForTimeout(300);
        const m = await rolagemHorizontal(page);
        expect(m.scrollWidth, `${nome} em ${l}: scrollWidth do <html> = clientWidth`).toBe(m.clientWidth);
        expect(m.bodyScrollWidth, `${nome} em ${l}: scrollWidth do <body> não passa do clientWidth`).toBeLessThanOrEqual(m.clientWidth);
        expect(m.andou, `${nome} em ${l}: scrollTo para a direita não anda`).toBe(0);
      }
    });
  }
});

// ---------- 2. movimento reduzido ----------
test.describe('movimento reduzido', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  for (const nome of SEIS_TELAS) {
    test(`${nome}: nada em andamento`, async ({ page }) => {
      await abrir(page, nome);
      await page.waitForTimeout(700); // passa o atraso que o base.css não zera (.1 a .5 s)
      const vivas = emAndamento(await lerAnimacoes(page));
      expect(
        vivas.map((a) => `${a.nome} (${a.estado}${a.infinita ? ', infinita' : ''}) em ${a.alvo}`),
        `animações em andamento em ${nome} com prefers-reduced-motion`
      ).toEqual([]);
    });
  }

  // as animações feitas em JS (WAAPI): voo da foto até a sacola, ficha, total que rola, brilho e fumaça da placa
  test('jornada inteira: tocar nos botões não começa animação', async ({ page }) => {
    const parado = async (onde) => {
      await page.waitForTimeout(250);
      const vivas = emAndamento(await lerAnimacoes(page));
      expect(
        vivas.map((a) => `${a.nome} (${a.estado}) em ${a.alvo}`),
        `animações em andamento: ${onde}`
      ).toEqual([]);
    };
    // sessão nova: a placa da bio faria a entrada (também parada com movimento reduzido)
    await page.route('**/rest/v1/rpc/criar_pedido', () => {}); // fica pendente: o pedido nunca chega ao banco
    await abrir(page, 'bio');
    await parado('bio');
    await page.locator('[data-screen="bio"] [data-placa]').click();
    await parado('toque na placa (piscadas, brilho e fumaça)');
    await page.locator('.story-btn').first().click();
    await expect(page.locator('#story')).toBeVisible();
    await parado('story aberta');
    await page.locator('[data-fechar-story]').click();
    await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
    await expect(page.locator('[data-screen="menu"]')).toBeVisible();
    await parado('cardápio');
    await page.locator('[data-rapido]').first().click();
    await expect(page.locator('[data-contador]').first()).toBeVisible();
    await parado('"+" (voo da foto, toast e contador)');
    await page.locator('#prod-gran-burger').click();
    await expect(page.locator('#ficha')).toBeVisible();
    await parado('ficha aberta');
    await page.locator('#ficha [data-combo]').first().click();
    await page.locator('#ficha [data-fq="1"]').click();
    await parado('combo e quantidade na ficha (total que rola)');
    await page.locator('#ficha-add').click();
    await expect(page.locator('#ficha')).toBeHidden();
    await parado('adicionar à sacola (miniatura que voa)');
    await page.locator('#barra [data-go="sacola"]').click();
    await expect(page.locator('[data-screen="sacola"]')).toBeVisible();
    await parado('sacola');
    await page.locator('#btn-continuar').click();
    await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
    await page.locator('#f-nome').fill('Ana Teste');
    await page.locator('#f-tel').fill('11985720150');
    await page.locator('[data-modo="local"]').click();
    await page.locator('#btn-enviar').click();
    await expect(page.locator('#btn-enviar')).toHaveClass(/enviando/);
    await parado('enviando (barra de calor e ícone)');
  });
});

// ---------- 3. só transform, opacity e clip-path ----------
// Nenhum @keyframes do cliente pode animar outra propriedade (progresso e destaca foram corrigidos em 12/10).
const KEYFRAMES_PROIBIDOS = new Set();

test.describe('keyframes só com transform, opacity e clip-path', () => {
  test('todo @keyframes do CSS do cliente', async ({ page }) => {
    await page.goto('/#bio');
    const todos = await keyframesDoCss(page);
    expect(todos.length, '@keyframes lidos das folhas de estilo').toBeGreaterThan(25);
    expect(
      todos.filter((k) => !KEYFRAMES_PROIBIDOS.has(k.nome) && propriedadesProibidas(k.props).length).map((k) => `${k.nome}: ${propriedadesProibidas(k.props).join(', ')}`),
      '@keyframes que animam outra propriedade'
    ).toEqual([]);
    // lista de exceções conhecidas (vazia desde 12/10)
    for (const nome of KEYFRAMES_PROIBIDOS) {
      const k = todos.find((x) => x.nome === nome);
      if (k) expect(propriedadesProibidas(k.props).length, `@keyframes ${nome} segue fora da regra`).toBeGreaterThan(0);
    }
  });

  // o que se vê rodar de verdade, CSS e WAAPI, numa jornada com movimento normal
  test('animações vivas da jornada (CSS e WAAPI)', async ({ page }) => {
    test.setTimeout(90_000);
    await instalarGravador(page);
    await page.route('**/rest/v1/rpc/criar_pedido', () => {}); // pendente: nada chega ao banco
    await abrir(page, 'bio');
    await page.waitForTimeout(1500); // entrada da placa (mola, lampejos, halo, anel)
    await page.locator('[data-screen="bio"] [data-placa]').click(); // piscadas, brilho e fumaça
    await page.waitForTimeout(1000);
    await page.locator('.story-btn').first().click();
    await page.waitForTimeout(600);
    await page.locator('[data-fechar-story]').click();
    await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
    await expect(page.locator('[data-screen="menu"]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.locator('[data-rapido]').first().click(); // voo da foto, toast, contador
    await page.waitForTimeout(900);
    await page.locator('#prod-gran-burger').click(); // ficha: foto entra e fumaça
    await expect(page.locator('#ficha')).toBeVisible();
    await page.waitForTimeout(700);
    await page.locator('#ficha [data-combo]').first().click(); // total rola
    await page.locator('#ficha [data-fq="1"]').click();
    await page.waitForTimeout(500);
    await page.locator('#ficha-add').click(); // miniatura voa
    await page.waitForTimeout(900);
    await page.locator('#barra [data-go="sacola"]').click();
    await page.waitForTimeout(600);
    await page.locator('#btn-continuar').click();
    await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
    await page.locator('#f-nome').fill('Ana Teste');
    await page.locator('#f-tel').fill('11985720150');
    await page.locator('[data-modo="local"]').click();
    await page.locator('#btn-enviar').click(); // enviando: barra de calor
    await expect(page.locator('#btn-enviar')).toHaveClass(/enviando/);
    await page.waitForTimeout(800);
    const g = await lerGravacao(page);
    const nomes = Object.keys(g);
    // a jornada realmente rodou animações (senão o teste não prova nada)
    for (const esperado of ['placa-chega', 'placa-acende', 'halo-respira', 'anel-gira', 'brasa', 'fumaca-sobe', 'calor'])
      expect(nomes, `animação "${esperado}" vista na jornada`).toContain(esperado);
    expect(nomes.filter((n) => n.startsWith('waapi@')).length, 'animações feitas em JS (WAAPI) vistas na jornada').toBeGreaterThanOrEqual(3);
    const ruins = Object.entries(g)
      .filter(([nome]) => !nome.startsWith('-ua-') && !KEYFRAMES_PROIBIDOS.has(nome))
      .map(([nome, v]) => [nome, v, propriedadesProibidas(v.props).filter((p) => !(nome.includes('ficha-foto') && p === 'borderRadius'))])
      .filter(([, , proibidas]) => proibidas.length)
      .map(([nome, v, proibidas]) => `${nome} (${v.alvos.join(' | ')}): ${proibidas.join(', ')}`);
    expect(ruins, 'animações vivas que mexem em outra propriedade').toEqual([]);
  });
});

// ---------- 4. aba oculta ----------
test.describe('aba oculta pausa as animações infinitas', () => {
  // bio: brasas, halo, anel e o zumbido do neon; acompanhamento "Na chapa": fumaça
  for (const nome of ['bio', 'pedido']) {
    test(nome, async ({ page }) => {
      await abrir(page, nome);
      await page.waitForTimeout(800);
      const infinitas = async () => (await lerAnimacoes(page)).filter((a) => a.infinita);
      const aVista = await infinitas();
      expect(aVista.length, `${nome}: animações infinitas na tela`).toBeGreaterThan(0);
      expect(aVista.filter((a) => a.estado !== 'running').map((a) => a.nome), `${nome}: com a aba visível todas rodam`).toEqual([]);

      await ocultarAba(page);
      await expect(page.locator('html')).toHaveClass(/aba-oculta/);
      await page.waitForTimeout(200);
      const paradas = await infinitas();
      expect(
        paradas.filter((a) => a.estado !== 'paused').map((a) => `${a.nome} em ${a.alvo} (${a.estado})`),
        `${nome}: infinitas que seguem rodando com a aba oculta`
      ).toEqual([]);

      await mostrarAba(page);
      await expect(page.locator('html')).not.toHaveClass(/aba-oculta/);
      await page.waitForTimeout(200);
      expect((await infinitas()).filter((a) => a.estado === 'running').length, `${nome}: voltando à aba, voltam a rodar`).toBeGreaterThan(0);
    });
  }
});

// ---------- 5. a luz segue o truck ----------
const CASOS_DE_LUZ = [
  { modo: 'auto', hora: AS_20H, rotulo: 'automático às 20h', luz: 'acesa', motivo: 'turno', classe: 'aberto', cor: NEON_ABERTO, texto: /^Aberto agora · até meia-noite$/ },
  { modo: 'auto', hora: AS_14H, rotulo: 'automático às 14h', luz: 'apagada', motivo: 'antes', classe: 'fechado', cor: VERMELHO_LUZ, texto: /^Fechado agora · abre hoje às 19h$/ },
  { modo: 'fechada', hora: AS_20H, rotulo: 'fechada dentro do horário (20h)', luz: 'apagada', motivo: 'pausa', classe: 'fechado', cor: VERMELHO_LUZ, texto: /^Fechado agora · o truck pausou os pedidos$/ },
  { modo: 'aberta', hora: AS_14H, rotulo: 'aberta fora do horário (14h)', luz: 'acesa', motivo: 'turno', classe: 'aberto', cor: NEON_ABERTO, texto: /^Aberto agora \(horário estendido\)$/ }
];

test.describe('a luz segue o truck (modo da loja × hora)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // a parede acende em 900 ms: sem a transição o valor já é o final
  });

  for (const c of CASOS_DE_LUZ) {
    test(`bio e cardápio, ${c.rotulo}`, async ({ page }) => {
      await abrir(page, 'bio', c);
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-luz', c.luz);
      await expect(html).toHaveAttribute('data-luz-motivo', c.motivo);
      const neon = page.locator('.bio-id [data-status]');
      await expect(neon).toHaveClass(new RegExp(`\\b${c.classe}\\b`));
      await expect(neon).toHaveText(c.texto);
      await expect(neon).toHaveCSS('color', c.cor);
      await expect(neon).toHaveCSS('border-top-color', c.cor);
      // a parede da bio apaga (.35) ou acende (1)
      await expect.poll(() => page.locator('.bio-topo').evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe(c.luz === 'acesa' ? '1' : '0.35');

      await page.locator('.bio-ctas').getByRole('button', { name: 'Fazer pedido' }).click();
      await expect(page.locator('[data-screen="menu"]')).toBeVisible();
      await expect(html).toHaveAttribute('data-luz', c.luz);
      const curto = page.locator('[data-status-curto]');
      await expect(curto).toHaveClass(new RegExp(`\\b${c.classe}\\b`));
      await expect(curto).toContainText(c.classe === 'aberto' ? 'Aberto' : 'Fechado');
    });
  }

  // a luz é do <html>: vale em todas as telas, inclusive as que não têm o selo de horário
  for (const nome of SEIS_TELAS) {
    test(`${nome}: loja fechada dentro do horário apaga a luz; aberta fora do horário acende`, async ({ page }) => {
      await abrir(page, nome, { modo: 'fechada', hora: AS_20H });
      await expect(page.locator('html')).toHaveAttribute('data-luz', 'apagada');
      await expect(page.locator('html')).toHaveAttribute('data-luz-motivo', 'pausa');
      // outra carga, agora com a loja aberta fora do horário (14h)
      await page.goto('about:blank');
      await abrir(page, nome, { modo: 'aberta', hora: AS_14H });
      await expect(page.locator('html')).toHaveAttribute('data-luz', 'acesa');
      await expect(page.locator('html')).toHaveAttribute('data-luz-motivo', 'turno');
    });
  }
});

// ---------- 6. alvos de toque ----------
test.describe('alvos de toque ≥ 44×44', () => {
  for (const nome of [...SEIS_TELAS, 'story']) {
    test(nome, async ({ page, largura }) => {
      await abrir(page, nome);
      const { pequenos, conferidos } = await alvosPequenos(page, TELAS[nome].raiz, 44);
      expect(conferidos, `${nome}: controles visíveis conferidos`).toBeGreaterThan(2);
      expect(
        pequenos.map((p) => `${p.quem} "${p.texto}" ${p.medida}`),
        `${nome} em ${largura}: controles com menos de 44×44`
      ).toEqual([]);
    });
  }
});

// ---------- 7. foco por Tab ----------
const anel = (a, cor) => !!a && a.largura === '3px' && a.estilo === 'solid' && a.cor === cor;
// a parada não tem o anel esperado? (fio sobre o escuro; placa escura na comanda de papel; o <label> no campo de busca)
function semAnel(p) {
  if (!p.focusVisible || !p.visivel) return true;
  if (anel(p.anel, p.naComanda ? PLACA_ESCURA : FIO)) return false;
  return !(p.anel.estilo === 'none' && anel(p.anelDoRotulo, FIO));
}
test.describe('foco por Tab: outline de 3 px na cor do fio', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // o contorno tem transição: sem ela o estilo já é o final
  });

  for (const nome of [...SEIS_TELAS, 'story']) {
    test(nome, async ({ page, largura }) => {
      test.setTimeout(120_000);
      await abrir(page, nome);
      const paradas = await percorrerTab(page);
      expect(paradas.length, `${nome}: paradas do Tab`).toBeGreaterThanOrEqual(TELAS[nome].paradasMin);
      const ruins = paradas
        .filter(semAnel)
        .map((p) => `${p.quem} "${p.texto}": ${p.anel.largura} ${p.anel.estilo} ${p.anel.cor}${p.anelDoRotulo ? ` (rótulo: ${p.anelDoRotulo.largura} ${p.anelDoRotulo.estilo} ${p.anelDoRotulo.cor})` : ''}`);
      expect(ruins, `${nome} em ${largura}: paradas sem o anel esperado`).toEqual([]);
    });
  }
});

// ---------- 8. CSP ----------
test.describe('nenhuma violação de CSP (script-src \'self\', sem script nem handler inline, sem iframe)', () => {
  for (const nome of SEIS_TELAS) {
    test(nome, async ({ page }) => {
      const csp = await vigiarCsp(page);
      await abrir(page, nome);
      await rolarTudo(page);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      // inline: nenhum <script> sem src (fora o JSON-LD), nenhum onclick= e afins, nenhum iframe, nenhum javascript:
      const inline = await page.evaluate(() => ({
        scripts: [...document.scripts].filter((s) => !s.src && s.type !== 'application/ld+json' && s.textContent.trim()).length,
        handlers: [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName.toLowerCase()}[${a.name}]`)),
        iframes: document.querySelectorAll('iframe').length,
        javascript: [...document.querySelectorAll('[href^="javascript:" i]')].length
      }));
      expect(inline, `${nome}: script ou handler inline, iframe`).toEqual({ scripts: 0, handlers: [], iframes: 0, javascript: 0 });
      expect(await csp.todas(), `${nome}: violações de CSP`).toEqual([]);
      expect(await csp.canarioBloqueado(), 'a CSP está valendo (um script inline injetado não roda)').toBe(true);
    });
  }
});

// ---------- controles: as medidas enxergam o defeito ----------
// Um defeito plantado na página tem de aparecer; senão um "verde" acima não prova nada.
test.describe('controles das medidas', () => {
  test('rolagem horizontal: um elemento largo demais aparece', async ({ page }) => {
    await abrir(page, 'bio');
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:0;top:0;width:3000px;height:1px';
      document.body.appendChild(d);
    });
    const m = await rolagemHorizontal(page);
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
    expect(m.andou).toBeGreaterThan(0);
  });

  test('alvo: um botão de 20×20 aparece', async ({ page }) => {
    await abrir(page, 'bio');
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'planta-pequena';
      b.style.cssText = 'width:20px;height:20px;position:fixed;right:4px;bottom:4px;z-index:9';
      b.setAttribute('aria-label', 'planta');
      document.body.appendChild(b);
    });
    const { pequenos } = await alvosPequenos(page, null, 44);
    expect(pequenos.map((p) => p.quem)).toContain('button#planta-pequena');
  });

  test('foco: um botão com outline:none aparece', async ({ page }) => {
    await abrir(page, 'bio');
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'planta-sem-anel';
      b.style.cssText = 'outline:none;min-height:44px';
      b.textContent = 'planta';
      document.body.prepend(b);
    });
    const paradas = await percorrerTab(page);
    expect(paradas.filter(semAnel).map((p) => p.quem)).toEqual(['button#planta-sem-anel']);
  });

  test('movimento: a bio tem animação em andamento sem a preferência, e a preferência liga o media query', async ({ page }) => {
    await abrir(page, 'bio');
    expect(emAndamento(await lerAnimacoes(page)).length, 'animações em andamento com movimento normal').toBeGreaterThan(5);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  });
});

// ================= defeitos do front encontrados pela aceitação (12/10), já corrigidos =================
// Cada caso guarda a asserção que falhava antes da correção.

test.describe('defeitos conhecidos', () => {
  // app.css:103 e :498. `html.aba-oculta` (app.css:68) só lista brasas, halo, anel, fumaça e `.status::after`.
  test('checkout, botão "enviando": calor (`.btn.enviando::after`) e anda (`.btn.enviando .ic`) seguem rodando com a aba oculta', async ({ page }) => {
    await page.route('**/rest/v1/rpc/criar_pedido', () => {}); // pendente: nada chega ao banco
    await abrir(page, 'checkout');
    await page.locator('#f-nome').fill('Ana Teste');
    await page.locator('#f-tel').fill('11985720150');
    await page.locator('[data-modo="local"]').click();
    await page.locator('#btn-enviar').click();
    await expect(page.locator('#btn-enviar')).toHaveClass(/enviando/);
    await page.waitForTimeout(500);
    await ocultarAba(page);
    await page.waitForTimeout(200);
    const infinitas = (await lerAnimacoes(page)).filter((a) => a.infinita);
    expect(infinitas.length, 'infinitas do botão enviando').toBeGreaterThan(0);
    expect(infinitas.filter((a) => a.estado !== 'paused').map((a) => `${a.nome} em ${a.alvo}`)).toEqual([]);
  });

  // app.css:797 e :570. A barra de progresso do story anima `width` em vez de `transform: scaleX`.
  test('story (bio): @keyframes progresso anima `width` (`.story-barras span.agora i`), só transform/opacity/clip-path valem', async ({ page }) => {
    await page.goto('/#bio');
    const k = (await keyframesDoCss(page)).find((x) => x.nome === 'progresso');
    expect(k ? propriedadesProibidas(k.props) : []).toEqual([]);
  });

  // app.css:792 e :309. `.prod.destaca` nunca recebe a classe no app.js (código morto) e o keyframe anima `box-shadow`.
  test('cardápio: @keyframes destaca anima `box-shadow` (`.prod.destaca`, app.css:309), código sem uso no app.js', async ({ page }) => {
    await page.goto('/#bio');
    const k = (await keyframesDoCss(page)).find((x) => x.nome === 'destaca');
    expect(k ? propriedadesProibidas(k.props) : []).toEqual([]);
  });

  // app.css:276-277. O corpo tem 36 px e o `::after{inset:-4px 0}` conta a partir da borda de padding (a borda de 1 a
  // 1,5 px fica dentro): o alvo real é 42 px (conferido com elementFromPoint: acerta de -3 px a +38 px), a direção pede 44.
  test('cardápio, chips de filtro (`button.filtro`, 390 e 1280): área clicável de 42 px de altura (36 + `::after{inset:-4px 0}`), o mínimo é 44', async ({ page }) => {
    await abrir(page, 'cardapio');
    const { pequenos, conferidos } = await alvosPequenos(page, '#filtros', 44);
    expect(conferidos, 'chips de filtro conferidos').toBeGreaterThan(3);
    expect(pequenos.map((p) => `${p.quem} "${p.texto}" ${p.medida}`)).toEqual([]);
  });

  // app.js:395-398. A entrada da ficha é WAAPI com { transform, transformOrigin, borderRadius: '14px' → '0' }.
  test('ficha (aberta pelo card do cardápio): `voarParaFicha` (app.js:395) anima `borderRadius` (14px → 0) em `.ficha-foto img` pelo WAAPI', async ({ page }) => {
    await instalarGravador(page);
    await abrir(page, 'cardapio');
    await page.locator('#prod-gran-burger').click();
    await expect(page.locator('#ficha')).toBeVisible();
    await page.waitForTimeout(500);
    const g = await lerGravacao(page);
    const waapi = Object.entries(g).filter(([nome]) => nome.startsWith('waapi@'));
    expect(waapi.length, 'animações WAAPI vistas ao abrir a ficha').toBeGreaterThan(0);
    expect(waapi.flatMap(([nome, v]) => propriedadesProibidas(v.props).map((p) => `${nome}: ${p}`))).toEqual([]);
  });

  // app.css:164 e :775. `.faixa-combo.anima .selo-placa{animation:selo-bate .6s both .1s}`: com movimento reduzido o
  // base.css zera duração e repetição, mas o `both` e o atraso de .1 s deixam a animação (terminada) em document.getAnimations().
  test('movimento reduzido: document.getAnimations().length deveria ser 0 em bio, cardápio e ficha, mas `selo-bate` (`.faixa-combo.anima .selo-placa`) continua listada', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const nome of ['bio', 'cardapio', 'ficha']) {
      await abrir(page, nome);
      await page.waitForTimeout(700);
      expect((await lerAnimacoes(page)).map((a) => `${a.nome} (${a.estado}) em ${a.alvo}`), `${nome}: document.getAnimations()`).toEqual([]);
    }
  });
});
