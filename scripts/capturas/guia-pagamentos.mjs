// Capturas do guia de pagamentos (edição de 20/11/2026): checkout sem pagamento online (Pix, Dinheiro e Outra forma, todos
// a receber), WhatsApp com o pedido, acompanhamento e painel. Banco local real com clientes fictícios; nada sai para a internet
// (o wa.me é interceptado e a mensagem fica em capturas/guia-pagamentos/whatsapp.txt).
// Uso (Git Bash, Supabase local no ar com o setup.sql aplicado):
//   source scripts/supabase-local/ambiente-windows.sh && node scripts/capturas/guia-pagamentos.mjs
// Grava docs/guias/telas/*.webp. Depois: node scripts/gerar-guia-pagamentos.mjs
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, BASE, EQUIPE, subirServidor, psql, estabilizar } from './lib.mjs';

/* global document, window, getComputedStyle */ // page.evaluate roda na página

const TELAS = join(RAIZ, 'docs/guias/telas');
const TMP = join(RAIZ, 'capturas/guia-pagamentos');
const MARCA = 'Demonstração'; // sobrenome dos clientes fictícios: a limpeza apaga só esses pedidos
const SENHA_LOCAL = 'qualquer-senha'; // o proxy local aceita qualquer senha para equipe@teste.local
mkdirSync(TELAS, { recursive: true });
mkdirSync(TMP, { recursive: true });

// O psql do Windows recebe a linha de comando na página de código ANSI: o filtro vai sem acento ('Demonstra__o').
const FILTRO = '% Demonstra__o';
const limpar = () => psql(`delete from pedidos where cliente_nome like '${FILTRO}'; delete from clientes where nome like '${FILTRO}'`);

