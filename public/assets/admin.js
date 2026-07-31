/* =========================================================================
   Painel administrativo: QR do evento, lista ao vivo e exportacoes.

   O painel mantem um espelho local de tudo que ja leu. Se a rede cair no meio
   do evento, os contatos continuam visiveis e exportaveis.
   ========================================================================= */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var PIN_KEY = 'adapta.admin.pin';
  var CACHE_KEY = 'adapta.admin.cache.v1';

  var state = { pin: '', leads: [], eventName: 'Evento', cachedAt: null, fromCache: false };

  var LABELS = {
    'grupo-evento': 'Grupo do evento',
    'automacao-ia': 'Automação com IA',
    'maquina-de-vendas': 'Máquina de vendas',
    'trafego-pago': 'Tráfego pago',
    consultoria: 'Consultoria',
    parceria: 'Parceria',
  };
  // Interesses que indicam intencao comercial, nao so networking.
  var HOT = ['automacao-ia', 'maquina-de-vendas', 'trafego-pago', 'consultoria', 'parceria'];

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* modo anônimo */ }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function notice(sel, kind, html) {
    var el = $(sel);
    if (el) el.innerHTML = html ? '<div class="notice notice--' + kind + '">' + html + '</div>' : '';
  }

  function api(path, options) {
    var opts = options || {};
    opts.headers = Object.assign({ 'x-admin-pin': state.pin }, opts.headers || {});
    opts.cache = 'no-store';
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, ok: res.ok, body: body };
      });
    });
  }

  /* ------------------------------------------------------------- entrada */

  function showPanel() {
    $('#gate').style.display = 'none';
    $('#panel').style.display = '';
    renderQr();
    loadHealth();
    loadLeads();
    setInterval(loadLeads, 30000);
  }

  $('#pinForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pin = $('#pin').value.trim();
    if (!pin) return;
    var btn = $('#btnEnter');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Verificando…';
    state.pin = pin;

    api('/api/leads').then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Entrar';
      if (res.status === 401) {
        $('.field[data-for="pin"]').classList.add('invalid');
        return;
      }
      if (res.status === 503) {
        notice('#gateNotice', 'warn', esc(res.body.error || 'Configuração pendente no servidor.'));
        // 503 do /api/leads significa configuração faltando, não PIN errado:
        // deixamos entrar para o painel mostrar o diagnóstico completo.
        if (res.body.code === 'SEM_REDIS') { store(PIN_KEY, pin); showPanel(); }
        return;
      }
      store(PIN_KEY, pin);
      applyLeads(res.body.leads || []);
      showPanel();
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = 'Entrar';
      notice('#gateNotice', 'err', 'Sem conexão com o servidor.');
    });
  });

  $('#btnLogout').addEventListener('click', function () {
    store(PIN_KEY, null);
    location.reload();
  });

  $('#btnRefresh').addEventListener('click', function () { loadLeads(true); });

  /* -------------------------------------------------------------- leads */

  function applyLeads(leads) {
    state.leads = leads;
    state.cachedAt = new Date().toISOString();
    state.fromCache = false;
    store(CACHE_KEY, JSON.stringify({ at: state.cachedAt, leads: leads }));
    render();
  }

  function loadFromCache() {
    try {
      var raw = read(CACHE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      state.leads = parsed.leads || [];
      state.cachedAt = parsed.at;
      state.fromCache = true;
      render();
      return true;
    } catch (e) { return false; }
  }

  function loadLeads(loud) {
    if (loud) $('#btnRefresh').textContent = '↻ Atualizando…';
    return api('/api/leads').then(function (res) {
      $('#btnRefresh').textContent = '↻ Atualizar';
      if (res.ok && res.body.ok) {
        notice('#panelNotice', 'ok', '');
        applyLeads(res.body.leads || []);
        return;
      }
      if (res.status === 401) { store(PIN_KEY, null); location.reload(); return; }
      notice('#panelNotice', 'warn', esc(res.body.error || 'Não foi possível atualizar agora.') +
        ' Mostrando a última cópia salva neste aparelho.');
      loadFromCache();
    }).catch(function () {
      $('#btnRefresh').textContent = '↻ Atualizar';
      notice('#panelNotice', 'warn',
        'Sem conexão. Mostrando a última cópia salva neste aparelho — nada foi perdido.');
      loadFromCache();
    });
  }

  /* ------------------------------------------------------------ render */

  function isToday(iso) {
    if (!iso) return false;
    var d = new Date(iso);
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function when(lead) { return lead.clientCreatedAt || lead.createdAt; }

  function timeLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return mins + ' min';
    if (isToday(iso)) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderStats() {
    var leads = state.leads;
    var hoje = leads.filter(function (l) { return isToday(when(l)); }).length;
    var grupo = leads.filter(function (l) { return (l.interests || []).indexOf('grupo-evento') >= 0; }).length;
    var quentes = leads.filter(function (l) {
      return l.consentContact || (l.interests || []).some(function (i) { return HOT.indexOf(i) >= 0; });
    }).length;

    $('#stats').innerHTML =
      stat(leads.length, 'Total') +
      stat(hoje, 'Hoje') +
      stat(grupo, 'Querem o grupo') +
      stat(quentes, 'Leads quentes');
  }

  function stat(value, label) {
    return '<div class="stat"><b class="gradient-text">' + value + '</b><span>' + label + '</span></div>';
  }

  function filtered() {
    var q = $('#search').value.trim().toLowerCase();
    var interest = $('#filterInterest').value;
    return state.leads.filter(function (l) {
      if (interest && (l.interests || []).indexOf(interest) < 0) return false;
      if (!q) return true;
      return [l.name, l.company, l.role, l.email, l.whatsapp, l.whatsappDisplay, l.instagram, l.challenge]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function render() {
    renderStats();
    var rows = filtered();
    var list = $('#leadList');

    if (!rows.length) {
      list.innerHTML = '<div class="empty">' +
        (state.leads.length ? 'Nenhum contato bate com esse filtro.'
          : 'Nenhum contato ainda.<br><span class="tiny">Mostre o QR Code e os cadastros aparecem aqui na hora.</span>') +
        '</div>';
      return;
    }

    list.innerHTML = rows.map(function (l) {
      var meta = [l.company, l.role].filter(Boolean).join(' · ');
      var contato = [l.whatsappDisplay || ('+' + l.whatsapp), l.email, l.instagram ? '@' + l.instagram : '']
        .filter(Boolean).join('  ·  ');
      var tags = (l.interests || []).map(function (i) {
        var hot = HOT.indexOf(i) >= 0;
        return '<span class="tag' + (hot ? ' tag--hot' : '') + '">' + esc(LABELS[i] || i) + '</span>';
      }).join('');
      if (l.consentContact) tags += '<span class="tag tag--hot">Aceita oferta</span>';

      return '<article class="lead">' +
        '<div class="lead-head"><span class="lead-name">' + esc(l.name) + '</span>' +
        '<span class="lead-when">' + esc(timeLabel(when(l))) + '</span></div>' +
        (meta ? '<div class="lead-meta">' + esc(meta) + '</div>' : '') +
        '<div class="lead-meta">' + esc(contato) + '</div>' +
        (tags ? '<div class="tags">' + tags + '</div>' : '') +
        (l.challenge ? '<div class="lead-challenge">' + esc(l.challenge) + '</div>' : '') +
        '<div class="lead-actions">' +
        '<a class="mini mini--wa" href="https://wa.me/' + esc(l.whatsapp) + '" target="_blank" rel="noopener">Abrir WhatsApp</a>' +
        '<button class="mini" data-copy="' + esc(l.whatsapp) + '">Copiar número</button>' +
        '<button class="mini mini--danger" data-del="' + esc(l.id) + '">Excluir</button>' +
        '</div></article>';
    }).join('');

    $$('#leadList [data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copy('+' + btn.dataset.copy).then(function () { flash(btn, 'Copiado!'); });
      });
    });
    $$('#leadList [data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Excluir este contato em definitivo?')) return;
        btn.disabled = true;
        api('/api/leads?id=' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' })
          .then(function () { loadLeads(); })
          .catch(function () { btn.disabled = false; });
      });
    });
  }

  $('#search').addEventListener('input', render);
  $('#filterInterest').addEventListener('change', render);

  function flash(btn, text) {
    var original = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { btn.textContent = original; }, 1400);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* sem suporte */ }
      document.body.removeChild(ta);
      resolve();
    });
  }

  /* ---------------------------------------------------------------- QR */

  function formUrl() { return location.origin + '/?src=qr'; }

  // O desenho vive em assets/qr-draw.js, compartilhado com a tela /qr.

  function renderQr() {
    var url = formUrl();
    $('#formUrl').textContent = url;
    $('#totemUrl').textContent = url;
    QrDraw.desenhar($('#qrCanvas'), url);
    QrDraw.desenhar($('#qrCanvasBig'), url);
  }

  $('#btnCopyLink').addEventListener('click', function () {
    copy(formUrl()).then(function () { flash($('#btnCopyLink'), 'Copiado!'); });
  });

  $('#btnDownloadQr').addEventListener('click', function () {
    $('#qrCanvas').toBlob(function (blob) {
      download(blob, 'qrcode-' + slug(state.eventName) + '.png');
    }, 'image/png');
  });

  $('#btnTotem').addEventListener('click', function () {
    $('#totem').classList.add('show');
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () { /* negado, tudo bem */ });
    }
  });
  $('#btnTotemExit').addEventListener('click', function () {
    $('#totem').classList.remove('show');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') $('#totem').classList.remove('show');
  });

  /* --------------------------------------------------------- exportacao */

  function slug(text) {
    return String(text || 'evento').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function download(blobOrText, filename, mime) {
    var blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    // Excel/Sheets interpretam celulas iniciadas por = + - @ como formula.
    // Como nome e desafio sao texto livre digitado por terceiros, neutralizamos.
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[";\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  $('#btnCsv').addEventListener('click', function () {
    var header = ['Nome', 'WhatsApp', 'E-mail', 'Empresa', 'Cargo', 'Instagram',
      'Interesses', 'Desafio', 'Quer grupo', 'Aceita contato comercial', 'Origem', 'Data/hora'];
    var rows = state.leads.map(function (l) {
      return [
        // Sem o "+" na frente: o Excel trataria a celula como formula. O
        // formato com espacos e parenteses ja garante que fique como texto.
        l.name, String(l.whatsappDisplay || l.whatsapp).replace(/^\+/, ''),
        l.email, l.company, l.role,
        l.instagram ? '@' + l.instagram : '',
        (l.interests || []).map(function (i) { return LABELS[i] || i; }).join(' | '),
        l.challenge,
        (l.interests || []).indexOf('grupo-evento') >= 0 ? 'sim' : 'não',
        l.consentContact ? 'sim' : 'não',
        l.source,
        new Date(when(l)).toLocaleString('pt-BR'),
      ].map(csvCell).join(';');
    });
    // BOM + separador ";" para o Excel brasileiro abrir sem gambiarra.
    download('﻿' + [header.join(';')].concat(rows).join('\r\n'),
      'contatos-' + slug(state.eventName) + '.csv', 'text/csv;charset=utf-8');
  });

  function vcardEscape(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  $('#btnVcf').addEventListener('click', function () {
    var tag = state.eventName.split(' ')[0];
    var cards = state.leads.map(function (l) {
      var parts = String(l.name || '').trim().split(/\s+/);
      var first = parts.shift() || '';
      var last = parts.join(' ');
      var note = [];
      if (l.role) note.push('Cargo: ' + l.role);
      if ((l.interests || []).length) {
        note.push('Interesses: ' + l.interests.map(function (i) { return LABELS[i] || i; }).join(', '));
      }
      if (l.challenge) note.push('Desafio: ' + l.challenge);
      if (l.instagram) note.push('Instagram: @' + l.instagram);
      note.push('Origem: ' + (l.source || 'direto') + ' — ' + new Date(when(l)).toLocaleString('pt-BR'));

      var lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:' + vcardEscape(last) + ';' + vcardEscape(first) + ';;;',
        // O sufixo agrupa os contatos na agenda do celular, facilitando montar
        // o grupo do WhatsApp depois.
        'FN:' + vcardEscape(l.name + ' [' + tag + ']'),
        'TEL;TYPE=CELL:+' + l.whatsapp,
      ];
      if (l.email) lines.push('EMAIL;TYPE=INTERNET:' + vcardEscape(l.email));
      if (l.company) lines.push('ORG:' + vcardEscape(l.company));
      if (l.role) lines.push('TITLE:' + vcardEscape(l.role));
      lines.push('CATEGORIES:' + vcardEscape(tag));
      lines.push('NOTE:' + vcardEscape(note.join(' | ')));
      lines.push('END:VCARD');
      return lines.join('\r\n');
    });
    download(cards.join('\r\n') + '\r\n', 'contatos-' + slug(state.eventName) + '.vcf', 'text/vcard;charset=utf-8');
  });

  $('#btnPhones').addEventListener('click', function () {
    var phones = state.leads.map(function (l) { return '+' + l.whatsapp; }).join('\n');
    copy(phones).then(function () { flash($('#btnPhones'), '✓ ' + state.leads.length + ' números copiados'); });
  });

  $('#btnJson').addEventListener('click', function () {
    download(JSON.stringify({ evento: state.eventName, exportadoEm: new Date().toISOString(), leads: state.leads }, null, 2),
      'backup-' + slug(state.eventName) + '.json', 'application/json');
  });

  /* -------------------------------------------------------------- saude */

  function loadHealth() {
    fetch('/api/health', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (h) {
        state.eventName = h.evento || state.eventName;
        $('#eventLabel').textContent = state.eventName;
        var flags = h.flags || {};
        var rows = [
          linha('Banco (Redis)', h.armazenamento.redis, flags.redis),
          linha('Planilha (Sheets)', h.armazenamento.sheets, flags.sheets),
          linha('Grupo do WhatsApp', h.grupoWhatsapp, flags.grupoWhatsapp),
          linha('WhatsApp de resgate', h.whatsappOrganizador, flags.whatsappOrganizador),
        ].join('');
        var pend = (h.pendencias || []).length
          ? '<div class="notice notice--warn" style="margin-top:10px;display:block">' +
            (h.pendencias || []).map(esc).join('<br>') + '</div>'
          : '<div class="notice notice--ok" style="margin-top:10px;display:block">Tudo configurado. Os cadastros estão sendo gravados.</div>';
        $('#health').innerHTML = rows + pend;
      })
      .catch(function () { $('#health').textContent = 'Não foi possível consultar agora.'; });
  }

  function linha(label, value, good) {
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0">' +
      '<span>' + esc(label) + '</span>' +
      '<b style="color:' + (good ? 'var(--ok)' : 'var(--warn)') + '">' + esc(value) + '</b></div>';
  }

  /* --------------------------------------------------------------- boot */

  var saved = read(PIN_KEY);
  if (saved) {
    state.pin = saved;
    loadFromCache();
    showPanel();
  } else {
    $('#pin').focus();
  }
})();
