-- Mantém o controle em lote por categoria na nova tela de produtos, em uma só transação.
create or replace function public.marcar_categoria_esgotada(p_categoria text,p_esgotado boolean)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare quantidade integer;
begin
 if not public.is_equipe() then raise exception 'sem_permissao' using errcode='P0001'; end if;
 if p_categoria is null or p_esgotado is null or not exists(select 1 from public.categorias_produtos where id=p_categoria) then
   raise exception 'dados_invalidos' using errcode='P0001';
 end if;
 update public.produtos set esgotado_dia=case when p_esgotado then public.dia_operacional(now()) end
 where categoria=p_categoria and ativo;
 get diagnostics quantidade=row_count;
 return quantidade;
end $$;
revoke all on function public.marcar_categoria_esgotada(text,boolean) from public,anon,authenticated;
grant execute on function public.marcar_categoria_esgotada(text,boolean) to authenticated;
notify pgrst,'reload schema';
