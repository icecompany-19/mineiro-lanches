// Inicia um processo sem que ele (nem os filhos dele) herde o pipe de saída de quem chamou.
// No Windows, o "nohup … &" do Git Bash e o "pg_ctl start" deixam o processo novo com o pipe aberto, e quem
// lê a saída (um "| tail" ou o execFileSync do e2e) espera para sempre. O libuv do Node só repassa os
// descritores pedidos, então o filho recebe apenas o arquivo de log.
// Uso: node soltar.mjs <arquivo-de-log> <executável> [argumentos...]            (segundo plano, volta na hora)
//      node soltar.mjs --esperar <arquivo-de-log> <executável> [argumentos...]  (espera terminar; repassa o código)
import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';

const args = process.argv.slice(2);
const esperar = args[0] === '--esperar';
if (esperar) args.shift();
const [log, exe, ...resto] = args;
if (!log || !exe) {
  console.error('uso: node soltar.mjs [--esperar] <log> <executável> [argumentos...]');
  process.exit(2);
}
const fd = openSync(log, 'a');
if (esperar) {
  const r = spawnSync(exe, resto, { stdio: ['ignore', fd, fd], windowsHide: true });
  if (r.error) {
    console.error(`não rodou ${exe}: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}
const filho = spawn(exe, resto, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
filho.on('error', (e) => {
  console.error(`não iniciou ${exe}: ${e.message}`);
  process.exit(1);
});
filho.unref();
setTimeout(() => process.exit(0), 200);
