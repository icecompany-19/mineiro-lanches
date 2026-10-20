# Contrato banco ⇄ front (Supabase)

Fonte única para quem escreve o SQL (`supabase/`) e para quem escreve o adaptador (`src/lib/`). Mudou algo aqui? Os dois lados mudam juntos.

**Cotação de entrega (18/10):** `loja_json()` inclui `cotacaoAtiva`. Ativa, `criar_pedido(p)` exige `p.cotacaoId` válido para uma nova entrega real e obtém a distância da tabela privada `cotacoes_entrega`, ignorando a distância do navegador. `pedidos.cotacao_entrega_id` vincula a emissão usada; os demais campos e o formato público dos pedidos continuam compatíveis. O ponto da rota é guardado em `pedidos.entrega_destino` com `entrega_destino_ate`, por até 30 dias, para abrir o local confirmado no painel; `pedido_json` inclui `entregaDestino` quando disponível. O acompanhamento público por token continua sem GPS. Retirada e histórico não exigem cotação. Repetição idempotente é resolvida antes da expiração, preservando pedidos já aceitos.

`ML.store.buscarCepEntrega(cep, dispositivo, signal)` e `ML.store.cotarEntrega(dados, signal)` chamam a Edge Function `cotar-entrega`. A cotação recebe `{ cep, rua, endereco, dispositivo, ponto?, confirmado? }` e devolve `{ estado: 'ok', id, distanciaKm, taxa, expiraEm, fonte, localizacaoFonte }` ou `{ estado: 'confirmar', ponto }`. Número faz parte de `rua`; `endereco` deve corresponder ao endereço completo normalizado pelos dados postais. `dispositivo` é UUID aleatório por navegador, nunca telefone. Não se consulta a tabela de clientes. O cálculo usa Geoapify e OpenRouteService opcional, com secrets exclusivos do servidor. Não chama APIs Google. O mapa exige confirmar candidatos de CEP; localizações precisas de endereço seguem critérios estritos do adaptador. `fonte` e `localizacaoFonte` identificam a atribuição exibida junto da taxa. Operação e configuração em [ENTREGA-OPERACAO.md](ENTREGA-OPERACAO.md).

## Convenções

- Schema `public`. Funções `security definer`, `set search_path = public, pg_temp`, nomes em português.
- Erros de regra: `raise exception '<codigo>' using errcode = 'P0001'`. O texto da mensagem **é só o código**, para o front traduzir:

| Código | Quando |
|---|---|
| `dados_invalidos` | Campo obrigatório ausente ou formato errado |
| `produto_invalido` | Id inexistente ou inativo; produto sem preço ("Preço a confirmar"); opção não permitida para o tipo |
| `produto_esgotado` | Item esgotado no dia de operação |
| `loja_fechada` | Loja fechada e `aceita_fechada = false` |
| `muitos_pedidos` | Mais de 5 pedidos do mesmo telefone em 10 min (só `anon`) |
| `sem_permissao` | Função de equipe chamada por quem não está em `equipe`; função do motoboy chamada por quem não está em `motoboys` (ativo) nem em `equipe` |
| `transicao_invalida` | Mudança de status fora da ordem; `confirmar_entrega` num pedido ainda `novo` |
| `nao_encontrado` | Id ou token inexistente |
| `nao_e_entrega` | `confirmar_entrega` num pedido que não é de entrega (`local` ou `retirada`) |
| `pedido_cancelado` | `confirmar_entrega` num pedido cancelado |
| `cotacao_necessaria` | Nova entrega sem identificador válido de cotação quando o serviço está ativado |
| `cotacao_expirada` | Cotação vencida ou origem/regra de taxa alterada; exige recalcular e confirmar |
| `cotacao_endereco_divergente` | Endereço do pedido difere do endereço vinculado à cotação |

- **Dia de operação.** `dia_operacional()` devolve `((now() at time zone 'America/Sao_Paulo') - interval '4 hours')::date`. É o mesmo corte de 4h do painel (`DIA_OP_OFFSET`).

## Tabelas

**`produtos`**

| Coluna | Tipo |
|---|---|
| `id` | `text` pk |
| `categoria` | `text` |
| `nome` | `text` |
| `preco` | `numeric(10,2)` null. **`null` = "Preço a confirmar"**: item novo cujo preço o dono ainda não mandou (o `preco: null` do CONFIG). Aparece no cardápio, mas não vai para a sacola e o `criar_pedido` o recusa com `produto_invalido`. `check (preco >= 0)` |
| `tipo` | `lanche` · `combo` · `porcao` · `bebida` |
| `foto` | `text` null |
| `ingredientes` | `text[]` (o `ing` do CONFIG) |
| `ordem` | `int` |
| `ativo` | `bool` |
| `esgotado_dia` | `date` null |

