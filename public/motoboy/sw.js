// A tela do motoboy saiu em 29/10/2026 (entregas manuais, docs/ENTREGAS-MANUAIS.md). Este worker toma o lugar do antigo
// nos celulares que tinham a tela instalada: apaga o cache dela e se desinstala. Depois disso /motoboy/ abre pela rede,
// que redireciona para o painel.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('mineiro-motoboy-')).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  )
);
