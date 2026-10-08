// Entrada do painel da equipe (painel/index.html). Não entra no bundle do cliente.
// O quadro só é montado depois do login e da conferência da equipe (src/painel/acesso.js).
import './fontes.js';
import './styles/base.css';
import './painel/painel.css';
import './core.js';
import './painel/painel.js';
import { iniciarAcesso } from './painel/acesso.js';

// "Simular pedido" e "Gerar exemplos" só na demonstração (VITE_DEMO=1 no .env)
iniciarAcesso({ el: document.getElementById('view-painel'), demo: import.meta.env.VITE_DEMO === '1' });
