// Cartaz do QR: tamanho da folha (?tamanho=a5) e mesa (?mesa=3).
// Arquivo à parte, e não <script> no HTML, por causa da CSP do site (script-src 'self').
// Carregado no <head> sem defer: a classe da folha e o @page entram antes de pintar.
(function () {
  var raiz = document.documentElement;
  var p = new URLSearchParams(location.search);
  var tamanho = (p.get('tamanho') || '').toLowerCase() === 'a5' ? 'a5' : 'a6';
  var mesa = (p.get('mesa') || '').trim();
  if (!/^\d{1,3}$/.test(mesa)) mesa = '';

  raiz.classList.add(tamanho);
  if (mesa) raiz.classList.add('com-mesa');
  // Medidas explícitas: o Chromium não conhece a palavra-chave A6.
  var pagina = document.getElementById('pagina');
  if (pagina) pagina.textContent = '@page{size:' + (tamanho === 'a5' ? '148mm 210mm' : '105mm 148mm') + ';margin:0}';

  document.addEventListener('DOMContentLoaded', function () {
    var sufixo = mesa ? '&mesa=' + mesa : '';

    // Mesa: QR próprio (gerado com npm run qrcode -- --mesas 1-10) e selo "Mesa N".
    if (mesa) {
      var qr = document.getElementById('qr');
      var selo = document.getElementById('mesa');
      selo.textContent = 'Mesa ' + mesa;
      selo.hidden = false;
      qr.alt = 'QR code do cardápio do Mineiro Lanche, mesa ' + mesa;
      qr.onerror = function () {
        var aviso = document.createElement('p');
        aviso.className = 'aviso';
        aviso.textContent = 'O QR da mesa ' + mesa + ' ainda não foi gerado. Rode:';
        aviso.appendChild(document.createElement('code')).textContent = 'npm run qrcode -- --mesas 1-10';
        qr.replaceWith(aviso);
      };
      qr.src = 'mesa-' + mesa + '.svg';
    }

    document.querySelectorAll('.barra a').forEach(function (a) {
      a.href = '?tamanho=' + a.dataset.tamanho + sufixo;
      if (a.dataset.tamanho === tamanho) a.setAttribute('aria-current', 'page');
    });
    document.getElementById('imprimir').addEventListener('click', function () {
      window.print();
    });

    // Na tela, a folha encolhe para caber no celular (na impressão fica no tamanho real).
    var folha = document.querySelector('.folha');
    function caber() {
      folha.style.setProperty('--zoom', '1');
      var z = Math.min(1, (raiz.clientWidth - 32) / folha.offsetWidth);
      folha.style.setProperty('--zoom', String(Math.max(0.3, z)));
    }
    caber();
    addEventListener('resize', caber);
  });
})();
