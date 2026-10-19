import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/mapa-viagem.css';

export function abrirMapaViagem(viagem) {
  if (!viagem?.geometria || !navigator.onLine || (viagem.geometriaAte && Date.parse(viagem.geometriaAte) <= Date.now())) return;
  const esc = window.ML.fmt.esc;
  const anterior = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'mapa-viagem';
  dialog.setAttribute('aria-labelledby', 'mapa-viagem-t');
  dialog.innerHTML = `<div class="mapa-viagem-cab"><div><h2 id="mapa-viagem-t">Percurso da viagem</h2><p>${esc(viagem.motoboyNome || 'Viagem sugerida')} · ${(viagem.metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km com retorno à loja</p></div><button type="button" class="pn-btn" data-mapa-fechar>Fechar mapa</button></div><p class="mapa-viagem-aviso">Paradas planejadas. O mapa não acompanha a localização do motoboy.</p><div class="mapa-viagem-area" aria-label="Mapa do percurso pelas ruas"></div><ol class="mapa-viagem-paradas">${viagem.paradas.map((p) => `<li><b>${esc(window.ML.fmt.numero(p.numero))}</b> ${esc(p.endereco)}</li>`).join('')}</ol>`;
  document.body.append(dialog);
  dialog.showModal();
  const mapa = L.map(dialog.querySelector('.mapa-viagem-area'), { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a>'
  }).addTo(mapa);
  const caminho = L.geoJSON(
    { type: 'Feature', geometry: viagem.geometria },
    { style: { color: 'var(--fio)', weight: 5, opacity: 0.9 } }
  ).addTo(mapa);
  const marcador = (ponto, texto, classe) => {
    if (!ponto || !Number.isFinite(ponto.lat) || !Number.isFinite(ponto.lon)) return;
    L.marker([ponto.lat, ponto.lon], {
      icon: L.divIcon({ className: `mapa-viagem-pino ${classe}`, html: texto, iconSize: [30, 30], iconAnchor: [15, 15] })
    }).addTo(mapa);
  };
  marcador(viagem.origem, 'L', 'mapa-viagem-loja');
  viagem.paradas.forEach((p, i) => marcador(p.ponto, String(i + 1), ''));
  mapa.fitBounds(caminho.getBounds(), { padding: [30, 30], maxZoom: 17 });
  requestAnimationFrame(() => mapa.invalidateSize());
  const fechar = () => dialog.close();
  dialog.querySelector('[data-mapa-fechar]').addEventListener('click', fechar);
  dialog.addEventListener(
    'close',
    () => {
      mapa.remove();
      dialog.remove();
      anterior?.focus({ preventScroll: true });
    },
    { once: true }
  );
  dialog.querySelector('[data-mapa-fechar]').focus();
}