**`adicionais`**: `id text pk`, `nome`, `preco numeric(10,2)`, `ativo bool`.

**`loja`** (linha única, `id = 1`)

| Coluna | Valor inicial |
|---|---|
| `modo` | `auto` · `aberta` · `fechada` |
| `aceita_fechada` | `false` |
| `combo_preco` | `14.90` |
| `taxa_km` | `1.00` (R$ por km cobrado; vem do `CONFIG.entrega.taxa.porKm`) |
| `taxa_fixa` | `4.00` (R$ somado à entrega; vem do `CONFIG.entrega.taxa.fixa`) |
| `horarios` | `jsonb`, igual ao `CONFIG.horarios`: `{"0":["19:00","00:00"],…,"5":["19:00","01:00"],"6":["19:00","01:00"]}` (0 = domingo; `null` = fechado naquele dia) |
| `atualizado_em` | |

**`clientes`**

| Coluna | Tipo |
|---|---|
| `telefone` | `text` pk (só dígitos, 10 ou 11) |
| `nome` | `text` |
| `endereco` | `text` |
| `referencia` | `text` |
| `pedidos` | `int` |
| `primeiro_pedido_em` | |
| `ultimo_pedido_em` | |

**`pedidos`**

| Coluna | Tipo |
|---|---|
| `id` | `uuid` pk default `gen_random_uuid()` |
| `numero` | `bigint generated always as identity` |
| `token` | `uuid unique` default `gen_random_uuid()` |
| `criado_em` | `timestamptz` |
| `origem` | `cardapio` · `qrcode` · `exemplo` |
| `mesa` | `text` null |
| `cliente_nome` | |
| `cliente_telefone` | |
| `modo` | `entrega` · `local` (o RPC ainda aceita `retirada`, que não aparece no front nem no `CONFIG.modos`; o painel continua sabendo exibir pedidos antigos com esse modo) |
| `endereco` | |
| `referencia` | |
| `pagamento` | |
| `troco` | |
| `distancia_km` | `numeric(6,3)` null: km da rota informados pelo checkout (entrega); null = taxa a combinar |
| `taxa_entrega` | `numeric(10,2)` null: taxa calculada pelo banco (já somada ao `total`); null = a combinar |
| `obs` | |
| `itens` | `jsonb` |
| `total` | `numeric(10,2)` |
| `status` | `novo` · `preparo` · `pronto` · `rota` · `entregue` · `cancelado` |
| `historico` | `jsonb` |
| `atualizado_em` | |
| `idempotencia` | `uuid unique` null |

**`equipe`**: `user_id uuid pk references auth.users on delete cascade`, `nome text`.

**`motoboys`** (migration `20261017000001`): quem pode confirmar entregas pela tela `/motoboy/`. **O motoboy nunca entra em `equipe`** (daria o painel inteiro e os dados de todos os clientes).

| Coluna | Tipo |
|---|---|
| `user_id` | `uuid` pk `references auth.users on delete cascade` |
| `nome` | `text not null default ''` |
| `ativo` | `boolean not null default true`. `false` corta o acesso sem apagar a linha |

Liberar um motoboy (usuário criado em Authentication → Users com Auto Confirm): `insert into public.motoboys (user_id, nome) select id, 'Motoboy' from auth.users where email = 'EMAIL_AQUI' on conflict do nothing;` (o comando também está no rodapé do `setup.sql`). Cortar: `update public.motoboys set ativo = false where user_id = (select id from auth.users where email = 'EMAIL_AQUI');`.

### RLS

| Tabela | `anon` | `authenticated` |
|---|---|---|
| `produtos`, `adicionais`, `loja` | select | select |
| `pedidos`, `clientes` | nada | select só se `is_equipe()` |
| `equipe` | nada | select da própria linha |
| `motoboys` | nada | select da própria linha, só se `ativo` (policy `motoboys_proprio`; um motoboy desativado não enxerga nem a própria linha) |

- **Nenhum insert, update ou delete direto**: tudo passa por RPC. Revogar das tabelas os privilégios de escrita de `anon` e `authenticated`.
- O motoboy **não** lê `pedidos`, `clientes` nem `equipe` e não chama as funções da equipe (`mudar_status` etc.): tudo o que ele vê de um pedido vem das duas funções do motoboy abaixo.
- **Realtime:** `pedidos`, `produtos` e `loja` na publicação `supabase_realtime`.

