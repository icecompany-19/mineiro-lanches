# Planejamento de rotas e distribuição aos entregadores

Proposta original de 19/10/2026, baseada no código publicado em `66bb7a4`, em consultas agregadas de leitura no banco e na documentação dos provedores. As etapas técnicas de prontidão, disponibilidade, planejamento, viagens e reserva automática foram implementadas posteriormente. O guia vigente está em [ROTAS-OPERACAO.md](ROTAS-OPERACAO.md). O piloto e a ativação dependem da confirmação física da origem e dos limites definidos pela operação; a instalação fica desligada.

## Decisão recomendada

Organizar a operação por **viagens**: uma saída da loja, um entregador, uma lista ordenada de pedidos e o retorno à loja. O sistema monta viagens e escolhe um entregador disponível; a equipe pode conferir e corrigir antes da saída. Depois de medir a operação, a reserva dos pedidos também pode acontecer automaticamente, mantendo o registro da saída real.

A escolha deve considerar tempo pelas ruas, espera dos pedidos, preparo, capacidade de transporte e disponibilidade. Proximidade por bairro, distância em linha reta, quantidade de entregas e ordem de cadastro do motoboy, isoladamente, não determinam uma boa viagem.

## Base existente e lacunas verificadas

- A cotação de entrega está obrigatória em produção. O backend usa Geoapify para o trajeto loja → cliente e tem alternativa OpenRouteService, caso configurada. O helper atual retorna distância; ainda não fornece matriz de tempos, sequência de paradas ou planejamento de frota.
- O pedido pode guardar o ponto confirmado em `entrega_destino`, com validade em `entrega_destino_ate`. Na consulta dos últimos sete dias, 28 de 75 pedidos de entrega, excluindo origem `exemplo`, tinham ponto vigente. A contagem inclui cancelados e não representa demanda diária. O único pedido aberto consultado tinha ponto vigente. Não há necessidade de reconstruir todos os endereços antigos para iniciar com novos pedidos elegíveis.
- A origem da loja tem coordenadas cadastradas, mas não contém a marca de confirmação `confirmadaEm`. Isso não comprova endereço errado. A implantação precisa conferir fisicamente o ponto de saída e registrar sua confirmação pelo fluxo existente.
- Há cinco cadastros ativos de entregadores. Cadastro ativo concede acesso; não informa turno, presença na loja ou disponibilidade. A última comunicação também não informa localização.
- Para entrega, `ML.regras.proximoStatus` ainda passa de `preparo` diretamente para `rota`. É necessário distinguir **pronto para sair**, **reservado para uma viagem** e **saiu da loja**. O estado `pronto` já existe, mas o avanço de pedidos de entrega precisa ser adaptado no front e no backend.
- A operação atual vincula cada pedido a um entregador, com versão da atribuição, auditoria e fila offline. A troca após a saída é bloqueada. Essa proteção deve continuar valendo.

Referências: [controle atual](ENTREGADORES.md), [cotação e provedor](ENTREGA-OPERACAO.md), [contrato da API](CONTRATO-API.md).

## Fluxo operacional proposto

1. A cozinha marca o pedido como **Pronto**, registrando horário no servidor. Pedidos em preparo podem aparecer na previsão, mas não entram como carga pronta para sair.
2. O motoboy inicia o turno e informa que está **Disponível na loja**. A equipe pode registrar uma correção com responsável e motivo. Início de turno não é inferido pelo login.
3. O planejador monta sugestões com os pedidos prontos sem reserva, os destinos válidos e os entregadores disponíveis. Mostra sequência, estimativas, espera e o motivo do agrupamento. Uma sugestão não altera o pedido.
4. No modo assistido, a equipe usa **Vincular viagem**. O servidor reserva os pedidos e atribui o entregador em uma única transação, sem selecionar e vincular cada pedido individualmente. No modo automático futuro, o servidor executa essa mesma reserva quando as regras estiverem satisfeitas.
5. O celular recebe a viagem inteira e confirma o carregamento da sua versão. A equipe ou o entregador autorizado registra a saída real. O servidor valida novamente o conjunto e marca todos os pedidos daquela saída como `rota` atomicamente.
6. O motoboy segue a sequência sugerida e confirma cada entrega. Se estiver offline, a fila persistente atual continua sendo a fonte das confirmações pendentes. O painel só conclui cada entrega após o reconhecimento do servidor.
7. Após as entregas, o retorno é uma etapa própria. **Retornei à loja** e a conferência das pendências permitem voltar à disponibilidade. A conclusão do último pedido não significa que o motoboy já chegou à loja. Exceções e baixas manuais reconhecidas precisam ser consideradas nessa conferência.

