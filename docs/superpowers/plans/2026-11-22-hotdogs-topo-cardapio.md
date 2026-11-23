# Hot dogs no topo do cardápio: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cardápio abre com os hot dogs na frente (carrossel de fotos, régua de tamanhos) e um índice que mostra o cardápio inteiro, com a busca atrás de uma lupa.

**Architecture:** tudo na tela `[data-screen="menu"]` do `index.html` e no `src/app.js` (IIFE, sem `import`), com estilos num arquivo novo `src/styles/cardapio-topo.css`. Carrossel, índice e régua são montados a partir de `ML.produtos`/`C.categorias` (catálogo do banco) e se remontam nos eventos `cardapio:estado` e `cardapio:esgotados`. A ordem "hot dog primeiro" muda no `CONFIG` e, na publicação, em `categorias_produtos.ordem`.

**Tech Stack:** Vite 6, JS puro, Supabase (Postgres/PostgREST), Playwright 1.56, testes SQL em `supabase/tests`.

**Spec:** `docs/superpowers/specs/2026-11-22-hotdogs-topo-cardapio-design.md` (ler junto). Regras do projeto: `CLAUDE.md` e `docs/DIRECAO-VISUAL.md` §5.0 e §5.2.

## Global Constraints

- CSP `script-src 'self'`: nenhum script nem handler inline. SVG e `style=` inline podem.
- `index.html`: editar por trechos (Edit), nunca reescrever o arquivo.
- Não renomear: `#f-busca`, `#chips`, `[data-chip]`, `#filtros`, `[data-filtro]`, `.faixa-combo`, `[data-faixa-combo]`, `[data-combo-preco]`, `[data-combo-selo]`, `[data-combo-inclui]`, `#menu-lista`, `.cat`, `#cat-<id>`, `.prod`, `[data-abrir]`, `[data-rapido]`, `#vazio-busca`.
- `src/core.js` continua IIFE sem `import`/`export`. Mudou o `CONFIG`: `npm run seed && npm run setup-sql`.
- Alvos de toque de pelo menos 44 px. Com `prefers-reduced-motion: reduce`, `document.getAnimations().length === 0` no cardápio.
- Fotos só as existentes, sem recorte nem retoque. Preços sempre do catálogo (`ML.produtos[id].preco`), nunca escritos à mão.
- Textos dos cards (copiar exatamente):
  - Hot dog: rótulo "Hot dog · 3 tamanhos", título "Hot dog", linha "Médio, Max ou Super", "a partir de" + menor preço disponível entre `dog-medio`, `dog-max` e `dog-super`, botão "Ver tamanhos", foto `dog-max`.
  - `dog-cbo-turbo`: rótulo "3 salsichas", título "CBO Turbo", linha "Bacon, catupiry e mussarela gratinada", botão "Pedir este".
  - `dog-pizza`: rótulo "Hot Dog Super", título "Dog Pizza", linha "Queijo gratinado e orégano por cima", botão "Pedir este".
  - `dog-doritos`: rótulo "Com Doritos", título "Doritos Max", linha "Hot Dog Max com Doritos", botão "Pedir este".
- Nada se mexe sozinho: o carrossel não avança sozinho; sem animação de entrada.
- Trabalhar na branch `feat/hotdogs-topo` (a branch de produção `claude/modest-galileo-t43m7f` publica na Vercel a cada push). Um commit por tarefa.

## Review Focus

1. **Esgotar ou ocultar um hot dog com a página aberta:** o card dele sai do carrossel e o tamanho sai da régua sem recarregar. Se não sobrar card, a seção do carrossel some. Teste na Tarefa 4 (carrossel) e na Tarefa 6 (régua).
2. **Preço mudado no banco com a página aberta:** carrossel, "a partir de" e régua mostram o preço novo. Teste na Tarefa 4.
3. **Link direto `#cardapio/<categoria>`:** abre já na categoria, com o título visível abaixo do cabeçalho e da barra fixa. O teste de `site.spec.js:684` continua passando; na Tarefa 5, um caso com `#cardapio/combos`.
4. **Busca ativa e saída do cardápio:** voltar ao cardápio não deixa filtro escondido. Fechar a lupa limpa busca e filtro. Teste na Tarefa 3.
5. **Larguras de 320, 390 e 1280 px:** carrossel, grade do índice e régua sem rolagem horizontal da página e com alvos de 44 px. Teste na Tarefa 5 com `rolagemHorizontal` e `alvosPequenos` de `tests/apoio/aceite.js`.