## RPCs (`supabase.rpc(nome, args)`)

### `criar_pedido(p jsonb) → jsonb` (anon, authenticated)

Entrada: o que o checkout já monta, com os itens no formato de `itemDoPedido` do `core.js`.

```json
{
  "cliente": { "nome": "Ana", "telefone": "11985720150" },
  "modo": "entrega", "endereco": "Rua X, 10", "referencia": "", "pagamento": null, "troco": "", "obs": "",
  "distanciaKm": 3.2, "origem": "cardapio", "mesa": null, "idempotencia": "uuid gerado pelo navegador a cada envio novo",
  "itens": [{ "produtoId": "gran-bacon-onion", "qtd": 1, "completo": false, "removidos": ["Cebola roxa"],
              "prensado": true, "combo": { "ativo": true, "refri": "Guaraná" },
              "adicionais": [{ "id": "bacon", "qtd": 1 }], "sabor": "" }]
}
```

**Validação e normalização no servidor** (espelho exato do `core.js`):

- `nome`: 2 a 80 caracteres. `telefone`: só dígitos, 10 ou 11. `modo` válido. `endereco` obrigatório e com 5 a 200 caracteres quando `modo = 'entrega'`. Limites: `referencia` ≤ 120, `obs` ≤ 300, `troco` ≤ 40, `pagamento` ≤ 30, `mesa` ≤ 10.
- **Compatibilidade anterior à ativação da cotação (migration `20261016000001`).** Com `cotacao_ativa=true`, valem as regras de cotação no início deste documento: novas entregas sem cotação são recusadas. No caminho anterior, somente em `modo = 'entrega'`, o navegador manda `distanciaKm` (km da rota de carro do truck até o endereço, de 0 a 100, número JSON; qualquer outro tipo, 0, negativo ou acima de 100 → `dados_invalidos`). O banco guarda `distancia_km` (3 casas) e calcula `taxa_entrega = ceil(distancia_km) × loja.taxa_km + loja.taxa_fixa`, **sempre arredondando os km para cima** (3,2 km = 4 km; 3,0004 km = 3 km, porque a conta é em metros). A taxa **entra no `total`**. Sem `distanciaKm` (falha da consulta de endereço, ou modo `local`) a taxa e a distância ficam `null` = "a combinar", e o `total` é só dos itens. Tudo que o navegador mandar de taxa ou total é ignorado.
- `origem`: `cardapio` ou `qrcode`; `exemplo` só se `is_equipe()`.
- Itens: de 1 a 30 linhas; `qtd` de 1 a 20; produto existe, está ativo, **tem preço** (`preco` não é `null`) e não está esgotado no dia. Item sem preço recusa o pedido inteiro com `produto_invalido`, também para a equipe.
- `removidos` filtrados para os que estão em `ingredientes` e ordenados; `completo = (removidos vazio)`.
- `prensado` só vale se `tipo` for `lanche` ou `combo`.
- `combo.ativo` só vale se `tipo = 'lanche'`; `refri` ≤ 40.
- `adicionais` só valem para `lanche` ou `combo`, com id ativo e `qtd` de 1 a 5.
- `sabor` ≤ 40.
- **Preço:** `precoUnit = preco + (combo ? loja.combo_preco : 0) + Σ adicional.preco × qtd`; `subtotal = precoUnit × qtd`; `total = Σ subtotal` (2 casas).
- **`resumo` é gerado no servidor**, com o mesmo texto do `resumo()` do `core.js`. Exemplo: `Sem cebola roxa · Prensado · Combo +R$14,90 (Guaraná) · + Bacon`.
- **Loja:** aberta = `modo = 'aberta'` ou (`modo = 'auto'` e dentro do turno de `horarios`, atravessando a meia-noite como em `ML.horario`). Fechada e `aceita_fechada = false` → `loja_fechada`. Quem é da equipe ignora essa regra e o limite de pedidos.
- **Idempotência:** se já existe pedido com a mesma `idempotencia`, devolve esse pedido sem gravar outro e sem contar no limite. Isso protege contra reenvio por queda de rede.
- Grava o pedido (`status = 'novo'`, `historico = [{status:'novo', em}]`) e faz upsert em `clientes` (o último nome e endereço informados para o telefone vencem, sem verificação: `clientes` não é fonte de identidade).

