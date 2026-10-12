// Capturas do cliente (A9a/A9b): bio, #cardapio, ficha do Gran Bacon Onion, #sacola com 2 itens, #checkout preenchido e
// #pedido/<token> de um pedido criado na RPC criar_pedido do banco local. Ver lib.mjs.
import { BASE, apagarPedidosDeCaptura, criarPedidoReal, jwtDaEquipe, rpc, interceptar, modoAuto, agoraFalso, deslocarTempos, criadoEmDe } from './lib.mjs';

/* global document */ // page.waitForFunction roda na página

export const alvo = 'cliente';
export const larguras = [390, 1280];

// o pedido do acompanhamento tem 12 min no relógio fixo (a hora de cada passo vem do histórico real, deslocado)
const IDADE_MIN = 12;

async function criarDados() {
  const pedido = await criarPedidoReal({
    nome: 'Cliente Captura',
    telefone: '11999990001',
    modo: 'local',
    itens: [
      { produtoId: 'gran-bacon-onion', qtd: 1 },
      { produtoId: 'x-burguer', qtd: 2 }
    ]
  });
  const emPreparo = await rpc('mudar_status', { p_id: pedido.id, p_status: 'preparo', p_motivo: null }, await jwtDaEquipe());
  return { token: pedido.token, numero: pedido.numero, criadoEmReal: criadoEmDe(emPreparo) };
}

export async function preparar() {
  apagarPedidosDeCaptura(); // sobras de uma rodada interrompida
  return criarDados();
}

// o banco é compartilhado: se o pedido sumiu (outro agente apagou), cria de novo
export async function garantir(dados) {
  if (!(await rpc('acompanhar_pedido', { p_token: dados.token }))) Object.assign(dados, await criarDados());
}

export async function ligar(page, v, dados) {
  await modoAuto(page);
  await interceptar(page, '**/rest/v1/rpc/acompanhar_pedido', async (route) => {
    const resposta = await route.fetch();
    const json = await resposta.json();
    const delta = agoraFalso(v) - IDADE_MIN * 60000 - dados.criadoEmReal;
    await route.fulfill({ response: resposta, json: json ? deslocarTempos(json, delta) : json });
  });
}

const visivel = (page, seletor) => page.locator(seletor).waitFor({ state: 'visible' });

export async function telas(page, v, dados, tela) {
  // bio: a placa acende uma vez por sessão (pisca e passa o brilho em ~2,2 s); no reduzido nada anima
  await page.goto(BASE + '/');
  await visivel(page, '[data-screen="bio"]');
  await tela('bio', { espera: v.reduzido ? 900 : 2800 });

  // cardápio
  await page.goto(BASE + '/#cardapio');
  await visivel(page, '[data-screen="menu"]');
  await page.locator('#menu-lista .prod').first().waitFor({ state: 'attached' });
  await tela('cardapio');

  // ficha: abre pelo card (gaveta), captura a janela
  await page.locator('#prod-gran-bacon-onion').click();
  await page.locator('#ficha[open]').waitFor();
  await tela('ficha', { cheia: false });

  // sacola com 2 itens, pela interface: o Gran Bacon Onion pela ficha e um X-Burguer pelo "+" do card
  await page.locator('#ficha-add').click();
  await page.locator('#ficha').waitFor({ state: 'hidden' });
  await page.locator('[data-rapido="x-burguer"]').click();

  // ficha de um lanche sem foto (topo com a parede nítida, até 420 px): o primeiro do cardápio que abre assim
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-abrir]')).map((b) => b.getAttribute('data-abrir')));
  for (const id of ids.slice(0, 40)) {
    await page.locator('#prod-' + id).click();
    await page.locator('#ficha[open]').waitFor();
    if (await page.locator('#ficha .ficha-foto.sem-foto').count()) {
      await tela('ficha-sem-foto', { cheia: false });
      await page.locator('[data-fechar-ficha]').click();
      await page.locator('#ficha').waitFor({ state: 'hidden' });
      break;
    }
    await page.locator('[data-fechar-ficha]').click();
    await page.locator('#ficha').waitFor({ state: 'hidden' });
  }

  await page.locator('#barra .btn').click();
  await visivel(page, '[data-screen="sacola"]');
  await page.waitForFunction(() => document.querySelectorAll('#sacola-linhas > *').length >= 2);
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('on'), null, { timeout: 8000 });
  await tela('sacola');

  // checkout preenchido (entrega: o endereço é obrigatório)
  await page.locator('#btn-continuar').click();
  await visivel(page, '[data-screen="checkout"]');
  await page.locator('#f-nome').fill('Cliente Captura');
  await page.locator('#f-tel').fill('(11) 99999-0001');
  await page.locator('#f-end').fill('Rua das Flores, 100, Centro');
  await page.locator('#f-ref').fill('Portão azul');
  await page.locator('#f-obs').fill('Sem pressa');
  await page.locator('#f-obs').blur();
  await tela('checkout');

  // acompanhamento do pedido real
  await page.goto(BASE + '/#pedido/' + dados.token);
  await visivel(page, '[data-screen="pedido"]');
  await page.waitForFunction(() => document.querySelector('#ped-num') && /\d/.test(document.querySelector('#ped-num').textContent));
  await tela('pedido');
}

export async function limpar() {
  apagarPedidosDeCaptura();
}