---

### Task 1: Ambiente de teste no macOS

Os testes de navegador precisam do "Supabase local" (Postgres + PostgREST + `proxy.mjs`). O `scripts/supabase-local/iniciar.sh` só conhece Linux e Windows.

**Files:**
- Modify: `scripts/supabase-local/iniciar.sh` (ramo `Darwin` no `case "$(uname -s)"`; `escutando()` e `matar_porta()` com `lsof -nP -iTCP:<porta> -sTCP:LISTEN` no macOS)
- Modify: `CLAUDE.md` (seção de ambiente: como subir no Mac)

- [ ] **Step 1:** instalar as ferramentas (com o ok do usuário, dado na revisão do plano): `brew install postgrest` e `npx playwright install chromium`.
- [ ] **Step 2:** ramo `Darwin` no `iniciar.sh`: `PGBIN=${MINEIRO_PGBIN:-/opt/homebrew/opt/postgresql@17/bin}`, `PGHOME=${MINEIRO_PGHOME:-$HOME/.mineiro-pg}`, `POSTGREST=${MINEIRO_POSTGREST:-$(command -v postgrest)}`, `export LC_ALL=C` (o postmaster recusa subir sem locale válido). O `initdb` do Mac usa `--locale=C -E UTF8`.
- [ ] **Step 3:** subir e aplicar.

  Run: `bash scripts/supabase-local/iniciar.sh --reset && psql postgresql://postgres@localhost:54322/postgres -X -q -f supabase/setup.sql && psql postgresql://postgres@localhost:54322/postgres -X -q -f supabase/setup.sql`

  Expected: "Postgres: …", "API (supabase-js): http://localhost:54321".
- [ ] **Step 4:** linha de base antes de mexer.

  Run: `npx playwright test tests/cardapio.spec.js tests/acabamento-cliente.spec.js tests/aceite-cliente.spec.js tests/navegacao.spec.js tests/site.spec.js tests/site-ii.spec.js tests/preco-a-confirmar.spec.js --project=celular --project=desktop`

  Anotar as falhas que já existem (o `CLAUDE.md` lista 6 conhecidas). Elas não contam contra as tarefas seguintes.
- [ ] **Step 5:** commit `chore: Supabase local também sobe no macOS`.

### Task 2: Hot dog como primeira categoria

**Files:**
- Modify: `src/core.js` (mover o bloco `{ id: 'hotdog', … }` de `CONFIG.categorias` para o primeiro lugar)
- Modify: `supabase/seed.sql`, `supabase/setup.sql` (gerados)
- Create: `supabase/ajustar-ordem-hotdog-2026-11-22.sql` (produção, roda só na Tarefa 7)
- Test: `supabase/tests/00_estrutura.sql`; Create: `tests/cardapio-topo.spec.js`

**Interfaces:**
- Produces: `C.categorias[0].id === 'hotdog'`; `#cat-hotdog` é a primeira `.cat` de `#menu-lista`.

- [ ] **Step 1: testes que falham.**
  - SQL em `00_estrutura.sql`: `select pg_temp.igual((select id from categorias_produtos order by ordem limit 1), 'hotdog', 'seed: hot dog é a primeira categoria');`.
  - Em `tests/cardapio-topo.spec.js`, `test('hot dog é a primeira categoria do cardápio')`: `page.goto('/#cardapio')`, depois `expect(page.locator('#menu-lista .cat').first()).toHaveAttribute('id', 'cat-hotdog')`.
