/* Mineiro Lanche · tela inicial antes da primeira pintura.
   Script clássico, síncrono, no <head> (a CSP é script-src 'self': nada inline). O app (módulo) só roda depois
   da primeira pintura; até lá o HTML mostraria a bio a quem chega pelo QR (?origem=qrcode), por #cardapio,
   #site, #sacola, #checkout ou #pedido/<token>. Aqui a tela pedida é marcada em <html data-tela-inicial> e o
   CSS (app.css) mostra só ela. O app tira a marca logo depois de aplicar a rota (mesma tarefa, sem quadro no
   meio); se o módulo falhar, ela sai no DOMContentLoaded e a página fica como antes (bio).
   Mesmas regras do início do app.js: checkout sem sacola e #pedido sem pedido caem no cardápio. */
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
  if (!tela) return;
  d.documentElement.setAttribute('data-tela-inicial', tela);
  // os recortes do palco são lazy no HTML (quem chega pelo QR não baixa); quem abre o site já busca o principal
  if (tela === 'site') {
    var l = d.createElement('link');
    l.rel = 'preload';
    l.as = 'image';
    l.href = '/assets/recortes/gran-bacon-onion.webp';
    l.setAttribute('fetchpriority', 'high');
    d.head.appendChild(l);
  }
  d.addEventListener('DOMContentLoaded', function () {
    d.documentElement.removeAttribute('data-tela-inicial');
  });
})(document);
