# Mineiro Lanche: da prévia aprovada para produção

**Meta:** colocar no ar hoje (08/10/2026), na reunião das 18h com o cliente, a versão definitiva com estas peças:

- bio, cardápio e site;
- pedidos registrados no Supabase;
- painel de pedidos com login, recebendo pedidos de **qualquer aparelho**;
- QR code levando direto ao cardápio.

**Como ler:** cada linha da seção 5 é uma microtarefa de 5 a 40 min. Ela traz os arquivos que toca, o modelo indicado e o critério "pronto quando". Faça uma tarefa por sessão ou prompt e um commit por tarefa.

---

## Status (08/10, tarde)

**Bloco A concluído:** A0–A6.3, exceto o que depende de rede ou de pessoa: A2.1 (criar o projeto), A4.5 (ler o QR impresso), A5.4 (ampliar fotos) e A6.1 (importar na Vercel).

- **Revisão adversarial feita:** 4 frentes, 15 achados confirmados e corrigidos com teste. Isso cobre a A2.7.
- **Falta no Supabase real:** aplicar o `supabase/setup.sql`, criar o usuário do painel e conferir o Realtime em produção. Daqui não há rede até o Supabase.

## 0. O que já foi feito (nesta sessão)

| Item | Resultado |
|---|---|
| Repositório vazio | O `mineiro-lanches` foi criado novo e nunca recebeu código. A prévia vive em `icecompany-19/gasplab-previews`, pasta `mineiro-lanche/`. Segundo o README de lá, a Vercel publica a `main` desse repositório. |
| Importação | Cópia fiel da prévia em `preview/`, a partir do commit `a7aee46` do gasplab-previews (o publicado), com 55 arquivos e 3,1 MB. |
| Imagens esticadas | **Corrigido.** Os dois lanches recortados do topo da bio saíam com 118×720 px em vez de 118×153. Causa: `width/height` no HTML e o reset `img{}` sem `height:auto`. Conferido com Playwright em 390 e 1280 px (bio, cardápio, ficha, stories, site e galeria): zero imagens distorcidas. Antes × depois: `docs/img/bio-antes-depois.png`. |
| Prévia no ar | **Ainda tem o bug.** Se quiser corrigir lá também, a mudança é de uma linha em `gasplab-previews/mineiro-lanche/page.html` (linha 28): `img{max-width:100%;height:auto;display:block}`. Depois rodar o `build.mjs`. |
| Fotos com pouca resolução | Não estão esticadas, mas ficam borradas em celular de tela densa (DPR 3). O arquivo `-1080` delas é, na verdade, menor: `dog-doritos` tem 481 px (precisa de 2,4×), `gran-burger` 720 px (1,6×) e `gran-crispy` 716 px (1,6×). Tarefa A5.4. |

---

## 1. Decisões de arquitetura

| Decisão | Por quê |
|---|---|
| **Reaproveitar o front da prévia (JS puro) com Vite**, sem reescrever em React/Next | A interface aprovada tem cerca de 270 KB de código pronto e testado. Reescrever hoje custa dias e se afasta do que o cliente aprovou. O Vite traz minificação, hash nos arquivos, `.env` e várias páginas. Cardápio é conteúdo estático: CDN + JS leve é o mais rápido possível. Next.js fica para depois, só se surgir necessidade (Bloco C). |
| **Supabase** (Postgres, RLS, RPC, Realtime e Auth) na região `sa-east-1` (São Paulo) | Registra pedidos e clientes, sincroniza o painel entre aparelhos e dá login ao painel. A região SP reduz a latência para Suzano. |
| **Manter o contrato `ML.store`** (`core.js`) e trocar só o que tem dentro | `app.js` e `painel.js` já falam com `ML.store.*` e `ML.store.ouvir()`. O adaptador novo mantém leituras síncronas (cache em memória) e emite **os mesmos eventos** (`pedido:novo`, `pedido:status`, `cardapio:esgotados`, `loja:modo`) a partir do Realtime. Resultado: quase nada muda no painel. |
| **Preço calculado no servidor** (RPC `criar_pedido`) | Nunca confiar no total enviado pelo navegador. O banco recalcula: base + adicionais × 7,50 + combo 14,90. |
| **Painel em página separada** (`/painel/`, com login) | Tira cerca de 92 KB (`painel.js` + `painel.css`) do que o cliente final baixa e protege os dados dos pedidos. |
| **QR aponta para `/q`** (redirecionamento) e não para a URL final | O impresso continua válido mesmo que a rota mude. Ver seção 4. |
| **Plano B garantido** | Se o Supabase falhar no envio, o checkout oferece "Enviar pelo WhatsApp" com o pedido completo. Nenhum pedido se perde. |