Exemplo ilustrativo: dois pedidos prontos no mesmo corredor podem sair juntos com Ewerton; outro na direção oposta pode formar uma segunda viagem com outro entregador disponível. Mesmo no mesmo bairro, uma barreira viária ou um desvio longo pode justificar separar os pedidos. Não se espera indefinidamente por um terceiro lanche para completar a carga.

## Como escolher os pedidos e o entregador

O primeiro motor deve ser pequeno, explicável e executado no servidor:

1. Selecionar apenas pedidos de entrega prontos, não encerrados, sem outra reserva e com ponto vigente; validar a origem e a configuração operacional.
2. Priorizar os pedidos com maior urgência e espera. Começar as propostas por eles evita deixar destinos isolados permanentemente para depois.
3. Usar uma matriz de distâncias e tempos por ruas entre loja e destinos. Respeitar os sentidos das vias: o custo A → B pode ser diferente de B → A. Um par sem caminho calculável não vira uma distância presumida.
4. Avaliar inserções e ordens de paradas em grupos pequenos, limitados pela capacidade configurada. Considerar viagem completa e retorno à loja, tempo de atendimento nas paradas e acréscimo imposto a cada pedido. A proximidade geográfica pode reduzir candidatos; a decisão final usa o percurso real.
5. Rejeitar grupos que excedam capacidade, espera máxima para sair, duração de transporte dos alimentos ou limite de desvio por pedido. Um pedido urgente pode exigir viagem individual. Os limites de negócio precisam ser configurados com a operação; não há números confirmados a transformar em promessa ao cliente.
6. Comparar as opções viáveis priorizando atendimento no prazo e espera, depois tempo/distância da viagem. Usar tempo disponível na loja e carga recente como critérios de equilíbrio entre entregadores aptos, sem sacrificar a urgência para igualar contagens.
7. Reservar somente após revalidar dados e versão. Se mudou o preparo, a disponibilidade, o endereço ou uma reserva, recalcular a proposta afetada.

Tempo de trajeto é uma estimativa do provedor, acrescida do atendimento e da operação medidos. Não é rastreamento ao vivo nem garantia de chegada. O modelo de trânsito precisa ficar explícito: a documentação Geoapify distingue `free_flow` de trânsito aproximado; nenhum deles deve ser apresentado como observação do trânsito em tempo real.

## Alternativas técnicas

| Alternativa | Aplicação | Limites | Recomendação |
|---|---|---|---|
| Agrupar manualmente ou por bairro | Recuperação operacional e comparação inicial | Não resolve sequência, barreiras viárias, preparo ou concorrência por pedidos | Manter ajuste manual; não usar bairro como regra final de atribuição automática |
| Matriz de ruas + motor simples no backend | Grupos pequenos com regras próprias de restaurante | Precisa de limites de candidatos, cache, validação e medição; não promete ótimo global | Primeira implementação recomendada |
| Otimizador de frota, como Geoapify Route Planner | Mais veículos, destinos e restrições simultâneas | Quota/custo e resposta do solver precisam ser validados; as regras de reserva continuam sendo do Mineiro | Comparar em simulação; adotar se houver ganho medido |

Reaproveitar Geoapify evita exigir uma API Google. Uma interface de provedor permite evoluir o motor sem reescrever a operação. A alternativa OpenRouteService atual só calcula trajetos individuais; a existência desse fallback não comprova suporte contratado a matriz ou otimização.

A matriz e o otimizador consomem créditos além da cotação do checkout. Não recalcular a frota a cada atualização visual ou a cada segundo. Reagir a eventos relevantes no servidor, agrupar eventos próximos, reutilizar trechos vigentes e limitar tamanho/frequência das consultas. Preservar orçamento para o checkout, registrar consumo agregado e validar as permissões e limites reais da conta antes de ativar.

