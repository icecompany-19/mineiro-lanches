# Mineiro Lanche: plano da prévia premium (Bio, Cardápio, Site e Painel de pedidos)

**Status:** construída e testada · 02/10/2026 · `gasplab-previews.vercel.app/mineiro-lanche/`

## Como está montada

| Arquivo | O que é |
|---|---|
| `page.html` → `index.html` | Bio, cardápio, ficha, sacola, checkout, acompanhamento e site; gerado por `node build.mjs <base> mineiro-lanche` |
| `core.js` | Cardápio com os 55 itens e preços, regras (combo +14,90, prensado grátis, adicionais 7,50), horário por dia que atravessa a meia-noite, pedidos guardados no navegador (`mineiro:v1:*`) e sincronia entre abas |
| `app.js` | Lógica do cliente e do site |
| `painel.js` + `painel.css` | Painel de pedidos para computador; feito por agente `frontend` (Sonnet) a partir de `CONTRATO-PAINEL.md` |
| `assets/fotos/` | As 13 fotos do cliente sem alteração de cor ou conteúdo: só redimensionadas (`-q` quadrada para miniatura, `-540` e `-1080` com o quadro inteiro) |
| `assets/recortes/` | 3 recortes sem fundo (Freepik, 3 créditos cada), com o lanche intacto |
| `assets/logo.svg`, `logo-selo.svg` | Logo redesenhado em vetor, fiel ao original, com as fontes embutidas |
| `assets/og.jpg` | Imagem de compartilhamento 1200×630 |

## Roteiro de demonstração (para o Felipe mostrar ao Cauan)

1. Abra `…/mineiro-lanche/#painel` no computador.
2. Clique em **Abrir cardápio ao lado**, ou abra `…/mineiro-lanche/#cardapio` em outra janela do mesmo navegador.
3. No cardápio, escolha um lanche e marque:
   - "tirar algum item";
   - prensado;
   - vira combo +R$ 14,90 e o refrigerante;
   - um adicional.

   Depois envie o pedido.
4. O pedido aparece no painel na hora, com som e aviso.
5. Avance o status no painel e veja a tela do cliente mudar sozinha ("Na chapa" → "Saiu para entrega").
6. Mostre o **Relatório**: taxa de combo, prensados e itens mais vendidos.
7. Mostre **Cardápio → Esgotar hoje**: o item aparece esgotado no cardápio do cliente.
8. Use **Simular pedido** para encher o quadro, e **Configurações → Apagar pedidos de teste** para limpar.

**Limite honesto:** os pedidos ficam no navegador. Celular e computador diferentes não sincronizam; para isso, a próxima etapa é um servidor.

## Respostas do cliente (02/10/2026, legendas e mensagens encaminhadas pelo Felipe)

- **Horário:**

  | Dias | Horário |
  |---|---|
  | Segunda a quinta | 19:00 às 00:00 |
  | Sexta e sábado | 19:00 às 01:00 |
  | Domingo | Não informado (a bio diz "todos os dias") → "a confirmar" |

- **Combo casal e Combo Dilúvio** têm mais de um lanche. Preços: Combo Casal R$ 99,90 (foto: 2 lanches + batata com calabresa, cheddar, maionese e cebola crispy; composição exata a confirmar) e Combo Dilúvio R$ 49,90 (foto: 2 burgers + batata com bacon e cheddar).
- **Itens das legendas que não estão no cardápio impresso:**

  | Item | Preço |
  |---|---|
  | Gran Burger Bacon | R$ 33,40 |
  | Dog com Doritos | R$ 23,90 |
  | Hot Dog Pizza | R$ 26,40 |
  | Gran Bacon + Coca-Cola 350 ml + Maionese artesanal da casa | R$ 42,90 |
  | Combo 2 Hot Dog com Doritos + Coca 600 ml | R$ 57,80 |

- **Legenda × cardápio impresso.** Duas divergências; uso o preço da legenda (mais recente, enviado pelo dono) e mantenho a pendência:

  | Item | Legenda | Cardápio impresso |
  |---|---|---|
  | Gran Salada | R$ 26,90 | R$ 28,90 |
  | Gran Crispy | R$ 27,90 | R$ 26,90 |

- **Combo universal:** "qualquer lanche do cardápio pode ser combo no valor de 14,90: batata 140 g + refrigerante lata 350 ml". O molho da casa aparece só na oferta do Gran Bacon (R$ 42,90), como "Maionese artesanal da casa".
- **"Prensado, se é completo ou não":** confirmado como especificação de todo lanche.
- **Mapeamento final das fotos:**

  | Foto | Item |
  |---|---|
  | 2 | Gran Burger Bacon |
  | 3 | Gran Egg Bacon |
  | 4 | Gran Salada |
  | 5 | Hot Dog Pizza |
  | 6 | Gran Bacon + Coca + Maionese |
  | 7 | Combo 2 Hot Dog com Doritos |
  | 8 | Dog com Doritos |
  | 9 | Gran Crispy |
  | 10 | Gran Burger |
  | 11 | Combo Casal |
  | 12 | Gran Chicken |
  | 13 | Gran Bacon Onion |
  | 14 | Combo Dilúvio |

