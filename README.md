# Mineiro Lanche

Bio, cardápio, site e painel de pedidos do food truck Mineiro Lanche (Centro de Suzano).

| Onde | O quê |
|---|---|
| `/` | Bio (link do Instagram) → cardápio (`#cardapio`) → site (`#site`) → acompanhar pedido (`#pedido/<token>`) |
| `/q` e `/q/<mesa>` | Destino do QR code: redireciona para o cardápio e marca a origem (e a mesa) |
| `/painel/` | Painel de pedidos da equipe (login do Supabase) |
| `/qr/cartaz.html` | Cartaz para imprimir (A6; `?tamanho=a5`), com os PDFs ao lado |

**Stack:** Vite + JS puro (o front da prévia aprovada), Supabase (Postgres, RLS, RPC, Realtime e Auth) e Vercel.

**Documentação:**

- [`docs/PLANO.md`](docs/PLANO.md): plano em microtarefas e roteiro da reunião (Bloco B).
- [`docs/PLANO-FASE-2.md`](docs/PLANO-FASE-2.md): plano atual (12/10): fechar as telas do cliente, site imersivo, painel, bateria no Windows e go-live, com modelo de IA por tarefa.
- [`docs/CONTRATO-API.md`](docs/CONTRATO-API.md): contrato banco ⇄ front.
- [`docs/CONTRATO-PAINEL.md`](docs/CONTRATO-PAINEL.md): contrato do painel.
- [`docs/PREVIA-DECISOES.md`](docs/PREVIA-DECISOES.md): respostas do cliente e decisões da prévia.

## Colocar no ar

1. **Banco.** No Supabase, abra o SQL Editor, cole `supabase/setup.sql` e clique em Run.
   - O script pode ser rodado de novo a cada versão.
   - Crie o usuário do dono em Authentication → Users e rode, com o e-mail dele, o `insert into equipe …` comentado no fim do arquivo.
   - Desligue o cadastro aberto (Authentication → Sign In / Providers).
2. **Vercel.** Importe o repositório. O `vercel.json` já define o build (`npm run build`, saída em `dist`), a CSP, o cache e os redirecionamentos. A URL e a chave **publishable** do Supabase estão em `.env.production`; ela é pública, e quem protege os dados é o RLS.
3. **Domínio e QR.** Com o domínio final:
   - troque `VITE_SITE_URL` em `.env.production`;
   - troque a URL em `public/robots.txt` e em `public/sitemap.xml`;
   - rode `npm run qrcode -- --base https://dominio`;
   - só depois imprima o cartaz.

## Desenvolver e testar

O checkout começa pelo telefone e recupera nome e endereços já salvos **neste navegador**. O cliente pode escolher um endereço anterior ou adicionar outro; cada pedido aceito guarda o endereço usado sem apagar os demais. O rascunho anterior é aproveitado na atualização. A taxa é calculada novamente para cada endereço escolhido. Dados de outro telefone não são reaproveitados no formulário.

O histórico fica na chave local `mineiro:v2:cadastros`. Ele não consulta a tabela privada `clientes` por telefone. Recuperar o cadastro em outro aparelho exige confirmar a posse do telefone antes de liberar nomes e endereços; essa integração não faz parte do histórico local.

O cálculo da entrega tenta a rua e a cidade sem o bairro quando o ViaCEP e o mapa usam nomes diferentes (caso do CEP 08555-120). O formulário conserva o número preenchido antes da resposta do CEP, invalida a taxa ao trocar de endereço e aguarda CEP/rota antes de enviar. Em falhas temporárias da rota, o cliente pode tocar em **Recalcular entrega**.

```bash
npm ci
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

- **Mudou preço ou item no `CONFIG` (`src/core.js`)?** Rode `npm run seed && npm run setup-sql` e aplique o `setup.sql` de novo no Supabase.
- **Origem do código:** a prévia aprovada foi a `icecompany-19/gasplab-previews`, pasta `mineiro-lanche/`, commit `a7aee46`. Ela foi importada no commit `f7ff674` e removida depois da migração; continua no histórico do git.
