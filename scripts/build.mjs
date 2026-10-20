// Só a chave pública anon vai ao bundle; Access Token do Mercado Pago continua no Supabase.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(import.meta.dirname, '..');
const homologacao = JSON.parse(readFileSync(resolve(raiz, 'config/mercado-pago-homologacao.json'), 'utf8'));

export function ambienteBuild(env) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'feat/mercado-pago') return { ...env };
  // Exige URL estável da branch. Não usar a URL produtiva ou um domínio fornecido pelo comprador.
  const host = env.VERCEL_BRANCH_URL;
  if (!host || !/^[a-z0-9-]+\.vercel\.app$/.test(host)) throw Error('Preview Mercado Pago exige VERCEL_BRANCH_URL válido');
  return { ...env, ...homologacao, VITE_SITE_URL: 'https://' + host };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const resultado = spawnSync(process.execPath, [resolve(raiz, 'node_modules/vite/bin/vite.js'), 'build', ...process.argv.slice(2)], {
      cwd: raiz, env: ambienteBuild(process.env), stdio: 'inherit'
    });
    if (resultado.error) throw resultado.error;
    process.exitCode = resultado.status ?? 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
