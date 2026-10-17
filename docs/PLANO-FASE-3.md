# Mineiro Lanche: Fase 3 (17/10/2026), horário automático, motoboy, comanda nova e domínio

**Pedido do cliente (16/10, à noite):** (R1) horário automático, aberto das 18h à meia-noite e fechado toda quarta; (R2) um usuário de motoboy que lê o QR code da comanda, e a leitura já marca o pedido como entregue; (R3) a comanda térmica sai com a logo, o número do pedido e esse QR; (R4) tudo no ar; (R5) domínio próprio na Vercel. Entrega ao cliente: **sábado, 17/10, antes das 18h**.

**Como foi montado:** seis leitores mapearam o repositório no HEAD `893cedb` (horário, banco e papéis, comanda, front e build, deploy e domínio, testes e convenções), com consultas só de leitura no Supabase de produção, DNS e RDAP. O orquestrador conferiu os achados críticos. Formato e regras de `docs/PLANO-FASE-2.md`: uma tarefa por despacho, um commit por tarefa, só com o "verde" exigido. Os números de linha são de 17/10; quem executa localiza o trecho por `grep -n`.

---

## 1. Situação conferida em 17/10, 00:20

| Área | Estado real |
|---|---|
| Repositório | Branch única `claude/modest-galileo-t43m7f` = produção na Vercel (cada push publica em ~30 s). Clone local atualizado em `893cedb`. **Vinicius Henrique fez 6 commits nessa branch em 16/10, entre 21h45 e 23h28**: outro push durante a noite colide com o nosso. |
| Loja em produção | `loja.modo = 'aberta'` (forçada pelo painel): **hoje a loja não abre nem fecha sozinha**, aceita pedido a qualquer hora, inclusive na quarta. `loja.horarios` ainda é o antigo (19h–0h; sexta e sábado até 1h). O banco manda no horário (o navegador e `criar_pedido` leem a tabela), então mudar só o `CONFIG` não basta. |
| Movimento | 27 pedidos nas últimas 24 h (21 entrega, 6 retirada); o último às 23h52. **5 pedidos parados em `rota`**, que ninguém marcou como entregues. Nenhum pedido tem forma de pagamento (`CONFIG.pagamentos = null`). |
| Banco de produção | 5 migrations no histórico; a `20261016000001_taxa_entrega` foi aplicada por fora (colunas e funções existem). Gatilho `entrar_na_equipe` em `auth.users` existe só em produção. Equipe com 1 pessoa. Tabela `equipe` sem coluna de papel. **Cadastro aberto** no Auth (`disable_signup = false`). |
| Domínio | **`mineirolanches.site` não existe** (RDAP: "available for registration"; NXDOMAIN). **`mineirolanches.store` está na Hostinger (registro de 15/10) e já aponta para a Vercel:** `https://mineirolanches.store` e `https://www.mineirolanches.store` respondem 200, servidor Vercel, mesmo deploy (`893cedb`), com a CSP do `vercel.json`. Falta: www redirecionar para o apex, `VITE_SITE_URL` (canonical/og/JSON-LD ainda dizem vercel.app), robots, sitemap e o QR do cartaz. |
| Comanda | `comandaHTML()` (painel.js) imprime por `window.print()` na própria página, 72 mm. Não tem logo nem QR. O número do pedido já sai grande (`.pn-c-num`). |
| Câmera | `vercel.json` manda `Permissions-Policy: camera=()` em toda resposta: bloqueia a câmera em produção. Os testes não percebem (o `vite preview` não aplica o `vercel.json`); só o `tests/vercel.spec.js` pega. |
| Máquina | Sem poppler (o QR do cartaz não regenera; um teste da comanda falha por `pdftoppm`), sem WebKit (projeto `iphone` do Playwright não roda), sem Vercel CLI. O N1 do plano da fase 2 não existe (o `mock-api.mjs` nunca foi escrito). O N2 nunca rodou verde no HEAD: os 487 casos do Playwright não têm linha de base. A extensão Claude in Chrome não está conectada. |

---

## 2. Decisões (aprovadas em 17/10, 00:30, todas no padrão)

