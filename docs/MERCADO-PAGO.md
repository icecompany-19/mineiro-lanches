# Pagamentos com Mercado Pago

Integração desenvolvida em `feat/mercado-pago` e publicada pela PR #1 na branch produtiva `claude/modest-galileo-t43m7f`. Usa **Checkout Pro via Orders API**, conforme a documentação oficial consultada em 18/10/2026. O histórico de homologação abaixo precede a publicação produtiva descrita nesta seção.

## Publicação produtiva — 20/10

O Access Token produtivo cadastrado pelo responsável foi aceito em `GET /users/me`: conta brasileira, ID `256378111`, sem marca de conta de teste. O token não foi exportado, registrado em commit ou devolvido ao cliente. O backend espera a aplicação `5499483276102597`, a mesma da integração validada em homologação, e confere esse ID em cada resposta de order antes de persistir o pagamento ou expor o checkout.

- Aplicadas somente as migrations de pagamentos e de privilégios mínimos ao projeto produtivo; não houve seed, alteração de preços/horários ou reclassificação do histórico.
- Publicadas `mercado-pago` (JWT obrigatório) e `mercado-pago-webhook` (assinatura obrigatória; permanece fechado enquanto não houver segredo).
- Identificadores públicos, ambiente `production` e retorno `https://mineirolanches.store` são padrões restritos à URL exata do projeto produtivo em `_shared/mercado-pago-env.js`. Secrets explícitos podem substituí-los; não há padrão de Access Token, service_role ou segredo de webhook. Outros projetos não herdam dados produtivos.
- O frontend usa `VITE_SUPABASE_FUNCTIONS_ANON_KEY` para o Bearer JWT público do gateway de pagamentos, preservando o publishable nas chamadas anteriores. Preview substitui ambos pelos valores de homologação. Nenhuma chave privilegiada vai ao bundle.
- Reconciliação instalada a cada minuto com segredos no Vault do próprio projeto. Chamada de manutenção validada com HTTP 200 e zero falhas. O provisionamento temporário foi encerrado.

Validação: conta produtiva e chamada do frontend ao backend conferidas, sem criar cobranças reais. Lint, build e 19 testes de configuração/pagamentos aprovados; a integração anterior passou em 610 verificações SQL, 160 testes Node e 21 cenários desktop/iPhone, incluindo impressão após aprovação.

A aprovação de uma compra no checkout hospedado ainda não foi executada nesta sessão. Conferir o primeiro pagamento real no Mercado Pago e no acompanhamento/painel; nunca marcar manualmente como aprovado para concluir essa conferência. Sem webhook, a recuperação com navegador fechado é periódica e pode levar cerca de um minuto. Monitorar `net._http_response` e não apenas o sucesso SQL do cron. A ativação vale somente para novos pedidos; históricos continuam com a forma anterior.

## Ambiente de homologação preparado (19/10)

Branch Supabase `mercado-pago-homologacao`, projeto `hkfoetwnphbauezftfgq`, criado sem dados de produção. Foram aplicadas as migrations faltantes e o seed do cardápio; `mercado-pago` e `mercado-pago-webhook` estão publicados. Há zero pedidos, 56 produtos e `pagamentos_ativos=false`. Verificados RLS e ausência de permissões públicas nas tabelas/helpers financeiros. O webhook sem configuração retorna 503 `pagamento_nao_configurado`, sem executar cobrança.

