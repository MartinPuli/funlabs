import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobRow } from '../jobs.ts';
import { env } from '../env.ts';
import { versionHtml } from '../versions.ts';
import { runHeadlessSuite, suitePassed, type SuiteDefinition } from './suite.ts';

/**
 * Runs the study's frozen check suite on a version. A variant only becomes
 * available to participants when every check passes; otherwise it is
 * rejected and the intervention is marked as failing its checks.
 */
export async function runChecksJob(worker: SupabaseClient, job: JobRow): Promise<Record<string, unknown>> {
  const input = job.input as { version_id: string; baseline_version_id: string | null; suite_id: string; intervention_id?: string };
  const suite = await worker.from('check_suites').select('id, definition, sha256').eq('id', input.suite_id).single();
  if (suite.error) throw new Error(`Checks not found: ${suite.error.message}`);
  const candidate = await versionHtml(worker, input.version_id);
  if (!candidate) throw new Error('The version file was not found');
  const baseline = input.baseline_version_id ? await versionHtml(worker, input.baseline_version_id) : undefined;
  if (input.baseline_version_id && !baseline) throw new Error('The baseline version was not found');

  const results = runHeadlessSuite(suite.data.definition as SuiteDefinition, candidate, baseline ?? undefined);
  const runner = `node-vm (${env.runner})`;
  const rows = results.map((r) => ({
    study_id: job.study_id,
    version_id: input.version_id,
    suite_id: input.suite_id,
    job_id: job.id,
    runner,
    check_key: r.key,
    label: r.label,
    status: r.status,
    summary: r.summary,
    details: r.details,
    duration_ms: r.durationMs,
  }));
  const ins = await worker.from('checks').insert(rows);
  if (ins.error) throw new Error(`Save checks: ${ins.error.message}`);

  const passed = suitePassed(results);
  const version = await worker.from('versions').select('id, status').eq('id', input.version_id).single();
  if (version.data?.status === 'checking') {
    await worker.from('versions').update({ status: passed ? 'ready' : 'rejected' }).eq('id', input.version_id);
    if (passed && job.study_id) {
      await worker.from('study_versions').upsert({ study_id: job.study_id, version_id: input.version_id, role: 'variant' }, { onConflict: 'study_id,version_id' });
    }
    if (input.intervention_id) {
      await worker.from('interventions').update({ status: passed ? 'ready' : 'checks_failed' }).eq('id', input.intervention_id);
    }
  }
  return {
    passed,
    runner,
    suite_sha256: suite.data.sha256,
    results: results.map((r) => ({ key: r.key, status: r.status, summary: r.summary })),
  };
}
