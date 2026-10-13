# Mineiro Lanche: direção visual definitiva ("Parede Acesa")

**Data:** 12/10/2026. **Para:** os dois implementadores (A: pele e pedido; B: site imersivo).

**Fonte dos dados:** `docs/CLIENTE-2026-10.md` e o `CONFIG` de `src/core.js`. Nenhum preço, horário, composição ou modo de entrega é escrito à mão no HTML ou no CSS: tudo sai do `CONFIG`, do `fotos.json` ou de `ML.horario.situacao()`.

**Referência pedida pelo cliente:** a prévia Gorilas Point, com o mesmo padrão de jornada (bio → cardápio → site), tema escuro e quente, letreiro expressivo, cenas presas à rolagem e microinterações. O vocabulário, porém, é só do Mineiro: placa vermelha com fio dourado (a faixa da logo), luz de arandela, parede de tijolinho das fotos, chapa, fumaça e comanda.

---

## 0. Decisão do juiz

### 0.1 Notas (0 a 10)

| Critério | Parede Acesa | Seladinho na chapa | Rua Eliziel, 19h |
|---|---|---|---|
| (a) Fidelidade ao padrão Gorilas Point | 9 | 8 | 8 |
| (b) Hamburgueria com o tijolinho natural das fotos | 9 | 8 | 9 |
| (c) Fidelidade à logo real | 9 | 7 | 9 |
| (d) Site imersivo e memorável | 9 | 8 | 8 |
| (e) Jornada de pedido mais rápida no celular | 9 | 7 | 9 |
| (f) Viabilidade (CSP, desempenho, a11y, movimento reduzido) e risco | 8 | 7 | 8 |
| (g) Naturalidade, sem cara de template ou IA | 8 | 9 | 6 |
| **Média** | **8,7** | **7,7** | **8,1** |

**Vencedora: "Parede Acesa".** Os motivos:

1. Tem a ideia organizadora mais forte e ligada a dado real: a luz do site segue o estado do truck (`ML.horario.situacao()` + `loja.modo`). É identidade própria, não cópia do Gorilas.
2. Tem as regras de tijolinho mais rigorosas, porque foram medidas: cerca de 2,5 tijolos em 1200 px, o defeito de escala aparece em 1280 px e o fundo desfocado ótico resolve.
3. Trata a logo como placa luminosa: a luz fica atrás e em volta, e a proposta inclui teste de integridade.
4. As seções S0, S2, S6 e S7 foram validadas em protótipo com a CSP do `vercel.json`.
5. Encurta a jornada: o "+" adiciona direto e o "Enviar" fica sempre visível.

**Pontos fracos dela, corrigidos aqui:**

- srcset com o `logo-1024`;
- fontes novas;
- o modo "Retirada", que não existe no `CONFIG.modos`;
- a logo "acendendo" a partir de opacidade 0, o que atrasa o LCP;
- grão em data URI.

**Seladinho na chapa** perdeu em (c), porque usa `filter: blur` na entrada da logo, e em (e), porque o "+" continua abrindo a ficha. É a mais natural (a foto real é a protagonista, e o título usa as palavras do dono).

**Rua Eliziel** é a mais cuidadosa com testes e desempenho, mas lousa de giz, varal de lâmpadas e letreiro de LED são o repertório-padrão de "hamburgueria temática": parece template.

### 0.2 Enxertos

**De "Seladinho na chapa":**

- Logo com srcset por **densidade** e no máximo 512 px em tela. No protótipo, o `logo-1024` em DPR 3 levou o LCP a 2,62 s; com o limite, caiu para 1,71 s.
- Títulos com o texto no HTML. O JS só embrulha letras, e cada palavra fica em `white-space: nowrap`. Injetar as letras deu CLS de 0,178.
- Os nomes atuais dos tokens continuam e só os valores mudam, para o painel seguir funcionando (seção 1.1).
- "Pão seladinho na chapa" (palavras do dono) é o título da S2.
- "Vira combo" na ficha "enche de cheddar".
- O `-1080` da ficha é pré-carregado no `pointerdown` ou no foco do card.
- Odômetro no preço do dog.
- FAB "Ver sacola" no site.
- Sem tela de abertura.
- **Backlog pós-apresentação:** o raio-X "camada por camada" (exige mapa de camadas medido à mão com sha256 da foto). Não entra agora.

**De "Rua Eliziel, 19h":**

- Lista de seletores e textos que os testes usam, que não podem mudar (seção 5.0).
- Preload do LCP com `imagesrcset` e `imagesizes` **idênticos** aos do `<img>`, injetado por rota no `public/rota.js`. Evita o download duplicado.
- A logo começa visível (opacidade 1). O "acender" acontece depois da primeira pintura.
- A foto do lanche nunca escurece com o estado; só o ambiente muda.
- A parede como poça de luz (`mask-image` radial), e não véu chapado.
- "Pedir de novo" na bio.
- Placa do cardápio com "a partir de" calculado do `CONFIG`, com links para a categoria (S1b).
- Campos com 16 px e 50 px de altura (sem zoom no iOS).
- Alvos de 48 px no painel. O card de pedido novo pisca a borda 3 vezes.
- View Transitions de no máximo 200 ms.

### 0.3 Recusado (não implementar)

- **Fontes novas** (Tilt Neon, Anton, versões variáveis). Na véspera da apresentação, a família aprovada (Lilita, Oswald e Rubik) fica. O neon é Oswald 600 com brilho.
- Lousa com filtro SVG de giz, varal de 14 lâmpadas, letreiro de LED e o interruptor "de brincadeira" da luz.
- `filter` de qualquer tipo na `<img>` da logo, texto circular sobre a logo e remontagem da logo por partes.
- `backdrop-filter` em barras e áreas grandes; `filter: blur()` em CSS para o tijolo.
- Foto 3:4 na lista do cardápio: a lista usa a variante `-q`, que é quadrada e leve.
- O modo "Retirada": não está no `CONFIG.modos`. Os cartões de modo saem do `CONFIG`.
- Deformar a foto em qualquer efeito (prensa, combo etc.); o `tests/imagens.spec.js` mede distorção.

### 0.4 Divisão e ordem (cada passo é publicável)

Sugestão de divisão; o orquestrador confirma quem é dono de cada arquivo.

| Implementador | Escopo | Arquivos prováveis |
|---|---|---|
| **A: pele e pedido** | tokens, logo em tela, bio, cardápio, ficha, sacola, checkout, acompanhamento e painel | `src/styles/base.css`, `src/styles/app.css`, `index.html` (**fora** de `#view-site`), `src/app.js`, `src/fontes.js`, `public/rota.js`, `src/painel/painel.css`, `painel.js:264`, `acesso.js:22`, `public/assets/texturas/grao.svg` (novo) |
| **B: site imersivo** | `#site` | `index.html` (**só** dentro de `#view-site`), `src/site/*.js` e `src/site/site.css` (novos, carregados por `import()`) |

**Contrato entre A e B:**

- **Estado da luz.** O A escreve o estado no `<html>`, usando a mesma função do app:
  - `data-luz="acesa"` ou `data-luz="apagada"`;
  - `data-luz-motivo="turno|antes|pausa"`.

  O cálculo é `ML.horario.situacao()`, refeito no carregamento, a cada 60 s e no evento `loja:modo`. O B só lê esses atributos (no CSS e no JS).
- **Abrir a ficha.** O B usa o atributo `data-abrir="<id>"`, que o `app.js` já trata por delegação (`abrirFicha(id, opcoes)`, linha 983).
- **Combo e adição rápida.** O A expõe `ML.app.abrirFicha(id, { combo: true })`, que abre a ficha com o combo ligado; se `opcoes.combo` ainda não existir, o A adiciona. Expõe também `ML.app.adicionarRapido(id)`. O B só chama as duas.

**Ordem:**

1. **A:** tokens, troca da logo e pele de bio, cardápio e ficha. É o maior ganho visual, e é quase só CSS.
2. **B:** S0, S2, S6 e S7 (já validadas em protótipo).
3. **A:** sacola, checkout e acompanhamento. **B:** S1, S1b, S3, S4, S5, S8 e S9.
4. **A:** painel.

---

## 1. Tokens

Todos os contrastes foram medidos com a fórmula WCAG 2.x sobre os hex abaixo. As cores da marca são as do vetor do PDF; o anel foi amostrado do bitmap.

### 1.1 Cores (`src/styles/base.css`)

```css
:root{
  color-scheme:dark;
  /* superfícies */
  --noite:#120B09;        /* fundo de todas as telas do cliente (nunca preto puro nem azul) */
  --chapa:#1D1310;        /* cards, folhas (ficha, sacola) */
  --chapa-2:#281A15;      /* elevado, campos, segmentados */
  --borda:#3A2620;        /* divisória DECORATIVA (não serve de limite de controle) */
  --borda-campo:#94705C;  /* borda de campo e controle (>= 3:1) */
  /* texto */
  --osso:#FFF3E0;         /* texto principal */
  --osso-2:#CDB8A3;       /* texto secundário */
  --placeholder:#9C8573;
  --grafite:#1A0A04;      /* texto sobre ouro, amarelo, neon e papel */
  /* marca (valores do PDF) */
  --placa:#C4060C;        /* faixa da logo: botão primário, selos */
  --placa-escura:#96040A; /* :active do primário */
  --letreiro:#FFFF00;     /* "MINEIRO": títulos grito, contador */
  --fio:#FFCC00;          /* contorno da faixa: fio, foco, chip ativo, preço */
  --branco:#FFFFFF;
  --anel-claro:#F8E888; --anel:#D8A848; --anel-escuro:#A85808; /* anel: fios e anéis decorativos */
  --disco:#F80808;        /* só no halo atrás da placa */
  /* função */
  --vermelho-luz:#FF6A5C; /* texto ou ícone vermelho sobre o escuro (erro, esgotado, fechado) */
  --neon-aberto:#5BE38A;  /* status aberto */
  --verde:#2E7D4F; --laranja:#E8772E;
  /* papel (comanda) */
  --papel:#FBF6EC; --tinta:#2A1F1A; --tinta-2:#6E5B4E; --linha:#EBDCC0;
  /* parede (cor de espera e semente de brilho; nunca preenchimento de interface) */
  --tijolo:#C78955;       /* média medida de tijolo-real-1.webp */
  --rejunte:#D9D2C8;
  --parede-desfocada:url(/assets/texturas/tijolo-real-desfocado.webp);
  --parede-nitida:url(/assets/texturas/tijolo-real-1.webp);
  --parede-nitida-2:url(/assets/texturas/tijolo-real-2.webp);
  --parede-plano-b:url(/assets/texturas/tijolo.svg);
  --grao:url(/assets/texturas/grao.svg);
}
```

