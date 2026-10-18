import { criarGestor } from './handler.js';
Deno.serve(criarGestor({ supabaseUrl: Deno.env.get('SUPABASE_URL'), serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') }));
