// Despachante das capturas: node scripts/capturas.mjs cliente|site|painel|tudo [--sem-build] [--apenas=<trecho do rótulo, ex. 390-aberto>] [--cena=<site>]
// PNG em capturas/<alvo>/<tela>-<largura>-<estado>[-reduzido].png (a pasta fica fora do git).
// Antes (Git Bash): source scripts/supabase-local/ambiente-windows.sh. Sobe o build de desenvolvimento e o vite preview na porta 4185.
import { executar, subirServidor, caminhoCaptura, salvarPng, rolarTudo, PASTA } from './capturas/lib.mjs';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALVOS = ['cliente', 'site', 'painel'];
const args = process.argv.slice(2);
const pedido = args.find((a) => !a.startsWith('--'));
const opc = { build: !args.includes('--sem-build'), apenas: (args.find((a) => a.startsWith('--apenas=')) || '').slice(9) || null };

const cena = (args.find((a) => a.startsWith('--cena=')) || '').slice(7);
if (cena) process.env.CAPTURAS_CENA = cena; // site.mjs: só a cena pedida (teste de fumaça)

if (!pedido || ![...ALVOS, 'tudo'].includes(pedido)) {
  console.error('uso: node scripts/capturas.mjs cliente|site|painel|tudo [--sem-build] [--apenas=390-aberto] [--cena=s0]');
  process.exit(2);
}

async function capturar(modulo, servidor) {
  let n = 0;
  const cortadas = [];
  const r = await executar(
    modulo,
    async ({ page, alvo, nome, variante, elemento, cheia = true }) => {
      if (cheia) await rolarTudo(page);
      const res = await salvarPng(page, caminhoCaptura(alvo, nome, variante), { elemento, cheia });
      if (res.cortada) cortadas.push(`${nome}-${variante.largura} (${Math.round(res.alturaCss)} px de altura, cortada)`);
      n++;
    },
    { ...opc, servidor }
  );
  return { ...r, n, cortadas };
}

const alvos = pedido === 'tudo' ? ALVOS : [pedido];
let falhou = false;
const servidor = await subirServidor({ build: opc.build });
try {
  for (const a of alvos) {
    const modulo = await import(`./capturas/${a}.mjs`);
    console.log(`\n== capturas: ${a}`);
    const { erros, falhas, n, cortadas } = await capturar(modulo, servidor);
    const pasta = join(PASTA, a);
    const total = existsSync(pasta) ? readdirSync(pasta).filter((f) => f.endsWith('.png')).length : 0;
    console.log(`${a}: ${n} PNG salvos nesta rodada (${total} em ${pasta})`);
    if (cortadas.length) console.log('  cortadas pelo limite de altura do Chromium:', [...new Set(cortadas)].join('; '));
    if (erros.length) console.log(`  ${erros.length} erro(s) de console:\n   ` + erros.slice(0, 20).join('\n   '));
    if (falhas.length) console.log(`  ${falhas.length} falha(s):\n   ` + falhas.join('\n   '));
    if (erros.length || falhas.length) falhou = true;
  }
} finally {
  servidor.parar();
}
process.exit(falhou ? 1 : 0);
