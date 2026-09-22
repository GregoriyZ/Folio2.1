/*
 * Supabase store — the same single-row `folio_data` blob the browser uses,
 * but readable/writable from server-side cron jobs so syncing works even when
 * Folio is not open in a tab.
 */

const DATA_ROW_ID = 'default';
const TABLE_NAME = process.env.SUPABASE_TABLE || 'folio_data';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

async function request(path, options = {}) {
  const cfg = config();
  const res = await fetch(cfg.url + path, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

function normalize(data) {
  const safe = data && typeof data === 'object' ? data : {};
  return {
    transactions: Array.isArray(safe.transactions) ? safe.transactions : [],
    categories: Array.isArray(safe.categories) ? safe.categories : [],
    budgets: safe.budgets && typeof safe.budgets === 'object' ? safe.budgets : {},
    meta: safe.meta && typeof safe.meta === 'object' ? safe.meta : {},
  };
}

async function load() {
  const res = await request(
    `/rest/v1/${encodeURIComponent(TABLE_NAME)}?select=data&id=eq.${encodeURIComponent(DATA_ROW_ID)}&limit=1`
  );
  const rows = await res.json();
  return normalize(rows && rows[0] && rows[0].data);
}

async function save(payload) {
  await request(`/rest/v1/${encodeURIComponent(TABLE_NAME)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: DATA_ROW_ID,
      data: normalize(payload),
      updated_at: new Date().toISOString(),
    }),
  });
}

/* Cheap read that keeps a free-tier Supabase project from pausing on inactivity. */
async function ping() {
  await request(
    `/rest/v1/${encodeURIComponent(TABLE_NAME)}?select=id&id=eq.${encodeURIComponent(DATA_ROW_ID)}&limit=1`
  );
  return true;
}

module.exports = { load, save, ping, normalize, TABLE_NAME };
