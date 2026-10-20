import { obterSupabase } from '../lib/supabase.js';
import { urlFotoProduto } from '../lib/catalogo.js';
import './produtos.css';

const ERROS = {
  sem_permissao: 'Somente a equipe da loja pode alterar produtos.',
  produto_alterado: 'Este produto mudou em outro aparelho. Feche a edição e atualize a lista antes de editar novamente.',
  dados_invalidos: 'Confira nome, categoria, preço e composição. Use um ingrediente por linha.',
  foto_invalida: 'A foto não foi encontrada. Selecione o arquivo novamente.',
  arquivo_invalido: 'Escolha uma foto JPG, PNG ou WebP de até 20 MB.',
  foto_grande: 'Não foi possível preparar essa foto. Escolha outra imagem.',
  rede: 'Não foi possível confirmar a alteração. Confira a conexão e atualize a lista antes de tentar novamente.'
};

export async function consultarProdutos(nome, args = {}) {
  const sb = await obterSupabase({ sessao: true });
  const ctl = new AbortController(),
    timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const { data, error } = await sb.rpc(nome, args).abortSignal(ctl.signal);
    if (error) throw new Error(error.message);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Converte fotos antes do upload; só WebP entra no bucket, sem SVG ou URLs externas.
export async function prepararFoto(arquivo) {
  if (!arquivo || !['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type) || arquivo.size > 20 * 1024 * 1024) {
    throw new Error('arquivo_invalido');
  }
  const endereco = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = endereco;
    await img.decode().catch(() => {
      throw new Error('arquivo_invalido');
    });
    const fator = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * fator));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * fator));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp' || blob.size > 2 * 1024 * 1024) throw new Error('foto_grande');
    return blob;
  } finally {
    URL.revokeObjectURL(endereco);
  }
}

export async function enviarFotoProduto(blob) {
  const sb = await obterSupabase({ sessao: true });
  const caminho = 'uploads/' + crypto.randomUUID() + '.webp';
  const { error } = await sb.storage.from('produtos-fotos').upload(caminho, blob, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false
  });
  if (error) throw new Error('rede');
  return caminho;
}

