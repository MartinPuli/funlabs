/**
 * Structural validation of proposed findings (from Gemini or from an agent).
 * It checks that references exist, belong to the session and fall inside the
 * recording. It validates structure, not interpretation: a human review can
 * still confirm, correct or reject the finding.
 */

export type ProposedFinding = {
  start_ms: number;
  end_ms: number;
  observation: string;
  feedback_ref: string | null;
  event_refs: string[];
  visual_basis: string | null;
  hypothesis: string | null;
  alternative: string | null;
  next_test: string | null;
  category: string;
  preserve: boolean;
};

export type SessionMaterial = {
  durationMs: number | null;
  /** alias -> event */
  events: Map<string, { id: number; t_ms: number; type: string }>;
  /** alias -> comment from this session (moments and final answers) */
  feedback: Map<string, { id: string; t_ms: number | null; body: string }>;
  recordingId: string | null;
};

export type ValidatedSource = { kind: 'recording' | 'game_event' | 'feedback'; source_id: string; t_ms: number | null; verified: boolean; note: string | null };

export type ValidatedFinding = {
  interval_start_ms: number;
  interval_end_ms: number;
  observation: string;
  feedback_id: string | null;
  hypothesis: string | null;
  alternative: string | null;
  next_test: string | null;
  category: string;
  preserve: boolean;
  structural_status: 'verified' | 'partial' | 'unsupported';
  sources: ValidatedSource[];
  notes: string[];
};

const CATEGORIES = new Set(['clarity', 'difficulty', 'enjoyment', 'controls', 'pacing', 'bug', 'other']);
export const EVENT_TOLERANCE_MS = 3000;
const END_TOLERANCE_MS = 2000;
const MAX_INTERVAL_MS = 120_000;

function clean(text: unknown, max = 2000): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  return t ? t.slice(0, max) : null;
}

export function validateFinding(f: ProposedFinding, m: SessionMaterial): ValidatedFinding {
  const notes: string[] = [];
  let start = Math.round(Number(f.start_ms));
  let end = Math.round(Number(f.end_ms));
  let intervalOk = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
  if (!intervalOk) notes.push('Intervalo inválido.');
  if (intervalOk && end - start > MAX_INTERVAL_MS) {
    notes.push('Intervalo demasiado largo para señalar un momento.');
    intervalOk = false;
  }
  if (intervalOk && m.durationMs !== null) {
    if (start >= m.durationMs) {
      notes.push('El intervalo empieza después del final de la grabación.');
      intervalOk = false;
    } else if (end > m.durationMs) {
      if (end - m.durationMs <= END_TOLERANCE_MS) {
        notes.push('El final del intervalo se ajustó a la duración de la grabación.');
        end = m.durationMs;
      } else {
        notes.push('El intervalo termina después del final de la grabación.');
        intervalOk = false;
      }
    }
  }
  if (!intervalOk) {
    start = Math.max(0, Number.isFinite(start) ? start : 0);
    end = Math.max(start + 1, Number.isFinite(end) ? end : start + 1);
  }

  const sources: ValidatedSource[] = [];
  if (m.recordingId) sources.push({ kind: 'recording', source_id: m.recordingId, t_ms: start, verified: intervalOk, note: intervalOk ? null : 'Intervalo fuera de la grabación' });

  let eventsVerified = 0;
  let refsFailed = 0;
  const seen = new Set<string>();
  for (const ref of (f.event_refs ?? []).slice(0, 20)) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const ev = m.events.get(ref);
    if (!ev) {
      refsFailed++;
      notes.push(`El evento ${ref} no existe en esta sesión.`);
      continue;
    }
    const inside = ev.t_ms >= start - EVENT_TOLERANCE_MS && ev.t_ms <= end + EVENT_TOLERANCE_MS;
    if (!inside) {
      refsFailed++;
      notes.push(`El evento ${ref} (${ev.type}) ocurre fuera del intervalo.`);
    } else eventsVerified++;
    sources.push({ kind: 'game_event', source_id: String(ev.id), t_ms: ev.t_ms, verified: inside, note: inside ? null : 'Fuera del intervalo' });
  }

  let feedbackId: string | null = null;
  if (f.feedback_ref) {
    const fb = m.feedback.get(f.feedback_ref);
    if (!fb) {
      refsFailed++;
      notes.push(`El comentario ${f.feedback_ref} no existe en esta sesión: no se muestra ninguna cita.`);
    } else {
      feedbackId = fb.id;
      sources.push({ kind: 'feedback', source_id: fb.id, t_ms: fb.t_ms, verified: true, note: fb.t_ms === null ? 'Respuesta final (sin tiempo)' : null });
    }
  }

  const observation = clean(f.observation) ?? 'Observación vacía';
  let status: ValidatedFinding['structural_status'];
  if (!intervalOk) status = 'unsupported';
  else if (refsFailed === 0 && (eventsVerified > 0 || feedbackId)) status = 'verified';
  else if (eventsVerified > 0 || feedbackId || (m.recordingId && clean(f.visual_basis))) status = 'partial';
  else status = 'unsupported';
  if (status === 'partial' && eventsVerified === 0 && !feedbackId) notes.push('Respaldado solo por lo que se ve en la grabación.');

  return {
    interval_start_ms: start,
    interval_end_ms: end,
    observation,
    feedback_id: feedbackId,
    hypothesis: clean(f.hypothesis),
    alternative: clean(f.alternative),
    next_test: clean(f.next_test),
    category: CATEGORIES.has(f.category) ? f.category : 'other',
    preserve: Boolean(f.preserve),
    structural_status: status,
    sources,
    notes,
  };
}

/** Converts Gemini's output (seconds and short aliases) into proposed findings. */
export function fromModelOutput(raw: unknown): ProposedFinding[] {
  const list = (raw as { findings?: unknown[] })?.findings;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map((x) => {
    const r = x as Record<string, unknown>;
    return {
      start_ms: Math.round(Number(r.start_s) * 1000),
      end_ms: Math.round(Number(r.end_s) * 1000),
      observation: String(r.observation ?? ''),
      feedback_ref: typeof r.feedback_id === 'string' && r.feedback_id ? r.feedback_id : null,
      event_refs: Array.isArray(r.event_ids) ? r.event_ids.filter((v): v is string => typeof v === 'string') : [],
      visual_basis: typeof r.visual_basis === 'string' ? r.visual_basis : null,
      hypothesis: typeof r.hypothesis === 'string' ? r.hypothesis : null,
      alternative: typeof r.alternative === 'string' ? r.alternative : null,
      next_test: typeof r.next_test === 'string' ? r.next_test : null,
      category: String(r.category ?? 'other'),
      preserve: Boolean(r.preserve),
    };
  });
}
