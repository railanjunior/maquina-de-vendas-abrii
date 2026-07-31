/* =========================================================================
   Fila local de cadastros — o coracao do "nao perder nenhum dado".

   Todo pre-cadastro e gravado no dispositivo ANTES de tentar subir para o
   servidor. Se a internet do evento falhar, o registro fica na fila e e
   reenviado sozinho: ao voltar a conexao, ao reabrir o app e tambem pelo
   Service Worker (Background Sync), mesmo com a aba ja fechada.

   Este arquivo roda tanto na pagina quanto dentro do Service Worker, entao usa
   apenas APIs disponiveis nos dois contextos (nada de window/localStorage
   obrigatorio).
   ========================================================================= */

(function (scope) {
  'use strict';

  var DB_NAME = 'adapta-leads';
  var DB_VERSION = 1;
  var STORE = 'queue';
  var ENDPOINT = '/api/leads';
  var MAX_ATTEMPTS = 200; // praticamente infinito; so evita loop eterno em caso patologico

  /* --- Camada de persistencia: IndexedDB com fallback em memoria ---------- */

  var memoryFallback = null; // Map usado se o IndexedDB estiver indisponivel

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (memoryFallback || !scope.indexedDB) return reject(new Error('indexeddb-indisponivel'));
      var req;
      try {
        req = scope.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        return reject(err);
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('falha ao abrir indexeddb')); };
      req.onblocked = function () { reject(new Error('indexeddb-bloqueado')); };
    }).catch(function (err) {
      // Navegacao anonima ou storage bloqueado: degrada para memoria em vez de
      // travar o fluxo de cadastro.
      if (!memoryFallback) memoryFallback = new Map();
      throw err;
    });
  }

  function tx(mode, run) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE, mode);
        var store = transaction.objectStore(STORE);
        var out;
        try {
          out = run(store);
        } catch (err) {
          try { transaction.abort(); } catch (_) { /* ja abortada */ }
          db.close();
          reject(err);
          return;
        }
        transaction.oncomplete = function () { db.close(); resolve(out && out.__req ? out.__req.result : out); };
        transaction.onerror = function () { db.close(); reject(transaction.error); };
        transaction.onabort = function () { db.close(); reject(transaction.error || new Error('transacao abortada')); };
      });
    });
  }

  function wrap(request) { return { __req: request }; }

  function memGetAll() { return Array.from((memoryFallback || new Map()).values()); }

  function putRecord(record) {
    return tx('readwrite', function (store) { return wrap(store.put(record)); })
      .catch(function () {
        if (!memoryFallback) memoryFallback = new Map();
        memoryFallback.set(record.id, record);
      });
  }

  function getAllRecords() {
    return tx('readonly', function (store) { return wrap(store.getAll()); })
      .then(function (rows) { return rows || []; })
      .catch(function () { return memGetAll(); });
  }

  /* --- API publica -------------------------------------------------------- */

  function nowIso() { return new Date().toISOString(); }

  /** Grava o lead localmente. Resolve mesmo se o armazenamento falhar. */
  function enqueue(lead) {
    return putRecord({
      id: lead.id,
      lead: lead,
      status: 'pending',
      attempts: 0,
      lastError: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  function all() { return getAllRecords(); }

  function pending() {
    return getAllRecords().then(function (rows) {
      return rows.filter(function (r) { return r.status === 'pending'; });
    });
  }

  function stats() {
    return getAllRecords().then(function (rows) {
      var out = { total: rows.length, pending: 0, sent: 0, invalid: 0 };
      rows.forEach(function (r) { if (out[r.status] !== undefined) out[r.status] += 1; });
      return out;
    });
  }

  /** Envia um registro. Retorna o novo status. */
  function send(record) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record.lead),
      // Mantem o envio vivo se a pagina for fechada logo apos o submit.
      keepalive: true,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (res.ok && payload.ok) return { status: 'sent', error: '' };
        // 422 = dado invalido: reenviar nao adianta, precisa de correcao humana.
        if (res.status === 422) {
          return { status: 'invalid', error: (payload.errors || ['Cadastro invalido.']).join(' ') };
        }
        // 4xx/5xx restantes (inclusive 503 sem armazenamento) continuam na fila.
        return { status: 'pending', error: payload.error || ('HTTP ' + res.status) };
      });
    }).catch(function (err) {
      return { status: 'pending', error: String((err && err.message) || err) };
    });
  }

  var flushing = false;

  /**
   * Tenta subir tudo que esta pendente.
   * @returns {Promise<{sent:number, stillPending:number, invalid:number}>}
   */
  function flush() {
    if (flushing) return Promise.resolve({ sent: 0, stillPending: 0, invalid: 0, skipped: true });
    flushing = true;

    return pending().then(function (rows) {
      var result = { sent: 0, stillPending: 0, invalid: 0 };
      // Sequencial de proposito: rede ruim de evento nao gosta de rajada.
      return rows.reduce(function (chain, record) {
        return chain.then(function () {
          if (record.attempts >= MAX_ATTEMPTS) { result.stillPending += 1; return null; }
          return send(record).then(function (outcome) {
            record.status = outcome.status;
            record.attempts += 1;
            record.lastError = outcome.error;
            record.updatedAt = nowIso();
            if (outcome.status === 'sent') result.sent += 1;
            else if (outcome.status === 'invalid') result.invalid += 1;
            else result.stillPending += 1;
            return putRecord(record);
          });
        });
      }, Promise.resolve()).then(function () { return result; });
    }).catch(function () {
      return { sent: 0, stillPending: 0, invalid: 0 };
    }).then(function (result) {
      flushing = false;
      return result;
    });
  }

  /** Remove registros ja enviados ha mais de N dias, para nao crescer sem fim. */
  function prune(days) {
    var limit = Date.now() - (days || 30) * 86400000;
    return getAllRecords().then(function (rows) {
      var old = rows.filter(function (r) {
        return r.status === 'sent' && new Date(r.updatedAt || 0).getTime() < limit;
      });
      if (!old.length) return 0;
      return tx('readwrite', function (store) {
        old.forEach(function (r) { store.delete(r.id); });
      }).then(function () { return old.length; }).catch(function () { return 0; });
    });
  }

  scope.LeadQueue = {
    enqueue: enqueue,
    flush: flush,
    pending: pending,
    all: all,
    stats: stats,
    prune: prune,
  };
})(typeof self !== 'undefined' ? self : this);