**Saída:** `pedido_json(pedido)`, no formato do contrato do painel mais `token` e `mesa`:

```json
{ "id": "uuid", "numero": 7, "token": "uuid", "criadoEm": "2026-10-08T22:01:02.123+00:00", "origem": "cardapio", "mesa": null,
  "cliente": { "nome": "Ana", "telefone": "11985720150" }, "modo": "entrega", "endereco": "...", "referencia": "",
  "pagamento": null, "troco": "", "obs": "",
  "itens": [{ "produtoId": "...", "nome": "...", "categoria": "...", "tipo": "lanche", "precoBase": 34.9, "precoUnit": 57.3, "qtd": 1,
              "completo": false, "removidos": ["Cebola roxa"], "prensado": true, "combo": { "ativo": true, "refri": "Guaraná" },
              "adicionais": [{ "id": "bacon", "nome": "Bacon", "qtd": 1, "preco": 7.5 }], "sabor": "", "resumo": "...", "subtotal": 57.3 }],
  "total": 57.3, "distanciaKm": 3.2, "taxaEntrega": 8, "status": "novo", "historico": [{ "status": "novo", "em": "..." }] }
```

Os números saem como números JSON, não como texto.

### `acompanhar_pedido(p_token uuid) → jsonb | null` (anon, authenticated)

Devolve `{ numero, criadoEm, status, historico, modo, total, itens: [{ nome, qtd, resumo, subtotal }] }`. **Não devolve** nome, telefone nem endereço.

### `estado_cardapio() → jsonb` (anon, authenticated)

O retorno também contém `catalogo: { categorias, produtos }`, fonte persistente para nomes, categorias, composição, fotos e novos itens. O painel usa `salvar_produto(p_dados jsonb, p_versao timestamptz)` com autorização da equipe e verificação de versão; mantém o contrato de preços/inativos/esgotados abaixo. Operação e armazenamento em [Produtos](PRODUTOS.md).

```json
{ "diaOperacional": "2026-10-08", "esgotados": ["gran-crispy"], "inativos": [], "precos": { "gran-burger": 25.9 },
  "adicionais": { "bacon": 7.5 }, "loja": { "modo": "auto", "aceitaFechada": false, "comboPreco": 14.9, "taxaKm": 1, "taxaFixa": 4, "horarios": { } } }
```

`precos` traz todos os produtos, inclusive os inativos; o de um item sem preço vem `null` (ex.: `"dog-cbo-turbo": null`). Hoje o adaptador (`store-supabase.js`) só aplica preços numéricos: um `null` do banco mantém o preço do `CONFIG`, que é o mesmo do seed.

O front aplica isso sobre o `CONFIG` ao abrir. Repete quando chega aviso do Realtime em `produtos` ou `loja`, e a cada 60 s mesmo com o canal ligado (`adicionais` não está no Realtime: adicional desativado ou com preço novo chega por essa consulta). Adicional ausente de `adicionais` é inativo: a sacola marca a linha que o tem e o checkout não envia até ele sair.

### Preço a confirmar (`preco` null) no front

| Onde | Comportamento |
|---|---|
| `core.js` | `ML.fmt.brl(null)` devolve `"Preço a confirmar"` (`ML.fmt.semPreco`); `ML.regras.temPreco(p)` diz se o produto tem preço; `ML.precos.unitario()` devolve `null` e o `subtotal` do item sai `null`. `ML.whatsapp.consulta(p)` monta a mensagem pronta de consulta. |
| Cardápio | O card mostra "Preço a confirmar" no lugar do preço e não oferece "Vira combo". |
| Ficha | Mostra nome, foto, descrição e "Consultar no WhatsApp" (`#ficha-consulta`, `wa.me` com a mensagem pronta), sem as opções de montar. O botão de adicionar fica `aria-disabled="true"` com o texto "Preço a confirmar" e não adiciona. |
| Sacola | O item nunca entra: `addSacola` recusa e a sacola guardada no aparelho é filtrada ao abrir. |
| Banco | `criar_pedido` recusa com `produto_invalido` (última barreira). |
| Painel | A lista de esgotados mostra "Preço a confirmar"; esgotar e liberar funcionam normalmente. |

Quando o dono mandar o preço: troque o `null` pelo valor no `CONFIG`, rode `npm run seed && npm run setup-sql` e aplique o `setup.sql`.

### Funções só da equipe (`sem_permissao` se não for `is_equipe()`)