**URLs:** sempre absolutas (`/assets/...`). `url()` dentro de variável resolve de forma diferente conforme o navegador quando o caminho é relativo.

**Nomes atuais (compatibilidade com o painel).** Ficam, com os valores novos:

| Nome atual | Valor novo |
|---|---|
| `--vermelho` | `#C4060C` |
| `--vermelho-escuro` | `#96040A` |
| `--vinho` | `#6E0307` (só decorativo) |
| `--amarelo` | `#FFCC00` |
| `--amarelo-claro` | `#FFFF00` |
| `--ouro` | `#D8A848` |
| `--ouro-escuro` | `#A85808` |
| `--carvao` | `#120B09` |
| `--carvao-2` | `#1D1310` |
| `--carvao-3` | `#281A15` |
| `--borda-escura` | `#3A2620` |
| `--creme` | `#FFF3E0` |
| `--papel` | `#FBF6EC` |
| `--cinza-quente` | `#CDB8A3` |

`--linha`, `--tinta`, `--tinta-2`, `--verde` e `--laranja` não mudam.

**Atenção:** onde o `app.css` hoje pinta tela clara com `--creme` de **fundo**, troque por `--noite` ou `--chapa`. O nome continua significando "cor clara".

**Pares medidos (texto ≥ 4,5:1; componente ≥ 3:1):**

| Frente / fundo | Contraste | Uso |
|---|---|---|
| osso / noite · chapa · chapa-2 | 17,77 · 16,61 · 15,33 | texto |
| osso-2 / noite · chapa · chapa-2 | 10,19 · 9,52 · 8,79 | secundário |
| placeholder / chapa · chapa-2 | 5,22 · 4,82 | placeholder |
| borda-campo / noite · chapa · chapa-2 | 4,39 · 4,10 · 3,79 | borda de controle |
| branco / placa | 6,22 | botão primário |
| branco / placa-escura | 9,06 | primário pressionado |
| letreiro / placa | 5,79 | texto amarelo em selo vermelho |
| osso / placa | 5,67 | |
| fio / placa | 4,11 | **só texto ≥ 24 px, ou ≥ 18,7 px em negrito** |
| grafite / fio · letreiro | 12,75 · 17,96 | chip ativo, contador |
| fio / noite · chapa · chapa-2 | 12,89 · 12,05 · 11,12 | preço, fio, foco |
| letreiro / noite · chapa | 18,15 · 16,96 | títulos grito |
| vermelho-luz / noite · chapa · chapa-2 | 6,93 · 6,48 · 5,98 | vermelho de texto no escuro |
| neon-aberto / noite · chapa · chapa-2 | 11,88 · 11,10 · 10,25 | status aberto |
| grafite / neon-aberto | 11,75 | |
| anel / noite · chapa | 8,92 · 8,34 | fio dourado, ícone de categoria |
| tinta / papel · tinta-2 / papel | 14,89 · 5,96 | comanda |
| placa · placa-escura · anel-escuro · verde / papel | 5,77 · 8,41 · 4,80 · 4,68 | texto colorido sobre papel |
| branco / verde · grafite / laranja | 5,05 · 5,79 | selos do painel |

**Proibido:**

- `--placa` como texto sobre o escuro (3,14 na noite, 2,93 na chapa); para texto vermelho, use `--vermelho-luz`;
- `--anel` e `--laranja` como texto sobre papel (2,03 e 2,74);
- `--anel-escuro` como texto no escuro (3,77);
- osso direto sobre o tijolo (2,68).

**Véu sobre a parede** (cor `rgba(18,11,9,a)`), medido no pixel mais claro (percentil 98) das três texturas:

| a | osso | osso-2 | fio |
|---|---|---|---|
| 0,55 | 5,01 | **2,87 (reprova)** | 3,64 |
| 0,70 | 8,05 | 4,62 | 5,84 |
| 0,80 | 11,09 | 6,36 | 8,05 |

**Regra:** texto só onde o escurecimento efetivo for ≥ 0,70.

### 1.2 Tipografia (sem pacote novo)

| Papel | Fonte (`src/fontes.js`, `@fontsource`, só latin) | Uso |
|---|---|---|
| **Grito** | Lilita One 400 (`@fontsource/lilita-one/latin-400.css`) | h1 e h2, nome do produto na ficha, título de categoria. Cor `--letreiro`, `text-shadow: 0 .06em 0 var(--placa)` (adesivo), inclinação de −1,5° a −4°. Tamanho mínimo 24 px. **Nunca escreve "Mineiro Lanche"**: a marca só aparece pela logo. |
| **Placa** | Oswald 500, 600 e 700 (já importados) | Preços, botões, chips, abas, rótulos, selos e o "neon". Caixa alta, `letter-spacing` de .04em a .2em. |
| **Corpo** | Rubik 400, 600 e 700 | Texto e formulários. Corte o 500 e o 800 do `src/fontes.js` se um grep não achar uso. |
| **Comanda** | `ui-monospace, 'Cascadia Mono', 'Courier New', monospace` (do sistema) | Número e linhas da comanda. |

- **Preload:** Lilita (já existe) e Oswald 600. Tudo com `font-display: swap`.
- **Escala** (390 → 1280):

| Elemento | Tamanho |
|---|---|
| Grito do herói | `clamp(44px, 12vw, 104px)`, line-height .92 |
| h2 de seção | `clamp(38px, 10vw, 76px)`, line-height .95 |
| Nome na ficha | Lilita 34 px |
| Título de categoria | Lilita 28 px |
| Nome no card | Oswald 600, 18 px, caixa alta |
| Preço no card | Oswald 700, 18 px, `--fio` |
| Preço na ficha | Oswald 700, 22 px |
| Corpo | 16 px / 1,5 |
| Secundário | 14 px |
| Meta | 13 px |
| Mínimo | 12 px (só selo Oswald em caixa alta) |
| Campos | 16 px |

- **Neon:** Oswald 600, caixa alta, .12em, cor sólida (`--neon-aberto` ou `--vermelho-luz`). O brilho é só decoração (`text-shadow: 0 0 8px currentColor, 0 0 22px color-mix(in srgb, currentColor 45%, transparent)`).

### 1.3 Espaçamento e grade

- **Escala:** `--e1:4px` `--e2:8px` `--e3:12px` `--e4:16px` `--e5:20px` `--e6:24px` `--e7:32px` `--e8:40px` `--e9:56px` `--e10:72px`.
- **Calha lateral:** 16 px até 639 px; 24 px a partir de 640 px.
- **Larguras:** coluna de celular 440 px; container do site com no máximo 1200 px.
- **Seções do site:** padding vertical de 72 px (390) e 120 px (1280).
- **Sem rolagem horizontal da página** em nenhuma largura. Os carrosséis rolam dentro do próprio trilho.

### 1.4 Raios

| Token | Valor | Uso |
|---|---|---|
| `--r-xs` | 8px | chips internos |
| `--r-sm` | 12px | selo de preço |
| `--r-md` | 14px | botões, campos, fotos pequenas |
| `--r-lg` | 18px | cards, fotos médias |
| `--r-xl` | 24px | topo das folhas (ficha, sacola) |
| `--r-2xl` | 28px | cartas de combo, foto grande do site |
| `--r-pill` | 999px | pílulas, chips, contador |

### 1.5 Sombras e luz

```css
--sombra-card: 0 22px 44px -22px rgba(0,0,0,.85);
--sombra-foto: 0 18px 40px -14px color-mix(in srgb, var(--cor, var(--tijolo)) 70%, transparent), 0 0 0 1px rgba(248,232,136,.14);
--sombra-placa: inset 0 0 0 2px var(--fio), inset 0 -4px 0 rgba(0,0,0,.25), 0 14px 30px -12px rgba(196,6,12,.9);
--brilho-neon: 0 0 10px rgba(91,227,138,.55), inset 0 0 10px rgba(91,227,138,.35);
--halo-placa: radial-gradient(closest-side, rgba(248,8,8,.55), rgba(196,6,12,.28) 55%, transparent);
--veu: rgba(18,11,9,.78);
```

- `--cor` vem do `fotos.json` (`"cor"`), e só nas fotos com `origem: 'nova'`. As fotos 'antiga' (fundo escuro) usam só `--sombra-card`, sem brilho colorido.

### 1.6 Movimento

```css
--mola: cubic-bezier(.34,1.56,.64,1);   /* já existe */
--suave: cubic-bezier(.2,.8,.2,1);      /* já existe */
--t-toque: 160ms;   /* pressão, chips, stepper */
--t-ui: 280ms;      /* troca de estado, toasts */
--t-folha: 320ms;   /* ficha e sacola entrando */
--t-vt: 200ms;      /* View Transitions (teto) */
--t-cena: 900ms;    /* revelações do site */
```

- **Acender a placa:** 1 s, com 2 lampejos (menos de 3 por segundo; WCAG 2.3.1).
- **Ciclos de ambiente:** halo respira em 5 s; "zumbido" do neon a cada 7 s; brasas de 5 a 10 s; fumaça de 4 a 7 s. Todos pausam fora da tela (IntersectionObserver com `animation-play-state: paused`) e com `document.hidden`.
- **Só animam** `transform` e `opacity`. Nas revelações da S2, também `clip-path`.
- **Movimento reduzido:** o `base.css` já zera as durações. Além disso, cada efeito em JS confere `matchMedia('(prefers-reduced-motion: reduce)')` antes de começar.

