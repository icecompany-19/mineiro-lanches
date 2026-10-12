# Mineiro Lanche: regras do projeto (para pessoas e agentes)

Site, cardápio com pedidos e painel da equipe do food truck Mineiro Lanche (Centro de Suzano). Vite 6 + JS puro, Supabase (Postgres, RLS, RPC, Realtime, Auth), Vercel. Repositório `icecompany-19/mineiro-lanches`, branch única `claude/modest-galileo-t43m7f`.

**Leia antes de mexer:** `README.md`, `docs/PLANO-FASE-2.md` (plano atual, 12/10: tarefas, modelo por tarefa, níveis de "verde"), `docs/PLANO.md` (plano de 08/10, Bloco A concluído), `docs/CONTRATO-API.md` (banco ⇄ front), `docs/CONTRATO-PAINEL.md`, `docs/CLIENTE-2026-10.md` (fatos do cliente) e `docs/DIRECAO-VISUAL.md` (direção "Parede Acesa"; a seção 5.0 lista seletores e textos que os testes usam e que não podem ser renomeados).

## Regras que evitam retrabalho

- **Nada inventado.** Preço, horário, composição, taxa, tempo de entrega: só o que está em `docs/CLIENTE-2026-10.md` ou no `CONFIG` de `src/core.js`. O que falta fica "a confirmar".
- **Logo:** só a arte do PDF (`public/assets/logo/*.webp|png`), sem IA, sem redesenho, sem `filter`, blend ou máscara. **Fotos e texturas:** nunca gerar, ampliar "com criatividade" ou retocar com IA.
- **CSP `script-src 'self'`:** nenhum script nem handler inline (por isso existe `public/rota.js`).
- **`src/core.js` continua IIFE sem `import`/`export`** (o seed o avalia com `node:vm`). Mudou o `CONFIG`? `npm run seed && npm run setup-sql` e reaplicar o `setup.sql`. Conferir com `git status` que `supabase/setup.sql` só entra no commit quando o `CONFIG` mudou.
- **Contrato da store:** `app.js` e `painel.js` falam só com `ML.store`; `src/lib/store-supabase.js` implementa o contrato e emite os mesmos eventos. Preço é recalculado no servidor. No painel, `await sb.realtime.setAuth()` **antes** de `channel()`.
- **`index.html`:** editar por trechos (Edit/sed), nunca reescrever o arquivo inteiro. Localizar trechos por `grep -n` do seletor ou do texto; números de linha dos planos envelhecem.
- **Não renomear** seletores, atributos `data-*` e textos usados pelos testes (ver `docs/DIRECAO-VISUAL.md` §5.0 e `tests/`).
- **Processos:** nunca `pkill -f` (derruba o shell). Derrubar por porta (`netstat -ano` + `taskkill //PID`). Playwright usa `PORTA_TESTE=4180` (a 4173 costuma estar ocupada).
- **Um commit por etapa, só com o "verde" do nível vigente** (N0/N1/N2 em `docs/PLANO-FASE-2.md` §3). Push a cada parada.

## Bateria completa (N2)

Rodar **sempre de Git Bash** (o PATH do Windows tem um `bash` stub do WSL que quebra o e2e).

```bash
npm run lint && npm run build
bash scripts/testar-sql.sh --do-zero
node scripts/testar-paridade.mjs
node --test tests/*.test.mjs
npx playwright test
```

Última execução verde (`0ffe541`, antes do WIP `690fed3`): 65 Playwright, 331 SQL, 292 paridade, 48 node:test (os 48 incluem `tests/logo.test.mjs`, que precisa do poppler). Enquanto o N2 não existir nesta máquina, vale o N1 do plano: lint, build, `tests/fotos.test.mjs`, `tests/qrcode.test.mjs` e os specs sem banco com a API de mentira (`scripts/supabase-local/mock-api.mjs`, tarefa E11).

## Ambiente desta máquina (Windows 11, conferido em 12/10/2026)

- Node 24, npm 11, git 2.54, `gh` logado como `icecompany-19`. Shell: Git Bash (`bash`) ou PowerShell 5.1. `npm ci` feito; `npm run lint` e `npm run build` passam.
- Fim de linha: `.gitattributes` força LF (commit de 12/10). Se a árvore voltar a CRLF, `git rm --cached -r -q . && git reset --hard -q`.
- **Não há** `psql`, PostgreSQL, PostgREST, poppler, Docker nem WSL (sem distro). Os scripts `scripts/supabase-local/*` foram escritos para o sandbox Linux (`/home/user/.pg`, `su postgres`, `/usr/lib/postgresql/16/bin`) e ganham um ramo Windows nas tarefas E7a/E7b do plano.
- Chromium do Playwright: **instalado em 12/10** (chromium, headless shell, ffmpeg e winldd em `%LOCALAPPDATA%/ms-playwright`). O instalador oficial trava na extração nesta máquina; o contorno (zip pelo espelho `https://playwright.download.prss.microsoft.com/dbazure/download/playwright` + `tar.exe -xf` + `INSTALLATION_COMPLETE`) está na tarefa E3 do plano. `tests/qrcode.test.mjs` passa 13/15 até existir o poppler (E9) ou o `--sem-pdf` deixar de exigir `pdftocairo` (E16).
- O projeto Supabase de `.env.production` (`xroiumwewrijwlcwghyq`) está **pausado** (o DNS nem resolve) e **não pertence** à conta Supabase conectada ao MCP desta sessão (essa conta tem dois projetos de outros negócios). `setup.sql` nunca foi aplicado no projeto real. `mineiro-lanches.vercel.app` nunca recebeu deploy.
