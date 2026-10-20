/* global document */
import { test, expect } from '@playwright/test';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const args = (s) => [PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', s];
const sql = (s) => execFileSync('psql', args(s), { encoding: 'utf8' }).trim();
const sqlAsync = (s) => promisify(execFile)('psql', args(s));
const literal = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const equipe = '00000000-0000-4000-8000-000000000001',
  moto = '45000000-0000-4000-8000-000000000003';
let cfg, loja;
test.beforeAll(() => {
  cfg = JSON.parse(
    sql(
      "select jsonb_build_object('modo',modo,'regras',regras,'versao',versao,'limite',limite_creditos_dia) from entrega_rotas_config where id=1"
    )
  );
  loja = JSON.parse(sql("select jsonb_build_object('modo',modo,'origem',entrega_origem,'cotacao',cotacao_ativa) from loja where id=1"));
  sql(`insert into equipe(user_id,nome) values('${equipe}','Equipe teste') on conflict do nothing;
  insert into auth.users(id,email) values('${moto}','viagem-ui@teste.local') on conflict do nothing;
  insert into motoboys(user_id,nome) values('${moto}','Entregador das viagens') on conflict(user_id) do update set ativo=true;
  update loja set modo='aberta',cotacao_ativa=false,entrega_origem=entrega_origem||jsonb_build_object('confirmadaEm',data_iso(now())) where id=1;`);
});
function limpar() {
  sql(`delete from pedidos where cliente_telefone like '119665%';delete from clientes where telefone like '119665%';
  delete from entrega_viagens where motoboy_id='${moto}';
  delete from entrega_rotas_execucoes where id in(select execucao_id from entrega_rotas_planos where motoboy_id='${moto}');
  delete from entregadores_disponibilidade where user_id='${moto}';
  update entrega_rotas_config set modo='assistido',regras='{"maxPedidos":3,"esperaMin":10,"trajetoMin":30,"desvioMin":5,"paradaMin":1}',versao=gen_random_uuid(),limite_creditos_dia=1000 where id=1;`);
}
test.beforeEach(limpar);
test.afterAll(() => {
  limpar();
  sql(`delete from auth.users where id='${moto}';update loja set modo=${literal(loja.modo)},entrega_origem=${literal(JSON.stringify(loja.origem))}::jsonb,cotacao_ativa=${loja.cotacao} where id=1;
  update entrega_rotas_config set modo=${literal(cfg.modo)},regras=${literal(JSON.stringify(cfg.regras))}::jsonb,versao=${literal(cfg.versao)},limite_creditos_dia=${cfg.limite} where id=1;`);
});
async function entrar(page, rota, email) {
  await page.goto(rota);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
async function central(page) {
  await entrar(page, '/painel/', 'equipe@teste.local');
  await page.locator('[data-nav="entregadores"]:visible, [data-usuarios-ir="entregadores"]:visible').first().click();
  await page.getByRole('button', { name: 'Organizar saída', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Viagens e rotas', exact: true })).toBeFocused();
  return page.locator('.rt-central:visible');
}
async function motorista(page) {
  await entrar(page, '/motoboy/', 'viagem-ui@teste.local');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'Começar turno na loja' }).click();
  await expect(page.locator('.mb-operacao')).toContainText('Você informou que está na loja');
}
function pedido(nome = 'Entrega da viagem') {
  const telefone = '119665' + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  const p = JSON.parse(
    sql(
      `select criar_pedido(${literal(JSON.stringify({ cliente: { nome, telefone }, modo: 'entrega', endereco: 'Rua Viagem, 10', distanciaKm: 2, itens: [{ produtoId: 'gran-burger', qtd: 1 }], idempotencia: randomUUID() }))}::jsonb)`
    )
  );
  sql(`begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);
  select mudar_status('${p.id}','preparo');select mudar_status('${p.id}','pronto');
  select conferir_destino_pedido('${p.id}',-23.54,-46.31,'Localização da fixture local');commit;`);
  return p;
}
function plano(ids) {
  const proposta = {
    motoboyId: moto,
    segundos: 600,
    metros: 2500,
    ultimaEntregaSeg: ids.length * 60,
    paradas: ids.map((id, i) => ({ id, chegadaSeg: (i + 1) * 60 })),
    geometria: {
      type: 'MultiLineString',
      coordinates: [
        [
          [-46.3129, -23.5409],
          [-46.31, -23.54]
        ]
      ]
    }
  };
  sql(`update entrega_rotas_execucoes set criado_em=now()-interval '6 seconds' where estado<>'calculando';
  with c as materialized(select iniciar_planejamento_entregas('${equipe}',null,${literal(JSON.stringify(ids))}::jsonb) j)
  select concluir_planejamento_entregas((j->>'id')::uuid,${literal(JSON.stringify([proposta]))}::jsonb) from c;`);
  return sql(
    `select id from entrega_rotas_planos where dados->'paradas' @> ${literal(JSON.stringify([{ id: ids[0] }]))}::jsonb and estado='aberto' order by criado_em desc limit 1`
  );
}

test('viagem da equipe ao celular: carrega, sai em conjunto, confirma offline e registra retorno', async ({ page, browser }) => {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    mb = await mc.newPage();
  await motorista(mb);
  const a = pedido('Primeira parada'),
    b = pedido('Segunda parada');
  const idPlano = plano([a.id, b.id]);
  const painel = await central(page);
  const sugestao = painel.locator(`[data-r-plano="${idPlano}"]`);
  await expect(sugestao).toContainText('Primeira parada');
  await expect(painel.locator('.rt-proximo')).toContainText('Confira a viagem sugerida');
  await page.route('https://tile.openstreetmap.org/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
    })
  );
  await sugestao.getByRole('button', { name: 'Ver percurso no mapa' }).click();
  const mapa = page.getByRole('dialog', { name: 'Percurso da viagem' });
  await expect(mapa.locator('.leaflet-overlay-pane path')).toBeVisible();
  await expect(mapa.locator('.mapa-viagem-pino')).toHaveCount(3);
  await expect(mapa).toContainText('O mapa não acompanha a localização');
  await mapa.screenshot({ path: `/workspace/scratch/mineiro-rotas-mapa-${test.info().project.name}.png` });
  await mapa.getByRole('button', { name: 'Fechar mapa' }).click();
  await painel.screenshot({ path: `/workspace/scratch/mineiro-rotas-painel-${test.info().project.name}.png` });
  await sugestao.getByRole('button', { name: 'Vincular viagem', exact: true }).click();
  await expect(sugestao).toHaveCount(0);
  const id = sql(`select id from entrega_viagens where plano_id='${idPlano}'`);
  const viagem = painel.locator(`[data-r-viagem="${id}"]`);
  await expect(viagem).toContainText('Aguardando saída');
  await expect(viagem).toBeFocused();
  expect(sql(`select string_agg(status,',' order by id) from pedidos where id in('${a.id}','${b.id}')`)).toBe('pronto,pronto');
  await mb.getByRole('button', { name: 'Recarregar viagem', exact: true }).click();
  await expect(mb.locator('.mb-operacao')).toContainText('Viagem carregada no aparelho');
  await mb.locator('.mb-operacao').screenshot({ path: `/workspace/scratch/mineiro-rotas-motoboy-${test.info().project.name}.png` });
  let liberarConsulta, consultaIniciada;
  const respostaAntiga = new Promise((resolve) => {
    consultaIniciada = resolve;
  });
  const liberarResposta = new Promise((resolve) => {
    liberarConsulta = resolve;
  });
  let primeira = true;
  await mb.route('**/rest/v1/rpc/entregas_em_rota', async (rota) => {
    if (!primeira) return rota.continue();
    primeira = false;
    const resposta = await rota.fetch();
    expect((await resposta.json()).every((p) => p.status === 'pronto')).toBe(true);
    consultaIniciada();
    await liberarResposta;
    await rota.fulfill({ response: resposta });
  });
  await mb.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await respostaAntiga;
  await mb.getByRole('button', { name: 'Registrar saída da viagem', exact: true }).click();
  try {
    await expect.poll(() => sql(`select estado from entrega_viagens where id='${id}'`)).toBe('em_rota');
  } finally {
    liberarConsulta();
  }
  await expect(mb.locator('.mb-operacao')).toContainText('Próxima parada');
  await expect(mb.locator(`.mb-item[data-id="${a.id}"]`).getByRole('button', { name: 'Entregue', exact: true })).toBeEnabled();
  await mb.unroute('**/rest/v1/rpc/entregas_em_rota');
  await mb.getByRole('button', { name: 'Ver próxima entrega', exact: true }).click();
  await expect(mb.locator(`.mb-item[data-id="${a.id}"]`)).toBeFocused();
  expect(new URL(mb.url()).hash).toBe('');
  expect(sql(`select string_agg(status,',' order by id) from pedidos where id in('${a.id}','${b.id}')`)).toBe('rota,rota');
  const itemA = mb.locator(`.mb-item[data-id="${a.id}"]`),
    itemB = mb.locator(`.mb-item[data-id="${b.id}"]`);
  await mc.setOffline(true);
  await itemA.getByRole('button', { name: 'Entregue', exact: true }).click();
  await itemB.getByRole('button', { name: 'Entregue', exact: true }).click();
  await expect(mb.locator('[data-sync]')).toContainText('2 confirmações aguardando envio');
  expect(sql(`select estado from entrega_viagens where id='${id}'`)).toBe('em_rota');
  await mb.reload();
  await expect(mb.locator('.mb-operacao')).toContainText('Sem internet; mostrando a última consulta');
  await expect(mb.locator('[data-sync]')).toContainText('2 confirmações aguardando envio');
  await mc.setOffline(false);
  await mb.getByRole('button', { name: 'Sincronizar agora' }).click();
  await expect(mb.locator('[data-sync]')).toHaveText('Tudo sincronizado');
  await expect(mb.getByRole('button', { name: 'Retornei à loja' })).toBeEnabled();
  expect(sql(`select estado from entrega_viagens where id='${id}'`)).toBe('retornando');
  await mb.getByRole('button', { name: 'Retornei à loja' }).click();
  await expect(mb.locator('.mb-operacao')).toContainText('Você informou que está na loja');
  expect(sql(`select estado from entrega_viagens where id='${id}'`)).toBe('encerrada');
  await painel.getByRole('button', { name: 'Recarregar viagens' }).click();
  await expect(painel.locator(`[data-r-viagem="${id}"]`)).toHaveCount(0);
  await mc.close();
});