---

## 2. Estrutura final do repositório

```
mineiro-lanches/
  index.html                 bio + cardápio + site + acompanhar (cliente)
  painel/index.html          painel (login + quadro)
  src/
    core.js                  CONFIG + regras + fmt (vindo de preview/core.js)
    app.js                   lógica do cliente (vindo de preview/app.js)
    painel/painel.js|css     (vindo de preview/painel.*)
    lib/supabase.js          cliente Supabase (import dinâmico)
    lib/store-supabase.js    implementa ML.store sobre Supabase
    styles/app.css           CSS extraído do page.html (linhas 6–611)
  public/
    assets/                  fotos, recortes, logo (vindo de preview/assets)
    icones.svg               sprite de ícones (sai do HTML)
    qr/                      QR gerados + cartaz
    robots.txt, sitemap.xml, manifest.webmanifest
  supabase/
    migrations/0001_schema.sql · 0002_rls.sql · 0003_rpc.sql
    seed.sql                 gerado do CONFIG por scripts/gerar-seed.mjs
  scripts/  gerar-seed.mjs · qrcode.mjs · fotos.mjs (sharp)
  tests/    e2e.spec.js · imagens.spec.js (Playwright)
  vercel.json · vite.config.js · .env.example
  preview/                   (apagada no fim do Bloco A; fica no histórico do git)
```

---

## 3. Banco (Supabase)

### 3.1 Tabelas

