import test from 'node:test';
import assert from 'node:assert/strict';
import { criarGestor } from '../supabase/functions/gerenciar-usuarios/handler.js';
const autor = '00000000-0000-4000-8000-000000000001',
  alvo = '00000000-0000-4000-8000-000000000003';
const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
function preparar({
  admin = true,
  ativo = true,
  auth = true,
  erroRpc = false,
  emailUsado = false,
  vinculavel = false,
  falhaVinculo = false
} = {}) {
  const chamadas = [];
  const gestor = criarGestor({
    supabaseUrl: 'https://db.invalid',
    serviceKey: 'privado',
    fetcher: async (url, op) => {
      const s = String(url),
        body = op.body ? JSON.parse(op.body) : null;
      chamadas.push({ url: s, body, op });
      if (s.endsWith('/auth/v1/user')) {
        assert.equal(op.headers.Authorization, 'Bearer sessao');
        return json(auth ? { id: autor } : {}, auth ? 200 : 401);
      }
      if (s.includes('usuarios_painel?user_id=eq.' + autor)) return json([{ user_id: autor, perfil: admin ? 'admin' : 'equipe', ativo }]);
      if (s.includes('/equipe?')) return json([{ user_id: autor }]);
      if (s.includes('/auth/v1/admin/users?'))
        return json({ users: [{ id: alvo, email: 'moto@teste.local', email_confirmed_at: '2026-10-01' }] });
      if (s.includes('usuarios_painel?user_id=eq.' + alvo) && vinculavel) return json([]);
      if (s.includes('usuarios_painel?user_id=eq.' + alvo)) return json([{ user_id: alvo, email: 'moto@teste.local' }]);
      if (s.includes('usuarios_painel?select='))
        return json([{ user_id: alvo, nome: 'Entregador', email: 'moto@teste.local', perfil: 'motoboy', ativo: true }]);
      if (s.endsWith('/auth/v1/admin/users') && op.method === 'POST')
        return emailUsado ? json({ code: 'email_exists' }, 422) : json({ id: alvo });
      if (s.includes('/auth/v1/admin/users/' + alvo)) return json({ id: alvo });
      if (s.endsWith('/rpc/gerir_acesso_usuario'))
        return erroRpc || falhaVinculo
          ? json({ message: 'sem_permissao' }, 400)
          : json({ user_id: alvo, nome: body.p_nome, email: body.p_email, perfil: body.p_perfil, ativo: body.p_ativo });
      if (s.endsWith('/usuarios_painel_eventos')) return json([]);
      assert.fail('Chamada inesperada ' + s);
    }
  });
  return {
    chamadas,
    enviar: (p) =>
      gestor(
        new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer sessao' }, body: JSON.stringify(p) })
      ),
    gestor
  };
}
const novo = { acao: 'criar', nome: 'Entregador', email: 'moto@teste.local', perfil: 'motoboy', ativo: true, senha: 'Senha!123456' };
test('somente administrador ativo lista usuários; sessão é validada no servidor', async () => {
  for (const op of [{ admin: false }, { ativo: false }, { auth: false }]) {
    const { enviar, chamadas } = preparar(op),
      r = await enviar({ acao: 'listar' });
    assert.equal(r.status, op.auth === false ? 401 : 403);
    assert(!chamadas.some((c) => c.url.includes('usuarios_painel?select=')));
  }
  const { enviar } = preparar();
  assert.equal((await enviar({ acao: 'listar' })).status, 200);
});
test('cadastro usa Admin Auth, confirma e-mail e não devolve a senha nem chave', async () => {
  const { enviar, chamadas } = preparar(),
    r = await enviar(novo),
    texto = await r.text();
  assert.equal(r.status, 200);
  assert(!texto.includes(novo.senha));
  assert(!texto.includes('privado'));
  const criacao = chamadas.find((c) => c.url.endsWith('/admin/users'));
  assert.equal(criacao.body.email_confirm, true);
  const rpc = chamadas.find((c) => c.url.endsWith('/gerir_acesso_usuario'));
  assert.equal(rpc.body.p_autor, autor);
  assert.equal(rpc.body.p_perfil, 'motoboy');
  assert(!('senha' in rpc.body));
});
test('não cria Auth se os campos ou a senha são inválidos', async () => {
  for (const patch of [{ senha: 'curta' }, { perfil: 'superuser' }, { nome: 'X' }, { email: 'invalido' }, { ativo: 'true' }]) {
    const { enviar, chamadas } = preparar();
    assert.equal((await enviar({ ...novo, ...patch })).status, 422);
    assert(!chamadas.some((c) => c.url.includes('/admin/users')));
  }
});
test('falha ao liberar acesso remove somente o Auth recém-criado', async () => {
  const { enviar, chamadas } = preparar({ erroRpc: true });
  assert.equal((await enviar(novo)).status, 403);
  assert.equal(chamadas.filter((c) => c.op.method === 'DELETE').length, 1);
  assert(chamadas.find((c) => c.op.method === 'DELETE').url.endsWith(alvo));
});
test('e-mail existente não é sobrescrito nem excluído', async () => {
  const { enviar, chamadas } = preparar({ emailUsado: true }),
    r = await enviar(novo);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).codigo, 'email_em_uso');
  assert(!chamadas.some((c) => c.op.method === 'DELETE'));
});
test('edição usa o e-mail do cadastro e não concede privilégios enviados como autor no corpo', async () => {
  const { enviar, chamadas } = preparar();
  const r = await enviar({
    acao: 'editar',
    id: alvo,
    nome: 'Motoboy',
    perfil: 'motoboy',
    ativo: false,
    email: 'outro@teste.local',
    autor: alvo
  });
  assert.equal(r.status, 200);
  const rpc = chamadas.find((c) => c.url.endsWith('/gerir_acesso_usuario'));
  assert.equal(rpc.body.p_email, 'moto@teste.local');
  assert.equal(rpc.body.p_autor, autor);
});
test('nova senha usa endpoint administrativo sem armazená-la na auditoria', async () => {
  const { enviar, chamadas } = preparar();
  assert.equal((await enviar({ acao: 'senha', id: alvo, senha: novo.senha })).status, 200);
  assert.equal(chamadas.find((c) => c.op.method === 'PUT').body.password, novo.senha);
  assert(!JSON.stringify(chamadas.find((c) => c.url.endsWith('/usuarios_painel_eventos')).body).includes(novo.senha));
});
test('origem estranha, ausência de sessão e corpo inválido são recusados', async () => {
  const { gestor } = preparar();
  assert.equal(
    (await gestor(new Request('https://local.invalid', { method: 'POST', headers: { Origin: 'https://outra.invalid' } }))).status,
    403
  );
  assert.equal((await gestor(new Request('https://local.invalid', { method: 'POST' }))).status, 401);
  assert.equal(
    (await gestor(new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer sessao' }, body: 'null' })))
      .status,
    422
  );
});

test('vincula conta existente sem redefinir a senha e sem excluir a conta em caso de falha', async () => {
  for (const falhaVinculo of [false, true]) {
    const { enviar, chamadas } = preparar({ vinculavel: true, falhaVinculo });
    const r = await enviar({ ...novo, acao: 'vincular', senha: undefined });
    assert.equal(r.status, falhaVinculo ? 403 : 200);
    assert(!chamadas.some((c) => c.op.method === 'DELETE' || c.op.method === 'PUT'));
  }
});
