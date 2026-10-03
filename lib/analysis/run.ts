import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobRow } from '../jobs.ts';
import { env, providerStatus } from '../env.ts';
import { syncStudyStatus } from '../studies.ts';
import { deleteFile, generateJson, uploadFile, waitUntilActive } from './gemini.ts';
import { buildUserPrompt, FINDINGS_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, type PromptMaterial } from './prompt.ts';
import { fromModelOutput, validateFinding, type SessionMaterial } from './validate.ts';

const EVENT_TYPES_FOR_MODEL = new Set(['game_start', 'level_start', 'flip', 'flip_denied', 'land', 'interact', 'switch_on', 'door_open', 'death', 'respawn', 'restart', 'level_complete', 'game_complete', 'idle', 'hidden', 'visible']);

type Loaded = {
  session: { id: string; study_id: string; assignment_id: string; version_id: string; phase: string; neutral_label: string };
  study: { id: string; question: string; objective: string; objective_detail: string; audience: string };
  recording: { id: string; storage_path: string; mime_type: string; duration_ms: number | null; has_audio: boolean; method: string; status: string } | null;
  events: Array<{ id: number; seq: number; t_ms: number; type: string; payload: Record<string, unknown> }>;
  feedback: Array<{ id: string; kind: string; t_ms: number | null; question_key: string | null; body: string; session_id: string | null }>;
};

async function load(worker: SupabaseClient, sessionId: string): Promise<Loaded> {
  const session = await worker.from('sessions').select('id, study_id, assignment_id, version_id, phase, neutral_label').eq('id', sessionId).single();
  if (session.error) throw new Error(`Session not found: ${session.error.message}`);
  const [study, recording, events, feedback] = await Promise.all([
    worker.from('studies').select('id, question, objective, objective_detail, audience').eq('id', session.data.study_id).single(),
    worker.from('recordings').select('id, storage_path, mime_type, duration_ms, has_audio, method, status').eq('session_id', sessionId).maybeSingle(),
    worker.from('game_events').select('id, seq, t_ms, type, payload').eq('session_id', sessionId).order('seq').limit(5000),
    worker.from('feedback').select('id, kind, t_ms, question_key, body, session_id').eq('assignment_id', session.data.assignment_id).order('created_at'),
  ]);
  if (study.error) throw new Error(`Study: ${study.error.message}`);
  return {
    session: session.data,
    study: study.data,
    recording: recording.data && ['uploaded', 'verified'].includes(recording.data.status) ? recording.data : null,
    events: events.data ?? [],
    // Comments from this session plus the final answers of the same phase.
    feedback: (feedback.data ?? []).filter((f) => f.session_id === sessionId || (f.kind === 'answer' && f.session_id === sessionId)),
  };
}

function buildMaterial(l: Loaded): { prompt: PromptMaterial; material: SessionMaterial; aliases: Record<string, string> } {
  const events = new Map<string, { id: number; t_ms: number; type: string }>();
  const aliases: Record<string, string> = {};
  const promptEvents: PromptMaterial['events'] = [];
  for (const e of l.events) {
    const alias = `e${e.seq}`;
    events.set(alias, { id: e.id, t_ms: e.t_ms, type: e.type });
    aliases[alias] = `game_event:${e.id}`;
    if (EVENT_TYPES_FOR_MODEL.has(e.type)) promptEvents.push({ id: alias, t_ms: e.t_ms, type: e.type, payload: e.payload ?? {} });
  }
  const feedback = new Map<string, { id: string; t_ms: number | null; body: string }>();
  const moments: PromptMaterial['moments'] = [];
  const answers: PromptMaterial['answers'] = [];
  let c = 0;
  let r = 0;
  for (const f of l.feedback) {
    if (f.kind === 'moment') {
      const alias = `c${++c}`;
      feedback.set(alias, { id: f.id, t_ms: f.t_ms, body: f.body });
      aliases[alias] = `feedback:${f.id}`;
      moments.push({ id: alias, t_ms: f.t_ms, body: f.body });
    } else {
      const alias = `r${++r}`;
      feedback.set(alias, { id: f.id, t_ms: null, body: f.body });
      aliases[alias] = `feedback:${f.id}`;
      answers.push({ id: alias, question: f.question_key ?? '', body: f.body });
    }
  }
  return {
    prompt: {
      study: l.study,
      session: { phase: l.session.phase, neutral_label: l.session.neutral_label, recording_ms: l.recording?.duration_ms ?? null, has_audio: l.recording?.has_audio ?? false, capture_method: l.recording?.method ?? null },
      events: promptEvents,
      moments,
      answers,
    },
    material: { durationMs: l.recording?.duration_ms ?? null, events, feedback, recordingId: l.recording?.id ?? null },
    aliases,
  };
}