Autorizado na mesma resposta: aplicar no Supabase de produção (com confirmação antes de cada passo), publicar em produção, instalar o poppler e usar a Vercel e o Supabase pelo Chrome.

| # | Decisão | Padrão do plano |
|---|---|---|
| D1 | "Das 6 até a meia-noite" | **18:00–00:00 todos os dias, sexta e sábado também fecham à meia-noite; quarta fechada** (`horarios["3"] = null`). |
| D2 | Domínio | **`mineirolanches.store`** (o `.site` não está registrado). Apex como endereço principal, www redireciona (308). |
| D3 | O que vai no QR | `https://mineirolanches.store/motoboy/#<id do pedido>`, só em pedidos de **entrega**. O `id` já existe em todo pedido (reimpressão de pedido antigo funciona) e não é o `token` de acompanhamento. A segurança vem do login do motoboy na RPC, não do QR. |
| D4 | O que a leitura faz | **Ler já marca entregue** (como pedido) e mostra em letra grande: "Entregue · #0011 · nome". Aceita `preparo`, `pronto` e `rota` (grava os passos que faltarem no histórico). Recusa `novo`, `cancelado` e retirada com mensagem clara. Ler de novo responde "já estava entregue", sem erro. |
| D5 | Como o motoboy lê | (a) câmera nativa do celular abre o link e a tela confirma; (b) botão **Ler QR** dentro da tela (jsQR); (c) plano B: lista "Em rota" com botão **Entregue** em cada pedido. |
| D6 | Logo na térmica | Arte oficial `logo-512.webp`, sem tratamento, ~38 mm de largura. Versão preto e branco (dither) só com OK de vocês (é recolorir a arte; a regra do projeto proíbe). |
| D7 | Papel do motoboy | Tabela própria `motoboys`. **Nunca** na `equipe`: daria o painel inteiro e os dados de todos os clientes. O motoboy vê só os pedidos de entrega em rota do dia (nome, telefone, endereço, referência, observação, total). |
| D8 | Poppler | Instalar pelo winget (`oschwartz10612.Poppler` 25.07.0, zip de 16 MB do GitHub, licença MIT) para regenerar o QR do cartaz e destravar 3 testes. Sem isso, plano B: ensinar `scripts/qrcode.mjs` a usar o `selo-256.png` já gerado (E16 da fase 2). |

---

## 3. Contratos fixados na Onda 0 (destravam o paralelismo)

**C1. Banco:** `supabase/migrations/20261017000001_motoboy.sql`, só aditiva e idempotente.
- `motoboys (user_id uuid pk → auth.users on delete cascade, nome text not null default '', ativo boolean not null default true)`, RLS ligado, `revoke all` de public/anon/authenticated, policy `motoboys_proprio` = `select` da própria linha quando `ativo` (espelho de `equipe_propria`).
- `is_motoboy()`: interna, sem grant.
- `entrega_json(pedidos)`: interna. Devolve `id, numero, status, cliente{nome,telefone}, endereco, referencia, obs, total, taxaEntrega, distanciaKm, saiuEm, entregueEm`. Sem itens, sem token.
- `entregas_em_rota()` → `jsonb` (lista): só `modo = 'entrega'`, `status = 'rota'` e o dia de operação atual (os 5 pedidos velhos presos em `rota` ficam de fora).
- `confirmar_entrega(p_id uuid)` → `{ ok, jaEntregue, pedido }`. Porta: `is_motoboy() or is_equipe()`. `for update`; `preparo` grava `rota` e depois `entregue`; `pronto`/`rota` gravam só `entregue`; os eventos levam `"por": "motoboy"` ou `"equipe"`; `entregue` devolve `jaEntregue: true` **sem update**. Erros (`P0001`): `sem_permissao`, `dados_invalidos`, `nao_encontrado`, `nao_e_entrega`, `pedido_cancelado`, `transicao_invalida` (pedido ainda `novo`).
- Todas as funções `security definer set search_path = public, pg_temp`; `revoke all` e depois `grant execute` só a `authenticated` nas duas RPCs públicas; `notify pgrst, 'reload schema'`.

