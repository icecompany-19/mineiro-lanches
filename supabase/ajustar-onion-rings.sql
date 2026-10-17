-- Gran Bacon Onion com 2 anéis de cebola, avulso e combo (dono, 17/10/2026).
-- Atualiza só a composição atual; mantém os pedidos históricos.
update public.produtos
set ingredientes = array_replace(ingredientes, '3 onion rings', '2 onion rings')
where id in ('gran-bacon-onion', 'combo-gran-bacon-onion');
select id, ingredientes from public.produtos
where id in ('gran-bacon-onion', 'combo-gran-bacon-onion');
