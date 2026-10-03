import { NextResponse } from 'next/server';
import { createUserClient } from '@/lib/supabase/server';
import { workerClient } from '@/lib/supabase/worker';
import { runJobs } from '@/lib/jobs';
import { syncStudyStatus } from '@/lib/studies';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** A creator asks the backend to process the queue now (the lab calls this after queuing work). */
export async function POST(request: Request) {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { study_id?: string };
  if (body.study_id) {
    const visible = await supabase.from('studies').select('id').eq('id', body.study_id).maybeSingle();
    if (!visible.data) return NextResponse.json({ error: 'No access to the study' }, { status: 403 });
  }
  const worker = await workerClient();
  const report = await runJobs(worker, { maxJobs: 6, deadlineMs: 270_000 });
  if (body.study_id) await syncStudyStatus(worker, body.study_id);
  return NextResponse.json(report);
}
