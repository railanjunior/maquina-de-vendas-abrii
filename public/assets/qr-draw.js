/* =========================================================================
   Desenho do QR Code em canvas.

   Módulos quadrados e sólidos de propósito: leitor de câmera barato, em luz
   ruim de salão de evento, erra com módulo arredondado. O gradiente vai só
   na cor, que continua escura o bastante para o contraste do padrão.
   ========================================================================= */

(function (scope) {
  'use strict';

  var QUIET = 4; // zona de silêncio exigida pela especificação

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {string} texto conteúdo do QR (aqui, a URL do formulário)
   * @param {number} [escala] pixels por módulo; calculado se omitido
   */
  function desenhar(canvas, texto, escala) {
    var qr = qrcode(0, 'M'); // 0 = versão automática
    qr.addData(texto);
    qr.make();

    var modulos = qr.getModuleCount();
    var total = modulos + QUIET * 2;
    var px = escala || Math.max(4, Math.floor(1024 / total));
    var lado = total * px;

    canvas.width = lado;
    canvas.height = lado;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lado, lado);

    var grad = ctx.createLinearGradient(0, 0, lado, lado);
    grad.addColorStop(0, '#12307f');
    grad.addColorStop(0.55, '#3a1f8a');
    grad.addColorStop(1, '#9c0b2c');
    ctx.fillStyle = grad;

    for (var r = 0; r < modulos; r++) {
      for (var c = 0; c < modulos; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + QUIET) * px, (r + QUIET) * px, px, px);
      }
    }
  }

  scope.QrDraw = { desenhar: desenhar };
})(typeof self !== 'undefined' ? self : this);
