# Hot dogs no topo do cardápio (desenho, 22/11/2026)

Prévia aprovada pelo usuário em 22/11/2026: "v3" (carrossel de fotos, índice do cardápio, régua de tamanhos). Este documento diz o que construir; o plano de implementação vem depois.

## Por quê

O hot dog é o carro-chefe da loja: na 99Food, de 14 a 20/11, os hot dogs foram cerca de 93% do volume. No cardápio do site ele é a 3ª categoria, atrás de Artesanais e Tradicionais. O pedido é que quem abre o cardápio veja primeiro os hot dogs, com a foto do lanche, e entenda logo que o cardápio inteiro está ali embaixo.

Hoje a primeira tela do cardápio no celular empilha cabeçalho, busca, chips de categoria, chips de filtro e a faixa do combo: mais de 230 px de controles antes do primeiro lanche.

## Objetivos

1. Hot dog como primeira categoria.
2. Carrossel de fotos de hot dog no topo do cardápio.
3. Primeira tela mais limpa: cabeçalho numa linha; busca e filtros atrás de uma lupa.
4. Índice "Cardápio completo" com todas as categorias e a quantidade de itens, para deixar claro que há cardápio inteiro abaixo. A barra de categorias só aparece quando o índice sai da tela.
5. Régua Médio, Max e Super no topo da categoria Hot dog.
6. Menos movimento: nada se mexe sozinho.

## Fora do escopo

Bio (exceto o efeito da ordem, abaixo), site imersivo, ficha, sacola, checkout, painel, preços e fotos novas.

## O que não pode acontecer

- Foto gerada, recortada ou retocada (regra do projeto).
- Preço escrito à mão: tudo vem do catálogo ao vivo.
- O banner esconder o cardápio: o índice e o começo da lista precisam aparecer na primeira tela.
- Carrossel que passa sozinho.
- Quebrar seletores protegidos (`docs/DIRECAO-VISUAL.md` §5.0) e os que os testes usam: `#f-busca`, `#chips`, `[data-chip]`, `#filtros`, `.faixa-combo`, `[data-faixa-combo]`, `[data-combo-preco]`, `#menu-lista`, `.cat`, `.prod`, `[data-abrir]`, `[data-rapido]`.

## Restrições

CSP `script-src 'self'` (nada inline); `index.html` editado por trechos; alvos de toque de pelo menos 44 px; com movimento reduzido, nenhuma animação; no computador o app continua na coluna de 440 px; textos só com fatos do `CONFIG` ou do catálogo.

## Caminhos considerados

| Caminho | O que era | Por que ficou de fora |
|---|---|---|
| A, vitrine | Letreiro, foto num disco com texto girando, escada de tamanhos | Ocupava a primeira tela inteira e escondia o cardápio |
| B, carrossel com disco | Slides automáticos com a foto no círculo | Muita animação; a foto pequena no círculo não mostra o lanche |
| C, categoria vestida | Só o título "Hot dog" maior com a régua | Discreto demais para o pedido de banner |
| v2 | Vitrine compacta com disco + índice + barra que entra na rolagem | Aprovada na organização; reprovada no disco e na animação |
| **v3 (escolhida)** | **Carrossel de fotos grandes + índice + régua** | — |

## Desenho

1. **Cabeçalho:** voltar, selo, "Cardápio" com o status, **lupa** e sacola, numa linha.
2. **Busca:** a lupa abre um painel por cima com o campo `#f-busca` e os filtros `#filtros`. Com busca ou filtro ativo, carrossel, índice e régua saem e fica só a lista filtrada. Fechar o painel limpa a busca e o filtro.
3. **Carrossel** (rolagem com encaixe, só anda quando a pessoa arrasta): o próximo card aparece na borda, cada card mostra "n/total" e há pontos embaixo. A foto ocupa cerca de 60% do card, à direita, e se funde ao fundo escuro onde ficam o texto, o preço e o botão. Cards:
   - **Hot dog** (foto do Dog Max): "Médio, Max ou Super", "a partir de" o menor preço disponível dos três, botão "Ver tamanhos", que rola até a categoria;
   - **CBO Turbo**, **Dog Pizza** e **Doritos Max**: composição curta do `CONFIG`, preço e botão "Pedir este", que abre a ficha.

   Um card sai se o produto estiver esgotado, oculto, sem preço ou sem foto.
4. **Índice "Cardápio completo · N itens":** grade de 4 colunas com as categorias que têm itens (ícone, nome, quantidade) e um quadro "Buscar". O toque leva à categoria.
5. **Barra de categorias (`#chips`):** escondida enquanto o índice está na tela; depois fica fixa sob o cabeçalho, com o chip da categoria atual aceso, como hoje.
6. **Categoria Hot dog:** abaixo do título, a régua Médio, Max e Super (1, 2 e 3 salsichas desenhadas em SVG, preço do catálogo). O toque abre a ficha do tamanho.
7. **Faixa do combo:** sai do topo e vai para depois da seção de hot dogs, ainda dentro do cardápio.
8. **Ordem:** hot dog primeiro em `categorias_produtos.ordem` (produção) e no `CONFIG`. O catálogo do banco manda na ordem do site inteiro, então o hot dog também passa a ser o primeiro nos stories da bio e na placa do site.
9. **Movimento:** nenhum automático. A barra de categorias entra com uma transição curta, que some com movimento reduzido. O "+" mantém o retorno atual.

## Decisões de quem desenhou (para conferir)

- Fechar a busca limpa o filtro, para não deixar filtro escondido.
- A ordem nova vale também para a bio e para a placa do site (efeito do item 8).
- Os textos dos cards são curtos e só com composição do `CONFIG`; nada de "mais vendido".
- O Doritos Max entra no carrossel com a foto antiga; trocar quando houver foto nova no tijolinho.

## Deixado para quem constrói

Marcação e nomes de classes novas, o observador de rolagem, o ajuste de `scroll-margin-top` das categorias e quais testes atualizar (busca atrás da lupa, faixa do combo fora do topo, ordem das categorias).