| Função | Retorno | Regra |
|---|---|---|
| `mudar_status(p_id uuid, p_status text, p_motivo text default null)` | `jsonb` (`pedido_json`) | Permitido: `novo→preparo`; `preparo→pronto` se o modo não é entrega, ou `preparo→rota` se é; `pronto` ou `rota → entregue`; qualquer status não final `→ cancelado`, com motivo de 1 a 200 caracteres. Pedido de origem `exemplo` aceita qualquer transição. Acrescenta `{status, em, motivo?}` ao `historico`. |
| `marcar_esgotado(p_produto text, p_esgotado boolean)` | `void` | Grava `esgotado_dia = dia_operacional()` ou `null`. |
| `definir_loja(p_modo text)` | `jsonb` | O mesmo bloco `loja` do `estado_cardapio`. |
| `remover_testes()` | `int` | Apaga os pedidos com `origem = 'exemplo'`. |

### Contrato histórico do motoboy (17/10, substituído)

As regras desta seção documentam a versão anterior. O contrato vigente está em **Controle de entregadores — 18/10/2026**, ao final deste documento: exige atribuição própria e saída registrada, sem listagem geral nem conclusão direta pela equipe.

Migrations `20261017000001_motoboy.sql` e `20261017000002_confirmar_entrega_ja_entregue.sql` (17/10: o caminho "já entregue" deixa de mandar os dados do cliente). O QR da comanda leva a `https://<domínio>/motoboy/#<id do pedido>` (só pedidos de entrega); a tela do motoboy, depois do login, chama `confirmar_entrega` com esse `id`. A segurança vem do login e destas funções, não do QR. Quem não está em `motoboys` (ativo) nem em `equipe` recebe `sem_permissao` antes de qualquer outra validação; `anon` leva 42501 (sem `execute`).

| Função | Retorno | Regra |
|---|---|---|
| `entregas_em_rota()` | `jsonb` (lista de `entrega_json`) | Só `modo = 'entrega'`, `status = 'rota'` e criados no **dia de operação atual** (mesmo corte de 4h do `dia_operacional()`): os pedidos presos em `rota` de dias anteriores ficam de fora. Mais antigo primeiro. Sem nenhum: `[]`. A equipe também pode chamar. |
| `confirmar_entrega(p_id uuid)` | `{ ok, jaEntregue, pedido }` | Marca o pedido como entregue. `pedido` é o `entrega_json` do pedido já atualizado; se ele já estava entregue, só `{ id, numero, status }`. Regras abaixo. |

**`entrega_json`** (interna, sem grant): o recorte que o motoboy enxerga de um pedido, **sem itens, sem token e sem histórico**. Chaves exatas:

```json
{ "id": "uuid", "numero": 11, "status": "rota",
  "cliente": { "nome": "Ana", "telefone": "11985720150" },
  "endereco": "Rua X, 10", "referencia": "Portão azul", "obs": "Sem cebola",
  "total": 32.9, "taxaEntrega": 7, "distanciaKm": 2.5,
  "saiuEm": "2026-10-17T21:10:00.000+00:00", "entregueEm": null }
```

`taxaEntrega` e `distanciaKm` são `null` quando a taxa ficou "a combinar". `saiuEm` e `entregueEm` vêm do `historico` (o `em` do último evento com esse status) e são `null` enquanto o pedido não passou por esse status. Números saem como números JSON.

**Regras do `confirmar_entrega`** (a linha do pedido é travada com `for update`):

| Situação do pedido | Resultado |
|---|---|
| `id` nulo | `dados_invalidos` |
| `id` inexistente | `nao_encontrado` |
| `modo` diferente de `entrega` (qualquer status) | `nao_e_entrega` |
| `entregue` | `{ ok: true, jaEntregue: true, pedido: { id, numero, status } }` **sem update**: o histórico e o `atualizado_em` não mudam (ler o QR duas vezes, ou depois da equipe, não é erro). Sem nome, telefone nem endereço: a função não recorta o dia de operação, e um `id` antigo não deve mostrar o cliente |
| `cancelado` | `pedido_cancelado` |
| `novo` (a equipe ainda nem aceitou) | `transicao_invalida` |
| `rota` ou `pronto` | grava `entregue` |
| `preparo` | grava `rota` e depois `entregue` (os dois eventos com o mesmo `em`), para o histórico e a tela do cliente continuarem em ordem |

