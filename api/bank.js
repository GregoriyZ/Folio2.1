/*
 * Bank sync proxy — Redbark (CDR Representative of Fiskil, ADRBNK000246).
 * Connects ubank / NAB / ANZ (and 100+ other AU banks) via Open Banking.
 *
 * Required env vars (set in Vercel → Settings → Environment Variables):
 *   REDBARK_API_KEY   — from https://app.redbark.com/settings/api-mcp (Developer plan)
 *   FOLIO_SYNC_TOKEN  — any long random string; the browser must send it so the
 *                       endpoint isn't an open proxy to your bank data.
 * Optional:
 *   REDBARK_BASE_URL  — defaults to https://api.redbark.com
 *
 * Actions:
 *   GET /api/bank?action=accounts            → connections + accounts
 *   GET /api/bank?action=transactions&days=90 → normalised Folio transactions
 */

const BASE = (process.env.REDBARK_BASE_URL || 'https://api.redbark.com').replace(/\/$/, '');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Folio-Token');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.status(status).json(data);
}

async function redbark(path) {
  const key = process.env.REDBARK_API_KEY;
  if (!key) throw new Error('Missing REDBARK_API_KEY');
  const r = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Redbark ${r.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

/* Map a Redbark/CDR transaction onto Folio's schema.
   CDR signs amounts: negative = debit (expense), positive = credit (income). */
function toFolioTx(t, accountName) {
  const amt = Math.abs(parseFloat(t.amount) || 0);
  const isCredit = (t.direction || '').toLowerCase() === 'credit' || parseFloat(t.amount) > 0;
  return {
    id: 'rb-' + t.id, // stable => re-syncs overwrite, never duplicate
    type: isCredit ? 'income' : 'expense',
    amount: amt,
    description: t.merchantName || t.description || 'Bank transaction',
    category: '', // left blank so your own rules/categories decide
    date: (t.date || (t.datetime || '').slice(0, 10)),
    note: [accountName, t.category].filter(Boolean).join(' • '),
    bucket: 'none',
  };
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const expected = process.env.FOLIO_SYNC_TOKEN;
  const supplied = req.headers['x-folio-token'] || (req.query && req.query.token);
  if (!expected || supplied !== expected) {
    return sendJson(res, 401, { error: 'Unauthorized: bad or missing Folio sync token' });
  }

  const action = req.query && req.query.action;

  try {
    if (action === 'accounts') {
      const [conns, accts] = await Promise.all([
        redbark('/v1/connections'),
        redbark('/v1/accounts'),
      ]);
      return sendJson(res, 200, {
        connections: (conns.data || []).map((c) => ({
          id: c.id,
          institution: c.institutionName || c.institution || c.name,
          status: c.status,
        })),
        accounts: (accts.data || []).map((a) => ({
          id: a.id,
          connectionId: a.connectionId,
          name: a.name || a.accountName,
          type: a.type,
          masked: a.maskedNumber || a.accountNumber,
        })),
      });
    }

    if (action === 'transactions') {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 730);
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

      const accts = (await redbark('/v1/accounts')).data || [];
      const wanted = req.query.accountId
        ? accts.filter((a) => a.id === req.query.accountId)
        : accts;

      const out = [];
      const errors = [];
      // Sequential: heavy endpoints cap at 4 in-flight and 30/min per key.
      for (const a of wanted) {
        let offset = 0;
        for (;;) {
          try {
            const qs = `connectionId=${encodeURIComponent(a.connectionId)}&accountId=${encodeURIComponent(a.id)}&from=${from}&limit=200&offset=${offset}`;
            const page = await redbark('/v1/transactions?' + qs);
            (page.data || []).forEach((t) => out.push(toFolioTx(t, a.name || a.accountName)));
            if (!page.pagination || !page.pagination.hasMore) break;
            offset += page.pagination.limit || 200;
            if (offset > 5000) break;
          } catch (e) {
            errors.push(`${a.name || a.id}: ${e.message}`);
            break;
          }
        }
      }

      out.sort((x, y) => (x.date < y.date ? 1 : -1));
      return sendJson(res, 200, { transactions: out, count: out.length, from, errors });
    }

    return sendJson(res, 400, { error: 'Unknown action. Use accounts or transactions.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Unexpected error' });
  }
};
