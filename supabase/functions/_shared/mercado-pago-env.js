// Identificadores públicos esperados desta integração; credenciais continuam só nos secrets.
const PRODUCAO = {
  accountId: '256378111', applicationId: '5499483276102597',
  mode: 'production', siteUrl: 'https://mineirolanches.store'
};
export function configuracaoMP(ler = (nome) => Deno.env.get(nome)) {
  const supabaseUrl = ler('SUPABASE_URL');
  const padrao = supabaseUrl?.replace(/\/$/, '') === 'https://puwylyfmwcvpfsftsrta.supabase.co' ? PRODUCAO : {};
  return {
    supabaseUrl,
    serviceKey: ler('SUPABASE_SERVICE_ROLE_KEY'),
    accessToken: ler('MERCADO_PAGO_ACCESS_TOKEN'),
    webhookSecret: ler('MERCADO_PAGO_WEBHOOK_SECRET'),
    accountId: ler('MERCADO_PAGO_ACCOUNT_ID') || padrao.accountId,
    applicationId: ler('MERCADO_PAGO_APPLICATION_ID') || padrao.applicationId,
    mode: ler('MERCADO_PAGO_MODE') || padrao.mode,
    siteUrl: ler('MERCADO_PAGO_SITE_URL') || padrao.siteUrl
  };
}
