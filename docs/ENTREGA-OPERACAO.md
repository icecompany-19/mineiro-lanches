# Cotação de entrega: configurar, verificar e operar

Implementação de 18/10/2026. Código em `supabase/functions/`, migração `20261018023009_cotacao_entrega.sql`, checkout e `ML.store`. Não há chave privada no navegador.

## Estado da implantação

- Migração aplicada no Supabase de produção e função `cotar-entrega` publicada.
- Verificação real: função e consulta de CEP responderam HTTP 200; as credenciais administrativas do runtime alcançam as tabelas privadas.
- A última consulta de saúde retornou `rotasConfiguradas: false`. Falta configurar uma chave de produção. `loja.cotacao_ativa` permanece `false` durante a transição; não ativar enquanto as rotas estiverem indisponíveis.
- Não foram alterados pedidos antigos, seus valores ou sua localização. Testes completos de pedidos usam apenas o banco local e simulam os fornecedores externos. Isso não substitui o teste final da chave real.

## Configuração do provedor principal

1. No Google Cloud, usar um projeto com faturamento habilitado. Habilitar **Geocoding API** e **Routes API**.
2. Criar uma chave restrita a essas duas APIs. Ela será usada por um servidor: não aplicar uma restrição de HTTP referrer de navegador. Definir limites de consumo adequados e alertas no projeto; os preços/franquias vigentes estão na documentação Google indicada na análise.
3. Abrir [Secrets das Edge Functions do Mineiro](https://supabase.com/dashboard/project/puwylyfmwcvpfsftsrta/functions/secrets) e salvar `GOOGLE_MAPS_API_KEY`. Não colocar em variável `VITE_*`, arquivo versionado ou conversa.
4. Para uma rota alternativa independente, é possível configurar também `OPENROUTESERVICE_API_KEY`, respeitando o plano/limites dessa conta. O adaptador está implementado. Sem essa chave, falha total do roteador principal só pode ser recuperada por uma rota ainda vigente em cache.
5. Após mudar secrets, verificar o endpoint de saúde. Se a versão do runtime ainda não refletir a alteração, republicar a função usando os mesmos arquivos.

A confirmação visual usa Leaflet empacotado e tiles OpenStreetMap com atribuição; não requer uma chave Google de navegador. Ela recebe somente pontos independentes de CEP/GPS ou pontos marcados pelo cliente. Resultados de localização Google não são exibidos nesse mapa. O valor de rota Google tem atribuição ao lado da taxa.

## Verificação e ativação

`npm run entrega:verificar` verifica a saúde e os quatro CEPs do diagnóstico. `npm run entrega:verificar -- --cotacoes` também testa as quatro rotas e a emissão da cotação, usando pontos públicos de referência do CEP, sem criar pedidos ou mudar cobranças históricas. Esses pontos não comprovam o número da porta; são um teste operacional da integração. As chamadas seguem o contrato do endpoint público e podem consumir a franquia do provedor.

Ativar somente após: provedores configurados, quatro cotações reais emitidas, checkout publicado e teste da confirmação em mapa/retirada. Então, no SQL Editor:

```sql
update public.loja set cotacao_ativa = true where id = 1;
select cotacao_ativa, taxa_km, taxa_fixa from public.loja where id = 1;
```

O checkout recebe essa flag pela consulta do cardápio. Uma página antiga que tente enviar entrega sem cotação será recusada pelo banco; atualizar a página carrega o fluxo novo. Não ativar antes do deploy do cliente nem contornar uma falha de rota inserindo distância arbitrária.

Depois da ativação, confirmar no banco que novos pedidos reais de entrega têm `cotacao_entrega_id`, `distancia_km` e `taxa_entrega`, e que o total inclui a taxa. Não registrar pedidos fictícios na produção para essa conferência.

## Uso pela equipe e pelo cliente

- No painel, **Configurações → Entrega → Confirmar posição atual do truck** registra o GPS do aparelho como origem. Usar somente estando no ponto do truck; a função recusa precisão pior que 50 m. Mudar a origem invalida cotações anteriores e impede reaproveitar suas rotas.
- **Verificar cálculos das últimas 24 horas** mostra cotações calculadas, solicitações de confirmação e tentativas com falha, sem dados pessoais. Contagem de tentativas não é contagem de pedidos perdidos: uma tentativa pode falhar e ser recuperada em seguida.
- O cliente vê a taxa quando o serviço identifica a porta com confiança. Caso contrário, marca a entrada no mapa ou usa GPS, se estiver no endereço de entrega, e confirma o ponto. Negar GPS não impede marcar o mapa.
- Uma entrega sem cotação válida não é criada. Sacola, cadastro e endereços permanecem salvos. Retirada continua sem taxa. O botão de WhatsApp de recuperação não oferece um pedido de entrega com taxa pendente no novo fluxo.
- Cotação vale 15 minutos. Mudança de endereço, origem ou taxa exige uma nova cotação. Se o valor mudar, o cliente precisa conferir e enviar novamente; não há aumento silencioso após clicar.
- Perda de resposta após gravar preserva o UUID da tentativa. Repetir o envio recupera o mesmo pedido, mesmo se a cotação tiver vencido depois, sem duplicar cobrança/pedido.

## Cache, limites e privacidade

- O cache de endereço confirmado é separado por identificador imprevisível do navegador e endereço completo, incluindo número. Digitar outro telefone não expõe cadastros ou localizações do servidor. O cadastro entre aparelhos continua exigindo um fluxo próprio de confirmação de posse do telefone.
- Localização Google expira em 27 dias; ponto confirmado pelo cliente em 30 dias. A rota tem validade curta de 15 minutos. Reutilizar um registro não estende a validade original indefinidamente.
- Chave de rota inclui a origem e o destino por meio do registro do endereço; mudança de origem ou ponto exige outra rota. A cotação armazena a versão da origem e a configuração de preços, verificadas na criação do pedido.
- Há trava de 90 s por endereço para evitar consultas simultâneas, limite compartilhado de 30 consultas por cliente de rede em 10 minutos e 1.000 por dia globalmente. Esses limites são operacionais, não uma promessa de franquia gratuita; a conta do provedor também precisa ter cotas adequadas.
- Logs têm etapa/código, provedor e duração; não incluem telefone, nome, endereço completo, GPS ou chave externa. Cotações e eventos antigos são limpos depois de sete dias; registros de cache vencidos são removidos. A limpeza ocorre em novas reservas.
- As cinco tabelas de suporte têm RLS e nenhum privilégio para `anon`/`authenticated`. O backend usa `service_role` somente no runtime. O aviso informativo do advisor sobre RLS sem policies nessas tabelas corresponde à negação de acesso direto por desenho; não adicionar policies públicas para eliminá-lo.
- As RPCs de origem e resumo exigem equipe. Os helpers de reserva e emissão são `SECURITY INVOKER`, executáveis apenas pelo backend.

## Recuperação de incidentes

Se o provedor principal falhar, o serviço tenta novamente de forma limitada e depois a rota alternativa configurada. Endereços/rotas vigentes no cache reduzem a dependência de serviços externos. Quando nenhuma fonte consegue resolver, o sistema preserva a sacola e informa a falha; não usa distância em linha reta, centro da cidade ou taxa zero como substituição.

Para investigar, consultar `resumo_entregas()` com usuário da equipe ou agrupar os eventos privados por código no SQL Editor. `mapas_nao_configurados` indica ausência de chave; `rota_indisponivel` pode indicar permissão, quota, indisponibilidade ou ausência de rota no provedor. Não imprimir secrets nos logs.

Não desligar a exigência de cotação como recuperação silenciosa de uma indisponibilidade: isso restauraria a possibilidade de pedidos sem taxa. Preferir recuperar a configuração, habilitar a alternativa já implementada ou orientar retirada enquanto a rota estiver indisponível.

## Desenvolvimento local

O proxy `scripts/supabase-local/proxy.mjs` também atende `/functions/v1/cotar-entrega`, usando o mesmo handler e o PostgREST local. Assim, mudanças do serviço podem ser testadas sem deploy e sem credenciais administrativas de produção. Para usar mapas reais no desenvolvimento, fornecer `GOOGLE_MAPS_API_KEY`/`OPENROUTESERVICE_API_KEY` ao processo servidor (por exemplo, por um `.env.local` ignorado pelo Git, carregado com `node --env-file=.env.local`). Não prefixar essas chaves com `VITE_`.

`npm run entrega:verificar -- --local` verifica a função local. Os testes Playwright substituem somente os fornecedores externos e usam cotações/pedidos reais no banco local. As migrações devem estar aplicadas, e `loja.cotacao_ativa` pode ser ativada no banco local para testar o checkout novo.

## Validação desta entrega

- Lint e build de produção passaram; setup local aplicado duas vezes, com 545 verificações SQL e 330 verificações de paridade.
- 101 testes Node passaram. Incluem validação de precisão, recuperação por outro provedor, vínculo de endereço e validade do cache sem renovação indefinida.
- 24 casos do fluxo novo passaram em Chromium/WebKit e painel: quatro endereços, GPS negado, troca de endereço, expiração, indisponibilidade, recuperação sem duplicação e confirmação explícita do total se o cálculo termina depois do primeiro clique.
- Regressão de cadastro, entrega anterior, comanda e Vercel: 76 casos aprovados. Dois testes de troca de telefone aguardavam resposta de uma consulta que agora é cancelada; foram corrigidos para verificar o cancelamento e passaram nos dois tamanhos de tela.
- Função publicada, consultas reais dos quatro CEPs e permissões das tabelas verificadas em produção. O teste real das rotas permanece pendente da chave; não equiparar resultados simulados dos provedores a essa validação.
