/* =========================================================================
   Tela de QR em tela cheia.

   É a tela que o organizador vira para a pessoa: "aponta a câmera aí".
   Pública de propósito — o conteúdo do QR é só o link do formulário, não há
   nada a proteger, e exigir PIN aqui atrapalharia justo no momento de uso.
   ========================================================================= */

(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  function urlFormulario() {
    return location.origin + '/?src=qr';
  }

  function render() {
    var url = urlFormulario();
    $('#qrUrl').textContent = url.replace(/^https?:\/\//, '');
    QrDraw.desenhar($('#qrCanvas'), url);
  }

  // Mantém a tela acesa enquanto o QR está exposto — nada pior que o
  // celular apagar bem na hora que a pessoa vai escanear.
  var wakeLock = null;
  function segurarTela() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen')
      .then(function (lock) { wakeLock = lock; })
      .catch(function () { /* negado ou sem suporte */ });
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !wakeLock) segurarTela();
  });

  $('#btnVoltar').addEventListener('click', function () {
    if (history.length > 1) history.back();
    else location.href = '/';
  });

  $('#btnCompartilhar').addEventListener('click', function () {
    var btn = $('#btnCompartilhar');
    var url = urlFormulario();
    if (navigator.share) {
      navigator.share({ title: document.title, url: url }).catch(function () { /* cancelado */ });
      return;
    }
    var copiar = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(url)
      : Promise.reject();
    copiar.then(function () {
      btn.textContent = '✓ Link copiado';
      setTimeout(function () { btn.textContent = 'Compartilhar link'; }, 1800);
    }).catch(function () {
      window.prompt('Copie o link:', url);
    });
  });

  render();
  segurarTela();

  Perfil.load().then(function (cfg) {
    $('#eventLabel').textContent = cfg.evento;
    document.title = 'Aponte a câmera · ' + cfg.evento;
    if (cfg.organizador.nome) {
      var primeiro = cfg.organizador.nome.split(' ')[0];
      $('#qrChamada').textContent = 'e fale com ' + primeiro;
    }
    if (cfg.grupoWhatsapp) {
      $('#qrSub').textContent = 'Pré-cadastro de 30 segundos e entrada no grupo oficial do ' + cfg.evento + '.';
    }
  });
})();
