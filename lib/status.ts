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
  return await Promise.race([fn(), new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms))]);
}

/** Facts about this deployment. Provider checks are free metadata calls, cached for a minute. */
export async function getPlatformStatus(force = false): Promise<PlatformStatus> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const providers = providerStatus();
  const integrations: Integration[] = [];
  let database: PlatformStatus['database'] = null;

  // Supabase
  if (!providers.supabase.configured || !providers.worker.configured) {
    integrations.push({ key: 'supabase', name: 'Supabase', state: 'not_configured', role: 'Auth, Postgres con RLS, Storage privado, Realtime, pg_cron y Vault', detail: 'Faltan NEXT_PUBLIC_SUPABASE_URL, la clave pública o la identidad del backend.', checkedBy: 'Variables de entorno' });
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
        role: 'Auth, Postgres con RLS, Storage privado, Realtime, pg_cron y Vault',
        detail: `${database!.rls_tables} de ${database!.public_tables} tablas con RLS, ${database!.buckets.length} buckets privados, ${database!.realtime_tables} tablas en Realtime, backend con ${providers.worker.via === 'worker-identity' ? 'identidad dedicada (sin clave de servicio)' : 'clave de servicio (solo desarrollo)'}.`,
        checkedBy: 'Consulta real a la base con la identidad del backend',
      });
    } catch (err) {
      integrations.push({ key: 'supabase', name: 'Supabase', state: 'error', role: 'Auth, Postgres con RLS, Storage privado, Realtime, pg_cron y Vault', detail: err instanceof Error ? err.message : String(err), checkedBy: 'Consulta real a la base' });
    }
  }

  // Gemini
  if (!providers.gemini.configured) {
    integrations.push({ key: 'gemini', name: 'Gemini', state: 'not_configured', role: 'Análisis de grabaciones y comentarios con hallazgos verificables', detail: 'Sin GEMINI_API_KEY ni AI Gateway: los análisis fallan con un mensaje claro y se pueden agregar hallazgos a mano.', checkedBy: 'Variables de entorno' });
  } else if (providers.gemini.via === 'gemini-api') {
    try {
      const r = await timed(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.analysisModel}`, { headers: { 'x-goog-api-key': env.geminiKey! } }));
      integrations.push({ key: 'gemini', name: 'Gemini', state: r.ok ? 'active' : 'error', role: 'Análisis de grabaciones y comentarios con hallazgos verificables', detail: r.ok ? `Modelo ${env.analysisModel} disponible por la API de Gemini. La inferencia ocurre en el servicio de Google.` : `La API respondió ${r.status}.`, checkedBy: 'GET del modelo (metadatos, sin costo)' });
    } catch (err) {
      integrations.push({ key: 'gemini', name: 'Gemini', state: 'error', role: 'Análisis de grabaciones y comentarios con hallazgos verificables', detail: err instanceof Error ? err.message : String(err), checkedBy: 'GET del modelo' });
    }
  } else {
    integrations.push({ key: 'gemini', name: 'Gemini', state: 'active', role: 'Análisis de grabaciones y comentarios con hallazgos verificables', detail: `Modelo google/${env.analysisModel} por Vercel AI Gateway (credencial OIDC del proyecto, sin clave en el repositorio).`, checkedBy: 'Entorno de Vercel' });
  }

  // Claude
  if (!providers.claude.configured) {
    integrations.push({ key: 'claude', name: 'Claude', state: 'not_configured', role: 'Agente creador: propone y escribe la intervención acotada', detail: 'Sin ANTHROPIC_API_KEY: las intervenciones se pueden entregar por la API de agentes.', checkedBy: 'Variables de entorno' });
  } else if (providers.claude.via === 'anthropic-api') {
    try {
      const r = await timed(() => fetch(`https://api.anthropic.com/v1/models/${env.interventionModel}`, { headers: { 'x-api-key': env.anthropicKey!, 'anthropic-version': '2023-06-01' } }));
      integrations.push({ key: 'claude', name: 'Claude', state: r.ok ? 'active' : 'error', role: 'Agente creador: propone y escribe la intervención acotada', detail: r.ok ? `Modelo ${env.interventionModel} con salida estructurada, razonamiento adaptativo y caché de prompt.` : `La API respondió ${r.status}.`, checkedBy: 'GET del modelo (metadatos, sin costo)' });
    } catch (err) {
      integrations.push({ key: 'claude', name: 'Claude', state: 'error', role: 'Agente creador: propone y escribe la intervención acotada', detail: err instanceof Error ? err.message : String(err), checkedBy: 'GET del modelo' });
    }
  } else {
    integrations.push({ key: 'claude', name: 'Claude', state: 'active', role: 'Agente creador: propone y escribe la intervención acotada', detail: 'Por Vercel AI Gateway.', checkedBy: 'Entorno de Vercel' });
  }

  // Vercel
  const onVercel = Boolean(process.env.VERCEL);
  integrations.push({
    key: 'vercel',
    name: 'Vercel',
    state: onVercel ? 'active' : 'not_used',
    role: 'Aloja la interfaz, la API, el MCP y las versiones jugables en URLs identificadas',
    detail: onVercel ? `Desplegado en ${process.env.VERCEL_ENV ?? 'entorno desconocido'}, región ${process.env.VERCEL_REGION ?? '?'}.` : 'Este entorno no corre en Vercel (desarrollo local).',
    checkedBy: 'Variables del sistema de Vercel',
  });

  // Stripe
  integrations.push({
    key: 'stripe',
    name: 'Stripe',
    state: providers.stripe.configured ? 'active' : 'not_configured',
    role: 'Cobro del estudio y pagos a testers u operadores, solo en modo prueba',
    detail: providers.stripe.configured ? 'Clave de prueba configurada (sk_test).' : 'No configurado en este entorno: el presupuesto y los pagos se registran internamente en modo prueba y no son una transferencia.',
    checkedBy: 'Variables de entorno',
  });

  // Supabase Compute
  integrations.push({
    key: 'compute',
    name: 'Supabase Compute',
    state: 'not_used',
    role: 'Worker de procesamiento y entornos aislados para trabajos de agentes',
    detail: `No se usa todavía: el aprovisionamiento y las dependencias no están verificados. Los trabajos corren en ${env.runner} con el mismo código (scripts/worker.mjs).`,
    checkedBy: 'Declaración de este despliegue',
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
