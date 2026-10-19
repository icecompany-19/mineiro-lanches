/* global document */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const PG=process.env.PG_URL||'postgresql://postgres@localhost:54322/postgres';
const sql=s=>execFileSync('psql',[PG,'-X','-q','-At','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'}).trim();
const equipe='00000000-0000-4000-8000-000000000001';
const moto='20000000-0000-4000-8000-000000000003',outro='20000000-0000-4000-8000-000000000004';
let modo;
test.beforeAll(()=>{
  modo=sql('select modo from loja where id=1');
  sql(`insert into equipe(user_id,nome) values('${equipe}','Equipe teste') on conflict do nothing;
  insert into auth.users(id,email) values('${moto}','entregador-operacao@teste.local'),('${outro}','outro-operacao@teste.local') on conflict do nothing;
  insert into motoboys(user_id,nome) values('${moto}','Moto operação'),('${outro}','Outro operação') on conflict(user_id) do update set ativo=true;
  update loja set modo='aberta';`);
});
test.afterAll(()=>{
  sql(`delete from pedidos where cliente_telefone like '119666%'; delete from clientes where telefone like '119666%';
  delete from auth.users where id in ('${moto}','${outro}');update loja set modo='${modo}';`);
});
async function entrar(page,rota,email){
  await page.goto(rota);await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha').fill('teste');await page.getByRole('button',{name:'Entrar',exact:true}).click();
}
function pedido(nome='Entrega operacional'){
  const tel='119666'+String(Math.floor(Math.random()*100000)).padStart(5,'0');
  return JSON.parse(sql(`select criar_pedido('${JSON.stringify({cliente:{nome,telefone:tel},modo:'entrega',endereco:'Rua Teste, 10',distanciaKm:2.5,itens:[{produtoId:'gran-burger',qtd:1}],idempotencia:randomUUID()})}'::jsonb)`));
}
function atribuir(p,m=moto){
  sql(`begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);
  select mudar_status('${p.id}','preparo');select atribuir_entrega('${p.id}','${m}',true);commit;`);
}
async function prepararCelular(page){
  await entrar(page,'/motoboy/','entregador-operacao@teste.local');
  await expect(page.locator('.mb-app')).toBeVisible();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('[data-preparo]')).toContainText('Pedidos carregados');
}

