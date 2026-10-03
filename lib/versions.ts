import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from './game/regions.ts';
import { buildSuiteDefinition, suiteDigest, SUITE_ID, SUITE_VERSION, type SuiteDefinition } from './checks/suite.ts';
import { GRAVITY_ROOM_ROUTE } from './game/builds.generated.ts';

export type VersionRow = {
  id: string;
  product_id: string;
  label: string;
  parent_version_id: string | null;
  status: 'checking' | 'ready' | 'rejected';
  origin: 'repository' | 'agent_intervention' | 'upload';
  content_sha256: string;
  bytes: number;
  notes: string;
  created_at: string;
};

/**
 * Registers an immutable single-file build. Idempotent: the same content for
 * the same product returns the existing version.
 */
export async function registerVersion(
  worker: SupabaseClient,
  input: { productId: string; label: string; html: string; origin: VersionRow['origin']; status: VersionRow['status']; parentVersionId?: string | null; notes?: string; createdBy?: string | null },
): Promise<VersionRow> {
  const digest = sha256(input.html);
  const bytes = Buffer.byteLength(input.html, 'utf8');
  const existing = await worker.from('versions').select('*').eq('product_id', input.productId).eq('content_sha256', digest).maybeSingle();
  if (existing.error) throw new Error(`Buscar versión: ${existing.error.message}`);
  if (existing.data) return existing.data as VersionRow;

  const ins = await worker
    .from('versions')
    .insert({
      product_id: input.productId,
      label: input.label,
      parent_version_id: input.parentVersionId ?? null,
      status: input.status,
      origin: input.origin,
      content_sha256: digest,
      bytes,
      notes: input.notes ?? '',
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single();
  if (ins.error) throw new Error(`Registrar versión: ${ins.error.message}`);
  const file = await worker.from('version_files').insert({ version_id: ins.data.id, path: 'index.html', content: input.html, sha256: digest, bytes });
  if (file.error) {
    await worker.from('versions').delete().eq('id', ins.data.id);
    throw new Error(`Guardar archivo de la versión: ${file.error.message}`);
  }
  return ins.data as VersionRow;
}

export async function versionHtml(client: SupabaseClient, versionId: string): Promise<string | null> {
  const res = await client.from('version_files').select('content, sha256').eq('version_id', versionId).eq('path', 'index.html').maybeSingle();
  if (res.error || !res.data) return null;
  if (sha256(res.data.content) !== res.data.sha256) throw new Error('El contenido de la versión no coincide con su hash');
  return res.data.content as string;
}

export function currentSuiteDefinition(): SuiteDefinition {
  return buildSuiteDefinition(GRAVITY_ROOM_ROUTE);
}

/** Returns the frozen suite row for this definition, creating it if needed. */
export async function ensureCheckSuite(worker: SupabaseClient, productId: string, def: SuiteDefinition = currentSuiteDefinition()) {
  const digest = suiteDigest(def);
  const found = await worker.from('check_suites').select('*').eq('product_id', productId).eq('sha256', digest).maybeSingle();
  if (found.error) throw new Error(`Buscar comprobaciones: ${found.error.message}`);
  if (found.data) return found.data as { id: string; sha256: string; definition: SuiteDefinition };
  const ins = await worker
    .from('check_suites')
    .insert({ product_id: productId, suite_key: SUITE_ID, suite_version: SUITE_VERSION, definition: def, sha256: digest })
    .select('*')
    .single();
  if (ins.error) throw new Error(`Fijar comprobaciones: ${ins.error.message}`);
  return ins.data as { id: string; sha256: string; definition: SuiteDefinition };
}
