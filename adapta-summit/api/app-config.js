/**
 * GET /api/app-config — dados publicos que o front precisa saber em runtime.
 * Nada sensivel aqui: nome do evento, link do grupo e o WhatsApp de resgate
 * usado quando o cadastro nao consegue subir por falta de internet.
 */

import { config, hasAnyStorage } from './_lib/config.js';
import { json, methodNotAllowed } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      eventName: config.eventName,
      whatsappGroupUrl: config.whatsappGroupUrl,
      organizerWhatsapp: config.organizerWhatsapp,
      storageReady: hasAnyStorage(),
    })
  );
}