### 1.7 Foco e alvos

- **Foco:** `outline: 3px solid var(--fio); outline-offset: 3px`.
- **Alvos de toque:** ≥ 44 px no cliente e ≥ 48 px no painel.

---

## 2. Texturas e camadas de luz

### 2.1 Regras do tijolinho

1. **Só tijolo real.** O tijolo aparece de dois jeitos:
   - dentro da própria foto, que já é a parede;
   - como fundo **desfocado** (`tijolo-real-desfocado.webp`, 1200×380, 6,7 KB), com `background-size: cover`. Fora de foco, a escala não denuncia o recorte.

   Nunca em mosaico repetido. Nunca com `filter: blur()` em CSS.
2. **A textura nítida** (`tijolo-real-1.webp` e `tijolo-real-2.webp`) só entra em painéis de close de **até 420 px de largura**:
   - cartão de endereço da S8;
   - trilho de comandas do acompanhamento;
   - topo da ficha de item sem foto.

   Em largura total, o tijolo sai gigante (o protótipo mostrou isso em 1280 px).
3. **É noite.** Toda parede é uma poça de luz: `mask-image` radial com o cone da arandela, e o resto some na `--noite`. A máscara esconde as bordas do recorte.
4. **Recortes:** evitar o reflexo do plástico e o canto entre paredes, que aparecem à esquerda em `big-mineiro` e `gran-salada`.
5. **Onde não entra tijolo:** cards, chips, folhas e cardápio (tudo isso é "chapa" lisa). Duas seções vizinhas nunca usam a mesma mancha de parede.
6. **Onde entra:** topo da bio, herói do site, S5 (fundo que acende), S6, cartão da S8, S9 e acompanhamento. **Painel: nunca.**
7. **Plano B automático:** a pilha de fundos é `var(--parede-desfocada), var(--parede-plano-b)` sobre `--tijolo`. Se a textura real faltar, aparece o `tijolo.svg` desenhado, com opacidade de no máximo 0,15 na camada; sem nenhum dos dois, fica a cor sob o véu.

### 2.2 Camadas (de trás para a frente)

```css
.parede{position:relative;isolation:isolate;background:var(--noite)}
.parede::before{ /* 1. a parede: poça de luz */
  content:"";position:absolute;inset:0;z-index:-3;
  background:var(--parede-desfocada) center/cover no-repeat, var(--parede-plano-b) center/320px, var(--tijolo);
  -webkit-mask:radial-gradient(75% 65% at 50% 22%, #000 0 30%, transparent 78%);
          mask:radial-gradient(75% 65% at 50% 22%, #000 0 30%, transparent 78%);
  opacity:var(--luz,1);transition:opacity var(--t-cena) var(--suave);
}
.parede::after{ /* 2. véu + cone da arandela */
  content:"";position:absolute;inset:0;z-index:-2;pointer-events:none;
  background:
    conic-gradient(from 180deg at 50% -8%, transparent 0 152deg, rgba(255,200,120,.16) 168deg 192deg, transparent 208deg),
    radial-gradient(60% 55% at 50% 26%, rgba(18,11,9,.30), var(--veu) 68%, rgba(18,11,9,.95));
}
html[data-luz="apagada"] .parede{--luz:.35}
```

As demais camadas:

3. **Grão:** `/assets/texturas/grao.svg`, um arquivo estático de 140×140 desenhado em código (`feTurbulence` com `baseFrequency` .9 e `numOctaves` 2). Entra com `opacity: .07` e `mix-blend-mode: overlay`, **só** na parede e nas molduras de foto. Nunca sobre texto, logo ou painel. É arquivo, não data URI, para não depender de `img-src data:`.
4. **Arandela em CSS:** uma cúpula de 36×14 px com degradê de ferro e um ponto quente `--anel-claro`.
5. **Brasas:** spans de 3 a 5 px, com `background: radial-gradient(var(--anel-claro), var(--disco) 60%, transparent)`, subindo por `transform` e sumindo por `opacity`. Até 8 no celular e 18 no desktop.
6. **Fumaça:** 3 ou 4 manchas `radial-gradient(rgba(255,243,224,.10), transparent 70%)` que sobem e crescem (`translateY` e `scale`) e somem. Sem `filter`.
7. **Texto:** só onde o escurecimento é ≥ 0,70 (ver 1.1). Bloco de texto que cai sobre a parede ganha um fundo local `radial-gradient(closest-side, rgba(18,11,9,.75), transparent)`.

### 2.3 Fotos dentro da cena

- **Luz da foto:** `--sombra-foto` com `--cor` do `fotos.json`. Somam-se uma vinheta interna fixa (`::after` com `radial-gradient(transparent 62%, rgba(18,11,9,.35))`) e o grão. Assim a foto de celular e a interface viram uma cena só.
- **Sem filtro de cor:** nada de `filter`, `saturate`, `brightness` ou `hue-rotate` na foto. **A foto nunca escurece com o estado do truck**; só o ambiente muda.
- **Enquadramento:** `object-position` vem do `foco` do `fotos.json`. Toda `<img>` leva `width`/`height` e um quadro com `aspect-ratio`.
- **Fotos 'antiga'** (fundo escuro, sem parede): ficam numa moldura escura (`--chapa-2` com anel interno `--borda`), sem brilho colorido. Nunca entram na S2 nem na S7.

---

## 3. Logo

### 3.1 Arquivos (a arte é sempre a do PDF; gerados por `scripts/logo.mjs`)

| Arquivo | Tamanho | Peso | Uso em tela |
|---|---|---|---|
| `/assets/logo/logo-256.webp` | 256×209 | 25 KB | 1x da logo inteira |
| `/assets/logo/logo-512.webp` | 512×416 | 70 KB | 2x da logo inteira (teto em tela) |
| `/assets/logo/logo-1024.webp` | 1024×832 | 189 KB | **nunca em tela** (o disco e o anel são bitmaps de cerca de 507 px; acima de 512 só cresce o peso) |
| `/assets/logo/selo-128.webp` | 128×128 | 9,8 KB | selo até 42 px CSS |
| `/assets/logo/selo-256.webp` | 256×256 | 25 KB | selo de 43 a 85 px CSS |
| `/assets/logo/logo.svg` | vetor | | impressão (cartaz, QR) e JSON-LD |

### 3.2 O que sai

- O `<svg class="logo-anim">` embutido na bio (`index.html`, linhas 83 a 110). É o redesenho **reprovado**.
- No `src/styles/app.css`:
  - as regras `.logo-anim` e `.lg-*` (linhas 10 a 17, 54 e 581);
  - os `@keyframes` que só elas usam;
  - a `@font-face` "ML Lilita", se só elas a usarem.
- Referências em tela aos SVGs da raiz, cada uma trocada pela arte real:

| Onde | Hoje | Troca |
|---|---|---|
| `index.html:263` (`<image>` do caminhão) | `/assets/logo-selo.svg` | `/assets/logo/selo-128.webp` |
| `index.html:298` (story) | `/assets/logo-selo.svg` | `selo-128.webp` |
| `index.html:464` (final) | `/assets/logo.svg` | logo 256/512 por densidade |
| `src/painel/painel.js:264` | `logo-selo.svg` | `selo-128.webp` |
| `src/painel/acesso.js:22` | `logo-selo.svg` | `selo-256.webp` |

- `/assets/logo.svg` e `/assets/logo-selo.svg`, os da raiz, com 164 KB cada (já são a arte real; o `scripts/logo.mjs` também os gera): saem só da tela. Antes de apagar, confira o que mais aponta para eles (cartaz, manifest, JSON-LD, og, o próprio script). Quem decide se apaga é o orquestrador.

### 3.3 Marcação (bio; no site é igual, com outro tamanho)

```html
<div class="placa" data-placa>
  <span class="placa-correntes" aria-hidden="true"></span>
  <span class="placa-halo" aria-hidden="true"></span>
  <span class="placa-anel" aria-hidden="true"></span>
  <img class="placa-arte" src="/assets/logo/logo-256.webp"
       srcset="/assets/logo/logo-256.webp 1x, /assets/logo/logo-512.webp 2x"
       width="256" height="209" alt="Mineiro Lanche food truck" fetchpriority="high" decoding="async">
  <span class="placa-brilho" aria-hidden="true"></span>
</div>
```

- **Garantia em CSS:** `.placa-arte{filter:none!important;mix-blend-mode:normal!important;-webkit-mask:none!important;mask:none!important}`.
- **Tamanhos máximos em CSS:**

| Lugar | Largura |
|---|---|
| Bio | 208 px |
| Herói do site | 168 px (390) e 280 px (1280) |
| Final | 240 px |
| Cabeçalhos | selo de 34 a 40 px |
| Painel | selo de 64 px |
| Login | selo de 84 px |

  Nunca acima de 280 px.
- **Fundo:** sempre escuro (noite, chapa ou parede com véu). Nunca sobre vermelho ou amarelo. Área livre em volta de 8% da largura.
- **Preload na bio:** `<link rel="preload" as="image" imagesrcset="/assets/logo/logo-256.webp 1x, /assets/logo/logo-512.webp 2x" fetchpriority="high">`, idêntico ao `<img>`. Ele é injetado pelo `public/rota.js` **só** quando a rota inicial é a bio.

### 3.4 Animação permitida (sempre na imagem inteira)

1. **Primeira pintura:** a arte já aparece visível (opacidade 1). Ela é candidata a LCP.
2. **Entrada** (uma vez por sessão; a marca fica em `sessionStorage` com try/catch):
   - a arte vai de `translateY(6px) scale(.97)` a `none` em 500 ms, com `--mola`;
   - logo depois, o **acender**: opacidade 1 → .35 → 1 → .5 → 1 em 1 s (2 lampejos);
   - junto, o halo (`--halo-placa`) sobe de `scale(.7)` a 1 e de opacidade 0 a 1;
   - aos 1,2 s aparece o **anel de contraluz**: `conic-gradient` de `--anel-claro` a `--anel` mascarado como anel 6% maior que o disco, **atrás** da arte, girando 9 s por volta com `transform: rotate`.