- [ ] **Step 2:** rodar `bash scripts/testar-sql.sh` e o spec novo. Os dois falham.
- [ ] **Step 3:** reordenar o `CONFIG`, depois `npm run seed && npm run setup-sql` e reaplicar o setup local duas vezes. O script de produção faz `update public.categorias_produtos set ordem = case id when 'hotdog' then 1 when 'artesanais' then 2 when 'tradicionais' then 3 else ordem end;` seguido de um `select` de conferência.
- [ ] **Step 4:** SQL e o spec passam. Rodar `site-ii.spec.js`, `navegacao.spec.js` e `site.spec.js`. Só pode mudar a ordem: o hot dog agora abre a placa do site e os stories. Se algum teste fixa a ordem antiga, atualizar a expectativa.
- [ ] **Step 5:** commit `feat: hot dog como primeira categoria`.

### Task 3: Busca atrás da lupa

**Files:**
- Modify: `index.html` (tela `menu`): botão `<button type="button" class="ibtn" data-busca-abrir aria-label="Buscar no cardápio" aria-expanded="false" aria-controls="busca-painel">` em `.tela-cab .acoes`, antes da sacola. Envolver `.busca` e `#filtros` em `<div class="busca-painel" id="busca-painel" hidden>`, com um botão `data-busca-fechar aria-label="Fechar a busca"`.
- Modify: `src/app.js`
- Create: `src/styles/cardapio-topo.css` (importar em `src/main-cliente.js` logo depois de `./styles/app.css`)
- Test: `tests/cardapio-topo.spec.js`; Modify: `tests/acabamento-cliente.spec.js:50`, `tests/aceite-cliente.spec.js:552-555` (abrir a lupa antes de usar `#f-busca` e `#filtros`)

**Interfaces:**
- Produces: `abrirBusca(): void` (mostra o painel, `aria-expanded="true"`, foca `#f-busca`) e `fecharBusca(): void` (esconde o painel; zera `st.busca`, `st.filtro`, `#f-busca.value` e o `aria-pressed` dos `[data-filtro]`; chama `renderMenu()`). Com busca ou filtro ativo, a classe `buscando` fica em `[data-screen="menu"]`, ligada em `renderMenu()`.

- [ ] **Step 1: testes que falham** (em `cardapio-topo.spec.js`):
  - `'lupa abre a busca e foca o campo'`: antes de abrir, `#f-busca` está oculto; depois de clicar em `[data-busca-abrir]`, está visível e focado.
  - `'buscar esconde o topo e mostra só o resultado'`: preenche "bacon". `#car-hd` e `#indice` ficam ocultos, e todo `.prod-nome` visível contém "bacon" no nome ou nos ingredientes.
  - `'fechar a busca limpa texto e filtro'`: com "bacon" e o filtro "frango" ativos, clicar em `[data-busca-fechar]` deixa `#f-busca` com valor `''`, nenhum `[data-filtro][aria-pressed="true"]` e `#menu-lista .cat` com as 7 categorias. Depois `#bio` e `#cardapio`: o painel continua fechado.
- [ ] **Step 2:** rodar o spec. Falha.
- [ ] **Step 3:** implementar.
  - O painel fica preso logo abaixo do cabeçalho (`position: sticky`, `top: calc(var(--top) + 64px)`, `z-index` acima de `#chips`), para continuar visível com a página rolada.
  - Os cliques entram no `click` delegado já existente (perto de `src/app.js:1694`).
  - `Escape` com o painel aberto chama `fecharBusca()`. Ao sair da tela `menu`, o painel fecha.
- [ ] **Step 4:** spec novo, `acabamento-cliente.spec.js` e `aceite-cliente.spec.js` passam (fora as falhas da linha de base).
- [ ] **Step 5:** commit `feat: busca e filtros do cardápio atrás da lupa`.

### Task 4: Carrossel de fotos dos hot dogs

