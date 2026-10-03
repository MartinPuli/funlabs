import type { SupabaseClient } from '@supabase/supabase-js';
import { CONSENT_TEXTS, NEUTRAL_LABELS } from './catalog.ts';
import { enqueueJob } from './jobs.ts';
import { syncStudyStatus, type Protocol } from './studies.ts';
import { hashToken, looksLikeToken } from './tokens.ts';

export class TesterError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type InviteContext = {
  invitation: { id: string; study_id: string; bounty_id: string; label: string; expires_at: string; revoked_at: string | null };
  study: {
    id: string;
    title: string;
    question: string;
    status: string;
    protocol: Protocol;
    session_minutes: number;
    tester_payment_cents: number;
    currency: string;
    is_rehearsal: boolean;
  };
  bounty: { id: string; title: string; instructions: string; deliverable: string; criteria: Array<{ key: string; text: string }>; reward_cents: number; slots: number; status: string };
  assignment: { id: string; participant_code: string; status: string; order_seed: number } | null;
};

const ACTIVE_STUDY = ['published', 'collecting', 'analyzing', 'evidence_ready', 'comparing'];

/** Resolves an invite token. The token is the tester's only credential. */
export async function resolveInvite(worker: SupabaseClient, token: string): Promise<InviteContext> {
  if (!looksLikeToken(token, 'flt')) throw new TesterError('invalid_token', 'La invitación no es válida.', 404);
  const inv = await worker.from('invitations').select('id, study_id, bounty_id, label, expires_at, revoked_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (inv.error) throw new Error(`Invitación: ${inv.error.message}`);
  if (!inv.data) throw new TesterError('invalid_token', 'La invitación no es válida.', 404);
  if (inv.data.revoked_at) throw new TesterError('revoked', 'Esta invitación fue revocada por el equipo del estudio.', 410);
  const [study, bounty, assignment] = await Promise.all([
    worker.from('studies').select('id, title, question, status, protocol, session_minutes, tester_payment_cents, currency, is_rehearsal').eq('id', inv.data.study_id).single(),
    worker.from('bounties').select('id, title, instructions, deliverable, criteria, reward_cents, slots, status').eq('id', inv.data.bounty_id).single(),
    worker.from('assignments').select('id, participant_code, status, order_seed').eq('invitation_id', inv.data.id).maybeSingle(),
  ]);
  if (study.error || bounty.error) throw new Error('No se pudo leer el estudio');
  if (!assignment.data && new Date(inv.data.expires_at).getTime() < Date.now()) throw new TesterError('expired', 'La invitación venció.', 410);
  return { invitation: inv.data, study: study.data as InviteContext['study'], bounty: bounty.data as InviteContext['bounty'], assignment: assignment.data };
}

export async function requireAssignment(worker: SupabaseClient, token: string) {
  const ctx = await resolveInvite(worker, token);
  if (!ctx.assignment) throw new TesterError('not_accepted', 'Primero aceptá la invitación.', 409);
  if (ctx.assignment.status === 'withdrawn') throw new TesterError('withdrawn', 'Te retiraste de este estudio.', 409);
  return { ...ctx, assignment: ctx.assignment };
}

export async function acceptInvite(worker: SupabaseClient, token: string, consents: { participation: boolean; research: boolean; training: boolean }) {
  const ctx = await resolveInvite(worker, token);
  if (ctx.assignment) return ctx.assignment;
  if (!ACTIVE_STUDY.includes(ctx.study.status)) throw new TesterError('closed', 'Este estudio no está recibiendo participantes.', 409);
  if (!consents.participation) throw new TesterError('consent_required', 'Para participar hace falta aceptar la prueba y la grabación de la pestaña. Podés usar la alternativa escrita sin micrófono.', 400);
  const count = await worker.from('assignments').select('id', { count: 'exact', head: true }).eq('study_id', ctx.study.id);
  const n = (count.count ?? 0) + 1;
  if (n > ctx.bounty.slots) throw new TesterError('full', 'Ya se completaron los lugares de este estudio.', 409);

  const ins = await worker
    .from('assignments')
    .insert({ study_id: ctx.study.id, bounty_id: ctx.bounty.id, invitation_id: ctx.invitation.id, participant_code: `P-${n}`, order_seed: n % 2 })
    .select('id, participant_code, status, order_seed')
    .single();
  if (ins.error) {
    if (ins.error.code === '23505') {
      const again = await worker.from('assignments').select('id, participant_code, status, order_seed').eq('invitation_id', ctx.invitation.id).single();
      if (again.data) return again.data;
    }
    throw new Error(`Aceptar invitación: ${ins.error.message}`);
  }
  const assignment = ins.data;
  // Reserve the playtest payment before accepting paid work.
  const reserve = await worker.rpc('reserve_budget', {
    p_study: ctx.study.id,
    p_kind: 'reservation',
    p_amount: ctx.study.tester_payment_cents,
    p_key: `reserve:${assignment.id}:playtest`,
    p_assignment: assignment.id,
    p_note: `Reserva de pago (modo prueba) para ${assignment.participant_code}, prueba`,
  });
  if (reserve.error || !reserve.data?.ok) {
    await worker.from('assignments').delete().eq('id', assignment.id);
    throw new TesterError('budget_exhausted', 'El presupuesto del estudio está agotado. No se aceptan más participantes por ahora.', 409);
  }
  const consentRows = (
    [
      ['participation_recording', consents.participation],
      ['research_sharing', consents.research],
      ['model_training', consents.training],
    ] as const
  ).map(([purpose, granted]) => ({
    study_id: ctx.study.id,
    assignment_id: assignment.id,
    subject: 'participant',
    purpose,
    granted,
    text_version: CONSENT_TEXTS[purpose].version,
  }));
  const c = await worker.from('consent_records').insert(consentRows);
  if (c.error) throw new Error(`Registrar consentimiento: ${c.error.message}`);
  await syncStudyStatus(worker, ctx.study.id);
  return assignment;
}

export async function setResearchConsent(worker: SupabaseClient, token: string, purpose: 'research_sharing' | 'model_training', granted: boolean) {
  const ctx = await requireAssignment(worker, token);
  const c = await worker.from('consent_records').insert({ study_id: ctx.study.id, assignment_id: ctx.assignment.id, subject: 'participant', purpose, granted, text_version: CONSENT_TEXTS[purpose].version });
  if (c.error) throw new Error(`Consentimiento: ${c.error.message}`);
  return { purpose, granted };
}

export async function currentConsents(worker: SupabaseClient, studyId: string, assignmentId: string) {
  const { data } = await worker.from('consent_records').select('purpose, granted, created_at').eq('study_id', studyId).eq('assignment_id', assignmentId).order('created_at');
  const out: Record<string, boolean> = {};
  for (const r of data ?? []) out[r.purpose] = r.granted;
  return out;
}

type SessionOut = { id: string; position: number; neutral_label: string; play_url: string; status: string; recording_status: string | null };

async function baselineAndVariant(worker: SupabaseClient, studyId: string) {
  const { data } = await worker.from('study_versions').select('version_id, role, versions(status)').eq('study_id', studyId);
  const baseline = (data ?? []).find((r) => r.role === 'baseline')?.version_id ?? null;
  const variant = (data ?? []).find((r) => r.role === 'variant' && (r.versions as unknown as { status: string } | null)?.status === 'ready')?.version_id ?? null;
  return { baseline, variant };
}

/** Phase state for the tester page. */
export async function testerState(worker: SupabaseClient, token: string) {
  const ctx = await resolveInvite(worker, token);
  if (!ctx.assignment) return { ctx, phase: 'invite' as const, sessions: [] as SessionOut[], deliveries: [] as Array<{ phase: string; status: string }>, consents: {} as Record<string, boolean>, comparisonOpen: false, comparisonDone: false };
  const [sessions, deliveries, consents, comparison, versions] = await Promise.all([
    worker.from('sessions').select('id, phase, position, neutral_label, status, recordings(status)').eq('assignment_id', ctx.assignment.id).order('phase').order('position'),
    worker.from('deliveries').select('phase, status').eq('assignment_id', ctx.assignment.id),
    currentConsents(worker, ctx.study.id, ctx.assignment.id),
    worker.from('comparisons').select('id').eq('assignment_id', ctx.assignment.id).maybeSingle(),
    baselineAndVariant(worker, ctx.study.id),
  ]);
  const playtestDone = (deliveries.data ?? []).some((d) => d.phase === 'playtest');
  const comparisonOpen = ctx.study.status === 'comparing' && Boolean(versions.variant);
  const comparisonDone = Boolean(comparison.data);
  const withdrawn = ctx.assignment.status === 'withdrawn';
  const phase = withdrawn ? 'withdrawn' : !playtestDone ? 'playtest' : comparisonOpen && !comparisonDone ? 'comparison' : 'done';
  return {
    ctx,
    phase: phase as 'playtest' | 'comparison' | 'done' | 'withdrawn',
    sessions: (sessions.data ?? []).map((s) => ({
      id: s.id,
      phase: s.phase,
      position: s.position,
      neutral_label: s.neutral_label,
      play_url: `/jugar/s/${s.id}`,
      status: s.status,
      recording_status: (s.recordings as unknown as { status: string } | null)?.status ?? null,
    })),
    deliveries: deliveries.data ?? [],
    consents,
    comparisonOpen,
    comparisonDone,
  };
}

/** Creates (or returns) the sessions for a phase. Comparison order alternates per participant. */
export async function startPhase(worker: SupabaseClient, token: string, phase: 'playtest' | 'comparison'): Promise<SessionOut[]> {
  const ctx = await requireAssignment(worker, token);
  const existing = await worker.from('sessions').select('id, position, neutral_label, status, recordings(status)').eq('assignment_id', ctx.assignment.id).eq('phase', phase).order('position');
  const map = (rows: typeof existing.data) =>
    (rows ?? []).map((s) => ({ id: s.id, position: s.position, neutral_label: s.neutral_label, play_url: `/jugar/s/${s.id}`, status: s.status, recording_status: (s.recordings as unknown as { status: string } | null)?.status ?? null }));
  if (existing.data && existing.data.length) return map(existing.data);

  const { baseline, variant } = await baselineAndVariant(worker, ctx.study.id);
  if (!baseline) throw new TesterError('no_version', 'El estudio todavía no tiene una versión para jugar.', 409);
  let rows: Array<{ version_id: string; position: number; neutral_label: string }>;
  if (phase === 'playtest') {
    rows = [{ version_id: baseline, position: 1, neutral_label: 'Gravity Room' }];
  } else {
    if (ctx.study.status !== 'comparing' || !variant) throw new TesterError('comparison_closed', 'La comparación todavía no está abierta.', 409);
    const reservation = await worker.rpc('reserve_budget', {
      p_study: ctx.study.id,
      p_kind: 'reservation',
      p_amount: ctx.study.tester_payment_cents,
      p_key: `reserve:${ctx.assignment.id}:comparison`,
      p_assignment: ctx.assignment.id,
      p_note: `Reserva de pago (modo prueba) para ${ctx.assignment.participant_code}, comparación`,
    });
    if (reservation.error || !reservation.data?.ok) throw new TesterError('budget_exhausted', 'El presupuesto del estudio está agotado para nuevas comparaciones.', 409);
    const order = ctx.assignment.order_seed === 0 ? [baseline, variant] : [variant, baseline];
    rows = order.map((version_id, i) => ({ version_id, position: i + 1, neutral_label: NEUTRAL_LABELS[i] }));
  }
  const ins = await worker
    .from('sessions')
    .insert(rows.map((r) => ({ ...r, study_id: ctx.study.id, assignment_id: ctx.assignment.id, phase })))
    .select('id, position, neutral_label, status, recordings(status)');
  if (ins.error) {
    if (ins.error.code === '23505') {
      const again = await worker.from('sessions').select('id, position, neutral_label, status, recordings(status)').eq('assignment_id', ctx.assignment.id).eq('phase', phase).order('position');
      return map(again.data);
    }
    throw new Error(`Crear sesiones: ${ins.error.message}`);
  }
  await worker.from('assignments').update({ status: 'active' }).eq('id', ctx.assignment.id);
  return map(ins.data.sort((a, b) => a.position - b.position));
}

async function ownSession(worker: SupabaseClient, assignmentId: string, sessionId: string) {
  const s = await worker.from('sessions').select('id, study_id, assignment_id, phase, status, started_at').eq('id', sessionId).maybeSingle();
  if (!s.data || s.data.assignment_id !== assignmentId) throw new TesterError('not_found', 'Sesión no encontrada.', 404);
  return s.data;
}

export type IncomingEvent = { seq: number; t_ms: number; type: string; payload?: Record<string, unknown>; clock?: 'recording' | 'session' };

export async function appendEvents(worker: SupabaseClient, token: string, sessionId: string, events: IncomingEvent[]) {
  const ctx = await requireAssignment(worker, token);
  const s = await ownSession(worker, ctx.assignment.id, sessionId);
  const rows = events.slice(0, 500).map((e) => ({
    study_id: s.study_id,
    session_id: s.id,
    seq: Math.max(0, Math.floor(e.seq)),
    t_ms: Math.max(0, Math.floor(e.t_ms)),
    type: String(e.type).slice(0, 40),
    payload: e.payload && typeof e.payload === 'object' ? e.payload : {},
    clock: e.clock === 'session' ? 'session' : 'recording',
  }));
  if (!rows.length) return { stored: 0 };
  const ins = await worker.from('game_events').upsert(rows, { onConflict: 'session_id,seq', ignoreDuplicates: true });
  if (ins.error) throw new Error(`Guardar eventos: ${ins.error.message}`);
  return { stored: rows.length };
}

export async function addMoment(worker: SupabaseClient, token: string, sessionId: string, tMs: number | null, body: string) {
  const ctx = await requireAssignment(worker, token);
  const s = await ownSession(worker, ctx.assignment.id, sessionId);
  const text = body.trim().slice(0, 4000);
  if (!text) throw new TesterError('empty', 'El comentario está vacío.');
  const ins = await worker
    .from('feedback')
    .insert({ study_id: s.study_id, session_id: s.id, assignment_id: ctx.assignment.id, kind: 'moment', t_ms: tMs === null ? null : Math.max(0, Math.floor(tMs)), body: text })
    .select('id, t_ms, body, created_at')
    .single();
  if (ins.error) throw new Error(`Guardar comentario: ${ins.error.message}`);
  return ins.data;
}

const MIME_OK = ['video/webm', 'video/mp4', 'video/quicktime'];

export async function createUploadUrl(worker: SupabaseClient, token: string, sessionId: string, mimeType: string, method: string) {
  const ctx = await requireAssignment(worker, token);
  const s = await ownSession(worker, ctx.assignment.id, sessionId);
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  if (!MIME_OK.includes(mime)) throw new TesterError('bad_type', 'Formato de video no admitido. Usá WebM o MP4.');
  const ext = mime === 'video/mp4' ? 'mp4' : mime === 'video/quicktime' ? 'mov' : 'webm';
  const path = `${s.study_id}/${s.id}/recording.${ext}`;
  const methodOk = ['tab_capture', 'window_capture', 'screen_capture', 'manual_upload'].includes(method) ? method : 'manual_upload';
  const existing = await worker.from('recordings').select('id, status, storage_path').eq('session_id', s.id).maybeSingle();
  if (existing.data && ['uploaded', 'verified'].includes(existing.data.status)) throw new TesterError('already_uploaded', 'Esta sesión ya tiene una grabación.', 409);
  if (existing.data && existing.data.storage_path !== path) {
    await worker.from('recordings').delete().eq('id', existing.data.id);
  }
  const up = await worker.from('recordings').upsert({ study_id: s.study_id, session_id: s.id, storage_path: path, mime_type: mime, method: methodOk, status: 'pending' }, { onConflict: 'session_id' });
  if (up.error) throw new Error(`Preparar grabación: ${up.error.message}`);
  const signed = await worker.storage.from('recordings').createSignedUploadUrl(path, { upsert: true });
  if (signed.error) throw new Error(`URL de subida: ${signed.error.message}`);
  return { path, token: signed.data.token, signedUrl: signed.data.signedUrl };
}

export async function confirmRecording(worker: SupabaseClient, token: string, sessionId: string, meta: { duration_ms: number | null; has_audio: boolean; bytes: number | null; surface?: string | null; cropped?: boolean }) {
  const ctx = await requireAssignment(worker, token);
  const s = await ownSession(worker, ctx.assignment.id, sessionId);
  const rec = await worker.from('recordings').select('id, storage_path, status').eq('session_id', s.id).single();
  if (rec.error) throw new TesterError('no_recording', 'No hay una subida pendiente para esta sesión.', 404);
  const folder = rec.data.storage_path.split('/').slice(0, -1).join('/');
  const name = rec.data.storage_path.split('/').pop()!;
  const listed = await worker.storage.from('recordings').list(folder, { search: name, limit: 5 });
  const object = (listed.data ?? []).find((o) => o.name === name);
  const size = (object?.metadata as { size?: number } | undefined)?.size ?? null;
  const verified = Boolean(object) && (size === null || size > 0);
  const upd = await worker
    .from('recordings')
    .update({
      status: verified ? 'verified' : 'failed',
      bytes: size ?? meta.bytes,
      duration_ms: meta.duration_ms && meta.duration_ms > 0 ? Math.round(meta.duration_ms) : null,
      has_audio: Boolean(meta.has_audio),
      uploaded_at: new Date().toISOString(),
      verified_at: verified ? new Date().toISOString() : null,
      verify_note: verified ? null : 'El archivo no aparece en el almacenamiento',
    })
    .eq('id', rec.data.id);
  if (upd.error) throw new Error(`Confirmar grabación: ${upd.error.message}`);
  if (!verified) throw new TesterError('upload_missing', 'El archivo no se pudo subir. Reintentar.', 409);
  await worker.from('sessions').update({ status: 'recorded', ended_at: new Date().toISOString(), capture: { surface: meta.surface ?? null, cropped: Boolean(meta.cropped), microphone: Boolean(meta.has_audio) } }).eq('id', s.id);
  return { recording_id: rec.data.id, bytes: size };
}

export async function submitPlaytest(worker: SupabaseClient, token: string, sessionId: string, answers: Record<string, string>) {
  const ctx = await requireAssignment(worker, token);
  const s = await ownSession(worker, ctx.assignment.id, sessionId);
  const questions = ctx.study.protocol.final_questions ?? [];
  const rows = questions
    .map((q) => ({ q, body: (answers[q.key] ?? '').trim().slice(0, 4000) }))
    .filter((x) => x.body)
    .map((x) => ({ study_id: s.study_id, session_id: s.id, assignment_id: ctx.assignment.id, kind: 'answer', question_key: x.q.key, body: x.body }));
  const already = await worker.from('deliveries').select('id').eq('assignment_id', ctx.assignment.id).eq('phase', 'playtest').maybeSingle();
  if (already.data) return { delivery_id: already.data.id, duplicate: true };
  if (rows.length) {
    const ins = await worker.from('feedback').insert(rows);
    if (ins.error) throw new Error(`Guardar respuestas: ${ins.error.message}`);
  }
  const [rec, events, moments] = await Promise.all([
    worker.from('recordings').select('status, duration_ms').eq('session_id', s.id).maybeSingle(),
    worker.from('game_events').select('id', { count: 'exact', head: true }).eq('session_id', s.id),
    worker.from('feedback').select('id', { count: 'exact', head: true }).eq('session_id', s.id).eq('kind', 'moment'),
  ]);
  const hasRecording = rec.data?.status === 'verified';
  const auto = {
    usable_material: hasRecording || rows.length >= 2,
    recording: hasRecording ? 'verificada' : 'sin grabación (alternativa escrita)',
    recording_ms: rec.data?.duration_ms ?? null,
    game_events: events.count ?? 0,
    played: (events.count ?? 0) > 3,
    moments: moments.count ?? 0,
    answers: rows.length,
    note: 'Sugerencia automática. La validez la confirma una persona del equipo; no depende de si le gustó el juego.',
  };
  const del = await worker.from('deliveries').insert({ study_id: s.study_id, assignment_id: ctx.assignment.id, phase: 'playtest', auto_checks: auto }).select('id').single();
  if (del.error) throw new Error(`Registrar entrega: ${del.error.message}`);
  await worker.from('sessions').update({ status: 'submitted', ended_at: new Date().toISOString() }).eq('id', s.id);
  // Analysis runs on what was delivered: recording, events and comments.
  await enqueueJob(worker, { studyId: s.study_id, kind: 'analyze_session', key: `analyze:${s.id}:v1`, input: { session_id: s.id } });
  await syncStudyStatus(worker, s.study_id);
  return { delivery_id: del.data.id, auto_checks: auto };
}

export async function submitComparison(worker: SupabaseClient, token: string, choice: 'first' | 'second' | 'none', reason: string) {
  const ctx = await requireAssignment(worker, token);
  const sessions = await worker.from('sessions').select('id, version_id, position, neutral_label, status').eq('assignment_id', ctx.assignment.id).eq('phase', 'comparison').order('position');
  if (!sessions.data || sessions.data.length !== 2) throw new TesterError('not_started', 'Primero jugá las dos versiones.', 409);
  const text = reason.trim().slice(0, 2000);
  if (!text) throw new TesterError('reason_required', 'Contanos el motivo, aunque no tengas preferencia.');
  const [first, second] = sessions.data;
  const preferred = choice === 'first' ? first.version_id : choice === 'second' ? second.version_id : null;
  const playtest = await worker.from('deliveries').select('id').eq('assignment_id', ctx.assignment.id).eq('phase', 'playtest').maybeSingle();
  const ins = await worker
    .from('comparisons')
    .insert({
      study_id: ctx.study.id,
      assignment_id: ctx.assignment.id,
      first_version_id: first.version_id,
      second_version_id: second.version_id,
      first_label: first.neutral_label,
      second_label: second.neutral_label,
      choice,
      preferred_version_id: preferred,
      reason: text,
      prior_exposure: Boolean(playtest.data),
    })
    .select('id')
    .single();
  if (ins.error) {
    if (ins.error.code === '23505') throw new TesterError('already', 'Ya registraste tu comparación.', 409);
    throw new Error(`Guardar comparación: ${ins.error.message}`);
  }
  const events = await worker.from('game_events').select('session_id', { count: 'exact', head: true }).in('session_id', [first.id, second.id]);
  await worker.from('deliveries').insert({
    study_id: ctx.study.id,
    assignment_id: ctx.assignment.id,
    phase: 'comparison',
    auto_checks: { played_both: (events.count ?? 0) > 6, game_events: events.count ?? 0, reason_length: text.length, note: 'Elegir cualquiera de las versiones o ninguna es igual de válido.' },
  });
  await worker.from('sessions').update({ status: 'submitted', ended_at: new Date().toISOString() }).in('id', [first.id, second.id]);
  return { comparison_id: ins.data.id };
}

/** Findings that cite this participant's comments, so they can correct the interpretation. */
export async function myEvidence(worker: SupabaseClient, token: string) {
  const ctx = await requireAssignment(worker, token);
  const fb = await worker.from('feedback').select('id').eq('assignment_id', ctx.assignment.id);
  const ids = (fb.data ?? []).map((f) => f.id);
  if (!ids.length) return [];
  const ev = await worker
    .from('evidence')
    .select('id, interval_start_ms, interval_end_ms, observation, human_statement, hypothesis, review_status, evidence_reviews(action, note, reviewer_kind, created_at)')
    .in('human_statement_feedback_id', ids)
    .order('interval_start_ms');
  return ev.data ?? [];
}

export async function participantNote(worker: SupabaseClient, token: string, evidenceId: string, note: string) {
  const ctx = await requireAssignment(worker, token);
  const text = note.trim().slice(0, 2000);
  if (!text) throw new TesterError('empty', 'La corrección está vacía.');
  const fb = await worker.from('feedback').select('id').eq('assignment_id', ctx.assignment.id);
  const ev = await worker.from('evidence').select('id, study_id, human_statement_feedback_id').eq('id', evidenceId).maybeSingle();
  if (!ev.data || !(fb.data ?? []).some((f) => f.id === ev.data!.human_statement_feedback_id)) throw new TesterError('not_found', 'Hallazgo no encontrado.', 404);
  const ins = await worker.from('evidence_reviews').insert({ evidence_id: evidenceId, study_id: ev.data.study_id, reviewer_kind: 'participant', assignment_id: ctx.assignment.id, action: 'participant_note', note: text });
  if (ins.error) throw new Error(`Guardar corrección: ${ins.error.message}`);
  return { ok: true };
}

export async function withdraw(worker: SupabaseClient, token: string) {
  const ctx = await requireAssignment(worker, token);
  await worker.from('assignments').update({ status: 'withdrawn' }).eq('id', ctx.assignment.id);
  for (const purpose of ['research_sharing', 'model_training'] as const) {
    await worker.from('consent_records').insert({ study_id: ctx.study.id, assignment_id: ctx.assignment.id, subject: 'participant', purpose, granted: false, text_version: CONSENT_TEXTS[purpose].version });
  }
  return { withdrawn: true };
}
