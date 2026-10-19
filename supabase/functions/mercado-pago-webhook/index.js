import { criarPagamentos } from '../mercado-pago/handler.js';
import { configuracaoMP } from '../_shared/mercado-pago-env.js';
Deno.serve(criarPagamentos(configuracaoMP(), { webhook: true }));
