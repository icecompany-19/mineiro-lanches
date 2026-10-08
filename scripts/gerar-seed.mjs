// Gera supabase/seed.sql a partir do CONFIG do core.js (cardápio, adicionais e loja).
// Uso: node scripts/gerar-seed.mjs [caminho/do/core.js]   (padrão: src/core.js)
// O seed é idempotente: atualiza nome, preço, categoria, ordem, ingredientes, tipo e foto pelo id, sem mexer
// em esgotado_dia. O CONFIG manda no ativo: o que está nele fica ativo (inclusive o que saiu e voltou) e o que
// saiu fica inativo. Loja: insere se não existir e só atualiza horarios e combo_preco.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function caminhoCore(arg) {
  if (arg) return path.resolve(arg);
  return path.join(RAIZ, 'src/core.js');
}

// core.js como script: tira import/export (caso tenha virado módulo) para rodar no node:vm
function comoScript(codigo) {
  return codigo
    .replace(/^\s*import\s[^;]*?\sfrom\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/^\s*import\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/import\.meta\.env/g, '({})')
    .replace(/import\.meta/g, '({})')
    .replace(/^\s*export\s+default\s+/gm, 'globalThis.__padrao = ')
    .replace(/^\s*export\s*\{[^}]*\}\s*(from\s*['"][^'"]*['"])?\s*;?/gm, '')
    .replace(/^(\s*)export\s+(?=(async\s+)?(const|let|var|function|class)\b)/gm, '$1');
}

// avalia o core.js com o mínimo de navegador que ele usa e devolve { ML, CONFIG, contexto }
export function carregarCore(arquivo = caminhoCore()) {
  const codigo = comoScript(fs.readFileSync(arquivo, 'utf8'));
  const nada = () => {};
  const guardado = new Map();
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    localStorage: {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, String(v)),
      removeItem: (k) => guardado.delete(k),
      clear: () => guardado.clear()
    },
    document: {
      readyState: 'complete',
      addEventListener: nada,
      removeEventListener: nada,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute: nada, appendChild: nada, addEventListener: nada }),
      documentElement: { style: {}, classList: { add: nada, remove: nada, toggle: nada } },
      body: null,
      visibilityState: 'visible'
    },
    BroadcastChannel: class {
      postMessage() {}
      close() {}
    },
    location: { href: 'http://localhost/', hash: '', search: '', pathname: '/' },
    navigator: { userAgent: 'node' },
    addEventListener: nada,
    removeEventListener: nada,
    matchMedia: () => ({ matches: false, addEventListener: nada })
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: arquivo });
  // window.ML (script) ou CONFIG/ML de topo (módulo convertido)
  const ML = ctx.ML || vm.runInContext('typeof ML !== "undefined" ? ML : (globalThis.__padrao || undefined)', ctx);
  const CONFIG = (ML && ML.CONFIG) || vm.runInContext('typeof CONFIG !== "undefined" ? CONFIG : undefined', ctx);
  if (!CONFIG || !Array.isArray(CONFIG.categorias)) throw new Error('CONFIG não encontrado em ' + arquivo);
  return { ML, CONFIG, contexto: ctx };
}

// ================= SQL =================
const txt = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const num = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('preço inválido: ' + v);
  return v.toFixed(2);
};
const arr = (a) => (a && a.length ? 'array[' + a.map(txt).join(', ') + ']::text[]' : "'{}'::text[]");

export function montarSeed(CONFIG, origem = 'src/core.js') {
  const produtos = [];
  CONFIG.categorias.forEach((c) => c.itens.forEach((p) => produtos.push({ ...p, categoria: c.id })));
  const ids = new Set();
  produtos.forEach((p) => {
    if (ids.has(p.id)) throw new Error('id repetido no CONFIG: ' + p.id);
    ids.add(p.id);
  });
  const adicionais = CONFIG.adicionais || [];
  const combo = CONFIG.regras && CONFIG.regras.combo ? CONFIG.regras.combo.preco : null;
  if (typeof combo !== 'number') throw new Error('CONFIG.regras.combo.preco ausente');
  // {"0": null, "1": ["19:00","00:00"], ...}
  const horarios = {};
  Object.keys(CONFIG.horarios || {}).forEach((d) => (horarios[String(d)] = CONFIG.horarios[d] || null));

  const linhasProd = produtos.map(
    (p, i) =>
      `  (${txt(p.id)}, ${txt(p.categoria)}, ${txt(p.nome)}, ${num(p.preco)}, ${txt(p.tipo)}, ` +
      `${p.foto ? txt(p.foto) : 'null'}, ${arr(p.ing)}, ${i + 1})`
  );
  const linhasAdic = adicionais.map((a) => `  (${txt(a.id)}, ${txt(a.nome)}, ${num(a.preco)})`);

  return `-- Cardápio do Mineiro Lanche: gerado por scripts/gerar-seed.mjs a partir do CONFIG de ${origem}. Não edite à mão.
-- ${produtos.length} produtos e ${adicionais.length} adicionais. Idempotente: atualiza nome, preço, categoria, ordem,
-- ingredientes, tipo e foto pelo id, sem mexer em esgotado_dia. O CONFIG manda no ativo: quem está nele fica
-- ativo (um item que saiu e voltou é reativado); quem saiu fica inativo.

insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem) values
${linhasProd.join(',\n')}
on conflict (id) do update set
  categoria = excluded.categoria,
  nome = excluded.nome,
  preco = excluded.preco,
  tipo = excluded.tipo,
  foto = excluded.foto,
  ingredientes = excluded.ingredientes,
  ordem = excluded.ordem,
  ativo = true;

-- o que saiu do CONFIG fica inativo (pedidos antigos continuam apontando para ele)
update public.produtos set ativo = false
where ativo and id not in (${produtos.map((p) => txt(p.id)).join(', ')});

insert into public.adicionais (id, nome, preco) values
${linhasAdic.join(',\n')}
on conflict (id) do update set
  nome = excluded.nome,
  preco = excluded.preco,
  ativo = true;

update public.adicionais set ativo = false
where ativo and id not in (${adicionais.map((a) => txt(a.id)).join(', ')});

-- loja: cria se não existir; depois só horarios e combo_preco vêm do CONFIG (modo e aceita_fechada são do painel)
insert into public.loja (id, modo, aceita_fechada, combo_preco, horarios)
values (1, 'auto', false, ${num(combo)}, ${txt(JSON.stringify(horarios))}::jsonb)
on conflict (id) do update set
  horarios = excluded.horarios,
  combo_preco = excluded.combo_preco;
`;
}

function main() {
  const arquivo = caminhoCore(process.argv[2]);
  const { CONFIG } = carregarCore(arquivo);
  const sql = montarSeed(CONFIG, path.relative(RAIZ, arquivo));
  const destino = path.join(RAIZ, 'supabase/seed.sql');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, sql);
  const n = CONFIG.categorias.reduce((s, c) => s + c.itens.length, 0);
  console.log(`seed.sql gerado de ${path.relative(RAIZ, arquivo)}: ${n} produtos, ${CONFIG.adicionais.length} adicionais`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