export function montarProdutos(root, { consultar = consultarProdutos, enviarFoto = enviarFotoProduto } = {}) {
  const slots = [...root.querySelectorAll('[data-produtos]')];
  const esc = window.ML.fmt.esc,
    brl = window.ML.fmt.brl;
  let dados = null,
    aberto = false,
    carregando = false,
    ocupado = false,
    geracao = 0;
  let formulario = null,
    busca = '',
    categoria = 'todas',
    situacao = 'todos',
    erro = '',
    aviso = '';
  const linhas = (valor) =>
    String(valor || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);
  const norm = (v) =>
    String(v)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const ativos = () => slots.filter((el) => el.offsetParent !== null);
  function alertas() {
    for (const el of slots) {
      const no = el.querySelector('[data-p-erro]');
      if (no) {
        no.textContent = erro;
        no.hidden = !erro;
      }
      const avisoEl = el.querySelector('[data-p-aviso]');
      if (avisoEl) avisoEl.textContent = aviso;
      el.querySelectorAll('[data-p-form] fieldset').forEach((n) => {
        n.disabled = ocupado;
      });
      el.querySelectorAll('[data-p]').forEach((n) => {
        n.disabled =
          ocupado ||
          carregando ||
          (n.dataset.p === 'novo' && !dados) ||
          (n.dataset.p === 'esgotar-categoria' && !dados?.produtos.some((p) => p.categoria === n.dataset.categoria && p.ativo)) ||
          (n.dataset.p === 'esgotado' && !dados?.produtos.find((p) => p.id === n.dataset.id)?.ativo);
      });
    }
  }
  function formHTML() {
    const p = formulario,
      d = p.detalhes || {};
    const foto = urlFotoProduto(p.foto);
    return `<form class="pn-prod-form" data-p-form><fieldset ${ocupado ? 'disabled' : ''}><legend>${p.novo ? 'Novo produto' : 'Editar produto'}</legend>
      <p>Ao salvar, as alterações ficam disponíveis no cardápio dos clientes.</p>
      <div class="pn-prod-campos">
        <label>Nome do produto<input name="nome" maxlength="120" value="${esc(p.nome)}" required autocomplete="off"></label>
        <label>Categoria<select name="categoria" required><option value="" disabled ${!p.categoria ? 'selected' : ''}>Selecione a categoria</option>${dados.categorias.map((c) => `<option value="${esc(c.id)}" ${p.categoria === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        <label>Preço (R$)<input name="preco" inputmode="decimal" type="number" min="0" max="99999.99" step="0.01" value="${p.preco == null ? '' : p.preco}" placeholder="Ex.: 34,90"><small>Deixe vazio para “Preço a confirmar”.</small></label>
        <label>Tipo<select name="tipo">${[
          ['lanche', 'Lanche (opcionais e combo)'],
          ['combo', 'Combo pronto'],
          ['porcao', 'Porção'],
          ['bebida', 'Bebida']
        ]
          .map(([id, nome]) => `<option value="${id}" ${p.tipo === id ? 'selected' : ''}>${nome}</option>`)
          .join('')}</select></label>
        <label class="pn-prod-largo">Descrição / base<textarea name="base" maxlength="500" rows="2">${esc(d.base)}</textarea></label>
        <label>Ingredientes (um por linha)<textarea name="ingredientes" rows="5">${esc((p.ingredientes || []).join('\n'))}</textarea><small>No lanche, o cliente pode escolher quais retirar.</small></label>
        <label>Itens inclusos (um por linha)<textarea name="inclui" rows="5">${esc((d.inclui || []).join('\n'))}</textarea><small>Para descrever combos e porções.</small></label>
        <label>Observação do produto<textarea name="nota" maxlength="500" rows="2">${esc(d.nota)}</textarea></label>
        <label>Ordem na categoria<input name="ordem" type="number" min="0" max="100000" step="1" value="${p.ordem}" required><small>Os menores valores aparecem primeiro.</small></label>
        <label class="pn-prod-check"><input name="ativo" type="checkbox" ${p.ativo ? 'checked' : ''}> Disponível no cardápio</label>
        <label class="pn-prod-check"><input name="sabor" type="checkbox" ${d.sabor ? 'checked' : ''}> Pedir sabor da bebida</label>
        <label class="pn-prod-check"><input name="escolheRefri" type="checkbox" ${d.escolheRefri ? 'checked' : ''}> Pedir refrigerante do combo</label>
        <div class="pn-prod-largo pn-prod-foto"><div>${foto ? `<img src="${esc(foto)}" alt="Foto atual de ${esc(p.nome)}" width="100" height="100">` : '<span>Sem foto</span>'}</div><label>Foto do produto<input name="arquivo" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG ou WebP. A imagem será ajustada para o cardápio.</small></label><label class="pn-prod-check"><input name="removerFoto" type="checkbox"> Remover foto atual</label></div>
      </div><div class="pn-prod-acoes"><button class="pn-btn pn-btn--prim" type="submit">Salvar produto</button><button class="pn-btn" type="button" data-p="fechar">Cancelar edição</button></div>
    </fieldset></form>`;
  }
  function listar() {
    if (!dados) return;
    const lista = dados.produtos.filter(
      (p) =>
        (categoria === 'todas' || p.categoria === categoria) &&
        (situacao === 'todos' || (situacao === 'ativos' ? p.ativo : !p.ativo)) &&
        norm(p.nome).includes(norm(busca))
    );
    const esgotados = window.ML.store.esgotados();
    for (const el of slots) {
      const area = el.querySelector('[data-p-lista]');
      if (!area) continue;
      const categoriaAtual = dados.produtos.filter((p) => p.categoria === categoria && p.ativo);
      const todosEsgotados = categoriaAtual.length > 0 && categoriaAtual.every((p) => esgotados[p.id]);
      el.querySelector('[data-p-lote]').innerHTML =
        categoria !== 'todas'
          ? `<button class="pn-btn" type="button" data-p="esgotar-categoria" data-categoria="${esc(categoria)}" data-esgotar="${!todosEsgotados}" ${!categoriaAtual.length || ocupado ? 'disabled' : ''}>${todosEsgotados ? 'Liberar categoria inteira' : 'Esgotar categoria inteira'} (${categoriaAtual.length} itens)</button>`
          : '';
      el.querySelector('[data-p-total]').textContent = `${lista.length} ${lista.length === 1 ? 'produto' : 'produtos'}`;
      area.innerHTML =
        lista
          .map((p) => {
            const foto = urlFotoProduto(p.foto),
              cat = dados.categorias.find((c) => c.id === p.categoria);
            return `<article class="pn-prod-item" data-produto="${esc(p.id)}"><div class="pn-prod-miniatura">${foto ? `<img src="${esc(foto)}" alt="" width="76" height="76" loading="lazy">` : '<span>Sem foto</span>'}</div><div><h3>${esc(p.nome)}</h3><p>${esc(cat?.label || p.categoria)} · ${esc(brl(p.preco))}</p><p>${!p.ativo ? 'Oculto do cardápio' : esgotados[p.id] ? 'Esgotado hoje' : 'Disponível'}</p></div><div class="pn-prod-acoes"><button type="button" class="pn-btn" data-p="editar" data-id="${esc(p.id)}" aria-label="Editar ${esc(p.nome)}">Editar</button><button type="button" class="pn-btn" role="switch" aria-checked="${!!esgotados[p.id]}" aria-label="Esgotado hoje: ${esc(p.nome)}" data-p="esgotado" data-id="${esc(p.id)}" ${!p.ativo ? 'disabled' : ''}>${esgotados[p.id] ? 'Liberar hoje' : 'Esgotar hoje'}</button></div></article>`;
          })
          .join('') || '<p>Nenhum produto encontrado com esses filtros.</p>';
    }
  }
  function render() {
    for (const el of slots)
      el.innerHTML = `<div class="pn-produtos"><header class="pn-prod-cab"><div><h2>Produtos</h2><p>Cadastre e edite o cardápio da loja.</p><p>Esgotar hoje pausa as vendas até o próximo dia de funcionamento. Para ocultar um item até reativar, desmarque Disponível no cardápio em Editar.</p></div><div class="pn-prod-acoes"><button class="pn-btn pn-btn--prim" type="button" data-p="novo" ${!dados ? 'disabled' : ''}>Novo produto</button><button class="pn-btn" type="button" data-p="atualizar">Atualizar lista</button></div></header>
      <p class="pn-erro" data-p-erro role="alert" ${erro ? '' : 'hidden'}>${esc(erro)}</p><p data-p-aviso role="status" aria-live="polite">${esc(aviso)}</p>
      ${!dados ? '<p role="status">Carregando produtos…</p>' : `${formulario ? formHTML() : ''}<div class="pn-prod-filtros"><label>Buscar produto<input type="search" data-p-busca value="${esc(busca)}" placeholder="Nome do produto"></label><label>Categoria<select data-p-categoria><option value="todas">Todas as categorias</option>${dados.categorias.map((c) => `<option value="${esc(c.id)}" ${categoria === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><label>Disponibilidade<select data-p-situacao><option value="todos">Todos os produtos</option><option value="ativos" ${situacao === 'ativos' ? 'selected' : ''}>Visíveis no cardápio</option><option value="inativos" ${situacao === 'inativos' ? 'selected' : ''}>Ocultos do cardápio</option></select></label></div><div data-p-lote></div><p data-p-total></p><div data-p-lista></div>`}</div>`;
    listar();
    alertas();
  }
  async function carregar() {
    if (carregando || ocupado || !aberto) return;
    carregando = true;
    const g = geracao;
    alertas();
    try {
      const resultado = await consultar('catalogo_json');
      if (!aberto || g !== geracao) return;
      dados = resultado;
      erro = '';
      // Atualizar a lista não apaga uma edição em andamento.
      if (!formulario) render();
      else listar();
    } catch (e) {
      erro = ERROS[e.message] || ERROS.rede;
    } finally {
      carregando = false;
      alertas();
      if (aberto && g !== geracao) carregar();
    }
  }
  function focarForm() {
    const form = ativos()[0]?.querySelector('[data-p-form]');
    form?.scrollIntoView({ block: 'start', behavior: 'instant' });
    form?.querySelector('[name="nome"]')?.focus({ preventScroll: true });
  }
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b?.closest('[data-produtos]') || ocupado || carregando) return;
    erro = '';
    aviso = '';
    if (b.dataset.p === 'atualizar') return carregar();
    if (b.dataset.p === 'fechar') {
      formulario = null;
      render();
      return;
    }
    if (b.dataset.p === 'novo' || b.dataset.p === 'editar') {
      if (formulario && !confirm('Descartar a edição em andamento?')) return;
      formulario =
        b.dataset.p === 'novo'
          ? {
              novo: true,
              id: 'produto-' + crypto.randomUUID(),
              nome: '',
              categoria: categoria === 'todas' ? '' : categoria,
              preco: null,
              tipo: 'lanche',
              ingredientes: [],
              detalhes: {},
              ativo: true,
              ordem: Math.max(0, ...dados.produtos.map((p) => p.ordem)) + 1
            }
          : structuredClone(dados.produtos.find((p) => p.id === b.dataset.id));
      render();
      focarForm();
      return;
    }
    if (b.dataset.p === 'esgotado' || b.dataset.p === 'esgotar-categoria') {
      ocupado = true;
      alertas();
      try {
        if (b.dataset.p === 'esgotar-categoria')
          await consultar('marcar_categoria_esgotada', { p_categoria: b.dataset.categoria, p_esgotado: b.dataset.esgotar === 'true' });
        else await consultar('marcar_esgotado', { p_produto: b.dataset.id, p_esgotado: b.getAttribute('aria-checked') !== 'true' });
        dados = await consultar('catalogo_json');
        await window.ML.store.recarregar();
        aviso = 'Disponibilidade de hoje atualizada.';
      } catch (x) {
        erro = ERROS[x.message] || ERROS.rede;
      } finally {
        ocupado = false;
        listar();
        alertas();
      }
    }
  });
  root.addEventListener('input', (e) => {
    if (!e.target.matches('[data-p-busca]')) return;
    busca = e.target.value;
    listar();
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-p-categoria]')) categoria = e.target.value;
    else if (e.target.matches('[data-p-situacao]')) situacao = e.target.value;
    else return;
    listar();
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-p-form]');
    if (!form) return;
    e.preventDefault();
    if (ocupado || !formulario || !form.reportValidity()) return;
    const val = (nome) => form.elements.namedItem(nome);
    const detalhes = {
      base: val('base').value.trim(),
      nota: val('nota').value.trim(),
      inclui: linhas(val('inclui').value),
      sabor: val('sabor').checked,
      escolheRefri: val('escolheRefri').checked
    };
    const p = {
      id: formulario.id,
      nome: val('nome').value.trim(),
      categoria: val('categoria').value,
      preco: val('preco').value === '' ? null : Number(val('preco').value),
      tipo: val('tipo').value,
      foto: val('removerFoto').checked ? null : formulario.foto || null,
      ingredientes: linhas(val('ingredientes').value),
      detalhes,
      ativo: val('ativo').checked,
      ordem: Number(val('ordem').value)
    };
    const arquivo = val('arquivo').files[0];
    ocupado = true;
    erro = '';
    aviso = arquivo ? 'Preparando e enviando foto…' : 'Salvando produto…';
    alertas();
    const g = geracao;
    let salvo = false;
    try {
      if (arquivo) p.foto = await enviarFoto(await prepararFoto(arquivo));
      await consultar('salvar_produto', { p_dados: p, p_versao: formulario.atualizado_em || null });
      salvo = true;
      formulario = null;
      if (!aberto || g !== geracao) return;
      formulario = null;
      aviso = 'Produto salvo. O cardápio dos clientes será atualizado automaticamente.';
      // Uma falha de recarga não transforma uma escrita confirmada em erro de salvamento.
      dados = await consultar('catalogo_json');
      await window.ML.store.recarregar();
      render();
    } catch (x) {
      if (g !== geracao) return;
      erro = salvo ? 'Produto salvo, mas a lista ainda não atualizou. Toque em Atualizar lista.' : ERROS[x.message] || ERROS.rede;
      aviso = '';
      if (salvo) render();
    } finally {
      ocupado = false;
      alertas();
      if (aberto && g !== geracao) {
        if (salvo) {
          aviso = 'Produto salvo. Atualizando lista…';
          render();
        }
        carregar();
      }
    }
  });
  return {
    abrir() {
      aberto = true;
      geracao++;
      if (!formulario) render();
      carregar();
    },
    esconder() {
      aberto = false;
      geracao++;
    },
    destruir() {
      aberto = false;
      geracao++;
    }
  };
}
window.MLProdutos = { montar: montarProdutos };