Todo evento gravado por `confirmar_entrega` leva `"por"`: `{ "status": "entregue", "em": "...", "por": "motoboy" }`. O `por` é `motoboy` para quem está em `motoboys` (ativo) e `equipe` para quem está só em `equipe`; quem está nas duas tabelas conta como `motoboy`, porque esta é a função da tela do motoboy. Os eventos de `mudar_status` continuam sem `por`. Pedido de origem `exemplo` segue as mesmas regras (não tem a exceção do `mudar_status`).

Funções internas novas (sem grant a `anon` nem `authenticated`): `is_motoboy()` (considera `ativo`) e `entrega_json(pedidos)`.

### Leitura do painel

```js
supabase.from('pedidos').select('*').gte('criado_em', <48 h atrás>).order('criado_em')
```

O RLS garante que só a equipe lê. O Realtime em `pedidos` entrega a linha crua (snake_case). O adaptador converte com `linhaParaPedido(row)` para o mesmo formato de `pedido_json` e aplica `Number()` em `total`, `precoUnit` e `subtotal`.

- O canal do painel entra com o JWT da equipe (`realtime.setAuth()` antes do `subscribe`): sem ele o Realtime usa a apikey (anon) e o RLS de `pedidos` filtra todos os eventos.
- `historico` só cresce (um item por mudança de status) e serve de versão: o adaptador nunca troca um pedido do cache por uma versão com `historico` menor, e a resposta de uma consulta não desfaz o que chegou pelo Realtime ou por RPC enquanto ela estava no ar.

## Ambiente local de teste

```bash
bash scripts/supabase-local/iniciar.sh   # Postgres 16/17 :54322 + PostgREST :54323 + proxy :54321 (Linux ou Git Bash no Windows)
```

- Para aplicar o SQL: `psql postgresql://postgres@localhost:54322/postgres -f supabase/setup.sql`; em seguida, `notify pgrst, 'reload schema'`.
- Login da equipe: `equipe@teste.local` com qualquer senha. Esse usuário precisa estar em `equipe`: o `supabase/tests/` insere.
- Login do motoboy: `moto@teste.local` (id `00000000-0000-4000-8000-000000000003`, criado pelo `stub.sql`) com qualquer senha. Precisa estar em `motoboys`: o `supabase/tests/_ajuda.sql` e o `scripts/testar-paridade.mjs` inserem (`on conflict do nothing`).
- Não existe Realtime local. O front **precisa** funcionar só com o plano B de consulta periódica: painel a cada 5 s, cardápio a cada 60 s, acompanhamento a cada 10 s.
- **Atualização por cima da versão anterior.** O `setup.sql` novo roda sobre o de 08/10/2026 (`preco` era `not null`; o `0001` faz `alter column preco drop not null`). Pedidos, clientes, esgotados e o modo da loja ficam como estavam; preços, composições e horários vêm do `CONFIG`. Para testar sem mexer no banco `postgres` compartilhado, use um banco à parte:

  ```bash
  B=postgresql://postgres@localhost:54322
  psql $B/postgres -c 'drop database if exists upgrade' -c 'create database upgrade'
  psql $B/upgrade -f scripts/supabase-local/stub.sql
  git show <versão anterior>:supabase/setup.sql | psql $B/upgrade -v ON_ERROR_STOP=1 -f -
  psql $B/upgrade -v ON_ERROR_STOP=1 -f supabase/setup.sql
  PG_URL=$B/upgrade bash scripts/testar-sql.sh
  ```


## Gestão de usuários (18/10)

A Edge Function `gerenciar-usuarios` exige JWT de usuário e valida a sessão em Auth. `acao: sessao` retorna apenas `{ administrador, id }` do próprio usuário. As ações `listar`, `criar`, `vincular`, `editar` e `senha` exigem administrador ativo no cadastro privado e na equipe. Campos de cadastro/edição: `{ nome, email?, perfil: 'admin'|'equipe'|'motoboy', ativo, id? }`; criação exige `senha` de 10 a 128 caracteres. `vincular` libera Auth preexistente sem alterar sua senha; `editar` preserva o e-mail do registro. A ação `senha` recebe apenas `id` e `senha`. Respostas de usuário incluem somente `user_id,nome,email,perfil,ativo`.

`usuarios_painel` e `usuarios_painel_eventos` têm RLS e são privadas ao backend. `gerir_acesso_usuario(uuid,uuid,text,text,text,boolean)` é invoker e só `service_role` executa. Sincroniza equipe/motoboy, registra auditoria sem senha e protege o próprio administrador. Equipe comum e motoboys não promovem permissões nem enumeram usuários diretamente. Consulte [operação e primeiro administrador](USUARIOS-PAINEL.md).

