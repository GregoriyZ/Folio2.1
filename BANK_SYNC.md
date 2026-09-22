# Automatic bank sync for Folio

Folio pulls ANZ, NAB, ubank (and Up) transactions on its own, categorises them,
and writes them into your ledger. You do not click anything: open Folio and the
numbers are already current.

## How it works

```
Vercel Cron (daily, 19:00 UTC)─┐
Opening Folio in a browser    ─┼──▶  /api/sync  ──▶  banks (Open Banking / CDR)
Clicking "Sync Banks Now"     ─┘                 └─▶  auto-categorise new rows
                                                 └─▶  merge into Supabase
                                                            │
                                    Folio loads ◀───────────┘
```

Key points:

- The sync runs **server-side**. Folio does not have to be open for new
  transactions to land, so nothing piles up while you are not looking.
- Every Supabase round trip doubles as a keepalive, so a free-tier project
  **never pauses for inactivity** again.
- Rows keep a stable bank id (`rb-…`, `up-…`), so re-syncing an overlapping
  window updates rather than duplicates.
- **Your edits always win.** Once a row exists in the ledger, a later sync only
  refreshes the bank-owned fields (amount, date). Whatever category or bucket
  you set by hand stays.

---

## One-time setup

### 1. Connect your banks (ANZ, NAB, ubank)

There is no free automated feed for these three. Under the Consumer Data Right
only accredited recipients can call bank APIs, and accreditation costs far more
than a subscription. So Folio sits behind an accredited provider.

Use **Redbark** (CDR Representative of Fiskil, ADR `ADRBNK000246`). It is the
only AU aggregator that sells to individuals with a plain REST API.

1. Sign up at <https://app.redbark.com> and connect **ANZ**, **NAB** and
   **ubank**. Each goes through your own bank's official CDR consent screen —
   Folio never sees a banking password.
2. Pick the **Developer** plan, A$16/mo (7-day free trial). API access starts at
   that tier and it allows 6 connections / 24 accounts, which covers your four
   accounts comfortably. The A$10 Saver plan is cheaper but has **no API
   access**, so it cannot feed Folio.
3. Settings → API & MCP → create an API key. Copy it, it is shown once.
   Folio calls **Redbark API v2**, so the key needs the `data:read` scope
   (legacy keys created before scopes existed already hold every read scope).
   If v2 is ever unavailable for your key, Folio automatically falls back to
   the older v1 API rather than failing.

### 2. Up Bank (free, optional)

If one of your accounts is Up, it has a genuinely free personal API and needs no
subscription: <https://api.up.com.au/getting_started> → copy your personal
access token (`up:yeah:…`).

Providers are independent. Set either, or both, and the sync merges whatever is
configured.

### 3. Vercel environment variables

Project → Settings → Environment Variables:

| Name | Value | Required |
|---|---|---|
| `SUPABASE_URL` | your Supabase project URL | yes (already set) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | yes (already set) |
| `FOLIO_SYNC_TOKEN` | any long random string — `openssl rand -hex 24` | yes |
| `REDBARK_API_KEY` | key from step 1.3 (`rbk_live_…`) | for ANZ/NAB/ubank |
| `REDBARK_API_VERSION` | optional; API v2 release, default `2026-10-01.wattle` | optional |
| `UP_API_TOKEN` | `up:yeah:…` | for Up only |
| `CRON_SECRET` | optional; when set, Vercel sends it as a bearer on cron calls and the sync requires it | optional |
| `SYNC_DAYS` | optional; history window for the scheduled run (default 45) | optional |

Then redeploy.

### 4. Tell the browser the token, once

Open Folio, click **🏦 Sync Banks Now**, paste your `FOLIO_SYNC_TOKEN`. It is
stored in localStorage and you will not be asked again on that device. From then
on syncing is silent and automatic.

---

## What you get

- **🏦 Banks: 2h ago** in the sidebar — how fresh the ledger is, at a glance.
  It also tells you plainly when something is wrong: *not connected*,
  *sync token needed*, *no provider configured*, or *sync unavailable*.
- **Daily cron** at 19:00 UTC (05:00 AEST / 06:00 AEDT) pulls the last 45 days.
  Vercel cron timezones are always UTC and Hobby allows one run per day with
  ±59 min precision, so this is the most frequent schedule the free plan permits.
- **On page load** Folio refreshes in the background if the last sync is over an
  hour old (Redbark caches ~60 min, so syncing more often returns the same rows).
- **Returning to the tab** re-checks too.
- **🏦 Sync Banks Now** forces an immediate pull.

## Auto-categorisation

New rows are matched against AU merchant patterns and land in the right Folio
category automatically — Woolworths → Groceries, Seven Seeds → Coffee, BP →
Fuel, Netflix → Subscriptions, salary credits → Salary / Wages, Centrelink →
Government, and so on.

