# Produtos no painel

Em `/painel/`, abra **Produtos**. A tela funciona no computador e no celular e exige acesso da equipe da loja. Motoboys e visitantes não podem salvar produtos nem enviar fotos.

1. Toque em **Novo produto**, informe nome, categoria e preço e selecione o tipo. Lanche permite personalização e virar combo; Combo pronto, Porção e Bebida mantêm suas regras próprias.
2. Preencha descrição e ingredientes, um por linha. Itens inclusos descrevem combos e porções. Os campos para sabor e refrigerante são opcionais.
3. Escolha uma foto JPG, PNG ou WebP e toque em **Salvar produto**. O navegador ajusta a imagem para até 1600 px e envia um WebP de até 2 MB ao Supabase Storage. O arquivo de origem pode ter até 20 MB.
4. Para alterar, busque o produto, toque em **Editar**, faça as mudanças e salve. É possível trocar a categoria, preço, composição, ordem e foto, inclusive remover a foto.
5. **Esgotar hoje** suspende a venda até a virada do dia operacional, às 4h de São Paulo. **Liberar hoje** desfaz a pausa. Ao selecionar uma categoria, também ficam disponíveis **Esgotar categoria inteira** e **Liberar categoria inteira**, aplicados em uma única transação. Para ocultar sem prazo, desmarque **Disponível no cardápio** na edição; reative na mesma tela, filtrando os produtos ocultos.

Preço vazio mantém “Preço a confirmar” e consulta pelo WhatsApp, sem compra pelo site. As mudanças confirmadas ficam no banco e chegam ao cardápio pelo Realtime ou consulta periódica, além de atualizar ao abrir novamente a página. Não exigem deploy. Pedidos existentes mantêm nome, preço e composição registrados na compra; o servidor calcula novas compras com os preços atuais, sem confiar no valor enviado pelo navegador.

## Implementação

Migration `20261020203000_gestao_produtos.sql`: categorias persistentes, detalhes de composição, versão de edição, RPC `salvar_produto`, trilha `produtos_eventos` e bucket público `produtos-fotos`. Apenas a equipe grava via RPC/Storage; tabelas continuam protegidas contra escrita direta do navegador. Fotos são imutáveis, com nomes aleatórios. A exclusão no Storage exige equipe e ausência de referência em produtos.

`estado_cardapio` mantém o contrato anterior e acrescenta `catalogo`. O cliente reconcilia produtos por ID, preservando referências da sacola; itens novos guardados no aparelho aguardam a primeira consulta antes de serem restaurados. Itens ocultos continuam reconhecidos para avisar sobre indisponibilidade. O catálogo não substitui o botão sob um gesto em andamento, e não remonta uma lista cujo HTML não mudou.

Salvamento exige a versão lida na edição e recusa conflitos, preservando os campos digitados. O seed só atualiza itens que nunca foram gerenciados pelo painel; não oculta nem reativa cadastros gerenciados. A migration de produção é aplicada isoladamente, sem executar o setup/seed completo sobre a loja.

## Verificação

Os testes `tests/produtos.spec.js` cobrem cadastro e edição pela equipe, categoria, compra com preço do servidor, persistência na sacola após recarregar, esgotamento, ocultação, conversão e exibição da foto, conflito entre aparelhos, proteção contra seed, bloqueio de visitantes/motoboys e atualização de preço durante o toque. O Storage HTTP é simulado nos testes locais, pois esse ambiente executa somente Postgres/PostgREST.

Também foi realizado um teste real em produção com conta temporária da equipe e produto sempre oculto: login, upload WebP, cadastro, edição de preço, catálogo persistido, leitura pública da imagem com tamanho conferido e recusa de escrita anônima. Os dados e o acesso temporários são removidos após a conferência do painel publicado.

Validação em 20/10/2026: lint e build aprovados; 35 cenários de cardápio, preços, ficha e gestão de produtos aprovados em Android, desktop e WebKit iPhone, mais 5 verificações de estoque por categoria e atribuição/saída. A suíte confirma também a abertura dos ingredientes no campo visível após escolher “Tirar algum item”.

A CSP da Vercel permite imagens somente da origem do site, fontes já existentes e dos caminhos públicos do bucket de produtos em produção/homologação. A conferência no navegador publicado identifica também bloqueios de imagem que o Vite local não aplica. Os 15 testes de cabeçalhos, redirecionamentos e CSP em `tests/vercel.spec.js` passaram com essa política.
