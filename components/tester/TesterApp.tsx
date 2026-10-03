'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { testerCall } from './api';
import { SessionRunner, type SessionResult } from './SessionRunner';
import { CONSENT_TEXTS } from '@/lib/catalog';

type Session = { id: string; phase?: string; position: number; neutral_label: string; play_url: string; status: string; recording_status: string | null };
type State = {
  phase: 'invite' | 'playtest' | 'comparison' | 'done' | 'withdrawn';
  study: { title: string; status: string; session_minutes: number; payment_cents: number; currency: string; rehearsal: boolean; protocol: { task: string; final_questions: Array<{ key: string; text: string }>; payment_rule: string } };
  bounty: { title: string; instructions: string; deliverable: string; criteria: Array<{ key: string; text: string }> };
  assignment: { code: string; status: string } | null;
  sessions: Session[];
  deliveries: Array<{ phase: string; status: string }>;
  consents: Record<string, boolean>;
  comparison: { open: boolean; done: boolean };
};
type MyEvidence = { id: string; interval_start_ms: number; interval_end_ms: number; observation: string; human_statement: string | null; hypothesis: string | null; review_status: string; evidence_reviews: Array<{ action: string; note: string | null; reviewer_kind: string; created_at: string }> };

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

function mmss(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function TesterApp({ token }: { token: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [finished, setFinished] = useState<Record<string, SessionResult>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<'first' | 'second' | 'none' | ''>('');
  const [reason, setReason] = useState('');
  const [consent, setConsent] = useState({ participation: false, research: false, training: false });
  const [evidence, setEvidence] = useState<MyEvidence[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await testerCall<State>(token, 'state');
      setState(s);
      setError(null);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la invitación.');
      return null;
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Prepare sessions whenever we enter a phase that needs them.
  useEffect(() => {
    if (!state || (state.phase !== 'playtest' && state.phase !== 'comparison')) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await testerCall<{ sessions: Session[] }>(token, 'start', { phase: state.phase });
        if (!cancelled) setSessions(res.sessions);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo preparar la sesión.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, token]);

  useEffect(() => {
    if (state?.phase === 'done' && evidence === null) {
      testerCall<{ evidence: MyEvidence[] }>(token, 'evidence').then((r) => setEvidence(r.evidence)).catch(() => setEvidence([]));
    }
  }, [state, token, evidence]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state?.phase]);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo falló. Reintentar.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="tester-layout">
        <div className="stack">
          {error ? (
            <div className="callout callout-error" role="alert">
              <strong>No pudimos abrir la invitación.</strong> <span>{error}</span>
            </div>
          ) : (
            <p aria-live="polite">Cargando la invitación…</p>
          )}
        </div>
      </div>
    );
  }

  const study = state.study;
  const playtestDone = state.deliveries.some((d) => d.phase === 'playtest');
  const stepState = (key: string) => {
    const order = ['invite', 'playtest', 'comparison', 'done'];
    const cur = order.indexOf(state.phase);
    const idx = order.indexOf(key);
    return idx < cur ? 'done' : idx === cur ? 'current' : 'todo';
  };

  const aside = (
    <aside className="tester-aside stack">
      <div className="panel panel-tight stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
        <h3>Tu tarea</h3>
        <p className="small">{state.bounty.instructions}</p>
        <dl className="kv small">
          <dt>Duración</dt>
          <dd>{study.session_minutes} min aprox.</dd>
          <dt>Remuneración</dt>
          <dd>
            {money(study.payment_cents, study.currency)} por entrega válida <span className="test-mode">Pagos en modo prueba</span>
          </dd>
          <dt>Qué se registra</dt>
          <dd>La pestaña del juego, eventos de la partida y lo que escribas. Micrófono opcional. Sin cámara.</dd>
        </dl>
        {study.rehearsal && <p className="tag tag-warning">Ensayo técnico: estos datos no cuentan como estudio real</p>}
      </div>
      <div className="panel panel-tight">
        <h3 className="visually-hidden">Pasos</h3>
        <ol className="steps">
          <li data-state={stepState('invite')}>Aceptar</li>
          <li data-state={stepState('playtest')}>Jugar y comentar</li>
          <li data-state={stepState('comparison')}>Comparar dos versiones (si se abre)</li>
          <li data-state={stepState('done')}>Listo</li>
        </ol>
      </div>
    </aside>
  );

  return (
    <div className="tester-layout">
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
        <header className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <p className="muted small">Invitación a un estudio de FUNLABS{state.assignment ? `, participante ${state.assignment.code}` : ''}</p>
          <h1 ref={headingRef} tabIndex={-1}>
            {state.phase === 'invite' && study.title}
            {state.phase === 'playtest' && 'Jugá y contanos'}
            {state.phase === 'comparison' && 'Compará dos versiones'}
            {state.phase === 'done' && 'Gracias por participar'}
            {state.phase === 'withdrawn' && 'Te retiraste del estudio'}
          </h1>
        </header>

        {error && (
          <div className="callout callout-error" role="alert">
            {error}
          </div>
        )}

        {state.phase === 'invite' && (
          <form
            className="stack panel"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => testerCall(token, 'accept', consent));
              if (ok) await load();
            }}
          >
            <p>{state.bounty.instructions}</p>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
              <h2 style={{ fontSize: 18 }}>Qué cuenta como entrega válida</h2>
              <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
                {state.bounty.criteria.map((c) => (
                  <li key={c.key}>{c.text}</li>
                ))}
              </ul>
            </div>
            <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <legend>Permisos</legend>
              <label className="choice">
                <input type="checkbox" required checked={consent.participation} onChange={(e) => setConsent({ ...consent, participation: e.target.checked })} />
                <span>
                  <strong>Participar y grabar la pestaña del juego (necesario)</strong>
                  <span className="field-help" style={{ display: 'block' }}>{CONSENT_TEXTS.participation_recording.text}</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" checked={consent.research} onChange={(e) => setConsent({ ...consent, research: e.target.checked })} />
                <span>
                  <strong>Aportar datos a investigación (opcional)</strong>
                  <span className="field-help" style={{ display: 'block' }}>{CONSENT_TEXTS.research_sharing.text}</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" checked={consent.training} onChange={(e) => setConsent({ ...consent, training: e.target.checked })} />
                <span>
                  <strong>Uso para entrenar o evaluar modelos (opcional, aparte)</strong>
                  <span className="field-help" style={{ display: 'block' }}>{CONSENT_TEXTS.model_training.text}</span>
                </span>
              </label>
            </fieldset>
            <p className="field-help">Un ID de participante no anonimiza una grabación ni una voz. Las grabaciones no se distribuyen: solo las ve el equipo del estudio.</p>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy || !consent.participation}>
                {busy ? 'Aceptando…' : 'Aceptar y continuar'}
              </button>
            </div>
          </form>
        )}

        {state.phase === 'playtest' && (
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <p className="measure">{study.protocol.task} Si algo no se entiende, anotalo cuando pase: no hay respuestas correctas.</p>
            {sessions.length === 0 && <p aria-live="polite">Preparando la sesión…</p>}
            {sessions.map((s) => (
              <SessionRunner key={s.id} token={token} session={s} maxMinutes={study.session_minutes + 3} onFinished={(r) => setFinished((f) => ({ ...f, [s.id]: r }))} />
            ))}
            {sessions[0] && (finished[sessions[0].id] || ['recorded', 'submitted'].includes(sessions[0].status)) && (
              <form
                className="panel stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await run(() => testerCall(token, 'submit', { session_id: sessions[0].id, answers }));
                  if (ok) await load();
                }}
              >
                <h2>Últimas preguntas</h2>
                <p className="field-help">Contestá con tus palabras. Decir que algo fue aburrido o confuso es tan útil como decir que te gustó.</p>
                {study.protocol.final_questions.map((q) => (
                  <div className="field" key={q.key}>
                    <label htmlFor={`q-${q.key}`}>{q.text}</label>
                    <textarea id={`q-${q.key}`} className="textarea" value={answers[q.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
                  </div>
                ))}
                {!finished[sessions[0].id]?.recorded && sessions[0].recording_status !== 'verified' && (
                  <p className="callout">Sin grabación, tus respuestas escritas son el material principal: contá con detalle qué hiciste y dónde dudaste.</p>
                )}
                <div>
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? 'Enviando…' : 'Enviar entrega'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {state.phase === 'comparison' && (
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <p className="measure">Vas a jugar dos versiones con nombres neutrales, en el orden indicado. Podés preferir cualquiera o ninguna: las tres respuestas valen lo mismo.</p>
            {sessions.length === 0 && <p aria-live="polite">Preparando las versiones…</p>}
            {sessions.map((s, i) =>
              i === 0 || finished[sessions[i - 1].id] || ['recorded', 'submitted'].includes(sessions[i - 1].status) ? (
                <SessionRunner key={s.id} token={token} session={s} maxMinutes={study.session_minutes + 3} onFinished={(r) => setFinished((f) => ({ ...f, [s.id]: r }))} />
              ) : (
                <p key={s.id} className="empty">
                  <strong>{s.neutral_label}</strong>
                  <span className="muted">Se habilita cuando terminás la versión anterior.</span>
                </p>
              ),
            )}
            {sessions.length === 2 && sessions.every((s) => finished[s.id] || ['recorded', 'submitted'].includes(s.status)) && (
              <form
                className="panel stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!choice) return;
                  const ok = await run(() => testerCall(token, 'compare', { choice, reason }));
                  if (ok) await load();
                }}
              >
                <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
                  <legend>¿Cuál preferiste?</legend>
                  <label className="choice">
                    <input type="radio" name="choice" value="first" checked={choice === 'first'} onChange={() => setChoice('first')} />
                    <span>{sessions[0].neutral_label}</span>
                  </label>
                  <label className="choice">
                    <input type="radio" name="choice" value="second" checked={choice === 'second'} onChange={() => setChoice('second')} />
                    <span>{sessions[1].neutral_label}</span>
                  </label>
                  <label className="choice">
                    <input type="radio" name="choice" value="none" checked={choice === 'none'} onChange={() => setChoice('none')} />
                    <span>Sin preferencia</span>
                  </label>
                </fieldset>
                <div className="field">
                  <label htmlFor="reason">¿Por qué?</label>
                  <textarea id="reason" className="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div>
                  <button className="btn btn-primary" type="submit" disabled={busy || !choice || !reason.trim()}>
                    {busy ? 'Enviando…' : 'Enviar comparación'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {state.phase === 'done' && (
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <div className="callout callout-success">
              <p>
                Tu entrega quedó registrada{playtestDone ? '' : ''}. El equipo revisa que el material sea utilizable; tu remuneración no depende de si te gustó el juego.
                <span className="test-mode" style={{ marginLeft: 8 }}>Pagos en modo prueba</span>
              </p>
            </div>
            {!state.comparison.open && !state.comparison.done && (
              <p className="muted">Si el equipo abre una comparación de versiones, vas a poder participar desde este mismo enlace.</p>
            )}

            <section className="panel stack" aria-labelledby="perm">
              <h2 id="perm">Tus permisos</h2>
              {(['research_sharing', 'model_training'] as const).map((p) => (
                <div className="split" key={p}>
                  <span className="grow small">{p === 'research_sharing' ? 'Datos para investigación' : 'Entrenar o evaluar modelos'}: <strong>{state.consents[p] ? 'autorizado' : 'no autorizado'}</strong></span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await run(() => testerCall(token, 'consent', { purpose: p, granted: !state.consents[p] }));
                      if (ok) await load();
                    }}
                  >
                    {state.consents[p] ? 'Retirar permiso' : 'Autorizar'}
                  </button>
                </div>
              ))}
            </section>

            <section className="panel stack" aria-labelledby="mine">
              <h2 id="mine">Hallazgos que citan tus comentarios</h2>
              <p className="field-help">Si una interpretación no refleja lo que quisiste decir, corregila. La corrección queda en el historial.</p>
              {evidence === null && <p>Cargando…</p>}
              {evidence && evidence.length === 0 && <p className="muted">Todavía no hay hallazgos que citen tus comentarios.</p>}
              {evidence?.map((ev) => (
                <article key={ev.id} className="stack panel panel-tight" style={{ ['--gap' as string]: 'var(--s-2)' }}>
                  <p className="mono small">
                    {mmss(ev.interval_start_ms)} a {mmss(ev.interval_end_ms)}
                  </p>
                  <p>
                    <strong>Lo que escribiste:</strong> {ev.human_statement}
                  </p>
                  <p>
                    <strong>Observación:</strong> {ev.observation}
                  </p>
                  {ev.hypothesis && (
                    <p>
                      <strong>Interpretación propuesta:</strong> {ev.hypothesis}
                    </p>
                  )}
                  {ev.evidence_reviews.filter((r) => r.reviewer_kind === 'participant').map((r, i) => (
                    <p key={i} className="small muted">Tu corrección: {r.note}</p>
                  ))}
                  <div className="field">
                    <label htmlFor={`n-${ev.id}`}>Corregir la interpretación</label>
                    <textarea id={`n-${ev.id}`} className="textarea" value={notes[ev.id] ?? ''} onChange={(e) => setNotes({ ...notes, [ev.id]: e.target.value })} />
                  </div>
                  <div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy || !(notes[ev.id] ?? '').trim()}
                      onClick={async () => {
                        const ok = await run(() => testerCall(token, 'note', { evidence_id: ev.id, note: notes[ev.id] }));
                        if (ok) {
                          setNotes({ ...notes, [ev.id]: '' });
                          setEvidence(null);
                        }
                      }}
                    >
                      Enviar corrección
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}

        {state.phase === 'withdrawn' && (
          <p className="callout">Registramos tu retiro y retiramos tus permisos de investigación. Si ya entregaste material, el equipo no lo incluirá en exports de investigación.</p>
        )}

        {state.assignment && state.phase !== 'done' && state.phase !== 'withdrawn' && (
          <p className="small muted">
            ¿Querés dejar el estudio?{' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                if (!confirm('Vas a retirarte del estudio y se retiran tus permisos de investigación. ¿Continuar?')) return;
                const ok = await run(() => testerCall(token, 'withdraw'));
                if (ok) await load();
              }}
            >
              Retirarme
            </button>
          </p>
        )}
      </div>
      {aside}
    </div>
  );
}
