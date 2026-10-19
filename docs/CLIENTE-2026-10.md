# Mineiro Lanche: respostas do cliente (outubro de 2026)

Fonte: conversa de WhatsApp com Cauan Oliveira, de 06 a 12/10/2026, exportada em 12/10. Só os fatos do negócio foram transcritos aqui. Este documento **substitui** os pontos equivalentes de `docs/PREVIA-DECISOES.md`.

**Atualização de 16/10/2026:** o modo antes exibido como "Comer no local" passa a ser **"Retirada no local"**, conforme solicitado. O site, o checkout, o painel, a comanda e as mensagens usam essa identificação; o identificador interno `local` é preservado para os pedidos existentes.

**Atualização de 18/10/2026:** o dono solicitou implementar a solução de entrega confiável recomendada. Com a cotação ativada, uma nova entrega só é aceita com taxa calculada e incluída no total. Localização ambígua pede confirmação no mapa; falha completa preserva a sacola para recuperação. A fórmula de cobrança continua a mesma, e pedidos históricos não têm valores alterados. Configuração/ativação em `docs/ENTREGA-OPERACAO.md`.

## Loja

| Item | Valor |
|---|---|
| Endereço | Rua Eliziel Alves Costa, 300, Centro, Suzano/SP (ponto da loja) |
| Horário | **Segunda, terça e quinta: 19:00–00:00. Sexta, sábado e domingo: 19:00–01:00 do dia seguinte. Quarta fechada.** Horário real corrigido pelo dono em 17/10/2026, substitui a configuração anterior de 18h–0h. `CONFIG.horarios` e `CONFIG.horarioTexto` |
| Prensado | "Avisar antes; não cobramos para prensar" |
| Prazo de espera | **Até 50 minutos, podendo chegar antes** (16/10/2026). Aparece no checkout, no acompanhamento e na seção "onde" do site |
| Taxa de entrega | **km de distância + R$ 4, sempre arredondando para cima** (16/10/2026: "10 km + 4 reais" = R$ 14). Lido como R$ 1 por km rodado + R$ 4 fixos; **confirmar com o dono**. O cliente **não vê a regra**: só o valor calculado para o endereço dele (decisão de 16/10/2026). Distância pela rota de carro, da loja até o endereço do cliente. `CONFIG.entrega.taxa` |
| Impressora da comanda | Térmica, papel **72 mm × 210 mm** (203 dpi), foto do dono em 16/10/2026. A comanda sai em negrito |
| Endereço do cliente | Por CEP: o cliente digita o CEP, vêm rua, bairro e cidade; ele completa o número |
| QR code | **Não é necessário agora.** Só vai ser usado quando alugarem o salão ao lado. A estrutura fica pronta, mas não é prioridade e não precisa aparecer na apresentação |
| Entregador (motoboy) | Pedido do dono em 16/10/2026: o motoboy tem **usuário próprio**, lê o **QR da comanda** e o pedido já fica como entregue. Tela em `/motoboy/`; o QR da comanda leva a `https://mineirolanches.store/motoboy/#<pedido>` e só sai em pedido de entrega. É outro QR, não o do cardápio da linha acima |
| Domínio | **`https://mineirolanches.store`** (decisão de 17/10/2026): registrado na Hostinger em 15/10/2026 e já apontado para a Vercel (apex e www com HTTPS). `mineirolanches.site` não está registrado. `mineirolanches.com.br` **não é do cliente** (pertence a outra empresa). `https://mineiro-lanches.vercel.app` continua respondendo |
| Identidade | Logo oficial: `design/logo/LOGOTIPO_MINEIRO.pdf` (CorelDRAW, vetor e bitmap). Usar **exatamente** essa arte, sem redesenho, sem IA e sem mudar cor ou forma |
| Estética | Fotos novas num cenário de **parede de tijolinho** ("colocar o tijolinho no site, vai conversar bem"). O cliente pediu que o site seja **inspirado na prévia Gorilas Point** (gasplab-previews.vercel.app/gorilas-point) |

## Cardápio: composições informadas pelo dono

**Hot dogs** (salsicha Perdigão). Todos têm a mesma base; só muda a quantidade de salsicha:

