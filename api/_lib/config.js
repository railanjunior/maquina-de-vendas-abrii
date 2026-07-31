/**
 * Leitura centralizada das variaveis de ambiente.
 *
 * Nada aqui e obrigatorio para o build: o app sobe mesmo sem configuracao e o
 * endpoint /api/health explica exatamente o que falta.
 */

const pick = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
};

export const config = {
  // Upstash Redis (tambem aceita os nomes injetados pela integracao Vercel KV).
  redisUrl: pick('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'),
  redisToken: pick('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'),

  // Espelho opcional em Google Sheets (Apps Script publicado como Web App).
  sheetsUrl: pick('SHEETS_WEBHOOK_URL'),
  sheetsSecret: pick('SHEETS_WEBHOOK_SECRET'),

  // PIN do painel administrativo.
  adminPin: pick('ADMIN_PIN'),

  // Conteudo/branding.
  eventName: pick('EVENT_NAME') || 'Adapta Summit',
  whatsappGroupUrl: pick('WHATSAPP_GROUP_URL'),
  organizerWhatsapp: pick('ORGANIZER_WHATSAPP').replace(/\D/g, ''),
};

export const hasRedis = () => Boolean(config.redisUrl && config.redisToken);
export const hasSheets = () => Boolean(config.sheetsUrl);
export const hasAnyStorage = () => hasRedis() || hasSheets();
