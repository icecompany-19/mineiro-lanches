# Entregas manuais (29/10/2026)

Pedido do dono: a operação do motoboy sai do sistema. **Todas as etapas do pedido passam a ser manuais, feitas pela equipe no painel.**

## Como fica a operação

No quadro de **Pedidos**, cada cartão tem um botão para a próxima etapa:

| Etapa atual | Botão | Vai para |
|---|---|---|
| Novo | **Aceitar e preparar** | Em preparo |
| Em preparo | **Marcar pronto** | Pronto |
| Pronto (entrega) | **Saiu para entrega** | Em rota |
| Pronto (retirada/local) | **Concluir** | Concluído |
| Em rota | **Concluir** | Concluído |

- Não há atribuição de motoboy, baixa manual nem motivo para concluir uma entrega.
- O cliente continua vendo cada etapa no acompanhamento (`#pedido/<token>`).
- Cancelamento continua exigindo motivo.
- "Confirmar pagamento recebido" (pagamento na entrega) continua igual.
- A comanda sai **sem QR code**: termina no total do pedido.

## O que saiu

- Tela do entregador `/motoboy/` (login, fila do celular, leitura do QR, confirmação offline). `/motoboy` e `/motoboy/` redirecionam para `/painel/`; `/motoboy/sw.js` agora é só um worker que apaga o cache antigo e se desinstala nos celulares que tinham a tela instalada.
- Aba **Entregadores** do painel (atribuição, registrar saída, viagens e rotas, despacho automático, taxas por entregador, baixa manual).
- Perfil **Motoboy** para usuários novos. Contas antigas de motoboy aparecem em **Usuários** como "Motoboy (tela retirada)" e podem ser desativadas ali.
- QR do entregador na comanda (`src/lib/qr-comanda.js`, `window.MLQr`).
- Edge Function `planejar-entregas` e o planejador (`_shared/planejamento.js`) saíram do repositório; o guia em PDF de entregas automáticas saiu de `public/guias/`.

## Banco

Migration `supabase/migrations/20261029190000_entregas_manuais.sql`. Aplicar **somente ela** no banco existente, **antes** de publicar o front (sem ela, o painel novo não consegue concluir uma entrega: o gatilho antigo exige motivo de baixa manual). Não reaplicar setup/seed em produção.

O que ela faz:

1. Desliga rotas e despacho automático (`entrega_rotas_config`) e tira do `pg_cron` o job `mineiro-planejar-entregas`. O job `mineiro-limpar-planejamento` continua, para limpar coordenadas vencidas.
2. Recria `mudar_status` sem a trava `pedido_em_viagem` e sem chamar o planejador ao marcar pronto.
3. Remove os gatilhos `pedidos_entregas_operacao` (exigia motivo para concluir entrega) e `pedidos_viagens_paradas`.
4. Revoga de `anon` e `authenticated` as RPCs do motoboy e da aba Entregadores.

Não apaga nada: tabelas `motoboys`, `entregas_operacao`, `entregas_eventos`, `entrega_viagens` e afins, com o histórico, ficam no banco. Nenhum pedido é alterado. Um pedido que estava numa viagem antiga segue pelas etapas normalmente.

Reverter: reaplicar as migrations `20261019024838`, `20261019123043`, `20261022193306` e `20261024023500` (recriam funções, gatilhos e permissões) e religar pela RPC `configurar_despacho_entregas`; o front precisa voltar junto.

## Painel aberto antes da publicação (30/10)

Um painel que já estava aberto continua com o código anterior até ser recarregado: mostra "Aguardando saída do motoboy" no lugar do botão **Saiu para entrega** e não deixa concluir entregas. Em 30/10 havia 13 entregas paradas em Pronto por isso, com banco e site já corretos. Resolve com F5 no computador ou fechando e abrindo o painel no celular. A partir desta data o painel avisa sozinho quando sai uma versão nova (`src/painel/versao.js`).

## Pendências

- A Edge Function `planejar-entregas` continua publicada no Supabase, parada (sem job e com a automação desligada). Pode ser removida pelo painel do Supabase quando o dono quiser.
- `docs/GUIA-DA-PLATAFORMA.pdf` e o guia de pagamentos (`public/guias/guia-pagamentos-mineiro-lanche.pdf`, página do cache do motoboy) ainda mostram telas do motoboy; refazer quando houver nova rodada de capturas.
- Os testes SQL `00_estrutura`, `02_criar_pedido`, `04_rls` e `05_equipe_estado` já falhavam antes desta mudança (contam 56 produtos, sem o item de teste de R$ 1, e listas de chaves anteriores ao pagamento na entrega). Não foram corrigidos aqui. Em 30/10 o item de R$ 1 saiu do seed (56 produtos de novo), o que deve resolver a parte da contagem; não foi rodado de novo.

## Verificação (29/10)

- Lint e build aprovados; o `dist/` não tem mais a página do motoboy.
- Bateria SQL rodada sobre PGlite (sem Postgres nesta máquina), comparada com o commit anterior: as mesmas falhas antigas nos dois lados e nenhuma nova; `16_entregas_manuais.sql` com 18 verificações; `setup.sql` aplicado duas vezes.
- Painel conferido no navegador sobre o banco local: pedido de entrega de Novo a Concluído só com os botões do quadro, comanda sem QR, menu sem Entregadores no computador e no celular.
- Playwright e e2e não rodaram nesta máquina (sem o Supabase local de `scripts/supabase-local/iniciar.sh`).