3. **Brilho por máscara:** só uma vez no fim da entrada, e de novo a cada toque.
   - O `.placa-brilho` cobre a arte, com `mask: url(<currentSrc da img>) center/contain no-repeat`. O JS copia o `currentSrc`, então o brilho só existe dentro do contorno da arte.
   - Dentro dele, uma faixa `linear-gradient(105deg, transparent 40%, rgba(255,255,255,.45) 50%, transparent 60%)` atravessa por `translateX(-100%)` → `translateX(100%)` em 700 ms.
   - No fim, `opacity: 0` e `hidden`. **Em repouso não há nada sobre a arte.**
4. **Toque na placa:** 2 piscadas (opacidade, 500 ms em `steps`), 1 brilho e um sopro de fumaça.
5. **Balanço** (bio e herói): `rotate` de no máximo ±3° em torno do topo (`transform-origin: 50% -16px`, onde ficam as correntes). É uma mola amortecida movida pela velocidade da rolagem, com rAF só enquanto se move.
6. **View Transition** `view-transition-name: placa`, da bio para o herói do site. Dura até 200 ms.
7. **Acompanhamento:** o selo pisca uma vez (opacidade) a cada mudança de status.
8. **S9:** a placa reacende uma vez ao entrar na tela.

**Proibido:**

- recolorir, `filter` (inclusive `drop-shadow`; a sombra é a camada do halo), `mix-blend-mode`, máscara na `<img>`, `hue-rotate` ou `saturate`;
- separar disco, estrelas ou letras; redesenhar ou remontar letras em Lilita;
- texto circular sobre o anel;
- brilho que fique sobre a arte depois da animação.

**Movimento reduzido:** placa estática e acesa, sem halo pulsando, sem anel girando, sem balanço, sem View Transition.

### 3.5 Teste de integridade (novo, para o dono dos testes)

`tests/logo-tela.spec.js` (Playwright). O `tests/logo.test.mjs` atual cobre os arquivos; este cobre a tela, nos projetos celular e desktop. Ele exige:

- o `currentSrc` de toda `.placa-arte` casa com `/\/assets\/logo\/(logo|selo)-\d+\.webp$/`;
- nenhum `svg` do DOM contém o texto "MINEIRO";
- nenhuma referência a `/assets/logo-selo.svg` ou `/assets/logo.svg` em `index.html` e `src/painel/*.js`;
- o `getComputedStyle` da arte dá `filter: none`, `mix-blend-mode: normal` e `mask-image: none`;
- depois de 3 s, a captura do elemento difere da arte servida em no máximo 2/255 por canal nos pixels opacos (o protótipo mediu 0,61).

---

## 4. Componentes

As classes atuais continuam (os testes dependem delas; ver 5.0). Aqui está só a pele.

### 4.1 Botões

| Tipo | Visual | Tamanho | Estados |
|---|---|---|---|
| **Primário "placa"** ("Fazer pedido", "Adicionar · R$ X", "Finalizar pedido", "Enviar pedido · R$ X") | fundo `--placa`, texto `--branco` em Oswald 700, 16 px, caixa alta, .06em; `--sombra-placa` (fio ouro interno de 2 px) | altura 52 (54 na bio), raio `--r-md`, largura total no celular | **`:active`:** `--placa-escura` + `translateY(1px)`. **Desabilitado:** opacidade .5. **Enviando:** texto "Enviando…", botão travado e uma "barra de calor" (pseudo-elemento com `linear-gradient` de `--fio` a 25%) que percorre por `translateX` a cada 1,2 s |
| **Secundário "fio"** (WhatsApp, "Adicionar mais itens", "Consultar") | transparente, borda 2 px `--fio`, texto `--fio` em Oswald 600 | altura 48 | **hover:** fundo `rgba(255,204,0,.08)` |
| **Fantasma** (links de apoio) | texto `--osso-2`, sublinhado no hover e no foco | alvo de 44 | |
| **"+" redondo** (adição rápida) | círculo de 44 px `--placa` com anel `--fio` de 2 px e ícone branco | 44 | **ao tocar:** `scale(.92)` com mola; vira ✓ por 600 ms |
| **Sacola redonda** (cabeçalho) | 44 px, `--placa`; contador com fundo `--letreiro` e texto `--grafite`, Oswald 700, mínimo 20 px | 44 | a cada item "acende": anel `--fio` em pseudo-elemento, `scale` 1 → 1,8 e opacidade 1 → 0, 500 ms |

### 4.2 Chips, segmentados, interruptor e stepper

- **Chip de categoria:**
  - forma: altura 40 (alvo de 44 com padding), Oswald 600, 14 px, caixa alta, borda 1,5 px `--fio`, texto `--osso`;
  - ativo: fundo `--fio`, texto `--grafite`;
  - a fileira fica fixa sob a busca.
- **Chip de filtro** (Com bacon, Com ovo…):
  - forma: altura 36 (alvo de 44), borda `--borda-campo`, texto `--osso-2`;
  - ativo: fundo `--chapa-2`, borda `--fio` e texto `--osso`.
- **Segmentado** (Completo / Tirar algum item; Prensado: Não / Sim (grátis); salsichas 1/2/3):
  - trilho: `--chapa-2`, raio 14, padding 4;
  - opção ativa: fundo `--osso`, texto `--grafite`, deslizando por `transform` em `--t-ui`.
- **Ingrediente para tirar:** chip com ícone de tesoura. Quando removido, fica riscado e com opacidade .6, e o rótulo diz "sem X" para o leitor de tela.
- **Interruptor** ("Vira combo? +R$ 14,90"):
  - `role="switch"` com `aria-checked`, trilho de 52×32 e polegar `--branco`;
  - ligado: trilho `--placa` com anel `--fio`;
  - o painel do combo "enche de cheddar": um `::before` com `rgba(255,204,0,.14)` cresce de baixo (`scaleY` 0 → 1, 300 ms, mola). É decorativo, e o texto continua acima de 4,5:1.
- **Stepper:** botões circulares de 44 px (`--chapa-2`, borda `--borda-campo`) e valor em Oswald 700, 18 px. O mínimo é 1; o menos vira lixeira quando o valor é 1.

### 4.3 Cards

- **Item do cardápio:**
  - grade `96px 1fr`, altura mínima 104, fundo `--chapa`, raio `--r-lg`, `--sombra-card`;
  - foto `-q` de 96×96, raio `--r-md`, com `--sombra-foto` (`--cor` da foto) ou moldura escura (se 'antiga');
  - nome em Oswald 600, 18 px, caixa alta, `--osso`;
  - composição em Rubik 13,5 px, `--osso-2`, cortada em 2 linhas;
  - selo "Vira combo +R$ 14,90" (só `tipo: 'lanche'`; o valor vem do `CONFIG.regras.combo.preco`);
  - preço em Oswald 700, `--fio`;
  - "+" de 44 px à direita.
- **Item sem foto:** ícone da categoria em `--anel` sobre `--chapa-2`, com a parede desfocada a 25% por baixo.
- **Esgotado:** o conteúdo vai a opacidade .45, com a etiqueta "Esgotado hoje" (fundo `--chapa-2`, texto `--vermelho-luz`, borda `--vermelho-luz`). A cor da foto não muda, e a etiqueta é texto (nunca só cor).
- **Preço null** (CBO Turbo): no lugar do preço, "Preço a confirmar" em Oswald 600, 14 px, `--osso-2`. No lugar do "+", o botão secundário "Consultar" com o ícone de WhatsApp, usando `ML.whatsapp.consulta`. Não vai para a sacola.
- **Destaque 3:4** ("Saindo da chapa", site):
  - quadro 3:4, largura de 62% (390) ou 220 px (1280), foto `-540` com `foco`;
  - degradê no pé até `--noite`, nome em Oswald 700, 18 px, caixa alta, e preço `--fio`;
  - raio `--r-lg` e `--sombra-foto`. O toque abre a ficha direto.
- **Carta de combo** (S5): raio `--r-2xl`, fundo `--chapa`, foto 4:3 no topo, nome em Lilita 26, o que vem incluso (`inclui` do `CONFIG`), preço e "Pedir".
- **Comanda (papel):**
  - fundo `--papel`, texto `--tinta`, fonte da comanda;
  - pé serrilhado por `mask` com `radial-gradient` repetido no eixo x (só no pé);
  - número em Oswald 700;
  - linhas separadas por tracejado `--linha`.

### 4.4 Abas, selos, barras e toasts

- **Abas** (pílula):
  - trilho `--chapa-2`, raio 999, padding 4;
  - aba em Oswald 700, 13 px, caixa alta, altura 36 (alvo de 44);
  - ativa: fundo `--fio`, texto `--grafite`;
  - usadas na barra do site em 1280 (Bio · Cardápio · Site) e nas colunas do painel no celular (`.pn-mobile`).
- **Selo de preço "placa":** fundo `--placa`, texto `--branco` ou `--letreiro` em Oswald 700, raio `--r-sm`, `rotate(-4deg)`, fio interno `--fio`. Usado na faixa do combo ("+14,90") e nos destaques do site.
- **Selo "Vira combo":** borda 1,5 px tracejada `--fio`, texto `--fio` em Oswald 600, 12 px, caixa alta, altura 24, raio 999.
- **Status "neon"** (bio, cabeçalho do cardápio, herói, S6, S9 e painel):
  - pílula de altura 32 com `min-width` reservada (16ch, para não haver CLS), ponto de 8 px e borda 1,5 px;
  - aberto: texto `--neon-aberto`, fundo `rgba(91,227,138,.12)` e `--brilho-neon`;
  - fechado: texto `--vermelho-luz` com brilho vermelho;
  - texto vem de `ML.horario.situacao().txt` (versão curta permitida: "Aberto · até 0h", "Fechado · abre às 19h");
  - o "zumbido" a cada 7 s mexe só na opacidade da camada de brilho; o texto fica sólido;
  - `role="status"`. Em `forced-colors`, vira borda e texto.
