-- Horário confirmado pelo dono em 17/10/2026.
-- Executar no SQL Editor do projeto Mineiro Lanche. Pode ser aplicado novamente.
-- Altera somente o horário e ativa o funcionamento automático.
begin;
update public.loja
set horarios = '{"0":["19:00","01:00"],"1":["19:00","00:00"],"2":["19:00","00:00"],"3":null,"4":["19:00","00:00"],"5":["19:00","01:00"],"6":["19:00","01:00"]}'::jsonb,
    modo = 'auto'
where id = 1;
commit;
select modo, horarios from public.loja where id = 1;
