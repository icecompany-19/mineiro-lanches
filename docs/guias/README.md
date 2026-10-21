# Guia visual de pagamentos

Edição de 21/10/2026: 16 páginas. Inclui e-mail opcional no site/acompanhamento, dinheiro com resposta obrigatória sobre troco, confirmação financeira pela equipe, comanda e indicação de cobrança no cache do motoboy. As imagens `03-dados`, `04-pagar`, `05-pendente`, `06-aprovado`, `09-card-pendente` e `11-card-pago` foram renovadas; `19-*` a `25-*` mostram o fluxo atual em ambiente local com Ana de demonstração. A retirada do exemplo custa R$ 16,90; a entrega fictícia, R$ 23,90 com taxa local de R$ 7,00. Esses valores ilustram as telas e não definem a taxa da loja. Nenhum pedido ou pagamento de cliente real foi usado nas capturas.

O HTML editável é `guia-pagamentos.html`. As capturas em `telas/` mostram a interface real do aplicativo em ambiente local com dados fictícios. Os estados financeiros foram simulados com a infraestrutura de `tests/mercado-pago.spec.js`; não representam transações reais. As quatro imagens `15-mp-*` a `18-mp-*` são recortes de quadros da demonstração oficial do Mercado Pago; não são capturas de transações da loja. O checkout hospedado recusou o acesso deste navegador (HTTP 403), e nenhum pagamento real foi iniciado para obter as imagens. Não foi criada uma imitação da interface do provedor.

Fonte das imagens oficiais: [visão geral do Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/overview), [GIF original](https://http2.mlstatic.com/storage/dx-devsite/docs-assets/custom-upload/2025/3/25/1745588214106-chopropt990px.gif), consulta em 20/10/2026. Quadros (base zero): 116, 144, 396 e 468. Extraídos na largura original de 990 px, com recorte somente de espaço inferior; interfaces e valores preservados. O exemplo oficial mostra R$ 29,49 e uma caneca, e isso está identificado nas páginas correspondentes. A captura genérica de meios de pagamento mostra opções que não estão habilitadas na loja; a nota do guia distingue essa lista da configuração do Mineiro.

Para gerar o PDF público após alterar o conteúdo:

```sh
PW_CHROMIUM=/usr/bin/chromium node scripts/gerar-guia-pagamentos.mjs
```

O gerador serve as fontes, imagens e o HTML por HTTP local, verifica a disponibilidade das imagens e impede a geração se houver conteúdo sobre o rodapé. O destino é `public/guias/guia-pagamentos-mineiro-lanche.pdf`.

Ao renovar capturas, use somente o ambiente local de testes, uma conta fictícia e pedidos de demonstração. Não exponha dados de clientes, credenciais ou links privados de acompanhamento. Confirme as formas de pagamento da configuração vigente antes de atualizar a primeira página.

Antes de publicar, confira todas as páginas renderizadas do PDF e mantenha o mesmo endereço público para preservar os links enviados ao cliente.