- **Ainda a confirmar:** domingo, ponto do truck, área e taxa de entrega, formas de pagamento, sabores de refrigerante, composição exata do Combo Casal e as duas divergências de preço acima.
**Endereço previsto:** `gasplab-previews.vercel.app/mineiro-lanche/`, com as partes `#bio`, `#cardapio`, `#site` e `#painel`.
**Padrão:** a mesma jornada das prévias `cafe-da-edna` e `gorilas-point`, num nível acima. Muda em quatro pontos:

1. Fotos reais da casa no lugar de ilustrações.
2. Ícones próprios desenhados para a marca.
3. Logo redesenhado em vetor, fiel ao original.
4. Configurador do lanche (completo ou não, prensado, combo, adicionais) e um **painel de pedidos para computador** que recebe tudo, guardado na memória do navegador.

> As skills `ui-ux-pro-max` e `impeccable` não estão instaladas nesta conta; a busca voltou vazia em 02/10/2026. O plano segue a `codemakers-design`, que incorpora a síntese da UI UX Pro Max, e usa os capítulos de motion, formulários, playbooks (e-commerce, serviço local, operação) e direção de assets.

---

## 1. Fontes e fatos (nada fora desta lista entra na página)

| Dado | Valor | Fonte |
|---|---|---|
| Nome | Mineiro Lanche, food truck | Logo e Instagram @mineirolanchesuzano |
| Bio | Todos os dias · Hambúrguer artesanal · Hot dog com Doritos · Consumo no local · Entregas | Instagram (01–02/10/2026) |
| Destaques do perfil | DOG COM DORITOS · ARTESANAIS · VARIEDADES · CLIENTES · FEEDBACK · Dog Pizza | Instagram |
| Local | "Centro, Suzano" (marcação dos posts); legenda "Suzano e região" | Instagram |
| WhatsApp | (11) 98572-0150 (link da bio, legendas e lona do truck) | wa.me/message/NS4QQJMYPLW6L1 |
| Frases da casa | "Quando bater aquela fome chama o mineiro lanche!", "Diretamente pros amantes de cheddar!", "Queijinho gratinado", "Suzano e região" | Legendas |
| Regras do dono (Cauan, 02/10 02:44) | Especificar se o lanche é **completo ou não** e se é **prensado (não cobram para prensar)**. **Todo lanche do cardápio pode virar combo por +R$ 14,90**: batata frita 140 g + refrigerante lata 350 ml (qualquer um) | Mensagem encaminhada pelo Felipe |
| Cardápio com preços | 2 imagens do cardápio impresso (transcrição na seção 2) | Zip "WhatsApp Unknown 2026-10-02 at 10.13.30" |
| Fotos | 14 imagens (1 logo + 13 produtos), mapeadas na seção 4.4 | Enviadas pelo Felipe |

**Não sabemos (pendências, seção 9):** horário, ponto exato do truck, área e taxa de entrega, formas de pagamento, tempo de preparo, sabores de refrigerante, composição e preço do "combo casal", o que é o adicional "Pizza" e se o combo de +R$ 14,90 inclui o molho da casa.

---

## 2. Cardápio transcrito (preços reais)

> A verificação independente destes preços contra as duas imagens é uma etapa da Fase F2.

### Hambúrguer artesanal (200 g)
| Item | Preço | Composição |
|---|---|---|
| Gran Burguer | 25,90 | Pão, hambúrguer artesanal 200 g, queijo, cheddar, maionese e barbecue |
| Gran Salada | 28,90 | + alface, tomate em rodela, cebola roxa, azeite e sal |
| Gran Egg | 30,90 | + ovo, alface, tomate, cebola roxa, azeite e sal |
| Gran Bacon | 31,90 | + bacon, alface, tomate, cebola roxa, azeite e sal |
| Gran Egg Bacon | 33,90 | + bacon, ovo, alface, tomate, cebola roxa, azeite e sal |
| Gran Big Tudo | 34,90 | + alface, bacon, ovo, requeijão, batata palha, tomate, cebola roxa, azeite e sal |
| Gran Black | 35,90 | + alface, bacon, ovo, tomate, cebola roxa, azeite e sal |
| Gran Big Mineiro | 36,90 | + alface, bacon, ovo, requeijão, batata palha, tomate, cebola roxa, presunto, azeite e sal |
| Gran Chicken | 24,90 | Brioche, hambúrguer de frango empanado, cheddar, maionese, barbecue, alface americano, tomate, cebola roxa |
| Gran Bacon Onion | 34,90 | Brioche, maionese, barbecue, hambúrguer 200 g, 3 onion rings, cheddar cremoso, mussarela, bacon, alface americano, tomate, cebola roxa |
| Gran Crispy | 26,90 | Brioche, maionese, barbecue, hambúrguer 200 g, cheddar cremoso, cebola caramelizada, cebola crispy |

