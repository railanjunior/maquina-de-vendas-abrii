/**
 * GET /api/health — diagnostico de configuracao.
 *
 * Serve para responder rapido, no meio do evento, a pergunta que importa:
 * "os cadastros estao caindo em algum lugar?".
 */

import { config, hasRedis, hasSheets, hasAnyStorage } from './_lib/config.js';
import { json, methodNotAllowed } from './_lib/http.js';
import { pingRedis } from './_lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const redis = await pingRedis();
  const pendencias = [];
  if (!hasAnyStorage()) {
    pendencias.push('Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (recomendado) ou SHEETS_WEBHOOK_URL.');
  }
  if (hasRedis() && !redis.ok) {
    pendencias.push(`Redis configurado mas inacessivel: ${redis.reason}`);
  }
  if (!config.adminPin) {
    pendencias.push('Defina ADMIN_PIN para liberar o painel /admin.');
  }

  return json(res, 200, {
    ok: hasAnyStorage() && pendencias.length === 0,
    evento: config.eventName,
    armazenamento: {
      redis: hasRedis() ? (redis.ok ? `ok (${redis.count} leads)` : `erro: ${redis.reason}`) : 'nao configurado',
      sheets: hasSheets() ? 'configurado' : 'nao configurado',
    },
    painel: config.adminPin ? 'protegido por PIN' : 'bloqueado (ADMIN_PIN ausente)',
    grupoWhatsapp: config.whatsappGroupUrl ? 'configurado' : 'nao configurado',
    whatsappOrganizador: config.organizerWhatsapp ? 'configurado' : 'nao configurado',
    // Booleanos explicitos: o painel pinta os indicadores a partir daqui, sem
    // precisar interpretar o texto acima.
    flags: {
      redis: hasRedis() && redis.ok,
      sheets: hasSheets(),
      painel: Boolean(config.adminPin),
      grupoWhatsapp: Boolean(config.whatsappGroupUrl),
      whatsappOrganizador: Boolean(config.organizerWhatsapp),
    },
    pendencias,
  });
}
