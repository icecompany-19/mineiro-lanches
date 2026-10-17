/* Mineiro Lanche · entregador: leitor de QR da comanda pela câmera do aparelho.
   - A câmera só abre por toque (iniciar() é chamado do clique do botão) e fecha sozinha ao ler, ao esconder a aba
     (visibilitychange) e no pagehide: nada de câmera ligada em segundo plano.
   - O vídeo é sempre <video playsinline muted autoplay> com srcObject (nunca createObjectURL: a CSP é media-src 'self').
   - Cada quadro vai para um canvas de no máximo 640 px e o jsQR (import dinâmico: chunk à parte, só baixado aqui)
     procura o QR. Laço de ~120 ms com setTimeout; inversionAttempts 'dontInvert' (a comanda é preta sobre branco).
   - Do texto lido sai SÓ o uuid do pedido, por regex. A URL lida nunca é aberta nem seguida: o que vale é o login
     do entregador na RPC, não o conteúdo do QR. */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LADO_MAX = 640; // maior lado do canvas de leitura
const INTERVALO_MS = 120;

// uuid (em minúsculas) de dentro de qualquer texto, ou null
export function uuidDoTexto(texto) {
  const m = UUID.exec(String(texto == null ? '' : texto));
  return m ? m[0].toLowerCase() : null;
}

const ALTERNATIVA = 'Leia o QR com a câmera do celular ou confirme pela lista Em rota.';
export const MENSAGENS_CAMERA = {
  permissao: 'A câmera está bloqueada para este site. Libere a câmera nas configurações do navegador. ' + ALTERNATIVA,
  sem_camera: 'Este aparelho não tem uma câmera disponível. ' + ALTERNATIVA,
  ocupada: 'A câmera está em uso por outro app. Feche o outro app e tente de novo. ' + ALTERNATIVA,
  leitor: 'Não foi possível carregar o leitor de QR. Confira a internet e tente de novo. ' + ALTERNATIVA,
  generico: 'Não foi possível abrir a câmera. ' + ALTERNATIVA
};

function erroLeitor(codigo, causa) {
  const e = new Error(codigo);
  e.codigo = codigo;
  e.mensagem = MENSAGENS_CAMERA[codigo] || MENSAGENS_CAMERA.generico;
  e.causa = causa;
  return e;
}

function codigoDaCamera(e) {
  const nome = (e && e.name) || '';
  if (/NotAllowed|Security|PermissionDenied/i.test(nome)) return 'permissao';
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(nome)) return 'sem_camera';
  if (/NotReadable|TrackStart|Abort/i.test(nome)) return 'ocupada';
  return 'generico';
}

function pararFaixas(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* já parada */
    }
  });
}

/* opc: { video, canvas, aoLer(uuid), aoNaoComanda(), aoParar(motivo) }
   aoLer: leu um QR com um uuid (o laço e as faixas já foram parados).
   aoNaoComanda: leu um QR sem uuid; o laço continua. aoParar('oculto'): a câmera foi desligada porque a aba saiu da tela. */
export function criarLeitor(opc) {
  const { video, canvas } = opc;
  let ctx2d = null;
  let stream = null;
  let jsQR = null;
  let timer = 0;
  let ativo = false;
  let geracao = 0; // cada iniciar() ganha um número; parar() invalida o pedido que ainda espera a permissão
  let ultimoTexto = '';

  function quadro() {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const k = Math.min(1, LADO_MAX / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * k));
    const h = Math.max(1, Math.round(video.videoHeight * k));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (!ctx2d) ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    ctx2d.drawImage(video, 0, 0, w, h);
    const img = ctx2d.getImageData(0, 0, w, h);
    const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    return r && r.data ? String(r.data) : null;
  }

  function agendar() {
    timer = setTimeout(passo, INTERVALO_MS);
  }

  function passo() {
    timer = 0;
    if (!ativo) return;
    let texto = null;
    try {
      texto = quadro();
    } catch {
      /* quadro ruim: o próximo resolve */
    }
    if (texto != null) {
      const id = uuidDoTexto(texto);
      if (id) {
        parar();
        opc.aoLer(id);
        return;
      }
      // QR de outra coisa: avisa uma vez por texto e segue procurando
      if (texto !== ultimoTexto) {
        ultimoTexto = texto;
        if (opc.aoNaoComanda) opc.aoNaoComanda();
      }
    }
    agendar();
  }

  function aoOcultar() {
    if (document.visibilityState === 'hidden') {
      parar();
      if (opc.aoParar) opc.aoParar('oculto');
    }
  }
  function aoSair() {
    parar();
    if (opc.aoParar) opc.aoParar('oculto');
  }

  // Para o laço e as faixas da câmera. Seguro de chamar a qualquer hora, inclusive duas vezes.
  function parar() {
    geracao++;
    ativo = false;
    if (timer) clearTimeout(timer);
    timer = 0;
    document.removeEventListener('visibilitychange', aoOcultar);
    window.removeEventListener('pagehide', aoSair);
    pararFaixas(stream);
    stream = null;
    try {
      video.pause();
    } catch {
      /* sem vídeo */
    }
    video.srcObject = null;
  }

  // Pede a câmera e começa a ler. Rejeita com Error { codigo, mensagem } (permissão, sem câmera, em uso, leitor).
  async function iniciar() {
    if (ativo) return;
    const minha = ++geracao;
    ativo = true;
    ultimoTexto = '';
    const md = navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') {
      ativo = false;
      throw erroLeitor('sem_camera');
    }
    const pedidoQr = import('jsqr'); // baixa junto com o pedido de permissão
    pedidoQr.catch(() => {});
    let obtido;
    try {
      obtido = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    } catch (e) {
      if (minha === geracao) ativo = false;
      throw erroLeitor(codigoDaCamera(e), e);
    }
    if (minha !== geracao) {
      pararFaixas(obtido); // fechado enquanto a permissão estava na tela
      return;
    }
    let modulo;
    try {
      modulo = await pedidoQr;
    } catch (e) {
      pararFaixas(obtido);
      if (minha === geracao) ativo = false;
      throw erroLeitor('leitor', e);
    }
    if (minha !== geracao) {
      pararFaixas(obtido);
      return;
    }
    jsQR = modulo.default || modulo;
    stream = obtido;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    document.addEventListener('visibilitychange', aoOcultar);
    window.addEventListener('pagehide', aoSair);
    // sem await: o play() só resolve com o primeiro quadro; o laço já espera os quadros chegarem
    const tocando = video.play();
    if (tocando && tocando.catch) tocando.catch(() => {});
    agendar();
  }

  return {
    iniciar,
    parar,
    get ativo() {
      return ativo;
    }
  };
}
