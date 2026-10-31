-- Retira do cardápio o produto temporário do teste de pagamento de R$ 1 (docs/MERCADO-PAGO.md, 20/10).
-- O produto fica no banco, desativado: o pedido de teste 0096 continua apontando para ele, para a conciliação.
-- A categoria sai porque o cardápio mostra um botão para cada categoria, mesmo vazia; não há chave estrangeira para ela.
update public.produtos set ativo=false where id='teste-pagamento' and ativo;
delete from public.categorias_produtos c
where c.id='testes' and not exists(select 1 from public.produtos p where p.categoria=c.id and p.ativo);
