export function configuracaoMP() {
  return {
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    accessToken: Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN'),
    webhookSecret: Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET'),
    accountId: Deno.env.get('MERCADO_PAGO_ACCOUNT_ID'),
    applicationId: Deno.env.get('MERCADO_PAGO_APPLICATION_ID'),
    mode: Deno.env.get('MERCADO_PAGO_MODE'),
    siteUrl: Deno.env.get('MERCADO_PAGO_SITE_URL')
  };
}
