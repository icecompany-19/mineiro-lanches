import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { criarGestor } from '../supabase/functions/gerenciar-usuarios/handler.js';
const PG = 'postgresql://postgres@localhost:54322/postgres';
const sql = (s) => execFileSync('psql', [PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const admin = '10000000-0000-4000-8000-000000000001',
  crew = '10000000-0000-4000-8000-000000000002';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const h = b64({ alg: 'HS256', typ: 'JWT' }),
  p = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
const token =
  h +
  '.' +
  p +
  '.' +
  createHmac('sha256', 'segredo-local-de-teste-com-mais-de-32-caracteres')
    .update(h + '.' + p)
    .digest('base64url');
function seed() {
  sql(`insert into auth.users(id,email) values('${admin}','user-test-admin@teste.local'),('${crew}','user-test-crew@teste.local') on conflict(id) do nothing;
 insert into equipe(user_id,nome) values('${admin}','Administrador teste'),('${crew}','Equipe teste') on conflict(user_id) do nothing;
 insert into usuarios_painel(user_id,nome,email,perfil,ativo) values('${admin}','Administrador teste','user-test-admin@teste.local','admin',true),('${crew}','Equipe teste','user-test-crew@teste.local','equipe',true) on conflict(user_id) do update set perfil=excluded.perfil,ativo=true;`);
}
test.beforeEach(() => seed());
test.afterAll(() => sql("delete from auth.users where email like 'user-test-%@teste.local'"));
async function preparar(page) {
  const alteracoes = [];
  const api = criarGestor({
    supabaseUrl: 'http://localhost:54323',
    serviceKey: token,
    fetcher: async (u, op) => {
      const s = String(u),
        body = op.body ? JSON.parse(op.body) : null;
      if (s.endsWith('/auth/v1/user')) return fetch('http://localhost:54321/auth/v1/user', op);
      if (s.includes('/auth/v1/admin/users?'))
        return new Response(
          JSON.stringify({
            users: JSON.parse(
              sql(
                "select coalesce(json_agg(json_build_object('id',id,'email',email,'email_confirmed_at','2026-10-01')), '[]') from auth.users"
              )
            )
          })
        );
      if (s.endsWith('/auth/v1/admin/users') && op.method === 'POST') {
        const id = randomUUID();
        sql(`insert into auth.users(id,email) values(${lit(id)},${lit(body.email)})`);
        return new Response(JSON.stringify({ id }));
      }
      if (s.includes('/auth/v1/admin/users/')) {
        alteracoes.push(body);
        return new Response('{}');
      }
      return fetch(s.replace('http://localhost:54323/rest/v1/', 'http://localhost:54323/'), op);
    }
  });
  await page.route('**/functions/v1/gerenciar-usuarios', async (route) => {
    const r = route.request();
    const response = await api(new Request('https://local.invalid', { method: r.method(), headers: r.headers(), body: r.postData() }));
    await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json' }, body: await response.text() });
  });
  return alteracoes;
}
async function entrar(page, email = 'user-test-admin@teste.local') {
  await page.goto('/painel/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Usuários', exact: true }).click();
}
async function criar(page, nome = 'Entregador novo') {
  const email = 'user-test-' + randomUUID() + '@teste.local';
  await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
  const f = page.getByRole('form', { name: 'Cadastrar usuário' });
  await f.getByLabel('Nome', { exact: true }).fill(nome);
  await f.getByLabel('E-mail', { exact: true }).fill(email);
  await f.getByLabel('Senha inicial').fill('Senha!123456');
  await f.getByRole('button', { name: 'Salvar usuário' }).click();
  await expect(page.getByRole('heading', { name: nome, exact: true })).toBeVisible();
  return email;
}
test('cadastra motoboy pelo painel e preserva separação da equipe', async ({ page }) => {
  await preparar(page);
  await entrar(page);
  const email = await criar(page);
  expect(
    sql(
      `select u.perfil,u.ativo,exists(select 1 from motoboys m where m.user_id=u.user_id and m.ativo),exists(select 1 from equipe e where e.user_id=u.user_id) from usuarios_painel u where u.email=${lit(email)}`
    )
  ).toBe('motoboy|t|t|f');
  await expect(
    page.locator('[data-usuarios]:visible').getByText('Usuário cadastrado. Acesso: mineirolanches.store/motoboy/', { exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('usuarios.png'), fullPage: true });
  await page.goto('/motoboy/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Senha!123456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entregas', exact: true })).toBeVisible();
});
test('edita perfil, desativa, reativa e redefine senha sem abrir o Supabase', async ({ page }) => {
  const senhas = await preparar(page);
  await entrar(page);
  const email = await criar(page, 'Teste de acesso');
  await page.getByRole('button', { name: 'Editar Teste de acesso', exact: true }).click();
  const f = page.getByRole('form', { name: 'Editar usuário' });
  await f.getByLabel('Perfil').selectOption('equipe');
  await f.getByRole('button', { name: 'Salvar usuário' }).click();
  await page.getByRole('button', { name: 'Desativar Teste de acesso' }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reativar Teste de acesso' })).toBeVisible();
  expect(
    sql(`select u.ativo,exists(select 1 from equipe e where e.user_id=u.user_id) from usuarios_painel u where u.email=${lit(email)}`)
  ).toBe('f|f');
  await page.getByRole('button', { name: 'Reativar Teste de acesso' }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Desativar Teste de acesso' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova senha de Teste de acesso' }).click();
  const senha = page.getByRole('form', { name: 'Definir nova senha' });
  await senha.getByLabel('Nova senha').fill('Outra!Senha123');
  await senha.getByRole('button', { name: 'Salvar usuário' }).click();
  await expect(
    page.locator('[data-usuarios]:visible').getByText('Senha atualizada. Informe a nova senha diretamente ao usuário.')
  ).toBeVisible();
  expect(senhas).toContainEqual({ password: 'Outra!Senha123' });
});
test('conta existente é liberada sem alterar a senha', async ({ page }) => {
  const id = randomUUID(),
    email = 'user-test-' + id + '@teste.local';
  sql(`insert into auth.users(id,email) values(${lit(id)},${lit(email)})`);
  const alteracoes = await preparar(page);
  await entrar(page);
  await page.getByRole('button', { name: 'Liberar conta existente', exact: true }).click();
  const f = page.getByRole('form', { name: 'Liberar conta existente' });
  await f.getByLabel('Nome', { exact: true }).fill('Já cadastrado');
  await f.getByLabel('E-mail', { exact: true }).fill(email);
  await expect(f.locator('input[type=password]')).toHaveCount(0);
  await f.getByRole('button', { name: 'Salvar usuário' }).click();
  await expect(page.getByRole('heading', { name: 'Já cadastrado', exact: true })).toBeVisible();
  expect(alteracoes).toEqual([]);
});
test('equipe não pode gerenciar usuários', async ({ page }) => {
  await preparar(page);
  await entrar(page, 'user-test-crew@teste.local');
  await expect(
    page.locator('[data-usuarios]:visible').getByText('Somente administradores podem gerenciar usuários.', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo usuário', exact: true })).toHaveCount(0);
});
test('bloqueia retirada da própria administração mesmo adulterando o formulário', async ({ page }) => {
  await preparar(page);
  await entrar(page);
  await page.getByRole('button', { name: 'Editar Administrador teste', exact: true }).click();
  const f = page.getByRole('form', { name: 'Editar usuário' });
  await expect(f.getByLabel('Perfil')).toBeDisabled();
  await f.getByLabel('Perfil').evaluate((el) => (el.disabled = false));
  await f.getByLabel('Perfil').selectOption('motoboy');
  await f.getByRole('button', { name: 'Salvar usuário' }).click();
  await expect(f.getByRole('alert')).toContainText('próprio acesso');
  expect(sql(`select perfil from usuarios_painel where user_id='${admin}'`)).toBe('admin');
});