| Tabela | Campos principais | Observação |
|---|---|---|
| `produtos` | `id text pk`, `categoria`, `nome`, `preco numeric(10,2)`, `tipo` (`lanche`/`combo`/`porcao`/`bebida`), `foto`, `dados jsonb` (ing, inclui, base), `ordem`, `ativo bool`, `esgotado_dia date` | **55 itens**: 34 lanches, 11 combos, 2 porções, 8 bebidas |
| `adicionais` | `id text pk`, `nome`, `preco` | 5 itens a R$ 7,50 |
| `loja` | linha única: `modo` (`auto`/`aberta`/`fechada`), `combo_preco 14.90`, `adicional_preco 7.50`, `aceita_fechada bool` | |
| `clientes` | `telefone pk`, `nome`, `endereco`, `referencia`, `pedidos int`, `ultimo_pedido_em` | É o "registrar": base para CRM. Guarda o **último** nome e endereço informados para aquele telefone, **sem verificação** (qualquer pessoa pode pedir com qualquer telefone). Não é fonte confiável de identidade: o dado de cada pedido vale o que está em `pedidos.cliente_nome`, `endereco` e `referencia`. Se um dia o CRM ler esta tabela, guardar histórico (ex.: `clientes_enderecos`) ou verificar o telefone por OTP. |
| `pedidos` | `id uuid`, `numero bigint identity` (#0001), `token uuid unique` (acompanhamento), `criado_em`, `origem` (`cardapio`/`qrcode`/`exemplo`), `mesa`, `cliente_nome`, `cliente_telefone`, `modo`, `endereco`, `referencia`, `pagamento`, `troco`, `obs`, `itens jsonb`, `total`, `status`, `historico jsonb` | `itens` em jsonb no mesmo formato do contrato do painel. Normalizar depois, se precisar de relatório em SQL. |
| `equipe` | `user_id uuid pk → auth.users` | Quem acessa o painel |

**Dia de operação.** O "dia" do truck vira às **4h**, como o `DIA_OP_OFFSET` do painel, porque o truck atende depois da meia-noite. Para "esgotado hoje", grave `esgotado_dia = ((now() at time zone 'America/Sao_Paulo') - interval '4 hours')::date`. Ele expira sozinho no dia seguinte. Na prévia ele **nunca expirava**.

### 3.2 Funções (RPC, `security definer`, `search_path = public`)

- **`criar_pedido(p jsonb)`**, liberada para `anon`. Devolve `{id, numero, token, total}`. Passos:
  1. Valida tamanhos (nome com 2 a 80 caracteres; telefone com 10 ou 11 dígitos), `modo` e loja aberta, conforme `aceita_fechada`.
  2. Valida cada item: produto ativo e não esgotado hoje; `qtd` de 1 a 20; combo só se `tipo = 'lanche'`; adicionais existentes, com `qtd` de 0 a 5.
  3. Recalcula os preços: `(preco + Σ adicional × qtd + combo?14,90:0) × qtd`. Nome e preço vêm do banco; o `resumo` do cliente é cortado em 200 caracteres.
  4. Limita a 5 pedidos por telefone a cada 10 minutos (o 6º é recusado com `muitos_pedidos`).
  5. Insere o pedido e faz upsert em `clientes`.
- **`acompanhar_pedido(token uuid)`**, liberada para `anon`: devolve só `numero`, `status`, `historico`, `modo`, `itens` (nome, qtd e resumo) e `total`.
- **`mudar_status(id, status, motivo)`**, só para `equipe`: valida a transição (`novo→preparo→pronto|rota→entregue`, cancelar a qualquer momento) e acrescenta ao `historico`.
- **`marcar_esgotado(produto_id, bool)`** e **`definir_loja(modo)`**, só para `equipe`.

### 3.3 RLS e Realtime

- `produtos`, `adicionais` e `loja`: `select` para todos; escrita só por RPC da equipe.
- `pedidos` e `clientes`: **nenhum acesso `anon`**; `select` para `is_equipe()`.
- `revoke execute ... from public` e liberar cada RPC só para quem pode.
- Realtime ligado em `pedidos` (o painel autenticado recebe na hora), `produtos` e `loja` (o cardápio vê esgotado e aberto/fechado ao vivo).
- O cliente acompanha o pedido pelo RPC a cada 10 s e ao voltar para a aba. Isso basta para a v1; o broadcast do Realtime fica para depois.
- No Auth, **desligar o cadastro aberto**. O usuário do painel é criado no dashboard.

---

## 4. QR code

| Item | Definição |
|---|---|
| Destino | `https://<domínio>/q` → redireciona (no `vercel.json`) para `/?origem=qrcode`; o app abre direto no **cardápio** quando vê `origem=qrcode`. Por mesa (opcional): `/q/3` → `/?origem=qrcode&mesa=3`, que já marca "Comer no local · Mesa 3". |
| Geração | `scripts/qrcode.mjs` com o pacote `qrcode`. Gera SVG (vetor, para a gráfica) e PNG de 2048 px. Correção de erro **H**, para aceitar o selo do logo no centro (no máximo 20% da área). Margem de 4 módulos. Cor carvão `#1A1414` sobre creme `#FFF6E0`. |
| Impressão | `public/qr/cartaz.html` em A6 e A5: logo, "Aponte a câmera e peça", QR de pelo menos 4 cm, WhatsApp e @mineirolanchesuzano. Exportar em PDF. |
| Medição | O pedido grava `origem` e `mesa`; o painel mostra o selo "QR · Mesa 3"; o relatório ganha "pedidos por origem". |
| Atenção | **Só imprimir depois de definir o domínio final.** Se ainda não houver domínio, use `mineiro-lanches.vercel.app/q`, que é estável enquanto o projeto da Vercel não mudar de nome. |

---

## 5. Microtarefas

**Legenda:**

- Modelos: **H** = Haiku (mecânico), **S** = Sonnet (implementação), **O** = Opus (só revisão de segurança e QA final), 👤 = humano.
- ∥ = pode rodar em paralelo com o grupo anterior.

### Bloco A: antes das 18h (não depende do cliente), cerca de 4h com paralelismo

**A0. Base do projeto (25 min)**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A0.1 | `package.json` (Vite 6, `@supabase/supabase-js`, `qrcode`, `sharp`, `@playwright/test`), `vite.config.js` com 2 entradas (`index.html` e `painel/index.html`), `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) | raiz | H | 15 | `npm run dev` e `npm run build` rodam |
| A0.2 | ESLint (flat) + Prettier + `.editorconfig` | raiz | H | 10 | `npm run lint` sem erro |

**A1. Migração do front (cerca de 1h30)**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A1.1 | `git mv preview/assets public/assets` | public/ | H | 5 | Fotos carregam |
| A1.2 | Extrair o CSS (`page.html` linhas 6–611) para `src/styles/app.css`. Trocar o Google Fonts por `@fontsource` (Lilita One, Oswald 500–700, Rubik 400–700, só latin) e pré-carregar a Lilita | src/styles | H | 15 | Nenhuma requisição a fonts.googleapis |
| A1.3 | Montar `index.html` com o corpo do `page.html` (linhas 612–1149), **sem a camada de prévia**: intro "Ver a prévia", abas `pv-*`, textos "Prévia GaspLab" e o `#view-painel`. Navegação: bio (início) → `#cardapio` → `#site` | index.html | S | 25 | As 3 telas navegam; nenhum "prévia" na página (`grep -i prévia`) |
| A1.4 | Passar `core.js` e `app.js` para `src/` como módulos (`import './core.js'` antes do app). Remover `modoPrevia` e o texto "Nesta prévia você pode enviar…" (`app.js:322`) | src/ | S | 20 | Console limpo; fluxo da sacola igual ao da prévia |
| A1.5 | Extrair o sprite de ícones para `public/icones.svg` (`<use href="/icones.svg#i-x">`). Criar `painel/index.html` mínimo, que carrega core + painel | public, painel/ | S | 20 | Painel abre em `/painel/`; o bundle do cliente não contém `painel` |
| A1.6 | Fotos com `srcset` pela **largura real** (`fotos.json`), `sizes`, `fetchpriority="high"` na imagem principal e `loading="lazy"` abaixo da dobra. Transformar o script de medição desta sessão em `tests/imagens.spec.js` (falha se alguma imagem com `object-fit:fill` distorcer mais de 3%) | src/app.js, tests | H | 20 | Teste passa em 390 e 1280 px |

**A2. Supabase (cerca de 1h30), ∥ com A1**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A2.1 | Criar o projeto (`sa-east-1`), desligar o cadastro aberto e copiar a URL e a anon key para a Vercel e o `.env.local` | dashboard | 👤 | 10 | Chaves em mãos |
| A2.2 | `0001_schema.sql`: tabelas da seção 3.1, `check`s e índices (`pedidos(criado_em desc)` e parcial em status ativos) | supabase/migrations | S | 20 | `supabase db push` sem erro |
| A2.3 | `scripts/gerar-seed.mjs`: lê `CONFIG` do `core.js` (via `vm`) e gera o `seed.sql` com os 55 produtos e 5 adicionais | scripts, supabase | H | 20 | `select count(*) from produtos` = 55 |
| A2.4 | `0002_rls.sql`: RLS da seção 3.3, `equipe` e `is_equipe()` | migrations | S | 20 | `anon` não lê `pedidos` (teste via REST) |
| A2.5 | `0003_rpc.sql`: as 5 funções da seção 3.2 | migrations | S | 35 | Testes da A2.6 passam |
| A2.6 | Testes SQL: pedido com preço adulterado sai com o total correto; item esgotado é recusado; 4º pedido em 10 min é recusado; `anon` não chama `mudar_status` | supabase/tests | H | 15 | Os 4 casos passam |
| A2.7 | **Revisão de segurança** do SQL (RLS, `security definer`, grants) | migrations | O | 10 | Sem achados bloqueantes |

**A3. Integração (cerca de 2h), depende de A1.4 e A2.5**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A3.1 | `src/lib/supabase.js`: cliente com `import()` dinâmico depois da primeira pintura | src/lib | H | 10 | O LCP da bio não espera o Supabase |
| A3.2 | `store-supabase.js`: mesma API do `ML.store` (`core.js:268`). Faz uma carga inicial no cache, recebe Realtime e emite os mesmos eventos. `criarPedido` passa a devolver Promise. O carrinho e o rascunho do checkout ficam no `localStorage` (`mineiro:v2:`) | src/lib, src/core.js | S | 40 | Painel e cardápio funcionam sem mudança de contrato |
| A3.3 | Checkout assíncrono (`app.js:336`): "enviando…" com o botão travado; em caso de sucesso, mostra o número do servidor. Em caso de erro, mostra "Tentar de novo" e "**Enviar pelo WhatsApp**" com a mensagem completa. Guarda o `token` em "Meus pedidos" | src/app.js | S | 25 | Com a rede desligada, o pedido sai pelo WhatsApp |
| A3.4 | Acompanhar pedido via `acompanhar_pedido(token)`: consulta a cada 10 s e no `visibilitychange`. Rota `#pedido/<token>` | src/app.js | S | 20 | A mudança no painel chega ao celular em até 10 s |
| A3.5 | Painel com login (e-mail e senha do Supabase Auth), sair, sessão persistente. Esconder "Simular pedido" e "Gerar exemplos" fora de `VITE_DEMO=1`. Trocar o aviso "pedidos guardados neste navegador" (`painel.js:254` e `:310`) | src/painel | S | 30 | Sem login, não aparece nada |
| A3.6 | Esgotado e loja aberta/fechada ao vivo: o cardápio aplica `preco`, `ativo` e `esgotado_dia` do banco sobre o `CONFIG` | src/ | S | 15 | Esgotar no painel → "Esgotado hoje" no celular em menos de 2 s |

**A4. QR code (cerca de 1h), ∥ com A3**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A4.1 | Redirecionamentos `/q` e `/q/:mesa` no `vercel.json`; o app abre o cardápio com `origem=qrcode` | vercel.json, src/app.js | H | 10 | `/q` abre o cardápio |
| A4.2 | `scripts/qrcode.mjs` (seção 4) → `public/qr/cardapio.svg` e `.png`, e mesas opcionais via `--mesas 1-10` | scripts, public/qr | H | 15 | O arquivo lê no leitor da câmera |
| A4.3 | `public/qr/cartaz.html` (A6 e A5) + PDF | public/qr | H | 20 | Impresso com o QR de 4 cm é lido a 1 m |
| A4.4 | `origem` e `mesa` no pedido: modo "Comer no local" já marcado; selo no card do painel; "por origem" no relatório | src/app.js, src/painel | S | 20 | Pedido via QR aparece com o selo |

**A5. Performance, SEO e segurança (cerca de 1h), ∥ com A3**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A5.1 | `vercel.json`: `Cache-Control: immutable` para `/assets/*` com hash; CSP (`connect-src` com o Supabase `https` e `wss`); `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`; `noindex` **só** no `/painel/` | vercel.json | H | 15 | securityheaders.com nota A |
| A5.2 | SEO: tirar o `noindex` do site; meta e og:image com URL absoluta; JSON-LD `FoodEstablishment` (telefone, Suzano, horários seg–qui 19–00 e sex–sáb 19–01, `hasMenu`); `robots.txt`, `sitemap.xml`, `manifest.webmanifest` e ícones | index.html, public | H | 20 | Teste de resultados avançados do Google sem erro |
| A5.3 | Aviso de privacidade (LGPD) no checkout: "Usamos seus dados só para este pedido" | src/app.js | H | 5 | Texto visível |
| A5.4 | Ampliar as 3 fotos de baixa resolução (Freepik, Magnific Precision 2×, sem criatividade; conferir o saldo de créditos antes) e regenerar `-540`, `-1080` e `-q` com `scripts/fotos.mjs` (sharp, WebP q80) | public/assets | H | 20 | Fotos nítidas em DPR 3 |
| A5.5 | Lighthouse mobile | — | H | 15 | Desempenho ≥ 90; LCP < 2,5 s; CLS < 0,1; JS do cliente < 120 KB gz |

**A6. Deploy e QA (cerca de 45 min)**

| ID | Tarefa | Arquivos | Mod. | Min | Pronto quando |
|---|---|---|---|---|---|
| A6.1 | Projeto na Vercel a partir deste repositório, com as variáveis de ambiente. Prévia automática por PR | Vercel | 👤 | 10 | URL de prévia no ar |
| A6.2 | `tests/e2e.spec.js` com **2 contextos** (celular cliente + computador painel): QR → ficha (tirar item, prensado, combo, adicional) → checkout → card no painel em menos de 2 s → avançar status → cliente vê "Na chapa". Inclui o caso do esgotado | tests | S | 30 | Verde contra a URL de prévia |
| A6.3 | Revisão final do diff + apagar `preview/` | — | O | 15 | Pronto para a reunião |

### Bloco B: reunião das 18h com o cliente (60 a 75 min)

| ID | Tarefa | Quem | Min |
|---|---|---|---|
| B1 | Responder as perguntas da seção 6 (abrir a reunião com elas) | 👤 + cliente | 15 |
| B2 | Aplicar as respostas no `CONFIG` e no seed: preços divergentes, domingo, pagamento, taxa, sabores, Combo Casal → `gerar-seed` → `montar-setup` → commit → deploy → colar o `setup.sql` no SQL Editor. O `CONFIG` manda no `ativo`: item que sai do `CONFIG` fica inativo e item que volta é reativado. Para tirar um item só por hoje, use "esgotado" no painel. | H | 15 |
| B3 | Criar o usuário do painel com o e-mail do dono e inserir em `equipe`; fazer login no aparelho do truck e testar o som | 👤 | 10 |
| B4 | Domínio final na Vercel (se houver) → `node scripts/qrcode.mjs` → imprimir o cartaz | 👤 + H | 15 |
| B4.1 | **Antes do B5, abrir a loja.** Às 18h de quinta a loja está fechada no modo Automático (o turno começa às 19h) e o pedido real seria recusado com "O truck não está recebendo pedidos agora". No painel: **Loja → Aberta**. Antes da reunião, conferir no Supabase real: `select modo, aceita_fechada from loja;` | 👤 | 1 |
| B5 | Pedido real pelo celular do cliente (via QR) → painel → status → acompanhar | 👤 + cliente | 10 |
| B5.1 | **Depois da demonstração, voltar a Loja para Automático.** Em Aberta, a loja aceita pedidos fora do horário e aos domingos. Não mudar o `aceita_fechada` sem a resposta da pergunta 10 da seção 6. | 👤 | 1 |
| B6 | Limpar os testes: `delete from pedidos where origem = 'exemplo' or obs ilike '%teste%'`; reiniciar a numeração se o cliente quiser | 👤 | 5 |
| B7 | Cliente troca o link da bio do Instagram pela URL nova | cliente | 5 |

### Bloco C: depois do go-live (não trava nada)

- Web Push no painel (pedido novo com a aba fechada).
- Impressão térmica direta (80 mm).
- Pix integrado.
- Taxa de entrega por bairro.
- Relatórios em SQL (views).
- Retenção LGPD com `pg_cron` (apagar endereço após 90 dias).
- Sentry.
- Turnstile, se aparecer spam.
- Broadcast do Realtime no acompanhamento.
- Next.js, só se precisar de SSR ou área logada do cliente.

---

## 6. Perguntas para a reunião das 18h

Estas travam a configuração final, não o desenvolvimento.

1. **Domínio:** vai ter domínio próprio? Ele define a URL do QR que vai ser impressa.
2. **E-mail de quem acessa o painel**, e em que aparelho: notebook ou tablet no truck?
3. **Domingo** abre? Em que horário?
4. **Pagamento:** Pix, cartão, dinheiro? Precisa de troco?
5. **Entrega:** área atendida e taxa (fixa ou por bairro)?
6. **Sabores** de refrigerante lata (para o seletor do combo), sabores de suco e o que é "H2O".
7. **Preços divergentes** entre a legenda e o cardápio impresso: Gran Salada (26,90 × 28,90) e Gran Crispy (27,90 × 26,90).
8. **Combo Casal:** o que vem nele?
9. **Ponto exato do truck** (para o mapa e o JSON-LD).
10. **Aceitar pedido com a loja fechada?** Sim agenda o pedido; não bloqueia o envio.
11. **QR por mesa** ou um único QR?
12. **Impressora térmica** no truck? Ela entra no Bloco C.

---

## 7. Como gastar poucos tokens

**Tamanho dos arquivos (aprox.):** `page.html` cerca de 35 mil tokens · `app.js` 17 mil · `painel.js` 17 mil · `core.js` 10 mil · `painel.css` 10 mil.

**Regras:**

1. **Nunca abra arquivo grande inteiro.** Localize com `grep -n` e leia só o trecho (`sed -n 'X,Yp'`). As linhas citadas neste plano já apontam o lugar.
2. **Uma microtarefa por prompt**, com o arquivo-alvo e o "pronto quando" copiados da tabela. Sem pedir "revise o projeto".
3. **Modelo certo:** Haiku para mover, configurar e gerar (A0, A1.1, A1.2, A2.3, A4, A5); Sonnet para lógica (A1.3–A1.5, A2.2–A2.5, A3); Opus só em A2.7 e A6.3.
4. **Paralelo onde marcado:** A1 ∥ A2; A3 ∥ A4 ∥ A5.
5. **Verificar por script, não por print:** Playwright headless e asserções; screenshot só na revisão final.
6. **Não regenerar assets:** fotos, recortes e logo já estão prontos em `preview/assets`.
7. **Um commit por microtarefa:** facilita reverter e não obriga a reler contexto.

**Modelo de prompt:**

```
Tarefa A3.3 do docs/PLANO.md. Arquivo: src/app.js (checkout perto da linha 336; use grep).
Faça: <copiar a coluna Tarefa>. Pronto quando: <copiar>. Não leia outros arquivos inteiros.
Rode `npm run lint && npx playwright test tests/e2e.spec.js -g checkout` e faça commit.
```

---

## 8. Critérios de aceite do go-live

1. Pedido feito **num celular** aparece no **painel de outro aparelho** em menos de 2 s, com som.
2. A mudança de status no painel chega à tela "Acompanhe seu pedido" do cliente em até 10 s.
3. O total é sempre o do servidor; preço adulterado no navegador não passa.
4. Combo soma +14,90, cada adicional soma 7,50 e prensado não muda o preço.
5. O QR impresso abre o cardápio em menos de 3 s no 4G e grava `origem = qrcode`.
6. Esgotado no painel aparece no cardápio em menos de 2 s e volta sozinho no dia seguinte (às 4h).
7. Nenhuma imagem distorcida (`tests/imagens.spec.js`).
8. Lighthouse mobile ≥ 90.
9. `anon` não lê pedidos nem clientes.
10. O painel exige login.
11. Se o Supabase cair, o pedido sai pelo WhatsApp.

---

## 9. Riscos

| Risco | Resposta |
|---|---|
| Não terminar o Bloco A até as 18h | A ordem já prioriza o caminho crítico: A0 → A1.3/1.4 → A2 → A3.2/3.3 → A3.5 → A6.1. A4.3, A5.2, A5.4 e A5.5 podem ficar para depois sem travar o go-live. |
| Domínio indefinido | QR provisório em `*.vercel.app/q`; o redirecionamento `/q` permite trocar o destino sem reimprimir. |
| Spam de pedidos (o RPC é público) | Limite por telefone no RPC; Turnstile no Bloco C. |
| Preço do `CONFIG` diferente do banco | O seed é gerado a partir do `CONFIG`; o front aplica o preço do banco por cima; a A2.6 testa. |
| Pedidos de teste misturados aos reais | `origem = 'exemplo'` + limpeza na B6. |
