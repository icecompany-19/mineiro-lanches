import { criarPagamentos } from './handler.js';
import { configuracaoMP } from '../_shared/mercado-pago-env.js';
Deno.serve(criarPagamentos(configuracaoMP()));
