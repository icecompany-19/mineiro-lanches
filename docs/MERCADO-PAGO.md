# Pagamentos com Mercado Pago

Branch `feat/mercado-pago`, separada da branch produtiva `claude/modest-galileo-t43m7f`. A implementação usa **Checkout Pro via Orders API**, conforme a documentação oficial consultada em 18/10/2026. Nenhuma cobrança, migração ou mudança de flag desta branch foi aplicada à produção.

## Ambiente de homologação preparado (19/10)

Branch Supabase `mercado-pago-homologacao`, projeto `hkfoetwnphbauezftfgq`, criado sem dados de produção. Foram aplicadas as migrations faltantes e o seed do cardápio; `mercado-pago` e `mercado-pago-webhook` estão publicados. Há zero pedidos, 56 produtos e `pagamentos_ativos=false`. Verificados RLS e ausência de permissões públicas nas tabelas/helpers financeiros. O webhook sem configuração retorna 503 `pagamento_nao_configurado`, sem executar cobrança.

- [Cadastrar secrets de TESTE](https://supabase.com/dashboard/project/hkfoetwnphbauezftfgq/functions/secrets).
- Webhook de TESTE: `https://hkfoetwnphbauezftfgq.supabase.co/functions/v1/mercado-pago-webhook`.
- Cadastre Access Token, assinatura do webhook, ID do vendedor e ID da aplicação de teste com os nomes da tabela abaixo; `MERCADO_PAGO_MODE=test`. `MERCADO_PAGO_SITE_URL` será a origem HTTPS estável do preview, ainda a configurar.
- Falta configurar Vercel Preview com as variáveis públicas desse Supabase, limitadas à branch `feat/mercado-pago`, e redeployar. A CSP desta branch permite exclusivamente os hosts Supabase da loja e desta homologação, incluindo Realtime; as demais diretivas são preservadas.
- Depois dos secrets e preview, validar identidade da conta, configurar reconciliação e executar a matriz de homologação antes de ativar a produção.

Não mesclar esta branch **do Supabase** na loja: a publicação produtiva será controlada pela PR do GitHub e pelas migrations necessárias, sem copiar seed/configuração de teste. A branch é temporária e tem consumo de infraestrutura; removê-la após a homologação, preservando os registros necessários dos testes.

O advisor registra as [tabelas privadas com RLS sem policies públicas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e os [RPCs públicos existentes com SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). O bloqueio das tabelas financeiras é intencional; helpers financeiros novos usam SECURITY INVOKER e execução exclusiva de service_role.

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

A fila de confirmações offline e os indicadores individuais do motoboy são outra evolução, ainda não implementada por esta branch.

## Conectar a conta do cliente

**Não enviar senha, Access Token, segredo de webhook ou chave service_role no chat ou em commits.** O responsável entra na própria conta e cadastra os segredos nas interfaces do backend. O arquivo `.env.mercadopago.example` contém somente nomes, sem valores.

1. Acesse [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) com a conta do cliente. Crie ou selecione uma aplicação brasileira com Checkout Pro via Orders API.
2. Separe ambiente de teste e produção: aplicação/conta de teste, comprador de teste diferente do vendedor e credenciais correspondentes. Registre o ID do vendedor e da aplicação; o backend exige que correspondam à resposta do Mercado Pago.
3. Use um projeto Supabase de homologação, aplicando migrations/seed e criando somente a equipe necessária. **Não aplicar `setup.sql` ao banco produtivo existente**: ele contém seed de preços/configurações. Para a futura produção, aplicar somente a nova migration, depois da homologação e do merge.
4. Configure Vercel Preview desta branch com URL e chave pública anon JWT legada do Supabase de homologação. Esta aplicação mantém `verify_jwt=true` nas funções de cliente; não passar uma `sb_publishable_...` como Bearer JWT. A URL configurada em `MERCADO_PAGO_SITE_URL` precisa ser essa origem HTTPS estável, sem caminho, query ou hash. Nunca apontar um preview com pagamento habilitado para a loja produtiva.
5. Em Supabase > Edge Functions > Secrets, cadastre:

| Secret | Valor |
| --- | --- |
| `MERCADO_PAGO_ACCESS_TOKEN` | Access Token da aplicação/conta escolhida |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Assinatura secreta gerada na configuração de Webhooks |
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