### Hambúrguer tradicional
| Item | Preço | Composição |
|---|---|---|
| X-Burguer | 16,90 | Pão, hambúrguer, queijo, cheddar, maionese e barbecue |
| X-Salada | 19,90 | + alface, vinagrete com cebola, azeite e sal |
| Mega X-Salada Egg | 21,90 | + alface, vinagrete com cebola, azeite, sal e ovo |
| Ultra X-Salada Bacon | 23,90 | + alface, vinagrete com cebola, azeite, sal e bacon |
| Exagerado X-Salada Egg Bacon | 27,90 | + alface, vinagrete com cebola, azeite, sal, ovo e bacon |
| Big Tudo | 28,90 | + alface, vinagrete com cebola, azeite, sal, requeijão, ovo, bacon e batata palha |
| Black Master | 29,90 | Pão australiano, hambúrguer, queijo, cheddar, maionese, barbecue, alface, vinagrete com cebola, azeite, sal, requeijão, ovo, bacon |
| Big Mineiro | 30,90 | + alface, vinagrete com cebola, azeite, sal, requeijão, ovo, presunto, bacon e batata palha |

### Hot dog (salsicha Perdigão)
| Item | Preço | Composição |
|---|---|---|
| Médio | 13,90 | Pão, 1 salsicha, maionese, ketchup, alface, purê, batata palha, cheddar, requeijão, azeite e sal |
| Médio Frango | 19,90 | Igual ao Médio + frango |
| Max | 15,90 | 2 salsichas |
| Max Frango | 21,90 | 2 salsichas + frango |
| Super | 18,90 | 3 salsichas |
| Super Frango | 24,90 | 3 salsichas + frango |

### Baguete
| Item | Preço | Composição |
|---|---|---|
| Carne Maluca | 26,90 | Baguete, carne desfiada, maionese, barbecue, milho, batata palha, vinagrete c/ cebola, purê, requeijão e cheddar |
| X-Frango | 25,90 | Baguete, filé de frango, queijo, purê, batata palha, cheddar, requeijão, vinagrete com cebola, maionese, barbecue, azeite e sal |
| X-Frango Egg Bacon | 29,90 | X-Frango + ovo e bacon |
| X-Calabresa | 25,90 | Baguete, calabresa, queijo, purê, batata palha, cheddar, requeijão, vinagrete com cebola, maionese, barbecue, azeite e sal |
| X-Churrasco | 28,90 | Baguete, contra filé, queijo, purê, batata palha, cheddar, requeijão, vinagrete com cebola, maionese, barbecue, azeite e sal |
| Americano | 21,90 | Baguete, maionese, mussarela, presunto, ovo, tomate em rodela, alface, azeite e sal |

Observação impressa: "Caso prefira o lanche prensado, avisar na hora do pedido."

### Combos impressos
| Item | Preço | Composição |
|---|---|---|
| Combo Dilúvio | 49,90 | 1 Gran Burger, piscininha de cheddar, farofinha de bacon, 140 g de batata frita, refrigerante lata 350 ml (qualquer um) |
| Combo Gran Burger | 39,90 | Brioche, hambúrguer 200 g de carne angus, mussarela, cheddar, maionese, barbecue + 1 Coca 350 ml + 250 g de batata |
| Combo Gran Bacon | 45,90 | … + bacon, alface americano, tomate em rodelas + Coca 350 ml + 250 g de batata |
| Combo Gran Salada | 42,90 | … + alface americano, tomate, cebola roxa + Coca 350 ml + 250 g de batata |
| Combo Gran Bacon Onion | 48,90 | … angus 200 g, mussarela, cheddar, bacon, 3 onion rings + 250 g de batata + Coca 350 ml |
| Combo Hot Dog Max | 29,90 | Pão de dog médio, 2 salsichas, alface, purê, batata palha, ketchup, cheddar, catupiri + 250 g de batata + Coca 350 ml |
| Combo X-Frango | 39,90 | Baguete, filé de frango, mussarela, maionese, barbecue, vinagrete, purê, batata palha, cheddar, catupiry + 250 g de batata + Coca 350 ml |
| Combo Gran Chicken | 38,90 | Brioche, frango empanado, maionese, barbecue, alface americano, tomate, cebola roxa + 250 g de batata + Coca 350 ml |