// margem: borda na cor de fundo do app em volta de um recorte do celular, para não colar o conteúdo na moldura do guia
async function webp(origem, nome, { largura, margem = 0 } = {}) {
  let img = sharp(origem);
  if (margem) img = sharp(await img.extend({ top: margem, bottom: margem, left: margem, right: margem, background: '#120c0a' }).png().toBuffer());
  if (largura) img = img.resize({ width: largura, withoutEnlargement: true });
  await img.webp({ quality: 84 }).toFile(join(TELAS, nome + '.webp'));
  console.log('  ok  ' + nome + '.webp');
}
// Foto da área visível (celular), de um elemento ou de um trecho que vai do topo de um elemento ao fim de outro (uniao).
async function foto(page, nome, { elemento = null, uniao = null, largura, margem } = {}) {
  await estabilizar(page, 500);
  const png = join(TMP, nome + '.png');
  if (elemento) await elemento.screenshot({ path: png });
  else if (uniao) {
    await uniao[0].scrollIntoViewIfNeeded();
    await rolarPara(page, uniao[0], 80);
    const [a, b] = [await uniao[0].boundingBox(), await uniao[1].boundingBox()];
    const vp = page.viewportSize();
    await page.screenshot({ path: png, clip: { x: 0, y: Math.max(0, a.y - 16), width: vp.width, height: Math.min(vp.height, b.y + b.height + 16) - Math.max(0, a.y - 16) } });
  } else await page.screenshot({ path: png });
  await webp(png, nome, { largura, margem });
}
// Rola até o elemento ficar a `folga` px do alto da tela (o cabeçalho do app é fixo), em qualquer contêiner que role.
async function rolarPara(page, alvo, folga = 90) {
  await (typeof alvo === 'string' ? page.locator(alvo) : alvo).first().evaluate((el, f) => {
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    let c = el.parentElement;
    while (c && !(c.scrollHeight > c.clientHeight && /(auto|scroll)/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
    (c || document.scrollingElement).scrollBy({ top: -f, behavior: 'instant' });
  }, folga);
  await page.waitForTimeout(300);
}

async function checkout(page, { nome, telefone }) {
  await page.goto(BASE + '/#cardapio');
  await page.locator('#prod-gran-burger').click();
  await page.locator('#ficha-add').waitFor();
  return { nome, telefone };
}
async function ateOsDados(page, { nome, telefone }) {
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').click();
  await page.locator('#f-tel').fill(telefone);
  await page.locator('#f-nome').fill(nome);
  await page.locator('[data-modo=local]').click();
  await page.locator('#f-tel').blur();
}

const original = JSON.parse(psql("select json_build_object('modo',modo,'pagamentos_ativos',pagamentos_ativos,'cotacao_ativa',cotacao_ativa) from loja where id=1"));
const servidor = await subirServidor();
const navegador = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const erros = [];
try {
  limpar();
  psql("update loja set modo='aberta', pagamentos_ativos=false, cotacao_ativa=false where id=1");
  // o testar-sql.sh --do-zero recria o banco sem a equipe de teste
  psql(`insert into equipe (user_id, nome) select id, 'Equipe teste' from auth.users where email = '${EQUIPE}' on conflict do nothing`);
  const celular = await navegador.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo'
  });
  let mensagemWa = '';
  await celular.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => {
    mensagemWa = new URL(r.request().url()).searchParams.get('text') || mensagemWa;
    return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>WhatsApp</title><p>WhatsApp (simulado nas capturas)</p>' });
  });
  const page = await celular.newPage();
  page.on('pageerror', (e) => erros.push('cliente: ' + e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // ---- 1. Pix na retirada ----
  const ana = await checkout(page, { nome: 'Ana ' + MARCA, telefone: '11900000101' });
  await foto(page, '01-ficha');
  await page.locator('#ficha-add').click();
  await page.locator('#barra .btn').click();
  await page.locator('#btn-continuar').waitFor();
  await foto(page, '02-sacola');
  await page.locator('#btn-continuar').click();
  await page.locator('#f-tel').fill(ana.telefone);
  await page.locator('#f-nome').fill(ana.nome);
  await page.locator('[data-modo=local]').click();
  await page.locator('#f-nome').blur();
  await rolarPara(page, 'section.bloco:has(#f-tel)', 76);
  await foto(page, '03-dados');
  await page.locator('[data-pag="Pix"]').click();
  await page.locator('#pagamento-whatsapp-info').waitFor();
  const blocoPagamento = page.locator('section.bloco:has(#pag-tit)');
  await foto(page, '04-pix', { elemento: blocoPagamento, margem: 32 });
  const popup = page.waitForEvent('popup');
  await page.locator('#btn-enviar').click();
  const wa = await popup;
  await wa.waitForLoadState();
  if (!mensagemWa) mensagemWa = new URL(wa.url()).searchParams.get('text') || '';
  await wa.close();
  writeFileSync(join(TMP, 'whatsapp.txt'), mensagemWa);
  await page.locator('[data-screen="pedido"]').waitFor();
  await page.locator('#ped-wa').waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await foto(page, '05-acompanhamento');
  await foto(page, '06-botao-whatsapp', { uniao: [page.locator('section.bloco:has(#it-tit)'), page.locator('#ped-wa')] });

  // ---- 2. Dinheiro com troco (pedido enviado) e sem troco (só a tela) ----
  const bruno = await checkout(page, { nome: 'Bruno ' + MARCA, telefone: '11900000102' });
  await ateOsDados(page, bruno);
  await page.locator('[data-pag="Dinheiro"]').click();
  await page.locator('[data-troco="sim"]').click();
  await page.locator('#f-troco').fill('100,00');
  await page.locator('#f-troco').blur();
  await foto(page, '07-dinheiro-com-troco', { elemento: page.locator('section.bloco:has(#pag-tit)'), margem: 32 });
  await page.locator('[data-troco="nao"]').click();
  await foto(page, '08-dinheiro-sem-troco', { elemento: page.locator('section.bloco:has(#pag-tit)'), margem: 32 });
  await page.locator('[data-troco="sim"]').click();
  await page.locator('#f-troco').fill('100,00');
  const popup2 = page.waitForEvent('popup');
  await page.locator('#btn-enviar').click();
  await (await popup2).close();
  await page.locator('[data-screen="pedido"]').waitFor();
  await celular.close();

  // ---- 3. Painel (computador) ----
  const pc = await navegador.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const painel = await pc.newPage();
  painel.on('pageerror', (e) => erros.push('painel: ' + e.message));
  await painel.emulateMedia({ reducedMotion: 'reduce' });
  await painel.goto(BASE + '/painel/');
  await painel.getByLabel('E-mail').waitFor();
  // o cartão de login inteiro (logo, título e formulário): o ancestral do formulário que também tem o título
  await painel.locator('form').first().evaluate((el) => {
    while (el.parentElement && !el.querySelector('h1, h2')) el = el.parentElement;
    el.setAttribute('data-captura-login', '');
  });
  await foto(painel, '09-acesso', { elemento: painel.locator('[data-captura-login]'), largura: 900 });
  await painel.getByLabel('E-mail').fill(EQUIPE);
  await painel.getByLabel('Senha').fill(SENHA_LOCAL);
  await painel.getByRole('button', { name: 'Entrar', exact: true }).click();
  await painel.locator('.pn-topo').waitFor();
  await painel.evaluate(() => { window.print = () => {}; });
  // só o seletor de modo e o aviso ao lado (o botão "Simular pedido" do cabeçalho só existe no ambiente de demonstração)
  await foto(painel, '10-modo-loja', { elemento: painel.locator('.pn-loja'), largura: 1400 });
  const idDe = (nome) => psql(`select id from pedidos where cliente_nome like '${nome.split(' ')[0]} Demonstra__o'`);
  const cardAna = painel.locator(`.pn-card[data-id="${idDe(ana.nome)}"]`);
  const cardBruno = painel.locator(`.pn-card[data-id="${idDe(bruno.nome)}"]`);
  await cardAna.getByText('Pix a receber (chave pelo WhatsApp)').waitFor();
  await foto(painel, '11-card-pix-a-receber', { elemento: cardAna, largura: 700 });
  await cardAna.getByRole('button', { name: 'Aceitar e preparar', exact: true }).click();
  await cardAna.getByText('Em preparo').first().waitFor();
  painel.once('dialog', (d) => d.accept());
  await cardAna.getByRole('button', { name: 'Confirmar pagamento recebido', exact: true }).click();
  await cardAna.getByText('Pix recebido').waitFor();
  await foto(painel, '12-card-pix-recebido', { elemento: cardAna, largura: 700 });
  await cardBruno.getByText('troco para R$ 100,00').waitFor();
  await foto(painel, '13-card-dinheiro', { elemento: cardBruno, largura: 700 });
  await cardBruno.getByRole('button', { name: /Imprimir/ }).click();
  const comanda = painel.locator('[data-comanda]');
  await comanda.waitFor();
  await foto(painel, '14-comanda', { elemento: comanda, largura: 600 });
  await painel.keyboard.press('Escape');
  await painel.waitForTimeout(400);
  await cardBruno.getByRole('button', { name: /^Cancelar pedido/ }).click();
  await cardBruno.locator('.pn-cancel input').fill('Cliente desistiu');
  await foto(painel, '15-cancelar', { elemento: cardBruno.locator('.pn-cancel'), largura: 700 });
  await cardBruno.getByRole('button', { name: 'Voltar', exact: true }).click();
  await pc.close();
  console.log('\nMensagem do WhatsApp:\n' + mensagemWa);
} finally {
  try {
    limpar();
    psql(`update loja set modo='${original.modo}', pagamentos_ativos=${original.pagamentos_ativos}, cotacao_ativa=${original.cotacao_ativa} where id=1`);
  } finally {
    await navegador.close();
    servidor.parar();
  }
}
if (erros.length) {
  console.log('\nErros de página:\n' + erros.join('\n'));
  process.exitCode = 1;
}
