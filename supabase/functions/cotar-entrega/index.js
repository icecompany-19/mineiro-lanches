import { criarHandler } from './handler.js';

Deno.serve(
  criarHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
    geoapifyKey: Deno.env.get('GEOAPIFY_API_KEY'),
    orsKey: Deno.env.get('OPENROUTESERVICE_API_KEY')
  })
);