### Mercado Pago — branch `feat/mercado-pago`

Migration `20261018185421`: `loja_json().pagamentosAtivos` (false inicialmente); `pedido_json` e `acompanhar_pedido` acrescentam `pagamentoOnline`/`pagamentoEm`, nulos no legado. Pedidos da equipe recebem os mesmos campos na tabela (`pagamento_online`, `pagamento_em`). As tabelas `pagamentos_mp` e `pagamentos_mp_eventos` são privadas, com RLS e privilégios só de service_role; helpers financeiros usam invoker e não são executáveis por anon/authenticated. Não incluir e-mail, credenciais, order ou checkout_url no acompanhamento público.

`POST /functions/v1/mercado-pago`: `iniciar {token,email}` → `{estado,checkoutUrl,processando}`; `consultar {token}` → mesmo recorte; `estornar {pedidoId}` exige JWT real e administrador ativo, pedido cancelado e pagamento aprovado; `reconciliar` exige credencial de backend. `POST /functions/v1/mercado-pago-webhook` exige HMAC Mercado Pago e busca a order na API. Valor, conta, aplicação, ambiente e status são conferidos antes de chamar `registrar_pagamento_mp`. Detalhes, erros e homologação: `docs/MERCADO-PAGO.md`.

Novos erros de RPC: `pagamento_pendente` bloqueia preparo/entrega sem aprovação; `pagamento_valor_invalido` recusa cobrança zero/entrega sem taxa. Edge: `pagamento_nao_configurado` (503), `pagamento_indisponivel` (503), `pagamento_divergente` (422), `assinatura_invalida` (401), `email_invalido`, `pagamento_encerrado`, `cancele_antes_de_estornar` (422), `sem_permissao` (403), `nao_encontrado` (404). Flag desligada não libera pedidos online existentes sem pagamento.


## Controle de entregadores — 18/10/2026

O contrato operacional de `docs/ENTREGADORES.md` substitui a listagem geral anterior do motoboy. `entregas_em_rota()` e `minhas_entregas()` devolvem somente as próprias atribuições abertas, sem corte de data, com `atribuicao`, `atribuidoEm` e os campos mínimos de `entrega_json`. `consultar_entrega_motoboy(p_id)` valida a própria atribuição no QR; encerrados devolvem somente identificação e versão.

RPCs da equipe: `painel_entregadores(p_dias=1)` (1/7/30), `atribuir_entrega(p_id,p_motoboy,p_sair=false)`, `baixar_entrega_manual(p_id,p_motivo)` e `historico_entrega(p_id)`. RPCs do motoboy: `confirmar_entrega_offline(p_id,p_evento,p_atribuicao,p_confirmado_em)`, `comunicar_entregador()`, `minhas_taxas_entrega(p_dias=1)` (1/7/30, sempre o próprio usuário ativo) e `reconhecer_cancelamento_entrega` com os mesmos quatro argumentos da confirmação. Nenhum autor enviado pelo navegador é aceito.

Taxas (19/10): `painel_entregadores.entregadores[]` inclui `taxas: {concluidas, emAberto, qtdConcluidas, qtdEmAberto, semTaxaConcluidas, semTaxaEmAberto}` e cada pedido inclui `taxaEntrega`. `minhas_taxas_entrega` devolve `{dias, inicio, servidorEm, taxas}` com o mesmo cálculo, sem dados de clientes ou dos outros motoboys. Concluídas somam `taxa_entrega` de pedidos efetivamente entregues e atribuídos ao usuário, pelo recebimento no servidor dentro do período operacional, inclusive baixa manual; abertas somam preparo/pronto/rota atribuídos de qualquer data. Cancelamentos e histórico sem vínculo ficam fora. Valores nulos são contados nos campos `semTaxa*`; não são tratados como taxa zero confirmada. O helper `taxas_entregador(uuid,timestamptz)` não é executável por `anon` ou `authenticated`.

Confirmação: `{ok,jaEntregue,pedido}`. Mesmo evento ou pedido já entregue recebe reconhecimento sem repetir o encerramento. Confirmação posterior à baixa manual gera somente auditoria. Cancelamento conferido: `{ok:true,ocorrencia:true,evento}`; não altera status. Tabelas operacionais têm RLS e nenhum privilégio direto de anon/authenticated. `mudar_status` também exige motivo para conclusão manual de entrega.

