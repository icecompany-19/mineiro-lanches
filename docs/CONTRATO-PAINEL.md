# Contrato do painel de pedidos: Mineiro Lanche

Quem constrói: agente `frontend`. Quem integra e revisa: sessão principal.
Entregar **dois arquivos** nesta pasta: `painel.js` e `painel.css`. Não editar `core.js`, `page.html` nem nada fora desta pasta.

## 1. Onde o painel vive
- A página (`page.html`, feita pela sessão principal) carrega, nesta ordem:
  1. `<link rel="stylesheet" href="painel.css">` no `<head>`;
  2. `<script src="core.js"></script>`;
  3. o script do app;
  4. `<script src="painel.js"></script>` no fim do `<body>`.
- Existe na página um elemento vazio `<div id="view-painel" class="painel" hidden></div>`. O painel desenha **tudo** dentro dele.
- `painel.js` deve expor:
  ```js
  window.MLPainel = {
    montar(el),   // chamado uma vez pela página com o #view-painel; monta a estrutura e começa a ouvir a store
    mostrar(),    // chamado quando a aba "Painel" fica visível (atualiza relógio, timers, foco)
    esconder()    // chamado quando sai da aba (pausa timers de 1 s)
  };
  ```
- A página cuida da barra de abas e do `hidden`. O painel não mexe em nada fora do `#view-painel`. Toasts e o diálogo de impressão podem usar `document.body`, com classes prefixadas `pn-`.
- Todo CSS fica sob `.painel` ou com prefixo `pn-`, para não colidir com o resto da página. Sem `!important`, salvo dentro de `@media print`.

## 2. API disponível (`window.ML`, de `core.js`; leia o arquivo)
- `ML.CONFIG`: cardápio (`categorias[].itens[]` com `id`, `nome`, `preco`, `tipo`, `foto?`), `adicionais`, `regras.combo` (`preco` 14.90, `inclui`), `modos`, `horarios`, `whatsapp`.
- `ML.produtos[id]`, `ML.adicionais[id]`, `ML.STATUS[status].painel`: rótulo para o painel.
- `ML.fmt.brl(v)`, `ML.fmt.esc(s)` (escape de HTML, use sempre em texto vindo de pedido), `ML.fmt.numero(n)` → `#0007`, `ML.fmt.relogio(min)`.
- `ML.regras.proximoStatus(pedido)` → `'preparo' | 'pronto' | 'rota' | 'entregue' | null`.
- `ML.horario.situacao()` → `{ aberto, txt, manual }`.
- `ML.store`:
  - `pedidos()`, `pedido(id)`, `atualizarStatus(id, status, motivo)`, `avancar(id)`;
  - `removerTestes()`, `gerarExemplos(n)`;
  - `esgotados()` → `{ id: true }`, `marcarEsgotado(id, bool)`;
  - `loja()` → `{ modo: 'auto' | 'aberta' | 'fechada' }`, `definirLoja(modo)`;
  - `config()` → `{ som, atencaoMin, atrasoMin }`, `salvarConfig(obj)`;
  - `ouvir(fn)` → retorna a função de cancelar. `fn` recebe `{ tipo, dados }`. Os tipos são `pedido:novo`, `pedido:status`, `pedidos:limpos`, `cardapio:esgotados`, `loja:modo`, `config` e `storage:<chave>`. Esses eventos chegam também de outras abas (BroadcastChannel + evento `storage`). **Ao receber qualquer evento, releia `ML.store.pedidos()` e redesenhe só o que mudou.**
- `ML.whatsapp.mensagem(pedido)` e `ML.whatsapp.link(texto, telefone?)`.

**Pedido** (já gravado pela store):
```
{ id, numero, criadoEm (ISO), origem: 'cardapio'|'exemplo', cliente: { nome, telefone },
  modo: 'entrega'|'retirada'|'local', endereco, referencia, pagamento|null, troco, obs,
  itens: [{ produtoId, nome, tipo, precoUnit, qtd, completo, removidos[], prensado,
            combo: { ativo, refri }, adicionais: [{ id, nome, qtd, preco }], sabor, resumo, subtotal }],
  total, status: 'novo'|'preparo'|'pronto'|'rota'|'entregue'|'cancelado', historico: [{ status, em, motivo? }] }
```

