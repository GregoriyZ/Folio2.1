/*
 * Bank providers — normalise everything to Folio's transaction shape.
 *
 * Providers are picked up purely from env vars, so you can run one, two, or
 * all three at once and the sync just merges whatever is configured:
 *
 *   REDBARK_API_KEY   → ANZ / NAB / ubank (+100 AU banks) via Open Banking (CDR)
 *   UP_API_TOKEN      → Up Bank personal access token (free, api.up.com.au)
 *
 * Every transaction gets a stable, provider-prefixed id so re-syncing an
 * overlapping window updates rows instead of duplicating them.
 */

const REDBARK_BASE = (process.env.REDBARK_BASE_URL || 'https://api.redbark.com').replace(/\/$/, '');
const UP_BASE = 'https://api.up.com.au/api/v1';

async function getJson(url, headers) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${r.status} on ${url.replace(/\?.*$/, '')}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

/* ── Redbark (CDR: ANZ, NAB, ubank, …) ───────────────────────
   Primary path is API v2 (snake_case, money in minor units, cursor
   pagination). v1 is deprecated and frozen upstream, so it is kept only as a
   fallback for keys or releases where v2 is not available yet. */

const REDBARK_VERSION = process.env.REDBARK_API_VERSION || '2026-10-01.wattle';

function redbarkKey() {
  const key = process.env.REDBARK_API_KEY;
  if (!key) throw new Error('Missing REDBARK_API_KEY');
  return key;
}


function redbarkV1(path) {
  return getJson(REDBARK_BASE + path, { Authorization: `Bearer ${redbarkKey()}` });
}

/* Walk a v2 token-paginated list to the end. */
async function redbarkV2All(path, cap = 5000) {
  const out = [];
  let url = REDBARK_BASE + '/v2' + path;
  let guard = 0;
  while (url && out.length < cap && guard++ < 60) {
    const page = await getJson(url, {
      Authorization: `Bearer ${redbarkKey()}`,
      'Redbark-Version': REDBARK_VERSION,
    });
    out.push(...(page.data || []));
    url = page.next_page_url || null;
  }
  return out;
}

/* v2 money is an integer in minor units: { amount: 1250, currency: "aud" }. */
function moneyToFloat(money) {
  if (!money || typeof money !== 'object') return 0;
  const n = Number(money.amount);
  return Number.isFinite(n) ? n / 100 : 0;
}

function redbarkV2ToFolio(t, accountName) {
  const value = moneyToFloat(t.amount);
  const dir = String(t.direction || '').toLowerCase();
  // Prefer the explicit direction; fall back to the sign of the amount.
  const isCredit = dir ? /credit|in\b|inbound|deposit/.test(dir) : value > 0;
  return {
    id: 'rb-' + t.id,
    type: isCredit ? 'income' : 'expense',
    amount: Math.abs(value),
    description: t.merchant_name || t.description || 'Bank transaction',
    category: '',
    date: t.date || String(t.datetime || t.post_datetime || '').slice(0, 10),
    note: [accountName, t.provider_category, t.reference].filter(Boolean).join(' • '),
    bucket: 'none',
    source: 'redbark',
  };
}

function redbarkV1ToFolio(t, accountName) {
  const raw = parseFloat(t.amount) || 0;
  const isCredit = (t.direction || '').toLowerCase() === 'credit' || raw > 0;
  return {
    id: 'rb-' + t.id,
    type: isCredit ? 'income' : 'expense',
    amount: Math.abs(raw),
    description: t.merchantName || t.description || 'Bank transaction',
    category: '',
    date: t.date || String(t.datetime || '').slice(0, 10),
    note: [accountName, t.category].filter(Boolean).join(' • '),
    bucket: 'none',
    source: 'redbark',
  };
}

async function redbarkAccountsV2() {
  const [conns, accts] = await Promise.all([
    redbarkV2All('/connections?limit=100'),
    redbarkV2All('/accounts?limit=100'),
  ]);
  return {
    connections: conns.map((c) => ({
      id: c.id,
      institution: (c.institution && c.institution.name) || c.provider,
      status: c.status,
      // Surfaced so a stale CDR consent is visible instead of silently empty.
      consentExpiresAt: (c.consent && c.consent.expires_at) || null,
    })),
    accounts: accts.map((a) => ({
      id: a.id,
      connectionId: a.connection,
      name: a.name,
      type: a.type,
      masked: a.account_number,
      category: a.category,
      provider: 'redbark',
    })),
  };
}

async function redbarkAccountsV1() {
  const [conns, accts] = await Promise.all([
    redbarkV1('/v1/connections'),
    redbarkV1('/v1/accounts?limit=100'),
  ]);
  return {
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
      provider: 'redbark',
    })),
  };
}

async function redbarkAccounts() {
  try {
    return await redbarkAccountsV2();
  } catch (e) {
    if (!shouldFallBackToV1(e)) throw e;
    return redbarkAccountsV1();
  }
}

/* v2 is beta. Only fall back for "this API is not available to you" style
   failures, never for a genuine auth or rate-limit problem we should surface. */
function shouldFallBackToV1(e) {
  return /\b(404|400|403)\b/.test(e.message || '');
}

async function redbarkTransactionsV2(from, accountId) {
  const accts = await redbarkV2All('/accounts?limit=100');
  const wanted = (accountId ? accts.filter((a) => a.id === accountId) : accts)
    // /transactions is banking-only; brokerage accounts use /holdings.
    .filter((a) => !a.category || a.category === 'banking');

  const out = [];
  const errors = [];
  // Sequential: the heavy tier allows only 4 requests in flight.
  for (const a of wanted) {
    try {
      const qs = `?account=${encodeURIComponent(a.id)}&from=${from}&limit=100`;
      const rows = await redbarkV2All('/transactions' + qs);
      rows.forEach((t) => out.push(redbarkV2ToFolio(t, a.name)));
    } catch (e) {
      errors.push(`redbark ${a.name || a.id}: ${e.message}`);
    }
  }
  return { transactions: out, errors };
}

