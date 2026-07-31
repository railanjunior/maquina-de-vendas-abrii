/**
 * Camada de persistencia dos leads.
 *
 * Dois destinos independentes, ambos opcionais:
 *   1. Upstash Redis (REST)  -> fonte da verdade, alimenta o painel.
 *   2. Google Sheets webhook -> espelho legivel, sobrevive a qualquer coisa.
 *
 * Se os dois estiverem configurados, a gravacao e dupla. Um lead so e
 * considerado salvo quando ao menos um destino confirmou.
 */

import { config, hasRedis, hasSheets } from './config.js';

const HASH_KEY = 'adapta:leads:v1';

/** Executa um comando Redis via API REST do Upstash. */
async function redisCommand(command, { timeoutMs = 7000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.redisUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.redisToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Redis HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(`Redis: ${payload.error}`);
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Envia o lead para o Apps Script que escreve na planilha. */
async function pushToSheets(lead, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: config.sheetsSecret || undefined, lead }),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sheets HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grava um lead. A chave e o `id` gerado no dispositivo de quem preencheu,
 * entao reenvios da fila offline sobrescrevem o mesmo registro em vez de
 * duplicar.
 *
 * @returns {Promise<{stored: string[], failed: {target: string, error: string}[]}>}
 */
export async function saveLead(lead) {
  const targets = [];
  if (hasRedis()) {
    targets.push({
      name: 'redis',
      run: () => redisCommand(['HSET', HASH_KEY, lead.id, JSON.stringify(lead)]),
    });
  }
  if (hasSheets()) {
    targets.push({ name: 'sheets', run: () => pushToSheets(lead) });
  }

  const results = await Promise.allSettled(targets.map((t) => t.run()));
  const stored = [];
  const failed = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') stored.push(targets[i].name);
    else failed.push({ target: targets[i].name, error: String(result.reason?.message || result.reason) });
  });

  return { stored, failed };
}

/** Le todos os leads gravados no Redis, do mais recente para o mais antigo. */
export async function listLeads() {
  if (!hasRedis()) return [];
  const flat = await redisCommand(['HGETALL', HASH_KEY]);
  if (!Array.isArray(flat)) return [];

  const leads = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      leads.push(JSON.parse(flat[i]));
    } catch {
      // Um registro corrompido nao pode derrubar a listagem inteira.
    }
  }
  // Ordena pelo horario do dispositivo de quem preencheu: um lead que ficou na
  // fila offline mantem sua posicao real na linha do tempo do evento.
  const when = (lead) => String(lead.clientCreatedAt || lead.createdAt || '');
  leads.sort((a, b) => when(b).localeCompare(when(a)));
  return leads;
}

/** Remove um lead (usado para limpar cadastros de teste). */
export async function deleteLead(id) {
  if (!hasRedis()) return false;
  const removed = await redisCommand(['HDEL', HASH_KEY, id]);
  return Number(removed) > 0;
}

/** Ping de leitura, usado pelo /api/health. */
export async function pingRedis() {
  if (!hasRedis()) return { ok: false, reason: 'nao configurado' };
  try {
    const count = await redisCommand(['HLEN', HASH_KEY], { timeoutMs: 4000 });
    return { ok: true, count: Number(count) || 0 };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}
