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

## Central dinâmica (19/10)

O painel abre com quatro indicadores interativos: **Em entrega**, **Aguardando saída**, **Concluídas** e **Precisam de atenção**. Tocar em um indicador filtra a central. Atenção reúne entregas sem atribuição e entregas abertas acima do limite configurado; não afirma que houve atraso físico na entrega.

Os cartões da equipe mostram pedidos em andamento, abertos, concluídos, média e último contato com data/hora. Tocar em um cartão filtra aquele entregador; tocar novamente remove o filtro. **Cadastro ativo** é a autorização do perfil, não presença online nem disponibilidade.

A central combina busca por pedido/cliente, situação, entregador e período. A busca ignora acentos. Os pedidos abertos mais antigos e os alertas vêm primeiro; as conclusões aparecem depois. A lista carrega 12 cartões por vez e oferece **Mostrar mais**. O progresso compara conclusões e entregas abertas desse recorte; cancelamentos não entram no denominador.

Cada pedido tem uma linha de etapas e cronômetro atualizado a cada segundo. O painel consulta o servidor a cada 15 segundos enquanto a aba estiver aberta e visível, e antecipa a consulta ao receber eventos de pedidos pela store. O cronômetro usa a diferença em relação ao horário do servidor. Atualizações não apagam o motivo digitado da baixa manual.

No celular do motoboy, o resumo distingue **em entrega**, **aguardando saída** e **aguardando envio**. Os filtros **Todos**, **Em entrega** e **No aparelho** facilitam conferir o que falta. As confirmações locais continuam visíveis até o reconhecimento do servidor. Consultas sem mudanças mantêm os controles e o foco do teclado; animações respeitam a preferência de movimento reduzido.

### Entregas anteriores

A consulta da equipe inclui também pedidos concluídos antes do controle individual. Eles aparecem no total e no filtro **Anteriores**, com **Histórico anterior** e **Sem vínculo individual de entregador**. O recorte usa o horário de conclusão já gravado no pedido, inclusive quando ele foi criado em outra data. A consulta não altera pedidos nem cria atribuições retroativas.

O sistema anterior não registrava o identificador do usuário em cada conclusão. Esses pedidos não entram nos indicadores individuais nem na média dos entregadores. O histórico original continua preservado. Baixas manuais atuais, que possuem auditoria própria, não são classificadas como histórico anterior.

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

A atualização visual e do histórico usa também `supabase/migrations/20261019032841_historico_entregas_painel.sql`. Em instalações que já receberam o controle operacional, aplicar somente essa atualização da consulta. Ela conserva a autorização exclusiva da equipe e o recorte mínimo de dados.

A migration cria tabelas privadas com RLS e RPCs autorizadas; não modifica pedidos históricos nem atribui pedidos automaticamente. Pedidos antigos em andamento aparecem como sem atribuição para a equipe resolver. As RPCs antigas ficam restritas às próprias atribuições do motoboy, fechando a listagem geral anterior. No primeiro uso após a atualização, a equipe precisa atribuir os pedidos antes da confirmação pelo celular.

Publicar o front pela branch de produção da Vercel. O build emite `/motoboy/sw.js` com uma versão dos arquivos. A preparação só é anunciada após persistir os pedidos e existir um service worker controlando a página.

## Limites

Apagar dados do navegador, desinstalar com limpeza dos dados ou perder o aparelho pode apagar confirmações ainda não recebidas pelo servidor. Armazenamento cheio/indisponível impede confirmar localmente e precisa ser corrigido; não há sucesso simulado em memória. A conferência de retorno continua obrigatória.

## Validação

Testes SQL cobrem permissões, isolamento, versões de atribuição, saída, reenvio idempotente, baixa manual, auditoria, cancelamento e relógio inconsistente. `tests/fila-entregas.test.mjs` cobre preservação e retomada da fila, falhas e reconhecimento. `tests/entregadores.spec.js` exercita o fluxo real do banco e do navegador em celular e desktop, incluindo fechar/reabrir offline e envio posterior à baixa manual. `tests/motoboy.spec.js` preserva os testes de login, QR, câmera, CSP e acessibilidade de toque.

Implantação inicial: 497 asserções SQL, 330 verificações de paridade e 125 testes unitários passaram. A matriz direcionada de navegador passou em 107 cenários (3 não aplicáveis), incluindo entregadores, motoboy, usuários, sons e configuração de publicação em celular/desktop. Os três fluxos completos de entrega também passaram. Build de produção e lint aprovados. WebKit/iPhone não foi executado neste ambiente.

A atualização visual acrescenta testes de busca/filtros, cronômetro durante o preenchimento, foco preservado em consultas automáticas, exibição do histórico anterior sem modificar pedidos e consulta por data de conclusão. A bateria SQL passa com 507 verificações, incluindo dez casos de histórico anterior; paridade (330) e testes unitários (125) também passam.

Revisão final: 56 cenários do motoboy e 28 cenários da central/acabamento passam em celular e desktop. A bateria ampla teve 583 aprovações e 76 casos não aplicáveis; três falhas de sincronização dos próprios testes (medição antes da tela ficar visível e navegação concorrente ao reload de logout) foram corrigidas e revalidadas nessa rodada direcionada. Os arquivos JS/CSS do cliente mantêm os mesmos hashes de produção. Build e lint aprovados.
