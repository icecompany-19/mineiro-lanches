/* Mineiro Lanche · acesso ao painel: login da equipe antes de montar o quadro.
   1. Sessão guardada no aparelho (Supabase Auth, persistente): entra direto.
   2. Sem sessão: e-mail e senha (signInWithPassword). O cadastro é feito pelo dono no Supabase.
   3. Logado: confere se o usuário está na tabela equipe (o RLS deixa ler só a própria linha).
      Fora da equipe: "Sem acesso", com o botão Sair.
   4. Na equipe: instala a store do Supabase, espera a primeira carga e só então monta o painel
      (assim os pedidos que já existiam não tocam som como se fossem novos).
   Sessão expirada (o servidor recusa o token e a renovação falha): volta para o login.

   Opções (todas opcionais; sem elas vale exatamente o acima, o painel da equipe):
   - titulo, sub: texto do cabeçalho do login.
   - tabela: tabela em que o usuário precisa ter uma linha (padrão 'equipe'; o motoboy usa 'motoboys').
   - chave: chave da sessão no aparelho (padrão CHAVE_SESSAO). O Sair apaga as chaves que começam por ela.
   - textoSemAcesso: texto da tela "Sem acesso".
   - aoAbrir(usuario, { sb, sair }): outra tela no lugar do painel. Com ele, não instala a store do Supabase nem
     chama window.MLPainel; aoEsconder() é chamado quando a sessão expira com a tela aberta. */
import { obterSupabase, CHAVE_SESSAO } from '../lib/supabase.js';
import { instalarStoreSupabase } from '../lib/store-supabase.js';

