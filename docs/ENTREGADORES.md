# Controle de entregadores

Implementado em 18–19/10/2026. Painel da equipe em `/painel/` → **Entregadores**; celular em `/motoboy/`.

## Operação

1. Um administrador cadastra o perfil Motoboy em **Usuários**. Motoboys continuam fora da tabela `equipe`.
2. A equipe aceita o pedido. **Saiu para entrega** abre a aba Entregadores para atribuir o pedido e **Registrar saída**. É possível atribuir vários pedidos ao mesmo motoboy, individualmente, antes da saída.
3. O motoboy abre sua tela conectado e espera o aviso **Pedidos carregados neste aparelho para consulta sem internet**. A primeira preparação requer conexão; login inicial offline não é permitido.
4. Na entrega, lê o QR da comanda ou toca em **Entregue**. O evento é gravado no IndexedDB antes do envio, com identificador único, versão da atribuição e horário do celular.
5. Se não houver reconhecimento do servidor, aparece **confirmação aguardando envio**. O pedido continua **Em entrega** no painel. Com a tela aberta, há novas tentativas com intervalo progressivo (até um minuto), ao retomar a tela, recuperar a conexão e em **Sincronizar agora**.
6. No retorno, o motoboy abre a tela conectado e confere **Tudo sincronizado**. A equipe atualiza as pendências do painel. Uma fila que ainda está só no aparelho não pode ser contada pelo painel.

Não depender de execução com o navegador fechado. O service worker guarda apenas a página e arquivos estáticos do motoboy; respostas de Auth e da API nunca são guardadas no Cache Storage. Pedidos e fila ficam no IndexedDB separados por usuário. Sair não apaga confirmações pendentes; é preciso entrar novamente na mesma conta para enviá-las. O login do painel permanece separado.

## Equipe, exceções e indicadores

- Pedidos atribuídos, saída, tempo em andamento, concluídos por período, média e última comunicação ficam na aba Entregadores, inclusive no celular.
- Períodos: hoje, 7 ou 30 dias, com o dia operacional de São Paulo virando às 4h. Entregas abertas de qualquer data permanecem visíveis.
- O limite de alerta é configurável por aparelho (inicial: 45 minutos). É um parâmetro de acompanhamento interno, não um prazo prometido ao cliente. O texto diz **Entrega aberta há muito tempo**: ela pode já ter sido concluída offline.
- Última comunicação é o horário recebido pelo servidor enquanto a tela conversa com ele. Não indica localização, disponibilidade nem atividade contínua.
- A quantidade concluída conta cada pedido uma vez no período de recebimento pelo servidor, incluindo baixas manuais. Cancelados ficam fora.
- A média considera somente encerramentos pelo motoboy com saída e horário do aparelho consistentes. Baixas manuais ficam fora. Horário anterior à saída ou mais de cinco minutos no futuro é sinalizado e excluído. O relógio do aparelho pode afetar a medida.
- A atribuição pode mudar antes da saída; sua versão muda junto. Após a saída não há reatribuição silenciosa, porque o celular pode ter uma confirmação ainda offline.
- **Baixa manual** exige motivo e registra o responsável do usuário autenticado no servidor. Funciona também para pedidos antigos sem atribuição. O quadro não conclui entregas sem esse procedimento.
- A sincronização posterior à baixa manual recebe reconhecimento, sem alterar responsável, motivo, horários, status ou histórico do encerramento. A ocorrência posterior fica auditada.
- Cancelamento, versão alterada, falta de autorização e sessão expirada ficam destacados na fila. Falhas de regra não entram em repetição automática infinita. Sessão expirada exige novo login na mesma conta e nova sincronização.
- Se um pedido tiver sido cancelado enquanto a confirmação estava offline, o motoboy confere com a equipe e usa **Conferi o cancelamento com a equipe**. Essa ação só libera a pendência após registrar a ocorrência no servidor e mantém o pedido cancelado.
- O botão **Histórico** apresenta atribuições, saídas/encerramentos e confirmações posteriores, com responsáveis e motivos registrados. Nenhuma informação da auditoria é exposta ao motoboy por acesso direto às tabelas.

## Implantação

Publicado em produção em 19/10/2026. A versão da migration no repositório corresponde à registrada no Supabase.

Aplicar **somente** a migration `supabase/migrations/20261019024838_controle_entregadores.sql` no banco existente antes do front. Não reaplicar o setup completo em produção: ele inclui o seed e poderia regravar configurações do cardápio. O `supabase/setup.sql` regenerado serve para instalações novas e testes de idempotência.

A migration cria tabelas privadas com RLS e RPCs autorizadas; não modifica pedidos históricos nem atribui pedidos automaticamente. Pedidos antigos em andamento aparecem como sem atribuição para a equipe resolver. As RPCs antigas ficam restritas às próprias atribuições do motoboy, fechando a listagem geral anterior. No primeiro uso após a atualização, a equipe precisa atribuir os pedidos antes da confirmação pelo celular.

Publicar o front pela branch de produção da Vercel. O build emite `/motoboy/sw.js` com uma versão dos arquivos. A preparação só é anunciada após persistir os pedidos e existir um service worker controlando a página.

## Limites

Apagar dados do navegador, desinstalar com limpeza dos dados ou perder o aparelho pode apagar confirmações ainda não recebidas pelo servidor. Armazenamento cheio/indisponível impede confirmar localmente e precisa ser corrigido; não há sucesso simulado em memória. A conferência de retorno continua obrigatória.

## Validação

Testes SQL cobrem permissões, isolamento, versões de atribuição, saída, reenvio idempotente, baixa manual, auditoria, cancelamento e relógio inconsistente. `tests/fila-entregas.test.mjs` cobre preservação e retomada da fila, falhas e reconhecimento. `tests/entregadores.spec.js` exercita o fluxo real do banco e do navegador em celular e desktop, incluindo fechar/reabrir offline e envio posterior à baixa manual. `tests/motoboy.spec.js` preserva os testes de login, QR, câmera, CSP e acessibilidade de toque.

Verificação final: 497 asserções SQL, 330 verificações de paridade e 125 testes unitários passaram. A matriz direcionada de navegador passou em 107 cenários (3 não aplicáveis), incluindo entregadores, motoboy, usuários, sons e configuração de publicação em celular/desktop. Os três fluxos completos de entrega também passaram. Build de produção e lint aprovados. WebKit/iPhone não foi executado neste ambiente.
