// Entrada da tela do entregador (motoboy/index.html). Não entra no bundle do cliente nem no do painel.
// Reaproveita o login de src/painel/acesso.js, mas confere a tabela motoboys (não a equipe) e guarda a sessão em
// outra chave: quem é só entregador não entra no painel, e o Sair de um não apaga o login do outro.
// Não carrega painel.js nem a store do Supabase (48 h de pedidos e Realtime): a tela fala com o banco só por
// confirmar_entrega e entregas_em_rota (src/motoboy/entrega.js).
import './fontes.js';
import './styles/base.css';
import './painel/painel.css'; // login e botões
import './motoboy/motoboy.css';
import './core.js';
import { iniciarAcesso } from './painel/acesso.js';
import { prepararMotoboy, montarMotoboy, esconderMotoboy } from './motoboy/motoboy.js';

// guarda o uuid do link (#<id>) já na abertura: o login vem antes e a confirmação só depois dele
prepararMotoboy();

const ML = window.ML;
iniciarAcesso({
  el: document.getElementById('view-motoboy'),
  titulo: 'Entregas',
  sub: ML.CONFIG.nome + ' · acesso do entregador',
  tabela: 'motoboys',
  chave: 'mineiro:v2:moto',
  textoSemAcesso: 'Este usuário não está na lista de entregadores.',
  aoAbrir: (usuario, ctx) => montarMotoboy(document.getElementById('view-motoboy'), usuario, ctx),
  aoEsconder: esconderMotoboy
});