async function analyzeWithGeminiApi(worker: SupabaseClient, l: Loaded, prompt: PromptMaterial) {
  const key = env.geminiKey!;
  const parts: Array<{ text: string } | { file_data: { mime_type: string; file_uri: string } }> = [];
  let uploaded: string | null = null;
  try {
    if (l.recording) {
      const dl = await worker.storage.from('recordings').download(l.recording.storage_path);
      if (dl.error || !dl.data) throw new Error(`Could not read the recording: ${dl.error?.message ?? 'empty'}`);
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const mime = l.recording.mime_type.split(';')[0];
      const file = await uploadFile(key, bytes, mime, `funlabs-${l.session.id}`);
      uploaded = file.name;
      const active = await waitUntilActive(key, file);
      parts.push({ file_data: { mime_type: active.mimeType || mime, file_uri: active.uri } });
    }
    parts.push({ text: buildUserPrompt(prompt) });
    const out = await generateJson(key, env.analysisModel, { system: SYSTEM_PROMPT, parts, schema: FINDINGS_SCHEMA as unknown as Record<string, unknown> });
    return { raw: out.json, usage: out.usage, provider: 'gemini-api', model: out.modelVersion ?? env.analysisModel };
  } finally {
    // Do not leave recordings stored at the provider after the analysis.
    if (uploaded) await deleteFile(key, uploaded);
  }
}

async function analyzeWithGateway(worker: SupabaseClient, l: Loaded, prompt: PromptMaterial) {
  const { generateText, Output, jsonSchema } = await import('ai');
  const content: Array<{ type: 'text'; text: string } | { type: 'file'; data: Uint8Array; mediaType: string }> = [];
  if (l.recording) {
    const dl = await worker.storage.from('recordings').download(l.recording.storage_path);
    if (dl.error || !dl.data) throw new Error(`Could not read the recording: ${dl.error?.message ?? 'empty'}`);
    content.push({ type: 'file', data: new Uint8Array(await dl.data.arrayBuffer()), mediaType: l.recording.mime_type.split(';')[0] });
  }
  content.push({ type: 'text', text: buildUserPrompt(prompt) });
  const model = `google/${env.analysisModel}`;
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    temperature: 0.2,
    messages: [{ role: 'user', content }],
    output: Output.object({ schema: jsonSchema(FINDINGS_SCHEMA as unknown as Parameters<typeof jsonSchema>[0]) }),
  });
  return { raw: result.output as unknown, usage: (result.usage ?? null) as Record<string, unknown> | null, provider: 'ai-gateway', model };
}

/**
 * Job: analyze one session. Gemini proposes findings; FUNLABS validates every
 * reference against the session before storing the evidence.
 */