**C2. Front:** página própria `/motoboy/` (`motoboy/index.html`, `public/motoboy/manifest.webmanifest`, `src/main-motoboy.js`, `src/motoboy/*`). O login reaproveita `src/painel/acesso.js` com opções novas (`titulo`, `sub`, `tabela`, `chave`, `aoAbrir`, `aoEsconder`), todas com padrão igual ao atual, e o DOM da equipe fica idêntico. A sessão do motoboy usa a chave `mineiro:v2:moto` (não pode começar com `mineiro:v2:sessao`, que o Sair do painel apaga por prefixo). A tela não usa `criarStoreSupabase` (que carrega 48 h de pedidos e Realtime); fala com o banco só por `confirmar_entrega` e `entregas_em_rota`. Na abertura, lê o uuid do `location.hash`, guarda durante o login e limpa com `history.replaceState`. O leitor interno extrai só o uuid do texto lido por regex e nunca navega para a URL lida.

**C3. QR da comanda:** `src/lib/qr-comanda.js` exporta `qrSvg(texto, { ecc: 'Q', moduloMm: 0.8, margem: 4 })` a partir de `qrcode/lib/core/qrcode.js`: um `<svg>` com um único `<path>`, `shape-rendering="crispEdges"`, fundo `<rect>` branco e sem a palavra "Mineiro" no `aria-label`. `main-painel.js` pendura em `window.MLQr`, e o `painel.js` continua IIFE. Carga = `(import.meta.env.VITE_SITE_URL || location.origin) + '/motoboy/#' + p.id`, ~30–34 mm de lado, legenda em negrito "ENTREGADOR: LEIA AO ENTREGAR" e o número repetido.

**C4. Cabeçalhos (`vercel.json`):** redirect `/motoboy` → `/motoboy/` (302); `/motoboy/` com `Cache-Control: public, max-age=0, must-revalidate`; `/motoboy/(.*)` com `X-Robots-Tag: noindex, nofollow` e `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()`. O resto continua com `camera=()`. A CSP não muda (vídeo por `srcObject`, nunca `createObjectURL`). Validar com `curl -sI` no deploy de preview; se a Vercel não fizer "a última regra vence", plano B: regra global `"/((?!motoboy(?:/|$)).*)"` e os 6 cabeçalhos repetidos na regra do motoboy.

**C5. Horário:** `CONFIG.horarios = { 0..6: ['18:00','00:00'], 3: null }`; `horarioTexto = ['Todos os dias, das 18h à meia-noite', 'Fechado às quartas']` (redação a validar). JSON-LD com uma única especificação, sem `Wednesday`. Produção: `update loja set horarios = <mesmo JSON do seed>, modo = 'auto'`.

---

## 4. Ondas e tarefas

Executores: agentes `aiox-*` despachados pelo orquestrador (esta sessão, Opus), cada trilha num worktree novo `../ml-wt/f3-<nome>` (branch `fase3/<nome>`) criado do HEAD; os worktrees da fase 2 estão todos mesclados e defasados, não reaproveitar. **Banco local e portas (54321–54323) são únicos:** nas trilhas, só N0, `node --test` e Playwright com `page.route` (cada trilha com o próprio `PORTA_TESTE`: 4181–4184); tudo que precisa de banco roda em série na árvore principal. Subagente não faz push; o push é do orquestrador (papel @devops), sempre depois de `git fetch` e por caminho explícito.

Modelos: **O** = Opus (contrato, integração, revisão de segurança), **S** = Sonnet (implementação), **H** = Haiku (checagem mecânica), 👤 = vocês.

### Onda 0: preparação (00:45–01:15)

