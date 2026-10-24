/* global document */
// Fila da loja na tela do motoboy, contra o banco local (migration 20261024023500): o motoboy vê os pedidos
// prontos sem entregador, pega mais um antes de sair, perde a disputa para outro motoboy e sai com os dois.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const sql = (s) => execFileSync('psql', [PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
const literal = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const como = (id, s) => sql(`select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',false); ${s}`);
const equipe = '00000000-0000-4000-8000-000000000001';
const moto = '46000000-0000-4000-8000-000000000007';
const outro = '46000000-0000-4000-8000-000000000008';
let cfg, loja, pausados;

test.beforeAll(() => {
  cfg = JSON.parse(
    sql(`select jsonb_build_object('modo',modo,'regras',regras,'versao',versao,'cron',cron_ativo,'url',job_url,
    'ativo',despacho_individual_ativo,'ativado',despacho_ativado_em,'prazo',prazo_reserva_seg) from entrega_rotas_config where id=1`)
  );
  loja = JSON.parse(
    sql(`select jsonb_build_object('modo',modo,'cotacao',cotacao_ativa,'pagamentos',pagamentos_ativos) from loja where id=1`)
  );
  pausados = JSON.parse(
    sql(
      "select coalesce(jsonb_agg(jsonb_build_object('id',id,'pausado',entrega_planejamento_pausado)),'[]') from pedidos where status='pronto'"
    )
  );
  sql(`insert into equipe(user_id,nome) values('${equipe}','Equipe teste') on conflict do nothing;
    insert into auth.users(id,email) values('${moto}','fila-moto@teste.local'),('${outro}','fila-outro@teste.local') on conflict do nothing;
    insert into motoboys(user_id,nome) values('${moto}','Motoboy da fila'),('${outro}','Outro motoboy') on conflict(user_id) do update set ativo=true;
    update pedidos set entrega_planejamento_pausado=true where status='pronto';
    update loja set modo='aberta',cotacao_ativa=false,pagamentos_ativos=false where id=1;
    update entrega_rotas_config set modo='desligado',regras='{}',despacho_individual_ativo=true,despacho_ativado_em=now(),
      prazo_reserva_seg=300,cron_ativo=false,job_url=null,versao=gen_random_uuid() where id=1;`);
});

test.afterAll(() => {
  sql(`delete from pedidos where cliente_telefone like '119665%';
    delete from clientes where telefone like '119665%';
    delete from entrega_rotas_eventos where motoboy_id in ('${moto}','${outro}');
    delete from entrega_viagens where motoboy_id in ('${moto}','${outro}');
    delete from entrega_rotas_execucoes where entrada->>'tipoDespacho'='individual' and criado_em>now()-interval '10 minutes';
    delete from auth.users where id in ('${moto}','${outro}');
    update pedidos p set entrega_planejamento_pausado=x.pausado from jsonb_to_recordset(${literal(JSON.stringify(pausados))}::jsonb) as x(id uuid,pausado boolean) where p.id=x.id;
    update loja set modo=${literal(loja.modo)},cotacao_ativa=${loja.cotacao},pagamentos_ativos=${loja.pagamentos} where id=1;
    update entrega_rotas_config set modo=${literal(cfg.modo)},regras=${literal(JSON.stringify(cfg.regras))}::jsonb,versao=${literal(cfg.versao)},
      cron_ativo=${cfg.cron},job_url=${cfg.url ? literal(cfg.url) : 'null'},despacho_individual_ativo=${cfg.ativo},
      despacho_ativado_em=${cfg.ativado ? literal(cfg.ativado) : 'null'},prazo_reserva_seg=${cfg.prazo} where id=1;`);
});

function pedidoPronto(n, minutos) {
  const p = JSON.parse(
    sql(
      `select criar_pedido(${literal(
        JSON.stringify({
          cliente: { nome: 'Cliente da fila ' + n, telefone: '1196650000' + n },
          modo: 'entrega',
          endereco: `Rua da Fila, ${n}0`,
          distanciaKm: 2,
          pagamento: 'Pix na entrega',
          itens: [{ produtoId: 'gran-burger', qtd: 1 }],
          idempotencia: randomUUID()
        })
      )}::jsonb)`
    )
  );
  como(equipe, `select mudar_status('${p.id}','preparo'); select mudar_status('${p.id}','pronto');`);
  // prontos em minutos diferentes: a fila e o job seguem a ordem de prontidão
  sql(`update pedidos set historico=jsonb_set(historico,array[(jsonb_array_length(historico)-1)::text,'em'],
    to_jsonb(public.data_iso(now()-interval '${minutos} minutes'))) where id='${p.id}'`);
  return p;
}

