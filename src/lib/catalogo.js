// Reconcilia o catálogo do servidor sem substituir as referências usadas na sacola.
export function aplicarCatalogo(ML, catalogo) {
  if (!catalogo || !Array.isArray(catalogo.produtos) || !Array.isArray(catalogo.categorias)) return false;
  const categorias = catalogo.categorias.map((c) => ({ ...c, itens: [] }));
  const porCategoria = new Map(categorias.map((c) => [c.id, c]));
  const recebidos = new Set();
  for (const linha of catalogo.produtos) {
    const categoria = porCategoria.get(linha.categoria);
    if (!categoria) continue;
    const p = ML.produtos[linha.id] || (ML.produtos[linha.id] = { id: linha.id });
    recebidos.add(p.id);
    Object.assign(p, {
      nome: linha.nome,
      cat: linha.categoria,
      preco: linha.preco == null ? null : Number(linha.preco),
      tipo: linha.tipo,
      foto: linha.foto || null,
      ing: linha.ingredientes || [],
      inativo: !linha.ativo,
      base: linha.detalhes?.base || '',
      nota: linha.detalhes?.nota || '',
      inclui: linha.detalhes?.inclui?.length ? linha.detalhes.inclui : undefined,
      sabor: !!linha.detalhes?.sabor,
      escolheRefri: !!linha.detalhes?.escolheRefri
    });
    if (linha.ativo) categoria.itens.push(p);
  }
  for (const p of Object.values(ML.produtos)) if (!recebidos.has(p.id)) p.inativo = true;
  ML.CONFIG.categorias.splice(0, ML.CONFIG.categorias.length, ...categorias);
  return true;
}

export function urlFotoProduto(foto) {
  if (!foto) return '';
  if (/^uploads\/[a-f0-9-]{36}\.webp$/.test(foto)) {
    return String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '') + '/storage/v1/object/public/produtos-fotos/' + foto;
  }
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(foto) ? '/assets/fotos/' + foto + '-540.webp' : '';
}
