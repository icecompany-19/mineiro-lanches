/* Mineiro Lanche · QR code da comanda (contrato C3 do docs/PLANO-FASE-3.md).
   Gera um <svg> pronto para a impressora térmica: o fundo é um <rect> branco e todos os módulos escuros vão em UM
   <path fill="#000"> (corridas horizontais), com shape-rendering="crispEdges". Nada de CSS para desenhar: o @media print da
   comanda zera background e box-shadow, mas não mexe em atributos de SVG.
   Só o núcleo do pacote qrcode (qrcode/lib/core/qrcode.js) entra no bundle: sem o renderer de canvas nem o de terminal.
   Importado por main-painel.js, que o pendura em window.MLQr; o painel.js continua um IIFE sem import. */
import QRCode from 'qrcode/lib/core/qrcode.js';

const ROTULO_PADRAO = 'QR code para o entregador confirmar a entrega';

// atributo de texto seguro (o rótulo pode vir de fora)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// número curto para o SVG (sem zeros à direita)
const num = (n) => String(+n.toFixed(3));

/**
 * @param {string} texto  o que o QR carrega (a URL da entrega)
 * @param {{ ecc?: 'L'|'M'|'Q'|'H', moduloMm?: number, margem?: number, rotulo?: string }} [opc]
 *   ecc: correção de erro (Q = 25%); moduloMm: lado de cada módulo no papel; margem: zona de silêncio, em módulos;
 *   rotulo: aria-label (nunca com o nome da loja nem com a URL)
 * @returns {string} um <svg> com viewBox em módulos e width/height em mm
 */
export function qrSvg(texto, { ecc = 'Q', moduloMm = 0.8, margem = 4, rotulo } = {}) {
  if (texto == null) throw new Error('No input text'); // sem isto, undefined viraria o QR do texto "undefined"
  const qr = QRCode.create(String(texto), { errorCorrectionLevel: ecc });
  const n = qr.modules.size;
  const lado = n + 2 * margem; // em módulos, com a zona de silêncio
  let d = '';
  for (let l = 0; l < n; l++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(l, c)) {
        c++;
        continue;
      }
      let fim = c;
      while (fim < n && qr.modules.get(l, fim)) fim++;
      // corrida horizontal de módulos escuros: M x y h comprimento v 1 h -comprimento z
      d += `M${c + margem} ${l + margem}h${fim - c}v1h-${fim - c}z`;
      c = fim;
    }
  }
  const mm = num(lado * moduloMm) + 'mm';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="${mm}" height="${mm}" shape-rendering="crispEdges" role="img" aria-label="${esc(rotulo || ROTULO_PADRAO)}">` +
    `<rect width="${lado}" height="${lado}" fill="#fff"/>` +
    `<path fill="#000" d="${d}"/>` +
    '</svg>'
  );
}