- **Base:** pão médio, maionese, ketchup, alface, purê de batata, azeite, sal, batata palha, cheddar e catupiry.
- **Médio:** 1 salsicha. **Max:** 2 salsichas. **Super:** 3 salsichas. As versões Frango seguem como estão no cardápio impresso.
- **Dog Bacon:** a base com bacon. **Dog Pizza:** a base com a cobertura pizza. É o adicional "Pizza" (queijo gratinado e orégano, como na foto do "Hot Dog Super Pizza").
- **Hot Dog CBO Turbo**: pão de dog, 3 salsichas Perdigão, maionese, ketchup, alface, azeite, sal, purê de batata, batata palha, cheddar, catupiry, queijo mussarela gratinado e bacon. **R$ 34,90**, confirmado pelo dono em 17/10/2026.
- Os três tamanhos podem usar a mesma foto (a do Dog Max).

**Artesanais** (hambúrguer angus 200 g, "pão seladinho na chapa"):

| Item | Composição |
|---|---|
| Gran Bacon | Pão seladinho na chapa, maionese grill, barbecue, hambúrguer angus 200 g, cheddar cremoso, mussarela, bacon em tiras, alface americana, tomate em rodelas, cebola roxa |
| Gran Bacon Onion | Pão seladinho na chapa, maionese grill, barbecue, hambúrguer angus 200 g, cheddar cremoso, bacon em fatias, 2 onion rings, alface americana, tomate em rodelas, cebola roxa |
| Gran Salada | Pão seladinho na chapa, maionese grill, hambúrguer angus 200 g, cheddar cremoso, mussarela, barbecue, alface americana, tomate em rodelas, cebola roxa |

**Tradicionais** (hambúrguer de 90 g):

| Item | Composição |
|---|---|
| X-Salada (tradicional) | Pão de hambúrguer, hambúrguer 90 g, mussarela, cheddar, maionese, barbecue, alface, vinagrete, azeite e sal |
| Ultra X-Salada Bacon | Pão de hambúrguer, hambúrguer 90 g, cheddar cremoso, mussarela, bacon, alface, vinagrete, azeite e sal |
| Exagerado X-Salada Egg Bacon | Pão de hambúrguer, maionese, barbecue, hambúrguer 90 g, cheddar cremoso, mussarela, bacon, ovo, alface, vinagrete, azeite e sal |
| Big Mineiro | Pão de hambúrguer, hambúrguer 90 g, mussarela, presunto, ovo, bacon, maionese, barbecue, batata palha, alface, vinagrete, azeite e sal |

**Baguete**

| Item | Composição |
|---|---|
| X-Churrasco | Pão de baguete, maionese, barbecue, vinagrete, contra-filé, mussarela, purê de batata, batata palha, cheddar, requeijão |

**Porção**

| Item | Composição |
|---|---|
| Porção de batata turbinada | 500 g de batata frita, cheddar cremoso, bacon, requeijão, calabresa, alho-poró |

**Preços:** o dono vai mandar "os valores separado". Até lá, vale o que está no `CONFIG`. Item novo sem preço aparece como "Preço a confirmar" e não pode ir para a sacola; o cliente consulta pelo WhatsApp.

## Fotos novas (cenário de tijolinho)

O dono pediu para desconsiderar as fotos antigas: "vou mandar todas no mesmo cenário". Os arquivos baixados do WhatsApp trazem data e hora no nome (`WhatsApp Image 2026-10-09 at 18.58.xx.jpeg`). A tabela abaixo liga cada horário de envio ao produto e é usada pelo `scripts/fotos.mjs`.