> Nota: o painel tolera `modo = retirada` legado (D7). O cliente não oferece mais retirada (`CONFIG.modos` só tem `entrega` e `local`), mas o banco ainda aceita o valor; o painel mostra esses pedidos com ícone próprio (`MODO_IC`, `painel.js:25`).

## 3. Identidade (tokens já definidos no `:root` da página; use as variáveis, não repita cores)
- **Cores:**

  | Token | Valor | Uso |
  |---|---|---|
  | `--noite` | #120B09 | fundo do painel (nunca preto puro) |
  | `--chapa` | #1D1310 | colunas, laterais e modais |
  | `--chapa-2` | #281A15 | elevado: campos, segmentados, tempo |
  | `--borda` | #3A2620 | divisória decorativa (não serve de limite de controle) |
  | `--borda-campo` | #94705C | borda de campo e de controle (≥ 3:1) |
  | `--osso` | #FFF3E0 | texto principal no escuro |
  | `--osso-2` | #CDB8A3 | texto secundário no escuro |
  | `--placa` | #C4060C | botão primário e faixa de atraso |
  | `--placa-escura` | #96040A | `:active` do primário |
  | `--branco` | #FFFFFF | texto sobre `--placa` e `--verde` |
  | `--fio` | #FFCC00 | foco, destaque, chip ativo |
  | `--letreiro` | #FFFF00 | títulos em grito (Lilita, ≥ 24 px) |
  | `--grafite` | #1A0A04 | texto sobre `--fio`, ouro, neon, laranja e papel |
  | `--vermelho-luz` | #FF6A5C | erro e fechado, sobre o escuro |
  | `--neon-aberto` | #5BE38A | loja aberta |
  | `--verde` | #2E7D4F | status entregue e selo de adicional `.pn-selo--mais` (texto `--branco`) |
  | `--laranja` | #E8772E | status em preparo e selo de remoção `.pn-selo--sem` (texto `--grafite`) |
  | `--papel` | #FBF6EC | fundo do card de pedido |
  | `--tinta` | #2A1F1A | texto no papel |
  | `--tinta-2` | #6E5B4E | texto secundário no papel |
  | `--linha` | #EBDCC0 | divisória no papel |

  Os nomes antigos de `base.css:44-47` continuam definidos com os valores novos e o painel atual ainda os usa (`--vermelho` = `--placa`, `--amarelo` = `--fio`, `--carvao` = `--noite`, `--creme` = `--osso`, `--cinza-quente` = `--osso-2`). Em tela nova, use os nomes da tabela.

- **Fontes já carregadas:** `--f-letreiro` (Lilita One, títulos), `--f-placa` (Oswald, rótulos, números, colunas em caixa alta), `--f-corpo` (Rubik, texto).
- **Tema do painel: escuro de cozinha** (fundo `--noite`, colunas e laterais `--chapa`, texto `--osso`, secundário `--osso-2`, destaque `--fio`, ação principal `--placa` com texto `--branco`). **Cards de pedido em papel** (`--papel`, texto `--tinta`, divisórias `--linha`); o resto segue escuro. Contraste ≥ 4,5:1 em todo texto.
- **Easings e durações (por token, `base.css:72-76`):** `--mola: cubic-bezier(.34,1.56,.64,1)`, `--suave: cubic-bezier(.2,.8,.2,1)`. Pressão `--t-toque` (160 ms), interface `--t-ui` (280 ms), painel lateral e folha `--t-folha` (320 ms). Regra nova usa o token, não o número. Respeitar `prefers-reduced-motion`.
- **Ícones:** sprite SVG já na página. Use `<svg class="pn-ic" aria-hidden="true"><use href="#i-NOME"/></svg>`. Disponíveis:

  | Grupo | Ícones |
  |---|---|
  | Avisos e status | `sino`, `chama`, `check`, `relogio` |
  | Ações | `impressora`, `chat`, `seta`, `play` (simular), `janela` (abrir ao lado), `download`, `lixo`, `x`, `mais`, `menos`, `busca` |
  | Modos de pedido | `moto` (entrega), `sacola` (retirada), `mesa` (local), `truck`, `pino` |
  | Cardápio | `burger`, `hotdog`, `baguete`, `combo`, `batata`, `lata`, `prensa`, `tesoura` |
  | Navegação e som | `som`, `som-off`, `grafico`, `lista`, `quadro`, `config` |

