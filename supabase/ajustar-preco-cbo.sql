-- Preço do Hot Dog CBO Turbo confirmado pelo dono em 17/10/2026.
-- Executar no SQL Editor do projeto Mineiro Lanche. Pode ser aplicado novamente.
-- HISTÓRICO: substituído pela tabela de 22/11/2026 (R$ 35,99, supabase/ajustar-precos-2026-11-22.sql). Não rodar de novo.
update public.produtos set preco = 34.90 where id = 'dog-cbo-turbo';
select id, nome, preco from public.produtos where id = 'dog-cbo-turbo';
