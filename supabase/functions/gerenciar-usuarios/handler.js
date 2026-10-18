const ORIGENS = new Set([
  'https://mineirolanches.store',
  'https://www.mineirolanches.store',
  'https://mineiro-lanches.vercel.app',
  'http://localhost:4180',
  'http://localhost:5173'
]);
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const falha = (codigo, status = 422) => Object.assign(new Error(codigo), { codigo, status });
const codigos = new Set(['sem_permissao', 'proprio_acesso_protegido', 'email_nao_alteravel', 'dados_invalidos']);
export function criarGestor({ supabaseUrl, serviceKey, fetcher = fetch }) {
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  async function chamada(path, { body, method, token } = {}) {
    const r = await fetcher(supabaseUrl + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...headers, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      if (path === '/auth/v1/user') throw falha('sessao', 401);
      if (j?.error_code === 'email_exists' || j?.code === 'email_exists' || j?.code === 'email_exists_error')
        throw falha('email_em_uso', 409);
      if (codigos.has(j?.message)) throw falha(j.message, j.message === 'sem_permissao' ? 403 : 422);
      throw falha('servidor_indisponivel', 503);
    }
    return j;
  }
  const banco = (path, body) => chamada('/rest/v1/' + path, { body });
  async function administrador(id) {
    const [a] = await banco('usuarios_painel?user_id=eq.' + id + '&select=user_id,perfil,ativo&limit=1');
    if (!a?.ativo || a.perfil !== 'admin') return false;
    return (await banco('equipe?user_id=eq.' + id + '&select=user_id&limit=1')).length === 1;
  }
  return async (req) => {
    const origem = req.headers.get('Origin');
    const cors = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods': 'POST,OPTIONS'
    };
    const responder = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: cors });
    if (origem && !ORIGENS.has(origem)) return responder({ codigo: 'sem_permissao' }, 403);
    if (origem) cors['Access-Control-Allow-Origin'] = origem;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return responder({ codigo: 'metodo_invalido' }, 405);
    let criado;
    try {
      const token = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) throw falha('sessao', 401);
      const usuario = await chamada('/auth/v1/user', { token });
      if (!uuid(usuario?.id)) throw falha('sessao', 401);
      const raw = await req.text();
      if (raw.length > 4096) throw falha('dados_invalidos');
      let p;
      try {
        p = JSON.parse(raw);
      } catch {
        throw falha('dados_invalidos');
      }
      const admin = await administrador(usuario.id);
      if (p?.acao === 'sessao') return responder({ administrador: admin, id: usuario.id });
      if (!admin) throw falha('sem_permissao', 403);
      if (p?.acao === 'listar')
        return responder({ usuarios: await banco('usuarios_painel?select=user_id,nome,email,perfil,ativo&order=nome.asc') });
      if (!['criar', 'vincular', 'editar', 'senha'].includes(p?.acao)) throw falha('dados_invalidos');
      if (p.acao === 'criar' || p.acao === 'senha') {
        if (typeof p.senha !== 'string' || p.senha.length < 10 || p.senha.length > 128 || !p.senha.trim()) throw falha('senha_invalida');
      }
      if (!['criar', 'vincular'].includes(p.acao) && !uuid(p.id)) throw falha('dados_invalidos');
      if (p.acao === 'senha') {
        const [alvo] = await banco('usuarios_painel?user_id=eq.' + p.id + '&select=user_id&limit=1');
        if (!alvo) throw falha('nao_encontrado', 404);
        await chamada('/auth/v1/admin/users/' + p.id, { method: 'PUT', body: { password: p.senha } });
        await banco('usuarios_painel_eventos', { autor: usuario.id, alvo: p.id, acao: 'senha' });
        return responder({ ok: true });
      }
      if (
        typeof p.nome !== 'string' ||
        p.nome.trim().length < 2 ||
        p.nome.length > 80 ||
        !['admin', 'equipe', 'motoboy'].includes(p.perfil) ||
        typeof p.ativo !== 'boolean'
      )
        throw falha('dados_invalidos');
      let email,
        id = p.id;
      if (p.acao === 'criar' || p.acao === 'vincular') {
        if (typeof p.email !== 'string' || p.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()))
          throw falha('dados_invalidos');
        email = p.email.trim().toLowerCase();
        if (p.acao === 'criar') {
          const novo = await chamada('/auth/v1/admin/users', { body: { email, password: p.senha, email_confirm: true } });
          id = novo?.id || novo?.user?.id;
          if (!uuid(id)) throw falha('servidor_indisponivel', 503);
          criado = id;
        } else {
          // Liberação explícita de conta existente: não altera sua senha nem
          // exclui a conta se a atualização de acesso falhar.
          let conta;
          for (let pagina = 1; pagina <= 10; pagina++) {
            const lote = await chamada('/auth/v1/admin/users?per_page=100&page=' + pagina);
            conta = lote?.users?.find((u) => u.email?.toLowerCase() === email);
            if (conta || !lote?.users || lote.users.length < 100) break;
          }
          if (!conta || !uuid(conta.id)) throw falha('conta_nao_encontrada', 404);
          id = conta.id;
          const atual = await banco('usuarios_painel?user_id=eq.' + id + '&select=user_id&limit=1');
          if (atual.length) throw falha('email_em_uso', 409);
          if (!conta.email_confirmed_at) await chamada('/auth/v1/admin/users/' + id, { method: 'PUT', body: { email_confirm: true } });
        }
      } else {
        const [alvo] = await banco('usuarios_painel?user_id=eq.' + id + '&select=email&limit=1');
        if (!alvo) throw falha('nao_encontrado', 404);
        email = alvo.email;
      }
      const u = await banco('rpc/gerir_acesso_usuario', {
        p_autor: usuario.id,
        p_id: id,
        p_nome: p.nome,
        p_email: email,
        p_perfil: p.perfil,
        p_ativo: p.ativo
      });
      criado = null;
      return responder({ usuario: u });
    } catch (e) {
      if (criado) {
        try {
          await chamada('/auth/v1/admin/users/' + criado, { method: 'DELETE' });
        } catch {
          console.error('gestao_usuarios: limpeza de cadastro incompleto pendente');
        }
      }
      return responder({ codigo: e.codigo || 'servidor_indisponivel' }, e.status || 503);
    }
  };
}
