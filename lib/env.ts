/**
 * Server configuration. Provider keys are optional: when one is missing the
 * product shows an explicit "not configured" state instead of inventing data.
 */
function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  workerEmail: process.env.FUNLABS_WORKER_EMAIL,
  workerPassword: process.env.FUNLABS_WORKER_PASSWORD,
  cronSecret: process.env.FUNLABS_CRON_SECRET,
  geminiKey: process.env.GEMINI_API_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  analysisModel: process.env.FUNLABS_ANALYSIS_MODEL ?? 'gemini-3.8-flash',
  interventionModel: process.env.FUNLABS_INTERVENTION_MODEL ?? 'claude-opus-5-5',
  stripeSecret: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  get siteUrl() {
    return siteUrl();
  },
  /** Where jobs run. Reported honestly on every job and check. */
  get runner(): string {
    if (process.env.FUNLABS_RUNNER) return process.env.FUNLABS_RUNNER;
    if (process.env.VERCEL) return 'vercel-function';
    return 'local';
  },
};

export type ProviderStatus = {
  gemini: { configured: boolean; via: 'gemini-api' | 'ai-gateway' | null; model: string };
  claude: { configured: boolean; via: 'anthropic-api' | 'ai-gateway' | null; model: string };
  stripe: { configured: boolean; mode: 'test' | null };
  worker: { configured: boolean; via: 'worker-identity' | 'service-role' | null };
  supabase: { configured: boolean };
};

/** Vercel injects an OIDC token at runtime, which AI Gateway accepts. */
function gatewayAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

export function providerStatus(): ProviderStatus {
  const stripeTest = Boolean(env.stripeSecret && env.stripeSecret.startsWith('sk_test_'));
  return {
    gemini: {
      configured: Boolean(env.geminiKey) || gatewayAvailable(),
      via: env.geminiKey ? 'gemini-api' : gatewayAvailable() ? 'ai-gateway' : null,
      model: env.analysisModel,
    },
    claude: {
      configured: Boolean(env.anthropicKey) || gatewayAvailable(),
      via: env.anthropicKey ? 'anthropic-api' : gatewayAvailable() ? 'ai-gateway' : null,
      model: env.interventionModel,
    },
    stripe: { configured: stripeTest, mode: stripeTest ? 'test' : null },
    worker: {
      configured: Boolean((env.workerEmail && env.workerPassword) || env.serviceRoleKey),
      via: env.workerEmail && env.workerPassword ? 'worker-identity' : env.serviceRoleKey ? 'service-role' : null,
    },
    supabase: { configured: Boolean(env.supabaseUrl && env.supabaseAnonKey) },
  };
}
