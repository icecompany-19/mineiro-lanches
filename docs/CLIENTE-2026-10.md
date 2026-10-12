# Mineiro Lanche: respostas do cliente (outubro de 2026)

Fonte: conversa de WhatsApp com Cauan Oliveira, de 06 a 12/10/2026, exportada em 12/10. Só os fatos do negócio foram transcritos aqui. Este documento **substitui** os pontos equivalentes de `docs/PREVIA-DECISOES.md`.

## Loja

| Item | Valor |
|---|---|
| Endereço | Rua Eliziel Alves Costa, 300, Centro, Suzano/SP (ponto do truck) |
| Horário | Todos os dias, das 19:00 às 00:00. Sexta e sábado, das 19:00 às 01:00. **Domingo abre**, das 19:00 às 00:00 |
| Prensado | "Avisar antes; não cobramos para prensar" |
| QR code | **Não é necessário agora.** Só vai ser usado quando alugarem o salão ao lado. A estrutura fica pronta, mas não é prioridade e não precisa aparecer na apresentação |
| Domínio | `mineirolanches.com.br` **não é do cliente** (pertence a outra empresa). Não usar. Até haver domínio próprio, a URL é `https://mineiro-lanches.vercel.app` |
| Identidade | Logo oficial: `design/logo/LOGOTIPO_MINEIRO.pdf` (CorelDRAW, vetor e bitmap). Usar **exatamente** essa arte, sem redesenho, sem IA e sem mudar cor ou forma |
| Estética | Fotos novas num cenário de **parede de tijolinho** ("colocar o tijolinho no site, vai conversar bem"). O cliente pediu que o site seja **inspirado na prévia Gorilas Point** (gasplab-previews.vercel.app/gorilas-point) |

## Cardápio: composições informadas pelo dono

**Hot dogs** (salsicha Perdigão). Todos têm a mesma base; só muda a quantidade de salsicha:

- **Base:** pão médio, maionese, ketchup, alface, purê de batata, azeite, sal, batata palha, cheddar e catupiry.
- **Médio:** 1 salsicha. **Max:** 2 salsichas. **Super:** 3 salsichas. As versões Frango seguem como estão no cardápio impresso.
- **Dog Bacon:** a base com bacon. **Dog Pizza:** a base com a cobertura pizza. É o adicional "Pizza" (queijo gratinado e orégano, como na foto do "Hot Dog Super Pizza").
- **Hot Dog CBO Turbo** (item novo): pão de dog, 3 salsichas Perdigão, maionese, ketchup, alface, azeite, sal, purê de batata, batata palha, cheddar, catupiry, queijo mussarela gratinado e bacon. **Preço não informado** ("depois mando os valores separado").
- Os três tamanhos podem usar a mesma foto (a do Dog Max).

**Artesanais** (hambúrguer angus 200 g, "pão seladinho na chapa"):

| Item | Composição |
|---|---|
| Gran Bacon | Pão seladinho na chapa, maionese grill, barbecue, hambúrguer angus 200 g, cheddar cremoso, mussarela, bacon em tiras, alface americana, tomate em rodelas, cebola roxa |
| Gran Bacon Onion | Pão seladinho na chapa, maionese grill, barbecue, hambúrguer angus 200 g, cheddar cremoso, bacon em fatias, 3 onion rings, alface americana, tomate em rodelas, cebola roxa |
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
