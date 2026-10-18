# Mineiro Lanche

Bio, cardápio, site e painel de pedidos do food truck Mineiro Lanche (Centro de Suzano).

| Onde | O quê |
|---|---|
| `/` | Bio (link do Instagram) → cardápio (`#cardapio`) → site (`#site`) → acompanhar pedido (`#pedido/<token>`) |
| `/q` e `/q/<mesa>` | Destino do QR code: redireciona para o cardápio e marca a origem (e a mesa) |
| `/painel/` | Painel de pedidos da equipe (login do Supabase) |
| `/motoboy/` e `/motoboy/#<pedido>` | Tela do entregador (login próprio): lê o QR da comanda e marca o pedido como entregue; lista "Em rota" como plano B |
| `/qr/cartaz.html` | Cartaz para imprimir (A6; `?tamanho=a5`), com os PDFs ao lado |

Produção: **https://mineirolanches.store** (o `https://mineiro-lanches.vercel.app` continua respondendo).

**Stack:** Vite + JS puro (o front da prévia aprovada), Supabase (Postgres, RLS, RPC, Realtime e Auth) e Vercel.

**Documentação:**

- [`docs/PLANO.md`](docs/PLANO.md): plano em microtarefas e roteiro da reunião (Bloco B).
- [`docs/PLANO-FASE-2.md`](docs/PLANO-FASE-2.md): plano de 12/10: fechar as telas do cliente, site imersivo, painel, bateria no Windows e go-live, com modelo de IA por tarefa.
- [`docs/PLANO-FASE-3.md`](docs/PLANO-FASE-3.md): plano atual (17/10): horário automático, motoboy, comanda com logo e QR e domínio.
- [`docs/CONTRATO-API.md`](docs/CONTRATO-API.md): contrato banco ⇄ front.
- [`docs/CONTRATO-PAINEL.md`](docs/CONTRATO-PAINEL.md): contrato do painel.
- [`docs/ENTREGA-CONFIAVEL.md`](docs/ENTREGA-CONFIAVEL.md): diagnóstico das taxas ausentes e proposta de cotação validada no servidor, fontes alternativas e confirmação da localização.
- [`docs/PREVIA-DECISOES.md`](docs/PREVIA-DECISOES.md): respostas do cliente e decisões da prévia.

## Colocar no ar

1. **Banco.** No Supabase, abra o SQL Editor, cole `supabase/setup.sql` e clique em Run.
   - O script pode ser rodado de novo a cada versão.
   - Crie o usuário do dono em Authentication → Users e rode, com o e-mail dele, o `insert into equipe …` comentado no fim do arquivo.
   - Desligue o cadastro aberto (Authentication → Sign In / Providers).
   - Entregador: crie o usuário em Authentication → Users → Add user (com Auto Confirm) e rode, com o e-mail dele, o `insert into public.motoboys …` comentado no fim do arquivo. Nunca ponha o entregador na `equipe` (daria o painel inteiro).
   - Mudou o horário no `CONFIG`? O banco manda: o `setup.sql` regrava `loja.horarios`; confira também se `loja.modo` está em `auto`.
2. **Vercel.** Importe o repositório. O `vercel.json` já define o build (`npm run build`, saída em `dist`), a CSP, o cache e os redirecionamentos. A URL e a chave **publishable** do Supabase estão em `.env.production`; ela é pública, e quem protege os dados é o RLS.
3. **Domínio e QR.** Com o domínio final:
   - troque `VITE_SITE_URL` em `.env.production`;
   - troque a URL em `public/robots.txt` e em `public/sitemap.xml`;
   - rode `npm run qrcode -- --base https://dominio`;
   - só depois imprima o cartaz.

**Banco de produção conferido em 18/10/2026:** horário solicitado pelo dono aplicado (quarta fechada), Hot Dog CBO Turbo a R$ 34,90 e Gran Bacon Onion avulso/combo com 2 onion rings. Foram atualizados somente esses campos, preservando os pedidos anteriores e o modo manual `aberta` selecionado no painel. Para o horário reger a abertura/fechamento, a equipe deve selecionar **Automático** no painel.

