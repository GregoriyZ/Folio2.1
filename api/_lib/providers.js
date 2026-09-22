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

/* ── Redbark (CDR: ANZ, NAB, ubank, …) ─────────────────────── */

function redbark(path) {
  const key = process.env.REDBARK_API_KEY;
  if (!key) throw new Error('Missing REDBARK_API_KEY');
  return getJson(REDBARK_BASE + path, { Authorization: `Bearer ${key}` });
}

function redbarkToFolio(t, accountName) {
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

async function redbarkAccounts() {
  const [conns, accts] = await Promise.all([
    redbark('/v1/connections'),
    redbark('/v1/accounts'),
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

async function redbarkTransactions(from, accountId) {
  const accts = (await redbark('/v1/accounts')).data || [];
  const wanted = accountId ? accts.filter((a) => a.id === accountId) : accts;

  const out = [];
  const errors = [];
  // Sequential: heavy endpoints cap at 4 in-flight and 30/min per key.
  for (const a of wanted) {
    let offset = 0;
    for (;;) {
      try {
        const qs = `connectionId=${encodeURIComponent(a.connectionId)}&accountId=${encodeURIComponent(a.id)}&from=${from}&limit=200&offset=${offset}`;
        const page = await redbark('/v1/transactions?' + qs);
        (page.data || []).forEach((t) => out.push(redbarkToFolio(t, a.name || a.accountName)));
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

/* ── Up Bank (free personal API) ────────────────────────────── */

function up(path) {
  const token = process.env.UP_API_TOKEN;
  if (!token) throw new Error('Missing UP_API_TOKEN');
  return getJson(path.startsWith('http') ? path : UP_BASE + path, {
    Authorization: `Bearer ${token}`,
  });
}

function upToFolio(t, accountName) {
  const value = parseFloat(t.attributes.amount.value) || 0;
  const a = t.attributes;
  return {
    id: 'up-' + t.id,
    type: value > 0 ? 'income' : 'expense',
    amount: Math.abs(value),
    description: a.description || 'Up transaction',
    category: '',
    date: String(a.settledAt || a.createdAt || '').slice(0, 10),
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

  let url = `${UP_BASE}/transactions?page[size]=100&filter[since]=${encodeURIComponent(from + 'T00:00:00+10:00')}`;
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