| ID | Tarefa | Arquivos | Agente | Mod. | Min | Pronto quando | Depende |
|---|---|---|---|---|---|---|---|
| F3-00 | Fechar as decisões D1–D8, commitar este plano | `docs/PLANO-FASE-3.md` | orquestrador | O | 10 | Respostas registradas no §2; commit `docs: plano da fase 3` | 👤 respostas |
| F3-01 | Linha de base N2 no HEAD, sem o projeto `iphone`; registrar falhas antigas e tempo de cada parte | nenhum (só relatório) | qa-runner | H | 60 (fundo) | Lista de falhas pré-existentes e tempos no relatório; banco local liberado | F3-00 |
| F3-02 | Instalar o poppler (se D8 = sim) e pôr no PATH do Git Bash | ambiente | orquestrador | H | 10 | `pdftocairo -v` responde no Git Bash | 👤 OK do download |
| F3-03 | Criar os 4 worktrees, `npm ci` em cada um | `../ml-wt/f3-*` | orquestrador | H | 10 | `npm run lint && npm run build` passa nos 4 | F3-00 |
| F3-04 | Avisar o Vinicius Henrique para não dar push até o fim da Onda 3 | 👤 | 👤 | | 2 | Confirmado | |

### Onda 1: quatro trilhas em paralelo (01:15–02:45)

| ID | Tarefa | Arquivos (dono exclusivo) | Agente | Mod. | Min | Pronto quando | Depende |
|---|---|---|---|---|---|---|---|
| F3-10 | **Banco do motoboy** (C1) + testes SQL | `supabase/migrations/20261017000001_motoboy.sql` (novo), `supabase/tests/07_motoboy.sql` (novo), `supabase/tests/00_estrutura.sql` (listas do motoboy **e** o JSON de horários do C5), `supabase/tests/_ajuda.sql`, `scripts/supabase-local/stub.sql` (`moto@teste.local`, id `…0003`), `scripts/testar-paridade.mjs` (RPCs novas recusadas ao anon), `scripts/montar-setup.mjs` (rodapé comentado com o `insert into motoboys`), `docs/CONTRATO-API.md` | aiox-data-engineer | S | 60 | Na árvore principal, depois da F3-01: `bash scripts/testar-sql.sh --do-zero` e `node scripts/testar-paridade.mjs` verdes com o `setup.sql` regenerado **só localmente** (não commitar `setup.sql`/`seed.sql`). O 07 cobre: anon e logado de fora recusados, motoboy não lê `pedidos`/`clientes`/`equipe` nem chama `mudar_status`, `ativo = false` corta, transições, idempotência sem crescer o histórico, erros e o recorte de chaves do retorno. | F3-03 |
| F3-11 | **Horário** (C5) + textos + testes | `src/core.js` (CONFIG), `index.html` (JSON-LD, `data-abre`, os 3 blocos estáticos de horário, faixa b, "Todo dia, menos quarta" no S6, régua 18h/21h/0h), `src/app.js` (escala da semana `faixa = 360`), `src/site/cenas/final.js` (neon "Volta amanhã às 18h." em dia sem turno), `supabase/tests/01_horario.sql` (fronteiras novas e casos de quarta), `tests/horario.test.mjs` (novo, `node:test`: 7 dias × 288 instantes), `tests/aceite-cliente.spec.js` (datas fixas para quinta 15/10 e caso "quarta 20h fechado"), `tests/navegacao.spec.js`, `tests/preco-a-confirmar.spec.js`, `tests/site-ii.spec.js`, `docs/CLIENTE-2026-10.md`, `docs/DIRECAO-VISUAL.md` (linhas de horário) | aiox-dev | S | 75 | N0 + `node --test tests/horario.test.mjs` + Playwright `--project=desktop` de `navegacao`, `cardapio`, `preco-a-confirmar`, `site`, `site-ii`, `aceite-cliente` com `PORTA_TESTE=4182`. Nada de "19h" ou "à 1h" sobrando em `index.html`, `src/` e testes (grep). O herói (`hero.js`, título animado letra a letra) fica como está hoje. | F3-03 |
| F3-12 | **Comanda** com logo, número e QR (C3) | `src/lib/qr-comanda.js` (novo), `src/main-painel.js`, `src/painel/painel.js` (só `comandaHTML` e `imprimirComanda`: `<img>` com `width`/`height`, QR só em entrega, impressão espera as imagens no caso raro sem mudar o caso síncrono), `src/painel/painel.css` (`.pn-c-logo`, `.pn-c-qr`), `tests/qr-comanda.test.mjs` (novo: rasteriza o SVG com sharp e lê com jsQR, inclusive depois de limiar 1-bit), `tests/comanda-impressao.spec.js` (casos novos + `skip` quando não houver `pdftoppm`), `docs/CONTRATO-PAINEL.md` | aiox-dev | S | 70 | N0 + `node --test tests/qr-comanda.test.mjs tests/seletores.test.mjs`; o spec da comanda (precisa de banco) roda na integração. QR decodificado = carga do C3; logo sem `filter`/blend/máscara; 72 mm, uma página. | F3-03 |
| F3-13 | **Tela do motoboy** (C2, C4) | `motoboy/index.html`, `public/motoboy/manifest.webmanifest`, `src/main-motoboy.js`, `src/motoboy/motoboy.js`, `src/motoboy/leitor.js` (jsQR em `import()` dinâmico, `getUserMedia` por toque, `<video playsinline muted>`, para as trilhas ao ler, ao esconder a aba e no `pagehide`), `src/motoboy/entrega.js`, `src/motoboy/motoboy.css` (alvos ≥ 56 px), `src/painel/acesso.js` (opções), `src/lib/supabase.js` (`opc.chave`), `vite.config.js`, `vercel.json`, `public/robots.txt` (`Disallow: /motoboy/`), `tests/motoboy.spec.js` (novo: deep link, Ler QR com câmera falsa por `addInitScript`, lista Em rota, Sem acesso, já entregue, cancelado, sem rede; RPC por `page.route`), `tests/vercel.spec.js` (câmera por rota, redirects, páginas, manifest, noindex), `tests/seletores.test.mjs` (inclui `motoboy/index.html`) | aiox-dev | S | 90 | N0 (build gera `dist/motoboy/`) + `tests/motoboy.spec.js` nos projetos celular e desktop + `tests/vercel.spec.js --project=desktop` com `PORTA_TESTE=4184` + `navegacao.spec.js -g "login"` (fumaça do `acesso.js`). | F3-03 |

