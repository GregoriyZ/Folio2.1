/*
 * /api/health — unauthenticated, safe deployment self-check.
 *
 * Open https://<your-folio>.vercel.app/api/health in a browser after a deploy
 * to confirm the new code is live and configured, without exposing any data.
 * It reports only whether each secret is PRESENT, never its value, and never
 * returns a transaction.
 */

const providers = require('./_lib/providers');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const env = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    FOLIO_SYNC_TOKEN: !!process.env.FOLIO_SYNC_TOKEN,
    REDBARK_API_KEY: !!process.env.REDBARK_API_KEY,
    UP_API_TOKEN: !!process.env.UP_API_TOKEN,
    CRON_SECRET: !!process.env.CRON_SECRET,
  };

  const bankConfigured = env.REDBARK_API_KEY || env.UP_API_TOKEN;
  const ready = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    && env.FOLIO_SYNC_TOKEN && bankConfigured;

  const next = [];
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    next.push('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.');
  }
  if (!env.FOLIO_SYNC_TOKEN) {
    next.push('Set FOLIO_SYNC_TOKEN in Vercel (openssl rand -hex 24), then redeploy.');
  }
  if (!bankConfigured) {
    next.push('Set REDBARK_API_KEY (ANZ/NAB/ubank) and/or UP_API_TOKEN, then redeploy.');
  }
  if (ready) {
    next.push('Open Folio, click "Sync Banks Now" once and paste your FOLIO_SYNC_TOKEN.');
  }

  res.status(200).json({
    ok: true,
    // Bumped whenever the sync pipeline changes, so you can confirm at a glance
    // that Vercel picked up the latest push.
    build: 'auto-sync-v2',
    ready,
    env,
    providers: providers.enabledProviders(),
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ? 'vercel' : 'local',
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    nextSteps: next,
  });
};
