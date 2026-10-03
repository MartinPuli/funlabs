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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
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
      setError(err instanceof Error ? err.message : 'Could not load the invite.');
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not prepare the session.');
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

  // Move focus to the heading when the phase changes, not on the first load.
  const lastPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    const phase = state?.phase;
    if (phase && lastPhase.current && lastPhase.current !== phase) headingRef.current?.focus();
    if (phase) lastPhase.current = phase;
  }, [state?.phase]);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
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
              <strong>We could not open the invite.</strong> <span>{error}</span>
            </div>
          ) : (
            <p aria-live="polite">Loading the invite…</p>
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
        <h3>Your task</h3>
        <p className="small">{state.bounty.instructions}</p>
        <dl className="kv small">
          <dt>Duration</dt>
          <dd>{study.session_minutes} min approx.</dd>
          <dt>Pay</dt>
          <dd>
            {money(study.payment_cents, study.currency)} per valid submission <span className="test-mode">Payments in test mode</span>
          </dd>
          <dt>What is recorded</dt>
          <dd>The game tab, game events and what you write. Microphone optional. No camera.</dd>
        </dl>
        {study.rehearsal && <p className="callout callout-warning small">Technical rehearsal: this data does not count as a real study</p>}
      </div>
      <div className="panel panel-tight">
        <h3 className="visually-hidden">Steps</h3>
        <ol className="steps">
          <li data-state={stepState('invite')}>Accept</li>
          <li data-state={stepState('playtest')}>Play and comment</li>
          <li data-state={stepState('comparison')}>Compare two versions (if it opens)</li>
          <li data-state={stepState('done')}>Done</li>
        </ol>
      </div>
    </aside>
  );

  return (
    <div className="tester-layout">
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
        <header className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <p className="muted small">Invitation to a FUNLABS study{state.assignment ? `, participant ${state.assignment.code}` : ''}</p>
          <h1 ref={headingRef} tabIndex={-1}>
            {state.phase === 'invite' && study.title}
            {state.phase === 'playtest' && 'Play and tell us'}
            {state.phase === 'comparison' && 'Compare two versions'}
            {state.phase === 'done' && 'Thanks for taking part'}
            {state.phase === 'withdrawn' && 'You left the study'}
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
              <h2 style={{ fontSize: 18 }}>What counts as a valid submission</h2>
              <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
                {state.bounty.criteria.map((c) => (
                  <li key={c.key}>{c.text}</li>
                ))}
              </ul>
            </div>
            <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <legend>Permissions</legend>
              <label className="choice">
                <input type="checkbox" required checked={consent.participation} onChange={(e) => setConsent({ ...consent, participation: e.target.checked })} />
                <span>
                  <strong>Take part and record the game tab (required)</strong>
                  <span className="field-help" style={{ display: 'block' }}>{CONSENT_TEXTS.participation_recording.text}</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" checked={consent.research} onChange={(e) => setConsent({ ...consent, research: e.target.checked })} />
                <span>
                  <strong>Contribute data to research (optional)</strong>
                  <span className="field-help" style={{ display: 'block' }}>{CONSENT_TEXTS.research_sharing.text}</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" checked={consent.training} onChange={(e) => setConsent({ ...consent, training: e.target.checked })} />
                <span>
                  <strong>Use to train or evaluate models (optional, separate)</strong>
                  <span className="field-help" style={{ display: 'block' }}>{CONSENT_TEXTS.model_training.text}</span>
                </span>
              </label>
            </fieldset>
            <p className="field-help">A participant ID does not anonymize a recording or a voice. Recordings are not distributed: only the study team sees them.</p>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy || !consent.participation}>
                {busy ? 'Accepting…' : 'Accept and continue'}
              </button>
            </div>
          </form>
        )}

        {state.phase === 'playtest' && (
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <p className="measure">{study.protocol.task} If something is unclear, note it when it happens: there are no right answers.</p>
            {sessions.length === 0 && <p aria-live="polite">Preparing the session…</p>}
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
                <h2>Last questions</h2>
                <p className="field-help">Answer in your own words. Saying something was boring or confusing is as useful as saying you liked it.</p>
                {study.protocol.final_questions.map((q) => (
                  <div className="field" key={q.key}>
                    <label htmlFor={`q-${q.key}`}>{q.text}</label>
                    <textarea id={`q-${q.key}`} className="textarea" value={answers[q.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
                  </div>
                ))}
                {!finished[sessions[0].id]?.recorded && sessions[0].recording_status !== 'verified' && (
                  <p className="callout">Without a recording, your written answers are the main material: describe in detail what you did and where you hesitated.</p>
                )}
                <div>
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? 'Sending…' : 'Submit playtest'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {state.phase === 'comparison' && (
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <p className="measure">You will play two versions with neutral names, in the order shown. You can prefer either one or neither: all three answers are equally valid.</p>
            {sessions.length === 0 && <p aria-live="polite">Preparing the versions…</p>}
            {sessions.map((s, i) =>
              i === 0 || finished[sessions[i - 1].id] || ['recorded', 'submitted'].includes(sessions[i - 1].status) ? (
                <SessionRunner key={s.id} token={token} session={s} maxMinutes={study.session_minutes + 3} onFinished={(r) => setFinished((f) => ({ ...f, [s.id]: r }))} />
              ) : (
                <p key={s.id} className="empty">
                  <strong>{s.neutral_label}</strong>
                  <span className="muted">Unlocks when you finish the previous version.</span>
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
                  <legend>Which did you prefer?</legend>
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
                    <span>No preference</span>
                  </label>
                </fieldset>
                <div className="field">
                  <label htmlFor="reason">Why?</label>
                  <textarea id="reason" className="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div>
                  <button className="btn btn-primary" type="submit" disabled={busy || !choice || !reason.trim()}>
                    {busy ? 'Sending…' : 'Submit comparison'}
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
                Your submission has been recorded{playtestDone ? '' : ''}. The team checks that the material is usable; your pay does not depend on whether you liked the game.
                <span className="test-mode" style={{ marginLeft: 8 }}>Payments in test mode</span>
              </p>
            </div>
            {!state.comparison.open && !state.comparison.done && (
              <p className="muted">If the team opens a comparison of versions, you will be able to take part from this same link.</p>
            )}

            <section className="panel stack" aria-labelledby="perm">
              <h2 id="perm">Your permissions</h2>
              {(['research_sharing', 'model_training'] as const).map((p) => (
                <div className="split" key={p}>
                  <span className="grow small">{p === 'research_sharing' ? 'Data for research' : 'Train or evaluate models'}: <strong>{state.consents[p] ? 'authorized' : 'not authorized'}</strong></span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await run(() => testerCall(token, 'consent', { purpose: p, granted: !state.consents[p] }));
                      if (ok) await load();
                    }}
                  >
                    {state.consents[p] ? 'Withdraw permission' : 'Authorize'}
                  </button>
                </div>
              ))}
            </section>

            <section className="panel stack" aria-labelledby="mine">
              <h2 id="mine">Findings that cite your comments</h2>
              <p className="field-help">If an interpretation does not reflect what you meant, correct it. The correction stays in the history.</p>
              {evidence === null && <p>Loading…</p>}
              {evidence && evidence.length === 0 && <p className="muted">No findings cite your comments yet.</p>}
              {evidence?.map((ev) => (
                <article key={ev.id} className="stack panel panel-tight" style={{ ['--gap' as string]: 'var(--s-2)' }}>
                  <p className="mono small">
                    {mmss(ev.interval_start_ms)} to {mmss(ev.interval_end_ms)}
                  </p>
                  <p>
                    <strong>What you wrote:</strong> {ev.human_statement}
                  </p>
                  <p>
                    <strong>Observation:</strong> {ev.observation}
                  </p>
                  {ev.hypothesis && (
                    <p>
                      <strong>Proposed interpretation:</strong> {ev.hypothesis}
                    </p>
                  )}
                  {ev.evidence_reviews.filter((r) => r.reviewer_kind === 'participant').map((r, i) => (
                    <p key={i} className="small muted">Your correction: {r.note}</p>
                  ))}
                  <div className="field">
                    <label htmlFor={`n-${ev.id}`}>Correct the interpretation</label>
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
                      Send correction
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}

        {state.phase === 'withdrawn' && (
          <p className="callout">We recorded your withdrawal and removed your research permissions. If you already submitted material, the team will not include it in research exports.</p>
        )}

        {state.assignment && state.phase !== 'done' && state.phase !== 'withdrawn' && (
          <p className="small muted">
            Want to leave the study?{' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                if (!confirm('You are about to leave the study and your research permissions will be withdrawn. Continue?')) return;
                const ok = await run(() => testerCall(token, 'withdraw'));
                if (ok) await load();
              }}
            >
              Leave the study
            </button>
          </p>
        )}
      </div>
      {aside}
    </div>
  );
}
