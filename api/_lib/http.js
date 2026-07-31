/** Utilitarios compartilhados pelas funcoes serverless. */

import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Le o corpo da requisicao como JSON, com limite de tamanho. */
export async function readJson(req, { limitBytes = 32 * 1024 } = {}) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('Payload muito grande.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return JSON.parse(raw);
}

/** Comparacao de PIN resistente a timing attack. */
function pinMatches(candidate) {
  const expected = Buffer.from(config.adminPin, 'utf8');
  const given = Buffer.from(String(candidate || ''), 'utf8');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Garante que a requisicao veio do painel administrativo.
 * Sem ADMIN_PIN configurado ninguem le os leads — dados pessoais nao podem
 * ficar abertos por esquecimento de configuracao.
 *
 * @returns {true} se autorizado; caso contrario ja respondeu e retorna false.
 */
export function requireAdmin(req, res) {
  if (!config.adminPin) {
    json(res, 503, {
      ok: false,
      code: 'ADMIN_PIN_AUSENTE',
      error: 'Defina a variavel de ambiente ADMIN_PIN no Vercel para liberar o painel.',
    });
    return false;
  }
  const pin = req.headers['x-admin-pin'] || '';
  if (!pinMatches(pin)) {
    json(res, 401, { ok: false, code: 'PIN_INVALIDO', error: 'PIN incorreto.' });
    return false;
  }
  return true;
}

/** Responde 405 listando os metodos aceitos. */
export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { ok: false, error: `Metodo nao permitido. Use: ${allowed.join(', ')}.` });
}
