import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobRow } from '../jobs.ts';
import { enqueueJob } from '../jobs.ts';
import { applyScopedEdits, type Edit } from '../game/patch.ts';
import { unifiedDiff } from '../game/diff.ts';
import { runHeadlessSuite, suitePassed, type SuiteDefinition } from '../checks/suite.ts';
import { registerVersion, versionHtml } from '../versions.ts';
import { proposeIntervention, INTERVENTION_PROMPT_VERSION, type EvidenceForClaude, type Proposal } from './claude.ts';

function mmss(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function nextLabel(worker: SupabaseClient, productId: string): Promise<string> {
  const { data } = await worker.from('versions').select('label').eq('product_id', productId);
  const used = new Set((data ?? []).map((v) => v.label));
  for (const l of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(l)) return l;
  return `V${(data ?? []).length + 1}`;
}

export type MaterializeInput = {
  studyId: string;
  baseVersionId: string;
  actor: string;
  objective: string;
  proposal: Pick<Proposal, 'summary' | 'rationale' | 'evidence_ids' | 'preserve'> & { edits: Array<{ find: string; replace: string; reason?: string }>; expected_effect?: string; risks?: string };
  model?: Record<string, unknown> | null;
  submissionId?: string | null;
  createdBy?: string | null;
};

export type MaterializeResult =
  | { ok: true; interventionId: string; versionId: string; label: string; checksJobId: string }
  | { ok: false; interventionId: string; errors: string[] };

/**
 * Applies a proposed patch to the base build inside the editable scope,
 * registers the result as an immutable candidate version and queues the
 * study's frozen checks. The candidate reaches participants only if they pass.
 */
export async function materializeIntervention(worker: SupabaseClient, input: MaterializeInput): Promise<MaterializeResult> {
  const study = await worker.from('studies').select('id, product_id, check_suite_id').eq('id', input.studyId).single();
  if (study.error) throw new Error(`Estudio: ${study.error.message}`);
  if (!study.data.check_suite_id) throw new Error('El estudio no tiene comprobaciones fijadas: publicalo antes de intervenir.');
  const base = await versionHtml(worker, input.baseVersionId);
  if (!base) throw new Error('No se encontró la versión base');

  const evidenceIds = input.proposal.evidence_ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const record = {
    study_id: input.studyId,
    base_version_id: input.baseVersionId,
    submission_id: input.submissionId ?? null,
    actor: input.actor,
    objective: input.objective,
    summary: input.proposal.summary.slice(0, 2000),
    rationale: [input.proposal.rationale, input.proposal.expected_effect ? `Efecto esperado: ${input.proposal.expected_effect}` : '', input.proposal.risks ? `Riesgos: ${input.proposal.risks}` : '']
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 6000),
    preserve: input.proposal.preserve.slice(0, 2000),
    evidence_ids: evidenceIds,
    edits: input.proposal.edits,
    model: input.model ?? null,
  };

  const patched = applyScopedEdits(base, input.proposal.edits as Edit[]);
  if (!patched.ok) {
    const ins = await worker.from('interventions').insert({ ...record, status: 'rejected', errors: patched.errors }).select('id').single();
    if (ins.error) throw new Error(`Registrar intervención: ${ins.error.message}`);
    return { ok: false, interventionId: ins.data.id, errors: patched.errors };
  }

  const label = await nextLabel(worker, study.data.product_id);
  const version = await registerVersion(worker, {
    productId: study.data.product_id,
    label,
    html: patched.source,
    origin: 'agent_intervention',
    status: 'checking',
    parentVersionId: input.baseVersionId,
    notes: input.proposal.summary.slice(0, 500),
    createdBy: input.createdBy ?? null,
  });
  const diff = unifiedDiff(base, patched.source, { fromLabel: 'versión base', toLabel: `versión ${version.label}` });
  const ins = await worker
    .from('interventions')
    .insert({ ...record, result_version_id: version.id, diff, status: 'checking' })
    .select('id')
    .single();
  if (ins.error) throw new Error(`Registrar intervención: ${ins.error.message}`);

  const job = await enqueueJob(worker, {
    studyId: input.studyId,
    kind: 'run_checks',
    key: `checks:${input.studyId}:${version.id}:${study.data.check_suite_id}`,
    input: { version_id: version.id, baseline_version_id: input.baseVersionId, suite_id: study.data.check_suite_id, intervention_id: ins.data.id },
  });
  return { ok: true, interventionId: ins.data.id, versionId: version.id, label: version.label, checksJobId: job.id };
}

/**
 * Job: Claude (as the creator's agent) reads the selected evidence and
 * proposes a bounded change to the baseline. One repair round is allowed when
 * the patch falls outside the scope or a quick pre-check fails.
 */
