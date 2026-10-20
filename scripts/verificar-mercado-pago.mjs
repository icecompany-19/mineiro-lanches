// Somente leitura: nunca cria cobranças, reembolsos ou altera a flag da loja.
const nomes = [
  'MERCADO_PAGO_ACCESS_TOKEN',
  'MERCADO_PAGO_WEBHOOK_SECRET',
  'MERCADO_PAGO_ACCOUNT_ID',
  'MERCADO_PAGO_APPLICATION_ID',
  'MERCADO_PAGO_MODE',
  'MERCADO_PAGO_SITE_URL'
];
const semWebhook = process.argv.includes('--sem-webhook');
const faltam = nomes.filter((n) => !(semWebhook && n === 'MERCADO_PAGO_WEBHOOK_SECRET') && !process.env[n]);
if (faltam.length) {
  console.error('Configuração pendente: ' + faltam.join(', '));
  process.exit(1);
}
if (!['test', 'production'].includes(process.env.MERCADO_PAGO_MODE)) throw Error('MERCADO_PAGO_MODE deve ser test ou production');
for (const n of ['MERCADO_PAGO_ACCOUNT_ID', 'MERCADO_PAGO_APPLICATION_ID'])
  if (!/^\d+$/.test(process.env[n])) throw Error(n + ' deve ser numérico');
const site = new URL(process.env.MERCADO_PAGO_SITE_URL);
if (site.protocol !== 'https:' || site.pathname !== '/' || site.search || site.hash || site.username || site.password)
  throw Error('Use uma origem HTTPS como MERCADO_PAGO_SITE_URL');
if (process.argv.includes('--conexao')) {
  const r = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: 'Bearer ' + process.env.MERCADO_PAGO_ACCESS_TOKEN },
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw Error('Mercado Pago recusou a conexão: HTTP ' + r.status);
  const conta = await r.json();
  if (String(conta.id) !== process.env.MERCADO_PAGO_ACCOUNT_ID || conta.site_id !== 'MLB')
    throw Error('A credencial não pertence à conta brasileira configurada');
  console.log('Conexão de leitura confirmada com a conta configurada.');
}
console.log('Configuração validada. Ambiente: ' + process.env.MERCADO_PAGO_MODE + '. Credenciais não foram exibidas.');
if (semWebhook) console.log('Webhook não validado: a atualização com o navegador fechado depende da reconciliação agendada funcionando.');
console.log('O recebimento de webhook, a aplicação e uma compra sandbox ainda precisam ser homologados antes de ativar.');
