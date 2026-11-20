-- Desligar o pagamento online em produção (20/11/2026). Rodar no SQL Editor do Supabase puwylyfmwcvpfsftsrta.
-- O checkout já não oferece "Pagar online" desde 19/11 (commit ef61187); isto fecha a porta para quem ainda estiver
-- com a página antiga aberta. Não apaga nada: tabelas, histórico e pedidos antigos continuam como estão.

-- =============== PARTE 1: rodar agora ===============

-- 1) Antes: como está a loja (hoje: pagamentos_ativos = true)
select modo, pagamentos_ativos from public.loja where id = 1;

-- 2) Desliga o pagamento online para pedidos novos
update public.loja set pagamentos_ativos = false where id = 1;

-- 3) Depois: pagamentos_ativos tem que vir false
select modo, pagamentos_ativos from public.loja where id = 1;

-- 4) Pedidos online antigos que ainda pedem atenção. Se vier VAZIO, pode rodar a PARTE 2.
select numero, status, pagamento_online, criado_em at time zone 'America/Sao_Paulo' as criado_em_sp,
       case when pagamento_online = 'aprovado' then 'pago e cancelado: conferir estorno'
            when pagamento_online = 'em_disputa' then 'em disputa no Mercado Pago'
            else 'pagamento online em aberto' end as situacao
from public.pedidos
where (pagamento_online in ('pendente', 'recusado', 'revisao') and status in ('novo', 'preparo', 'pronto', 'rota'))
   or pagamento_online = 'em_disputa'
   or (pagamento_online = 'aprovado' and status = 'cancelado')
order by criado_em desc;

-- =============== PARTE 2: só quando a consulta 4 vier vazia ===============
-- Para a conciliação automática do Mercado Pago (roda a cada minuto). Depois, no painel do Supabase:
-- Edge Functions -> mercado-pago e mercado-pago-webhook (podem ser apagadas) e Edge Functions -> Secrets -> o Access Token do MP.
-- select cron.unschedule('mineiro-mp-reconciliar');

-- =============== Fora do SQL ===============
-- Fechar o cadastro aberto: Authentication -> Sign In / Providers -> desmarcar "Allow new users to sign up" -> Save.
-- (Usuários novos da equipe são criados pela tela Usuários do painel, que não depende do cadastro aberto.)
-- Modo da loja: hoje está em "Aberta" manual. Para voltar a abrir e fechar pelo horário, use "Automático" no painel.
