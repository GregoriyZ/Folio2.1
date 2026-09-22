/*
 * /api/sync — the automatic pipeline.
 *
 *   GET /api/sync?days=90        run a sync now (cron or browser)
 *   GET /api/sync?action=status  when we last synced, how many rows
 *   GET /api/sync?action=accounts list connected bank accounts
 *
 * Auth: header `X-Folio-Token` or `?token=` must equal FOLIO_SYNC_TOKEN.
 * Vercel Cron requests are also accepted (they carry the CRON_SECRET bearer
 * when set, and x-vercel-cron otherwise).
 *
 * The sync is entirely server-side: it pulls from the bank providers, merges
 * into the Supabase blob, and writes back. Folio does not have to be open,
 * and every Supabase round trip doubles as a keepalive so a free-tier project
 * never pauses for inactivity.
 */

const providers = require('./_lib/providers');
const store = require('./_lib/store');
const { categorise } = require('./_lib/categorise');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Folio-Token,Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function send(res, status, data) {
  cors(res);
  res.status(status).json(data);
}

function authorised(req) {
  const expected = process.env.FOLIO_SYNC_TOKEN;
  const supplied = req.headers['x-folio-token'] || (req.query && req.query.token);
  if (expected && supplied === expected) return true;

  // Vercel Cron. When CRON_SECRET is set Vercel sends it as a bearer token.
  // Otherwise fall back to the documented cron markers: the user agent is
  // always `vercel-cron/1.0` and each invocation carries x-vercel-cron-schedule.
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET) return auth === `Bearer ${process.env.CRON_SECRET}`;
  const ua = req.headers['user-agent'] || '';
  if (ua.includes('vercel-cron/')) return true;
  if (req.headers['x-vercel-cron-schedule']) return true;
  return false;
}

/* Merge incoming bank rows into the stored ledger.
   Rows are keyed by their stable bank id, so re-syncing an overlapping window
   updates instead of duplicating. Classification is only ever applied to rows
   we have not seen before — once a row exists, whatever is in the ledger
   (including anything you re-categorised by hand) wins. */
function merge(existing, incoming) {
  const byId = new Map(existing.map((t) => [String(t.id), t]));
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    const prev = byId.get(String(raw.id));
    if (prev) {
      // Refresh only the bank-owned fields; keep the user-owned ones.
      byId.set(String(raw.id), {
        ...prev,
        amount: raw.amount,
        date: raw.date,
        description: prev.description || raw.description,
        source: raw.source,
      });
      updated++;
    } else {
      const guess = categorise(raw);
      byId.set(String(raw.id), {
        ...raw,
        type: guess.type,
        category: guess.category,
        bucket: raw.bucket || 'none',
      });
      added++;
    }
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));
  return { merged, added, updated };
}

async function runSync(days) {
  const enabled = providers.enabledProviders();
  if (!enabled.length) {
    return {
      ok: false,
      error: 'No bank provider configured. Set REDBARK_API_KEY (ANZ/NAB/ubank) and/or UP_API_TOKEN.',
      providers: [],
    };
  }

  const [data, pulled] = await Promise.all([
    store.load(),
    providers.fetchTransactions(days),
  ]);

  const { merged, added, updated } = merge(data.transactions, pulled.transactions);

  const meta = {
    ...data.meta,
    lastSync: new Date().toISOString(),
    lastSyncAdded: added,
    lastSyncUpdated: updated,
    lastSyncPulled: pulled.transactions.length,
    lastSyncFrom: pulled.from,
    lastSyncErrors: pulled.errors,
    providers: pulled.providers,
  };

  await store.save({ ...data, transactions: merged, meta });

  return {
    ok: true,
    added,
    updated,
    pulled: pulled.transactions.length,
    total: merged.length,
    from: pulled.from,
    providers: pulled.providers,
    errors: pulled.errors,
    lastSync: meta.lastSync,
  };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorised(req)) return send(res, 401, { error: 'Unauthorized: bad or missing Folio sync token' });

  const action = (req.query && req.query.action) || 'run';

  try {
    if (action === 'status') {
      const data = await store.load(); // doubles as the Supabase keepalive
      return send(res, 200, {
        ok: true,
        transactions: data.transactions.length,
        providers: providers.enabledProviders(),
        ...data.meta,
      });
    }

    if (action === 'accounts') {
      return send(res, 200, await providers.fetchAccounts());
    }

    if (action === 'ping') {
      await store.ping();
      return send(res, 200, { ok: true, pinged: new Date().toISOString() });
    }

    // Cron paths cannot carry a query string, so the scheduled run uses
    // SYNC_DAYS (default 45) — a wide enough window to catch anything that
    // posted late without hammering the provider's rate limits.
    const days = (req.query && req.query.days) || process.env.SYNC_DAYS || 45;
    const result = await runSync(days);
    return send(res, result.ok ? 200 : 400, result);
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message || 'Unexpected error' });
  }
};

module.exports.runSync = runSync;
module.exports.merge = merge;
