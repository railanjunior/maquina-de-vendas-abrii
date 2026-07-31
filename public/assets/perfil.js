/* =========================================================================
   Perfil do organizador — o "cartão digital" que a pessoa recebe ao escanear.

   A fonte da verdade é o /perfil.json (editável por commit, sem precisar
   mexer no painel do Vercel). As variáveis de ambiente, quando existem,
   têm prioridade — assim dá para trocar o link do grupo sem novo deploy.
   ========================================================================= */

(function (scope) {
  'use strict';

  var cache = null;

  function textoOuVazio(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
  }

  /** Normaliza @perfil, URL completa ou usuário puro para só o usuário. */
  function usuarioSocial(valor, dominio) {
    var v = textoOuVazio(valor);
    if (!v) return '';
    v = v.replace(new RegExp('^https?://(www\\.)?' + dominio + '/(in/)?', 'i'), '');
    return v.replace(/^@+/, '').replace(/\/+$/, '');
  }

  function normalizar(perfil, env) {
    var org = (perfil && perfil.organizador) || {};
    var textos = (perfil && perfil.textos) || {};

    var whatsapp = String(env.organizerWhatsapp || org.whatsapp || '').replace(/\D/g, '');

    return {
      evento: env.eventName || perfil.evento || 'Evento',
      grupoWhatsapp: env.whatsappGroupUrl || textoOuVazio(perfil.grupoWhatsapp),
      storageReady: env.storageReady !== false,
      organizador: {
        nome: textoOuVazio(org.nome),
        cargo: textoOuVazio(org.cargo),
        bio: textoOuVazio(org.bio),
        foto: textoOuVazio(org.foto),
        whatsapp: whatsapp,
        email: textoOuVazio(org.email),
        site: textoOuVazio(org.site),
        instagram: usuarioSocial(org.instagram, 'instagram\\.com'),
        linkedin: usuarioSocial(org.linkedin, 'linkedin\\.com'),
      },
      textos: {
        tituloLinha1: textoOuVazio(textos.tituloLinha1) || 'Vamos nos',
        tituloLinha2: textoOuVazio(textos.tituloLinha2) || 'conectar.',
        subtitulo: textoOuVazio(textos.subtitulo),
      },
    };
  }

  /** Carrega e funde perfil.json + /api/app-config. Nunca rejeita. */
  function load() {
    if (cache) return Promise.resolve(cache);

    var perfil = fetch('/perfil.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });

    var env = fetch('/api/app-config')
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });

    return Promise.all([perfil, env]).then(function (partes) {
      cache = normalizar(partes[0] || {}, partes[1] || {});
      return cache;
    });
  }

  /** Iniciais para o avatar quando não há foto. */
  function iniciais(nome) {
    var partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '★';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Links externos do organizador, só os preenchidos. */
  function links(org) {
    var itens = [];
    if (org.instagram) {
      itens.push({ href: 'https://instagram.com/' + org.instagram, label: 'Instagram', icone: '◎' });
    }
    if (org.linkedin) {
      itens.push({ href: 'https://linkedin.com/in/' + org.linkedin, label: 'LinkedIn', icone: '▤' });
    }
    if (org.site) {
      itens.push({
        href: /^https?:/i.test(org.site) ? org.site : 'https://' + org.site,
        label: 'Site', icone: '◈',
      });
    }
    if (org.whatsapp) {
      itens.push({ href: 'https://wa.me/' + org.whatsapp, label: 'WhatsApp', icone: '✆' });
    }
    return itens;
  }

  /**
   * Monta o cartão do organizador.
   * @param {'compacto'|'completo'} variante
   */
  function cardHtml(cfg, variante) {
    var org = cfg.organizador;
    if (!org.nome) return '';

    var avatar = org.foto
      ? '<img class="perfil-foto" src="' + esc(org.foto) + '" alt="' + esc(org.nome) + '">'
      : '<span class="perfil-monograma">' + esc(iniciais(org.nome)) + '</span>';

    var linhaLinks = links(org).map(function (l) {
      return '<a class="perfil-link" href="' + esc(l.href) + '" target="_blank" rel="noopener">' +
        '<i aria-hidden="true">' + l.icone + '</i>' + esc(l.label) + '</a>';
    }).join('');

    return '' +
      '<div class="perfil-card' + (variante === 'completo' ? ' perfil-card--completo' : '') + '">' +
        '<div class="perfil-topo">' +
          '<div class="perfil-avatar">' + avatar + '</div>' +
          '<div class="perfil-id">' +
            '<b>' + esc(org.nome) + '</b>' +
            (org.cargo ? '<span>' + esc(org.cargo) + '</span>' : '') +
          '</div>' +
        '</div>' +
        (variante === 'completo' && org.bio ? '<p class="perfil-bio">' + esc(org.bio) + '</p>' : '') +
        (linhaLinks ? '<div class="perfil-links">' + linhaLinks + '</div>' : '') +
        '<button type="button" class="btn btn--ghost btn--sm perfil-salvar" data-salvar-contato>' +
          'Salvar meu contato' +
        '</button>' +
      '</div>';
  }

  function vcardEscape(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  /** vCard do organizador, para a pessoa salvar na agenda dela. */
  function vcardOrganizador(cfg) {
    var org = cfg.organizador;
    var partes = String(org.nome || '').trim().split(/\s+/);
    var primeiro = partes.shift() || '';
    var ultimo = partes.join(' ');

    var linhas = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:' + vcardEscape(ultimo) + ';' + vcardEscape(primeiro) + ';;;',
      'FN:' + vcardEscape(org.nome),
    ];
    if (org.cargo) linhas.push('TITLE:' + vcardEscape(org.cargo));
    if (org.whatsapp) linhas.push('TEL;TYPE=CELL:+' + org.whatsapp);
    if (org.email) linhas.push('EMAIL;TYPE=INTERNET:' + vcardEscape(org.email));
    if (org.site) linhas.push('URL:' + vcardEscape(/^https?:/i.test(org.site) ? org.site : 'https://' + org.site));
    if (org.instagram) linhas.push('X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/' + org.instagram);
    if (org.linkedin) linhas.push('X-SOCIALPROFILE;TYPE=linkedin:https://linkedin.com/in/' + org.linkedin);
    linhas.push('NOTE:' + vcardEscape('Conhecemos no ' + cfg.evento + (org.bio ? ' — ' + org.bio : '')));
    linhas.push('END:VCARD');
    return linhas.join('\r\n') + '\r\n';
  }

  function baixarVcardOrganizador(cfg) {
    var nomeArquivo = String(cfg.organizador.nome || 'contato')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    var blob = new Blob([vcardOrganizador(cfg)], { type: 'text/vcard;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo + '.vcf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /** Liga todos os botões [data-salvar-contato] presentes na página. */
  function ligarBotoesSalvar(cfg, raiz) {
    var alvos = (raiz || document).querySelectorAll('[data-salvar-contato]');
    Array.prototype.forEach.call(alvos, function (btn) {
      btn.addEventListener('click', function () {
        baixarVcardOrganizador(cfg);
        var original = btn.textContent;
        btn.textContent = '✓ Contato salvo';
        setTimeout(function () { btn.textContent = original; }, 2200);
      });
    });
  }

  scope.Perfil = {
    load: load,
    cardHtml: cardHtml,
    vcardOrganizador: vcardOrganizador,
    baixarVcardOrganizador: baixarVcardOrganizador,
    ligarBotoesSalvar: ligarBotoesSalvar,
    iniciais: iniciais,
  };
})(typeof self !== 'undefined' ? self : this);
