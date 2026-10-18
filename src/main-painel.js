// Entrada do painel da equipe (painel/index.html). Não entra no bundle do cliente.
// O quadro só é montado depois do login e da conferência da equipe (src/painel/acesso.js).
import './fontes.js';
import './styles/base.css';
import './painel/painel.css';
import './core.js';
import './painel/painel.js';
import './painel/usuarios.js';
import { iniciarAcesso } from './painel/acesso.js';
import { qrSvg } from './lib/qr-comanda.js';

// QR da comanda de entrega (contrato C3): o painel.js é um IIFE sem import e lê isto na hora de montar a comanda.
// base = o endereço público do site (VITE_SITE_URL), sem barra no fim; sem ele, o endereço desta página.
window.MLQr = { qrSvg, base: String(import.meta.env.VITE_SITE_URL || location.origin).replace(/\/+$/, '') };

// "Simular pedido" e "Gerar exemplos" só na demonstração (VITE_DEMO=1 no .env)
iniciarAcesso({ el: document.getElementById('view-painel'), demo: import.meta.env.VITE_DEMO === '1' });
