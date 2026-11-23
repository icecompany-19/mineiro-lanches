-- Correção de 22/11/2026 sobre supabase/ajustar-precos-2026-11-22.sql: as fotos completas do cardápio de papel
-- mostraram que os 8 combos impressos não mudaram de preço. No site eles tinham subido R$ 1 (proposta);
-- voltam ao preço do papel com final ,99. Aprovado pelo usuário em 22/11/2026. Só o site: a 99 não muda.
-- Trava: só aplica se os 8 ainda estiverem com o preço da tabela de 22/11 (senão nada muda).
do $$
declare n int;
begin
  with v(id, antes, depois) as (values
    ('combo-diluvio', 50.99, 49.99),
    ('combo-gran-burger', 40.99, 39.99),
    ('combo-gran-bacon', 46.99, 45.99),
    ('combo-gran-salada', 43.99, 42.99),
    ('combo-gran-bacon-onion', 49.99, 48.99),
    ('combo-hot-dog-max', 30.99, 29.99),
    ('combo-x-frango', 40.99, 39.99),
    ('combo-gran-chicken', 39.99, 38.99)
  )
  update public.produtos p set preco = v.depois
  from v where p.id = v.id and p.preco = v.antes;
  get diagnostics n = row_count;
  if n <> 8 then
    raise exception 'esperava 8 combos com o preço de antes, achei %; nada foi alterado', n;
  end if;
end $$;

select id, nome, preco from public.produtos where categoria = 'combos' order by ordem;
