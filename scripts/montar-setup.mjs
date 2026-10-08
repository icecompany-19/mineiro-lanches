// Junta as migrations e o seed em supabase/setup.sql, para colar no SQL Editor do Supabase.
// Uso: node scripts/montar-setup.mjs   (rode antes o node scripts/gerar-seed.mjs se o CONFIG mudou)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = path.join(RAIZ, 'supabase/migrations');
const SEED = path.join(RAIZ, 'supabase/seed.sql');

const migrations = fs
  .readdirSync(PASTA)
  .filter((f) => f.endsWith('.sql'))
  .sort();
if (!migrations.length) throw new Error('nenhuma migration em supabase/migrations');
if (!fs.existsSync(SEED)) throw new Error('supabase/seed.sql não existe: rode node scripts/gerar-seed.mjs');

const partes = migrations.map((f) => ({ nome: 'supabase/migrations/' + f, sql: fs.readFileSync(path.join(PASTA, f), 'utf8') }));
partes.push({ nome: 'supabase/seed.sql', sql: fs.readFileSync(SEED, 'utf8') });

const cabecalho = `-- =====================================================================================
-- Mineiro Lanche · setup completo do banco (Supabase)
-- Gerado por scripts/montar-setup.mjs a partir de ${partes.map((p) => p.nome).join(', ')}.
-- Não edite à mão: mude as migrations ou o CONFIG e rode
--   node scripts/gerar-seed.mjs && node scripts/montar-setup.mjs
--
-- Como aplicar: Dashboard do Supabase → SQL Editor → New query → colar este arquivo inteiro → Run.
-- (Se o editor avisar de "operações destrutivas", são os drop ... if exists que recriam policies
--  e gatilhos; pode confirmar.)
-- Idempotente: rodar de novo não dá erro nem duplica dados, policies ou tabelas no Realtime.
-- Roda numa transação só: se algo falhar, nada fica pela metade.
-- Depois: dê acesso ao painel com o comando comentado no fim do arquivo.
-- =====================================================================================

begin;
`;

const rodape = `
-- o PostgREST recarrega o schema (funções novas aparecem na API na hora)
notify pgrst, 'reload schema';

commit;

-- =====================================================================================
-- Acesso ao painel: crie o usuário em Authentication → Users (e-mail e senha) e rode,
-- trocando EMAIL_AQUI pelo e-mail dele:
--
-- insert into equipe (user_id, nome) select id, 'Dono' from auth.users where email = 'EMAIL_AQUI' on conflict do nothing;
-- =====================================================================================
`;

const corpo = partes.map((p) => `\n-- ============ ${p.nome} ============\n\n${p.sql.trim()}\n`).join('');
const destino = path.join(RAIZ, 'supabase/setup.sql');
fs.writeFileSync(destino, cabecalho + corpo + rodape);
console.log(`setup.sql montado com ${partes.length} partes (${(fs.statSync(destino).size / 1024).toFixed(1)} KB)`);
