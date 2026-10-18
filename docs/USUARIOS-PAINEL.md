# Usuários do painel e entregadores

Acesse `https://mineirolanches.store/painel/` e abra **Usuários**. A tela funciona no computador e no celular. Somente administradores conseguem consultar o cadastro ou gerenciar acessos.

## Cadastro e operação

1. Clique em **Novo usuário** e preencha nome, e-mail, perfil e senha inicial de 10 a 128 caracteres.
2. Selecione **Motoboy** para o entregador, **Equipe** para operar pedidos ou **Administrador** para também gerenciar usuários.
3. Salve e entregue as credenciais diretamente à pessoa. O cadastro confirma o e-mail pela API administrativa e não depende de convite/SMTP. Senhas não aparecem na lista, não são armazenadas no cadastro nem entram na auditoria.
4. O entregador entra em `https://mineirolanches.store/motoboy/`; equipe e administradores entram em `/painel/`.
5. Se a conta já existir no Auth e ainda não aparecer na lista, use **Liberar conta existente** com o mesmo e-mail e o perfil desejado. Essa operação preserva a senha existente. Se já aparecer na lista, use **Editar**.
6. **Editar** permite mudar nome, perfil e situação do acesso. O e-mail permanece o identificador do login e não é alterado por essa tela.
7. **Nova senha** define outra senha para a conta; entregue-a diretamente ao usuário. Não é enviada por e-mail.
8. **Desativar** exige confirmação e retira a autorização no servidor. **Reativar** devolve o perfil cadastrado. Não apaga pedidos nem o histórico.

O administrador não pode se desativar nem retirar a própria administração. Para transferir o controle da loja, crie outro administrador primeiro; ele poderá alterar o acesso anterior. A tela da equipe comum informa que somente administradores podem gerenciar usuários.

A confirmação de entrega continua sendo feita ao ler o QR da comanda ou tocar em **Entregue** na lista **Em rota**. Ler o QR já confirma a entrega: faça isso somente depois de entregar.

## Implementação e permissões

- Frontend isolado em `src/painel/usuarios.js`; o painel IIFE só monta os espaços desktop/celular e aciona sua abertura. A nova navegação não altera o fluxo dos pedidos.
- Edge Function `gerenciar-usuarios`, com JWT obrigatório no gateway. Cada requisição valida a sessão em `/auth/v1/user` e confere o perfil atual no banco, sem confiar em papel/autor recebido do navegador ou em `user_metadata`.
- Perfis privados em `usuarios_painel`, com RLS e sem privilégios diretos para `anon`/`authenticated`. O cadastro usa a API Admin do Auth somente no servidor; a chave administrativa nunca entra no bundle.
- `gerir_acesso_usuario` é `SECURITY INVOKER`, executável apenas por `service_role`. Uma trava serializa alterações; a autorização do administrador é conferida novamente dentro da trava. Os perfis da equipe e do motoboy não ficam ativos simultaneamente.
- `usuarios_painel_eventos` registra autor, alvo, ação, perfil, situação e data, sem senha. Também é privada. Os avisos informativos do advisor sobre RLS sem policies nessas duas tabelas correspondem à negação deliberada do acesso direto.
- Se criar o Auth funcionar e liberar o perfil falhar, o servidor tenta remover somente a conta recém-criada. Uma conta preexistente nunca é apagada por uma falha na liberação. Se houver uma resposta de rede incerta, atualize a lista antes de repetir; uma conta existente pode ser liberada pela opção própria.
- Desativação corta a autorização das funções do painel/motoboy, mesmo com um token de sessão ainda não vencido. Dados já vistos em um aparelho não podem ser retirados retroativamente.

## Primeiro administrador e implantação

A migração `20261018181746_gestao_usuarios_painel.sql` importa os acessos anteriores. Na implantação existente havia um único membro da equipe, que recebe o perfil Administrador. Não são concedidas permissões administrativas a todos quando há vários membros.

Em uma instalação nova, crie e confirme o Auth do responsável e use os comandos de primeiro administrador no rodapé do `setup.sql`, preenchendo o e-mail correto. Os demais cadastros passam a ser feitos pelo painel. Não aplique o setup completo para atualizar produção: use a migração incremental, preservando preços e configurações manuais da loja.

Publique `gerenciar-usuarios/index.js` e `gerenciar-usuarios/handler.js` com `verify_jwt: true`. Eles usam apenas `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, fornecidos pelo runtime. Publique o frontend depois da migração e da função.

## Validação

563 verificações SQL; 116 testes Node, incluindo nove casos do serviço de gestão; 15 casos de navegador de gestão de usuários em computador, Android/Chromium e iPhone/WebKit. Os testes de cadastro/liberação usam o banco local e simulam a API administrativa do Auth; não criam contas de teste em produção. Também verificam entrada do novo motoboy, separação dos perfis, alteração/desativação/reativação, nova senha, vínculo de conta existente e tentativa de retirar a própria administração adulterando o formulário.

O setup local foi aplicado duas vezes e a paridade passou com 330 verificações. A regressão de motoboy, painel no celular, configurações de entrega e cabeçalhos passou em 78 casos (quatro casos fora do projeto aplicável foram pulados). Em produção, foi conferido o administrador inicial, o bloqueio de acesso anônimo, a ausência de leitura direta das tabelas e a proteção do próprio administrador em transação somente de leitura.