### Onda 2: integração na árvore principal (02:45–04:15)

| ID | Tarefa | Arquivos | Agente | Mod. | Min | Pronto quando | Depende |
|---|---|---|---|---|---|---|---|
| F3-20 | Mesclar `fase3/banco`, `fase3/horario`, `fase3/comanda` e `fase3/motoboy` (nessa ordem); `npm run seed && npm run setup-sql` uma única vez | `supabase/setup.sql`, `supabase/seed.sql` (gerados) | orquestrador | O | 20 | `git diff --stat supabase/` só com o esperado; N0 verde | F3-10…13 |
| F3-21 | E2E do motoboy: pedido de entrega criado pelo cliente → equipe aceita e marca "Saiu" → motoboy confirma pelo deep link → painel mostra em Concluídos (plano B de 5 s) → cliente vê "Entregue" | `tests/e2e.spec.js` (beforeAll com `moto@teste.local` + linha em `motoboys`) | aiox-dev | S | 30 | `npx playwright test --project=e2e` verde | F3-20 |
| F3-22 | Domínio no código (D2): `VITE_SITE_URL=https://mineirolanches.store`, `.env.example`, `Sitemap:` do robots, `sitemap.xml`, `npm run qrcode -- --base https://mineirolanches.store`, docs (README com as rotas `/motoboy/`, CLAUDE.md, CLIENTE) | `.env.production`, `.env.example`, `public/robots.txt`, `public/sitemap.xml`, `public/qr/*`, `README.md`, `CLAUDE.md`, `docs/CLIENTE-2026-10.md` | aiox-dev | H | 20 | `QR_BASE=https://mineirolanches.store node --test tests/qrcode.test.mjs` verde; o `git status` mostra exatamente esses arquivos | F3-20, F3-02 |
| F3-23 | N2 completa no integrado (sem `iphone`), comparada com a linha de base da F3-01 | nenhum | qa-runner | H | 60 | Nenhuma falha nova em relação à F3-01; falhas de base listadas | F3-21, F3-22 |
| F3-24 | Revisão adversarial: (a) segurança da migration (RLS, grants, `security definer`, o que o motoboy enxerga); (b) diff do front (CSP, câmera, sessão, regressão no login da equipe) | só leitura | aiox-qa | O (a) / S (b) | 25 | Veredito PASS ou correções aplicadas e re-testadas | F3-20 |