### Porções, adicionais e bebidas
| Item | Preço |
|---|---|
| Porção de batata (500 g, cheddar, catupiri, bacon e calabresa) | 39,90 |
| Porção de onion (6 unidades) | 14,90 |
| Adicionais (cada): Catupiry · Bacon · Doritos · Queijo · Pizza | 7,50 |
| Refrigerante lata | 8,00 |
| Refrigerante 600 ml | 12,00 |
| Refrigerante 1 litro | 14,00 |
| Refrigerante Dolly | 4,50 |
| Suco lata | 7,00 |
| Suco 1 litro | 11,00 |
| Água | 4,00 |
| H2O | 8,00 |

**Total:** 41 produtos, 5 adicionais e 8 bebidas.

---

## 3. Produto: quatro superfícies, uma jornada

```
Instagram → BIO → CARDÁPIO → FICHA DO LANCHE (configurador) → SACOLA → CHECKOUT
                                                                       │ grava o pedido no navegador
                                                                       ▼
        CLIENTE: "Acompanhe seu pedido" ◄── status ao vivo ──► PAINEL (computador)
        Recebido → Em preparo → Pronto / Saiu → Entregue        aceita · prepara · despacha · imprime
```

### 3.1 Bio (celular)
- **Abertura.** O logo vetorial monta-se em cerca de 1,6 s:
  1. o anel dourado se desenha;
  2. as 5 estrelas acendem em sequência;
  3. "MINEIRO" e "LANCHE" caem com leve quique;
  4. "food truck" aparece.

  Pode ser pulada, só aparece uma vez por sessão e é estática quando o celular pede menos movimento.
- **Topo.** Fundo vermelho com as bordas de papel rasgado vinho e amarelo do cardápio impresso e um padrão leve de rabiscos de lanche. Uma foto real recortada flutua com parallax suave.
- **Selo de funcionamento.** "Todos os dias", e o selo aberto/fechado só liga depois que soubermos o horário (seção 9).
- **Chips da bio:** Hambúrguer artesanal · Hot dog com Doritos · Consumo no local · Entregas.
- **Destaques como no Instagram.** Círculos com os nomes do perfil (Dog com Doritos, Artesanais, Variedades, Dog Pizza). Ao tocar, abre um visualizador tipo stories com as fotos reais, barra de progresso, toque para avançar e o botão "Pedir este".
- **CTAs:** "Fazer pedido" (cardápio) e "WhatsApp" (11) 98572-0150.
- **Destaques da casa** em fotos reais: Gran Bacon Onion, Gran Crispy, Gran Chicken, Combo Dilúvio e um dog com Doritos (rótulo a confirmar).
- **Cartão de informações** em estilo lona do truck: Centro de Suzano · Todos os dias · Entregas em Suzano e região · Consumo no local.

### 3.2 Cardápio
- Cabeçalho fixo com **busca** por nome ou ingrediente ("bacon", "frango", "ovo") e **chips de categoria**: Artesanais, Tradicionais, Hot dog, Baguetes, Combos, Porções, Bebidas. O chip ativo acompanha a rolagem, com sublinhado animado.
- **Faixa fixa da oferta do dono:** "Qualquer lanche vira combo por +R$ 14,90 (batata 140 g + lata 350 ml)". O lanche, a batata e a lata se encaixam ao entrar na tela.
- **Card do produto:** foto real quando existe; sem foto, um card ilustrado com o ícone da categoria e o padrão da marca (nunca foto falsa). Mostra nome, ingredientes resumidos, preço e o botão "+".
- **Filtros rápidos:** Com bacon · Com ovo · Frango · Com batata palha, derivados dos ingredientes.
- **Ficha do lanche** (gaveta inferior, arrastar para fechar; a foto "voa" do card para a ficha):
  1. **Como você quer?** "Completo" (padrão) ou "Tirar algum item": os ingredientes viram chips e o removido ganha um risco animado.
  2. **Prensado?** Não / Sim (grátis). O ícone da prensa desce e o lanche "achata" ao ativar. Texto: "Não cobramos para prensar".
  3. **Vira combo? +R$ 14,90.** Ao ativar, a batata e a lata entram voando e aparece a escolha do refrigerante (lista a confirmar; até lá, campo "Qual refrigerante?").
  4. **Adicionais R$ 7,50 cada:** Catupiry, Bacon, Doritos, Queijo, Pizza, com contador.
  5. Observação, quantidade e total que se recalcula com contagem animada. Botão: "Adicionar · R$ 00,00".
  - Nos **combos impressos**, a ficha mostra "o que vem" e oferece prensado, tirar item e adicionais; não oferece o +R$ 14,90.
  - Nas **bebidas**, adicionar direto.