**Files:**
- Modify: `index.html`: logo depois de `#busca-painel`, `<section class="car-hd" id="car-hd" aria-roledescription="carrossel" aria-label="Hot dogs em destaque"><div class="car-trilho" id="car-trilho"></div><div class="car-pontos" id="car-pontos" aria-hidden="true"></div></section>`
- Modify: `src/app.js`, `src/styles/cardapio-topo.css`
- Test: `tests/cardapio-topo.spec.js`

**Interfaces:**
- Consumes: `visual(p, tam, extra, opc)` (`src/app.js:90`), `brl()`, `ML.store.esgotados()`, `ML.regras.temPreco(p)`, `abrirFicha` (pelo `[data-abrir]` do clique delegado) e `irCategoria(id)`.
- Produces:
  - `CARROSSEL_HD`: array em `src/app.js` com os 4 cards e os textos das Global Constraints. O card Hot dog tem `tamanhos: ['dog-medio','dog-max','dog-super']`, `foto: 'dog-max'` e `acao: 'tamanhos'`. Os outros têm `produto: '<id>'` e `acao: 'pedir'`.
  - `montarCarrossel(): void`: monta `#car-trilho` e `#car-pontos`. Um card sai se o produto não estiver em `ML.produtos`, estiver esgotado, sem preço ou sem foto. O card Hot dog sai se nenhum tamanho estiver disponível. Com zero cards, `#car-hd.hidden = true`.
  - Atributos: `.car-slide`, contador `.car-n` ("n/total"), preço `.car-preco`, botão "Ver tamanhos" com `data-ir-cat="hotdog"`, botão "Pedir este" com `data-abrir="<id>"`.
  - Novo atributo `[data-ir-cat]` no clique delegado, que chama `irCategoria(id)`.

- [ ] **Step 1: testes que falham:**
  - `'carrossel mostra os 4 hot dogs com o preço do catálogo'`: `.car-slide` tem 4 itens. Os textos de `.car-preco` são "a partir de R$ 14,99", "R$ 35,99", "R$ 26,99" e "R$ 24,99". `.car-n` do primeiro é "1/4".
  - `'esgotado sai do carrossel'`: com `mudarEstado(page, j => { j.esgotados = ['dog-pizza'] })`, sobram 3 cards e nenhum contém "Dog Pizza". Com `['dog-medio','dog-max','dog-super','dog-cbo-turbo','dog-pizza','dog-doritos']`, `#car-hd` fica oculto.
  - `'preço novo do banco aparece no carrossel'`: com `j.precos['dog-medio'] = 13.5`, o primeiro card mostra "a partir de R$ 13,50".
  - `'Pedir este abre a ficha e Ver tamanhos leva aos hot dogs'`: clicar em "Pedir este" do CBO Turbo abre `#ficha` com "CBO Turbo". Depois de fechar, "Ver tamanhos" deixa `#cat-hotdog` na tela (`toBeInViewport`).
  - `'carrossel não anda sozinho'`: depois de esperar 5 s, o `scrollLeft` de `#car-trilho` continua 0.
- [ ] **Step 2:** rodar. Falha.
- [ ] **Step 3:** implementar.
  - Encaixe: `scroll-snap-type: x mandatory`, cards com `flex: 0 0 calc(100% - 46px)`, altura de 214 px, foto à direita ocupando 62% e degradê para `#170E0B` do lado do texto. Medidas e tipos estão na prévia v3: `/private/tmp/…/scratchpad/hotdog-v3.src.html`, classes `.slide*`.
  - Pontos: atualizados no `scroll` do trilho (passivo).
  - Imagem do primeiro card com carga `'cedo'`; as outras, `'lazy'`.
  - Chamar `montarCarrossel()` no início, ao lado de `montarChips()`, e nos eventos `cardapio:estado` e `cardapio:esgotados` (`src/app.js:1758`).
- [ ] **Step 4:** spec passa.

  Run: `npx playwright test tests/cardapio-topo.spec.js tests/aceite-cliente.spec.js --project=celular --project=desktop`

  O caso de movimento reduzido de `aceite-cliente` não pode ganhar animação nova.
- [ ] **Step 5:** commit `feat: carrossel de fotos dos hot dogs no topo do cardápio`.