## 4. O que o painel precisa ter (para computador; a partir de 1024 px)
1. **Estrutura.**
   - **Barra lateral fixa:**
     - selo do logo: `/assets/logo/selo-128.webp` (1x) e `selo-256.webp` (2x, em `srcset`), 64×64; no login (`acesso.js`), `selo-256.webp` em 84×84. É a arte oficial: sem recorte circular, `border-radius`, `filter` nem máscara;
     - navegação Pedidos (quadro), Histórico, Cardápio, Relatório, Configurações;
     - no rodapé, aviso de prévia: "Prévia GaspLab · pedidos guardados neste navegador".
   - **Barra superior:**
     - título da seção;
     - **status da loja** (botão de 3 estados: Automático pelo horário / Aberta / Fechada, mostrando `ML.horario.situacao().txt`);
     - relógio;
     - botão de som (liga/desliga, salvo em config);
     - **Simular pedido** (gera 1 pedido de exemplo realista via `gerarExemplos(1)` e o deixa como `novo`; atenção: `gerarExemplos` espalha status, então ajuste o gerado para `novo` com `atualizarStatus` ou crie com uma variação sua usando `ML.store.criarPedido` + `ML.precos`);
     - **Abrir cardápio ao lado** (`window.open('#cardapio', 'ml-cardapio', 'width=430,height=860')`; se retornar null, mostre o aviso "Abra o cardápio em outra aba: <url>#cardapio").
2. **Pedidos (quadro Kanban).**
   - Colunas: **Novos · Em preparo · Pronto / Em rota · Concluídos hoje**. "Pronto / Em rota" junta `pronto` e `rota`; "Concluídos hoje" mostra `entregue` do dia, recolhível.
   - Cancelados ficam fora do quadro (aparecem no Histórico).
   - Cada coluna tem contador.
   - **Card do pedido:**
     - número grande;
     - **tempo decorrido** desde `criadoEm`, atualizado a cada 1 s: normal → âmbar a partir de `atencaoMin` → vermelho a partir de `atrasoMin`;
     - nome do cliente; ícone e rótulo do modo;
     - itens: `qtd× nome`, embaixo **selos** para PRENSADO, COMBO (+ refri), SEM: x, y e + adicional;
     - total;
     - endereço com botões Copiar e Abrir no Maps (`https://www.google.com/maps/search/?api=1&query=` + endereço codificado);
     - observação destacada;
     - pagamento/troco ("a combinar" se null).
   - **Ações:**
     - botão principal com o próximo passo ("Aceitar e preparar", "Marcar pronto" / "Saiu para entrega", "Concluir");
     - Imprimir comanda;
     - Cancelar (pede motivo num mini-diálogo dentro do card);
     - WhatsApp do cliente, só se houver telefone.
   - **Arrastar** cards entre colunas (HTML5 drag and drop no desktop) **e** os botões fazem o mesmo para teclado e toque. Mover via arraste respeita a ordem: só para uma coluna válida; se inválido, o card volta com um leve tremor.
   - Pedido **novo** chegando:
     - o card entra no topo de "Novos" com destaque (borda amarela pulsando 3 vezes);
     - toast "Novo pedido #0007 · Nome · R$ 00,00";
     - som curto **gerado por WebAudio** (dois tons, sem arquivo), só se o som estiver ligado e depois do primeiro clique na página;
     - `document.title` vira "(N) Novo pedido · Mineiro Lanche" até a aba ser focada ou o pedido aceito.
   - **Estado vazio** desenhado: ícone do truck + "Nenhum pedido agora. Use 'Simular pedido' ou faça um pedido pelo cardápio ao lado."
