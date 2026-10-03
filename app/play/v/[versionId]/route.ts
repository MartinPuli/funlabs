import { workerClient } from '@/lib/supabase/worker';
import { versionHtml } from '@/lib/versions';
import { gameResponse, notFound } from '@/lib/http/game';

export const dynamic = 'force-dynamic';

/** Identified, immutable URL for a version that passed its checks. */
export async function GET(_request: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return notFound();
  const worker = await workerClient();
  const v = await worker.from('versions').select('id, status, content_sha256').eq('id', versionId).maybeSingle();
  if (!v.data || v.data.status !== 'ready') return notFound('Version not available: only versions that passed their checks are published.');
  const html = await versionHtml(worker, versionId);
  if (!html) return notFound();
  return gameResponse(html, { immutable: true, sha256: v.data.content_sha256 });
}