- **Faixa do combo** (`.faixa-combo` em `[data-screen="menu"]`):
  - selo placa "+14,90";
  - "Qualquer lanche vira combo" em Lilita 22, `--letreiro`;
  - "batata frita 140 g + refrigerante lata 350 ml" em `--osso-2`, vindo do `CONFIG.regras.combo.inclui`.
- **Barra fixa da sacola** (cardápio):
  - posição: 12 px do pé + área segura, 16 px das laterais; altura 56;
  - pele: `--placa` com fio, texto branco em Oswald 700: "1 item · Ver sacola · R$ 34,90";
  - entra por `translateY` com mola quando há itens.
- **FAB do site:** a mesma pele, compacta: "Ver sacola · N". Aparece em todo o `#site` quando a sacola tem itens.
- **Toast:**
  - pele: fundo `--chapa-2`, borda `--borda-campo`, raio 14, texto `--osso` 15 px, ação em Oswald 600 `--fio`;
  - posição: acima da barra fixa;
  - exemplo: "Gran Bacon Onion na sacola · Personalizar";
  - dura 4 s e pausa no hover e no foco; `role="status"`, `aria-live="polite"`, um de cada vez;
  - entra com `translateY(12px)` → 0 e opacidade, 200 ms.
- **Gaveta** (ficha e sacola; `<dialog>` de baixo):
  - formato: altura máxima de 92dvh, topo com raio `--r-xl`, fundo `--chapa`, alça de 36×4 `--borda-campo`;
  - entrada: `translateY(100%)` → 0 em `--t-folha`, com `--suave`; fundo `rgba(8,5,4,.72)`, sem blur;
  - fechar: X de 44 px, Escape e arrastar para baixo (mais de 120 px ou velocidade alta);
  - foco preso (dialog nativo).

---

## 5. Telas

### 5.0 Seletores e textos que os testes usam: não renomear

- **Ids:** `#cardapio`, `#site`, `#view-site`, `#pedido`, `#ficha`, `#ficha-add`, `#ficha-total`, `#ficha-add-txt`, `#btn-continuar`, `#btn-enviar`, `#f-nome`, `#f-tel`, `#ped-num`, `#ped-msg`, `#ped-status`, `#ped-total`, `#envio-erro`.
- **Atributos `data-*`:** `[data-screen="menu"]`, `[data-screen="checkout"]`, `[data-nav]`, `[data-act]`, `[data-modo]`, `[data-combo]`, `[data-combo-preco]`, `[data-adic]`, `[data-total]`, `[data-status]`, `[data-semana]`, `[data-fq]`, `[data-fechar-ficha]`, `[data-completo]`, `[data-prensado]`, `[data-ing]`, `[data-id]`, `[data-vazio]`, `[data-fechar-story]`, `[data-editar]`, `[data-d]`, `[data-contador]`, `[data-confirma-t]`.
- **Classes:** `.bio-ctas`, `.faixa`, `.faixa-combo`, `.selo-combo`, `.selo-esgotado`, `.story-btn`, `.s-hero`, `.passo.atual`, e todo `.pn-*` (`.pn-app`, `.pn-card`, `.pn-desktop`, `.pn-mobile`, `.pn-col--novos`, `.pn-acesso`, `.pn-modal`, `.pn-num`, `.pn-selo--*`, `.pn-tag--mesa`, `.pn-tag--qr`, `.pn-toast`, `.pn-total`).
- **Textos:** "Fazer pedido", "Conheça o truck" e "Na chapa" (no passo atual).

**Adição rápida:** o "+" passa a adicionar direto. Ele ganha `data-rapido`, e o toque no resto do card continua abrindo a ficha. Antes de mudar, confira se `cardapio.spec.js` ou `e2e.spec.js` clicam no "+" para abrir a ficha e acerte com o dono dos testes.

### 5.1 Bio (`/`)

**390:**

1. **Topo de 330 px, a parede:** desfocada, poça de luz, arandela e 8 brasas, com a placa (logo de 208 px) pendurada por 2 correntes em CSS.
2. "Food truck · Centro, Suzano" em Oswald 600, `--fio`, .2em. Abaixo, o status neon.
3. `.bio-ctas`:
   - "Fazer pedido" (primário, 54 px);
   - "WhatsApp (11) 98572-0150" (secundário, texto do `CONFIG.whatsappTexto`);
   - "Pedir de novo" (fantasma), só se houver pedido salvo em "Meus pedidos". Ele repõe os itens do último pedido na sacola e abre a sacola.
4. **Faixa do combo** (componente 4.4).
5. **Stories:** anéis com `conic-gradient(var(--anel-claro), var(--anel), var(--anel-escuro), var(--anel-claro))`, com fotos 'nova' primeiro.
6. **"Saindo da chapa":** trilho com `scroll-snap` de destaques 3:4 (62% de largura), só com fotos 'nova'. O toque abre a ficha direto.
7. **Horário:** 7 lâmpadas (D S T Q Q S S; hoje com anel `--letreiro`) e a régua 19h–0h ou 19h–1h, de `CONFIG.horarios`, com o `[data-semana]`.
8. **Links em linhas escuras** (`--chapa`, 56 px): WhatsApp, Instagram, "Conheça o truck" e "Acompanhar meu pedido" (só se houver token).
9. **"Onde":** "Rua Eliziel Alves Costa, 300 · Centro · Suzano/SP" (do `CONFIG.enderecoPartes`) e "Abrir no mapa" (link externo).

Sem a logo montada por partes e sem os recortes de lanche voando.

**1280:** a coluna de celular de 440 px fica "pendurada" sobre a parede desfocada em tela cheia (com véu). Ao lado, os 3 passos "Assim você pede". Use o breakpoint que o layout atual já tem.

### 5.2 Cardápio (`#cardapio`)

**390:**

- **Cabeçalho fixo de 64 px** (fundo `rgba(18,11,9,.94)`, sem blur): voltar, selo de 38 px, "Cardápio" em Lilita 24, status neon curto e sacola redonda.
- **Busca:** campo escuro (especificação do campo em 5.5).
- **Fileiras:** chips de categoria fixos e chips de filtro.
- **Faixa do combo.**
- **Categorias:** título em Lilita 28, `--letreiro`, −1,5°, com a descrição (`desc`) em Oswald 500 14 px `--osso-2`. Abaixo, os cards de item.
- **Barra fixa da sacola.**

**Adição rápida pelo "+":**

1. O lanche entra completo, sem prensar e sem combo.
2. A foto `-q` voa até a sacola (WAAPI, 420 ms; com movimento reduzido, só o contador muda).
3. Aparece o toast "<Nome> na sacola · Personalizar"; o "Personalizar" abre a ficha desse item na sacola.

Itens com escolha obrigatória (bebida com sabor, combo com refri quando houver sabores no `CONFIG`) abrem a ficha pelo "+".

**Pré-carga:** `pointerdown` ou `focus` no card → `new Image()` da `-1080` (ou `-540`), para a ficha abrir já com a foto.

**1280:** coluna de celular, como na bio. Os cards não crescem para grade.

### 5.3 Ficha (`#ficha`, gaveta)

**390:**

- **Foto:** `-540`/`-1080` (`sizes="100vw"`), quadro 3:4 limitado a 44dvh, `object-position` do `foco`. No pé, a foto se dissolve na `--chapa` por degradê. Com o grão; ao abrir, 3 sopros de fumaça por 3 s (sem movimento reduzido: nenhum).
- **Item sem foto:** faixa de 140 px com a parede **nítida** de close (`--parede-nitida`, véu .75) e o ícone da categoria em `--anel`.
- **Textos:** nome em Lilita 34, `--letreiro`, sobre o degradê; preço em Oswald 700, 22 px, `--fio`; composição em chips do `CONFIG.ing`; a `nota` (ex.: `DICA_DOG`) em `--osso-2`.
- **Controles, nesta ordem:**
  1. "Vira combo? +R$ 14,90" (interruptor com cheddar; só lanche). Se o `CONFIG` tiver sabores de refri, o seletor abre ali mesmo.
  2. Completo / Tirar algum item.
  3. Prensado: Não / Sim (grátis). Texto: "Avise antes: não cobramos para prensar".
  4. Adicionais com stepper (R$ 7,50, do `CONFIG`).
- **Rodapé fixo:** stepper + "Adicionar · R$ X". O total rola em 200 ms (WAAPI, `translateY` dos dígitos).
- **Ao adicionar:** a miniatura voa até a sacola, a ficha fecha e aparece o toast.
- **Entrada:** a foto do card vira o topo da ficha em 200 ms (implementado por WAAPI, não por View Transition: seção 9). Com movimento reduzido, a troca é seca.

**1280:** diálogo central de 560 px, raio 24, altura máxima de 88vh. A foto fica no topo, com 360 px no máximo.

### 5.4 Sacola

**390:** "comanda aberta".

- **Linhas:** cards `--chapa` com:
  - foto de 56 px;
  - nome;
  - chips do resumo (sem X, prensado, combo, adicionais);
  - stepper;
  - "Editar", que reabre a ficha com o estado.
- **Oferta "Vira combo por +R$ 14,90? Quero combo":** painel `--chapa-2` com fio `--fio`, só se houver lanche sem combo.
- **Resumo como comanda de papel:** Subtotal, "Entrega: taxa combinada" (do `CONFIG.modos`) e Total.
- **Botões:** "Finalizar pedido · R$ X" (primário, fixo no pé) e "Adicionar mais itens" (secundário).
- **Vazia:** ícone da categoria em `--anel` e "Ver cardápio".

**1280:** coluna de celular.

### 5.5 Checkout (`[data-screen="checkout"]`)

**390:** uma página só.