## Desenvolver e testar

O checkout começa pelo telefone e recupera nome e endereços já salvos **neste navegador**. O cliente pode escolher um endereço anterior ou adicionar outro; cada pedido aceito guarda o endereço usado sem apagar os demais. O rascunho anterior é aproveitado na atualização. A taxa é calculada novamente para cada endereço escolhido. Dados de outro telefone não são reaproveitados no formulário.

O histórico fica na chave local `mineiro:v2:cadastros`. Ele não consulta a tabela privada `clientes` por telefone. Recuperar o cadastro em outro aparelho exige confirmar a posse do telefone antes de liberar nomes e endereços; essa integração não faz parte do histórico local.

O cálculo da entrega tenta a rua e a cidade sem o bairro quando o ViaCEP e o mapa usam nomes diferentes (caso do CEP 08555-120). O formulário conserva o número preenchido antes da resposta do CEP, invalida a taxa ao trocar de endereço e aguarda CEP/rota antes de enviar. Em falhas temporárias da rota, o cliente pode tocar em **Recalcular entrega**.

A busca também retira o número e o complemento quando o endereço foi escrito sem vírgula antes do número (por exemplo, `Rua Exemplo 53, Casa`), preservando o endereço completo no pedido. A conferência de 18/10 no Supabase confirmou que os pedidos 0045, 0047, 0050 e 0051 chegaram sem distância e sem taxa. As buscas dos endereços dos pedidos 0045, 0047 e 0051 ficaram vazias; a análise posterior encontrou vias com grafia divergente por meio de uma segunda base de coordenadas de CEP. No 0050, o complemento impedia a tentativa só pela rua (corrigido em `405ed13`). A [análise de confiabilidade](docs/ENTREGA-CONFIAVEL.md) distingue falha temporária, divergência de nome e precisão insuficiente e propõe a arquitetura de recuperação. Não foram alterados os valores dos pedidos históricos.

Desde 18/10, falhas temporárias de rede, prazo, HTTP 429 e 5xx têm uma nova tentativa automática. Consultas antigas são canceladas ao trocar o endereço, o mapa recebe uma consulta por vez com intervalo mínimo de 1,1 s e a rota pode responder em até 15 s por tentativa. **Recalcular entrega** também refaz uma consulta de CEP que falhou. Se ainda faltar taxa, a regra atual permite o pedido, mas o painel e a comanda destacam **Taxa de entrega pendente — não incluída no total**. O sistema não inventa uma taxa para esses pedidos.

```bash
npm ci
npx playwright install chromium webkit # navegadores dos testes; WebKit cobre a ficha no iPhone
source scripts/supabase-local/ambiente-windows.sh   # só no Windows (Git Bash): PATH do Postgres 17 e do PostgREST
npm run db:local                 # Supabase local de teste: Postgres :54322, PostgREST :54323, API :54321 (sem Realtime)
psql postgresql://postgres@localhost:54322/postgres -f supabase/setup.sql
npm run dev                      # http://localhost:5173 (usa o Supabase local; login do painel: equipe@teste.local)

npm run lint && npm run build
bash scripts/testar-sql.sh --do-zero   # testes do banco
node scripts/testar-paridade.mjs       # preço e resumo do servidor = core.js
node --test tests/qrcode.test.mjs      # leitura dos QR
npx playwright test                    # imagens, navegação, cardápio, CSP/headers e E2E com dois aparelhos
```

O projeto de testes `iphone` usa WebKit e verifica a abertura da ficha pelo nome e pela foto, a rolagem dos opcionais e a personalização salva na sacola. Em Linux, as dependências dos navegadores podem ser instaladas com `npx playwright install-deps chromium webkit`.

- **Mudou preço ou item no `CONFIG` (`src/core.js`)?** Rode `npm run seed && npm run setup-sql` e aplique o `setup.sql` de novo no Supabase.
- **Origem do código:** a prévia aprovada foi a `icecompany-19/gasplab-previews`, pasta `mineiro-lanche/`, commit `a7aee46`. Ela foi importada no commit `f7ff674` e removida depois da migração; continua no histórico do git.