export async function runInterventionJob(worker: SupabaseClient, job: JobRow): Promise<Record<string, unknown>> {
  const input = job.input as { base_version_id: string; evidence_ids: string[]; requested_by?: string | null };
  if (!job.study_id) throw new Error('Falta el estudio');
  const study = await worker.from('studies').select('id, question, objective, objective_detail, check_suite_id, product_id').eq('id', job.study_id).single();
  if (study.error) throw new Error(`Estudio: ${study.error.message}`);
  const base = await versionHtml(worker, input.base_version_id);
  if (!base) throw new Error('No se encontró la versión base');

  const ev = await worker
    .from('evidence')
    .select('id, interval_start_ms, interval_end_ms, category, observation, human_statement, hypothesis, alternative, next_test, preserve, review_status, structural_status, current, version_id')
    .eq('study_id', job.study_id)
    .eq('version_id', input.base_version_id)
    .in('id', input.evidence_ids?.length ? input.evidence_ids : ['00000000-0000-0000-0000-000000000000'])
    .neq('review_status', 'rejected');
  const evidence: EvidenceForClaude[] = (ev.data ?? []).map((e) => {
    const cur = (e.current ?? {}) as Record<string, string>;
    return {
      id: e.id,
      interval: `${mmss(e.interval_start_ms)} a ${mmss(e.interval_end_ms)}`,
      category: e.category,
      observation: e.observation,
      human_statement: e.human_statement,
      hypothesis: cur.hypothesis ?? e.hypothesis,
      alternative: e.alternative,
      next_test: cur.next_test ?? e.next_test,
      preserve: e.preserve,
      review_status: e.review_status,
      structural_status: e.structural_status,
    };
  });
  if (!evidence.length) throw new Error('No hay hallazgos válidos seleccionados para intervenir.');

  const request = { question: study.data.question, objective: study.data.objective, objectiveDetail: study.data.objective_detail, baseHtml: base, evidence };
  const suite = study.data.check_suite_id ? await worker.from('check_suites').select('definition').eq('id', study.data.check_suite_id).single() : null;

  let run = await proposeIntervention(request);
  const attempts: Array<{ errors: string[] }> = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (run.proposal.decision === 'no_change' || run.proposal.edits.length === 0) break;
    const patched = applyScopedEdits(base, run.proposal.edits);
    let errors = patched.ok ? [] : patched.errors;
    if (patched.ok && suite?.data) {
      // Quick pre-check so Claude can repair its own patch; the recorded checks run as a separate job.
      const results = runHeadlessSuite(suite.data.definition as SuiteDefinition, patched.source, base);
      if (!suitePassed(results)) errors = results.filter((r) => r.status !== 'passed').map((r) => `${r.label}: ${r.summary}`);
    }
    if (!errors.length || attempt === 1) break;
    attempts.push({ errors });
    run = await proposeIntervention(request, { previous: run.messages, errors });
  }

  const model = { provider: 'anthropic', model: run.model, served_by: run.servedBy, prompt_version: INTERVENTION_PROMPT_VERSION, usage: run.usage, repair_rounds: attempts.length };
  const bounty = await worker.from('bounties').select('id').eq('study_id', job.study_id).eq('kind', 'agent_intervention').maybeSingle();
  const submission = await worker
    .from('agent_submissions')
    .insert({
      study_id: job.study_id,
      bounty_id: bounty.data?.id ?? null,
      actor: 'Claude, agente creador en FUNLABS',
      kind: 'intervention',
      input_version_ids: [input.base_version_id],
      payload: { ...run.proposal, model },
      evidence_refs: run.proposal.evidence_ids.filter((id) => evidence.some((e) => e.id === id)),
    })
    .select('id')
    .single();

  if (run.proposal.decision === 'no_change' || run.proposal.edits.length === 0) {
    const ins = await worker
      .from('interventions')
      .insert({
        study_id: job.study_id,
        base_version_id: input.base_version_id,
        submission_id: submission.data?.id ?? null,
        actor: 'Claude, agente creador en FUNLABS',
        objective: study.data.objective,
        summary: run.proposal.summary,
        rationale: run.proposal.rationale,
        preserve: run.proposal.preserve,
        evidence_ids: run.proposal.evidence_ids.filter((id) => evidence.some((e) => e.id === id)),
        edits: [],
        model,
        status: 'rejected',
        errors: ['Claude no recomendó cambios con esta evidencia.'],
      })
      .select('id')
      .single();
    return { decision: 'no_change', intervention_id: ins.data?.id ?? null, model };
  }

  const result = await materializeIntervention(worker, {
    studyId: job.study_id,
    baseVersionId: input.base_version_id,
    actor: 'Claude, agente creador en FUNLABS',
    objective: study.data.objective,
    proposal: run.proposal,
    model,
    submissionId: submission.data?.id ?? null,
    createdBy: input.requested_by ?? null,
  });
  return { decision: 'change', ...result, model, repair_rounds: attempts.length };
}
