// Capturas do painel (P10a): login, quadro, Cardápio, Histórico, Relatório e Configurações em 1280; login e quadro em 390.
// Login com equipe@teste.local (o proxy local aceita qualquer senha). Três pedidos de captura (obs = 'captura') criados
// pela RPC criar_pedido do banco local, um deixado em preparo por mudar_status; apagados no fim. Ver lib.mjs.
import { BASE, EQUIPE, psql, apagarPedidosDeCaptura, criarPedidoReal, jwtDaEquipe, rpc, interceptar, modoAuto, agoraFalso, deslocarTempos, criadoEmDe } from './lib.mjs';

export const alvo = 'painel';
export const larguras = [390, 1280];

// idade de cada pedido no relógio fixo: passa de "atenção" (15 min) e de "atraso" (25 min) do padrão do painel
const PEDIDOS = [
  {
    chave: 'atraso',
    idadeMin: 30,
    pedido: {
      nome: 'Rafael Captura',
      telefone: '11999990011',
      modo: 'entrega',
      endereco: 'Rua das Flores, 100, Centro',
      itens: [
        { produtoId: 'gran-crispy', qtd: 1 },
        { produtoId: 'dog-doritos', qtd: 1 }
      ]
    }
  },
  {
    chave: 'atencao',
    idadeMin: 18,
    emPreparo: true,
    pedido: {
      nome: 'Marina Captura',
      telefone: '11999990012',
      modo: 'local',
      itens: [{ produtoId: 'gran-bacon-onion', qtd: 1, prensado: true, combo: { ativo: true, refri: '' } }]
    }
  },
  {
    chave: 'novo',
    idadeMin: 3,
    pedido: { nome: 'Paulo Captura', telefone: '11999990013', modo: 'local', itens: [{ produtoId: 'big-tudo', qtd: 1 }] }
  }
];

async function criarDados() {
  const jwt = await jwtDaEquipe();
  const porId = {};
  for (const p of PEDIDOS) {
    let criado = await criarPedidoReal(p.pedido);
    if (p.emPreparo) criado = await rpc('mudar_status', { p_id: criado.id, p_status: 'preparo', p_motivo: null }, jwt);
    porId[criado.id] = { idadeMin: p.idadeMin, criadoEmReal: criadoEmDe(criado) };
  }
  return { porId };
}

export async function preparar() {
  apagarPedidosDeCaptura(); // sobras de uma rodada interrompida
  return criarDados();
}

// o banco é compartilhado: se algum pedido de captura sumiu (outro agente apagou), recria os três
export async function garantir(dados) {
  const ids = Object.keys(dados.porId).map((id) => "'" + id + "'").join(',');
  if (Number(psql(`select count(*) from pedidos where id in (${ids})`)) < PEDIDOS.length) {
    apagarPedidosDeCaptura();
    Object.assign(dados, await criarDados());
  }
}

// Só os pedidos de captura (o banco é compartilhado) e com a idade de cada um no relógio fixo (o banco grava a hora real).
export async function ligar(page, v, dados) {
  await modoAuto(page);
  await interceptar(
    page,
    (url) => url.pathname.endsWith('/rest/v1/pedidos'),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const resposta = await route.fetch();
      const linhas = await resposta.json();
      const minhas = (Array.isArray(linhas) ? linhas : [])
        .filter((l) => dados.porId[l.id])
        .map((l) => deslocarTempos(l, agoraFalso(v) - dados.porId[l.id].idadeMin * 60000 - dados.porId[l.id].criadoEmReal));
      await route.fulfill({ response: resposta, json: minhas });
    }
  );
}

const VISOES = [
  ['cardapio', 'cardapio'],
  ['historico', 'historico'],
  ['relatorio', 'relatorio'],
  ['config', 'configuracoes']
];

export async function telas(page, v, dados, tela) {
  await page.goto(BASE + '/painel/');
  await page.getByRole('button', { name: 'Entrar' }).waitFor();
  await tela('login');

  await page.getByLabel('E-mail').fill(EQUIPE);
  await page.getByLabel('Senha').fill('qualquer-senha'); // senha de teste do login fake do proxy local (tests/e2e.spec.js)
  await page.getByRole('button', { name: 'Entrar' }).click();

  if (v.largura === 390) {
    await page.locator('.pn-mobile').waitFor({ state: 'visible' });
    await page.locator('.pn-mobile .pn-card, .pn-mobile [data-id]').first().waitFor({ state: 'attached' }).catch(() => {});
    await tela('quadro', { espera: 1500 });
    return;
  }

  await page.locator('.pn-card').nth(2).waitFor({ state: 'visible' });
  await tela('quadro', { espera: 1500 }); // os indicadores contam de 0 até o valor

  for (const [chave, nome] of VISOES) {
    await page.locator(`[data-nav="${chave}"]`).click();
    await page.locator(`[data-view="${chave}"]`).waitFor({ state: 'visible' });
    await tela(nome, { espera: 1200 });
  }
}

export async function limpar() {
  apagarPedidosDeCaptura();
}
