import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { EvidenceDesk, type DeskEvidence, type DeskSession } from '@/components/lab/EvidenceDesk';
import { ReviewTimer } from '@/components/lab/ReviewTimer';

export const metadata: Metadata = { title: 'Evidence' };

export default async function EvidencePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createUserClient();
  const [study, sessions, baseline] = await Promise.all([
    supabase.from('studies').select('id, status, check_suite_id, objective').eq('id', id).single(),
    supabase
      .from('sessions')
      .select('id, phase, position, neutral_label, status, version_id, assignment_id, started_at, versions(label), assignments(participant_code), recordings(id, status, duration_ms, storage_path, method, has_audio, mime_type)')
      .eq('study_id', id)
      .order('started_at'),
    supabase.from('study_versions').select('version_id').eq('study_id', id).eq('role', 'baseline').maybeSingle(),
  ]);
  const list = (sessions.data ?? []).filter((s) => s.status !== 'started' || s.recordings);
  if (!study.data) return null;
  if (list.length === 0) {
    return (
      <div className="empty">
        <h2 style={{ fontSize: 20 }}>There is no evidence for this version</h2>
        <p className="muted measure">When a person submits their playtest, you will see the recording, the game events, their comments and the proposed findings with their sources here.</p>
        <p><Link href={`/lab/studies/${id}`}>Back to overview</Link></p>
      </div>
    );
  }
  const selected = list.find((s) => s.id === sp.session) ?? list.find((s) => (s.recordings as unknown as { status: string } | null)?.status === 'verified') ?? list[0];
  const rec = selected.recordings as unknown as { id: string; status: string; duration_ms: number | null; storage_path: string; method: string; has_audio: boolean; mime_type: string } | null;

  const [events, feedback, evidence, runs, signed] = await Promise.all([
    supabase.from('game_events').select('id, seq, t_ms, type, payload').eq('session_id', selected.id).order('seq').limit(3000),
    supabase.from('feedback').select('id, kind, t_ms, question_key, body, created_at').eq('session_id', selected.id).order('created_at'),
    supabase
      .from('evidence')
      .select('*, evidence_sources(*), evidence_reviews(id, action, note, corrected, reviewer_kind, reviewer_id, created_at)')
      .eq('session_id', selected.id)
      .order('interval_start_ms'),
    supabase.from('analysis_runs').select('id, provider, model, prompt_version, status, error, validation, raw_output, started_at, finished_at').eq('session_id', selected.id).order('started_at', { ascending: false }).limit(3),
    rec && rec.status === 'verified' ? supabase.storage.from('recordings').createSignedUrl(rec.storage_path, 3600) : Promise.resolve({ data: null, error: null }),
  ]);

  const deskSessions: DeskSession[] = list.map((s) => ({
    id: s.id,
    label: `${(s.assignments as unknown as { participant_code: string } | null)?.participant_code ?? 'P-?'}, ${s.phase === 'playtest' ? 'playtest' : `comparison ${s.position}`} (version ${(s.versions as unknown as { label: string } | null)?.label ?? '?'})`,
    hasRecording: (s.recordings as unknown as { status: string } | null)?.status === 'verified',
  }));
  const deskEvidence: DeskEvidence[] = (evidence.data ?? []).map((e) => ({
    id: e.id,
    start: e.interval_start_ms,
    end: e.interval_end_ms,
    observation: e.observation,
    humanStatement: e.human_statement,
    hypothesis: e.hypothesis,
    alternative: e.alternative,
    nextTest: e.next_test,
    category: e.category,
    preserve: e.preserve,
    origin: e.origin,
    structural: e.structural_status,
    review: e.review_status,
    current: e.current,
    generatedBy: e.generated_by,
    versionId: e.version_id,
    sources: (e.evidence_sources ?? []).map((src: { id: string; kind: string; source_id: string; t_ms: number | null; verified: boolean; note: string | null }) => ({ id: src.id, kind: src.kind, sourceId: src.source_id, t: src.t_ms, verified: src.verified, note: src.note })),
    reviews: (e.evidence_reviews ?? []).sort((a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at)),
  }));

  return (
    <>
    <ReviewTimer studyId={id} />
    <EvidenceDesk
      studyId={id}
      canIntervene={Boolean(study.data.check_suite_id)}
      baselineVersionId={baseline.data?.version_id ?? null}
      sessions={deskSessions}
      session={{
        id: selected.id,
        label: deskSessions.find((s) => s.id === selected.id)!.label,
        versionId: selected.version_id,
        videoUrl: signed.data?.signedUrl ?? null,
        durationMs: rec?.duration_ms ?? null,
        recordingStatus: rec?.status ?? null,
        method: rec?.method ?? null,
        hasAudio: rec?.has_audio ?? false,
        submitted: selected.status === 'submitted',
      }}
      events={(events.data ?? []).map((e) => ({ id: e.id, seq: e.seq, t: e.t_ms, type: e.type, payload: e.payload }))}
      feedback={(feedback.data ?? []).map((f) => ({ id: f.id, kind: f.kind, t: f.t_ms, question: f.question_key, body: f.body }))}
      evidence={deskEvidence}
      runs={(runs.data ?? []).map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        promptVersion: r.prompt_version,
        status: r.status,
        error: r.error,
        counts: (r.validation as { counts?: Record<string, number> } | null)?.counts ?? null,
        coverage: (r.raw_output as { coverage?: { summary: string; gaps: string[] } } | null)?.coverage ?? null,
        startedAt: r.started_at,
      }))}
    />
    </>
  );
}
