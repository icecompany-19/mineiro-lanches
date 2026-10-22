# Despacho automático individual

Migração: `20261022193306_despacho_automatico_individual.sql`. Atualização aditiva, instalada desligada. Aplicar somente a migração ao banco existente; não reaplicar setup/seed em produção. A Edge Function `planejar-entregas` existente já aceita o resultado direto do banco e não precisa ser republicada.

## Comportamento

O modo individual distribui um pedido pronto por saída, ao motoboy elegível que espera há mais tempo na loja. Menos entregas concluídas no dia operacional desempata; o identificador resolve o empate final. Pedido sem entregador continua na fila. Não reúne destinos diferentes sem mapas nem inventa capacidade comercial.

Reutiliza `entrega_viagens`, `entrega_viagens_paradas`, `entregas_operacao`, auditoria, cache, confirmações offline, saída e retorno existentes. Reserva mantém o pedido em `pronto`. A saída exige carga da versão atual persistida e reconhecida pelo servidor; então o motoboy ou a equipe registra a saída. Finalizar entregas inicia `retornando`; só o retorno explícito à loja libera outra viagem.

Não confirma origem por GPS, não exige coordenadas de destino e não chama Geoapify. `segundos`, `metros`, `ultimaEntregaSeg`, `chegadaSeg` e geometria ficam `null`, representando informação desconhecida. A cotação da taxa no checkout permanece independente. Despacho não altera valores, pagamento recebido, cobrança, estorno ou taxas aceitas.

## Turno e prazo de reserva

Ativar grava `despacho_ativado_em`. Presença anterior a essa época aparece como `fora`; o motoboy precisa começar o turno novamente, ou a equipe precisa conferir a presença com motivo. Também precisa estar ativo, declarar presença no dia operacional atual e estar sem viagens ou atribuições abertas. No modo individual, celular em espera não exige comunicação a cada dois minutos. O modo por percurso conserva essa exigência anterior.

O prazo técnico inicial de reserva é **300 segundos**, configurável entre 60 e 1.800. Não é previsão de entrega. Antes da saída, uma reserva vencida é liberada pelo próximo processamento do job, mesmo se a carga foi reconhecida. A versão é invalidada, o pedido permanece pronto na fila e o motoboy é pausado, com auditoria. Ele precisa declarar disponibilidade novamente. Isso evita reservar repetidamente para quem não abriu a tela ou desistiu. Conta removida não impede a liberação do pedido.

Depois da saída, esse prazo não desfaz viagem nem atribuição. A tela recusa uma saída vencida ou com versão antiga mesmo antes da execução da limpeza. Saída e expiração concorrentes usam as mesmas travas e revalidam o estado; prevalece a operação concluída primeiro.

## Execução e concorrência

Os disparos de prontidão, presença e retorno continuam assíncronos por `pg_net` e pela Edge Function existente; o cron tenta novamente a cada minuto. Funcionam com o planejamento de rotas desligado quando o despacho individual está ligado. O painel não precisa permanecer aberto. Reservas individuais anteriores continuam elegíveis à limpeza mesmo após desativar a automação.

`iniciar_planejamento_entregas` autentica o token do job ou a equipe e chama o motor SQL privado. O resultado individual é devolvido sem matriz, geometria, crédito reservado ou chamada ao provedor. Execuções sem mudanças não geram registros adicionais.

A configuração serializa os jobs; pedidos e motoboys usam travas e unicidade já existentes. O motor relê a atribuição depois de travar cada pedido, porque o cursor inicial pode ter visto um estado anterior à atribuição manual. O `ON CONFLICT` também recusa sobrescrever vínculo, saída ou encerramento existentes. Tabelas e helpers permanecem privados, com RLS; apenas a RPC autorizada de configuração é pública para usuários autenticados da equipe.

## Contrato e ativação

Configuração retornada por `painel_rotas_entregas().config`:

- `despachoIndividualAtivo`: booleano.
- `despachoAtivadoEm`: instante da última transição desligado → ligado.
- `janelaAgrupamentoSeg`: inteiro de 0 a 120, inicialmente 0.
- `prazoReservaSeg`: inteiro de 60 a 1.800, inicialmente 300.

RPC de equipe: `configurar_despacho_entregas(p_ativo boolean, p_versao uuid, p_janela_agrupamento_seg integer default 0, p_prazo_reserva_seg integer default 300)`. Valida versão, autorização e disponibilidade do agendamento. Ativar desliga o modo de rotas; configurar depois rotas assistidas/automáticas desliga o individual. Salvar parâmetros com o individual já ligado conserva a época de ativação.

Ativar por uma sessão autenticada de equipe real, com a versão atual do DTO:

```sql
select public.configurar_despacho_entregas(true, '<versao-atual>'::uuid, 0, 300);
```

Em manutenção pelo SQL Editor, estabelecer antes os claims de uma conta operacional realmente autorizada; não atribuir a ação a um usuário humano que não a executou. Não ligar por `UPDATE` avulso da flag: a RPC grava época, versão e auditoria. Conferir `despachoIndividualAtivo=true`, ausência de presença herdada elegível e resposta do job. Não criar pedidos fictícios em produção para testar.

O DTO da viagem acrescenta `tipoDespacho: 'individual' | 'rotas'` e `reservaAte`. `minha_operacao_rotas` também informa `despachoIndividualAtivo` e `janelaAgrupamentoSeg`. Erro novo: `reserva_expirada`, tratado pedindo atualização da viagem e nova confirmação de disponibilidade.

## Agrupamento futuro e reversão

O planejador por percurso continua disponível, com seus limites e confirmação física de origem. A janela opcional só afeta o planejamento automático com capacidade maior que um: aguarda o pedido pronto mais antigo envelhecer a janela e então considera também os demais já prontos, inclusive os recentes. Não posterga a saída para aguardar cada pedido separadamente. Configurar janela não dispensa mapas ou limites comerciais; ela não é usada no individual.

Para desativar, chamar a mesma RPC com `false` e a versão atual, conservando os parâmetros desejados. Isso interrompe novas reservas e mantém viagens/baixas/retornos. Reservas ainda sem saída continuam sendo liberadas pelo prazo e job; não cancelar pedidos nem encerrar dinheiro para reverter. Para uma exceção antes do prazo, a equipe pode desfazer a viagem com motivo; nesse caso, os pedidos ficam pausados até liberação explícita, conforme o fluxo anterior.

Job/Edge indisponível pode atrasar distribuição e limpeza; o prazo continua bloqueando novas saídas vencidas. Pendências de atribuições antigas exigem conferência humana. A fila offline mantém os eventos até reconhecimento: não há envio garantido com a página fechada, e apagar dados do navegador pode perder confirmações locais.

Validação direcionada: 33 verificações SQL de viagens existentes, 17 de planejamento existente, 48 de despacho individual, 13 testes unitários de motor/Edge e três cenários reais com conexões concorrentes. O teste individual cobre também vínculo manual durante o cursor, exclusão de conta na reserva e a janela incluindo pedidos recentes. Fixtures somente locais.
