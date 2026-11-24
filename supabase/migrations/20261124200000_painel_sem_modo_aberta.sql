-- 24/11/2026: o painel não abre mais a loja fora do horário.
-- O botão "Aberta" gravava modo = 'aberta' para sempre: a loja ficou aberta à tarde (e numa quarta, dia fechado)
-- e entrou pedido sem ninguém na loja. Agora a equipe só escolhe "Automático" (segue loja.horarios) ou "Fechada".
-- Para abrir em outro horário, muda-se loja.horarios.
-- O valor 'aberta' continua aceito na tabela (os testes forçam a loja aberta por SQL), mas nenhuma RPC grava mais.
-- Pode ser aplicada de novo.

update public.loja set modo = 'auto' where modo = 'aberta';

-- modo manual da loja: 'auto' segue o horário; 'fechada' é decisão do painel
create or replace function public.definir_loja(p_modo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_equipe() then
    raise exception 'sem_permissao' using errcode = 'P0001';
  end if;
  if p_modo is null or p_modo not in ('auto', 'fechada') then
    raise exception 'dados_invalidos' using errcode = 'P0001';
  end if;
  update public.loja set modo = p_modo where id = 1;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  return public.loja_json();
end;
$$;

-- mesmas permissões de antes: só o painel (login; dentro, is_equipe() decide)
revoke all on function public.definir_loja(text) from public, anon, authenticated;
grant execute on function public.definir_loja(text) to authenticated;