| Envio | Legenda do dono | Produto (id) |
|---|---|---|
| 09/10 18:58 | Gran Bacon | `gran-bacon` |
| 09/10 19:43 | Dog Max | `dog-max` (também `dog-medio` e `dog-super`) |
| 09/10 20:02 | Exagerado X Egg Bacon | `exagerado-x-salada-egg-bacon` |
| 09/10 20:27 | Gran Bacon Onion | `gran-bacon-onion` |
| 09/10 20:28 | Combo Gran Bacon Onion | `combo-gran-bacon-onion` |
| 09/10 20:36 (álbum, 3 fotos) | Porção de batata turbinada | `porcao-batata` |
| 09/10 21:03 | Hot Dog CBO Turbo | `dog-cbo-turbo` (novo) |
| 09/10 21:04 | X-Salada Tradicional | `x-salada` |
| 09/10 21:05 | Gran Salada | `gran-salada` |
| 09/10 21:06 | Ultra X Salada Bacon | `ultra-x-salada-bacon` |
| 09/10 21:08 | Combo Gran Onion Bacon (2ª foto) | `combo-gran-bacon-onion` (alternativa) |
| 09/10 21:15 | Combo Casal (fora do cenário; o dono achou "zoado") | `combo-casal`, só se não houver outra |
| 09/10 23:26 | X Churrasco | `x-churrasco` |
| 09/10 23:46 | Big Mineiro | `big-mineiro` |
| 10/10 18:03 | (sem legenda) | identificar pela imagem |
| 12/10 00:15 | (sem legenda) | identificar pela imagem |
| 12/10 00:18 | Gran Crispy | `gran-crispy` |
| 08/10 10:44 a 10:51 (antigas) | Hot Dog Super Pizza, Gran Salada, Gran Egg, Gran Bacon | só onde não houver foto nova (`dog-pizza`, `gran-egg`) |

## ATUALIZAÇÃO 12/10: fotos novas recebidas

> **Atenção, agentes:** as fotos novas CHEGARAM. Qualquer instrução que diga "as fotos ainda não chegaram" está desatualizada.

- **Originais:** `design/fotos-cliente/`, 11 arquivos de 1200×1600 já com o nome do produto e sem EXIF.
- **Variantes no padrão do app:** `public/assets/fotos/<slug>-q|540|1080.webp`. O `public/assets/fotos.json` marca cada uma com `origem: 'nova'` e traz o `foco` (object-position do lanche).
- **Cenário:** parede de tijolinho **laranja-terracota com rejunte cinza-claro**, prato de inox e um vasinho de planta. É claro e quente; num visual escuro, a foto funciona como "parede iluminada".

**Textura REAL da parede** (recortes das fotos, sem retoque), em `public/assets/texturas/`:

| Arquivo | Origem |
|---|---|
| `tijolo-real-1.webp` | Parede nítida, do CBO Turbo |
| `tijolo-real-2.webp` | Parede nítida, do Gran Crispy |
| `tijolo-real-desfocado.webp` | Parede desfocada, do Gran Bacon Onion; bom para o fundo do hero |

Use as texturas reais no lugar do tijolinho desenhado em código; o desenho fica só como plano B.

| Arquivo do cliente | Produto (slug da foto) |
|---|---|
| big-mineiro | `big-mineiro` |
| dog-max | `dog-max` (também `dog-medio` e `dog-super`) |
| exagerado-x-egg-bacon | `exagerado-x-salada-egg-bacon` |
| gran-bacon-onion | `gran-bacon-onion` |
| gran-crispy | `gran-crispy` |
| gran-onion-bacon | `combo-gran-bacon-onion` (com Coca lata e batata) |
| gran-salada | `gran-salada` |
| hotdog-cbo-turbo | `dog-cbo-turbo` |
| ultra-x-salada-bacon | `ultra-x-salada-bacon` |
| x-churrasco | `x-churrasco` |
| x-salada-tradicional | `x-salada` |

**Ainda faltam** (o cliente vai mandar mais):

- Gran Bacon, Porção de batata turbinada, Combo Casal e Gran Egg.
- 10 produtos usam fotos antigas (origem 'antiga', cenário diferente): gran-burger, gran-burger-bacon, gran-egg-bacon, gran-chicken, dog-doritos, dog-pizza, combo-diluvio, combo-casal, gran-bacon-coca-maionese e combo-2-dog-doritos.
- 25 produtos fora das bebidas não têm foto e aparecem com a arte da categoria (lista completa: `npm run fotos -- --simular`, seção "Produtos sem foto"). As 8 bebidas não levam foto.

## Correção de comunicação em 19/10/2026

O responsável confirmou que a retirada acontece **na loja local**, e não em food truck. Usar “Retirada no local” e “Retire seu pedido na loja”. Manter o endereço cadastrado; nenhum novo endereço foi informado.
