import { consultarPlanejamento } from './supabase.js';

export const ERROS_ROTAS = {
  sem_permissao: 'Seu acesso não permite esta operação.',
  sessao: 'Entre novamente para continuar.',
  dados_invalidos: 'Confira os dados e os limites informados.',
  configuracao_rotas_pendente: 'Configure os limites das viagens antes de calcular.',
  origem_nao_confirmada: 'Confirme o ponto de saída estando na loja.',
  origem_alterada: 'O ponto de saída mudou. Desfaça e recalcule a viagem.',
  automacao_indisponivel: 'A distribuição automática ainda não está disponível no servidor.',
  versao_alterada: 'A operação mudou. Atualize e confira novamente.',
  plano_expirado: 'Esta sugestão venceu. Calcule uma nova viagem.',
  reserva_expirada: 'O prazo desta reserva terminou. Atualize a viagem e confirme sua disponibilidade na loja para receber outra.',
  pedido_alterado: 'Um pedido mudou. Atualize e recalcule a viagem.',
  pedido_em_viagem: 'Este pedido faz parte de uma viagem. Use os controles da viagem para registrar a saída ou replanejar.',
  entregador_em_viagem: 'O entregador tem uma viagem aberta. Confira a saída e o retorno.',
  entregador_indisponivel: 'O entregador deixou de estar disponível. Confira a situação e recalcule.',
  entregador_inativo: 'O cadastro do entregador está inativo.',
  entregas_pendentes: 'Ainda há pedidos abertos. Confira as entregas e sincronize antes de registrar o retorno.',
  carregamento_pendente: 'Peça ao motoboy para abrir a tela conectado e carregar a viagem antes da saída.',
  viagem_requer_revisao: 'Um pedido desta viagem mudou. Desfaça e recalcule antes de sair.',
  entrega_em_andamento: 'Esta viagem já saiu e não pode ser desfeita.',
  motivo_obrigatorio: 'Informe o motivo da correção (até 200 caracteres).',
  nao_atribuido: 'Esta viagem não está atribuída a você.',
  orcamento_rotas_esgotado: 'O limite diário de cálculos foi atingido. Use o controle manual ou confira a configuração.',
  mapas_nao_configurados: 'O serviço de mapas precisa ser configurado no servidor.',
  rota_indisponivel: 'Não foi possível calcular o trajeto. Tente novamente ou organize a saída manualmente.',
  sem_pedidos: 'Não há pedidos elegíveis. Confira os pontos de entrega e os pedidos pausados.',
  sem_entregador: 'Nenhum entregador está disponível na loja. Confira o turno e as entregas abertas.',
  calculando: 'Já existe um cálculo em andamento. Aguarde a atualização.',
  aguarde: 'Aguarde alguns segundos antes de calcular novamente.',
  sem_rota_compativel: 'Nenhuma viagem atende aos limites. Confira a seleção e os tempos ou organize a saída manualmente.',
  localizacao_indisponivel: 'Este aparelho não oferece localização. Use outro aparelho estando na loja.',
  localizacao_imprecisa: 'A localização está imprecisa. Tente novamente no celular estando na loja.',
  localizacao_negada: 'Permita a localização para confirmar o ponto de saída, estando na loja.'
};
export const mensagemRota = (e) =>
  ERROS_ROTAS[e?.codigo || e?.message] || 'Não foi possível registrar. Confira a conexão e tente novamente.';

export async function calcularRotas(body) {
  const ctl = new AbortController();
  let timer;
  try {
    return await Promise.race([
      consultarPlanejamento(body, ctl.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new Error('rede'));
        }, 85000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