Fontes consultadas em 19/10/2026: [Route Matrix](https://apidocs.geoapify.com/docs/route-matrix/), [Route Planner](https://apidocs.geoapify.com/docs/route-planner/) e [planos](https://www.geoapify.com/pricing/). O preço efetivo depende da conta e do volume; não está definido neste plano.

## Telas e correções

**Equipe:** complementar a central Entregadores com uma área de planejamento: mapa com caminhos pelas ruas e paradas numeradas, lista de prontos sem viagem, viagens por motoboy, estimativas e motivos de impedimento. O mapa não representa localização atual dos motoboys. Preservar busca, cronômetros, filtros e rascunhos já existentes.

Antes da saída, permitir retirar ou incluir pedido elegível, alterar sequência, trocar entregador e desfazer reserva. Recalcular a estimativa, validar os limites e registrar autor/motivo de alterações operacionais. Cancelar uma sugestão não cancela pedidos. Um cancelamento real de pedido invalida sua participação na viagem.

**Motoboy:** mostrar viagem e versão carregadas, próxima parada, sequência completa, contato, endereço, confirmação e sincronização. Guardar a lista ordenada e os dados necessários no cache por usuário já existente. Funcionamento offline da lista não garante mapa ou navegação externa offline; esses recursos dependem do aplicativo e dos mapas disponíveis no aparelho.

Depois da saída, não redistribuir pedidos automaticamente nem inserir novos pedidos na viagem. Na primeira versão, ocorrências seguem atendimento manual auditado, preservando a proibição atual de trocar a atribuição após a saída. Transferência física entre motoboys exige um fluxo próprio de exceção, com reconhecimento e tratamento das confirmações pendentes; não é uma simples troca no seletor.

## Modelo e execução no servidor

Proposta de entidades, a detalhar na migração:

- `viagens_entrega`: entregador, estado, versão, origem/configuração usadas, estimativas, reserva, carregamento reconhecido, saída, retorno e encerramento.
- `viagens_paradas`: vínculo com pedido/operação, ordem, versão da atribuição e estimativas do trecho. Um pedido não pode integrar duas viagens ativas.
- Disponibilidade/turno do entregador: presença declarada, disponibilidade, pausa, reserva e retorno, com horários e responsável. Um entregador não pode ter duas viagens ativas.
- Eventos de planejamento e alterações: responsável real, motivo, versão e referências mínimas. Os nomes das tabelas são propostas, não APIs já publicadas.

Restrições no banco e travas em ordem consistente devem impedir dois operadores ou processos de reservarem o mesmo pedido/entregador. Pedidos e entregadores são revalidados na transação de reserva e na saída. Repetir a mesma solicitação com a mesma chave idempotente não duplica viagem, atribuição ou evento.

Separar cálculo externo de transação: obter a proposta sem manter travas durante chamadas de mapas; persistir apenas se as versões e condições ainda forem válidas. Endereço corrigido, origem alterada, disponibilidade ou pedido cancelado invalidam propostas antigas. Expiração de reserva não libera silenciosamente carga já saída.

O planejador deve funcionar no backend, acionado por eventos operacionais e por uma recuperação periódica com limites, sem depender de uma aba do painel aberta. Reserva/saída/retorno passam por funções privadas com autorização e auditoria. Não dar ao motoboy acesso aos pedidos dos demais, nem colocar secrets no navegador. Proteger tabelas, restringir RPCs e conservar o autor autenticado obtido no servidor.

Integrar com `entregas_operacao` e sua versão de atribuição, sem criar uma segunda fonte de verdade para conclusão. Respostas de sincronização continuam validando evento e versão. Confirmação posterior não duplica nem sobrescreve baixa manual/cancelamento. As pendências do aparelho não podem ser inferidas a partir de silêncio de rede.

Destinos de viagem e caches devem respeitar a validade/limpeza de localização existente. Limitar dados enviados ao provedor às coordenadas e parâmetros necessários; não enviar nomes, telefones, observações ou tokens do cliente. Auditoria/logs técnicos não devem acumular coordenadas e endereços sem necessidade. O agrupamento não recalcula nem altera a taxa de entrega já aceita pelo cliente.

## Falhas e recuperação

| Situação | Comportamento |
|---|---|
| Pedido sem ponto vigente ou ambíguo | Mostrar pendência para conferir localização; excluir da atribuição automática até resolver. Endereço textual sozinho não vira porta confirmada |
| Nenhum entregador disponível | Conservar pedido na fila, mostrar espera e alertar a equipe; não atribuir a perfil apenas porque está ativo |
| Falha/quota de mapas | Preservar viagens já liberadas e o controle manual; não publicar uma nova rota como calculada usando linha reta. Usar cache apenas quando compatível e vigente |
| Motoboy sem comunicação | Manter último estado conhecido e sinalizar incerteza; não assumir retorno nem transferir sua carga |
| Mudança antes da saída | Invalidar versão antiga, recalcular e exigir reconhecimento do novo carregamento antes da saída |
| Pedido cancelado ou concluído manualmente | Preservar conclusão/cancelamento, registrar ocorrência na viagem e reconhecer sincronização posterior conforme contrato atual |
| Processo interrompido ou execução concorrente | Retomar por operação idempotente; não manter reserva órfã indefinidamente nem liberar viagem em andamento por prazo |

## Etapas e critérios de conclusão

| Etapa | Entrega concreta | Pronto quando |
|---|---|---|
| 1. Prontidão e disponibilidade | Fluxo `preparo → pronto → rota`, horários, turno, pausa e retorno explícitos; origem conferida e parâmetros configurados | Entrega pronta e motoboy disponível são dados distintos; concluir pedido não torna o entregador disponível; retirada e fluxo existente continuam corretos |
| 2. Planejamento sem atribuição | Matriz, propostas por percurso, estimativas e comparação entre motores | Cenários de mesmo corredor, direção oposta, via de mão única, destino isolado/urgente, capacidade e rota inexistente têm comportamento explicável; nenhuma proposta altera pedidos |
| 3. Viagens assistidas | Reserva atômica com atribuição automática do conjunto, edição antes da saída, mapa, celular e reconhecimento de carregamento | Dois operadores não reservam o mesmo pedido; reserva/saída repetidas são idempotentes; viagem completa chega ao celular; versão antiga não confirma nova atribuição |
| 4. Piloto operacional | Usar viagens assistidas e medir espera, transporte até a última parada, retorno, desvios, correções e consumo do provedor | Os parâmetros refletem dados da operação e os desvios têm causa identificável; o histórico antigo sem prontidão/disponibilidade não é usado como se contivesse essas informações |
| 5. Reserva automática | Ativar por configuração para pedidos e entregadores elegíveis; manter saída real explícita e correção pela equipe | Regras, capacidade, orçamento e recuperação foram validados; funcionamento independe do painel aberto; desligar automação retorna ao controle assistido sem alterar viagens em andamento |

Verificações da implementação: SQL para permissões, estados e concorrência; testes do motor com custos assimétricos e casos inviáveis; integração do provedor com chave só no servidor; navegador para equipe/celular, perda de rede, fechamento/reabertura, versão desatualizada e baixa manual seguida de sincronização. Testar carga e pedidos fictícios somente no ambiente local, nunca criando entregas de teste na produção.

Medir separadamente espera para sair, tempo em transporte, atraso estimado, retorno e sincronização. Comparações de distância devem declarar se usam trajetos estimados ou percurso observado. Sem GPS, não apresentar distância planejada como quilometragem realmente percorrida. Não prometer economia percentual ou prazo ao cliente antes do piloto.

## Registro desta etapa

Na elaboração da proposta foram concluídos diagnóstico e planejamento, sem alterar pedidos ou atribuições. Na implementação posterior foram acrescentados o estado pronto para entrega, disponibilidade explícita, motor por ruas, reserva transacional, carregamento no celular, saída e retorno, revisão antes da saída, mapas e agendamento independente do painel. O plano acima fica como registro das decisões. Não foram preenchidos limites comerciais presumidos nem ativada a distribuição em produção.
