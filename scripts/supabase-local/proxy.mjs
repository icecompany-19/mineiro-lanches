// Proxy local que imita o gateway do Supabase para o supabase-js:
//   /rest/v1/*  -> PostgREST (porta 3000), convertendo a chave publishable em papel anon
//   /auth/v1/*  -> login fake: qualquer senha para usuários de auth.users; devolve JWT assinado
//   /realtime/* -> 404 (o app precisa cair no plano B de consulta periódica)
// Uso: node proxy.mjs  (porta 54321)
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SEGREDO = process.env.JWT_SECRET || 'segredo-local-de-teste-com-mais-de-32-caracteres';
const PG = process.env.PG_URL || 'postgresql://postgres@localhost:54322/postgres';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export function assinar(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
  const s = crypto.createHmac('sha256', SEGREDO).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}
function validar(tok) {
  const [h, p, s] = String(tok || '').split('.');
  if (!s) return null;
  const ok = crypto.createHmac('sha256', SEGREDO).update(h + '.' + p).digest('base64url') === s;
  return ok ? JSON.parse(Buffer.from(p, 'base64url')) : null;
}
function usuarioPorEmail(email) {
  try {
    // variável do psql só é interpolada lendo do stdin (com -c não funciona)
    const out = execFileSync('psql', [PG, '-At', '-v', 'e=' + email, '-f', '-'], { encoding: 'utf8', input: "select id from auth.users where email = :'e';" });
    return out.trim() || null;
  } catch (e) { return null; }
}
function sessao(id, email) {
  const agora = Math.floor(Date.now() / 1000);
  const access = assinar({ sub: id, role: 'authenticated', email, aud: 'authenticated', exp: agora + 3600, iat: agora });
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: agora + 3600, refresh_token: 'r-' + id,
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD', 'access-control-expose-headers': 'content-range' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/auth/v1/')) {
      const rota = url.pathname.slice('/auth/v1'.length);
      if (rota === '/token') {
        const b = corpo ? JSON.parse(corpo) : {};
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const id = String(b.refresh_token || '').slice(2);
          return id ? json(res, 200, sessao(id, 'equipe@teste.local')) : json(res, 400, { error: 'invalid_grant' });
        }
        const id = b.email && usuarioPorEmail(b.email);
        return id ? json(res, 200, sessao(id, b.email)) : json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      }
      if (rota === '/user') {
        const c = validar((req.headers.authorization || '').replace(/^Bearer /, ''));
        return c && c.sub ? json(res, 200, sessao(c.sub, c.email).user) : json(res, 401, { msg: 'invalid JWT' });
      }
      if (rota === '/logout') { res.writeHead(204, cors); return res.end(); }
      return json(res, 404, { msg: 'rota de auth não simulada: ' + rota });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const headers = { ...req.headers };
      delete headers.host; delete headers.apikey;
      const tok = (headers.authorization || '').replace(/^Bearer /, '');
      if (!validar(tok)) delete headers.authorization; // chave publishable (não JWT) => papel anon
      const alvo = http.request({ host: 'localhost', port: 3000, path: url.pathname.slice('/rest/v1'.length) + url.search, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res);
      });
      alvo.on('error', (e) => json(res, 502, { msg: 'PostgREST fora do ar: ' + e.message }));
      alvo.end(corpo);
      return;
    }
    json(res, 404, { msg: 'não simulado: ' + url.pathname });
  });
}).listen(54321, () => console.log('proxy Supabase local em http://localhost:54321'));
