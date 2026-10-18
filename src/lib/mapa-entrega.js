import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/mapa-entrega.css';

// Referências de endereço exigem uma marcação explícita antes de confirmar.
export function abrirMapaEntrega({ ponto, signal }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'mapa-entrega';
    dialog.setAttribute('aria-labelledby', 'mapa-entrega-titulo');
    dialog.innerHTML =
      '<h2 id="mapa-entrega-titulo">Onde vamos entregar?</h2><p>Toque no mapa para marcar a entrada do endereço. Confira o local antes de confirmar.</p><div class="mapa-entrega__mapa" aria-label="Mapa do local de entrega"></div><p class="mapa-entrega__dica" role="status" aria-live="polite">Marque a entrada da casa ou use sua localização, se estiver no endereço de entrega.</p><div class="mapa-entrega__acoes"><button type="button" class="btn btn-borda" data-gps>Usar minha localização</button><button type="button" class="btn btn-borda" data-centro>Marcar no centro do mapa</button><button type="button" class="btn" data-confirmar disabled>Confirmar local de entrega</button><button type="button" class="btn btn-borda" data-cancelar>Voltar ao endereço</button></div>';
    document.body.append(dialog);
    const dica = dialog.querySelector('[role="status"]'),
      botao = dialog.querySelector('[data-confirmar]');
    let marcado = null,
      finalizou = false;
    const centro = ponto || { lat: -23.5409777, lon: -46.312935 };
    const map = L.map(dialog.querySelector('.mapa-entrega__mapa'), { zoomControl: true, attributionControl: true }).setView(
      [centro.lat, centro.lon],
      17
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' +
        (ponto?.fonte === 'geoapify' ? ' · <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a>' : '')
    }).addTo(map);
    const icone = L.divIcon({
      className: 'mapa-entrega__pino',
      html: '<span aria-hidden="true">●</span>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    const marcador = L.marker([centro.lat, centro.lon], { icon: icone, draggable: true, alt: 'Entrada do endereço de entrega' }).addTo(map);
    function marcar(p) {
      marcado = { lat: p.lat, lon: p.lng ?? p.lon };
      marcador.setLatLng([marcado.lat, marcado.lon]);
      botao.disabled = false;
      dica.textContent = 'Confira se o ponto está na entrada do endereço de entrega.';
    }
    map.on('click', (e) => marcar(e.latlng));
    marcador.on('dragend', () => marcar(marcador.getLatLng()));
    dialog.querySelector('[data-centro]').onclick = () => marcar(map.getCenter());
    function terminar(valor) {
      if (finalizou) return;
      finalizou = true;
      signal?.removeEventListener('abort', cancelar);
      map.remove();
      dialog.close();
      dialog.remove();
      resolve(valor);
    }
    const cancelar = () => terminar(null);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      cancelar();
    });
    dialog.querySelector('[data-cancelar]').onclick = cancelar;
    botao.onclick = () => {
      if (marcado) terminar(marcado);
    };
    dialog.querySelector('[data-gps]').onclick = () => {
      if (!navigator.geolocation) {
        dica.textContent = 'Este navegador não disponibilizou a localização. Marque o endereço no mapa.';
        return;
      }
      dica.textContent = 'Buscando sua localização…';
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (finalizou) return;
          if (p.coords.accuracy > 100) {
            dica.textContent = 'A localização está imprecisa. Marque a entrada no mapa.';
            return;
          }
          const c = { lat: p.coords.latitude, lon: p.coords.longitude };
          marcar(c);
          map.setView([c.lat, c.lon], 18);
        },
        () => {
          if (!finalizou) dica.textContent = 'Não conseguimos acessar sua localização. Você pode marcar o endereço no mapa.';
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    };
    signal?.addEventListener('abort', cancelar, { once: true });
    if (signal?.aborted) {
      cancelar();
      return;
    }
    dialog.showModal();
    requestAnimationFrame(() => {
      if (!finalizou) {
        map.invalidateSize();
        dialog.querySelector('[data-cancelar]').focus();
      }
    });
  });
}