### Onda 3: produção (04:15–05:15), fora do horário do truck

| ID | Tarefa | Onde | Agente | Mod. | Min | Pronto quando | Depende |
|---|---|---|---|---|---|---|---|
| F3-30 | Push da integração para a branch `fase3/integracao` → deploy de **preview** na Vercel; `curl -sI` em `/motoboy/` (`camera=(self)`) e em `/`, `/painel/` (`camera=()`); abrir `/motoboy/` no preview | Vercel preview | orquestrador | O | 15 | Cabeçalhos certos no preview (ou plano B do C4 aplicado e re-testado) | F3-23, F3-24 |
| F3-31 | **Supabase de produção** (confirmo com vocês antes): `apply_migration` `motoboy_entrega`; `SELECT` de conferência (RLS ligado, anon sem `execute`, funções presentes); `update loja set horarios = <C5>, modo = 'auto'` | Supabase MCP | orquestrador | O | 15 | `estado_cardapio()` devolve o horário novo; `has_function_privilege('anon', 'confirmar_entrega(uuid)', 'execute') = false` | F3-30 |
| F3-32 | Push na branch de produção (fast-forward, depois de `git fetch`); smoke em `https://mineirolanches.store`: `/`, `/painel/`, `/motoboy/`, `/q` (302), CSP, cabeçalhos, status "Fechado agora · abre hoje às 18h" | Vercel produção | orquestrador | O | 15 | Deploy `success` no SHA novo; smoke verde | F3-31 |
| F3-33 | Vercel → Domains: `www.mineirolanches.store` como "Redirect to mineirolanches.store" (308) | Chrome (com a extensão reconectada) ou 👤 | orquestrador / 👤 | H | 5 | `curl -sI https://www.mineirolanches.store/` → 308 para o apex | 👤 reconectar o Chrome |
| F3-34 | Supabase → Authentication: desligar "Allow new users to sign up"; Site URL = `https://mineirolanches.store`; Redirect URLs com o domínio, o vercel.app e o localhost | Chrome ou 👤 | orquestrador / 👤 | H | 5 | `GET /auth/v1/settings` mostra `disable_signup: true` | 👤 |
| F3-35 | Encerrar: derrubar servidores locais por porta, remover worktrees mesclados, relatório da noite | máquina | orquestrador | H | 10 | Nenhuma porta 4180–4184 nem 54321–54323 ocupada | F3-32 |

### Onda 4: aceite com vocês (manhã de 17/10, antes das 18h)

| ID | Tarefa | Quem | Pronto quando |
|---|---|---|---|
| F3-40 | Criar o usuário do motoboy: Supabase → Authentication → Users → **Add user**, e-mail e senha, **Auto Confirm**; me passar só o e-mail. Eu rodo o `insert into motoboys` (confirmo antes). O agente não cria conta nem digita senha. | 👤 + orquestrador | O motoboy entra em `https://mineirolanches.store/motoboy/` e vê "Em rota" |
| F3-41 | Impressão real na térmica: comanda de um pedido de entrega com logo, número e QR. Conferir: logo legível, QR lido pela câmera nativa **e** pelo botão Ler QR, tamanho no papel de 72 × 210 mm. | 👤 (eu acompanho) | QR lido nos dois caminhos; se a logo sair escura demais, decidir D6 |
| F3-42 | Ponta a ponta com um pedido de teste de entrega: aceitar → Saiu → imprimir → motoboy lê → painel mostra Concluído na hora (Realtime) → o celular do cliente mostra "Entregue". Depois, cancelar o pedido de teste com motivo "teste". | 👤 + orquestrador | Os 4 passos vistos em produção |
| F3-43 | Equipe e motoboy entram de novo no domínio novo (a sessão é por endereço); instalar `/motoboy/` na tela inicial do celular do motoboy (no iPhone, o app da tela inicial pede login à parte) | 👤 | Login feito nos aparelhos de uso |
| F3-44 | Decidir o que fazer com os 5 pedidos antigos presos em `rota` (marcar entregue ou cancelar) | 👤 | Coluna "Em rota" limpa |

