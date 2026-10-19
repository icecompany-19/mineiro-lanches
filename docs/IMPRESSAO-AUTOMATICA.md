# Impressão automática de pedidos

A loja informou uma **P180 ligada por cabo ao computador**. O fabricante, o driver instalado e o sistema operacional não foram informados. A comanda existente continua com 72 mm de largura útil, logo oficial e QR do entregador somente nas entregas. Não presumir tamanho físico de papel ou protocolo ESC/POS pelo nome P180.

## Preparação para a cliente

1. Confira se a P180 está instalada, ligada, conectada e com papel. Use o driver do fabricante e faça um teste no próprio computador. Defina a impressora da loja como padrão. Confira o tamanho de papel no driver; o conteúdo atual usa 72 mm de largura útil.
2. No painel, abra **Configurações → Impressão automática**, ou use **Configurar impressão** no indicador acima dos pedidos.
3. Se o computador for Windows, use **Baixar atalho para Windows**. Salve `Abrir-Mineiro-Impressao.cmd` na Área de Trabalho e abra esse arquivo para operar a impressão. Ele procura Chrome ou Edge instalados e abre o painel com `--kiosk-printing`, em um perfil separado em `%LOCALAPPDATA%\MineiroLanches\Impressao`. Não instala driver, muda impressoras nem precisa de privilégio de administrador. A equipe precisa fazer login nesse perfil.
4. No painel aberto pelo atalho, toque em **Testar impressão**. O teste não cria um pedido nem muda o banco. Confira fisicamente se saiu na impressora correta. Se não saiu, corrija a impressora padrão/driver antes de ativar.
5. Estando correto, toque em **O teste saiu: ativar neste computador**. A ativação fica salva nesse navegador/perfil. Ela vale para os próximos pedidos novos. Pedidos já existentes na ativação ficam fora do envio automático.
6. Mantenha o computador ligado, conectado e a janela visível. Ative **somente uma estação/perfil de impressão**. Os demais computadores e celulares continuam acompanhando os pedidos normalmente.

No navegador comum, o painel chama a impressão, mas a janela de confirmação continua aparecendo. Impressão sem essa janela depende do modo de impressão direta e da configuração local. Em macOS/Linux, preparar Chrome/Chromium com `--kiosk-printing`, perfil dedicado e impressora padrão; o `.cmd` fornecido só executa em Windows. Políticas de dispositivos gerenciados podem exigir configuração pelo responsável do computador.

## Operação

- O indicador informa se o envio automático está ativo, se há comandas na fila ou se é preciso conferir uma impressão interrompida. A fila envia uma comanda por vez, pelos mesmos dados e formato da impressão manual.
- Novos pedidos reais entram por ID, tanto via Realtime quanto pelas consultas de recuperação da store. Origem `exemplo` e pedidos já cancelados não são enviados automaticamente. Imprimir não aceita pedidos, altera status nem declara pagamento.
- Cancelar uma comanda pendente suspende o envio. Como a store antecipa a mudança enquanto espera o servidor, uma recusa de cancelamento restaura o estado anterior da fila; não descartar definitivamente a comanda por uma atualização otimista.
- Uma recarga não repete os IDs encaminhados. Ao reabrir, pedidos novos recebidos enquanto a estação estava ativa e fechada entram na fila se ainda estiverem no estado novo. A fila existente permanece até o reconhecimento local. Ela não funciona com o painel fechado; o processamento é retomado quando o painel abre e consulta o servidor.
- **Pausar impressão automática** conserva as pendências existentes. Os pedidos recebidos e observados enquanto estiver pausada não entram na fila automática; os que estiverem presentes na reativação também ficam fora. Use a impressão manual para esses pedidos.
- Se uma impressão foi interrompida, a fila pede conferência e suspende os próximos envios. Abra **Conferir comandas**. Depois de olhar a impressora, escolha **Já saiu no papel** ou **Enviar novamente**. Não reenviar automaticamente um pedido cujo resultado é incerto.
- Para reimprimir por falta de papel ou falha física depois do encaminhamento, confira primeiro a impressora e use **Imprimir** no próprio pedido. O navegador não recebe o resultado físico da P180. `afterprint` pode ocorrer mesmo ao cancelar a janela: o status é **enviado à impressão**, nunca confirmação de que foi impresso.

## Implementação e limites

`fila-impressao.js` usa IndexedDB `mineiro-impressao-v1`: configurações e trabalhos guardam apenas ID, número, data, estado e motivo operacional. Não persistir nome, telefone, endereço, itens ou HTML da comanda nessa fila. Os dados completos vêm da store autenticada apenas na preparação do cupom. Configurações do cliente e preços permanecem inalterados.

`impressao-automatica.js` exige Web Locks e IndexedDB. Uma trava de origem/perfil, `mineiro-impressao-local-v1`, serializa testes e envios entre abas. A mudança pendente → enviando é atômica na transação da fila. Estado enviando encontrado sem dono da trava vira conferir, evitando reimpressão automática após falha/fechamento. Isso não deduplica entre computadores, navegadores ou perfis diferentes: configurar uma única estação continua necessário. Apagar os dados do navegador remove a configuração e o registro local.

A comanda automática usa `comandaHTML()` existente, sem abrir ou substituir o modal do operador. Aguarda a logo por até 2 s, calcula a página em 72 mm × altura do cupom e aplica estilos de impressão sem o tema escuro. Um modal aberto adia a fila. A saída/login expirado suspende o processamento e remove a folha transitória; uma impressão já encaminhada ao sistema operacional não pode ser retirada pelo site. Retorno ausente por 2 min fica para conferência, sem repetição silenciosa. Ausência de rede, janela oculta ou store desconectada adiam os próximos envios.

Não há integração direta com driver/USB, promessa de exatamente uma folha física nem impressão a partir do servidor. Não adicionar serviços locais, chaves ou enfraquecer a CSP. A impressão manual permanece disponível. Homologação final do papel exige o teste presencial na P180 da cliente.

## Validação

Os testes de navegador simulam o retorno de `window.print`, usando pedidos somente locais. Cobrem ativação após teste, exclusão da carga anterior, chegada de novo pedido sem avanço de status, cupom com logo/QR/72 mm, ordenação, recargas, recuperação, pausa, cancelamento, modais, falha, conferência/reenvio, duas abas e encerramento da sessão. Os testes anteriores da comanda verificam PDFs de uma página, medidas e integridade do QR/logo. Nenhum teste afirma envio físico à impressora da cliente.

Verificação em 19/10: lint e build de produção aprovados; setup aplicado duas vezes, 574 verificações SQL, 330 de paridade e 142 testes unitários. A rodada direcionada aprovou 26 cenários (14 anteriores de comanda e 12 da fila automática), incluindo cancelamento otimista recusado. A conferência final de ativação/PDF aprovou mais dois cenários após o ajuste visual da lista de preparação. O PDF automático foi lido e rasterizado a 203 dpi: uma página de 72 mm, dados do pedido, logo e QR legível em preto e branco.

A bateria ampla em celular/desktop/e2e terminou com 613 aprovações, 87 casos não aplicáveis e duas verificações visuais intermitentes do cliente, com os bundles do cliente e do motoboy mantendo os hashes anteriores. A leitura prematura da geometria da sacola foi corrigida no teste para aguardar fontes/renderização e passou em cinco repetições. O arraste da prensa passou em três repetições, sem mudança no produto. Os 14 fluxos e2e passaram. WebKit/iPhone e a impressora física da cliente não foram executados neste ambiente.