1. **Quem:** `#f-nome` (`autocomplete="name"`) e `#f-tel` (`type="tel"`, `inputmode="tel"`, `autocomplete="tel"`). Vêm do rascunho `mineiro:v2:`, então o cliente que volta só confere.
2. **Como receber:** cartões grandes `[data-modo]` gerados de `CONFIG.modos`. Hoje são 2: "Entrega · Suzano e região · taxa combinada" e "Comer no local · Consumo no truck". O selecionado tem borda `--fio` e ✓. A mesa vem do QR, quando existir.
3. **Endereço:** só na entrega, com `autocomplete="street-address"`.
4. **Pagamento:** como hoje (`CONFIG.pagamentos` está null, "a confirmar").
5. **Observação** e aviso de LGPD.
6. **Resumo como comanda de papel**, que recolhe.

- **Campos:** altura 50, fonte 16 px, fundo `--chapa-2`, borda 1,5 px `--borda-campo`, raio 14; placeholder `--placeholder`; rótulo em Oswald 600, 13 px, caixa alta, `--osso-2`.
  - **Foco:** borda `--fio` + contorno de foco.
  - **Erro:** borda e mensagem `--vermelho-luz` com ícone, e `aria-describedby`.
- **Rodapé fixo, sempre visível:** "Enviar pedido · R$ X" (`#btn-enviar`).
  - **Enviando:** botão travado com barra de calor.
  - **Sucesso:** vai para o acompanhamento, e é lá que a comanda "imprime" (`clip-path` de cima para baixo, 600 ms; seção 9).
  - **Erro:** `#envio-erro` com "Tentar de novo" e "Enviar pelo WhatsApp" (o fluxo atual).

**1280:** coluna de celular.

### 5.6 Acompanhamento (`#pedido/<token>`)

**390:**

- **Topo, o trilho de comandas:**
  - barra de inox em degradê (`#6b6560` → `#cfc9c2` → `#6b6560`);
  - a comanda `#ped-num` pendurada por 2 presilhas, com número em Oswald 700, 40 px;
  - fundo: painel de tijolo **nítido** de close (até 420 px; `--parede-nitida-2`, véu .75), com o selo-128 no canto.
- **Status `#ped-status` em "neon":**
  - os rótulos são os atuais do app;
  - "Na chapa" ganha fumaça e brilho `--laranja`;
  - "Cancelado" fica em `--vermelho-luz`, com o motivo.
- **Linha do tempo:** 4 lâmpadas (`.passo`; `.passo.atual` acesa em `--letreiro`, as feitas em `--anel`) com o horário do `historico`.
- **Mudança de status:** consulta a cada 10 s e no `visibilitychange` (como hoje). Cada mudança dispara uma animação única: a lâmpada acende e o selo pisca. O aviso sai por `aria-live="polite"`.
- **Abaixo:** itens, `#ped-total`, WhatsApp, "Meus pedidos" e "Fazer novo pedido".
- **Sem previsão de tempo inventada.**

**1280:** coluna de celular, com a parede desfocada ao fundo.

### 5.7 Painel (`/painel/`): só a pele, sem mudar fluxo, rótulos nem hooks

**Fase 4, só depois das telas do cliente.**

- **Tokens:** os nomes antigos, com os valores novos (1.1). Sem tijolo, fumaça, partículas, grão ou módulo do site; o painel não importa nada de `src/site`.
- **Cabeçalho:** `selo-128.webp` de 64 px. O modo da loja (Auto / Aberta / Fechada) usa o componente de status neon.
- **Login:** `selo-256.webp` de 84 px e campos escuros (especificação do campo em 5.5).
- **Cards de pedido:**
  - papel claro sobre o escuro (lê-se de longe): fundo `--papel`, texto `--tinta`;
  - número em Oswald 700, 32 px;
  - selos de modo e "QR · Mesa" (`.pn-tag--qr`, `.pn-tag--mesa`).
  - Texto colorido no papel só com `--placa`, `--placa-escura`, `--anel-escuro` ou `--verde`. `--laranja` só como fundo, com texto `--grafite`.
- **Pedido novo:**
  - entra com `translateY(-12px)` → 0 e 1 quique (400 ms);
  - a borda pisca `--fio` 3 vezes em 1,5 s e toca o som atual;
  - com movimento reduzido, fica só a borda.
- **Alvos de 48 px.** Mantêm-se as colunas e os rótulos atuais (Novo / Em preparo / Pronto / Em rota / Concluído).

**390 (`.pn-mobile`):** abas em pílula por coluna. **1280 (`.pn-desktop`):** colunas lado a lado.

---

## 6. Site imersivo (`#site`)

### 6.1 Base comum

- **Carregamento:**
  - todo o HTML das seções fica no `index.html` (`#view-site`), o que garante conteúdo, SEO e leitor de tela sem JS;
  - `src/site/site.js` e `site.css` entram por `import()` na primeira visita a `#site`, ou em `requestIdleCallback` depois da bio, exceto com `navigator.connection.saveData`;
  - bio e cardápio não pagam nada pelo site.
- **Técnica:**
  - CSS primeiro;
  - revelações com `animation-timeline: view()` dentro de `@supports`, com reserva por IntersectionObserver (`.visivel`);
  - elementos acima da dobra começam visíveis;
  - cenas presas à rolagem: **um** laço rAF movido por `scroll` passivo, ativo só na seção visível (IO), que escreve `--p` (0 a 1) e deixa o resto com o CSS;
  - efeitos de uma vez (voo, comanda, piscar) por WAAPI.
- **Sem biblioteca**, tudo dentro de `script-src 'self'`, sem script nem handler inline.
- **Contenção:** seções depois da S2 que não ficam presas levam `content-visibility: auto` com `contain-intrinsic-size`.
- **Barra do site** (sempre visível, 56 px, `rgba(18,11,9,.92)`, sem `backdrop-filter`):
  - selo de 34 px e ponto de status;
  - abas Bio · Cardápio · Site (1280) ou a pílula "Cardápio" (390);
  - sacola com contador;
  - o FAB "Ver sacola · N" no celular quando há itens.
- **Navegação** bio ↔ cardápio ↔ site por `document.startViewTransition`, com no máximo 200 ms. Fica desligada com movimento reduzido ou sem suporte.
- **Roteiro de fotos:** `src/site/roteiro.js` lista, por seção, os ids em ordem de preferência. A foto de cada produto é `item.foto || item.id` no `fotos.json`. **Só entra** nas seções guiadas por foto (S2, S4, S7) o produto com `origem === 'nova'`.

```js
// src/site/roteiro.js: preferência por seção; o primeiro com foto 'nova' vence
export const ROTEIRO = {
  monte: ['gran-bacon', 'gran-bacon-onion', 'gran-salada', 'gran-crispy'],
  dog: ['dog-max'],
  prensado: ['x-churrasco'],
  combos: ['combo-gran-bacon-onion', 'combo-diluvio', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos'], // 'antiga' entra com moldura escura
  dividir: ['porcao-batata'], // card "Pra dividir": oculto até existir foto 'nova'
};
```

### 6.2 Roteiro

**S0 · Herói "Acende"** (`.s-hero`, 100svh)

- **Conteúdo:**
  - parede desfocada com poça de luz, arandela, cone e brasas (8 no celular, 18 no desktop);
  - a placa (logo de 168 px no celular, 280 no desktop);
  - **título grito** em Lilita `--letreiro`, −3°, conforme `data-luz` (as 3 versões ficam empilhadas na mesma célula do grid, só a ativa visível, sem CLS):

    | Estado | Título |
    |---|---|
    | Aberto | "Acendeu: a chapa tá quente." |
    | Fechado | "A chapa acende às {hh}h.", com a próxima abertura dos turnos |
    | Pausa manual (`loja.modo = 'fechada'`) | "Pausa na chapa." |

  - linha de apoio "Hambúrguer artesanal, tradicional e hot dog", com o `CONFIG.horarioTexto`;
  - status neon; "Fazer pedido" (primário) e "WhatsApp" (secundário).
- **Interação:** tocar na placa faz ela piscar e soltar fumaça; balanço com a rolagem; no desktop com `pointer: fine`, o cone segue um pouco o cursor (`--mx`).
- **Técnica:** CSS + 1 listener de ponteiro com rAF. Letras do título embrulhadas em spans pelo JS a partir do texto do HTML (palavras em `nowrap`, `aria-label` no h1).
- **Movimento reduzido:** tudo estático e aceso; sem brasas, fumaça nem balanço.
- **Fotos:** nenhuma. **O LCP é o h1** (nunca foto grande no herói).
- **Peso:** parede 6,7 KB + logo 25/70 KB (já em cache, vindo da bio).
- **390:** coluna única (placa, título, apoio, status, CTAs), tudo acima da dobra em 390×844.
- **1280:** 2 colunas (texto 1.1fr; placa 0.9fr sob a arandela).

**S1 · Fitas de letreiro**

- **Conteúdo:** duas faixas inclinadas (−3° e +2°) que se cruzam:
  1. placa `--placa` com fios `--fio` e nomes em Lilita `--letreiro`, separados por ★. Os nomes são os produtos com foto 'nova', vindos do `CONFIG`; o HTML traz a mesma lista como reserva;
  2. faixa `--osso` com texto `--grafite` em Oswald 700: "Prensado? Avise antes, não cobramos ★ Qualquer lanche vira combo +R$ 14,90 ★ Domingo também, das 19h à meia-noite". Combo e horário vêm do `CONFIG`.
- **Interação:** o `playbackRate` (WAAPI) acompanha a velocidade da rolagem, de 1 a 6×.
- **Técnica:** `translateX` em laço com o conteúdo duplicado (a cópia com `aria-hidden`); pausa fora da tela.
- **Movimento reduzido:** faixas paradas.
- **Peso:** cerca de 0.

**S1b · Placa do cardápio** (enxerto da Rua Eliziel, sem giz)

- **Conteúdo:**
  - título "O que tem na chapa";
  - uma linha por categoria do `CONFIG`: rótulo, pontilhado e "a partir de R$ X", com o menor preço não nulo calculado em tempo de execução;
  - cada linha é um link para a categoria: rota nova `#cardapio/<id-da-categoria>`, que abre o cardápio e rola até a categoria (hoje o app não trata esse prefixo; o implementador A adiciona).
