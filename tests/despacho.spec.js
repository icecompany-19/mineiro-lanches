/* global document */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const sql = (s) => execFileSync('psql', [PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
const literal = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const equipe = '00000000-0000-4000-8000-000000000001';
const moto = '46000000-0000-4000-8000-000000000003';
const pasta = 'docs/guias/entregas-telas';
let cfg, loja, disponibilidade, pausados;
let execucoes = [];

test.beforeAll(() => {
  cfg = JSON.parse(
    sql(`select jsonb_build_object('modo',modo,'regras',regras,'versao',versao,
    'limite',limite_creditos_dia,'cron',cron_ativo,'url',job_url,'ativo',despacho_individual_ativo,
    'ativado',despacho_ativado_em,'janela',janela_agrupamento_seg,'prazo',prazo_reserva_seg,
    'alterado',alterado_em,'autor',alterado_por) from entrega_rotas_config where id=1`)
  );
  loja = JSON.parse(
    sql(`select jsonb_build_object('modo',modo,'origem',entrega_origem,'cotacao',cotacao_ativa,
    'pagamentos',pagamentos_ativos) from loja where id=1`)
  );
  disponibilidade = JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(d)),'[]') from entregadores_disponibilidade d"));
  pausados = JSON.parse(
    sql(
      "select coalesce(jsonb_agg(jsonb_build_object('id',id,'pausado',entrega_planejamento_pausado)),'[]') from pedidos where status='pronto'"
    )
  );
  sql(`insert into equipe(user_id,nome) values('${equipe}','Equipe teste') on conflict do nothing;
    insert into auth.users(id,email) values('${moto}','despacho-guia@teste.local') on conflict do nothing;
    insert into motoboys(user_id,nome) values('${moto}','Motoboy de demonstração') on conflict(user_id) do update set ativo=true;
    update entregadores_disponibilidade set situacao='pausado';
    update pedidos set entrega_planejamento_pausado=true where status='pronto';
    update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=true,entrega_origem='{}' where id=1;
    update entrega_rotas_config set modo='desligado',regras='{}',despacho_individual_ativo=true,
      despacho_ativado_em=now(),janela_agrupamento_seg=0,prazo_reserva_seg=300,
      cron_ativo=false,job_url=null,versao=gen_random_uuid() where id=1;`);
});

test.afterAll(() => {
  sql(`delete from pedidos where cliente_telefone like '119664%';
    delete from clientes where telefone like '119664%';
    delete from entrega_rotas_eventos where motoboy_id='${moto}';
    delete from entrega_viagens where motoboy_id='${moto}';
    ${execucoes.length ? `delete from entrega_rotas_execucoes where id in(${execucoes.map(literal).join(',')});` : ''}
    delete from auth.users where id='${moto}';
    insert into entregadores_disponibilidade select * from jsonb_populate_recordset(null::entregadores_disponibilidade,${literal(JSON.stringify(disponibilidade))}::jsonb)
      on conflict(user_id) do update set situacao=excluded.situacao,desde=excluded.desde,autor=excluded.autor,motivo=excluded.motivo;
    update pedidos p set entrega_planejamento_pausado=x.pausado from jsonb_to_recordset(${literal(JSON.stringify(pausados))}::jsonb) as x(id uuid,pausado boolean) where p.id=x.id;
    update loja set modo=${literal(loja.modo)},entrega_origem=${literal(JSON.stringify(loja.origem))}::jsonb,
      cotacao_ativa=${loja.cotacao},pagamentos_ativos=${loja.pagamentos} where id=1;
    update entrega_rotas_config set modo=${literal(cfg.modo)},regras=${literal(JSON.stringify(cfg.regras))}::jsonb,
      versao=${literal(cfg.versao)},limite_creditos_dia=${cfg.limite},cron_ativo=${cfg.cron},job_url=${cfg.url ? literal(cfg.url) : 'null'},
      despacho_individual_ativo=${cfg.ativo},despacho_ativado_em=${cfg.ativado ? literal(cfg.ativado) : 'null'},
      janela_agrupamento_seg=${cfg.janela},prazo_reserva_seg=${cfg.prazo},alterado_em=${literal(cfg.alterado)},
      alterado_por=${cfg.autor ? literal(cfg.autor) : 'null'} where id=1;`);
});

