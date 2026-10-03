import { NextResponse } from 'next/server';
import { workerClient } from '@/lib/supabase/worker';
import { runJobs } from '@/lib/jobs';
import { syncStudyStatus } from '@/lib/studies';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Called every minute by pg_cron + pg_net when jobs are waiting. */
export async function POST(request: Request) {
  const secret = request.headers.get('x-funlabs-cron') ?? '';
  if (!env.cronSecret || !safeEqual(secret, env.cronSecret)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const worker = await workerClient();
  const report = await runJobs(worker, { maxJobs: 8, deadlineMs: 270_000 });
  const studies = new Set<string>();
  for (const p of report.processed) {
    const j = await worker.from('jobs').select('study_id').eq('id', p.id).single();
    if (j.data?.study_id) studies.add(j.data.study_id);
  }
  for (const s of studies) await syncStudyStatus(worker, s);
  return NextResponse.json(report);
}
