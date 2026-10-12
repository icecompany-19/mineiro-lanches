/* Mineiro Lanche · tela inicial antes da primeira pintura.
   Script clássico, síncrono, no <head> (a CSP é script-src 'self': nada inline). O app (módulo) só roda depois
   da primeira pintura; até lá o HTML mostraria a bio a quem chega pelo QR (?origem=qrcode), por #cardapio,
   #site, #sacola, #checkout ou #pedido/<token>. Aqui a tela pedida é marcada em <html data-tela-inicial> e o
   CSS (app.css) mostra só ela. O app tira a marca logo depois de aplicar a rota (mesma tarefa, sem quadro no
   meio); se o módulo falhar, ela sai no DOMContentLoaded e a página fica como antes (bio).
   Mesmas regras do início do app.js: checkout sem sacola e #pedido sem pedido caem no cardápio.
   Na bio e no site, pré-carrega a logo (a placa) com o mesmo imagesrcset do <img>. */
(function (d) {
  var hash = location.hash.replace(/^#/, '').split('/');
  var h = hash[0];
  if (h === 'painel') {
    location.replace('/painel/');
    return;
  }
  function lista(k) {
    try {
      var v = JSON.parse(localStorage.getItem('mineiro:v2:' + k) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  var tela = null;
  if (h === 'site') tela = 'site';
  else if (h === 'cardapio') tela = 'menu';
  else if (h === 'sacola') tela = 'sacola';
  else if (h === 'checkout') tela = lista('sacola').length ? 'checkout' : 'menu';
  else if (h === 'pedido') tela = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hash[1] || '') || lista('meus').length ? 'pedido' : 'menu';
  else if (!location.hash && /[?&]origem=qrcode(&|$)/.test(location.search)) tela = 'menu';
  if (!tela) {
    // bio: a placa (logo oficial) é a candidata a LCP; o preload tem o mesmo imagesrcset do <img> (sem baixar duas vezes)
    var p = d.createElement('link');
    p.rel = 'preload';
    p.as = 'image';
    p.setAttribute('imagesrcset', '/assets/logo/logo-256.webp 1x, /assets/logo/logo-512.webp 2x');
    p.setAttribute('fetchpriority', 'high');
    d.head.appendChild(p);
    return;
  }
  d.documentElement.setAttribute('data-tela-inicial', tela);
  // site: a placa do herói é a logo oficial; o preload tem o mesmo imagesrcset da bio (sem baixar duas vezes)
  if (tela === 'site') {
    var l = d.createElement('link');
    l.rel = 'preload';
    l.as = 'image';
    l.setAttribute('imagesrcset', '/assets/logo/logo-256.webp 1x, /assets/logo/logo-512.webp 2x');
    l.setAttribute('fetchpriority', 'high');
    d.head.appendChild(l);
  }
  d.addEventListener('DOMContentLoaded', function () {
    d.documentElement.removeAttribute('data-tela-inicial');
  });
})(document);