test('fila persiste ao fechar e reabrir sem internet; sincronização entrega só uma vez',async({page,context})=>{
  const p=pedido(),alheio=pedido('Outro entregador');atribuir(p);atribuir(alheio,outro);
  await prepararCelular(page);
  const item=page.locator(`.mb-item[data-id="${p.id}"]`);
  await expect(item).toBeVisible();await expect(page.locator(`.mb-item[data-id="${alheio.id}"]`)).toHaveCount(0);
  await context.setOffline(true);await item.getByRole('button',{name:'Entregue',exact:true}).click();
  await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  expect(sql(`select status from pedidos where id='${p.id}'`)).toBe('rota');
  await page.close();const reaberta=await context.newPage();await reaberta.goto('/motoboy/');
  await expect(reaberta.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  await expect(reaberta.locator(`.mb-item[data-id="${p.id}"]`)).toContainText('Confirmada neste aparelho');
  await context.setOffline(false);await reaberta.getByRole('button',{name:'Sincronizar agora'}).click();
  await expect(reaberta.locator('[data-sync]')).toHaveText('Tudo sincronizado');
  expect(sql(`select status from pedidos where id='${p.id}'`)).toBe('entregue');
  expect(sql(`select count(*) from entregas_eventos where pedido_id='${p.id}' and tipo='confirmacao'`)).toBe('1');
  await reaberta.getByRole('button',{name:'Sincronizar agora'}).click();
  expect(sql(`select count(*) from entregas_eventos where pedido_id='${p.id}' and tipo='confirmacao'`)).toBe('1');
});

test('equipe atribui, registra saída e dá baixa manual; envio posterior preserva responsável e motivo',async({page,browser})=>{
  const p=pedido('Baixa no retorno');
  sql(`begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);select mudar_status('${p.id}','preparo');commit;`);
  await entrar(page,'/painel/','equipe@teste.local');
  await page.locator('[data-nav="entregadores"]:visible, [data-usuarios-ir="entregadores"]:visible').first().click();
  const card=page.locator(`.pn-entrega[data-entrega="${p.id}"]:visible`);
  await expect(card).toBeVisible();await card.getByRole('combobox').selectOption(moto);await card.getByRole('button',{name:'Atribuir',exact:true}).click();
  await expect(card.getByRole('button',{name:/Registrar saída/})).toBeVisible();await card.getByRole('button',{name:/Registrar saída/}).click();
  await expect(card).toContainText('Em entrega');
  const mc=await browser.newContext({viewport:{width:390,height:844}}),mb=await mc.newPage();
  await prepararCelular(mb);await mc.setOffline(true);
  await mb.locator(`.mb-item[data-id="${p.id}"]`).getByRole('button',{name:'Entregue',exact:true}).click();
  await expect(mb.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  await card.getByRole('button',{name:/Baixa manual/}).click();await card.getByLabel(/Motivo da baixa manual/).fill('Conferido presencialmente no retorno');
  await card.getByRole('button',{name:'Confirmar baixa manual',exact:true}).click();await expect(card).toContainText('Conferido presencialmente no retorno');
  const antes=sql(`select to_jsonb(e)::text from entregas_operacao e where pedido_id='${p.id}'`);
  await mc.setOffline(false);await mb.getByRole('button',{name:'Sincronizar agora'}).click();await expect(mb.locator('[data-sync]')).toHaveText('Tudo sincronizado');
  expect(sql(`select to_jsonb(e)::text from entregas_operacao e where pedido_id='${p.id}'`)).toBe(antes);
  await card.getByRole('button',{name:/Histórico/}).click();
  await expect(page.locator('.pn-entrega-historico:visible')).toContainText('Conferido presencialmente no retorno');
  await mc.close();
});

test('alerta acompanha entregas antigas e filtro mantém períodos e média',async({page})=>{
  const p=pedido('Entrega aberta antiga');atribuir(p);
  sql(`update entregas_operacao set saiu_em=now()-interval '2 hours' where pedido_id='${p.id}';update pedidos set criado_em=now()-interval '5 days' where id='${p.id}';`);
  await entrar(page,'/painel/','equipe@teste.local');
  await page.locator('[data-nav="entregadores"]:visible, [data-usuarios-ir="entregadores"]:visible').first().click();
  const card=page.locator(`.pn-entrega[data-entrega="${p.id}"]:visible`);await expect(card).toContainText('Entrega aberta há muito tempo');
  await page.locator('[data-e-periodo]:visible').selectOption('7');await expect(card).toBeVisible();
  await page.locator('[data-e-filtro]:visible').selectOption(moto);await expect(card).toBeVisible();
  await expect(page.locator('.pn-entregadores:visible')).toContainText('Tempo médio');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test('cancelamento encontrado no retorno exige conferência e conserva auditoria',async({page,context})=>{
  const p=pedido('Cancelado com confirmação offline');atribuir(p);await prepararCelular(page);
  await context.setOffline(true);await page.locator(`.mb-item[data-id="${p.id}"]`).getByRole('button',{name:'Entregue',exact:true}).click();
  await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  sql(`begin;select set_config('request.jwt.claims','{"sub":"${equipe}","role":"authenticated"}',true);select mudar_status('${p.id}','cancelado','Conferência de cancelamento');commit;`);
  await context.setOffline(false);await page.getByRole('button',{name:'Sincronizar agora'}).click();
  await expect(page.locator('[data-pendencias]')).toContainText('Pedido cancelado');
  await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Conferi o cancelamento com a equipe'}).click();
  await expect(page.locator('[data-sync]')).toHaveText('Tudo sincronizado');
  expect(sql(`select status from pedidos where id='${p.id}'`)).toBe('cancelado');
  expect(sql(`select count(*) from entregas_eventos where pedido_id='${p.id}' and tipo='cancelamento_conferido'`)).toBe('1');
});

test('troca de usuário não mistura confirmações guardadas no aparelho',async({page,context})=>{
  const p=pedido('Fila do usuário original');atribuir(p);await prepararCelular(page);
  await context.setOffline(true);await page.locator(`.mb-item[data-id="${p.id}"]`).getByRole('button',{name:'Entregue',exact:true}).click();
  await expect(page.locator('[data-sync]')).toContainText('1 confirmação aguardando envio');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Sair',exact:true}).click();
  await context.setOffline(false);await expect(page.getByLabel('E-mail')).toBeVisible();
  await page.getByLabel('E-mail').fill('outro-operacao@teste.local');await page.getByLabel('Senha').fill('teste');await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.locator('[data-sync]')).toHaveText('Tudo sincronizado');
  expect(sql(`select status from pedidos where id='${p.id}'`)).toBe('rota');
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await entrar(page,'/motoboy/','entregador-operacao@teste.local');await page.getByRole('button',{name:'Sincronizar agora'}).click();
  await expect(page.locator('[data-sync]')).toHaveText('Tudo sincronizado');
  expect(sql(`select status from pedidos where id='${p.id}'`)).toBe('entregue');
});
