'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addHumanFinding, requestAnalysis, requestIntervention, reviewEvidence, type ActionState } from '@/app/lab/actions';
import { CATEGORY_LABEL, ORIGIN_LABEL, REVIEW_LABEL, STRUCTURAL_LABEL } from '@/lib/catalog';
import { mmss } from '@/lib/format';

export type DeskSession = { id: string; label: string; hasRecording: boolean };
type Source = { id: string; kind: string; sourceId: string; t: number | null; verified: boolean; note: string | null };
type Review = { id: string; action: string; note: string | null; corrected: Record<string, string> | null; reviewer_kind: string; created_at: string };
export type DeskEvidence = {
  id: string;
  start: number;
  end: number;
  observation: string;
  humanStatement: string | null;
  hypothesis: string | null;
  alternative: string | null;
  nextTest: string | null;
  category: string;
  preserve: boolean;
  origin: string;
  structural: string;
  review: string;
  current: Record<string, string> | null;
  generatedBy: Record<string, unknown> | null;
  versionId: string;
  sources: Source[];
  reviews: Review[];
};
type DeskEvent = { id: number; seq: number; t: number; type: string; payload: Record<string, unknown> };
type DeskFeedback = { id: string; kind: string; t: number | null; question: string | null; body: string };
type Run = { id: string; provider: string; model: string; promptVersion: string; status: string; error: string | null; counts: Record<string, number> | null; coverage: { summary: string; gaps: string[] } | null; startedAt: string };

const EVENT_LABEL: Record<string, string> = {
  game_start: 'Empieza el juego',
  level_start: 'Empieza una sala',
  flip: 'Invierte la gravedad',
  flip_denied: 'Intenta invertir en el aire',
  land: 'Se apoya',
  interact: 'Pulsa E',
  switch_on: 'Activa un interruptor',
  door_open: 'Se abre la puerta',
  death: 'Cae en pinchos',
  respawn: 'Reaparece',
  restart: 'Reinicia la sala',
  level_complete: 'Supera la sala',
  game_complete: 'Termina el juego',
  idle: 'Seis segundos sin tocar nada',
  move: 'Cambia de dirección',
  hidden: 'Pestaña oculta',
  visible: 'Pestaña visible',
};

const MARK_EVENTS = new Set(['death', 'switch_on', 'door_open', 'level_complete', 'game_complete', 'idle', 'restart', 'flip_denied', 'interact']);

function eventTone(type: string, payload: Record<string, unknown>) {
  if (type === 'death') return 'var(--error)';
  if (type === 'switch_on' || type === 'door_open' || type === 'level_complete' || type === 'game_complete') return 'var(--success)';
  if (type === 'idle' || type === 'flip_denied' || (type === 'interact' && payload.result === 'nothing')) return 'var(--warning)';
  return 'var(--text-secondary)';
}

