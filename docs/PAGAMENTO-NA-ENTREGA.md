# Pagamento na entrega ou retirada

O checkout mantém **Pagar online** pelo Mercado Pago e oferece **Pagar na entrega** (ou **Pagar na retirada**, conforme o modo do pedido). O pagamento local dispensa e-mail e redirecionamento. O total e a taxa continuam sendo calculados pelo servidor.

No painel, o pedido fica **A receber na entrega/retirada** e pode seguir para preparo normalmente. O pagamento local só é registrado quando a equipe toca em **Confirmar pagamento recebido** e confirma o valor. Isso não aprova um pagamento no Mercado Pago nem altera a etapa operacional. A confirmação é idempotente e guarda autor e horário no histórico.

Para um pedido online pendente, a equipe pode usar **Receber na entrega**. O backend valida a sessão e a equipe, bloqueia criação simultânea de checkout, consulta a cobrança e exige confirmação do cancelamento no Mercado Pago antes da mudança. Pedidos já pagos, reembolsados ou em contestação não são convertidos. Erros não liberam a mudança; a reserva é liberada para nova tentativa. O vínculo e os eventos financeiros anteriores permanecem no banco. Não há estorno automático.

A comanda e o painel indicam o valor a receber. O motoboy recebe a indicação de cobrança junto do pedido, inclusive no cache do aparelho, e a confirmação da entrega continua separada da confirmação financeira feita pela equipe. Pedidos online pagos são identificados como pagos no Mercado Pago.

Banco: migrations `20261021001305_pagamento_na_entrega.sql` e `20261021001941_sinalizacao_pagamento_entrega_motoboy.sql`. Helpers de conversão são invoker, exclusivos do backend; a RPC de recebimento exige equipe e não permite confirmar pedido cancelado. As colunas herdam o RLS e a proibição de escrita direta do navegador já existentes em pedidos.

Validação: testes SQL de pagamentos online, permissões e pagamento na entrega; 25 testes Node do adaptador, incluindo cancelamento confirmado, pagamento já aprovado e falha do provedor; checkout e controles no Chromium Android/desktop e WebKit iPhone. O pedido real #00104 foi convertido após cancelamento confirmado da cobrança e liberado para preparo por solicitação do responsável; total R$ 61,80, com entrega R$ 12,00, sem registrar recebimento antecipado.