- [Cadastrar secrets de TESTE](https://supabase.com/dashboard/project/hkfoetwnphbauezftfgq/functions/secrets).
- Webhook de TESTE: `https://hkfoetwnphbauezftfgq.supabase.co/functions/v1/mercado-pago-webhook`.
- Cadastre Access Token, assinatura do webhook, ID do vendedor e ID da aplicação de teste com os nomes da tabela abaixo; `MERCADO_PAGO_MODE=test`. `MERCADO_PAGO_SITE_URL` será a origem HTTPS estável do preview, ainda a configurar.
- O build Vercel Preview da branch `feat/mercado-pago` usa automaticamente a configuração pública desse Supabase, via `scripts/build.mjs` e `config/mercado-pago-homologacao.json`. Usa `VERCEL_BRANCH_URL` para o endereço de retorno e interrompe o build se essa URL estiver ausente/inválida. Produção e builds locais preservam suas variáveis. A CSP desta branch permite exclusivamente os hosts Supabase da loja e desta homologação, incluindo Realtime; as demais diretivas são preservadas.
- Depois dos secrets e preview, validar identidade da conta, configurar reconciliação e executar a matriz de homologação antes de ativar a produção.

Não mesclar esta branch **do Supabase** na loja: a publicação produtiva será controlada pela PR do GitHub e pelas migrations necessárias, sem copiar seed/configuração de teste. A branch é temporária e tem consumo de infraestrutura; removê-la após a homologação, preservando os registros necessários dos testes.

O advisor registra as [tabelas privadas com RLS sem policies públicas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e os [RPCs públicos existentes com SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). O bloqueio das tabelas financeiras é intencional; helpers financeiros novos usam SECURITY INVOKER e execução exclusiva de service_role.

## Avançar com as credenciais, sem login na conta (20/10)

O Access Token cadastrado foi validado pelo backend em `GET /users/me`: conta brasileira de teste e ID do vendedor correspondente ao configurado. Não houve criação de cobrança nem divulgação do token. O diagnóstico temporário foi encerrado e substituído por resposta 410. Foram detectados `MERCADO_PAGO_MODE=teste` (corrigir para `test`) e ausência da URL de retorno e do segredo de webhook.

- Cadastrar `MERCADO_PAGO_SITE_URL=https://mineiro-lanches-git-feat-mercado-pago-ice-company19.vercel.app` no Supabase de homologação.
- O Access Token permite chamadas autenticadas à API sem login interativo do dono. A Public Key não substitui o Access Token. O ID da aplicação cadastrado ainda precisa ser conferido na criação/consulta de uma order real de teste.
- Criação, consulta, reconciliação e estorno não exigem o segredo de webhook: cada atualização financeira é obtida da API autenticada e validada. Sem esse segredo, o endpoint de webhook permanece indisponível e nunca aceita notificações sem autenticação.
- A consulta do acompanhamento depende do navegador aberto. Para atualizar pedidos com o comprador desconectado, configurar e verificar a reconciliação agendada no backend; ela NÃO é ativada automaticamente apenas por instalar a migration.
- A assinatura de webhook é um segredo diferente do Access Token. Não pode ser inventada nem deduzida dele. Para habilitar notificações, o dono precisa configurar a aplicação e disponibilizar esse segredo ou conceder acesso adequado ao desenvolvedor. As instruções oficiais estão em [notificações de Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications).
- Consulta periódica é uma alternativa à ausência de notificações, com latência e consumo de API. O Mercado Pago recomenda Webhooks; concluir sua configuração antes de considerar a integração totalmente homologada em produção.

A validação local sem webhook pode usar `node --env-file=.env.mercadopago.local scripts/verificar-mercado-pago.mjs --conexao --sem-webhook`; ela não certifica a rotina agendada. A flag de pagamentos continua desligada até validar as configurações e o fluxo de teste. Apenas a homologação recebeu estas funções; nenhuma chave produtiva foi utilizada.

Validação de 20/10: lint, build normal, build simulando Vercel Preview e 18 testes unitários aprovados. O bundle de preview contém o host de homologação e não contém o host produtivo. Vercel confirmou deploy `efa9bb7` com sucesso. O endereço de preview está protegido por login da Vercel; a visita anônima redireciona para `vercel.com`, portanto a compra no navegador ainda não foi homologada.

### Conexão efetiva e consulta agendada (20/10)

Modo `test` e URL de retorno corrigidos e verificados. Foi criado pelo fluxo real do backend o pedido de homologação 0001, X-Burguer de R$ 16,90, e a Orders API retornou a order `ORDTST01M5CWY92ZFYD09JN0XGN83CJW` com checkout HTTPS válido. Conta, aplicação, total e ambiente foram conferidos pelo adaptador; a consulta subsequente retornou HTTP 200 e preservou a mesma URL de pagamento. Pedido permanece `novo` com pagamento `pendente`, sem aprovação artificial.

A execução revelou falta de SELECT/UPDATE para service_role no Supabase remoto: BYPASSRLS não concede os privilégios SQL. A migration `20261020145407_pagamentos_permissoes_backend.sql` concede somente as leituras necessárias e UPDATE nas duas colunas financeiras; não amplia acesso público nem edição do status operacional. O teste 11 remove os privilégios implícitos do stub, reaplica a migration e confirma reserva e registro financeiro; bateria SQL: 599 verificações aprovadas.

`mineiro-mp-reconciliar` está ativo a cada minuto na homologação. Os dois segredos foram gravados no Vault dentro do próprio backend, sem retornar credenciais ao navegador ou à sessão. Consulta direta ao reconciliador retornou 200; a chamada agendada também retornou 200, processou uma order e registrou zero falhas. O provisionamento temporário foi encerrado com resposta 410. A flag está ligada somente na homologação, com um pedido de teste; produção permanece sem pagamentos online.

Pendências para concluir a homologação: entrar no checkout com uma conta de comprador de teste e confirmar aprovação/recusa; abrir o preview ao testador na configuração de proteção da Vercel. Não foi realizada compra aprovada ou cobrança real. Credenciais produtivas ainda precisam ser cadastradas no ambiente da loja e verificadas antes da publicação produtiva. Webhook permanece fechado por ausência de assinatura; a rotina de consulta já opera independentemente do navegador.

Após incorporar a produção até `c259bbc`, a bateria passou com 610 verificações SQL, 160 testes Node e 21 cenários de navegador (17 desktop, incluindo impressão automática, e quatro WebKit/iPhone). Inclui a regressão que impede impressão automática de pedido online pendente e imprime uma única vez depois da aprovação financeira. Vercel confirmou a publicação da branch integrada `9c3b795`.

## Comportamento

1. `loja.pagamentos_ativos=false` mantém o fluxo anterior. Pedidos históricos continuam sem obrigação de pagamento online.
2. Ativa, todo pedido real novo nasce com `pagamento_online=pendente`, mesmo que o navegador envie `Dinheiro`, `aprovado` ou omita campos. Uma entrega sem taxa conhecida é recusada.
3. O cliente informa e-mail, o pedido é salvo com total e taxa recalculados no banco e abre o Checkout Pro do Mercado Pago. A sacola vira um pedido pendente recuperável pelo acompanhamento. Cartão, documento e Pix são tratados no Mercado Pago, não na loja. Os meios disponíveis dependem da conta; boleto/ATM são excluídos e o parcelamento é limitado a uma parcela.
4. O botão para pagar permanece no acompanhamento se houver falha ao abrir. Repetir a criação usa o mesmo UUID e o mesmo payload, com reserva de 30 segundos no banco; um timeout não cria outra cobrança.
5. A criação usa `POST https://api.mercadopago.com/v1/orders`, `type=online`, `processing_mode=manual`, `X-Idempotency-Key` persistente e validade `PT30M`. A referência é o UUID privado do pagamento. A URL de retorno usa `#pedido/<token>` e nunca é prova de aprovação.
6. O webhook exige HMAC-SHA256 com `data.id` da URL em minúsculas, `x-request-id` e `ts`. O corpo não decide valores ou aprovação: o servidor busca a order novamente na API. Confere vendedor, aplicação, ambiente, BRL, tipo, modo, referência, total e total efetivamente pago. Autorização sem captura continua pendente.
7. Só uma aprovação confirmada libera preparo e entrega. A proteção é um gatilho no banco; vale para equipe, arraste no quadro e RPC do motoboy. Mudança financeira atualiza painel por Realtime/consulta e aparece na comanda e no acompanhamento.
8. Recusado, expirado, estornado, parcialmente estornado, contestado e estado desconhecido ficam visíveis e bloqueiam avanço. Uma order encerrada não é recriada silenciosamente: não apagar o vínculo para tentar cobrar de novo. Uma nova compra precisa de outro pedido; uma order ainda aberta pode ser retomada pelo link. Isto evita cobranças concorrentes do mesmo pedido.
9. Cancelar um pedido não estorna automaticamente. Uma aprovação tardia mantém o pedido cancelado, com alerta. No histórico/detalhe, **Estornar no Mercado Pago** solicita devolução integral, exige confirmação e perfil administrador, registra o autor e usa outra chave de idempotência estável. O estado só muda quando confirmado pelo provedor. Reembolso parcial é reconhecido, mas deve ser solicitado no painel Mercado Pago. Taxas, liquidação e repasses são conciliados nos relatórios do Mercado Pago; o relatório operacional da loja não substitui um extrato financeiro.

A fila de confirmações offline, os indicadores individuais do motoboy, as viagens e a impressão automática vieram das atualizações produtivas incorporadas em 20/10 (até `c259bbc`). A impressão automática filtra pedidos online ainda não aprovados e observa a aprovação financeira do mesmo pedido para imprimi-lo uma única vez; impressão manual mantém o estado financeiro visível na comanda.

## Conectar a conta do cliente

**Não enviar senha, Access Token, segredo de webhook ou chave service_role no chat ou em commits.** O responsável entra na própria conta e cadastra os segredos nas interfaces do backend. O arquivo `.env.mercadopago.example` contém somente nomes, sem valores.

1. Acesse [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) com a conta do cliente. Crie ou selecione uma aplicação brasileira com Checkout Pro via Orders API.
2. Separe ambiente de teste e produção: aplicação/conta de teste, comprador de teste diferente do vendedor e credenciais correspondentes. Registre o ID do vendedor e da aplicação; o backend exige que correspondam à resposta do Mercado Pago.
3. Use um projeto Supabase de homologação, aplicando migrations/seed e criando somente a equipe necessária. **Não aplicar `setup.sql` ao banco produtivo existente**: ele contém seed de preços/configurações. Para a futura produção, aplicar somente a nova migration, depois da homologação e do merge.
4. Confirme no build que Vercel informa `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=feat/mercado-pago` e `VERCEL_BRANCH_URL`. O script seleciona URL e chave pública anon JWT legada do Supabase de homologação automaticamente. Esta aplicação mantém `verify_jwt=true` nas funções de cliente; não passar uma `sb_publishable_...` como Bearer JWT. A URL configurada em `MERCADO_PAGO_SITE_URL` precisa ser essa origem HTTPS estável, sem caminho, query ou hash. Nunca apontar um preview com pagamento habilitado para a loja produtiva.
5. Em Supabase > Edge Functions > Secrets, cadastre:

| Secret | Valor |
| --- | --- |
| `MERCADO_PAGO_ACCESS_TOKEN` | Access Token da aplicação/conta escolhida |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Assinatura secreta gerada na configuração de Webhooks; obrigatória para receber notificações, dispensável nas chamadas de criação/consulta |
| `MERCADO_PAGO_ACCOUNT_ID` | ID do vendedor, conferido em `/users/me` |
| `MERCADO_PAGO_APPLICATION_ID` | ID da aplicação, conferido também em cada order |
| `MERCADO_PAGO_MODE` | `test` ou `production` |
| `MERCADO_PAGO_SITE_URL` | Origem HTTPS do frontend desse ambiente |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo runtime das funções. Nenhum desses secrets recebe prefixo `VITE_`. Não mover valores para `public`, `.mcp.json` ou `vercel.json`.

6. Publique `mercado-pago` com verificação JWT e `mercado-pago-webhook` sem JWT do Supabase, conforme `supabase/config.toml`. Só o webhook recebe essa exceção, pois exige a assinatura própria do Mercado Pago.

```bash
npx supabase functions deploy mercado-pago --project-ref REF_HOMOLOGACAO
npx supabase functions deploy mercado-pago-webhook --project-ref REF_HOMOLOGACAO
```

7. Em Mercado Pago > aplicação > Webhooks, configure a URL de teste `https://REF_HOMOLOGACAO.supabase.co/functions/v1/mercado-pago-webhook`, evento **Order (Mercado Pago)** (`order`/`orders_v2`, conforme o formulário). Copie a assinatura secreta gerada para o secret correspondente. IPN e notificações antigas `merchant_order` não são o contrato desta integração.
8. Ative a reconciliação de segurança seguindo [reconciliacao.sql](mercado-pago/reconciliacao.sql): duas entradas no Vault do projeto, `pg_cron` + `pg_net`, uma chamada por minuto. Reserva até 12 recursos por execução e distribui tentativas mesmo com falhas; consulta somente recursos já criados. Acompanhar HTTP 2xx em `net._http_response`, não apenas sucesso da execução SQL. Webhook é o mecanismo principal; a conciliação e o acompanhamento do comprador recuperam notificações perdidas.
9. Valide a configuração localmente, sem imprimir credenciais, se o responsável optar pelo arquivo local ignorado:

```bash
NODE_USE_ENV_PROXY=1 node --env-file=.env.mercadopago.local scripts/verificar-mercado-pago.mjs --conexao
```

Esse comando só consulta a identidade do vendedor; não cria cobranças e não certifica o segredo de webhook. A função recusa operações se a configuração obrigatória estiver incompleta.

10. **Somente no banco de homologação**, ligue `update public.loja set pagamentos_ativos=true where id=1`. Execute a matriz abaixo. Antes de ativar na produção, confirme a conta real, Pix disponível, política de reembolso, aplicação/URLs/segredos produtivos, deploy da branch aprovada e rotina de reconciliação funcionando. Credenciais sandbox não devem ser usadas na produção.

## MCP oficial

Servidor oficial: **`https://mcp.mercadopago.com/mcp`**. A conexão usa autorização no navegador do Mercado Pago; selecionar Brasil e a conta/aplicação do cliente. A autenticação do MCP permite às ferramentas ajudar a configurar a integração; **não entrega automaticamente ao site as credenciais de cobrança**.

- `.mcp.json` está preparado para clientes compatíveis com essa configuração, como Claude Code.
- Para Codex, adicionar o conteúdo de [codex.config.example.toml](mercado-pago/codex.config.example.toml) à configuração local; depois usar a autenticação MCP disponível no cliente. Não commitar tokens OAuth.
- Cursor utiliza a mesma URL em `.cursor/mcp.json` > `mcpServers`; Settings > Tools & MCPs > Connect abre o consentimento.
- Na sessão atual, a busca no diretório de plugins não retornou Mercado Pago, e o servidor ainda **não está autenticado/conectado**. A configuração no repositório não altera automaticamente as ferramentas desta sessão. A tentativa de handshake HTTP sem autenticação neste ambiente respondeu 403; a conexão deve ser concluída pelo fluxo oficial no navegador do cliente, sem concluir que já há acesso à conta.

Após conectar, usar `search-documentation` (pt), `quality_checklist`, `save_webhook` para o ambiente correto e `quality_evaluation` após a primeira transação produtiva autorizada, pois essa avaliação pode exigir um identificador produtivo. Não criar uma cobrança real apenas para avaliar a integração. Conferir as permissões exibidas antes do consentimento. Não configurar o callback produtivo com URL de homologação.

Fontes oficiais:

- [Conexão ao MCP](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-content/mcp-server/connection)
- [Ferramentas MCP](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-content/mcp-server/tools)
- [Criar order](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order)
- [Referência de criação](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/create-order/post)
- [Webhooks e assinatura](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications)
- [Status da order](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/payment-management/status/order-status)
- [Reembolso](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/refund-order/post)

## Homologação obrigatória com a conta conectada

Os testes automatizados usam banco local real e provedor simulado; não substituem esta etapa. Não foi feita compra real nem estorno real.

- Retirada e entrega: total com adicionais/combos e taxa do banco iguais ao Mercado Pago.
- Cartão aprovado, recusado e captura pendente; Pix pendente e aprovado, se habilitado na conta.
- Voltar/fechar checkout, recarregar acompanhamento, clique repetido e timeout após criação: mesma order.
- Retorno adulterado `status=approved` não libera preparo.
- Notificação legítima duplicada e fora de ordem, notificação falsa e conta/aplicação divergente.
- Pagamento aprovado com navegador do cliente fechado; webhook atualiza painel.
- Simular perda do webhook e confirmar recuperação pela rotina agendada.
- Cancelar pendente e pagar depois: não reabrir; alerta para revisão/estorno.
- Admin estorna um pedido cancelado e pago; motoboy/equipe comum são recusados.
- Estorno/contestação feito no Mercado Pago é refletido no site; não apaga histórico.
- iPhone/Chrome: redirecionamento na mesma aba, retorno ao pedido, nenhum SDK inline ou dado de cartão local.

## Reversão

Desligar `loja.pagamentos_ativos` interrompe a exigência para **novos** pedidos. Pedidos online existentes continuam exigindo aprovação; manter funções, webhook e conciliação para terminar pagamentos/estornos pendentes. Não remover as tabelas financeiras, não apagar orders para repetir uma cobrança e não remover o gatilho enquanto houver pendências. Registros financeiros não participam da limpeza periódica de localização.

## Validação da branch (19/10/2026)

PR de rascunho: https://github.com/icecompany-19/mineiro-lanches/pull/1. A correção de comunicação da retirada na loja (`43c81b0`), publicada separadamente em produção, também está incorporada nesta branch.

- Lint e build aprovados.
- Banco local limpo: `setup.sql` aplicado duas vezes; 593 verificações SQL aprovadas, incluindo 30 financeiras.
- Paridade entre JavaScript e banco: 330 verificações aprovadas.
- Node: 130 testes aprovados, sem pulos.
- Pagamentos no navegador: 12 casos aprovados, quatro em cada projeto Android/desktop/WebKit iPhone, cobrindo criação/retorno, erro/repetição, bloqueio do preparo e estorno administrativo. Banco real local e provedor Mercado Pago simulado.
- Fluxo completo existente: 14 casos aprovados, incluindo cliente, painel e motoboy.
- Verificação de acabamento: 14 casos aprovados entre celular e desktop, após corrigir a espera de geometria da sacola. O bloco financeiro foi colocado fora da comanda para preservar sua composição.

A bateria ampliada também revelou a falha intermitente já documentada da animação S5 e uma espera de imagem em modo de movimento reduzido, que passou ao conferir a base. A bateria completa não é declarada integralmente verde. A homologação com a conta Mercado Pago continua pendente; nenhum pagamento/estorno real foi executado e nenhuma migração ou função financeira foi publicada em produção.

## Testes locais em Linux sem root

O iniciador local aceita `MINEIRO_PGBIN`, `MINEIRO_POSTGREST` e `MINEIRO_PGHOME`, preservando os caminhos anteriores como padrão. Escolher uma pasta **exclusiva dos dados de teste** para `MINEIRO_PGHOME`: `--reset` apaga essa pasta. Não colocar os binários nem o repositório nela. Os testes usam Auth local simulado; ele não serve como comprovação da autenticação produtiva do Mercado Pago.
