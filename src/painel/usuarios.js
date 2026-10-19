import { obterSupabase } from '../lib/supabase.js';
import './usuarios.css';
const ROTULOS = { admin: 'Administrador', equipe: 'Equipe', motoboy: 'Motoboy' };
const MENSAGENS = {
  sem_permissao: 'Somente administradores podem gerenciar usuários.',
  sessao: 'Sua sessão expirou. Saia e entre novamente.',
  email_em_uso: 'Este e-mail já está cadastrado. Use Editar na lista ou Liberar conta existente se ele ainda não aparece.',
  conta_nao_encontrada: 'Não existe uma conta com este e-mail. Use Novo usuário para cadastrá-la.',
  dados_invalidos: 'Confira os dados preenchidos.',
  senha_invalida: 'Use uma senha com 10 a 128 caracteres.',
  proprio_acesso_protegido: 'Você não pode desativar nem retirar a administração do próprio acesso.',
  nao_encontrado: 'Este usuário não foi encontrado. Atualize a lista.',
  servidor_indisponivel: 'Não foi possível concluir agora. Confira a conexão e tente novamente.'
};
export async function consultarUsuarios(body) {
  const sb = await obterSupabase({ sessao: true });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw Object.assign(new Error('sessao'), { codigo: 'sessao' });
    const ctl = new AbortController(),
      timer = setTimeout(() => ctl.abort(), 30000);
    let r, j;
    try {
      r = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/gerenciar-usuarios', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      j = await r.json();
    } finally {
      clearTimeout(timer);
    }
    if (r.status === 401 && tentativa === 0) {
      const { error } = await sb.auth.refreshSession();
      if (!error) continue;
    }
    if (!r.ok) throw Object.assign(new Error(j.codigo || 'servidor_indisponivel'), { codigo: j.codigo || 'servidor_indisponivel' });
    return j;
  }
}
export function montarUsuarios(root, { consultar = consultarUsuarios } = {}) {
  const slots = Array.from(root.querySelectorAll('[data-usuarios]'));
  const esc = window.ML.fmt.esc;
  let lista = [],
    autor = '',
    admin = false,
    carregou = false,
    ocupado = false,
    erro = '',
    aviso = '',
    formulario = null,
    confirmacao = null;
  function render() {
    for (const el of slots) {
      el.innerHTML = `<div class="pn-usuarios"><div class="pn-usuarios-topo"><div><h2>Usuários</h2><p>Gerencie os acessos da equipe e dos entregadores.</p></div>${admin ? '<button type="button" class="pn-btn pn-btn--prim" data-u="novo">Novo usuário</button><button type="button" class="pn-btn" data-u="vincular">Liberar conta existente</button>' : ''}</div>
    <p class="pn-erro" role="alert" ${erro ? '' : 'hidden'}>${esc(erro)}</p><p role="status" aria-live="polite">${esc(aviso)}</p>
    ${!carregou ? '<p role="status">Conferindo o acesso…</p>' : ''}
    ${
      admin
        ? `<p class="pn-cfg-dica">Administrador gerencia usuários e o painel. Equipe opera o painel. Motoboy acessa somente a tela de entregas.</p><button type="button" class="pn-btn" data-u="atualizar" ${ocupado ? 'disabled' : ''}>Atualizar lista</button>
     ${formulario ? formHTML() : ''}
     <div class="pn-usuarios-lista">${
       lista
         .map(
           (
             u
           ) => `<article class="pn-usuario"><div><h3>${esc(u.nome)}${u.user_id === autor ? ' <small>(você)</small>' : ''}</h3><p>${esc(u.email)}</p><p><strong>${ROTULOS[u.perfil]}</strong> · ${u.ativo ? 'Ativo' : 'Desativado'}</p></div>
       <div class="pn-usuario-acoes"><button type="button" class="pn-btn" data-u="editar" data-id="${u.user_id}" ${ocupado ? 'disabled' : ''}>Editar ${esc(u.nome)}</button><button type="button" class="pn-btn" data-u="senha" data-id="${u.user_id}" ${ocupado ? 'disabled' : ''}>Nova senha de ${esc(u.nome)}</button>${u.user_id !== autor ? `<button type="button" class="pn-btn" data-u="alternar" data-id="${u.user_id}" ${ocupado ? 'disabled' : ''}>${u.ativo ? 'Desativar' : 'Reativar'} ${esc(u.nome)}</button>` : ''}</div>
       ${confirmacao === u.user_id ? `<div class="pn-usuarios-confirmacao" role="group" aria-label="Confirmar alteração de acesso"><p>${u.ativo ? 'Desativar' : 'Reativar'} o acesso de ${esc(u.nome)}?</p><button type="button" class="pn-btn pn-btn--prim" data-u="confirmar" data-id="${u.user_id}">Confirmar</button> <button type="button" class="pn-btn" data-u="cancelar">Voltar</button></div>` : ''}</article>`
         )
         .join('') || '<p>Nenhum usuário cadastrado.</p>'
     }</div>`
        : ''
    }
    ${carregou && !admin && !erro ? '<p>Somente administradores podem gerenciar usuários.</p>' : ''}
    ${erro && !admin ? '<button type="button" class="pn-btn" data-u="atualizar">Tentar novamente</button>' : ''}</div>`;
      el.querySelectorAll('[data-u="novo"],[data-u="confirmar"],[data-u="cancelar"]').forEach((b) => (b.disabled = ocupado));
    }
  }
  function formHTML() {
    const f = formulario,
      vincular = f.tipo === 'vincular',
      novo = f.tipo === 'novo' || vincular,
      senha = f.tipo === 'senha',
      eu = f.user_id === autor;
    return `<form class="pn-usuarios-form" data-usuario-form novalidate aria-label="${vincular ? 'Liberar conta existente' : novo ? 'Cadastrar usuário' : senha ? 'Definir nova senha' : 'Editar usuário'}"><h3>${vincular ? 'Liberar conta existente' : novo ? 'Cadastrar usuário' : senha ? 'Definir nova senha' : 'Editar usuário'}</h3>
   ${
     senha
       ? `<p>${esc(f.nome)} · ${esc(f.email)}</p>`
       : `<label class="pn-campo"><span class="pn-campo-r">Nome</span><input class="pn-input" name="nome" required maxlength="80" value="${esc(f.nome || '')}" autocomplete="name"></label>
    <label class="pn-campo"><span class="pn-campo-r">E-mail</span><input class="pn-input" name="email" type="email" required maxlength="254" value="${esc(f.email || '')}" ${novo ? '' : 'readonly'} autocomplete="off"></label>
    <label class="pn-campo"><span class="pn-campo-r">Perfil</span><select class="pn-input" name="perfil" ${eu ? 'disabled' : ''}>${Object.entries(
      ROTULOS
    )
      .map(([v, t]) => `<option value="${v}" ${f.perfil === v ? 'selected' : ''}>${t}</option>`)
      .join('')}</select></label>
    ${!novo ? `<label class="pn-campo"><span class="pn-campo-r">Acesso</span><select class="pn-input" name="ativo" ${eu ? 'disabled' : ''}><option value="true" ${f.ativo ? 'selected' : ''}>Ativo</option><option value="false" ${!f.ativo ? 'selected' : ''}>Desativado</option></select></label>` : ''}`
   }
   ${(novo && !vincular) || senha ? '<label class="pn-campo"><span class="pn-campo-r">' + (novo ? 'Senha inicial' : 'Nova senha') + '</span><input class="pn-input" name="senha" type="password" required minlength="10" maxlength="128" autocomplete="new-password"><small>De 10 a 128 caracteres. Entregue a senha diretamente ao usuário.</small></label>' : ''}
   <p class="pn-erro" data-u-erro role="alert" hidden></p><div class="pn-usuario-acoes"><button type="submit" class="pn-btn pn-btn--prim" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Salvando…' : 'Salvar usuário'}</button><button type="button" class="pn-btn" data-u="cancelar" ${ocupado ? 'disabled' : ''}>Cancelar</button></div></form>`;
  }
  async function carregar() {
    if (ocupado) return;
    ocupado = true;
    erro = '';
    render();
    try {
      const sessao = await consultar({ acao: 'sessao' });
      autor = sessao.id;
      admin = sessao.administrador;
      lista = admin ? (await consultar({ acao: 'listar' })).usuarios : [];
    } catch (e) {
      if (e.codigo === 'sem_permissao' || e.codigo === 'sessao') {
        admin = false;
        lista = [];
      }
      erro = MENSAGENS[e.codigo] || MENSAGENS.servidor_indisponivel;
    } finally {
      carregou = true;
      ocupado = false;
      render();
    }
  }
  async function salvar(p, el) {
    if (ocupado) return;
    ocupado = true;
    erro = '';
    aviso = '';
    for (const slot of slots) slot.querySelectorAll('button').forEach((b) => (b.disabled = true));
    el.setAttribute('aria-busy', 'true');
    try {
      const r = await consultar(p);
      aviso =
        p.acao === 'senha'
          ? 'Senha atualizada. Informe a nova senha diretamente ao usuário.'
          : ['criar', 'vincular'].includes(p.acao)
            ? `Usuário cadastrado. Acesso: ${p.perfil === 'motoboy' ? 'mineirolanches.store/motoboy/' : 'mineirolanches.store/painel/'}`
            : 'Acesso atualizado.';
      if (r.usuario) {
        lista = lista
          .filter((u) => u.user_id !== r.usuario.user_id)
          .concat(r.usuario)
          .sort((a, b) => a.nome.localeCompare(b.nome));
      }
      formulario = null;
      confirmacao = null;
      // O finally libera a operação antes de mostrar os botões da lista novamente.
    } catch (e) {
      const msg = MENSAGENS[e.codigo] || MENSAGENS.servidor_indisponivel;
      const avisoEl = el.querySelector('[data-u-erro]');
      if (avisoEl) {
        avisoEl.textContent = msg;
        avisoEl.hidden = false;
      } else {
        erro = msg;
        render();
      }
    } finally {
      ocupado = false;
      el.removeAttribute('aria-busy');
      for (const slot of slots) slot.querySelectorAll('button').forEach((b) => (b.disabled = false));
      if (!formulario) render();
    }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]');
    if (!b || !b.closest('[data-usuarios]') || ocupado) return;
    const u = lista.find((x) => x.user_id === b.dataset.id);
    switch (b.dataset.u) {
      case 'atualizar':
        carregar();
        return;
      case 'vincular':
      case 'novo':
        formulario = { tipo: b.dataset.u, perfil: 'motoboy' };
        confirmacao = null;
        break;
      case 'editar':
      case 'senha':
        formulario = { ...u, tipo: b.dataset.u };
        confirmacao = null;
        break;
      case 'cancelar':
        formulario = null;
        confirmacao = null;
        break;
      case 'alternar':
        confirmacao = u.user_id;
        formulario = null;
        break;
      case 'confirmar':
        salvar({ acao: 'editar', id: u.user_id, nome: u.nome, perfil: u.perfil, ativo: !u.ativo }, b.closest('.pn-usuario'));
        return;
      default:
        return;
    }
    erro = '';
    render();
    const visivel = slots.find((el) => el.offsetParent !== null);
    visivel?.querySelector('form input')?.focus();
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-usuario-form]');
    if (!f) return;
    e.preventDefault();
    if (!f.reportValidity() || ocupado) return;
    const d = new FormData(f),
      tipo = formulario.tipo;
    const p =
      tipo === 'senha'
        ? { acao: 'senha', id: formulario.user_id, senha: d.get('senha') }
        : {
            acao: tipo === 'novo' ? 'criar' : tipo === 'vincular' ? 'vincular' : 'editar',
            id: formulario.user_id,
            nome: d.get('nome'),
            email: d.get('email'),
            perfil: d.get('perfil') || formulario.perfil,
            ativo: ['novo', 'vincular'].includes(tipo) || (d.get('ativo') || String(formulario.ativo)) === 'true',
            ...(tipo === 'novo' ? { senha: d.get('senha') } : {})
          };
    salvar(p, f);
  });
  render();
  return {
    abrir() {
      if (!carregou) carregar();
    },
    esconder() {
      for (const el of slots) el.querySelectorAll('input[type="password"]').forEach((i) => (i.value = ''));
    }
  };
}
window.MLUsuarios = { montar: montarUsuarios };
