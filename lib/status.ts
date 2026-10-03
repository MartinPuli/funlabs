import { env, providerStatus } from './env.ts';
import { workerClient } from './supabase/worker.ts';

export type Integration = {
  key: string;
  name: string;
  state: 'active' | 'not_configured' | 'error' | 'not_used';
  role: string;
  detail: string;
  checkedBy: string;
};

export type PlatformStatus = {
  generatedAt: string;
  environment: { runner: string; vercel: boolean; vercelEnv: string | null; region: string | null; siteUrl: string };
  integrations: Integration[];
  database: null | {
    extensions: string[];
    cron_jobs: Array<{ name: string; schedule: string; active: boolean }>;
    wakeup_configured: boolean;
    realtime_tables: number;
    buckets: Array<{ id: string; public: boolean }>;
    jobs: { queued: number; running: number; failed: number; succeeded: number };
    rls_tables: number;
    public_tables: number;
  };
};

let cache: { at: number; value: PlatformStatus } | null = null;

async function timed<T>(fn: () => Promise<T>, ms = 6000): Promise<T> {
  return await Promise.race([fn(), new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms))]);
}

/** Facts about this deployment. Provider checks are free metadata calls, cached for a minute. */
export async function getPlatformStatus(force = false): Promise<PlatformStatus> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const providers = providerStatus();
  const integrations: Integration[] = [];
  let database: PlatformStatus['database'] = null;

  // Supabase
  if (!providers.supabase.configured || !providers.worker.configured) {
    integrations.push({ key: 'supabase', name: 'Supabase', state: 'not_configured', role: 'Auth, Postgres with RLS, private Storage, Realtime, pg_cron and Vault', detail: 'NEXT_PUBLIC_SUPABASE_URL, the public key or the backend identity is missing.', checkedBy: 'Environment variables' });
  } else {
    try {
      const worker = await workerClient();
      const res = await timed(async () => worker.rpc('platform_status'));
      if (res.error) throw new Error(res.error.message);
      database = res.data as PlatformStatus['database'];
      integrations.push({
        key: 'supabase',
        name: 'Supabase',
        state: 'active',
        role: 'Auth, Postgres with RLS, private Storage, Realtime, pg_cron and Vault',
        detail: `${database!.rls_tables} of ${database!.public_tables} tables with RLS, ${database!.buckets.length} private buckets, ${database!.realtime_tables} tables in Realtime, backend using ${providers.worker.via === 'worker-identity' ? 'a dedicated identity (no service key)' : 'a service key (development only)'}.`,
        checkedBy: 'Real database query with the backend identity',
      });
    } catch (err) {
      integrations.push({ key: 'supabase', name: 'Supabase', state: 'error', role: 'Auth, Postgres with RLS, private Storage, Realtime, pg_cron and Vault', detail: err instanceof Error ? err.message : String(err), checkedBy: 'Real database query' });
    }
  }

  // Gemini
  if (!providers.gemini.configured) {
    integrations.push({ key: 'gemini', name: 'Gemini', state: 'not_configured', role: 'Analysis of recordings and comments with verifiable findings', detail: 'No GEMINI_API_KEY or AI Gateway: analyses fail with a clear message and findings can be added by hand.', checkedBy: 'Environment variables' });
  } else if (providers.gemini.via === 'gemini-api') {
    try {
      const r = await timed(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.analysisModel}`, { headers: { 'x-goog-api-key': env.geminiKey! } }));
      integrations.push({ key: 'gemini', name: 'Gemini', state: r.ok ? 'active' : 'error', role: 'Analysis of recordings and comments with verifiable findings', detail: r.ok ? `Model ${env.analysisModel} available through the Gemini API. Inference runs in Google's service.` : `The API responded ${r.status}.`, checkedBy: 'GET of the model (metadata, no cost)' });
    } catch (err) {
      integrations.push({ key: 'gemini', name: 'Gemini', state: 'error', role: 'Analysis of recordings and comments with verifiable findings', detail: err instanceof Error ? err.message : String(err), checkedBy: 'GET of the model' });
    }
  } else {
    integrations.push({ key: 'gemini', name: 'Gemini', state: 'active', role: 'Analysis of recordings and comments with verifiable findings', detail: `Model google/${env.analysisModel} through Vercel AI Gateway (project OIDC credential, no key in the repository).`, checkedBy: 'Vercel environment' });
  }

  // Claude
  if (!providers.claude.configured) {
    integrations.push({ key: 'claude', name: 'Claude', state: 'not_configured', role: 'Creator agent: proposes and writes the scoped intervention', detail: 'No ANTHROPIC_API_KEY: interventions can still be submitted through the agent API.', checkedBy: 'Environment variables' });
  } else if (providers.claude.via === 'anthropic-api') {
    try {
      const r = await timed(() => fetch(`https://api.anthropic.com/v1/models/${env.interventionModel}`, { headers: { 'x-api-key': env.anthropicKey!, 'anthropic-version': '2023-06-01' } }));
      integrations.push({ key: 'claude', name: 'Claude', state: r.ok ? 'active' : 'error', role: 'Creator agent: proposes and writes the scoped intervention', detail: r.ok ? `Model ${env.interventionModel} with structured output, adaptive thinking and prompt caching.` : `The API responded ${r.status}.`, checkedBy: 'GET of the model (metadata, no cost)' });
    } catch (err) {
      integrations.push({ key: 'claude', name: 'Claude', state: 'error', role: 'Creator agent: proposes and writes the scoped intervention', detail: err instanceof Error ? err.message : String(err), checkedBy: 'GET of the model' });
    }
  } else {
    integrations.push({ key: 'claude', name: 'Claude', state: 'active', role: 'Creator agent: proposes and writes the scoped intervention', detail: 'Through Vercel AI Gateway.', checkedBy: 'Vercel environment' });
  }

  // Vercel
  const onVercel = Boolean(process.env.VERCEL);
  integrations.push({
    key: 'vercel',
    name: 'Vercel',
    state: onVercel ? 'active' : 'not_used',
    role: 'Hosts the interface, the API, the MCP server and the playable versions at identified URLs',
    detail: onVercel ? `Deployed to ${process.env.VERCEL_ENV ?? 'an unknown environment'}, region ${process.env.VERCEL_REGION ?? '?'}.` : 'This environment does not run on Vercel (local development).',
    checkedBy: 'Vercel system variables',
  });

  // Stripe
  integrations.push({
    key: 'stripe',
    name: 'Stripe',
    state: providers.stripe.configured ? 'active' : 'not_configured',
    role: 'Charging for the study and paying testers or operators, test mode only',
    detail: providers.stripe.configured ? 'Test key configured (sk_test).' : 'Not configured in this environment: the budget and payouts are recorded internally in test mode and are not a transfer.',
    checkedBy: 'Environment variables',
  });

  // Supabase Compute
  integrations.push({
    key: 'compute',
    name: 'Supabase Compute',
    state: 'not_used',
    role: 'Processing worker and isolated environments for agent jobs',
    detail: `Not used yet: provisioning and dependencies are not verified. Jobs run on ${env.runner} with the same code (scripts/worker.mjs).`,
    checkedBy: 'Declaration of this deployment',
  });

  const value: PlatformStatus = {
    generatedAt: new Date().toISOString(),
    environment: { runner: env.runner, vercel: onVercel, vercelEnv: process.env.VERCEL_ENV ?? null, region: process.env.VERCEL_REGION ?? null, siteUrl: env.siteUrl },
    integrations,
    database,
  };
  cache = { at: Date.now(), value };
  return value;
}
