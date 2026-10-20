# Viagens, rotas e distribuição aos motoboys

Implementação de 19/10/2026. A aba **Entregadores → Viagens e rotas** reúne disponibilidade, pedidos prontos, sugestões por percurso e viagens em andamento. O celular do motoboy mostra o turno, a sequência das paradas e os comandos de saída e retorno. Os totais de taxas e a fila offline continuam funcionando separadamente.

## Preparar a operação

O módulo é instalado **desligado**, sem preencher limites comerciais. Para usar:

1. Na loja, abra **Configurar rotas → Confirmar saída na loja** em um aparelho com GPS. O ponto deve representar a saída física da loja; não confirmar remotamente. A localização precisa ter precisão de até 50 metros.
2. Informe capacidade por saída, espera após a qual priorizar uma entrega individual, tempo máximo até a última entrega, desvio tolerado por pedido e tempo de atendimento em cada parada. São decisões da operação; os números dos testes não são configurações recomendadas.
3. Use **Verificar mapas**. A conferência usa a origem e um ponto de referência próximo, sem criar pedidos ou atribuições. Falta de chave, quota ou resposta válida aparece como erro.
4. Salve **Sugestões com liberação pela equipe** para iniciar o piloto. Depois de conferir os limites na prática, a opção **Vincular viagens automaticamente** executa a mesma reserva pelo servidor. É necessário ter o agendamento do servidor instalado.

O limite diário de créditos estimados é um freio técnico, inicialmente 1.000, e pode ser ajustado. Não é o saldo nem a fatura do Geoapify. Falhas também consomem a reserva interna; atingir o limite bloqueia novas consultas de mapas até o próximo dia operacional ou a revisão da configuração. A saída individual existente continua disponível para exceções, com as regras de atribuição e baixa manual já existentes.

## Saída e retorno

1. A cozinha avança **Em preparo → Marcar pronto**. Para entrega, o cliente lê **Pronto para sair**, aguardando a saída. Retirada continua com sua mensagem própria.
2. O motoboy toca **Começar turno na loja**. Só recebe uma nova viagem se estiver ativo, tiver declarado presença no dia operacional atual, se comunicado nos últimos dois minutos e não tiver viagem ou pedidos atribuídos abertos. Login e cadastro ativo não declaram disponibilidade. A equipe pode corrigir a situação com motivo auditado.
3. O sistema considera até 12 pedidos elegíveis, priorizando os prontos há mais tempo. Calcula custos direcionais pelas ruas, insere paradas em grupos pequenos e respeita os limites de tempo, capacidade e desvio. Ao ultrapassar a espera configurada, prioriza saída individual. Falta de entregador ou liberação pode prolongar a espera: o limite não é uma promessa de saída.
4. No modo assistido, **Vincular viagem** reserva o conjunto e atribui o entregador atomicamente. A equipe pode selecionar até seis pedidos, corrigir sua ordem e escolher outro entregador elegível. Uma sugestão vence em até 90 segundos e não atribui pedidos por si só.
5. O motoboy abre a tela conectado. A saída exige a versão atual da viagem e dos pedidos persistida no aparelho, além da página preparada para abrir sem internet. Depois do reconhecimento, equipe ou motoboy registra **Registrar saída da viagem**. Todos os pedidos passam para **Em entrega** juntos. Reserva automática também aguarda essa saída explícita.
6. Cada confirmação usa a fila persistente existente. Fechar e reabrir a tela offline conserva os eventos; com a tela aberta e conectada, ela tenta enviar até o servidor reconhecer. O painel continua mostrando **Em entrega** enquanto o evento não chegar. **Sincronizar agora** e a contagem de pendências permitem conferir o envio.
7. Após todas as baixas recebidas, a viagem fica **Retornando**. Somente **Retornei à loja**, após sincronizar as pendências, libera o motoboy novamente. A equipe também pode conferir presencialmente o retorno, registrando motivo. Cadastro desativado pode ter a viagem encerrada pela equipe, sem voltar à disponibilidade.

**Desfazer viagem para replanejar** funciona antes da saída e exige motivo. Os pedidos permanecem prontos e ficam pausados na seleção automática até a equipe recalcular a seleção ou liberá-los explicitamente. Corrigir a localização de um pedido também exige motivo, antes da reserva; a taxa já aceita não é recalculada. Depois da saída, a sequência e as atribuições ficam preservadas. Baixa manual continua exigindo responsável e motivo; uma sincronização posterior não sobrescreve nem duplica o encerramento.

Pedidos sem ponto confirmado vigente aparecem para conferência. Não entram como coordenadas presumidas nem impedem o controle manual dos demais pedidos. Uma reserva automática que perde a revalidação aparece nas pendências do último cálculo.

## Mapas e limites

O backend usa Geoapify Route Matrix e Routing, com `drive` e tráfego aproximado. Considera o retorno à loja. Não usa API Google. A chave fica somente nos secrets do servidor. O mapa mostra o trajeto calculado e as paradas numeradas; não acompanha GPS ao vivo. Tempo e distância são estimativas, não percurso observado nem prazo garantido.