test('cálculo envia a sessão e a seleção ao servidor e mostra falhas de mapas', async ({ page }) => {
  const p = pedido('Selecionado para calcular');
  sql(
    `begin;select set_config('request.jwt.claims','{"sub":"${moto}","role":"authenticated"}',true);select definir_disponibilidade_entregador('na_loja');commit;`
  );
  const painel = await central(page);
  await painel.locator('.rt-pronto', { hasText: 'Selecionado para calcular' }).getByRole('checkbox').check();
  let consultas = 0;
  await page.route('**/functions/v1/planejar-entregas', async (rota) => {
    const req = rota.request();
    expect(req.headers().authorization).toMatch(/^Bearer [\w.-]+$/);
    expect(req.headers().apikey).toBe('sb_publishable_local');
    expect(req.postDataJSON()).toEqual(consultas++ === 0 ? { acao: 'calcular', pedidos: [p.id], ordemFixa: false } : { acao: 'verificar' });
    await rota.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ codigo: 'rota_indisponivel' }) });
  });
  await painel.getByRole('button', { name: 'Calcular seleção' }).click();
  await expect(painel.locator('.rt-erro')).toContainText('Não foi possível calcular o trajeto');
  await expect(painel.locator('.rt-erro')).toBeFocused();
  await expect(painel.locator('.rt-aviso')).toBeHidden();
  await painel.getByText('Configurar rotas', { exact: true }).click();
  await painel.getByRole('button', { name: 'Verificar mapas' }).click();
  await expect(painel.locator('.rt-erro')).toContainText('Não foi possível calcular o trajeto');
  expect(consultas).toBe(2);
  await page.unroute('**/functions/v1/planejar-entregas');
  let sugestao;
  await page.route('**/functions/v1/planejar-entregas', async (rota) => {
    sugestao = plano([p.id]);
    await rota.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ estado: 'concluida', planos: 1, reservadas: 0 })
    });
  });
  await painel.getByRole('button', { name: 'Calcular seleção' }).click();
  await expect(painel.locator('.rt-proximo')).toContainText('Confira a viagem sugerida');
  await expect(painel.locator(`[data-r-plano="${sugestao}"]`)).toBeFocused();
});