---

## 5. Riscos e plano B

| Risco | Plano B |
|---|---|
| Alguém dá push na branch de produção durante a noite | F3-04; antes de cada push, `git fetch` e merge; nunca `--force`. Conflito → parar e chamar o orquestrador. |
| A Vercel soma os dois `Permissions-Policy` e a câmera continua bloqueada | Detectado no preview (F3-30); plano B do C4. Plano C: o motoboy usa a câmera nativa (o link funciona sem cabeçalho nenhum) ou a lista "Em rota". |
| Câmera no iPhone (permissão a cada abertura; navegador do WhatsApp nega) | Abrir sempre pelo app da tela inicial ou pelo Safari; a lista "Em rota" resolve sem câmera. |
| Migration em produção | É aditiva (tabela e funções novas) e entra antes do front. Reversão escrita: `drop function if exists public.confirmar_entrega(uuid), public.entregas_em_rota(), public.entrega_json(public.pedidos), public.is_motoboy(); drop table if exists public.motoboys;` |
| Horário novo fecha a loja na hora errada | Aplicado de madrugada, com a loja fechada. Reversão: `update loja set horarios = <JSON antigo>, modo = 'aberta'`. O botão "Aberta" do painel continua como válvula do dono. |
| Deploy quebra a produção | Vercel → Deployments → **Promote** no deploy anterior (volta em segundos), depois `git revert` + push. |
| Logo escura demais na térmica | Diminuir para 32 mm; ou aprovar (D6) um PNG em dither gerado da arte oficial. |
| A comanda passa de 210 mm em pedido grande | Se for folha de 210 mm, módulo do QR 0,75 mm e logo 32 mm. Se for rolo, não é problema. |
| N2 longa (487 casos em série) | Rodar celular + desktop + e2e; a F3-01 mede o tempo real. Se passar de 90 min, priorizar os specs afetados e rodar o resto em fundo depois do deploy. |
| Sem poppler | Plano B da D8 (o `qrcode.mjs` usa o `selo-256.png`); nunca rodar `npm run qrcode` pela metade (deixa SVG novo e PNG velho). |
| A extensão do Chrome segue desconectada | F3-33 e F3-34 viram passos de vocês (5 cliques cada); nada mais depende do navegador, porque o DNS já está pronto. |

---

## 6. Pronto para entregar ao cliente

- [ ] Loja em **Automático**: fecha às 0h, abre às 18h sozinha; quarta mostra "fechado" na semana e o servidor recusa pedido (paridade JS × banco verde).
- [ ] Pedido de entrega → comanda com **logo, número e QR** → motoboy lê → pedido **entregue** no painel e no celular do cliente, em produção.
- [ ] Motoboy **não** entra no painel ("Sem acesso") e não vê pedidos fora da lista dele.
- [ ] Retirada no local: comanda sem QR; o motoboy recebe "não é entrega".
- [ ] `https://mineirolanches.store` com HTTPS, www redirecionando, canonical e QR do cartaz no domínio novo; `mineiro-lanches.vercel.app` continua respondendo (fallback).
- [ ] Cadastro aberto desligado no Supabase.
- [ ] N2 sem falha nova em relação à linha de base; nenhum servidor local rodando.

## 7. Execução: linha de base e ajustes da revisão adversarial (17/10, 00:45)

**Linha de base no HEAD `893cedb` (F3-01, 00:26–00:37):** lint e build ok; SQL 353 verificações ok (a linha 65 do `01_horario.sql` usa `now()` e só passa com o truck aberto); paridade ok; node:test 60 (38 ok, 22 pulados por falta de poppler, 0 falhas); Playwright desktop + e2e em 8,9 min: 214 ok, 22 pulados e 3 falhas antigas: `comanda-impressao.spec.js:242` (precisa do `pdftoppm`), `site-ii.spec.js:587` (véu do S5; ver se é intermitente) e `e2e.spec.js:246`. Esta última falha porque o texto do aviso de dados mudou no `d7b1c09` e o teste ficou com o antigo; por ser serial, impede outros 9 casos do e2e de rodar. Os gates passam a ser "sem falha nova em relação a esta base".