- **Pele:** card `--chapa` com fio `--fio`; linhas em Oswald 600, 20 px, caixa alta, preço `--fio`; hover e foco em `--chapa-2`.
- **Revelação:** linhas escalonadas em 60 ms (opacidade e `translateY`).
- **Movimento reduzido:** estática.
- **Peso:** cerca de 0.

**S2 · "Pão seladinho na chapa"** (montagem; presa à rolagem: 240vh no desktop, 200vh no celular)

- **Conteúdo:**
  - a **foto real** do primeiro item de `ROTEIRO.monte` com foto 'nova' (hoje o Gran Bacon Onion) se revela de baixo para cima: `clip-path: inset(calc((1 - var(--p)) * 100%) 0 0 0 round 18px)`, com uma linha de luz `--fio` na borda que sobe;
  - chips da composição: `base` + `CONFIG.ing`, na ordem do `CONFIG`, acendendo em sequência conforme `--p`;
  - em `p = 1`, sobe vapor e aparece "Pedir este · R$ 34,90" (preço do `CONFIG`), que chama `abrirFicha`;
  - seletor segmentado com os itens de `ROTEIRO.monte` que têm foto 'nova'.
- **Técnica:** o rAF escreve `--p` e o CSS faz o resto. Palco `position: sticky; top: 56px`.
- **Movimento reduzido:** sem prender a tela, foto inteira e chips acesos.
- **Foto:** `-540`/`-1080` (`sizes="(min-width:1024px) 480px, 90vw"`), lazy, com pré-carga quando o IO entra a 800 px.
- **Peso:** 27 a 62 KB.
- **390:** foto 3:4 até 62svh; chips abaixo, em linhas.
- **1280:** foto à esquerda (até 480 px de largura); lista numerada à direita, acendendo.

**S3 · Prensado ou não?**

- **Conteúdo:** o componente atual com a pele nova:
  - foto 'nova' do X-Churrasco;
  - prensa desenhada em CSS (chapa de inox em degradê, com cabo), com a interação de hoje: a prensa desce por `translateY`, sai vapor e um "Tsss…";
  - texto "Avise antes: não cobramos para prensar."
- **Regra:** a foto **nunca** é deformada (nada de `scaleY`).
- **Movimento reduzido:** os dois estados lado a lado, estáticos.
- **Peso:** 27 KB, lazy.

**S4 · Hot dog: 1, 2 ou 3 salsichas**

- **Conteúdo:**
  - foto 'nova' do Dog Max (o cliente pediu a mesma para os 3);
  - segmentado 1 / 2 / 3 com Médio, Max e Super. Os preços vêm do `CONFIG` (hoje 13,90 / 15,90 / 18,90) e rolam como **odômetro** (WAAPI, `translateY` dos dígitos);
  - salsichas desenhadas em CSS (pílulas) caindo na bandeja com mola;
  - chips da base (`ING_DOG`) e o `DICA_DOG`;
  - "Adicionar" (adição rápida do tamanho escolhido) e "Personalizar" (ficha);
  - card do Hot Dog CBO Turbo com a foto 'nova', "Preço a confirmar" e "Consultar no WhatsApp".
- **Movimento reduzido:** troca direta de preço; salsichas paradas.
- **Peso:** 2 fotos de cerca de 27 KB, lazy.

**S5 · Vira combo + pilha de combos**

- **Conteúdo:**
  - o fundo passa de noite para parede acesa (desfocada; o véu nunca abaixo de 0,70 onde há texto);
  - topo: neon "Qualquer lanche vira combo +R$ 14,90" e o `inclui` do `CONFIG`;
  - chips com lanches de foto 'nova' + "Escolher e virar combo", que chama `abrirFicha(id, { combo: true })`;
  - pilha de cartas presas (`position: sticky; top: calc(72px + i * 8px)`) com os combos de `ROTEIRO.combos`: o Combo Gran Bacon Onion (foto 'nova') primeiro, os outros com a foto 'antiga' em moldura escura;
  - a carta coberta vai a `scale(.93)` e escurece por uma camada de opacidade (não `filter`).
  - **Combo Casal fica fora** (foto fora do cenário) até chegar foto nova.
- **Movimento reduzido:** lista comum.
- **Peso:** 4 fotos lazy (cerca de 120 KB).

**S6 · Letreiro da noite** (horário; seção comum, não presa)

- **Conteúdo:**
  - "Todo dia, inclusive domingo · Das 19h à meia-noite · sexta e sábado até 1h", de `CONFIG.horarioTexto`;
  - 7 lâmpadas com hoje em anel `--letreiro` (`[data-semana]`);
  - relógio de Suzano (`ML.horario.agora`) em Lilita de 64 a 120 px;
  - status neon;
  - régua "Simule um horário": `input type="range"` de 0 a 1435, passo 5, com `<label>` e `aria-valuetext` "sábado, 23h30". Ela usa `ML.horario.situacaoNo(dia, min)`, e a parede da seção acende ou apaga (`--luz`) conforme o simulado. Muda só esta seção, nunca o status real.
- **Movimento reduzido:** sem transição; o relógio atualiza por minuto.
- **Peso:** cerca de 0.

**S7 · Parede de fotos**

- **Conteúdo:**
  - **só** fotos com `origem: 'nova'`, sem repetir arquivo (o `dog-max` aparece uma vez, como "Hot Dog Max"), em alvenaria por `columns`: 2 no celular e 4 no desktop;
  - cada quadro com foco de luz por cima (`radial-gradient` claro a 10%), rotação de ±1,2° alternada e nome e preço no pé;
  - o toque abre a caixa de foto ampliada atual, com nome, preço e "Pedir".
- **Paralaxe:** ±24 px por `animation-timeline: view()`, só dentro de `@supports` (sem reserva em JS: sem suporte, fica parado).
- **Movimento reduzido:** sem paralaxe nem rotação animada.
- **Fotos:** `-540` lazy, com `sizes="(min-width:1024px) 25vw, 50vw"`.
- **Peso:** cerca de 300 KB, todo lazy e sob `content-visibility`.

**S8 · Onde**

- **Conteúdo:**
  - rota em SVG de "você" até o truck: `stroke-dashoffset` por `--p` e o ícone do truck andando por `getPointAtLength`;
  - em volta do ícone, texto circular (SVG `textPath`, girando a cada 20 s) com "RUA ELIZIEL ALVES COSTA, 300 · CENTRO · SUZANO ·" (aria-hidden; o endereço também está em texto normal ao lado);
  - cartão do endereço (até 420 px) sobre a parede **nítida** com véu .75;
  - chips dos modos do `CONFIG.modos`;
  - "Abrir no mapa": link externo para a busca do Google Maps com o endereço, `target="_blank" rel="noopener"`. Sem iframe, então a CSP não muda;
  - WhatsApp e Instagram.
- **Movimento reduzido:** rota completa, texto parado.
- **Peso:** textura nítida de 35 KB, lazy.

**S9 · Final**

- **Conteúdo:**
  - parede com a placa de 240 px, que reacende uma vez ao entrar (IO);
  - a frase atual "Quando bater aquela fome, chama o Mineiro Lanche!" em Lilita (é a frase aprovada da prévia; aqui o nome aparece como texto de frase, não como marca);
  - abaixo, o status neon: aberto, "O Mineiro tá aceso"; fechado, "Volta às {hh}h. A chapa espera.";
  - "Fazer pedido", WhatsApp e Instagram; rodapé com endereço e horário.
- **Movimento reduzido:** placa estática.
- **Peso:** a logo já está em cache.

### 6.3 Orçamento

| Item | Limite |
|---|---|
| JS do site (chunk) | ≤ 12 KB gz |
| CSS do site (chunk) | ≤ 10 KB gz |
| Bio e cardápio | crescimento ≤ 3 KB gz (adição rápida, toast e luz) |
| JS do cliente no total | < 120 KB gz (`PLANO.md`, A5.5) |
| Fontes | nenhum arquivo novo; Rubik 500 e 800 cortados se não forem usados |
| Primeira vista do `#site` (antes do lazy) | ≤ 150 KB transferidos |
| LCP (4G lento, CPU 4×, 390×844 DPR 3) | bio < 1,8 s; site < 1,5 s; cardápio < 1,8 s; limite duro 2,5 s |
| CLS | < 0,05 em todas as telas (limite duro 0,1) |
| Lighthouse mobile | desempenho ≥ 90 |
| Animação | só `transform`, `opacity` e `clip-path`; partículas ≤ 8 no celular e ≤ 18 no desktop; nada em `setInterval` para animar |

`node scripts/orcamento-site.mjs` mede, no build, o JS e o CSS do site, o JS do cliente e a primeira vista. O resultado de 12/10 (a primeira vista passa do limite) está na seção 9.

---

## 7. Quando chegarem as fotos de tijolinho que faltam

**Situação em 12/10:** 11 fotos novas já estão processadas (`fotos.json` com `origem: 'nova'`, mais as 3 texturas reais). Faltam:

- Gran Bacon, Porção de batata turbinada, Combo Casal e Gran Egg;
- as substitutas das 10 'antiga': gran-burger, gran-burger-bacon, gran-egg-bacon, gran-chicken, dog-doritos, dog-pizza, combo-diluvio, combo-casal, gran-bacon-coca-maionese e combo-2-dog-doritos (conferido com `npm run fotos -- --simular` em 12/10).

Se, por qualquer motivo, nenhuma foto 'nova' existir, o desenho continua funcionando:

- o herói não depende de foto;
- S2, S4 e S7 escondem o que não tem foto 'nova';
- a parede usa o plano B (2.1, regra 7).

**A troca é só rodar o pipeline:**

1. Pôr os arquivos (com o nome do produto, ou com o nome de horário do WhatsApp) na pasta de entrada e rodar `npm run fotos -- --simular` para conferir as ligações. Depois, `npm run fotos`.
2. O pipeline gera `-q`, `-540` e `-1080` em WebP, sem retoque, e grava `origem: 'nova'`, `foco` e `cor` no `fotos.json`.

**Muda sozinho, sem código:**

