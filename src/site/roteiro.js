/* Mineiro Lanche · site imersivo: roteiro de fotos (docs/DIRECAO-VISUAL.md 6.1).
   Por seção, os ids de produto em ordem de preferência. A foto de cada produto é item.foto || item.id no fotos.json;
   nas seções guiadas por foto (S2, S4, S7) só entra o produto com foto de origem 'nova'.
   As fotos chegam pelo app (ML.app.foto, exposto em src/app.js); os produtos, por window.ML.produtos. */

export const ROTEIRO = {
  monte: ['gran-bacon', 'gran-bacon-onion', 'gran-salada', 'gran-crispy'],
  dog: ['dog-max'],
  prensado: ['x-churrasco'],
  combos: ['combo-gran-bacon-onion', 'combo-diluvio', 'gran-bacon-coca-maionese', 'combo-2-dog-doritos'], // 'antiga' entra com moldura escura
  dividir: ['porcao-batata'] // card "Pra dividir": oculto até existir foto 'nova'
};

// slug da foto do produto no fotos.json (item.foto || item.id); null se o produto não existe
export function fotoDe(id) {
  const p = window.ML.produtos[id];
  return p ? p.foto || p.id : null;
}

// o produto existe, está no cardápio e a foto dele é 'nova'?
export function temFotoNova(id) {
  const p = window.ML.produtos[id];
  return !!p && !p.inativo && window.ML.app.foto.nova(fotoDe(id));
}

// os ids da lista com foto 'nova', na ordem da lista
export function comFotoNova(lista) {
  return (lista || []).filter(temFotoNova);
}

// o primeiro id da lista com foto 'nova' (o roteiro de cada seção), ou null se nenhum tiver
export function primeiroComFotoNova(lista) {
  return comFotoNova(lista)[0] || null;
}