3. **Indicadores do dia** (acima do quadro): pedidos hoje, faturamento hoje (soma de `total` dos não cancelados de hoje), ticket médio e itens em preparo. Contagem animada ao mudar (respeitando movimento reduzido).
4. **Relatório** (só com pedidos guardados; se houver pedidos de origem `exemplo`, mostrar o rótulo "Inclui pedidos de exemplo"):
   - itens mais vendidos (barras horizontais, top 8);
   - pedidos por hora do dia (colunas);
   - divisão por modo (entrega/retirada/local);
   - adicionais mais pedidos;
   - **taxa de combo: % dos lanches (`tipo: 'lanche'`) que viraram combo (+R$ 14,90)**, com destaque, porque é a estratégia do dono;
   - % prensados.

   Gráficos em SVG ou CSS desenhados à mão, com rótulos legíveis e escala única. Sem bibliotecas.
5. **Histórico:** tabela (número, hora, cliente, modo, itens resumidos, total, status) com busca por nome, número ou item; filtro por status e por "hoje / todos"; **Exportar CSV** (Blob + download; se o download for bloqueado, mostre o CSV num `<textarea>` para copiar). Clicar numa linha abre o detalhe do pedido num painel lateral.
6. **Cardápio (gestão):** lista por categoria com interruptor **Esgotado hoje** por item (`marcarEsgotado`) e "Esgotar categoria inteira". A mudança aparece ao vivo no cardápio do cliente (a página já ouve o evento).
7. **Configurações:**
   - som;
   - limiares de atenção e atraso (minutos);
   - **Gerar 15 pedidos de exemplo** (rotulados);
   - **Apagar todos os pedidos de teste** (confirmação dentro da página, porque `confirm()` não funciona no artefato);
   - texto explicando o limite: "Os pedidos ficam guardados neste navegador. Cardápio e painel abertos no mesmo computador sincronizam na hora; pedidos feitos em outro aparelho precisam de um servidor (próxima etapa)."
8. **Comanda para impressão:**
   - abre um diálogo dentro da página com a comanda formatada em 80 mm (fonte mono, número grande, itens com selos em texto, obs, total, modo, endereço) e o botão "Imprimir" (`window.print()`);
   - `@media print` mostra só a comanda;
   - no artefato do claude.ai o print é bloqueado: o diálogo continua útil como visualização.
9. **Menos de 1024 px:** aviso "O painel foi pensado para computador" + lista simples dos pedidos de hoje com o botão de avançar.

## 5. Qualidade
- JS clássico (sem módulos/bundler), num IIFE, em ES2018 (arrow functions e template strings OK), sem dependências externas.
- Delegação de eventos, sem `innerHTML` com dado não escapado (use `ML.fmt.esc`).
- Alvos de toque com 48 px no mínimo no painel (botões, campos, segmentados, células da tabela), `aria-label` nos que só têm ícone, foco visível (`outline` amarelo), `aria-live="polite"` no toast e nos contadores.
- Arrastar tem alternativa por botão.
- Nada de `alert`/`confirm`/`prompt`.
- Timers parados em `esconder()`.
- Sem erros no console.
- Teste o JS com `node -e "new Function(require('fs').readFileSync('painel.js','utf8'))"`. Se quiser, crie `painel-teste.html` (que carrega `core.js` + `painel.css` + `painel.js` e define os tokens) só para conferência; ele não vai para a página final.
- Ao terminar, responda com: lista de funcionalidades entregues, decisões tomadas e qualquer ponto do contrato que não foi possível cumprir.