export function iniciarAcesso(opc) {
  const ML = window.ML;
  const esc = ML.fmt.esc;
  const quadro = opc.el;
  const chaveSessao = opc.chave || CHAVE_SESSAO;
  const tabela = opc.tabela || 'equipe';
  quadro.hidden = true;

  const tela = document.createElement('section');
  tela.className = 'painel pn-acesso';
  tela.setAttribute('aria-labelledby', 'pn-acesso-tit');
  tela.innerHTML = `<div class="pn-acesso-caixa">
      <img class="pn-acesso-logo" src="/assets/logo/selo-256.webp" alt="" width="84" height="84">
      <h1 class="pn-acesso-tit" id="pn-acesso-tit">${esc(opc.titulo || 'Painel de pedidos')}</h1>
      <p class="pn-acesso-sub">${esc(opc.sub || ML.CONFIG.nome + ' · acesso da equipe')}</p>
      <div class="pn-acesso-corpo" data-corpo></div>
    </div>`;
  quadro.parentNode.insertBefore(tela, quadro);
  const corpo = tela.querySelector('[data-corpo]');

  let sb = null;
  let store = null;
  let montado = false;
  let saindo = false;
  let expirou = false;
  let conferindo = null;

  function etapa(html, foco) {
    tela.hidden = false;
    corpo.innerHTML = html;
    const f = foco && corpo.querySelector(foco);
    if (f) f.focus();
  }
  function aguarde(txt) {
    etapa(`<p class="pn-acesso-msg" role="status">${esc(txt)}</p>`);
  }
  function semRede(txt, tentar) {
    etapa(
      `<p class="pn-erro" role="alert">${esc(txt)}</p><button type="button" class="pn-btn pn-btn--prim pn-acesso-b" data-tentar>Tentar de novo</button>`,
      '[data-tentar]'
    );
    corpo.querySelector('[data-tentar]').addEventListener('click', tentar);
  }

  // ---------- login ----------
  function mostrarLogin(aviso) {
    etapa(
      `<form class="pn-acesso-form" novalidate>
        ${aviso ? `<p class="pn-acesso-aviso" role="status">${esc(aviso)}</p>` : ''}
        <label class="pn-campo"><span class="pn-campo-r">E-mail</span><input class="pn-input" type="email" name="email" autocomplete="username" required></label>
        <label class="pn-campo"><span class="pn-campo-r">Senha</span><input class="pn-input" type="password" name="senha" autocomplete="current-password" required></label>
        <p class="pn-erro" role="alert" data-erro hidden></p>
        <button type="submit" class="pn-btn pn-btn--prim pn-acesso-b">Entrar</button>
      </form>`,
      'input[name="email"]'
    );
    const form = corpo.querySelector('form');
    const erro = form.querySelector('[data-erro]');
    const botao = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      const senha = form.senha.value;
      if (!email || !senha) {
        erro.textContent = 'Preencha o e-mail e a senha.';
        erro.hidden = false;
        (email ? form.senha : form.email).focus();
        return;
      }
      erro.hidden = true;
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      let r;
      try {
        r = await sb.auth.signInWithPassword({ email, password: senha });
      } catch (x) {
        r = { error: x };
      }
      if (r.error || !r.data || !r.data.user) {
        botao.disabled = false;
        botao.textContent = 'Entrar';
        erro.textContent = mensagemDoLogin(r.error);
        erro.hidden = false;
        form.senha.select();
        return;
      }
      // depois de uma sessão expirada o painel já montado recomeça do zero com o novo login
      if (montado) {
        location.reload();
        return;
      }
      entrar(r.data.user);
    });
  }
  function mensagemDoLogin(e) {
    const status = e && e.status;
    const codigo = (e && (e.code || '')) + ' ' + ((e && e.message) || '');
    if (/invalid_credentials|invalid login/i.test(codigo) || status === 400) return 'E-mail ou senha incorretos.';
    if (/not confirmed/i.test(codigo)) return 'Este e-mail ainda não foi confirmado.';
    if (status === 429) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
    return 'Não foi possível falar com o servidor. Confira a internet e tente de novo.';
  }

  // ---------- equipe ----------
  async function entrar(usuario) {
    aguarde('Conferindo o acesso…');
    const { data, error } = await sb.from(tabela).select('user_id').eq('user_id', usuario.id).maybeSingle();
    if (error) {
      if (/jwt/i.test(error.message || '') || /^PGRST30/.test(error.code || ''))
        return mostrarLogin('Sua sessão expirou. Entre de novo para continuar.');
      return semRede('Não foi possível conferir o acesso agora.', () => entrar(usuario));
    }
    if (!data) return semAcesso(usuario);
    abrirPainel(usuario);
  }
  function semAcesso(usuario) {
    const motivo = opc.textoSemAcesso
      ? `<p>${esc(opc.textoSemAcesso)}</p><p>Entrou como <strong>${esc(usuario.email || '')}</strong>.</p>`
      : `<p>O usuário <strong>${esc(usuario.email || '')}</strong> não está na equipe do painel. Peça ao responsável do truck para liberar este e-mail.</p>`;
    etapa(
      `<div class="pn-acesso-sem" role="alert"><h2>Sem acesso</h2>
        ${motivo}</div>
        <button type="button" class="pn-btn pn-acesso-b" data-sair>Sair</button>`,
      '[data-sair]'
    );
    corpo.querySelector('[data-sair]').addEventListener('click', sair);
  }

  // ---------- painel ----------
  async function abrirPainel(usuario) {
    // login novo depois de uma sessão recusada na primeira carga: recomeça do zero (a store antiga já parou)
    expirou = false;
    // outra tela no lugar do painel (entregador): sem store, sem Realtime, sem MLPainel
    if (opc.aoAbrir) {
      tela.hidden = true;
      quadro.hidden = false;
      montado = true;
      opc.aoAbrir(usuario, { sb, sair });
      return;
    }
    aguarde('Carregando os pedidos…');
    const minha = instalarStoreSupabase({ papel: 'painel', aoSessaoExpirada: conferirSessao });
    store = minha;
    const avisoLento = setTimeout(() => !expirou && store === minha && aguarde('Sem resposta do servidor. Tentando de novo…'), 8000);
    await minha.iniciar();
    clearTimeout(avisoLento);
    if (expirou || store !== minha) return;
    tela.hidden = true;
    quadro.hidden = false;
    montado = true;
    window.MLPainel.montar(quadro, { demo: !!opc.demo, usuario: usuario.email || '', aoSair: sair });
    window.MLPainel.mostrar();
  }
  // o servidor recusou o token: tenta renovar; se não der, volta para o login
  function conferirSessao() {
    if (conferindo || expirou || saindo) return conferindo;
    conferindo = sb.auth
      .refreshSession()
      .then(({ data, error }) => {
        // sem rede na renovação: a sessão continua guardada e o plano B tenta de novo
        if (error && error.name === 'AuthRetryableFetchError') return;
        if (error || !data || !data.session) sessaoExpirada();
        else if (store) store.recarregar().catch(() => {});
      })
      .catch(() => {
        /* sem rede: o plano B tenta de novo e, se for mesmo a sessão, volta aqui */
      })
      .finally(() => {
        conferindo = null;
      });
    return conferindo;
  }
  function sessaoExpirada() {
    if (expirou || saindo) return;
    expirou = true;
    if (store) store.parar();
    if (montado) {
      if (opc.aoEsconder) opc.aoEsconder();
      else if (!opc.aoAbrir) window.MLPainel.esconder();
    }
    quadro.hidden = true;
    mostrarLogin('Sua sessão expirou. Entre de novo para continuar.');
  }
  // Sair apaga a sessão do aparelho mesmo sem rede: o signOut do supabase-js devolve { error } sem apagar
  // nada quando o /logout falha (rede ruim, 5xx), e quem abrisse o painel depois entraria direto.
  // Espera no máximo 3 s pelo servidor. O rascunho do checkout (mesma origem) também sai.
  async function sair() {
    saindo = true;
    if (store) store.parar();
    let r;
    try {
      r = await Promise.race([
        sb.auth.signOut({ scope: 'local' }),
        new Promise((ok) => setTimeout(() => ok({ error: new Error('tempo esgotado') }), 3000))
      ]);
    } catch (e) {
      r = { error: e };
    }
    try {
      if (r && r.error) {
        Object.keys(localStorage)
          .filter((k) => k.indexOf(chaveSessao) === 0)
          .forEach((k) => localStorage.removeItem(k));
      }
      localStorage.removeItem('mineiro:v2:rascunho');
    } catch {
      /* sem storage: não há sessão guardada */
    }
    location.reload();
  }

  // ---------- início ----------
  async function comecar() {
    aguarde('Conferindo o acesso…');
    try {
      sb = await obterSupabase({ sessao: true, chave: chaveSessao });
    } catch {
      return semRede('Não foi possível carregar o painel. Confira a internet.', comecar);
    }
    sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && montado) sessaoExpirada();
    });
    const { data } = await sb.auth.getSession();
    if (data && data.session && data.session.user) entrar(data.session.user);
    else mostrarLogin();
  }
  comecar();
}
