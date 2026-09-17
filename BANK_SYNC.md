# Connecting ubank, NAB and ANZ to Folio

Folio now pulls real bank transactions through **Open Banking (Consumer Data Right)**.

## Why this approach

- Screen scraping your bank logins breaks their T&Cs and is fragile.
- Becoming a CDR **Accredited Data Recipient** yourself is a months-long, expensive process. Not viable for a personal app.
- So Folio sits behind an existing accredited provider. We use **Redbark**, a CDR Representative of **Fiskil** (ADR `ADRBNK000246`), which supports ubank, NAB and ANZ (plus ~100 other AU institutions) and sells to individual developers with a plain REST API.
- Alternative aggregators (Basiq, Frollo, Fiskil direct) are enterprise-sales oriented: real (non-sandbox) data needs a business contract. Redbark's Developer plan (A$16/mo, 7-day free trial) is the realistic path for one person.

## One-time setup

1. Sign up at <https://app.redbark.com> and connect **ubank**, **NAB** and **ANZ**. Each one sends you through your own bank's official CDR consent flow — you never give Folio your banking password.
2. Choose the **Developer** plan (API access starts at that tier; trials count).
3. Create an API key: Settings → API & MCP. Copy it, it is shown once.
4. In Vercel (project → Settings → Environment Variables) add:

   | Name | Value |
   |---|---|
   | `REDBARK_API_KEY` | the key from step 3 |
   | `FOLIO_SYNC_TOKEN` | any long random string, e.g. `openssl rand -hex 24` |

5. Redeploy.

## Using it

Click **🏦 Sync Banks** in the sidebar. The first time it asks for your `FOLIO_SYNC_TOKEN` (stored in localStorage), then asks how many days of history to import.

- Synced rows get stable IDs (`rb-<id>`), so re-syncing **updates** rather than duplicates.
- Category and bucket you set by hand on a synced row are preserved across syncs.
- `bankAccounts()` in the browser console lists your connected accounts.

## Endpoint

`/api/bank` (server-side proxy, so the Redbark key never reaches the browser):

- `GET /api/bank?action=accounts` — connections and accounts
- `GET /api/bank?action=transactions&days=90[&accountId=…]` — Folio-shaped transactions

Both require the header `X-Folio-Token: <FOLIO_SYNC_TOKEN>`. Without it you'd have an open proxy to your bank data.

## Notes

- CDR signs amounts: negative = debit → Folio `expense`, positive = credit → Folio `income`.
- Only posted transactions are returned; pending ones are excluded upstream.
- Redbark caches transactions ~60 min per connection, so syncing more often than hourly returns the same rows.
- Rate limits: 30/min on transactions, 4 concurrent. The proxy fetches accounts sequentially to stay under.
- CDR consents expire (up to 12 months). Re-authorise at app.redbark.com when a connection goes stale.
- Once data lands in Folio it is outside the CDR framework and under your own control. Your Supabase row holds real transaction data — keep the service role key secret.
