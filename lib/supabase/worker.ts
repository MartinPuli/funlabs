import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.ts';

/**
 * The backend's own identity. In production it signs in as the dedicated
 * worker user (app_metadata.funlabs_role = 'worker'); RLS grants that user
 * exactly what processing needs. The service-role key is only a fallback for
 * local tooling. Testers and agents never receive either.
 */
let pending: Promise<{ client: SupabaseClient; expiresAt: number }> | null = null;
let cached: { client: SupabaseClient; expiresAt: number } | null = null;

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

async function signIn(): Promise<{ client: SupabaseClient; expiresAt: number }> {
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, clientOptions);
  const { data, error } = await client.auth.signInWithPassword({ email: env.workerEmail!, password: env.workerPassword! });
  if (error || !data.session) throw new Error(`No se pudo autenticar la identidad del backend: ${error?.message ?? 'sin sesión'}`);
  return { client, expiresAt: (data.session.expires_at ?? 0) * 1000 };
}

export async function workerClient(): Promise<SupabaseClient> {
  if (env.workerEmail && env.workerPassword) {
    if (cached && cached.expiresAt - 120_000 > Date.now()) return cached.client;
    if (!pending) {
      pending = signIn()
        .then((res) => {
          cached = res;
          return res;
        })
        .finally(() => {
          pending = null;
        });
    }
    return (await pending).client;
  }
  if (env.serviceRoleKey) return createClient(env.supabaseUrl, env.serviceRoleKey, clientOptions);
  throw new Error('Falta configurar la identidad del backend (FUNLABS_WORKER_EMAIL y FUNLABS_WORKER_PASSWORD).');
}

/** Throws a readable error when a query failed. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: sin resultado`);
  return res.data;
}