- cards, ficha e stories passam a usar a foto nova; a moldura escura some;
- a S2 ganha o Gran Bacon como primeiro (`ROTEIRO.monte`);
- a S7 cresce;
- a S5 troca cartas 'antiga' por novas;
- o card "Pra dividir" (Porção turbinada) aparece;
- o Combo Casal entra na pilha.

**Manual (opcional):**

- Recortar 1 ou 2 trechos novos de parede (por exemplo, o fundo desfocado do Gran Bacon) para que herói, S5 e S9 não repitam a mesma mancha. Sem retoque; evitar reflexo e cantos. Os novos arquivos entram como `--parede-desfocada-2` em `base.css`.
- Refazer o `og.jpg` com `node scripts/logo.mjs og`. Hoje ele usa a foto padrão, a do Gran Bacon Onion; para outra foto, ajuste o script.
- Rodar `node --test tests/fotos.test.mjs` e `npx playwright test tests/imagens.spec.js`.

**Nunca:** gerar, ampliar com "criatividade" ou retocar foto ou textura com IA; usar foto provisória gerada no lugar de uma que falta.

---

## 8. Lista de verificação do aceite visual

Capturas obrigatórias em **390×844 (DPR 3)** e **1280×800**, nos estados **aberto** (simular 20:00) e **fechado** (14:00), e de novo com `prefers-reduced-motion: reduce`. As telas são bio, cardápio, ficha, sacola, checkout, acompanhamento, site (cada seção) e painel.

**Logo**

- [ ] Só a arte do PDF em tela: `logo-256`/`512` ou `selo-128`/`256` WebP; nenhum `svg.logo-anim` nem `.lg-*`; nenhuma referência em tela a `/assets/logo.svg` ou `/assets/logo-selo.svg`.
- [ ] Nenhum `filter`, blend ou máscara na `<img>`; em repouso, nada sobre a arte. O teste de integridade passa (≤ 2/255).
- [ ] A logo nunca passa de 280 px CSS; o `logo-1024` não é baixado por nenhuma tela (conferir na aba de rede em DPR 3).
- [ ] O acender começa com a arte visível; os lampejos ficam abaixo de 3 por segundo.

**Cor, tipo e contraste**

- [ ] Todas as telas do cliente são escuras (`--noite`), sem preto puro nem azul; o painel ganhou os tokens novos e continua legível.
- [ ] Nenhum texto `--placa` sobre o escuro; nenhum texto direto sobre tijolo sem escurecimento ≥ 0,70.
- [ ] O título grito nunca escreve "Mineiro Lanche" como marca. Só Lilita, Oswald e Rubik, sem pacote de fonte novo.
- [ ] Foco visível (`--fio`, 3 px) em todos os controles; alvos ≥ 44 px no cliente e ≥ 48 px no painel.

**Tijolinho e fotos**

- [ ] Parede só desfocada em áreas grandes; nítida só em painéis de até 420 px; sem mosaico repetido e sem `filter: blur`.
- [ ] Em 1280, nenhuma parede com tijolos "gigantes"; a mesma mancha nunca em duas seções vizinhas.
- [ ] Nenhuma foto escurece com o estado do truck, nem ganha filtro de cor; `tests/imagens.spec.js` verde (zero distorção).
- [ ] Fotos 'antiga' só com moldura escura e nunca na S2 nem na S7.

**Dados**

- [ ] Preços, horário, composições, modos e combo vêm do `CONFIG`. O CBO Turbo aparece como "Preço a confirmar" e não entra na sacola.
- [ ] Nenhum "Retirada", nenhuma previsão de tempo, moto ou taxa inventada.
- [ ] O domínio `mineirolanches.com.br` não aparece; o QR não aparece na apresentação.
- [ ] Com `loja.modo = 'fechada'` no Supabase local, a parede apaga e o neon diz fechado, mesmo dentro do horário. Com `aberta`, acende fora do horário.

**Jornada**

- [ ] "+" → item na sacola em 1 toque, com toast "Personalizar"; o toque no card abre a ficha; o destaque da bio abre a ficha direto.
- [ ] O combo é a primeira escolha da ficha.
- [ ] "Enviar pedido · R$ X" fica sempre visível no checkout.
- [ ] O cliente que volta encontra nome, telefone e endereço preenchidos.
- [ ] Erro de envio mostra "Tentar de novo" e "Enviar pelo WhatsApp".
- [ ] O tempo de `#cardapio` até "Pedido enviado" no e2e não piora em relação a hoje.

**Movimento e desempenho**

- [ ] Com movimento reduzido: nada pisca, balança, gira, flutua ou fica preso à rolagem; todo o conteúdo das cenas aparece completo e estático; sem View Transitions.
- [ ] Animações infinitas pausam fora da tela e com a aba oculta; só animam `transform`, `opacity` e `clip-path`.
- [ ] Bio e cardápio não baixam o chunk do site antes do idle; o chunk respeita o orçamento de 6.3.
- [ ] LCP, CLS e Lighthouse dentro do orçamento; nenhuma rolagem horizontal da página em 390 e em 1280.
- [ ] Nenhuma violação de CSP no console (`script-src 'self'`; sem script nem handler inline; sem iframe).

**Testes** (todos verdes):

```bash
npm run lint
npm run build
bash scripts/testar-sql.sh --do-zero
node scripts/testar-paridade.mjs
node --test tests/*.test.mjs
npx playwright test
```

---

## 9. Decisões de implementação (12/10)

Onde o código segue um caminho diferente do texto acima, vale esta seção. Os ids D6, D11 e D14 são os de `docs/PLANO-FASE-2.md`, seção 2.

- **D6, o checkout mantém os dados.** Depois do envio, o rascunho (`mineiro:v2:rascunho`) continua com nome, telefone, endereço e referência; sai só a observação, que valia para aquele pedido. Quem volta só confere (checklist de 8, "Jornada"). O e2e confere o rascunho guardado depois do envio.
- **D11, S6 com a régua, S8 sem texto circular.** A S6 tem a régua "Simule um horário" (`input type="range"`, 0h a 24h, passo de 5 min): ela só mexe na luz (`--luz`) da própria seção, nunca no status real nem em `html[data-luz]`, e nasce desabilitada até o JS ligá-la. A S8 ficou com a rota desenhada ao rolar e o cartão do endereço; o texto em círculo não foi feito e não há iframe de mapa ("Abrir no mapa" é um link do Google Maps).
- **D14, a moto fica até o cliente responder.** O ícone `moto` segue em "Entregas", no modo entrega e em "Saiu para entrega" (`app.js`, S8, painel). O cliente nunca disse que a entrega é de moto: nenhum texto diz isso, só o ícone. Se a resposta do item 5 da mensagem (`docs/PLANO-FASE-2.md`, seção 6) for outra, troca-se por `truck`.
- **Entrada da ficha por WAAPI de 200 ms.** A foto do card vira o topo da ficha com `animate()` (translação, escala e raio, `voarParaFicha` em `src/app.js`), não por View Transition como dizia 5.3. A troca de telas (bio, cardápio, site) continua por View Transition de até 200 ms. Com movimento reduzido, a troca é seca.
- **A comanda imprime no acompanhamento.** O checkout limpa a sacola, navega para `#pedido/<token>` e é na comanda do acompanhamento (`#pedido-topo .comanda`) que roda o `imprime` (`clip-path`, 600 ms, uma vez). Com movimento reduzido, não roda.
- **A gaveta `#ficha` fica fora de `#view-app`.** O `<dialog id="ficha">` é irmão de `#view-app` e `#view-site`, não filho de nenhum: o site também a abre ("Pedir este" da S2, o hot dog da S4 e o combo da S5), e um `<dialog>` dentro de um ancestral escondido abre com tamanho zero (correção `555f90a`).
- **Orçamento de 6.3, medido em 12/10 com `node scripts/orcamento-site.mjs` (gzip, build de produção):**

| Item | Limite | Medido |
|---|---|---|
| JS do site (chunk) | ≤ 12 KB | 10,2 KB |
| CSS do site (chunk) | ≤ 10 KB | 8,0 KB |
| JS do cliente no total | < 120 KB | 66,2 KB |
| Primeira vista de `/#site` | ≤ 150 KB | **180,1 KB, fora do limite** |

  A primeira vista de `/#site` tinha 189,5 KB: o script contava o `tijolo.svg` (9,5 KB) que o herói não usa mais (a regra genérica `.parede::before` o pede, a `.s-hero.parede::before` o troca) e deixava de contar o `grao.svg` (0,7 KB). Corrigido o script, a conta é HTML 14,7 + CSS 14,8 + JS estático 31,1 (cliente 19,1 e `store-supabase` 11,9) + chunk do site 18,2 + fontes com preload 23,4 (Lilita One e Oswald 600) + imagens da S0 77,9 (logo-512 70,5; parede desfocada 6,7; grão 0,7). **Só a logo e as duas fontes somam 93,9 KB**; todo o resto (HTML, CSS, JS, chunk e texturas) soma 86,2 KB, e o limite deixa 56,1 KB para ele. A logo não pode ser recomprimida nem refeita. O limite de 150 KB não fecha sem uma destas mudanças, todas maiores que uma limpeza:
  - separar o herói das outras nove cenas no chunk do site (hoje os 18,2 KB inteiros entram na primeira vista, embora só a S0 apareça nela);
  - separar do `store-supabase` o que é só do painel (a mesma função serve às duas páginas e o cliente leva tudo, 11,9 KB gz; o pacote do Supabase já vem por `import()` depois da primeira pintura);
  - subir o limite para o que a logo e as fontes permitem (hoje, cerca de 180 KB).

  Nada disso foi feito aqui. O que saiu de peso real foi `loading="lazy"` no selo-256 do acompanhamento (`#pedido-selo`), que ficava numa tela escondida e baixava 25,4 KB em toda abertura da página, e os padrões `p-rabisco*` do sprite (cerca de 0,3 KB gz no HTML). O script agora também lista as imagens sem `lazy` fora da S0 (hoje só o `selo-128` da barra, 9,8 KB), que o navegador baixa mesmo em tela oculta.