**Poppler:** o pacote do winget (25.07.0) quebra nesta máquina com qualquer PDF (violação de acesso, até num PDF mínimo) e foi desinstalado. Plano B aplicado em `d47fc0e`: o `scripts/qrcode.mjs` gera o PNG com o selo do `logo-selo.svg` quando falta o `pdftocairo`.

**Ajustes decididos depois dos dois críticos:**
- C1: `grant select on public.motoboys to authenticated` junto da policy (sem isso, a policy não libera nada); `entregas_em_rota` também começa com a porta `is_motoboy() or is_equipe()`; o 07 testa um usuário de fora nas duas RPCs.
- O JSON de horários do `00_estrutura.sql` e a linha 65 do `01_horario.sql` (instante fixo em vez de `now()`) são acertados na F3-20, junto com seed + setup + `testar-sql --do-zero` + paridade, logo depois da junção.
- Os Playwright de horário (navegacao, cardapio, preco-a-confirmar, site, site-ii, aceite-cliente) dependem do banco local com o seed novo: rodam na integração, não nas trilhas.
- F3-21 começa corrigindo o `e2e.spec.js:231` e põe o motoboy num `describe` próprio, para uma falha anterior não pulá-lo.
- C4: em vez de confiar em "a última regra vence" na Vercel, a regra global passa a excluir o motoboy (`/((?!motoboy(?:/|$)).*)`) e a regra do motoboy repete os cabeçalhos com `camera=(self)`. A regra global continua sendo `headers[0]` (o `tests/apoio/aceite.js` lê a CSP dali). Conferência por `curl` na produção, porque o preview pode estar protegido pela Vercel e usa o Supabase de produção (não fazer pedido no preview).
- Quem é da equipe e abre `/motoboy/` vê "Sem acesso": se o dono também entregar, ele ganha uma linha em `motoboys`.
- F3-42: com a loja em Automático, o sábado fica fechado até as 18h. O pedido de teste é feito com "Aberta" só durante o teste, com alguém olhando o painel, e volta para "Automático" na hora; ou então às 18h, na abertura.
- Ordem de corte se atrasar: (1) leitor de QR dentro da tela e o cabeçalho de câmera; (2) QR do cartaz; (3) logo na comanda; (4) www e cadastro aberto ficam para de manhã.

## 8. Fora de hoje (registrar em pendências)

- Aviso no painel quando o motoboy confirma (hoje o cartão vai para "Concluídos" em silêncio; o som é só para pedido novo).

- Forma de pagamento e troco no checkout, para o motoboy saber o que cobrar (`CONFIG.pagamentos = null`).
- Volta automática do modo manual para "Automático" (pg_cron) e `horarioTexto` derivado de `horarios`.
- Prova de entrega no endereço (código mostrado ao cliente ou geolocalização). Hoje o QR **não** prova nem que a comanda estava com o motoboy: o `id` do pedido volta ao cliente no `criar_pedido`, então o próprio cliente consegue montar o link e mandá-lo ao entregador. O dano é limitado (precisa de um motoboy logado abrindo o link). Saídas: o link pedir um toque de confirmação, ou o QR levar um código curto que não seja o `id`.
- Revisão de segurança (17/10, veredito PASS), pendências baixas: `confirmar_entrega` não recorta o dia de operação (um motoboy com o `id` de um pedido antigo vê nome, telefone e endereço; no caminho "já entregue", devolver só `{id, numero, status}`); o `acompanhar_pedido` mostra ao cliente o campo `por` ("motoboy"/"equipe") do histórico; o filtro por `dia_operacional` em `entregas_em_rota` não usa índice (irrelevante com ~30 pedidos por dia); falta teste de duas leituras simultâneas do QR (o `for update` cobre, sem prova automatizada).
- Herói do site dizer "amanhã" numa quarta (`hero.js`, título animado).
- Versionar no repositório o gatilho `entrar_na_equipe` e completar o histórico de migrations do Supabase.
- Instalar o WebKit do Playwright; aposentar o N1 nos documentos.
- `mineirolanches.site`, se o dono quiser também esse nome (compra na Hostinger + mesmos passos de DNS).