O motor usa inserção por custo entre grupos pequenos. Não promete a melhor solução global para uma frota inteira. Caminhos sem resposta válida não viram linhas retas nem distância zero. Uma falha na geometria encerra o cálculo sem reservar apenas parte do resultado. A capacidade suportada é de um a seis pedidos por viagem; os demais limites também são validados no servidor.

Matrizes duram até 15 minutos, limitadas pela validade dos pontos. Sugestões vencidas perdem coordenadas e geometria na limpeza; as geometrias de viagens também expiram com os pontos. O cache do celular elimina pontos vencidos ao ser lido. Execuções do planejador são retidas por sete dias, sem o contexto de coordenadas após finalizar. A auditoria das viagens conserva responsáveis, motivos e eventos. O provedor recebe coordenadas; não recebe telefone, nome ou identificadores de clientes/pedidos.

Apagar os dados do navegador antes do envio pode perder confirmações locais. A conferência de retorno e das entregas abertas continua fazendo parte do processo. Não há envio garantido enquanto a página está fechada.

## Implantação técnica

Aplicar somente `supabase/migrations/20261019123043_viagens_rotas_entregadores.sql` ao banco existente. Nunca reaplicar setup/seed em produção para atualizar esse módulo. O setup agregado serve para instalação e testes locais.

Publicar `supabase/functions/planejar-entregas/index.js`, `handler.js` e suas dependências `_shared/planejamento.js` e `_shared/entrega.js`. Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `GEOAPIFY_API_KEY`. O gateway usa `verify_jwt=false` porque a função valida o JWT em Auth ou o token privado do agendamento antes de consultar mapas. O navegador não envia o autor efetivo. O token do job só permite executar esse planejador e não é uma chave geral do banco.

A migração instala `pg_net`/`pg_cron` quando disponíveis: `mineiro-planejar-entregas` a cada minuto e `mineiro-limpar-planejamento` a cada hora. Configurar apenas o campo privado `entrega_rotas_config.job_url` com `https://<projeto>.supabase.co/functions/v1/planejar-entregas`. Conservar o modo desligado e as regras vazias até a configuração operacional. Prontidão, disponibilidade e retorno também disparam tentativas no modo automático; o painel não precisa permanecer aberto. Lease, orçamento, versões, unicidade e revalidação protegem contra chamadas repetidas e operadores concorrentes.

Para verificar sem pedidos: `select public.disparar_planejador_entregas(true);`, seguido da consulta à resposta privada de `pg_net` e ao estado da execução. Não copiar o token do job para logs, frontend ou documentação. Desligar a automação não desfaz viagens já reservadas ou em andamento.

## Verificação

SQL cobre permissões, isolamento, reserva/saída/retorno, versões, revalidação, baixa manual seguida de reenvio, cancelamento, orçamento e turno expirado. Testes do motor cobrem custos assimétricos, capacidade, urgência, desvios e caminhos ausentes. Testes da Edge Function validam autenticação e ausência de reserva parcial. Navegador exercita equipe e celular simultaneamente, mapa, concorrência, confirmação offline com reabertura, sincronização, retorno, correções e mensagem do cliente. Pedidos de teste ficam exclusivamente no ambiente local.

## Uso por quem tem pouca familiaridade com tecnologia

A tela da equipe informa o próximo passo: preparar a loja, marcar um pedido pronto, conferir um destino, aguardar um motoboy ou liberar a viagem. No primeiro uso, **Preparar rotas da loja** abre os campos necessários e já seleciona liberação pela equipe; não ativa reservas automáticas. Viagens atuais aparecem antes da fila. A relação de presença fica em **Quem está na loja?**, e o limite técnico de mapas fica recolhido.

No celular, a ação acompanha o momento da viagem. **Ver próxima entrega** leva ao botão do pedido sem confirmar nada nem mudar o endereço da página. Se todas as paradas foram confirmadas offline, a orientação é conectar e sincronizar antes do retorno. O acesso por QR continua disponível como alternativa. Nenhum desses atalhos dispensa o reconhecimento do servidor ou inventa sucesso quando falta conexão.

Uma consulta iniciada antes da saída não pode deixar a lista do celular parada em “Aguardando saída”: a atualização solicitada após uma mudança aguarda a consulta atual e faz uma nova leitura. O teste de viagem força essa ordem de respostas antes de confirmar offline. O atalho **Organizar saída** fica no topo do painel; sugestões e erros recebem foco para que o operador veja o resultado da ação.

Validação da implementação: setup aplicado duas vezes, 574 verificações SQL, 330 de paridade, 142 testes unitários e 100 cenários finais de navegador aprovados (86 nas telas de entregadores e 14 de ponta a ponta). A regressão adicional do celular aprovou 126 cenários. O serviço publicado respondeu à verificação real de matriz e percurso com HTTP 200, sem criar pedidos ou reservas. O modo permanece desligado e as regras operacionais vazias até a configuração pela loja. WebKit/iPhone não foi executado neste ambiente.
