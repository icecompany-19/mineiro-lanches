-- Helpers financeiros são SECURITY INVOKER: BYPASSRLS não concede privilégios SQL.
-- O ambiente Supabase remoto pode não conceder DML a service_role por padrão.
-- Sem ampliar os privilégios de anon/authenticated nem liberar edição do status operacional.
grant select on public.pedidos,public.loja,public.equipe to service_role;
grant update(pagamento_online,pagamento_em) on public.pedidos to service_role;
notify pgrst,'reload schema';