- **Sacola:** cada linha mostra as escolhas ("Completo · Prensado · Combo (Guaraná) · + Bacon"). Dá para editar a linha (reabre a ficha) e remover por arrasto, com botão equivalente para acessibilidade. Lanches com a mesma configuração se somam.

### 3.3 Checkout
- Nome e telefone, para o painel identificar o cliente.
- Modo, em três opções que vêm da bio: **Entrega · Retirada no truck · Comer no local**. Na entrega: endereço e referência.
- Pagamento: neutro até a casa confirmar ("combinado no momento"); quando confirmar, Pix / cartão / dinheiro com campo de troco.
- Resumo com taxa "a combinar". Botão "Enviar pedido".
- Estados: editando → enviando (o truck dá partida) → enviado. Não existe envio duplicado e nenhum dado digitado se perde.
- Confirmação com **número do pedido** sequencial (#0001…). O food truck em vetor acende as luzes e aparece "Pedido recebido pelo Mineiro Lanche".

### 3.4 Acompanhar pedido (cliente)
- Linha do tempo: Recebido → Em preparo (chama acesa) → Pronto para retirar / Saiu para entrega (moto) → Entregue.
- Atualiza ao vivo quando o painel muda o status, no mesmo navegador.
- Mostra só os horários reais de cada mudança, sem previsão inventada.
- "Também avisar pelo WhatsApp": abre a mensagem no formato padrão das prévias, com as escolhas de cada lanche.
- "Meus pedidos": histórico guardado no navegador.

### 3.5 Site (apresentação imersiva)
1. **Hero:** letreiro 3D "MINEIRO LANCHE" com estrelas cintilando e um burger real recortado girando levemente com o mouse ou a rolagem. CTA "Fazer pedido".
2. **Fita rolante:** Todos os dias · Hambúrguer artesanal · Hot dog com Doritos · Consumo no local · Entregas. Acelera com a rolagem.
3. **"Monte seu combo"** interativo: escolha um lanche num carrossel de recortes, ative o combo, e a batata e a lata se encaixam. O preço real aparece na hora (ex.: Gran Burguer 25,90 + 14,90 = **R$ 40,80**).
4. **"Prensado ou não?"**: a prensa desce sobre o lanche ao arrastar ou tocar. Texto: "Não cobramos para prensar".
5. **Artesanais:** galeria horizontal de fotos reais com inclinação 3D, ingredientes e preço.
6. **Hot dog com Doritos:** foto real em destaque e triângulos de Doritos caindo com a rolagem (é destaque do perfil deles).
7. **Combos:** cartas empilhadas com fotos reais (Dilúvio, Gran Bacon Onion…).
8. **Galeria "Do nosso truck":** as 13 fotos em mosaico com visualização ampliada.
9. **Onde e quando:** Centro de Suzano · todos os dias · entregas em Suzano e região · consumo no local. Horário e ponto entram quando confirmados.
10. **Final:** "Quando bater aquela fome, chama o Mineiro Lanche!" (frase deles) + Fazer pedido + WhatsApp.

### 3.6 Painel de pedidos (computador, a partir de 1024 px)
No celular mostra "Abra no computador para a melhor experiência" e uma lista simples.

- **Estrutura.** Barra lateral com logo e as seções Pedidos, Histórico, Cardápio, Relatório e Configurações. Barra superior com:
  - **status da loja** (aberto/fechado, que reflete no selo da bio e do cardápio);
  - som on/off e relógio;
  - "Simular pedido" e "Abrir cardápio ao lado" (abre o cardápio numa janela vizinha para a demo).
- **Pedidos (quadro):** colunas Novos · Em preparo · Pronto / Em rota · Concluídos hoje.
  - Card: número, tempo decorrido (muda de cor por limiar configurável), nome, modo (ícone), itens com selos **PRENSADO**, **COMBO + refri**, **SEM: cebola…**, **+ adicionais**, total, pagamento/troco, endereço (copiar / abrir no Maps) e observação.
  - Ações: Aceitar, Avançar, **Imprimir comanda** (impressão em 80 mm, formato de impressora térmica), Cancelar com motivo, Chamar no WhatsApp.
  - Arrastar entre colunas, com botões equivalentes para teclado.
  - **Pedido novo chega com:** som curto gerado no navegador (depois do primeiro clique), aviso na tela, card entrando com destaque e título da aba "(1) Novo pedido — Mineiro Lanche".
- **Indicadores do dia:** pedidos, faturamento (preços reais), ticket médio e itens em preparo, com contagem animada.
- **Relatório:**
  - itens mais vendidos;
  - pedidos por hora;
  - divisão entrega / retirada / local;
  - adicionais mais pedidos;
  - **% de lanches que viraram combo (+R$ 14,90)**, que mostra ao dono se a estratégia dele funciona.

  Dados de exemplo sempre rotulados como exemplo.
- **Histórico:** busca, filtro por status e data, exportação CSV.
- **Cardápio (gestão):** marcar item ou categoria como **esgotado**, refletido ao vivo no cardápio do cliente ("Esgotado hoje").
- **Configurações:** limpar pedidos de teste, gerar 15 pedidos de exemplo (marcados), som e limiares de atraso.

### 3.7 Limite honesto do painel (precisa estar escrito no próprio painel)
Os pedidos ficam guardados **no navegador do aparelho**. Na demo, cardápio e painel abertos no **mesmo computador** (lado a lado ou em duas abas) sincronizam na hora. Um pedido feito em outro celular **não** chega ao painel do computador. Para isso é preciso um servidor (próximo passo, ex.: Neon ou Supabase com notificação).

---

## 4. Identidade visual

### 4.1 Logo redesenhado (vetor fiel, sem mudar a identidade)
- Mesma composição do original:
  - disco vermelho com degradê radial;
  - anel dourado metálico (degradê de várias paradas com brilho);
  - 5 estrelas douradas;
  - "MINEIRO" amarelo com contorno vinho e sombra 3D;
  - "LANCHE" branco 3D;
  - "food truck" em branco.
- Versões: completa, selo compacto (para a barra), monocromática (comanda impressa), favicon, PNG 1024 e og:image 1200×630 (gerados por script a partir do SVG).
- Animações: o anel se desenha, as estrelas cintilam e um brilho dourado varre o anel a cada ~6 s.
- Entrega lado a lado "original × redesenho" para aprovação do cliente.

### 4.2 Cores (todas com contraste ≥ 5:1)
| Papel | Cor | Uso |
|---|---|---|
| Vermelho logo | `#C8102E` | Botões principais (texto branco, 5,9:1) |
| Vinho | `#7A1426` | Bordas rasgadas, títulos sobre amarelo (6,5:1) |
| Amarelo cardápio | `#F7C21B` | Fundos de destaque, preços sobre carvão (11:1) |
| Dourado | `#E8B33A` → `#B8862B` | Anel, estrelas, detalhes metálicos |
| Carvão | `#1A1414` | Fundo das fotos e do painel |
| Creme | `#FFF6E0` | Superfícies claras e texto sobre carvão (16,9:1) |
| Verde status | `#2E7D4F` | "Aberto" e "Pronto" (texto branco, 5,1:1) |

### 4.3 Tipografia e texturas
- **Lilita One:** títulos, a fonte mais próxima das letras do logo.
- **Oswald:** categorias e preços, condensada como no cardápio impresso.
- **Rubik:** textos.
- Proibidas no projeto: Inter, Roboto, Arial, Fraunces.
- Texturas: bordas de papel rasgado (máscara SVG), padrão de rabiscos de lanche em traço fino (como o fundo do cardápio) e lona do truck.

### 4.4 Ícones próprios (~30, mesma grade 24 px, traço 2 px arredondado, duotom amarelo + vinho)
- **Categorias:** hambúrguer, hot dog, baguete, combo, batata, onion rings, lata, garrafa, suco, água.
- **Opções:** completo, tirar item, **prensa**, adicional, catupiry, bacon, Doritos, queijo, fatia de pizza.
- **Modos:** moto (entrega), sacola (retirada), mesa (comer no local), food truck.
- **Painel:** sino, chama (em preparo), check (pronto), impressora, relógio, pino, conversa.
- Cada ícone tem um micro-movimento de estado: a prensa desce, o sino balança, a chama tremula e o check se desenha.

### 4.5 Fotos reais (mapeamento a confirmar com o cliente)
| Foto | O que mostra | Uso proposto |
|---|---|---|
| 1 | Logo atual | Referência do redesenho |
| 2 | Burger com bacon em cubos e creme branco, pão com gergelim | Gran Bacon (+catupiry?) |
| 3 | Ovo, bacon, cheddar, alface, tomate, cebola, batata palha | Gran Big Tudo |
| 4 | Brioche, cheddar, creme, alface, tomate, cebola roxa | Gran Salada |
| 5 | Dog com queijo gratinado, azeitona e orégano | Dog Pizza (adicional "Pizza"?) |
| 6 | Burger com ovo, presunto, bacon + lata + **pote "molho da casa" com o logo** | Combo de um lanche / Big Mineiro |
| 7 | Lanches prensados com Doritos + Coca 2 L | Prensado + Doritos |
| 8 | Dog com Doritos e cheddar (481 px) | Destaque "Dog com Doritos" (uso pequeno) |
| 9 | Cebola caramelizada, cheddar cremoso, cebola crispy (arte com fogo) | Gran Crispy |
| 10 | Burger com cheddar, creme e molho | X-Burguer / Gran Burguer |
| 11 | Caixa com batata, calabresa, cheddar, maionese, cebola crispy + 2 lanches | Combo casal? / Porção de batata |
| 12 | Frango empanado, cheddar, alface, tomate | Gran Chicken |
| 13 | Onion rings, bacon, cheddar, cebola roxa | Gran Bacon Onion |
| 14 | 2 burgers + batata com bacon e cheddar | Combo Dilúvio / combo duplo? |

**Tratamento por script (sharp, já instalado, sem custo):**
- Corte 4:5 e 1:1 com o ponto focal no lanche.
- Correção leve e uniforme de temperatura e contraste.
- WebP em 480 e 960 px, com miniatura borrada embutida enquanto a foto carrega.
- Meta: menos de 150 KB por foto grande.

**Recortes sem fundo (Freepik, 3 créditos cada; a conta tem 27):** 7 recortes (21 créditos) para hero, "Monte seu combo" e "Prensado": fotos 13, 12, 9, 3, 6, 2 e 4.
- Batata e lata no montador entram como ilustração própria; não recortamos a marca Coca-Cola.

---

## 5. Sistema de movimento

| Item | Valor |
|---|---|
| Tokens | Pressão 120 ms · interface 220 ms · gaveta 320 ms · narrativa 600 ms |
| Easings | Saída rápida para entradas · mola discreta só para objetos (lanche, prensa, lata) |
| Técnica | CSS + Web Animations, View Transitions entre telas (com alternativa), técnica FLIP card → ficha, um laço único de rolagem, IntersectionObserver só para aprimorar (conteúdo visível por padrão). Sem bibliotecas |
| Momento assinatura por superfície | Bio: logo se montando · Cardápio: combo se encaixando e prensa · Pedido: truck acendendo + linha do tempo · Site: "Monte seu combo" e Doritos caindo · Painel: pedido chegando com som |
| Menos movimento | Tudo funciona estático, sem depender de fim de animação |
| Orçamento | 1ª visualização < 1,2 MB, LCP < 2,5 s em 4G, 60 fps alvo em Android intermediário, só transform/opacity em loops |

---

## 6. Arquitetura técnica

### Arquivos
```
previews/mineiro-lanche/
  page.html        bio + cardápio + site + painel (formato Artifact, marcador <!--BODY-->)
  meta.json        título, descrição, og:image, ícone
  assets/fotos/    WebP tratadas · assets/recortes/  WebP sem fundo
  assets/logo.svg  · og.jpg · icon.png
  README.md        este plano → vira a documentação da prévia
```

### CONFIG
O `CONFIG` concentra os 41 produtos com preços, os 5 adicionais, as 8 bebidas e as regras:
- `combo: { preco: 14.90, inclui: ['Batata frita 140 g', 'Refrigerante lata 350 ml'] }`
- `prensado: { preco: 0 }`
- loja e links.

### Carrinho
- Cada linha tem uma chave = produto + escolhas.
- Preço da linha = base + adicionais × 7,50 + (combo ? 14,90 : 0), vezes a quantidade.

### Pedido
```
{ id, numero, criadoEm, origem: 'cardapio' | 'simulado' | 'exemplo',
  cliente: { nome, telefone }, modo: 'entrega' | 'retirada' | 'local',
  endereco, referencia, pagamento, troco, obs,
  itens: [{ produtoId, nome, preco, qtd, completo, removidos[], prensado,
            combo: { ativo, refri }, adicionais: [{ id, qtd }], subtotal }],
  total, status: 'novo' | 'preparo' | 'pronto' | 'rota' | 'entregue' | 'cancelado',
  historico: [{ status, em }] }
```

### Armazenamento e sincronia
- Chaves com prefixo `mineiro:v1:` (o domínio gasplab-previews é compartilhado com as outras prévias).
- Tudo com try/catch e alternativa em memória.
- Sincronia entre abas por `BroadcastChannel` + evento `storage`.

### Outros
- **Mensagem do WhatsApp:** mesmo formato das outras prévias, com uma sublinha de escolhas por item:
  ```
  1× Gran Bacon Onion — R$ 49,80
     Completo · Prensado · Combo (Guaraná) · + Bacon
  ```
- Comanda impressa via `@media print` (80 mm), som por WebAudio (sem arquivo de áudio), `noindex` e og:image absoluta pelo `build.mjs`.

---

## 7. Execução: fases, responsáveis e modelos

| Fase | Entrega | Quem / modelo | Gate |
|---|---|---|---|
| G0 | Aprovação deste plano + respostas da seção 9 | Felipe / Cauan | Sim |
| F1 Assets | Tratamento das fotos (script), 7 recortes (Freepik, 21 créditos), logo SVG, ícones, og:image | Eu (Opus) no design; script no mecânico | Revisão do logo × original |
| F2 Dados | `CONFIG` com os 41 itens + verificação independente dos preços contra as 2 imagens | Eu monto; **fact-checker em Haiku** confere | 100% dos preços batendo |
| F3 Núcleo do cliente | Bio, cardápio, ficha configuradora, sacola, checkout e acompanhamento | Eu (Opus): lógica e design | Jornada completa no navegador |
| F4 Painel | Quadro, indicadores, relatório, histórico, gestão de esgotados, comanda e sincronia | **Agente `frontend` em Sonnet**, a partir de um contrato fechado (esquema do pedido + tokens + CONFIG). Eu reviso e integro | Pedido do cardápio chega em < 1 s na outra aba |
| F5 Site | Seções imersivas da 3.5 | Eu (Opus) | Revisão visual 390 / 1280 |
| F6 QA | Mecânico (noindex, recursos externos, acessibilidade, console, 390/1280) + factual + teste de ponta a ponta | **qa-runner e fact-checker em Haiku**; ponta a ponta eu no navegador | 0 falhas críticas |
| F7 Publicação | `build.mjs` com a URL base, commit só da pasta, push, conferência no ar e link privado | Eu | Link no ar |

A F4 corre em paralelo à F3 porque o painel só depende do contrato de dados.

---

## 8. Critérios de aceite
1. Os 41 preços batem com o cardápio impresso; o combo soma +14,90; cada adicional soma 7,50; prensado não muda o preço.
2. Todo lanche avulso tem: Completo / tirar item, Prensado (grátis) e Vira combo (+14,90 com escolha do refri).
3. O pedido enviado aparece no painel em menos de 1 s no mesmo navegador; a mudança de status volta para a tela "Acompanhe seu pedido".
4. Item marcado como esgotado no painel aparece como esgotado no cardápio.
5. Indicadores e relatório calculados só a partir dos pedidos guardados; exemplos marcados como exemplo.
6. Comanda imprime legível em 80 mm.
7. Funciona em 390 px e a partir de 1280 px, sem rolagem lateral, com navegação por teclado, contraste ≥ 4,5:1 e versão com menos movimento.
8. Nenhum dado inventado (horário, pagamento, taxa e combo casal ficam "a confirmar" até a resposta).
9. `noindex`, sem erros no console e foto principal otimizada.

---

## 9. Perguntas para o cliente (não travam o início; travam a versão final)
1. **Combo +R$ 14,90 × combos impressos.** Os impressos trazem 250 g de batata e preço próprio (ex.: Combo Gran Burger 39,90; Gran Burguer 25,90 + 14,90 = 40,80). Proposta: manter os impressos como estão e oferecer o +14,90 em todo lanche avulso. Confere?
2. **O combo de +14,90 inclui o molho da casa?** O Felipe citou "lanche, batata e o molho da casa"; o Cauan citou batata 140 g + lata.
3. **O que é o adicional "Pizza"?** (Parece a cobertura do "Dog Pizza": queijo gratinado, azeitona e orégano.)
4. **Combo casal:** composição e preço (não está no cardápio impresso).
5. **Horário e dias** (a bio diz "todos os dias").
6. **Ponto exato do truck** em Suzano.
7. **Área e taxa de entrega.**
8. **Formas de pagamento** e se há troco.
9. **Sabores de refrigerante lata disponíveis** (para o seletor do combo), sabores de suco e o que é "H2O".
10. **"Completo ou não"** significa "com todos os ingredientes ou tirando algum"? E o prensado vale também para hot dog?
11. **Aprovação do redesenho do logo** (fiel ao original).
12. **Pedido de teste:** fica só no painel ou também abre o WhatsApp real com a marca "teste da prévia" (como no Sr. Parmê e no Gorilas Point)?

---

## 10. Riscos
- **Painel sem servidor:** só sincroniza no mesmo navegador. Resposta: o aviso no próprio painel, o botão "Abrir cardápio ao lado" e um roteiro de demo para o Felipe.
- **Domínio compartilhado entre prévias:** chaves com prefixo `mineiro:v1:`.
- **Peso da página com muitas fotos:** WebP, carregamento sob demanda e miniaturas borradas.
- **Créditos do Freepik:** 7 recortes cabem nos 27 créditos. Ampliação de fotos (Magnific) não cabe hoje; a foto 8 fica só em tamanho pequeno.
- **Logo:** o redesenho precisa ser aprovado. A prévia pode alternar original × redesenho até a resposta.
