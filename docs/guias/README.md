# Guia visual de pagamentos

Edição de 20/11/2026: 8 páginas, refeita depois que o pagamento online saiu do checkout (19/11, commit `ef61187`). Cobre o fluxo atual: Pix, Dinheiro (com a pergunta do troco) e Outra forma, todos a receber; o WhatsApp da loja abrindo com o pedido; o acompanhamento; o painel (acesso, modo Automático/Aberta/Fechada, Pix a receber → Pix recebido, dinheiro a receber, comanda, etapas manuais e cancelamento) e uma nota sobre os pedidos online antigos. As páginas do Mercado Pago e do motoboy saíram, com as imagens delas (continuam no histórico do git).

O HTML editável é `guia-pagamentos.html`. As telas em `telas/` são do aplicativo real em ambiente local, com clientes fictícios ("Ana Demonstração" e "Bruno Demonstração"), e saem do script:

```sh
source scripts/supabase-local/ambiente-windows.sh   # Git Bash, com o Supabase local no ar e o setup.sql aplicado
node scripts/capturas/guia-pagamentos.mjs
```

O script sobe o `vite preview` na porta 4185, deixa a loja local em "Aberta" sem pagamento online, faz os dois pedidos pelo checkout como um cliente, fotografa o painel e, no fim, apaga esses pedidos e devolve a loja local como estava. O `wa.me` é interceptado: nada sai para a internet. A mensagem do WhatsApp do pedido Pix fica em `capturas/guia-pagamentos/whatsapp.txt` e foi copiada para a página 5 (com o link de acompanhamento trocado pelo endereço público). Ao refazer as capturas, confira se o número do pedido da mensagem bate com o da tela de acompanhamento.

Para gerar o PDF público depois de mudar o conteúdo:

```sh
node scripts/gerar-guia-pagamentos.mjs
```

O gerador serve as fontes, imagens e o HTML por HTTP local, espera as imagens e se recusa a gerar se algum conteúdo passar do rodapé. O destino é `public/guias/guia-pagamentos-mineiro-lanche.pdf`; mantenha esse endereço, que já foi enviado à loja.

Antes de publicar, confira todas as páginas renderizadas. Não use dados de clientes reais, credenciais ou links de acompanhamento verdadeiros nas capturas.
