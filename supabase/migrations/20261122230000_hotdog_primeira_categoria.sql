-- 22/11/2026: hot dog como primeira categoria (docs/superpowers/specs/2026-11-22-hotdogs-topo-cardapio-design.md).
-- O catálogo do banco manda na ordem do site inteiro: cardápio, stories da bio e placa do site.
-- Em produção, aplicar só esta migration, junto com a publicação do front novo. Idempotente.
update public.categorias_produtos
   set ordem = case id when 'hotdog' then 1 when 'artesanais' then 2 when 'tradicionais' then 3 end
 where id in ('hotdog', 'artesanais', 'tradicionais');