### Task 5: Índice do cardápio e barra de categorias que entra na rolagem

**Files:**
- Modify: `index.html`: depois de `#car-hd`, `<section class="indice" id="indice" aria-labelledby="indice-tit"><div class="indice-cab"><h2 id="indice-tit">Cardápio completo</h2><span id="indice-total"></span></div><div class="indice-grade" id="indice-grade"></div></section>`. Mover `<nav class="chips" id="chips">` para logo depois do `.tela-cab`, antes de `#busca-painel`.
- Modify: `src/app.js`, `src/styles/cardapio-topo.css`. Em `src/styles/app.css`: o `top` do `.chips` passa a `calc(var(--top) + 64px)`, e o `scroll-margin-top` de `.cat` e `.prod-cel` passa a `calc(var(--top) + 64px + 64px + 8px)`.
- Test: `tests/cardapio-topo.spec.js`

**Interfaces:**
- Produces:
  - `montarIndice(): void`: um botão `.indice-tile` com `data-ir-cat="<id>"` para cada categoria de `C.categorias` com itens, mostrando ícone, `label` e "N itens" (ou "1 item"). Mais um quadro "Buscar", com `data-busca-abrir`. `#indice-total` mostra "<total> itens". Chamado nos mesmos pontos que `montarCarrossel()`.
  - Classe `com-barra` em `[data-screen="menu"]`: ligada por um `IntersectionObserver` em `#indice`, com `rootMargin` negativo da altura do cabeçalho, quando o índice já passou para cima. Sem `com-barra`, `#chips` fica recolhido (altura 0, `visibility:hidden`). Com movimento reduzido, entra sem transição. O `marcarChip()` continua como está.

- [ ] **Step 1: testes que falham:**
  - `'índice mostra as 7 categorias e o total'`: `.indice-tile[data-ir-cat]` tem 7 itens. O primeiro contém "Hot dog" e "9 itens". `#indice-total` mostra "56 itens".
  - `'tocar no índice leva à categoria'`: clicar em `[data-ir-cat="combos"]` deixa `#ct-combos` na tela.
  - `'barra de categorias só aparece depois do índice'`: no topo, `#chips` não está visível. Depois de rolar até `#cat-artesanais`, `#chips` está visível e `[data-chip="artesanais"]` tem `aria-pressed="true"`.
  - `'link direto abre na categoria'`: `page.goto('/#cardapio/combos')` deixa `#ct-combos` na tela e não coberto pelo cabeçalho (o topo do título fica abaixo do `bottom` de `#chips`).
  - `'larguras de 320 e 1280 sem rolagem lateral'`: em 320×640 e 1280×800, `rolagemHorizontal(page)` dá 0, e `alvosPequenos(page, '[data-screen="menu"]', 44)` não acha nenhum em `#car-hd`, `#indice` e `.regua-tam`.
- [ ] **Step 2:** rodar. Falha.
- [ ] **Step 3:** implementar (grade de 4 colunas, quadros com `min-height: 78px`).
- [ ] **Step 4:** o spec e `site.spec.js` passam. O teste de `site.spec.js:684` cobre o título que não pode ficar sob o cabeçalho.
- [ ] **Step 5:** commit `feat: índice do cardápio e barra de categorias que entra na rolagem`.

### Task 6: Régua de tamanhos e faixa do combo depois dos hot dogs

**Files:**
- Modify: `src/app.js` (`renderMenu()`)
- Modify: `index.html` (tirar a `.faixa-combo` estática do topo do cardápio; a da bio, `.bio-ctas + .faixa-combo`, fica)
- Modify: `src/styles/cardapio-topo.css`
- Test: `tests/cardapio-topo.spec.js`; conferir `tests/cardapio.spec.js:67-70` e `tests/acabamento-cliente.spec.js:64`

