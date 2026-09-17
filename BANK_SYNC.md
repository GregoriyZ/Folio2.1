# Connecting ubank, NAB and ANZ to Folio

Two options. Start with the free one.

| | Free CSV import | Open Banking auto-sync |
|---|---|---|
| Cost | $0 forever | ~A$16/mo (7-day free trial) |
| Effort | Download a CSV, click import | One-time setup, then one click |
| Freshness | Whenever you export | On demand |
| Button | 🏛 Import Bank CSV | 🏦 Sync Banks |

---

# Option 1 — Bank CSV import (free)

There is **no fully free automated feed** for ubank, NAB or ANZ. Under the CDR
regime only accredited recipients can call bank APIs, and accreditation costs
far more than a subscription. The only free-forever sources are the CSV exports
the banks give you directly. (Up Bank offers a genuinely free personal API, but
only Up customers can use it — it does nothing for your three banks.)

So Folio has a CSV importer that understands the AU bank export formats:

1. **ubank** — app/web → Transactions → Export → CSV
2. **NAB** — Internet Banking → account → Transaction history → Export → CSV
3. **ANZ** — Internet Banking → account → Search/Export transactions → CSV

Then click **🏛 Import Bank CSV** in the Folio sidebar and pick the file.

It auto-detects:
- headerless `Date,Amount,Description` exports (classic ANZ/NAB)
- headered exports with a single signed `Amount` column
- exports with separate `Debit`/`Credit` (or Money In/Out) columns
- dates as `DD/MM/YYYY`, `DD/MM/YY`, `10 Sep 2026`, or ISO
- amounts with `$`, thousands commas, and `(1,250.00)` accounting negatives

Each row gets a deterministic id hashed from date + amount + description, so
**re-importing an overlapping file updates rather than duplicates**, and any
category or bucket you assigned by hand is preserved.

---

# Option 2 — Open Banking auto-sync (paid)

Pulls transactions automatically through **Consumer Data Right**.

## Why a paid provider is required here

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