test('desfazer antes da saída mantém pedido pronto e pausa a seleção automática', async ({ page, browser }) => {
  const mc = await browser.newContext(),
    mb = await mc.newPage();
  await motorista(mb);
  const p = pedido('Pedido para corrigir'),
    idPlano = plano([p.id]);
  sql(
    `begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);select reservar_viagem_entrega('${idPlano}');commit;`
  );
  const painel = await central(page),
    id = sql(`select id from entrega_viagens where plano_id='${idPlano}'`);
  const viagem = painel.locator(`[data-r-viagem="${id}"]`);
  await viagem.getByText('Replanejar esta viagem', { exact: true }).click();
  await viagem.getByLabel('Motivo', { exact: true }).fill('Separar este pedido da próxima saída');
  await viagem.getByRole('button', { name: 'Desfazer viagem para replanejar' }).click();
  await expect(viagem).toHaveCount(0);
  const pronto = painel.locator('.rt-pronto', { hasText: 'Pedido para corrigir' });
  await expect(pronto).toContainText('Pausado na seleção automática');
  expect(sql(`select status||':'||entrega_planejamento_pausado::text from pedidos where id='${p.id}'`)).toBe('pronto:true');
  await pronto.getByRole('checkbox').check();
  await painel.getByRole('button', { name: 'Liberar seleção para automação' }).click();
  await expect(pronto).not.toContainText('Pausado na seleção automática');
  await mc.close();
});

