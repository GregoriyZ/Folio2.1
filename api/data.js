const DATA_ROW_ID = 'default';
const TABLE_NAME = process.env.SUPABASE_TABLE || 'folio_data';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.status(status).json(data);
}

function getConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), serviceKey };
}

function normalizePayload(body) {
  const safe = body && typeof body === 'object' ? body : {};
  return {
    transactions: Array.isArray(safe.transactions) ? safe.transactions : [],
    categories: Array.isArray(safe.categories) ? safe.categories : [],
    budgets: safe.budgets && typeof safe.budgets === 'object' ? safe.budgets : {},
  };
}

async function supabaseRequest(path, options = {}) {
  const cfg = getConfig();
  if (!cfg) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(cfg.supabaseUrl + path, {
    ...options,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase request failed (${res.status}): ${text}`);
  }
  return res;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const action = req.query && req.query.action;
  if (!action) {
    sendJson(res, 400, { error: 'Missing action' });
    return;
  }

  try {
    if (action === 'load' && req.method === 'GET') {
      const supaRes = await supabaseRequest(
        `/rest/v1/${encodeURIComponent(TABLE_NAME)}?select=data&id=eq.${encodeURIComponent(DATA_ROW_ID)}&limit=1`
      );
      const rows = await supaRes.json();
      const payload = rows && rows[0] && rows[0].data ? rows[0].data : {};
      sendJson(res, 200, normalizePayload(payload));
      return;
    }

    if (action === 'save' && req.method === 'POST') {
      const payload = normalizePayload(req.body);
      const row = {
        id: DATA_ROW_ID,
        data: payload,
        updated_at: new Date().toISOString(),
      };

      await supabaseRequest(`/rest/v1/${encodeURIComponent(TABLE_NAME)}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });

      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: 'Unsupported method/action' });
  } catch (error) {
    sendJson(res, 500, { error: error && error.message ? error.message : 'Unexpected error' });
  }
};