Transfers to savings and buys through Vanguard / CommSec / Pearler etc. are
promoted to `savings` / `investment` type, so moving money around does not get
counted as spending.

Anything unmatched lands in **Other**. Re-categorise it once in Folio and it
stays that way forever.

To tune the rules, edit `api/_lib/categorise.js` — it is a plain list of
`[categoryId, regex]` pairs.

---

## Endpoints

All require `X-Folio-Token: <FOLIO_SYNC_TOKEN>` (or `?token=`), otherwise you
would have an open proxy to your bank data. Vercel Cron is authorised separately.

| Call | Does |
|---|---|
| `GET /api/sync` | run a sync now over the default window (`SYNC_DAYS`, 45) |
| `GET /api/sync?days=90` | run a sync over a custom window |
| `GET /api/sync?action=status` | last sync time, row count, active providers |
| `GET /api/sync?action=accounts` | list connected bank accounts |
| `GET /api/sync?action=ping` | Supabase keepalive only |

The cron entry deliberately has **no query string** — Vercel cron paths are
requested as-is, so the scheduled window comes from `SYNC_DAYS` instead.
Scheduled calls are authorised by Vercel's `vercel-cron/1.0` user agent, or by
`CRON_SECRET` as a bearer token when you set one (recommended).

In the browser console: `bankStatus()`, `bankAccounts()`, `bankSync()`.

## Still available: free CSV import

If you would rather not pay, **🏛 Import Bank CSV** still works with the CSV
exports ANZ, NAB and ubank give you. It auto-detects the AU formats (headerless
`Date,Amount,Description`, signed amount columns, separate Debit/Credit columns,
`DD/MM/YYYY` and ISO dates, `$`/comma/accounting negatives) and hashes each row
to a deterministic id, so re-importing an overlapping file updates rather than
duplicates. It is just not automatic.

## Notes

- CDR signs amounts: negative = debit → Folio `expense`, positive = credit →
  `income`. Only posted transactions are returned; pending ones are excluded.
  Redbark v2 reports money in integer minor units (`{amount: 1250}` = $12.50)
  and Folio converts it, so figures are exact rather than float-parsed.
- Brokerage accounts are skipped by the transaction sync — Redbark exposes
  those through `/holdings` instead, which Folio does not read.
- Redbark rate limits: 30/min on the heavy tier with 4 requests in flight. The
  sync fetches accounts sequentially to stay under.
- CDR consents expire (up to 12 months). Re-authorise at app.redbark.com when a
  connection goes stale — `?action=accounts` reports each connection's status
  and consent expiry, and a revoked key surfaces as an error rather than a
  silently empty sync.
- Vercel Hobby allows one cron run per day, invoked only on **production**
  deployments. Combined with the on-load refresh that is plenty, given the
  ~60 min upstream cache.
- Once data lands in Folio it is outside the CDR framework and under your own
  control. Keep the Supabase service role key secret.

---

## Important: Deployment Protection

Your project currently has **Deployment Protection** enabled — every URL
returns a `302` redirect to a Vercel login instead of serving the app.

This matters because **Vercel cron jobs do not follow redirects**. If the URL
the cron calls is protected, the scheduled sync is treated as complete the
moment it receives the 302, and your transactions never get pulled.

Check **Settings → Deployment Protection** in the Vercel dashboard:

- If the scope is **Standard Protection**, your production *domain* stays
  public and the cron works. Only the generated `*-hash.vercel.app` URLs are
  protected, which is why they redirect for me but the app still works for you.
- If the scope is **All Deployments**, the production domain is protected too,
  and the cron will silently do nothing. Either switch to Standard Protection,
  or enable **Protection Bypass for Automation** (Settings → Deployment
  Protection → Protection Bypass for Automation) so automated callers get
  through.

To confirm the cron is actually running, open **Settings → Cron Jobs → View
Logs** after 19:00 UTC (5am AEST). A run that returns `200` is working; a `302`
means protection is blocking it.

Even if the cron is blocked, the in-app sync still works whenever you open
Folio, because your browser follows the login redirect and carries your
session.

## Checking a deploy

Folio deploys automatically from GitHub. After a push, open:

```
https://<your-folio>.vercel.app/api/health
```

It needs no token and returns no financial data — only whether each secret is
**present** (never its value) and what to do next. Look for:

- `"build": "auto-sync-v2"` — confirms Vercel picked up the auto-sync code
- `"ready": true` — everything needed for syncing is configured
- `"nextSteps"` — the exact remaining setup, if any

If `ready` is `false`, `nextSteps` tells you which environment variable is
missing. Add it in Vercel → Settings → Environment Variables and redeploy.