export function EvidenceDesk(props: {
  studyId: string;
  canIntervene: boolean;
  baselineVersionId: string | null;
  sessions: DeskSession[];
  session: { id: string; label: string; versionId: string; videoUrl: string | null; durationMs: number | null; recordingStatus: string | null; method: string | null; hasAudio: boolean; submitted: boolean };
  events: DeskEvent[];
  feedback: DeskFeedback[];
  evidence: DeskEvidence[];
  runs: Run[];
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState<string | null>(props.evidence[0]?.id ?? null);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState<number | null>(props.session.durationMs);
  const [filter, setFilter] = useState<'all' | 'unreviewed' | 'preserve' | 'unsupported'>('all');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [interventionMsg, setInterventionMsg] = useState<ActionState | null>(null);
  const [pending, start] = useTransition();
  const [processing, setProcessing] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  const total = duration ?? props.session.durationMs ?? Math.max(1, ...props.events.map((e) => e.t), ...props.evidence.map((e) => e.end));

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => setNow(Math.round(v.currentTime * 1000));
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(Math.round(v.duration * 1000));
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
    };
  }, [props.session.videoUrl]);

  /** Jumps to a moment without starting playback; focus stays on the control the person used. */
  function seek(ms: number) {
    const v = video.current;
    setNow(ms);
    if (!v) return;
    v.pause();
    v.currentTime = ms / 1000;
  }

  const visible = useMemo(
    () =>
      props.evidence.filter((e) =>
        filter === 'all' ? true : filter === 'unreviewed' ? e.review === 'unreviewed' : filter === 'preserve' ? e.preserve : e.structural === 'unsupported',
      ),
    [props.evidence, filter],
  );
  const eventsById = useMemo(() => new Map(props.events.map((e) => [String(e.id), e])), [props.events]);
  const feedbackById = useMemo(() => new Map(props.feedback.map((f) => [f.id, f])), [props.feedback]);
  const isBaseline = props.session.versionId === props.baselineVersionId;
  const latestRun = props.runs[0];

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
      <div className="split">
        <label className="field" style={{ minWidth: 280 }}>
          <span className="field-label">Sesión</span>
          <select className="select" value={props.session.id} onChange={(e) => router.push(`/lab/estudios/${props.studyId}/evidencia?sesion=${e.target.value}`)}>
            {props.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.hasRecording ? '' : ' (sin grabación)'}
              </option>
            ))}
          </select>
        </label>
        <RunInfo run={latestRun} studyId={props.studyId} sessionId={props.session.id} submitted={props.session.submitted} />
      </div>

      <div className="desk">
        <div className="desk-main stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
          <div className="desk-video">
            {props.session.videoUrl ? (
              <video ref={video} src={props.session.videoUrl} controls preload="metadata" playsInline aria-label={`Grabación de ${props.session.label}`} />
            ) : (
              <div className="desk-novideo">
                <p>
                  <strong>Sin medio para esta sesión.</strong>{' '}
                  {props.session.recordingStatus === 'failed' ? 'La subida falló.' : 'La persona usó la alternativa escrita: la evidencia se apoya en eventos y comentarios.'}
                </p>
              </div>
            )}
          </div>
          <div className="small muted cluster">
            <span className="mono">{mmss(now)} / {mmss(total)}</span>
            {props.session.method && <span>Captura: {props.session.method === 'tab_capture' ? 'pestaña' : props.session.method === 'manual_upload' ? 'subida manual' : props.session.method.replace('_capture', '')}</span>}
            {props.session.hasAudio && <span>Con voz</span>}
          </div>

          <Timeline total={total} now={now} events={props.events} feedback={props.feedback} evidence={props.evidence} selected={selected} onSeek={seek} onSelect={(id, ms) => { setSelected(id); seek(ms); }} />

          <details className="panel panel-tight" open={showEvents} onToggle={(e) => setShowEvents((e.target as HTMLDetailsElement).open)}>
            <summary className="small"><strong>Eventos y comentarios en texto</strong> ({props.events.filter((e) => MARK_EVENTS.has(e.type)).length} eventos, {props.feedback.length} comentarios)</summary>
            {showEvents && (
              <ul className="event-list">
                {[
                  ...props.events.filter((e) => MARK_EVENTS.has(e.type)).map((e) => ({ t: e.t, key: `e${e.id}`, text: `${EVENT_LABEL[e.type] ?? e.type}${e.type === 'interact' ? ` (${e.payload.result === 'nothing' ? 'sin objeto cerca' : e.payload.result === 'switch_on' ? 'activa' : 'ya activo'})` : ''}${e.payload.level ? `, sala ${e.payload.level}` : ''}` })),
                  ...props.feedback.filter((f) => f.t !== null).map((f) => ({ t: f.t as number, key: f.id, text: `Comentario: “${f.body}”` })),
                ]
                  .sort((a, b) => a.t - b.t)
                  .map((row) => (
                    <li key={row.key}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => seek(row.t)} aria-label={`Ir a ${mmss(row.t)}: ${row.text}`}>
                        <span className="mono">{mmss(row.t)}</span>
                      </button>{' '}
                      {row.text}
                    </li>
                  ))}
              </ul>
            )}
          </details>

          <FinalAnswers feedback={props.feedback} />
          <ManualFinding studyId={props.studyId} sessionId={props.session.id} now={now} feedback={props.feedback} onSaved={() => router.refresh()} />
        </div>

        <aside className="desk-side stack" aria-label="Hallazgos">
          <div className="split">
            <h2 className="section-title" style={{ fontSize: 20 }}>Hallazgos ({props.evidence.length})</h2>
            <label className="small cluster" style={{ ['--gap' as string]: '6px' }}>
              <span>Mostrar</span>
              <select className="select" style={{ width: 'auto', minHeight: 36 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">Todos</option>
                <option value="unreviewed">Sin revisar</option>
                <option value="preserve">Para conservar</option>
                <option value="unsupported">Sin fuente verificable</option>
              </select>
            </label>
          </div>
          {props.evidence.length === 0 && (
            <p className="empty">
              {latestRun?.status === 'running'
                ? 'Análisis pendiente de revisión: Gemini está procesando la sesión.'
                : latestRun?.status === 'succeeded'
                  ? 'El análisis no propuso hallazgos para esta sesión. Podés agregar uno a mano.'
                  : 'No hay evidencia para esta sesión todavía.'}
            </p>
          )}
          <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, ['--gap' as string]: 'var(--s-3)' }}>
            {visible.map((e) => (
              <li key={e.id}>
                <EvidenceMoment
                  e={e}
                  studyId={props.studyId}
                  selected={selected === e.id}
                  onView={() => {
                    setSelected(e.id);
                    seek(e.start);
                  }}
                  eventsById={eventsById}
                  feedbackById={feedbackById}
                  selectable={isBaseline && props.canIntervene && e.review !== 'rejected'}
                  chosen={chosen.has(e.id)}
                  onChoose={(on) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(e.id);
                      else next.delete(e.id);
                      return next;
                    })
                  }
                />
              </li>
            ))}
          </ol>
          {isBaseline && props.evidence.length > 0 && (
            <div className="panel panel-tight stack desk-intervene" style={{ ['--gap' as string]: 'var(--s-2)' }}>
              <strong>Intervenir con Claude</strong>
              <p className="small muted">
                {props.canIntervene
                  ? 'Elegí los hallazgos que motivan el cambio. Claude modifica una copia de la versión base solo en sus regiones editables; la variante llega a las personas si pasa las comprobaciones fijadas.'
                  : 'Publicá el estudio para fijar las comprobaciones antes de intervenir.'}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!props.canIntervene || chosen.size === 0 || pending || processing}
                onClick={() =>
                  start(async () => {
                    const res = await requestIntervention(props.studyId, [...chosen]);
                    setInterventionMsg(res);
                    if (res.ok) {
                      setProcessing(true);
                      try {
                        await fetch('/api/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_id: props.studyId }) });
                      } finally {
                        setProcessing(false);
                        router.push(`/lab/estudios/${props.studyId}/versiones`);
                      }
                    }
                  })
                }
              >
                {pending ? 'Encolando…' : processing ? 'Claude está trabajando…' : `Proponer variante (${chosen.size})`}
              </button>
              {interventionMsg?.message && <span className={interventionMsg.ok ? 'small' : 'field-error'} role={interventionMsg.ok ? 'status' : 'alert'}>{interventionMsg.message}</span>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Timeline({ total, now, events, feedback, evidence, selected, onSeek, onSelect }: { total: number; now: number; events: DeskEvent[]; feedback: DeskFeedback[]; evidence: DeskEvidence[]; selected: string | null; onSeek: (ms: number) => void; onSelect: (id: string, ms: number) => void }) {
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / Math.max(total, 1)) * 100))}%`;
  return (
    <div className="timeline" aria-label="Línea de tiempo de la sesión">
      <div className="timeline-track" onClick={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        onSeek(Math.round(((e.clientX - rect.left) / rect.width) * total));
      }}>
        {evidence.map((e) => (
          <button
            key={e.id}
            type="button"
            className="timeline-band"
            data-selected={selected === e.id || undefined}
            data-preserve={e.preserve || undefined}
            style={{ left: pct(e.start), width: `calc(${pct(e.end - e.start)} + 2px)` }}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(e.id, e.start);
            }}
            aria-label={`Hallazgo de ${mmss(e.start)} a ${mmss(e.end)}: ${e.observation}`}
            title={`${mmss(e.start)} a ${mmss(e.end)}`}
          />
        ))}
        {events.filter((e) => MARK_EVENTS.has(e.type)).map((e) => (
          <span key={e.id} className="timeline-tick" style={{ left: pct(e.t), background: eventTone(e.type, e.payload) }} title={`${mmss(e.t)} ${EVENT_LABEL[e.type] ?? e.type}`} aria-hidden="true" />
        ))}
        {feedback.filter((f) => f.t !== null).map((f) => (
          <span key={f.id} className="timeline-comment" style={{ left: pct(f.t as number) }} title={`${mmss(f.t)} “${f.body}”`} aria-hidden="true" />
        ))}
        <span className="timeline-now" style={{ left: pct(now) }} aria-hidden="true" />
      </div>
      <div className="timeline-legend small muted">
        <span><i style={{ background: 'var(--error)' }} /> caída</span>
        <span><i style={{ background: 'var(--success)' }} /> progreso</span>
        <span><i style={{ background: 'var(--warning)' }} /> duda o espera</span>
        <span><i className="legend-comment" /> comentario</span>
        <span><i className="legend-band" /> hallazgo</span>
      </div>
    </div>
  );
}

function EvidenceMoment({ e, studyId, selected, onView, eventsById, feedbackById, selectable, chosen, onChoose }: { e: DeskEvidence; studyId: string; selected: boolean; onView: () => void; eventsById: Map<string, DeskEvent>; feedbackById: Map<string, DeskFeedback>; selectable: boolean; chosen: boolean; onChoose: (on: boolean) => void }) {
  const [mode, setMode] = useState<null | 'correct' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [fix, setFix] = useState({ hypothesis: e.current?.hypothesis ?? e.hypothesis ?? '', next_test: e.current?.next_test ?? e.nextTest ?? '' });
  const [msg, setMsg] = useState<ActionState | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const hyp = e.current?.hypothesis ?? e.hypothesis;
  const nextTest = e.current?.next_test ?? e.nextTest;
  const participantNotes = e.reviews.filter((r) => r.reviewer_kind === 'participant');

  const act = (action: 'confirm' | 'correct' | 'reject') =>
    start(async () => {
      const res = await reviewEvidence(studyId, e.id, action, note, action === 'correct' ? fix : undefined);
      setMsg(res);
      if (res.ok) {
        setMode(null);
        setNote('');
        router.refresh();
      }
    });

  return (
    <article className="moment" data-selected={selected || undefined} aria-labelledby={`m-${e.id}`}>
      <header className="split" style={{ gap: 8 }}>
        <button type="button" id={`m-${e.id}`} className="btn btn-sm" onClick={onView} aria-label={`Ver momento ${mmss(e.start)} a ${mmss(e.end)}`}>
          <span className="mono">{mmss(e.start)} a {mmss(e.end)}</span> Ver momento
        </button>
        <span className="cluster" style={{ ['--gap' as string]: '6px' }}>
          <span className="tag">{CATEGORY_LABEL[e.category] ?? e.category}</span>
          {e.preserve && <span className="tag tag-success">Conservar</span>}
        </span>
      </header>
      <dl className="moment-body">
        <dt>Observación</dt>
        <dd>{e.current?.observation ?? e.observation}</dd>
        <dt>Declaración humana</dt>
        <dd>{e.humanStatement ? <q>{e.humanStatement}</q> : <span className="muted">Sin comentario humano</span>}</dd>
        {hyp && (
          <>
            <dt>Hipótesis</dt>
            <dd>{hyp}{e.alternative && <span className="muted"> Alternativa: {e.alternative}</span>}</dd>
          </>
        )}
        {nextTest && (
          <>
            <dt>Prueba siguiente</dt>
            <dd>{nextTest}</dd>
          </>
        )}
      </dl>
      <div className="cluster small" style={{ ['--gap' as string]: '6px' }}>
        <span className={`tag ${e.structural === 'verified' ? 'tag-success' : e.structural === 'partial' ? 'tag-warning' : 'tag-error'}`}>{STRUCTURAL_LABEL[e.structural]}</span>
        <span className="tag tag-outline">Origen: {ORIGIN_LABEL[e.origin] ?? e.origin}{e.generatedBy && typeof e.generatedBy.model === 'string' ? ` (${e.generatedBy.model})` : ''}</span>
        <span className={`tag ${e.review === 'confirmed' ? 'tag-success' : e.review === 'rejected' ? 'tag-error' : e.review === 'corrected' ? 'tag-warning' : 'tag-outline'}`}>{REVIEW_LABEL[e.review]}</span>
      </div>
      <details className="small">
        <summary>Fuentes ({e.sources.length})</summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {e.sources.map((s) => {
            const ev = s.kind === 'game_event' ? eventsById.get(s.sourceId) : undefined;
            const fb = s.kind === 'feedback' ? feedbackById.get(s.sourceId) : undefined;
            return (
              <li key={s.id}>
                {s.verified ? '✓ ' : '✗ '}
                {s.kind === 'recording' && `Grabación desde ${mmss(s.t)}`}
                {s.kind === 'game_event' && `Evento ${ev ? EVENT_LABEL[ev.type] ?? ev.type : s.sourceId} en ${mmss(s.t)}`}
                {s.kind === 'feedback' && `Comentario${fb?.t !== null && fb?.t !== undefined ? ` en ${mmss(fb.t)}` : ' final'}`}
                {!s.verified && s.note && <span className="muted">: {s.note}</span>}
              </li>
            );
          })}
        </ul>
      </details>
      {participantNotes.map((r) => (
        <p key={r.id} className="callout small">La persona corrigió la interpretación: {r.note}</p>
      ))}
      {e.reviews.filter((r) => r.reviewer_kind === 'creator').length > 0 && (
        <details className="small">
          <summary>Historial de revisión</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {e.reviews.filter((r) => r.reviewer_kind === 'creator').map((r) => (
              <li key={r.id}>
                {REVIEW_LABEL[r.action === 'confirm' ? 'confirmed' : r.action === 'reject' ? 'rejected' : 'corrected']} el {new Date(r.created_at).toLocaleString('es-AR')}
                {r.note ? `: ${r.note}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="cluster" style={{ ['--gap' as string]: '6px' }}>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act('confirm')}>Confirmar</button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setMode(mode === 'correct' ? null : 'correct')} aria-expanded={mode === 'correct'}>Corregir</button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setMode(mode === 'reject' ? null : 'reject')} aria-expanded={mode === 'reject'}>Rechazar</button>
        {selectable && (
          <label className="small cluster" style={{ ['--gap' as string]: '6px', marginLeft: 'auto' }}>
            <input type="checkbox" checked={chosen} onChange={(ev) => onChoose(ev.target.checked)} style={{ width: 20, height: 20 }} />
            Motiva el cambio
          </label>
        )}
      </div>
      {mode === 'correct' && (
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <label className="field small">
            <span className="field-label">Hipótesis corregida</span>
            <textarea className="textarea" rows={2} value={fix.hypothesis} onChange={(ev) => setFix({ ...fix, hypothesis: ev.target.value })} />
          </label>
          <label className="field small">
            <span className="field-label">Prueba siguiente</span>
            <textarea className="textarea" rows={2} value={fix.next_test} onChange={(ev) => setFix({ ...fix, next_test: ev.target.value })} />
          </label>
          <label className="field small">
            <span className="field-label">Nota</span>
            <input className="input" value={note} onChange={(ev) => setNote(ev.target.value)} />
          </label>
          <div><button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act('correct')}>Guardar corrección</button></div>
        </div>
      )}
      {mode === 'reject' && (
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <label className="field small">
            <span className="field-label">Motivo del rechazo</span>
            <textarea className="textarea" rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </label>
          <div><button type="button" className="btn btn-sm btn-danger" disabled={pending || !note.trim()} onClick={() => act('reject')}>Rechazar hallazgo</button></div>
        </div>
      )}
      {msg && !msg.ok && <p className="field-error" role="alert">{msg.message}</p>}
    </article>
  );
}

