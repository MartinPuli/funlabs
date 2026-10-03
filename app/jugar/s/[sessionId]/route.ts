import { workerClient } from '@/lib/supabase/worker';
import { versionHtml } from '@/lib/versions';
import { gameResponse, notFound } from '@/lib/http/game';

export const dynamic = 'force-dynamic';

/**
 * The build a participant plays in one session. The URL carries no version
 * label, so the comparison stays blind; the session id is unguessable.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return notFound();
  const worker = await workerClient();
  const s = await worker.from('sessions').select('version_id, status').eq('id', sessionId).maybeSingle();
  if (!s.data) return notFound('Sesión no encontrada');
  const html = await versionHtml(worker, s.data.version_id);
  if (!html) return notFound('Versión no encontrada');
  return gameResponse(html, { immutable: false });
}
