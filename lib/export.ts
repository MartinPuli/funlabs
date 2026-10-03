import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobRow } from './jobs.ts';
import { comparisonSummary, evaluatePrediction, type PredictionPayload } from './results.ts';
import { env } from './env.ts';

export const EXPORT_FIELDS = ['protocol', 'versions', 'predictions', 'sessions', 'events', 'comments', 'evidence', 'interventions', 'comparisons'] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];

type Consents = Map<string, { research: boolean; training: boolean }>;

async function participantConsents(worker: SupabaseClient, studyId: string): Promise<Consents> {
  const { data } = await worker.from('consent_records').select('assignment_id, purpose, granted, created_at').eq('study_id', studyId).eq('subject', 'participant').order('created_at');
  const out: Consents = new Map();
  for (const r of data ?? []) {
    if (!r.assignment_id) continue;
    const cur = out.get(r.assignment_id) ?? { research: false, training: false };
    if (r.purpose === 'research_sharing') cur.research = r.granted;
    if (r.purpose === 'model_training') cur.training = r.granted;
    out.set(r.assignment_id, cur);
  }
  return out;
}

/** Decides whether an export can run, without building it. */
export async function exportPreflight(worker: SupabaseClient, studyId: string, includeRawMedia: boolean) {
  const study = await worker.from('studies').select('creator_research_consent, is_rehearsal').eq('id', studyId).single();
  const reasons: string[] = [];
  if (!study.data?.creator_research_consent) reasons.push('Falta la autorización del titular del producto para investigación.');
  if (includeRawMedia) reasons.push('El MVP no exporta video ni audio crudos: hace falta una autorización aparte de cada participante.');
  const consents = await participantConsents(worker, studyId);
  const assignments = await worker.from('assignments').select('id, status').eq('study_id', studyId);
  const eligible = (assignments.data ?? []).filter((a) => a.status !== 'withdrawn' && consents.get(a.id)?.research).length;
  if (eligible === 0) reasons.push('Ninguna persona participante autorizó el uso para investigación.');
  return { ok: reasons.length === 0, reasons, eligible, total: (assignments.data ?? []).length, rehearsal: Boolean(study.data?.is_rehearsal) };
}

/**
 * Job: builds a private research export with only authorized, reviewed
 * examples. Never includes raw recordings. Records what was excluded and why.
 */