async function redbarkTransactionsV1(from, accountId) {
  const accts = (await redbarkV1('/v1/accounts?limit=100')).data || [];
  const wanted = accountId ? accts.filter((a) => a.id === accountId) : accts;

  const out = [];
  const errors = [];
  for (const a of wanted) {
    let offset = 0;
    for (;;) {
      try {
        const qs = `connectionId=${encodeURIComponent(a.connectionId)}&accountId=${encodeURIComponent(a.id)}&from=${from}&limit=200&offset=${offset}`;
        const page = await redbarkV1('/v1/transactions?' + qs);
        (page.data || []).forEach((t) => out.push(redbarkV1ToFolio(t, a.name || a.accountName)));
        if (!page.pagination || !page.pagination.hasMore) break;
        offset += page.pagination.limit || 200;
        if (offset > 5000) break;
      } catch (e) {
        errors.push(`redbark ${a.name || a.id}: ${e.message}`);
        break;
      }
    }
  }
  return { transactions: out, errors };
}

async function redbarkTransactions(from, accountId) {
  try {
    return await redbarkTransactionsV2(from, accountId);
  } catch (e) {
    if (!shouldFallBackToV1(e)) throw e;
    return redbarkTransactionsV1(from, accountId);
  }
}

/* ── Up Bank (free personal API) ────────────────────────────── */

function up(path) {
  const token = process.env.UP_API_TOKEN;
  if (!token) throw new Error('Missing UP_API_TOKEN');
  return getJson(path.startsWith('http') ? path : UP_BASE + path, {
    Authorization: `Bearer ${token}`,
  });
}

/* Up returns amount.value as a decimal string ("-10.56") plus
   valueInBaseUnits as an integer (-1056). Prefer the integer: it is exact,
   where the string relies on float parsing. */
function upToFolio(t, accountName) {
  const a = t.attributes;
  const money = a.amount || {};
  const value = Number.isFinite(money.valueInBaseUnits)
    ? money.valueInBaseUnits / 100
    : parseFloat(money.value) || 0;
  // settledAt is null while a transaction is still HELD, so fall back to
  // createdAt rather than emitting a row with an empty date.
  const when = a.settledAt || a.createdAt || '';
  return {
    id: 'up-' + t.id,
    type: value > 0 ? 'income' : 'expense',
    amount: Math.abs(value),
    description: a.description || 'Up transaction',
    category: '',
    date: String(when).slice(0, 10),
    note: [accountName, a.message, a.rawText].filter(Boolean).join(' • '),
    bucket: 'none',
    source: 'up',
  };
}

async function upAccounts() {
  const res = await up('/accounts');
  return {
    connections: [{ id: 'up', institution: 'Up Bank', status: 'active' }],
    accounts: (res.data || []).map((a) => ({
      id: a.id,
      connectionId: 'up',
      name: a.attributes.displayName,
      type: a.attributes.accountType,
      masked: '',
      provider: 'up',
    })),
  };
}

async function upTransactions(from) {
  const out = [];
  const errors = [];
  let names = {};
  try {
    const accts = await up('/accounts');
    (accts.data || []).forEach((a) => (names[a.id] = a.attributes.displayName));
  } catch (e) {
    errors.push('up accounts: ' + e.message);
  }

  // filter[since] must be RFC-3339. Use a UTC instant rather than a hardcoded
  // +10:00 offset, which would be wrong during daylight saving.
  const since = new Date(from + 'T00:00:00Z').toISOString();
  let url = `${UP_BASE}/transactions?page[size]=100&filter[since]=${encodeURIComponent(since)}`;
  let pages = 0;
  while (url && pages < 50) {
    try {
      const page = await up(url);
      (page.data || []).forEach((t) => {
        const accId = t.relationships?.account?.data?.id;
        out.push(upToFolio(t, names[accId] || 'Up'));
      });
      url = page.links && page.links.next;
      pages++;
    } catch (e) {
      errors.push('up transactions: ' + e.message);
      break;
    }
  }
  return { transactions: out, errors };
}

/* ── public API ─────────────────────────────────────────────── */

function enabledProviders() {
  const list = [];
  if (process.env.REDBARK_API_KEY) list.push('redbark');
  if (process.env.UP_API_TOKEN) list.push('up');
  return list;
}

async function fetchAccounts() {
  const providers = enabledProviders();
  const connections = [];
  const accounts = [];
  const errors = [];
  for (const p of providers) {
    try {
      const r = p === 'redbark' ? await redbarkAccounts() : await upAccounts();
      connections.push(...r.connections);
      accounts.push(...r.accounts);
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  return { providers, connections, accounts, errors };
}

async function fetchTransactions(days, accountId) {
  const d = Math.min(Math.max(parseInt(days, 10) || 90, 1), 730);
  const from = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  const providers = enabledProviders();
  const transactions = [];
  const errors = [];
  for (const p of providers) {
    try {
      const r = p === 'redbark'
        ? await redbarkTransactions(from, accountId)
        : await upTransactions(from);
      transactions.push(...r.transactions);
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  transactions.sort((x, y) => (x.date < y.date ? 1 : -1));
  return { transactions, from, providers, errors };
}

module.exports = { enabledProviders, fetchAccounts, fetchTransactions };
