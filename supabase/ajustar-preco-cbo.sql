-- Preço do Hot Dog CBO Turbo confirmado pelo dono em 17/10/2026.
-- Executar no SQL Editor do projeto Mineiro Lanche. Pode ser aplicado novamente.
update public.produtos set preco = 34.90 where id = 'dog-cbo-turbo';
select id, nome, preco from public.produtos where id = 'dog-cbo-turbo';
