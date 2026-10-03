import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';

export type JobKind = 'analyze_session' | 'run_checks' | 'intervention' | 'export_dataset';

export type JobRow = {
  id: string;
  study_id: string | null;
  kind: JobKind;
  idempotency_key: string;
  input: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  runner: string | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/**
 * Enqueues a job once. The idempotency key makes retries of uploads, webhooks
 * or button clicks land on the same job instead of duplicating evidence.
 */
export async function enqueueJob(
  worker: SupabaseClient,
  job: { studyId: string | null; kind: JobKind; key: string; input: Record<string, unknown>; maxAttempts?: number; createdBy?: string | null },
): Promise<JobRow> {
  const ins = await worker
    .from('jobs')
    .insert({ study_id: job.studyId, kind: job.kind, idempotency_key: job.key, input: job.input, max_attempts: job.maxAttempts ?? 3, created_by: job.createdBy ?? null })
    .select('*')
    .single();
  if (!ins.error) return ins.data as JobRow;
  if (ins.error.code !== '23505') throw new Error(`Enqueue job: ${ins.error.message}`);
  const existing = await worker.from('jobs').select('*').eq('idempotency_key', job.key).single();
  if (existing.error) throw new Error(`Read existing job: ${existing.error.message}`);
  return existing.data as JobRow;
}

/** Puts a failed job back in the queue (manual retry). */
export async function retryJob(worker: SupabaseClient, jobId: string) {
  const res = await worker
    .from('jobs')
    .update({ status: 'queued', run_after: new Date().toISOString(), max_attempts: 6, finished_at: null })
    .eq('id', jobId)
    .in('status', ['failed', 'cancelled'])
    .select('*')
    .maybeSingle();
  if (res.error) throw new Error(`Retry: ${res.error.message}`);
  return res.data as JobRow | null;
}

type Handler = (worker: SupabaseClient, job: JobRow) => Promise<Record<string, unknown>>;

async function handlerFor(kind: JobKind): Promise<Handler> {
  switch (kind) {
    case 'analyze_session':
      return (await import('./analysis/run.ts')).runAnalysisJob;
    case 'run_checks':
      return (await import('./checks/run.ts')).runChecksJob;
    case 'intervention':
      return (await import('./intervention/run.ts')).runInterventionJob;
    case 'export_dataset':
      return (await import('./export.ts')).runExportJob;
  }
}

export type TickReport = { processed: Array<{ id: string; kind: string; ok: boolean; error?: string; ms: number }>; stoppedBecause: 'empty' | 'deadline' | 'limit' };

/**
 * Claims and runs queued jobs until the queue is empty, the deadline passes or
 * the limit is reached. Each outcome is persisted; failures retry with backoff.
 */
export async function runJobs(worker: SupabaseClient, opts: { kinds?: JobKind[]; maxJobs?: number; deadlineMs?: number; workerId?: string } = {}): Promise<TickReport> {
  const kinds = opts.kinds ?? ['analyze_session', 'run_checks', 'intervention', 'export_dataset'];
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const maxJobs = opts.maxJobs ?? 10;
  const processed: TickReport['processed'] = [];
  const workerId = opts.workerId ?? `${env.runner}:${process.pid}`;
  while (processed.length < maxJobs) {
    if (Date.now() > deadline) return { processed, stoppedBecause: 'deadline' };
    const claim = await worker.rpc('claim_job', { p_kinds: kinds, p_worker: workerId, p_runner: env.runner });
    if (claim.error) throw new Error(`Claim job: ${claim.error.message}`);
    const job = (claim.data as JobRow[] | null)?.[0];
    if (!job) return { processed, stoppedBecause: 'empty' };
    const started = Date.now();
    try {
      const handler = await handlerFor(job.kind);
      const result = await handler(worker, job);
      await worker.rpc('finish_job', { p_job: job.id, p_ok: true, p_result: result, p_error: null });
      processed.push({ id: job.id, kind: job.kind, ok: true, ms: Date.now() - started });
      if (job.kind === 'analyze_session' && job.study_id) await (await import('./studies.ts')).syncStudyStatus(worker, job.study_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await worker.rpc('finish_job', { p_job: job.id, p_ok: false, p_result: null, p_error: message.slice(0, 2000) });
      processed.push({ id: job.id, kind: job.kind, ok: false, error: message, ms: Date.now() - started });
      if (job.kind === 'analyze_session' && job.study_id) await (await import('./studies.ts')).syncStudyStatus(worker, job.study_id).catch(() => undefined);
    }
  }
  return { processed, stoppedBecause: 'limit' };
}
