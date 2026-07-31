/* =========================================================================
   Service Worker.

   Duas funcoes:
     1. Deixar o app abrir mesmo sem internet (cache do shell).
     2. Reenviar a fila de cadastros via Background Sync — funciona ate com a
        aba fechada, que e exatamente o cenario de quem preenche e guarda o
        celular no bolso.

   Sobre cache: a versao anterior servia os estaticos com "cache primeiro".
   Isso quebrou o app em producao — depois de um deploy, o aparelho recebia o
   HTML novo junto com o JavaScript velho, e a pagina morria com
   "X is not defined". Agora o codigo e sempre buscado na rede, com o cache
   servindo so de rede de seguranca quando nao ha conexao.
   ========================================================================= */

importScripts('/assets/queue-core.js');

var CACHE = 'adapta-shell-v3';

var SHELL = [
  '/',
  '/admin',
  '/qr',
  '/perfil.json',
  '/manifest.webmanifest',
  '/assets/app.css',
  '/assets/app.js',
  '/assets/admin.js',
  '/assets/perfil.js',
  '/assets/qr-draw.js',
  '/assets/qr-view.js',
  '/assets/queue-core.js',
  '/assets/qrcode.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-180.png',
];

/** Recursos cujo conteudo muda a cada deploy e nao podem sair de um cache velho. */
function ehCodigo(pathname) {
  return /\.(js|css|json|webmanifest)$/.test(pathname) || pathname === '/perfil.json';
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      // addAll e tudo-ou-nada; um recurso indisponivel nao pode abortar a
      // instalacao inteira.
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/** Busca na rede e atualiza o cache; cai para o cache se a rede falhar. */
function redePrimeiro(req, respostaFinal) {
  return fetch(req)
    .then(function (res) {
      if (res && res.ok) {
        var copia = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || (respostaFinal ? respostaFinal() : Response.error());
      });
    });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // POST de lead nunca passa por cache

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: rede primeiro, cache so como ultimo recurso para /api/app-config.
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(redePrimeiro(req, function () {
      return new Response(JSON.stringify({ ok: false, offline: true }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }));
    return;
  }

  // Navegacao: rede primeiro, cai para o shell salvo.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('/'); });
      })
    );
    return;
  }

  // Codigo (js/css/json): rede primeiro. Garante que HTML e script sempre
  // venham da mesma versao do deploy.
  if (ehCodigo(url.pathname)) {
    event.respondWith(redePrimeiro(req));
    return;
  }

  // Imagens e fontes: cache primeiro, revalidando em segundo plano.
  event.respondWith(
    caches.match(req).then(function (hit) {
      var rede = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || rede;
    })
  );
});

/* --- Reenvio da fila ---------------------------------------------------- */

self.addEventListener('sync', function (event) {
  if (event.tag !== 'flush-leads') return;
  event.waitUntil(
    self.LeadQueue.flush().then(function (result) {
      // Se ainda sobrou coisa, rejeitar faz o navegador reagendar o sync.
      if (result.stillPending > 0) throw new Error('ainda ha cadastros pendentes');
      return notifyClients(result);
    })
  );
});

self.addEventListener('periodicsync', function (event) {
  if (event.tag !== 'flush-leads') return;
  event.waitUntil(self.LeadQueue.flush().then(notifyClients));
});

self.addEventListener('message', function (event) {
  if (!event.data) return;
  if (event.data.type === 'flush-leads') {
    event.waitUntil(self.LeadQueue.flush().then(notifyClients));
  }
});

function notifyClients(result) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ type: 'queue-flushed', result: result });
    });
  });
}
