# Guia visual de pagamentos

O HTML editável é `guia-pagamentos.html`. As capturas em `telas/` mostram a interface real do aplicativo em ambiente local com dados fictícios. Os estados financeiros foram simulados com a infraestrutura de `tests/mercado-pago.spec.js`; não representam transações reais. O checkout hospedado do Mercado Pago não foi reproduzido nem capturado.

Para gerar o PDF público após alterar o conteúdo:

```sh
PW_CHROMIUM=/usr/bin/chromium node scripts/gerar-guia-pagamentos.mjs
```

O gerador serve as fontes, imagens e o HTML por HTTP local, verifica a disponibilidade das imagens e impede a geração se houver conteúdo sobre o rodapé. O destino é `public/guias/guia-pagamentos-mineiro-lanche.pdf`.

Ao renovar capturas, use somente o ambiente local de testes, uma conta fictícia e pedidos de demonstração. Não exponha dados de clientes, credenciais ou links privados de acompanhamento. Confirme as formas de pagamento da configuração vigente antes de atualizar a primeira página.

Antes de publicar, confira todas as páginas renderizadas do PDF e mantenha o mesmo endereço público para preservar os links enviados ao cliente.
