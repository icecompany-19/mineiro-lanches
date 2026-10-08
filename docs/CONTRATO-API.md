# Contrato banco ⇄ front (Supabase)

Fonte única para quem escreve o SQL (`supabase/`) e para quem escreve o adaptador (`src/lib/`). Mudou algo aqui? Os dois lados mudam juntos.

## Convenções

- Schema `public`. Funções `security definer`, `set search_path = public, pg_temp`, nomes em português.
- Erros de regra: `raise exception '<codigo>' using errcode = 'P0001'`. O texto da mensagem **é só o código**, para o front traduzir:

| Código | Quando |
|---|---|
| `dados_invalidos` | Campo obrigatório ausente ou formato errado |
| `produto_invalido` | Id inexistente ou inativo; opção não permitida para o tipo |
| `produto_esgotado` | Item esgotado no dia de operação |
| `loja_fechada` | Loja fechada e `aceita_fechada = false` |
| `muitos_pedidos` | Mais de 5 pedidos do mesmo telefone em 10 min (só `anon`) |
| `sem_permissao` | Função de equipe chamada por quem não está em `equipe` |
| `transicao_invalida` | Mudança de status fora da ordem |
| `nao_encontrado` | Id ou token inexistente |

- **Dia de operação.** `dia_operacional()` devolve `((now() at time zone 'America/Sao_Paulo') - interval '4 hours')::date`. É o mesmo corte de 4h do painel (`DIA_OP_OFFSET`).

## Tabelas

**`produtos`**

| Coluna | Tipo |
|---|---|
| `id` | `text` pk |
| `categoria` | `text` |
| `nome` | `text` |
| `preco` | `numeric(10,2)` |
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
| `horarios` | `jsonb`, igual ao `CONFIG.horarios`: `{"0":null,"1":["19:00","00:00"],…}` |
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
| `modo` | `entrega` · `retirada` · `local` |
| `endereco` | |
| `referencia` | |
| `pagamento` | |
| `troco` | |
| `obs` | |
| `itens` | `jsonb` |
| `total` | `numeric(10,2)` |
| `status` | `novo` · `preparo` · `pronto` · `rota` · `entregue` · `cancelado` |
| `historico` | `jsonb` |
| `atualizado_em` | |
| `idempotencia` | `uuid unique` null |

**`equipe`**: `user_id uuid pk references auth.users on delete cascade`, `nome text`.

### RLS

| Tabela | `anon` | `authenticated` |
|---|---|---|
| `produtos`, `adicionais`, `loja` | select | select |
| `pedidos`, `clientes` | nada | select só se `is_equipe()` |
| `equipe` | nada | select da própria linha |

- **Nenhum insert, update ou delete direto**: tudo passa por RPC. Revogar das tabelas os privilégios de escrita de `anon` e `authenticated`.
- **Realtime:** `pedidos`, `produtos` e `loja` na publicação `supabase_realtime`.

## RPCs (`supabase.rpc(nome, args)`)

### `criar_pedido(p jsonb) → jsonb` (anon, authenticated)

Entrada: o que o checkout já monta, com os itens no formato de `itemDoPedido` do `core.js`.

```json
{
  "cliente": { "nome": "Ana", "telefone": "11985720150" },
  "modo": "entrega", "endereco": "Rua X, 10", "referencia": "", "pagamento": null, "troco": "", "obs": "",
  "origem": "cardapio", "mesa": null, "idempotencia": "uuid gerado pelo navegador a cada envio novo",
  "itens": [{ "produtoId": "gran-bacon-onion", "qtd": 1, "completo": false, "removidos": ["Cebola roxa"],
              "prensado": true, "combo": { "ativo": true, "refri": "Guaraná" },
              "adicionais": [{ "id": "bacon", "qtd": 1 }], "sabor": "" }]
}
```

**Validação e normalização no servidor** (espelho exato do `core.js`):

- `nome`: 2 a 80 caracteres. `telefone`: só dígitos, 10 ou 11. `modo` válido. `endereco` obrigatório e com 5 a 200 caracteres quando `modo = 'entrega'`. Limites: `referencia` ≤ 120, `obs` ≤ 300, `troco` ≤ 40, `pagamento` ≤ 30, `mesa` ≤ 10.
- `origem`: `cardapio` ou `qrcode`; `exemplo` só se `is_equipe()`.
- Itens: de 1 a 30 linhas; `qtd` de 1 a 20; produto existe, está ativo e não está esgotado no dia.
- `removidos` filtrados para os que estão em `ingredientes` e ordenados; `completo = (removidos vazio)`.
- `prensado` só vale se `tipo` for `lanche` ou `combo`.
- `combo.ativo` só vale se `tipo = 'lanche'`; `refri` ≤ 40.
- `adicionais` só valem para `lanche` ou `combo`, com id ativo e `qtd` de 1 a 5.
- `sabor` ≤ 40.
- **Preço:** `precoUnit = preco + (combo ? loja.combo_preco : 0) + Σ adicional.preco × qtd`; `subtotal = precoUnit × qtd`; `total = Σ subtotal` (2 casas).
- **`resumo` é gerado no servidor**, com o mesmo texto do `resumo()` do `core.js`. Exemplo: `Sem cebola roxa · Prensado · Combo +R$14,90 (Guaraná) · + Bacon`.
- **Loja:** aberta = `modo = 'aberta'` ou (`modo = 'auto'` e dentro do turno de `horarios`, atravessando a meia-noite como em `ML.horario`). Fechada e `aceita_fechada = false` → `loja_fechada`. Quem é da equipe ignora essa regra e o limite de pedidos.
- **Idempotência:** se já existe pedido com a mesma `idempotencia`, devolve esse pedido sem gravar outro e sem contar no limite. Isso protege contra reenvio por queda de rede.
- Grava o pedido (`status = 'novo'`, `historico = [{status:'novo', em}]`) e faz upsert em `clientes`.