Atualização de 19/10: `painel_entregadores` inclui conclusões sem controle individual no período do último evento `entregue` do histórico original. Retorna `legado:true`, `encerramento:'anterior'` e `recebidoEm` desse evento; não inventa `motoboyId`, `atribuicao` ou `confirmadoEm`. A consulta não modifica pedidos. Baixas manuais atuais com evento operacional mantêm `legado:false`. O acesso continua exclusivo da equipe.

## Viagens e planejamento — 19/10/2026

Guia vigente: [ROTAS-OPERACAO.md](ROTAS-OPERACAO.md). A entrega avança `preparo → pronto → rota → entregue`; o caminho legado de preparo direto para rota permanece para recuperação manual. Uma viagem reservada mantém todos os pedidos prontos. A saída da viagem é atômica e exige reconhecimento da sua versão pelo motoboy. O DTO de `minhas_entregas()` acrescenta `viagemId`, `ordemViagem` e `versaoViagem` (nulos para atribuição individual), conservando a versão `atribuicao` de cada pedido.

RPCs autenticadas, com autorização verificada no servidor:

| RPC | Escopo e efeito |
|---|---|
| `painel_rotas_entregas()` | Equipe: `{config,entregadores,prontos,planos,viagens,ultimaExecucao,servidorEm}` e consumo interno estimado; nunca retorna token do job |
| `configurar_rotas(p_modo,p_regras,p_limite=1000,p_versao=null)` | Equipe, versão e origem confirmada; regras obrigatórias em modo assistido/automático |
| `definir_disponibilidade_entregador(p_situacao,p_motoboy=null,p_motivo=null)` | Próprio motoboy ativo ou equipe; alterar outra pessoa exige motivo; não libera viagem aberta |
| `minha_operacao_rotas()` | Próprio motoboy ativo: `{entregador,viagem,modo,servidorEm}`, sem dados das outras viagens |
| `reservar_viagem_entrega(p_plano,p_motoboy=null)` | Equipe; revalida e reserva o conjunto, idempotente por sugestão |
| `reconhecer_carregamento_viagem(p_id,p_versao)` | Somente o próprio motoboy ativo, versão atual reservada |
| `iniciar_viagem_entrega(p_id,p_versao)` | Equipe ou próprio motoboy; exige carga reconhecida, sem revisão pendente; não permite saída individual de pedidos da viagem |
| `desfazer_viagem_entrega(p_id,p_versao,p_motivo)` | Equipe, antes da saída; conserva pedidos prontos, remove reserva aberta e pausa seleção automática |
| `liberar_planejamento_pedidos(p_ids)` | Equipe, 1–12 IDs distintos prontos e sem viagem; retira a pausa explícita |
| `conferir_destino_pedido(p_id,p_lat,p_lon,p_motivo)` | Equipe antes da reserva/saída, ponto confirmado por 30 dias, sem alterar taxa aceita |
| `retornar_viagem_entrega(p_id,p_versao,p_motivo=null)` | Próprio motoboy ou equipe com motivo; exige todas as baixas no servidor; retorno idempotente |

`config.regras` contém `maxPedidos` (inteiro 1–6), `esperaMin` (1–120), `trajetoMin` (1–180), `desvioMin` (0–120) e `paradaMin` (0–15). Não há valores comerciais predefinidos. DTOs de sugestão/viagem contêm entregador, sequência de paradas, estimativas e geometria vigente. Viagem inclui `versao`, `carregadaVersao`, `revisaoPendente`, `saiuEm` e `estado`; paradas preservam `atribuicao`. `geometriaAte` e `pontoAte` permitem expirar dados no cache local.

A Edge Function `planejar-entregas` recebe `{acao:'calcular'|'verificar',pedidos?:uuid[],ordemFixa?:boolean}` com JWT de equipe, validado em Auth. Seleção explícita: até seis IDs distintos. A ação automática só aceita token privado do agendamento, sem autor do navegador. A resposta resume `{estado,planos,reservadas,verificacao}`, sem coordenadas, matriz ou credenciais. A equipe consulta as sugestões pela RPC. `iniciar_planejamento_entregas`/`concluir_planejamento_entregas` são exclusivos de `service_role`. Helpers invoker, tabelas, cache e auditoria são privados; nenhuma nova leitura direta de anon/authenticated.

Confirmações offline usam o mesmo protocolo e idempotência anteriores. Reserva, disponibilidade, reconhecimento de carga e retorno exigem conexão; esses comandos não entram na fila de confirmações. Cancelamento parcial antes da saída invalida a carga e exige replanejamento. Após todas as baixas a viagem fica `retornando`, até o retorno explícito.