async function entrar(page, rota, email, antes) {
  await page.goto(rota);
  await expect(page.getByLabel('E-mail')).toBeVisible();
  if (antes) await antes();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function navegar(page, aba) {
  await page.locator(`[data-nav="${aba}"]:visible, [data-usuarios-ir="${aba}"]:visible`).first().click();
}

test('despacho individual: pronto e turno, saída carregada, dinheiro, confirmação offline e retorno', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const capturar = info.project.name === 'desktop';
  if (capturar) await page.setViewportSize({ width: 1280, height: 1600 });
  const captura = async (nome, alvo) => {
    if (!capturar) return;
    await mkdir(pasta, { recursive: true });
    await sharp(await alvo.screenshot({ animations: 'disabled' }))
      .webp({ quality: 88 })
      .toFile(`${pasta}/${nome}.webp`);
  };
  const p = JSON.parse(
    sql(
      `select criar_pedido(${literal(
        JSON.stringify({
          cliente: { nome: 'Cliente de demonstração', telefone: '11966400001' },
          modo: 'entrega',
          endereco: 'Rua de demonstração, 10',
          referencia: 'Endereço fictício para treinamento',
          distanciaKm: 2,
          pagamento: 'Dinheiro na entrega',
          troco: '100,00',
          itens: [{ produtoId: 'gran-burger', qtd: 1 }],
          idempotencia: randomUUID()
        })
      )}::jsonb)`
    )
  );
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mb = await mc.newPage();
  const capturaPedido = async (nome) => {
    if (!capturar) return;
    await page.setViewportSize({ width: 430, height: 1600 });
    await captura(nome, page.locator('.pn-m-item').filter({ has: page.locator(`[data-id="${p.id}"]`) }));
    await page.setViewportSize({ width: 1280, height: 1600 });
  };
  try {
    await entrar(page, '/painel/', 'equipe@teste.local');
    const avancar = () => page.locator(`[data-act="avancar"][data-id="${p.id}"]:visible`).first();
    await expect(avancar()).toHaveText('Aceitar e preparar');
    await avancar().click();
    await expect(avancar()).toHaveText('Marcar pronto');
    await capturaPedido('03-marcar-pronto');
    await avancar().click();
    await expect.poll(() => sql(`select status from pedidos where id='${p.id}'`)).toBe('pronto');
    expect(sql(`select entrega_destino is null from pedidos where id='${p.id}'`)).toBe('t');
    await navegar(page, 'entregadores');
    const central = page.locator('[data-r-central]:visible');
    await expect(central.locator('[data-r-modo]')).toHaveText('Despacho individual automático ativo');
    await expect(central.locator('[data-r-proximo]')).toContainText('Aguardando um motoboy disponível');
    await expect(page.locator('[data-e-detalhe="manual"]:visible')).not.toHaveAttribute('open');
    await captura('01-central', central);

    await entrar(mb, '/motoboy/', 'despacho-guia@teste.local', () => captura('02-login', mb.locator('.pn-acesso-caixa')));
    await mb.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => mb.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(mb.locator('[data-v="na_loja"]')).toHaveText('Começar turno');
    await captura('05-turno', mb.locator('[data-v-operacao]'));
    await mb.locator('[data-v="na_loja"]').click();
    await expect(mb.locator('[data-v-operacao]')).toContainText('O próximo pedido aparecerá aqui automaticamente');

    // Simula o job local sem expor o token privado nem consultar mapas.
    const resultado = JSON.parse(sql('select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1))'));
    execucoes = JSON.parse(
      sql(
        `select coalesce(jsonb_agg(id),'[]') from entrega_rotas_execucoes where entrada->>'tipoDespacho'='individual' and criado_em>=(select criado_em from pedidos where id='${p.id}')`
      )
    );
    expect(resultado.reservadas).toBe(1);
    const v = JSON.parse(
      sql(`select jsonb_build_object('id',v.id,'tipo',v.tipo_despacho,'metricas',v.metros is null and v.segundos is null and v.geometria is null)
      from entrega_viagens v join entrega_viagens_paradas s on s.viagem_id=v.id where s.pedido_id='${p.id}' and s.ativa`)
    );
    expect(v.tipo).toBe('individual');
    expect(v.metricas).toBe(true);
    await central.locator('[data-r="atualizar"]').click();
    await expect(central.locator(`[data-r-viagem="${v.id}"]`)).toContainText('Motoboy de demonstração');
    await expect(central.locator(`[data-r-viagem="${v.id}"]`)).toContainText('Distância e tempo não calculados');
    await captura('04-atribuido', central);
    await mb.locator('[data-v="atualizar"]').click();
    await expect(mb.locator('[data-v="sair"]')).toBeEnabled();
    await expect(mb.locator('[data-v-carregamento]')).toContainText('Pedidos carregados neste aparelho');
    await expect(mb.locator('[data-v="mapa"]')).toBeDisabled();
    await captura('06-carregada', mb.locator('[data-v-operacao]'));
    await mb.locator('[data-v="sair"]').click();
    await expect.poll(() => sql(`select status from pedidos where id='${p.id}'`)).toBe('rota');
    await expect(mb.locator('[data-v-operacao]')).toContainText('Próxima parada');
    await captura('07-em-entrega', mb.locator('[data-v-operacao]'));
    const item = mb.locator(`.mb-item[data-id="${p.id}"]`);
    await expect(item).toContainText('Cobrar na entrega:');
    await expect(item).toContainText('Troco para R$ 100,00');
    await captura('08-cobrar', item);
    expect(sql(`select pagamento_entrega_recebido_em is null from pedidos where id='${p.id}'`)).toBe('t');
    await mc.setOffline(true);
    await item.getByRole('button', { name: 'Entregue', exact: true }).click();
    await expect(mb.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
    expect(sql(`select status from pedidos where id='${p.id}'`)).toBe('rota');
    await captura('09-offline', mb.locator('.mb-sync'));
    await mc.setOffline(false);
    await mb.getByRole('button', { name: 'Sincronizar agora', exact: true }).click();
    await expect(mb.locator('[data-sync]')).toHaveText('Tudo sincronizado');
    await expect(mb.locator('[data-v="retornar"]')).toBeEnabled();
    await captura('10-sincronizado', mb.locator('.mb-sync'));
    await captura('11-retorno', mb.locator('[data-v-operacao]'));
    expect(sql(`select status||','||(pagamento_entrega_recebido_em is null)::text from pedidos where id='${p.id}'`)).toBe('entregue,true');
    await mb.locator('[data-v="retornar"]').click();
    await expect.poll(() => sql(`select estado from entrega_viagens where id='${v.id}'`)).toBe('encerrada');
    await expect(mb.locator('[data-v-operacao]')).toContainText('O próximo pedido aparecerá aqui automaticamente');
    await navegar(page, 'pedidos');
    await page.reload();
    await expect(page.locator(`.pn-card[data-id="${p.id}"]`)).toHaveAttribute('data-status', 'entregue');
    const receber = page.locator(`[data-act="receber-entrega"][data-id="${p.id}"]:visible`).first();
    await expect(receber).toBeVisible();
    await capturaPedido('12-recebimento');
    page.once('dialog', (d) => d.accept());
    await receber.click();
    await expect.poll(() => sql(`select pagamento_entrega_recebido_em is not null from pedidos where id='${p.id}'`)).toBe('t');
    expect(sql(`select count(*) from entregas_eventos where pedido_id='${p.id}' and tipo='confirmacao'`)).toBe('1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await mb.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await mc.close();
  }
});
