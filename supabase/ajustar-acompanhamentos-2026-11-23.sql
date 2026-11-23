-- 23/11/2026: acompanhamentos com margem (custos do Cauan: batata P 7,00; onion 7,00; turbinada 20,00; lata 4,50)
-- e o "vira combo" a +R$ 14,99 (padrão ,99). Aprovado pelo usuário em 23/11/2026. Só o site: a 99 não muda.
-- Batata frita P nova (a 99 vende como "Porção de Batata 1 Pessoa"), acompanhamento da sacola; ordem 46 = primeira das porções.
-- Trava: só aplica se os preços ainda forem os de antes (senão nada muda). Rodar uma vez.
do $$
declare n int;
begin
  with v(id, antes, depois) as (values
    ('porcao-onion', 14.99, 16.99),
    ('porcao-batata', 39.99, 44.99),
    ('refri-lata', 9.99, 10.99)
  )
  update public.produtos p set preco = v.depois
  from v where p.id = v.id and p.preco = v.antes;
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'esperava 3 acompanhamentos com o preço de antes, achei %; nada foi alterado', n;
  end if;

  insert into public.produtos (id, categoria, nome, preco, tipo, foto, ingredientes, ordem, detalhes)
  values ('porcao-batata-p', 'porcoes', 'Batata frita P', 16.99, 'porcao', null, '{}'::text[], 46,
          '{"base":"","nota":"","inclui":["Batata frita para 1 pessoa"],"sabor":false,"escolheRefri":false}'::jsonb);

  update public.loja set combo_preco = 14.99 where id = 1 and combo_preco = 14.90;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'esperava o combo a 14,90 na loja, achei % linha(s); nada foi alterado', n;
  end if;
end $$;

select id, nome, preco, ordem, ativo from public.produtos where categoria = 'porcoes' or id = 'refri-lata' order by ordem;
select combo_preco from public.loja;