function RunInfo({ run, studyId, sessionId, submitted }: { run: Run | undefined; studyId: string; sessionId: string; submitted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [processing, setProcessing] = useState(false);
  return (
    <div className="stack small" style={{ ['--gap' as string]: '6px', maxWidth: 520 }}>
      {run ? (
        <>
          <span>
            Último análisis: <strong>{run.status === 'succeeded' ? 'terminado' : run.status === 'running' ? 'en curso' : 'falló'}</strong> con {run.model} ({run.provider === 'gemini-api' ? 'Gemini API' : run.provider === 'ai-gateway' ? 'Vercel AI Gateway' : run.provider}), {run.promptVersion}
          </span>
          {run.counts && <span className="muted">Verificados {run.counts.verified ?? 0}, parciales {run.counts.partial ?? 0}, sin fuente {run.counts.unsupported ?? 0}</span>}
          {run.coverage?.summary && <span className="muted">Cobertura: {run.coverage.summary}</span>}
          {run.error && <span className="field-error">{run.error}</span>}
        </>
      ) : (
        <span className="muted">{submitted ? 'Análisis pendiente.' : 'La sesión todavía no se entregó.'}</span>
      )}
      {submitted && (
        <span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending || processing}
            onClick={() =>
              start(async () => {
                const res = await requestAnalysis(studyId, sessionId);
                if (res.ok) {
                  setProcessing(true);
                  try {
                    await fetch('/api/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_id: studyId }) });
                  } finally {
                    setProcessing(false);
                    router.refresh();
                  }
                }
              })
            }
          >
            {processing ? 'Analizando…' : run ? 'Analizar de nuevo' : 'Analizar ahora'}
          </button>
        </span>
      )}
    </div>
  );
}

function FinalAnswers({ feedback }: { feedback: DeskFeedback[] }) {
  const answers = feedback.filter((f) => f.kind === 'answer');
  if (!answers.length) return null;
  const Q: Record<string, string> = { enjoyed: '¿Qué disfrutaste?', confusing: '¿Dónde no supiste cómo seguir?', change: '¿Qué cambiarías?' };
  return (
    <section className="panel panel-tight stack" style={{ ['--gap' as string]: 'var(--s-2)' }} aria-label="Respuestas finales">
      <h3>Respuestas finales</h3>
      {answers.map((a) => (
        <p key={a.id} className="small">
          <strong>{Q[a.question ?? ''] ?? a.question}</strong> <q>{a.body}</q>
        </p>
      ))}
    </section>
  );
}

function ManualFinding({ studyId, sessionId, now, feedback, onSaved }: { studyId: string; sessionId: string; now: number; feedback: DeskFeedback[]; onSaved: () => void }) {
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const res = await addHumanFinding(prev, form);
    if (res.ok) onSaved();
    return res;
  }, { ok: false } as ActionState);
  const [startMs, setStart] = useState(0);
  const [endMs, setEnd] = useState(5000);
  return (
    <details className="panel panel-tight">
      <summary><strong>Agregar hallazgo propio</strong></summary>
      <form action={action} className="stack" style={{ ['--gap' as string]: 'var(--s-3)', marginTop: 12 }}>
        <input type="hidden" name="study_id" value={studyId} />
        <input type="hidden" name="session_id" value={sessionId} />
        <input type="hidden" name="start_ms" value={startMs} />
        <input type="hidden" name="end_ms" value={endMs} />
        <div className="cluster small">
          <span>Intervalo <span className="mono">{mmss(startMs)} a {mmss(endMs)}</span></span>
          <button type="button" className="btn btn-sm" onClick={() => setStart(now)}>Inicio = tiempo actual</button>
          <button type="button" className="btn btn-sm" onClick={() => setEnd(Math.max(now, startMs + 1000))}>Fin = tiempo actual</button>
        </div>
        <label className="field">
          <span className="field-label">Observación (qué ocurrió)</span>
          <textarea name="observation" className="textarea" rows={2} required />
        </label>
        <label className="field">
          <span className="field-label">Comentario de la persona que lo respalda</span>
          <select name="feedback_id" className="select" defaultValue="">
            <option value="">Sin comentario humano</option>
            {feedback.map((f) => (
              <option key={f.id} value={f.id}>
                {f.t !== null ? `${mmss(f.t)} ` : 'Final: '}
                {f.body.slice(0, 80)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Hipótesis (opcional)</span>
          <input name="hypothesis" className="input" />
        </label>
        <label className="field">
          <span className="field-label">Prueba siguiente (opcional)</span>
          <input name="next_test" className="input" />
        </label>
        <div className="cluster">
          <label className="field" style={{ minWidth: 200 }}>
            <span className="field-label">Categoría</span>
            <select name="category" className="select" defaultValue="clarity">
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="choice" style={{ alignSelf: 'end' }}>
            <input type="checkbox" name="preserve" />
            <span>Conservar (la persona lo disfrutó)</span>
          </label>
        </div>
        {state.message && <p className={state.ok ? 'small' : 'field-error'} role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
        <div><button className="btn" type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar hallazgo'}</button></div>
      </form>
    </details>
  );
}