export async function runAnalysisJob(worker: SupabaseClient, job: JobRow): Promise<Record<string, unknown>> {
  const sessionId = String((job.input as { session_id?: string }).session_id ?? '');
  if (!sessionId) throw new Error('session_id is missing');
  const providers = providerStatus();
  if (!providers.gemini.configured) throw new Error('Gemini is not configured (GEMINI_API_KEY or AI Gateway).');

  // A retried job never duplicates evidence: reuse a finished run, discard a crashed one.
  const previous = await worker.from('analysis_runs').select('id, status').eq('job_id', job.id);
  const done = (previous.data ?? []).find((r) => r.status === 'succeeded');
  if (done) return { analysis_run_id: done.id, reused: true };
  for (const r of previous.data ?? []) {
    await worker.from('evidence').delete().eq('analysis_run_id', r.id);
    await worker.from('analysis_runs').update({ status: 'failed', error: 'Retry: previous run incomplete', finished_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'running');
  }

  const l = await load(worker, sessionId);
  const { prompt, material, aliases } = buildMaterial(l);
  const run = await worker
    .from('analysis_runs')
    .insert({
      study_id: l.session.study_id,
      session_id: sessionId,
      job_id: job.id,
      provider: providers.gemini.via,
      model: env.analysisModel,
      prompt_version: PROMPT_VERSION,
      input_summary: {
        recording: l.recording ? { id: l.recording.id, duration_ms: l.recording.duration_ms, mime_type: l.recording.mime_type, has_audio: l.recording.has_audio } : null,
        events_total: l.events.length,
        events_sent: prompt.events.length,
        comments: prompt.moments.length,
        answers: prompt.answers.length,
        aliases,
        runner: env.runner,
      },
    })
    .select('id')
    .single();
  if (run.error) throw new Error(`Record analysis: ${run.error.message}`);
  await syncStudyStatus(worker, l.session.study_id);

  try {
    if (!l.recording && prompt.events.length === 0 && prompt.moments.length === 0 && prompt.answers.length === 0) {
      throw new Error('The session has no material to analyze');
    }
    const out = providers.gemini.via === 'gemini-api' ? await analyzeWithGeminiApi(worker, l, prompt) : await analyzeWithGateway(worker, l, prompt);
    const proposed = fromModelOutput(out.raw);
    const validated = proposed.map((p) => validateFinding(p, material));

    for (const v of validated) {
      const ev = await worker
        .from('evidence')
        .insert({
          study_id: l.session.study_id,
          version_id: l.session.version_id,
          session_id: sessionId,
          origin: 'model',
          analysis_run_id: run.data.id,
          interval_start_ms: v.interval_start_ms,
          interval_end_ms: v.interval_end_ms,
          observation: v.observation,
          human_statement_feedback_id: v.feedback_id,
          hypothesis: v.hypothesis,
          alternative: v.alternative,
          next_test: v.next_test,
          category: v.category,
          preserve: v.preserve,
          structural_status: v.structural_status,
          generated_by: { provider: out.provider, model: out.model, prompt_version: PROMPT_VERSION },
        })
        .select('id')
        .single();
      if (ev.error) throw new Error(`Save finding: ${ev.error.message}`);
      if (v.sources.length) {
        const src = await worker.from('evidence_sources').insert(v.sources.map((s) => ({ evidence_id: ev.data.id, kind: s.kind, source_id: s.source_id, t_ms: s.t_ms, verified: s.verified, note: s.note })));
        if (src.error) throw new Error(`Save sources: ${src.error.message}`);
      }
    }
    const counts = { total: validated.length, verified: 0, partial: 0, unsupported: 0 } as Record<string, number>;
    for (const v of validated) counts[v.structural_status]++;
    await worker
      .from('analysis_runs')
      .update({
        status: 'succeeded',
        provider: out.provider,
        model: out.model,
        raw_output: out.raw as Record<string, unknown>,
        validation: { counts, findings: validated.map((v) => ({ status: v.structural_status, notes: v.notes })) },
        usage: out.usage,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.data.id);
    return { analysis_run_id: run.data.id, findings: counts, provider: out.provider, model: out.model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await worker.from('evidence').delete().eq('analysis_run_id', run.data.id);
    await worker.from('analysis_runs').update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() }).eq('id', run.data.id);
    throw err;
  } finally {
    await syncStudyStatus(worker, l.session.study_id);
  }
}
