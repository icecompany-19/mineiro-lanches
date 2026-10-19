// Entrada da página do cliente (index.html): bio, cardápio, site e acompanhamento.
// Ordem: core.js define window.ML; a store do Supabase entra no lugar do ML.store; só então o app monta a tela.
import './fontes.js';
import './styles/base.css';
import './styles/app.css';
import './core.js';
import { instalarStoreSupabase } from './lib/store-supabase.js';
import { iniciarApp } from './app.js';

window.ML.links.base = import.meta.env.MODE === 'development' ? location.origin : (import.meta.env.VITE_SITE_URL || location.origin);
const store = instalarStoreSupabase({ papel: 'cliente' });
iniciarApp();

// O Supabase (pacote e primeira consulta) fica fora do caminho crítico: começa depois da primeira pintura.
// Até lá o cardápio mostra o CONFIG; estado_cardapio() chega logo depois e marca esgotados, preços e loja.
let comecou = false;
function ligar() {
  if (comecou) return;
  comecou = true;
  store.iniciar();
}
requestAnimationFrame(() => setTimeout(ligar, 0));
setTimeout(ligar, 1500); // aba aberta em segundo plano não pinta (sem requestAnimationFrame)