**Saída:** `pedido_json(pedido)`, no formato do contrato do painel mais `token` e `mesa`:

```json
{ "id": "uuid", "numero": 7, "token": "uuid", "criadoEm": "2026-10-08T22:01:02.123+00:00", "origem": "cardapio", "mesa": null,
  "cliente": { "nome": "Ana", "telefone": "11985720150" }, "modo": "entrega", "endereco": "...", "referencia": "",
  "pagamento": null, "troco": "", "obs": "",
  "itens": [{ "produtoId": "...", "nome": "...", "categoria": "...", "tipo": "lanche", "precoBase": 34.9, "precoUnit": 57.3, "qtd": 1,
              "completo": false, "removidos": ["Cebola roxa"], "prensado": true, "combo": { "ativo": true, "refri": "Guaraná" },
              "adicionais": [{ "id": "bacon", "nome": "Bacon", "qtd": 1, "preco": 7.5 }], "sabor": "", "resumo": "...", "subtotal": 57.3 }],
  "total": 57.3, "status": "novo", "historico": [{ "status": "novo", "em": "..." }] }
```

Os números saem como números JSON, não como texto.

### `acompanhar_pedido(p_token uuid) → jsonb | null` (anon, authenticated)

Devolve `{ numero, criadoEm, status, historico, modo, total, itens: [{ nome, qtd, resumo, subtotal }] }`. **Não devolve** nome, telefone nem endereço.

### `estado_cardapio() → jsonb` (anon, authenticated)

```json
{ "diaOperacional": "2026-10-08", "esgotados": ["gran-crispy"], "inativos": [], "precos": { "gran-burger": 25.9 },
  "adicionais": { "bacon": 7.5 }, "loja": { "modo": "auto", "aceitaFechada": false, "comboPreco": 14.9, "horarios": { } } }
```

O front aplica isso sobre o `CONFIG` ao abrir. Repete quando chega aviso do Realtime em `produtos` ou `loja`, ou a cada 60 s como plano B.

### Funções só da equipe (`sem_permissao` se não for `is_equipe()`)

| Função | Retorno | Regra |
|---|---|---|
| `mudar_status(p_id uuid, p_status text, p_motivo text default null)` | `jsonb` (`pedido_json`) | Permitido: `novo→preparo`; `preparo→pronto` se o modo não é entrega, ou `preparo→rota` se é; `pronto` ou `rota → entregue`; qualquer status não final `→ cancelado`, com motivo de 1 a 200 caracteres. Pedido de origem `exemplo` aceita qualquer transição. Acrescenta `{status, em, motivo?}` ao `historico`. |
| `marcar_esgotado(p_produto text, p_esgotado boolean)` | `void` | Grava `esgotado_dia = dia_operacional()` ou `null`. |
| `definir_loja(p_modo text)` | `jsonb` | O mesmo bloco `loja` do `estado_cardapio`. |
| `remover_testes()` | `int` | Apaga os pedidos com `origem = 'exemplo'`. |

### Leitura do painel

```js
supabase.from('pedidos').select('*').gte('criado_em', <48 h atrás>).order('criado_em')
```

O RLS garante que só a equipe lê. O Realtime em `pedidos` entrega a linha crua (snake_case). O adaptador converte com `linhaParaPedido(row)` para o mesmo formato de `pedido_json` e aplica `Number()` em `total`, `precoUnit` e `subtotal`.

## Ambiente local de teste

```bash
bash scripts/supabase-local/iniciar.sh   # Postgres 16 :54322 + PostgREST :3000 + proxy :54321
```

- Para aplicar o SQL: `psql postgresql://postgres@localhost:54322/postgres -f supabase/setup.sql`; em seguida, `notify pgrst, 'reload schema'`.
- Login da equipe: `equipe@teste.local` com qualquer senha. Esse usuário precisa estar em `equipe`: o `supabase/tests/` insere.
- Não existe Realtime local. O front **precisa** funcionar só com o plano B de consulta periódica: painel a cada 5 s, cardápio a cada 60 s, acompanhamento a cada 10 s.