export async function runExportJob(worker: SupabaseClient, job: JobRow): Promise<Record<string, unknown>> {
  const exportId = String((job.input as { export_id?: string }).export_id ?? '');
  const exp = await worker.from('dataset_exports').select('*').eq('id', exportId).single();
  if (exp.error) throw new Error(`Export: ${exp.error.message}`);
  const studyId = exp.data.study_id as string;
  const fields = new Set<string>(exp.data.fields as string[]);

  const pre = await exportPreflight(worker, studyId, exp.data.include_raw_media);
  if (!pre.ok) {
    await worker.from('dataset_exports').update({ status: 'blocked', blocked_reason: pre.reasons.join(' ') }).eq('id', exportId);
    return { blocked: pre.reasons };
  }

  const [study, sv, assignments, consents, sessions, recordings, events, feedback, evidence, sources, interventions, checks, submissions, suite] = await Promise.all([
    worker.from('studies').select('id, title, question, objective, objective_detail, audience, protocol, participants_target, session_minutes, published_at, is_rehearsal, check_suite_id').eq('id', studyId).single(),
    worker.from('study_versions').select('version_id, role, versions(id, label, content_sha256, parent_version_id, origin, created_at)').eq('study_id', studyId),
    worker.from('assignments').select('id, participant_code, status, order_seed').eq('study_id', studyId),
    participantConsents(worker, studyId),
    worker.from('sessions').select('id, assignment_id, version_id, phase, position, neutral_label, status, started_at, ended_at').eq('study_id', studyId),
    worker.from('recordings').select('session_id, duration_ms, method, has_audio, status').eq('study_id', studyId),
    worker.from('game_events').select('session_id, seq, t_ms, type, payload, clock').eq('study_id', studyId).order('seq'),
    worker.from('feedback').select('id, session_id, assignment_id, kind, t_ms, question_key, body, created_at').eq('study_id', studyId),
    worker.from('evidence').select('*').eq('study_id', studyId),
    Promise.resolve(null),
    worker.from('interventions').select('id, base_version_id, result_version_id, actor, objective, summary, rationale, preserve, evidence_ids, diff, model, status, created_at').eq('study_id', studyId),
    worker.from('checks').select('version_id, check_key, label, status, summary, runner, created_at').eq('study_id', studyId),
    worker.from('agent_submissions').select('id, actor, kind, payload, is_retrospective, results_existed, created_at, evaluation').eq('study_id', studyId),
    worker.from('studies').select('check_suites(sha256, suite_key, suite_version)').eq('id', studyId).single(),
  ]);

  const allowed = new Set((assignments.data ?? []).filter((a) => a.status !== 'withdrawn' && consents.get(a.id)?.research).map((a) => a.id));
  const allowedSessions = new Set((sessions.data ?? []).filter((s) => allowed.has(s.assignment_id)).map((s) => s.id));
  const allowedFeedback = new Set((feedback.data ?? []).filter((f) => allowed.has(f.assignment_id)).map((f) => f.id));
  const reviewed = (evidence.data ?? []).filter((e) => allowedSessions.has(e.session_id) && ['confirmed', 'corrected'].includes(e.review_status));
  void sources;
  const reviewedSources = reviewed.length
    ? await worker.from('evidence_sources').select('evidence_id, kind, source_id, t_ms, verified, note').in('evidence_id', reviewed.map((e) => e.id))
    : { data: [] as Array<{ evidence_id: string; kind: string; source_id: string; t_ms: number | null; verified: boolean; note: string | null }> };
  const recBySession = new Map((recordings.data ?? []).map((r) => [r.session_id, r]));
  const codes = new Map((assignments.data ?? []).map((a) => [a.id, a.participant_code]));
  const summary = await comparisonSummary(worker, studyId);

  const doc: Record<string, unknown> = {
    schema: 'funlabs.research-export/v1',
    generated_at: new Date().toISOString(),
    generated_by: { runner: env.runner },
    purpose: exp.data.purpose,
    rehearsal: Boolean(study.data?.is_rehearsal),
    unit: 'versión base -> predicción previa -> experiencia humana -> diagnóstico -> intervención -> variante -> preferencias y motivos',
    study: {
      id: study.data?.id,
      title: study.data?.title,
      question: study.data?.question,
      objective: study.data?.objective,
      objective_detail: study.data?.objective_detail,
      audience: study.data?.audience,
      participants_target: study.data?.participants_target,
      session_minutes: study.data?.session_minutes,
      published_at: study.data?.published_at,
      check_suite: (suite.data?.check_suites as unknown) ?? null,
      ...(fields.has('protocol') ? { protocol: study.data?.protocol } : {}),
    },
  };
  if (fields.has('versions')) {
    doc.versions = (sv.data ?? []).map((r) => ({ role: r.role, ...(r.versions as unknown as Record<string, unknown>) }));
  }
  if (fields.has('predictions')) {
    doc.predictions = (submissions.data ?? [])
      .filter((s) => s.kind === 'prediction')
      .map((s) => ({ actor: s.actor, created_at: s.created_at, payload: s.payload, is_retrospective: s.is_retrospective, results_existed_at_submission: s.results_existed, evaluation: evaluatePrediction(s.payload as PredictionPayload, s.is_retrospective, summary) }));
  }
  if (fields.has('sessions')) {
    doc.participants = (assignments.data ?? [])
      .filter((a) => allowed.has(a.id))
      .map((a) => ({
        participant: a.participant_code,
        consent: { research: true, model_training: consents.get(a.id)?.training ?? false },
        sessions: (sessions.data ?? [])
          .filter((s) => s.assignment_id === a.id)
          .map((s) => ({
            session_id: s.id,
            phase: s.phase,
            version_id: s.version_id,
            position: s.position,
            neutral_label: s.neutral_label,
            recording: recBySession.get(s.id) ? { duration_ms: recBySession.get(s.id)!.duration_ms, method: recBySession.get(s.id)!.method, has_audio: recBySession.get(s.id)!.has_audio, media_included: false } : null,
            ...(fields.has('events') ? { events: (events.data ?? []).filter((e) => e.session_id === s.id).map((e) => ({ seq: e.seq, t_ms: e.t_ms, type: e.type, payload: e.payload, clock: e.clock })) } : {}),
            ...(fields.has('comments') ? { comments: (feedback.data ?? []).filter((f) => f.session_id === s.id).map((f) => ({ id: f.id, kind: f.kind, t_ms: f.t_ms, question: f.question_key, text: f.body })) } : {}),
          })),
      }));
  }
  if (fields.has('evidence')) {
    doc.evidence = reviewed.map((e) => ({
      id: e.id,
      session_id: e.session_id,
      version_id: e.version_id,
      origin: e.origin,
      interval_ms: { start: e.interval_start_ms, end: e.interval_end_ms },
      observation: e.observation,
      human_statement: e.human_statement_feedback_id && allowedFeedback.has(e.human_statement_feedback_id) ? e.human_statement : null,
      hypothesis: e.hypothesis,
      alternative: e.alternative,
      next_test: e.next_test,
      category: e.category,
      preserve: e.preserve,
      structural_status: e.structural_status,
      review_status: e.review_status,
      corrected: e.current,
      generated_by: e.generated_by,
      sources: (reviewedSources.data ?? []).filter((s) => s.evidence_id === e.id).map((s) => ({ kind: s.kind, source_id: s.source_id, t_ms: s.t_ms, verified: s.verified })),
    }));
  }
  if (fields.has('interventions')) {
    doc.interventions = (interventions.data ?? []).map((i) => ({ ...i, checks: (checks.data ?? []).filter((c) => c.version_id === i.result_version_id) }));
  }
  if (fields.has('comparisons')) {
    doc.comparisons = {
      denominator: summary.total,
      prefer_baseline: summary.preferBaseline,
      prefer_variant: summary.preferVariant,
      no_preference: summary.noPreference,
      by_order: summary.byOrder,
      prior_exposure: summary.priorExposure,
      answers: summary.reasons.filter((r) => [...allowed].some((id) => codes.get(id) === r.participant)),
      limitations: summary.limitations,
    };
  }
  const excluded = {
    participants_without_research_consent: (assignments.data ?? []).filter((a) => a.status !== 'withdrawn' && !consents.get(a.id)?.research).length,
    participants_withdrawn: (assignments.data ?? []).filter((a) => a.status === 'withdrawn').length,
    evidence_unreviewed: (evidence.data ?? []).filter((e) => allowedSessions.has(e.session_id) && e.review_status === 'unreviewed').length,
    evidence_rejected: (evidence.data ?? []).filter((e) => allowedSessions.has(e.session_id) && e.review_status === 'rejected').length,
    raw_media: 'no incluido',
  };
  doc.excluded = excluded;
  doc.limitations = [
    'Export privado de ejemplos autorizados: no es un dataset representativo.',
    'Los eventos están sincronizados con el reloj de la grabación del navegador de cada persona; no se afirma una sincronización exacta con cada cuadro del video.',
    ...summary.limitations,
  ];

  const body = exp.data.format === 'jsonl' ? toJsonl(doc) : JSON.stringify(doc, null, 2);
  const path = `${studyId}/${exportId}.${exp.data.format === 'jsonl' ? 'jsonl' : 'json'}`;
  const up = await worker.storage.from('exports').upload(path, new Blob([body], { type: exp.data.format === 'jsonl' ? 'application/x-ndjson' : 'application/json' }), { upsert: true, contentType: exp.data.format === 'jsonl' ? 'application/x-ndjson' : 'application/json' });
  if (up.error) throw new Error(`Guardar export: ${up.error.message}`);
  const items = (doc.participants as unknown[] | undefined)?.length ?? 0;
  await worker
    .from('dataset_exports')
    .update({
      status: 'ready',
      storage_path: path,
      item_count: items,
      excluded,
      manifest: { fields: [...fields], bytes: body.length, participants: items, evidence: reviewed.length },
      ready_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    })
    .eq('id', exportId);
  return { path, participants: items, evidence: reviewed.length, excluded };
}

function toJsonl(doc: Record<string, unknown>): string {
  const lines: string[] = [JSON.stringify({ type: 'header', ...Object.fromEntries(Object.entries(doc).filter(([k]) => !['participants', 'evidence', 'interventions'].includes(k))) })];
  for (const p of (doc.participants as unknown[]) ?? []) lines.push(JSON.stringify({ type: 'participant', ...(p as object) }));
  for (const e of (doc.evidence as unknown[]) ?? []) lines.push(JSON.stringify({ type: 'evidence', ...(e as object) }));
  for (const i of (doc.interventions as unknown[]) ?? []) lines.push(JSON.stringify({ type: 'intervention', ...(i as object) }));
  return lines.join('\n') + '\n';
}