test('duas reservas concorrentes devolvem a mesma viagem sem duplicar pedidos', async ({ page }) => {
  const p = pedido('Reserva concorrente');
  sql(
    `begin;select set_config('request.jwt.claims','{"sub":"${moto}","role":"authenticated"}',true);select definir_disponibilidade_entregador('na_loja');commit;`
  );
  const idPlano = plano([p.id]);
  const comando = `begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);select reservar_viagem_entrega('${idPlano}');commit;`;
  await Promise.all([sqlAsync(comando), sqlAsync(comando)]);
  expect(sql(`select count(*) from entrega_viagens where plano_id='${idPlano}'`)).toBe('1');
  expect(sql(`select count(*) from entrega_viagens_paradas where pedido_id='${p.id}' and ativa`)).toBe('1');
  const painel = await central(page);
  await expect(painel.locator('.rt-viagem:not(.rt-viagem--sugestao)')).toHaveCount(1);
});

test('cliente recebe mensagem de pronto para sair e regras do painel preservam rascunho', async ({ page, browser }) => {
  const p = pedido('Pronto para sair');
  const cliente = await browser.newContext(),
    tela = await cliente.newPage();
  await tela.goto('/#pedido/' + p.token);
  await expect(tela.locator('#ped-msg')).toHaveText('Seu pedido está pronto, aguardando saída para entrega');
  await expect(tela.locator('#pedido-neon, .ped-neon').first()).toContainText('Pronto para sair');
  await expect(tela.locator('#linha-tempo .passo.atual')).toContainText('Pronto para sair');
  const painel = await central(page);
  await painel.getByText('Configurar rotas', { exact: true }).click();
  const capacidade = painel.getByLabel('Pedidos por saída', { exact: true });
  await capacidade.fill('2');
  await painel.getByRole('button', { name: 'Recarregar viagens' }).click();
  await expect(capacidade).toHaveValue('2');
  await painel.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(painel.locator('.rt-aviso')).toContainText('Operação registrada');
  expect(sql("select regras->>'maxPedidos' from entrega_rotas_config where id=1")).toBe('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await cliente.close();
});

test('primeiro uso orienta a configuração sem exigir conhecimento técnico', async ({ page }) => {
  sql(
    "update entrega_rotas_config set modo='desligado',regras='{}',versao=gen_random_uuid() where id=1;update loja set entrega_origem=entrega_origem-'confirmadaEm' where id=1;"
  );
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: -23.5409, longitude: -46.3129, accuracy: 10 });
  const painel = await central(page);
  await expect(painel.locator('.rt-proximo')).toContainText('Vamos preparar as rotas da loja');
  await expect(painel.getByRole('button', { name: 'Sugerir viagens' })).toHaveCount(0);
  await painel.getByRole('button', { name: 'Preparar rotas da loja' }).click();
  await expect(painel.getByLabel('Pedidos por saída', { exact: true })).toBeFocused();
  await expect(painel.locator('[name="r_modo"]')).toHaveValue('assistido');
  await expect(painel.getByLabel('Limite diário de créditos estimados')).not.toBeVisible();
  for (const [k, v] of Object.entries({ maxPedidos: 2, esperaMin: 8, trajetoMin: 20, desvioMin: 4, paradaMin: 1 }))
    await painel.locator(`[name="r_${k}"]`).fill(String(v));
  await painel.getByRole('button', { name: 'Confirmar saída na loja' }).click();
  await expect(painel.getByRole('button', { name: 'Confirmar saída na loja' })).toHaveCount(0);
  await painel.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(painel.locator('.rt-modo')).toHaveText('Sugestões com liberação pela equipe');
  await expect(painel.locator('.rt-proximo')).toContainText('Na aba Pedidos, use “Marcar pronto”');
  expect(sql("select regras->>'maxPedidos' from entrega_rotas_config where id=1")).toBe('2');
  pedido('Próxima viagem simples');
  await painel.getByRole('button', { name: 'Recarregar viagens' }).click();
  await expect(painel.locator('.rt-proximo')).toContainText('Aguardando um motoboy disponível na loja');
  await expect(painel.getByText('Entregador das viagens', { exact: true })).not.toBeVisible();
  await painel.getByText('Quem está na loja?', { exact: true }).click();
  await expect(painel.getByText('Entregador das viagens', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