test('fila da loja: vê os prontos, pega mais um antes de sair e perde a disputa para outro motoboy', async ({ browser }) => {
  test.setTimeout(120_000);
  const [p1, p2, p3] = [pedidoPronto(1, 9), pedidoPronto(2, 6), pedidoPronto(3, 3)];
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mb = await mc.newPage();
  try {
    await mb.goto('/motoboy/');
    await mb.getByLabel('E-mail').fill('fila-moto@teste.local');
    await mb.getByLabel('Senha').fill('teste');
    await mb.getByRole('button', { name: 'Entrar', exact: true }).click();
    await mb.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => mb.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const fila = mb.locator('[data-v-fila]');
    const itens = fila.locator('[data-v-disp]');
    await expect(itens).toHaveCount(3);
    await expect(itens.nth(0)).toHaveAttribute('data-v-disp', p1.id);
    await expect(fila).toContainText('Informe acima que está disponível na loja');
    await expect(fila.getByRole('button', { name: /^Pegar pedido/ }).first()).toBeDisabled();

    // Começa o turno e o job reserva o mais antigo para ele; os outros continuam visíveis.
    await mb.locator('[data-v="na_loja"]').click();
    await expect(fila).toContainText('Toque em Pegar para reservar o pedido para você');
    expect(
      JSON.parse(sql('select iniciar_planejamento_entregas(null,(select job_token from entrega_rotas_config where id=1))')).reservadas
    ).toBe(1);
    await mb.locator('[data-v="atualizar"]').click();
    await expect(mb.locator('[data-v-operacao]')).toContainText('1 pedido nesta saída');
    await expect(itens).toHaveCount(2);
    await expect(fila).toContainText('Toque em Pegar para levar junto nesta saída');

    // Pega o segundo: a saída passa a ter dois pedidos e é carregada de novo no aparelho.
    mb.once('dialog', (d) => d.accept());
    await fila.getByRole('button', { name: `Pegar pedido #${String(p2.numero).padStart(4, '0')}` }).click();
    await expect(fila.locator('.mb-disp-aviso')).toContainText('reservado para você');
    await expect(mb.locator('[data-v-operacao]')).toContainText('2 pedidos nesta saída');
    await expect(mb.locator('[data-v-carregamento]')).toContainText('Pedidos carregados neste aparelho');
    await expect(mb.locator('[data-v="sair"]')).toHaveText('Sair com 2 pedidos');
    await expect(mb.locator('[data-v="sair"]')).toBeEnabled();
    await expect(mb.locator(`.mb-item[data-id="${p2.id}"]`)).toContainText('Aguardando saída');
    await expect(itens).toHaveCount(1);

    // Outro motoboy leva o terceiro antes; a tela ainda mostra o pedido até a próxima consulta.
    sql(`insert into entregadores_disponibilidade(user_id,situacao,desde) values('${outro}','na_loja',now())
      on conflict(user_id) do update set situacao='na_loja',desde=now()`);
    como(outro, `select pegar_pedido_entrega('${p3.id}')`);
    mb.once('dialog', (d) => d.accept());
    await fila.getByRole('button', { name: `Pegar pedido #${String(p3.numero).padStart(4, '0')}` }).click();
    await expect(fila.locator('[role="alert"]')).toContainText('Outro entregador pegou este pedido primeiro');
    await expect(fila).toContainText('Nenhum pedido pronto aguardando entregador agora.');
    expect(sql(`select motoboy_id from entregas_operacao where pedido_id='${p3.id}'`)).toBe(outro);

    // Sai com os dois; na rua a fila fica só para consulta.
    await mb.locator('[data-v="sair"]').click();
    await expect
      .poll(() => sql(`select string_agg(status,',' order by numero) from pedidos where id in ('${p1.id}','${p2.id}')`))
      .toBe('rota,rota');
    await expect(fila).not.toHaveAttribute('open', '');
    await fila.locator('summary').click();
    await expect(fila).toContainText('A fila fica aqui só para consulta');
    expect(await mb.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await mc.close();
  }
});
