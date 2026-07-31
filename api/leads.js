/**
 * POST   /api/leads  -> grava um pre-cadastro (idempotente pelo campo `id`)
 * GET    /api/leads  -> lista todos os leads (requer PIN de admin)
 * DELETE /api/leads?id=... -> remove um lead (requer PIN de admin)
 */

import { hasAnyStorage, hasRedis } from './_lib/config.js';
import { json, readJson, requireAdmin, methodNotAllowed } from './_lib/http.js';
import { parseLead } from './_lib/lead.js';
import { saveLead, listLeads, deleteLead } from './_lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'POST') return handleCreate(req, res);
  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
}

async function handleCreate(req, res) {
  if (!hasAnyStorage()) {
    // 503 e proposital: o cliente mantem o lead na fila local e tenta de novo
    // depois que a configuracao for feita. Nada se perde.
    return json(res, 503, {
      ok: false,
      code: 'SEM_ARMAZENAMENTO',
      error: 'Nenhum destino de gravacao configurado. Configure Upstash Redis ou SHEETS_WEBHOOK_URL no Vercel.',
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return json(res, 400, { ok: false, error: String(err.message || err) });
  }

  const parsed = parseLead(body);
  if (!parsed.ok) {
    return json(res, 422, { ok: false, code: 'INVALIDO', errors: parsed.errors });
  }

  const { stored, failed } = await saveLead(parsed.lead);

  if (!stored.length) {
    return json(res, 502, {
      ok: false,
      code: 'FALHA_GRAVACAO',
      error: 'Nao foi possivel gravar agora. Tente novamente.',
      failed,
    });
  }

  return json(res, 200, { ok: true, id: parsed.lead.id, stored, failed });
}

async function handleList(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!hasRedis()) {
    return json(res, 503, {
      ok: false,
      code: 'SEM_REDIS',
      error: 'O painel precisa do Upstash Redis. Com apenas o webhook do Sheets, consulte a planilha.',
    });
  }
  try {
    const leads = await listLeads();
    return json(res, 200, { ok: true, total: leads.length, leads });
  } catch (err) {
    return json(res, 502, { ok: false, error: String(err.message || err) });
  }
}

async function handleDelete(req, res) {
  if (!requireAdmin(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return json(res, 400, { ok: false, error: 'Informe o id.' });
  try {
    const removed = await deleteLead(id);
    return json(res, 200, { ok: true, removed });
  } catch (err) {
    return json(res, 502, { ok: false, error: String(err.message || err) });
  }
}
