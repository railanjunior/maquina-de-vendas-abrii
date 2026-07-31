/* =========================================================================
   Formulario de pre-cadastro.

   Ordem sagrada do submit:
     1. grava no dispositivo   (LeadQueue.enqueue)
     2. so entao tenta a rede  (LeadQueue.flush)
   Assim, mesmo que o wi-fi do evento morra no meio, o cadastro existe e sobe
   sozinho depois.
   ========================================================================= */

(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var form = $('#leadForm');
  var formCard = $('#formCard');
  var successCard = $('#successCard');
  var btnNext = $('#btnNext');
  var btnBack = $('#btnBack');
  var btnSubmit = $('#btnSubmit');
  var steps = $$('.step');
  var TOTAL = steps.length;

  // cfg é o perfil normalizado (perfil.json + variáveis de ambiente).
  var state = { step: 1, cfg: { organizador: {}, textos: {} }, lastLead: null, deferredPrompt: null };

  /* ---------------------------------------------------------------- utils */

  function uuid() {
    if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
    return 'lead-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function digits(value) { return String(value || '').replace(/\D/g, ''); }

  /** Mesmas regras do servidor: devolve E.164 ou string vazia. */
  function normalizeWhatsapp(input) {
    var d = digits(input);
    if (!d) return '';
    if (d.length > 11 && d.charAt(0) === '0') d = d.replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (d.length < 12 || d.length > 15) return '';
    return d;
  }

  function maskPhone(value) {
    var d = digits(value).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function setInvalid(name, invalid, message) {
    var field = $('.field[data-for="' + name + '"]');
    if (!field) return;
    field.classList.toggle('invalid', !!invalid);
    if (message) {
      var msg = $('.error-msg', field);
      if (msg) msg.textContent = message;
    }
  }

  function notice(target, kind, html) {
    var el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    el.innerHTML = html ? '<div class="notice notice--' + kind + '">' + html + '</div>' : '';
  }

  /* ----------------------------------------------------------- navegacao */

  function renderStep() {
    steps.forEach(function (el) {
      el.classList.toggle('active', Number(el.dataset.step) === state.step);
    });
    $('#progressBar').style.width = Math.round((state.step / TOTAL) * 100) + '%';
    $('#progressCount').textContent = state.step + '/' + TOTAL;

    btnBack.style.display = state.step > 1 ? '' : 'none';
    var last = state.step === TOTAL;
    btnNext.style.display = last ? 'none' : '';
    btnSubmit.style.display = last ? '' : 'none';

    var firstInput = $('.step.active .input');
    if (firstInput && !('ontouchstart' in window)) firstInput.focus();
    formCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function validateStep(step) {
    var ok = true;

    if (step === 1) {
      var name = $('#name').value.trim();
      var badName = name.length < 2;
      setInvalid('name', badName);
      if (badName) ok = false;

      var badPhone = !normalizeWhatsapp($('#whatsapp').value);
      setInvalid('whatsapp', badPhone);
      if (badPhone) ok = false;
    }

    if (step === 2) {
      var email = $('#email').value.trim();
      var badEmail = email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      setInvalid('email', badEmail);
      if (badEmail) ok = false;
    }

    if (step === 3) {
      var badConsent = !$('#consentGroup').checked;
      setInvalid('consentGroup', badConsent);
      if (badConsent) ok = false;
    }

    if (!ok) {
      var firstBad = $('.step.active .field.invalid');
      if (firstBad) firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (navigator.vibrate) navigator.vibrate(35);
    }
    return ok;
  }

  btnNext.addEventListener('click', function () {
    if (!validateStep(state.step)) return;
    state.step = Math.min(TOTAL, state.step + 1);
    renderStep();
  });

  btnBack.addEventListener('click', function () {
    state.step = Math.max(1, state.step - 1);
    renderStep();
  });

  // Enter avanca em vez de enviar o formulario cedo demais.
  form.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || ev.target.tagName === 'TEXTAREA') return;
    ev.preventDefault();
    if (state.step < TOTAL) btnNext.click();
    else btnSubmit.click();
  });

  $('#whatsapp').addEventListener('input', function (ev) {
    var el = ev.target;
    var atEnd = el.selectionStart === el.value.length;
    el.value = maskPhone(el.value);
    if (atEnd) el.setSelectionRange(el.value.length, el.value.length);
    if (el.closest('.field').classList.contains('invalid')) validateStep(1);
  });

  ['name', 'email'].forEach(function (id) {
    $('#' + id).addEventListener('blur', function () {
      var field = $('#' + id).closest('.field');
      if (field.classList.contains('invalid')) validateStep(state.step);
    });
  });

  $('#consentGroup').addEventListener('change', function () {
    if ($('#consentGroup').checked) setInvalid('consentGroup', false);
  });

  /* -------------------------------------------------------------- submit */

  function collectLead() {
    var params = new URLSearchParams(location.search);
    return {
      id: uuid(),
      name: $('#name').value.trim(),
      whatsapp: normalizeWhatsapp($('#whatsapp').value),
      email: $('#email').value.trim(),
      company: $('#company').value.trim(),
      role: $('#role').value.trim(),
      instagram: $('#instagram').value.trim(),
      interests: $$('#interestChips input:checked').map(function (el) { return el.value; }),
      challenge: $('#challenge').value.trim(),
      consentGroup: $('#consentGroup').checked,
      consentContact: $('#consentContact').checked,
      website: $('#website').value,
      source: (params.get('src') || params.get('utm_source') || 'direto').slice(0, 40),
      clientCreatedAt: new Date().toISOString(),
    };
  }

  function setSubmitting(on) {
    btnSubmit.disabled = on;
    btnSubmit.innerHTML = on
      ? '<span class="spinner"></span>Salvando…'
      : 'Confirmar cadastro';
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!validateStep(3)) return;

    var lead = collectLead();
    state.lastLead = lead;
    setSubmitting(true);
    notice('#formNotice', 'ok', '');

    // 1) Persistir localmente. Daqui em diante o dado nao se perde.
    LeadQueue.enqueue(lead)
      .then(function () { return LeadQueue.flush(); })
      .then(function () { return LeadQueue.all(); })
      .then(function (records) {
        var mine = records.filter(function (r) { return r.id === lead.id; })[0];
        var status = mine ? mine.status : 'pending';

        if (status === 'invalid') {
          setSubmitting(false);
          notice('#formNotice', 'err', (mine && mine.lastError) || 'Revise os dados e tente de novo.');
          return;
        }
        showSuccess(status === 'sent');
      })
      .catch(function (err) {
        // Nem o armazenamento local respondeu: ainda assim damos a saida pelo
        // WhatsApp para o contato nao evaporar.
        showSuccess(false);
      })
      .then(function () { refreshQueueBadge(); });
  });

  function whatsappFallbackUrl(lead) {
    var phone = state.cfg.organizador.whatsapp;
    if (!phone || !lead) return '';
    var lines = [
      'Pre-cadastro ' + (state.cfg.evento || 'do evento') + ':',
      'Nome: ' + lead.name,
      'WhatsApp: +' + lead.whatsapp,
    ];
    if (lead.email) lines.push('E-mail: ' + lead.email);
    if (lead.company) lines.push('Empresa: ' + lead.company);
    if (lead.role) lines.push('Papel: ' + lead.role);
    if (lead.instagram) lines.push('Instagram: @' + lead.instagram);
    if (lead.interests && lead.interests.length) lines.push('Interesses: ' + lead.interests.join(', '));
    if (lead.challenge) lines.push('Desafio: ' + lead.challenge);
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  function showSuccess(synced) {
    formCard.style.display = 'none';
    // O cartão do topo sai de cena: a versão completa dele vive dentro da
    // confirmação, e duas cópias na mesma tela ficam redundantes.
    $('#perfilCard').style.display = 'none';
    successCard.style.display = '';
    // A tela de sucesso já tem o botão de instalar; a barra viraria repetição.
    $('#installBar').classList.remove('show');
    if (navigator.vibrate) navigator.vibrate([20, 40, 25]);

    var firstName = (state.lastLead && state.lastLead.name || '').split(' ')[0];

    if (synced) {
      $('#successTitle').textContent = firstName ? 'Fechou, ' + firstName + '!' : 'Você está dentro.';
      $('#successMsg').textContent = 'Cadastro confirmado e salvo. Já já a gente se fala.';
      $('#successExtra').innerHTML = '';
    } else {
      $('#successTitle').textContent = 'Salvo no seu celular.';
      $('#successMsg').textContent = 'A internet aqui está instável, mas seu cadastro já está guardado.';
      var wa = whatsappFallbackUrl(state.lastLead);
      $('#successExtra').innerHTML =
        '<div class="notice notice--warn" style="text-align:left">' +
        '<span>⚡</span><div><b>Envio automático ativo.</b> Assim que a conexão voltar, seu cadastro sobe sozinho — ' +
        'não precisa fazer nada. Se quiser garantir agora, manda pelo WhatsApp abaixo.</div></div>' +
        (wa ? '<a class="btn btn--wa" style="margin-bottom:10px" href="' + wa + '" target="_blank" rel="noopener">Garantir agora pelo WhatsApp</a>' : '');
      // Continua tentando em background enquanto a tela estiver aberta.
      scheduleRetries();
    }

    // Entrar no grupo é a ação principal da tela.
    var btnGroup = $('#btnGroup');
    if (state.cfg.grupoWhatsapp) {
      btnGroup.href = state.cfg.grupoWhatsapp;
      btnGroup.style.display = '';
    }

    // Troca de mão dupla: ela acabou de me dar os dados dela, agora leva os meus.
    var alvoPerfil = $('#perfilCardSucesso');
    if (alvoPerfil && !alvoPerfil.innerHTML) {
      alvoPerfil.innerHTML = Perfil.cardHtml(state.cfg, 'completo');
      Perfil.ligarBotoesSalvar(state.cfg, alvoPerfil);
    }

    successCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  $('#btnAgain').addEventListener('click', function () {
    form.reset();
    $$('.field').forEach(function (f) { f.classList.remove('invalid'); });
    $('#interestChips input[value="grupo-evento"]').checked = true;
    notice('#formNotice', 'ok', '');
    setSubmitting(false);
    state.step = 1;
    state.lastLead = null;
    successCard.style.display = 'none';
    formCard.style.display = '';
    $('#perfilCard').style.display = '';
    renderStep();
  });

  /* -------------------------------------------------- fila / reenvio auto */

  var retryTimer = null;

  function scheduleRetries() {
    if (retryTimer) return;
    retryTimer = setInterval(function () {
      LeadQueue.flush().then(function (result) {
        refreshQueueBadge();
        if (result.sent > 0 && successCard.style.display !== 'none' && state.lastLead) {
          LeadQueue.all().then(function (records) {
            var mine = records.filter(function (r) { return r.id === state.lastLead.id; })[0];
            if (mine && mine.status === 'sent') {
              clearInterval(retryTimer); retryTimer = null;
              showSuccess(true);
            }
          });
        }
      });
    }, 12000);
  }

  function refreshQueueBadge() {
    return LeadQueue.stats().then(function (s) {
      var badge = $('#queueBadge');
      if (!badge) return s;
      if (s.pending > 0) {
        badge.innerHTML = '⏳ ' + s.pending + ' cadastro(s) aguardando envio · ' +
          '<a href="#" id="btnFlushNow">tentar agora</a>';
        var link = $('#btnFlushNow');
        if (link) {
          link.addEventListener('click', function (ev) {
            ev.preventDefault();
            link.textContent = 'enviando…';
            LeadQueue.flush().then(refreshQueueBadge);
          });
        }
        scheduleRetries();
      } else {
        badge.textContent = '';
      }
      return s;
    });
  }

  window.addEventListener('online', function () { LeadQueue.flush().then(refreshQueueBadge); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) LeadQueue.flush().then(refreshQueueBadge);
  });

  /* ----------------------------------------------------- instalar na tela */

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  var IOS_STEPS =
    '<ol><li>Toque no botão <b>Compartilhar</b> (o quadrado com a seta para cima), na barra do Safari.</li>' +
    '<li>Role a lista e escolha <b>Adicionar à Tela de Início</b>.</li>' +
    '<li>Confirme em <b>Adicionar</b>. Pronto — vira um ícone igual app.</li></ol>';
  var ANDROID_STEPS =
    '<ol><li>Toque no menu <b>⋮</b> do navegador.</li>' +
    '<li>Escolha <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>.</li>' +
    '<li>Confirme. Pronto — vira um ícone igual app.</li></ol>';

  function openInstallModal() {
    $('#installSteps').innerHTML = isIOS() ? IOS_STEPS : ANDROID_STEPS;
    $('#installModal').classList.add('show');
  }

  $$('#installModal [data-close]').forEach(function (el) {
    el.addEventListener('click', function () { $('#installModal').classList.remove('show'); });
  });

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    state.deferredPrompt = ev;
    if (!isStandalone() && localStorage.getItem('adapta.install.dismissed') !== '1') {
      $('#installBar').classList.add('show');
    }
  });

  function triggerInstall() {
    if (state.deferredPrompt) {
      state.deferredPrompt.prompt();
      state.deferredPrompt.userChoice.finally(function () {
        state.deferredPrompt = null;
        $('#installBar').classList.remove('show');
      });
    } else {
      openInstallModal();
    }
  }

  $('#btnInstall').addEventListener('click', triggerInstall);
  $('#btnInstall2').addEventListener('click', triggerInstall);
  $('#btnInstallClose').addEventListener('click', function () {
    $('#installBar').classList.remove('show');
    try { localStorage.setItem('adapta.install.dismissed', '1'); } catch (e) { /* modo anônimo */ }
  });

  // iOS não dispara beforeinstallprompt: mostramos a dica manualmente.
  if (isIOS() && !isStandalone()) {
    try {
      if (localStorage.getItem('adapta.install.dismissed') !== '1') {
        $('#installBar').classList.add('show');
      }
    } catch (e) { $('#installBar').classList.add('show'); }
  }
  if (isStandalone()) $('#btnInstall2').style.display = 'none';

  /* ------------------------------------------------------- service worker */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        // Background Sync: reenvia a fila mesmo com a aba fechada.
        if ('sync' in reg) {
          reg.sync.register('flush-leads').catch(function () { /* sem permissão, seguimos com os timers */ });
        }
      }).catch(function () { /* SW é bônus, não requisito */ });
    });
  }

  /* --------------------------------------------------------------- boot */

  $('#btnShowQr').addEventListener('click', function () { location.href = '/qr'; });

  Perfil.load().then(function (cfg) {
    state.cfg = cfg;

    $('#eventLabel').textContent = cfg.evento;
    document.title = 'Conexão · ' + cfg.evento;
    $('#tituloLinha1').textContent = cfg.textos.tituloLinha1;
    $('#tituloLinha2').textContent = cfg.textos.tituloLinha2;
    if (cfg.textos.subtitulo) $('#subtitulo').textContent = cfg.textos.subtitulo;

    // O cartão de quem convidou aparece antes do formulário: a pessoa sabe
    // com quem está falando antes de entregar os dados dela.
    var alvo = $('#perfilCard');
    alvo.innerHTML = Perfil.cardHtml(cfg, 'compacto');
    Perfil.ligarBotoesSalvar(cfg, alvo);

    if (!cfg.storageReady) {
      notice('#formNotice', 'warn',
        'Modo de contingência: os cadastros estão sendo guardados no aparelho e sobem assim que o servidor for configurado.');
    }
  });

  renderStep();
  LeadQueue.prune(30);
  LeadQueue.flush().then(refreshQueueBadge);
})();
