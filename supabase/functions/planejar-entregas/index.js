import { criarPlanejador } from './handler.js';

Deno.serve(criarPlanejador({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  geoapifyKey: Deno.env.get('GEOAPIFY_API_KEY')
}));