**Interfaces:**
- Produces:
  - `salsichasSVG(n: 1|2|3): string`: o desenho da prévia v3 (função `salsichas`).
  - `reguaHTML(esg: object): string`: `<div class="regua" role="group" aria-label="Tamanhos do hot dog">` com um `<button type="button" class="regua-tam" data-abrir="<id>">` para cada tamanho disponível de `dog-medio`, `dog-max` e `dog-super`. Cada botão tem o desenho, o nome curto (Médio, Max, Super) e o preço. Sem tamanho disponível, devolve `''`.
  - `faixaComboHTML(): string`: a mesma marcação da faixa de hoje (`.faixa-combo[data-faixa-combo]` com `data-combo-selo`, `data-combo-preco` e `data-combo-inclui`, valores de `comboTxt()` e `comboInclui()`).
  - Sem busca nem filtro, `renderMenu()` põe a régua logo depois do `.cat-cab` de `#cat-hotdog` e a faixa logo depois de `#cat-hotdog`.

- [ ] **Step 1: testes que falham:**
  - `'régua com os 3 tamanhos e preço do catálogo'`: `.regua-tam` tem 3 itens com "Médio R$ 14,99", "Max R$ 16,99" e "Super R$ 19,99". Clicar em "Max" abre `#ficha` com "Hot Dog Max".
  - `'tamanho esgotado sai da régua'`: com `j.esgotados = ['dog-max']`, sobram 2 tamanhos.
  - `'faixa do combo fica depois dos hot dogs'`: `#cat-hotdog + .faixa-combo` existe e contém "+R$ 14,90". Nenhuma `.faixa-combo` vem antes de `#menu-lista` na tela `menu`.
- [ ] **Step 2:** rodar. Falha.
- [ ] **Step 3:** implementar. A faixa sai do HTML estático do cardápio. O `animarFaixas()` (`src/app.js:1659`) continua achando a faixa por `[data-faixa-combo]`.
- [ ] **Step 4:** o spec, `cardapio.spec.js` e `acabamento-cliente.spec.js` passam. Se algum teste localizava a faixa pelo topo, ajustar só o seletor de posição.
- [ ] **Step 5:** commit `feat: régua de tamanhos e faixa do combo depois dos hot dogs`.

### Task 7: Bateria, conferência visual e publicação

**Files:**
- Modify: `docs/DIRECAO-VISUAL.md` (§5.2: nova ordem da tela; §5.0: acrescentar `#car-hd`, `#indice`, `[data-ir-cat]`, `[data-busca-abrir]`, `[data-busca-fechar]`, `.regua-tam`)
- Modify: `CLAUDE.md` (nota de 22/11 sobre o topo do cardápio e a ordem das categorias)

- [ ] **Step 1:** bateria N2.

  Run: `npm run lint && npm run build && bash scripts/testar-sql.sh && node scripts/testar-paridade.mjs && node --test tests/*.test.mjs && npx playwright test`

  Expected: nenhuma falha nova contra a linha de base da Tarefa 1.
- [ ] **Step 2:** conferir no navegador do app (`npx vite preview --mode development --port 4180`, com o Supabase local) em 320, 390, 680 e 1280. Pontos:
  - na primeira tela aparecem o carrossel, o índice e o começo da lista;
  - o próximo card aparece na borda;
  - a barra entra quando o índice sai;
  - nenhuma fonte de reserva;
  - nada se mexe sozinho.

  Tirar uma captura de cada largura.
- [ ] **Step 3:** commit dos documentos. `git push origin feat/hotdogs-topo` e mostrar ao usuário a prévia da Vercel da branch.
- [ ] **Step 4 (com o ok do usuário):**
  1. Rodar `supabase/ajustar-ordem-hotdog-2026-11-22.sql` em produção (`supabase db query --remote=puwylyfmwcvpfsftsrta --yes -f …`, de fora de uma pasta com `supabase/`).
  2. `git push origin feat/hotdogs-topo:claude/modest-galileo-t43m7f`, com autor e committer `icecompany-19`, como nos commits anteriores.
  3. Esperar o status da Vercel e conferir `https://mineirolanches.store/#cardapio` no navegador: hot dog primeiro, carrossel com os preços do banco e console sem erro.
