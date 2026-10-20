import test from 'node:test';
import assert from 'node:assert/strict';
import { ambienteBuild } from '../scripts/build.mjs';

const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/mercado-pago', VERCEL_BRANCH_URL: 'mineiro-git-pagamentos.vercel.app' };
test('preview de pagamentos ignora variáveis produtivas e usa exclusivamente o Supabase de homologação', () => {
  const ambiente = ambienteBuild({ ...preview, VITE_SUPABASE_URL: 'https://producao.invalid', VITE_SITE_URL: 'https://mineirolanches.store', VITE_DEMO: '1' });
  assert.equal(ambiente.VITE_SUPABASE_URL, 'https://hkfoetwnphbauezftfgq.supabase.co');
  assert.equal(JSON.parse(Buffer.from(ambiente.VITE_SUPABASE_ANON_KEY.split('.')[1], 'base64url')).role, 'anon');
  assert.equal(ambiente.VITE_SUPABASE_FUNCTIONS_ANON_KEY, ambiente.VITE_SUPABASE_ANON_KEY);
  assert.equal(ambiente.VITE_SITE_URL, 'https://mineiro-git-pagamentos.vercel.app');
  assert.equal(ambiente.VITE_DEMO, '0');
});
test('produção e build local preservam suas variáveis; URL ausente ou inválida interrompe o preview de pagamentos', () => {
  for (const env of [{ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'feat/mercado-pago' }, {}, { ...preview, VERCEL_GIT_COMMIT_REF: 'outra-branch' }])
    assert.deepEqual(ambienteBuild(env), env);
  for (const host of [undefined, 'mineirolanches.store', 'a.vercel.app.evil.invalid', 'a.vercel.app/rota'])
    assert.throws(() => ambienteBuild({ ...preview, VERCEL_BRANCH_URL: host }));
});
