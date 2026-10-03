import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { BOUNTY_KIND_LABEL, type StudyStatus } from '@/lib/catalog';
import { dateTime, JOB_KIND_LABEL, JOB_STATUS_LABEL, minutes, mmss, money } from '@/lib/format';
import type { BudgetSummary } from '@/lib/budget';
import { ActionButton } from '@/components/lab/ActionButton';
import { InviteManager } from '@/components/lab/InviteManager';
import { DeliveryReview } from '@/components/lab/DeliveryReview';
import { deleteDraftStudy, processQueueAction, publishStudyAction, requestAnalysis, retryJobAction, revokeInvite, setStudyPhase } from '@/app/lab/actions';

export default async function StudyOverview(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, versions, bounties, invites, assignments, deliveries, sessions, jobs, budget, evidence, comparisons, reviewTime] = await Promise.all([
    supabase.from('studies').select('*').eq('id', id).single(),
    supabase.from('study_versions').select('role, version_id, versions(id, label, status, content_sha256, origin, created_at)').eq('study_id', id),
    supabase.from('bounties').select('*').eq('study_id', id).order('created_at'),
    supabase.from('invitations').select('id, label, token_hint, expires_at, revoked_at, created_at, assignments(participant_code, status)').eq('study_id', id).order('created_at'),
    supabase.from('assignments').select('id, participant_code, status, accepted_at').eq('study_id', id).order('accepted_at'),
    supabase.from('deliveries').select('*').eq('study_id', id).order('created_at'),
    supabase.from('sessions').select('id, assignment_id, phase, position, neutral_label, status, recordings(status, duration_ms, method, has_audio)').eq('study_id', id),
    supabase.from('jobs').select('id, kind, status, attempts, max_attempts, runner, last_error, created_at, finished_at, input').eq('study_id', id).order('created_at', { ascending: false }).limit(15),
    supabase.rpc('study_budget', { p_study: id }),
    supabase.from('evidence').select('id, structural_status, review_status').eq('study_id', id),
    supabase.from('comparisons').select('id', { count: 'exact', head: true }).eq('study_id', id),
    supabase.from('review_time').select('seconds').eq('study_id', id),
  ]);
  if (!study.data) return null;
  const s = study.data;
  const status = s.status as StudyStatus;
  const b = budget.data as BudgetSummary | null;
  const ev = evidence.data ?? [];
  const sess = sessions.data ?? [];
  const codeOf = new Map((assignments.data ?? []).map((a) => [a.id, a.participant_code]));
  const materialMs = sess.reduce((acc, x) => acc + ((x.recordings as unknown as { duration_ms: number | null } | null)?.duration_ms ?? 0), 0);
  const playtestDeliveries = (deliveries.data ?? []).filter((d) => d.phase === 'playtest');
  const waiting = Math.max(0, s.participants_target - playtestDeliveries.length);
  const variant = (versions.data ?? []).find((v) => v.role === 'variant');
  const reviewed = ev.filter((e) => e.review_status !== 'unreviewed').length;
  const reviewMin = Math.round((reviewTime.data ?? []).reduce((a, r) => a + r.seconds, 0) / 60);

  let next: { title: string; body: string; action?: React.ReactNode } = { title: '', body: '' };
  if (status === 'draft') {
    next = {
      title: 'Publish the request',
      body: 'Publishing fixes the question, the objective, the protocol, the budget and the set of checks. After that you can invite people.',
      action: <ActionButton action={publishStudyAction.bind(null, id)} label="Publish study" variant="primary" pendingLabel="Publishing…" processQueue studyId={id} confirmText="Publishing fixes the question, the objective and the budget. Continue?" />,
    };
  } else if (['published', 'collecting'].includes(status) && playtestDeliveries.length === 0) {
    next = { title: (invites.data ?? []).length ? `Waiting for ${waiting} ${waiting === 1 ? 'submission' : 'submissions'}` : 'Invite people', body: 'Share one link per person. Each link is their credential: no account needed.' };
  } else if (status === 'analyzing') {
    next = { title: 'Analyzing material', body: 'Gemini proposes findings and FUNLABS verifies that each source exists and belongs to the session. The page updates by itself.' };
  } else if (['evidence_ready', 'collecting'].includes(status) && !variant) {
    next = {
      title: reviewed < ev.length ? `Review evidence (${ev.length - reviewed} unreviewed)` : 'Decide on an intervention',
      body: 'Confirm, correct or reject findings and choose which ones motivate a change. Claude edits a copy within the allowed scope.',
      action: <Link className="btn btn-primary" href={`/lab/studies/${id}/evidence`}>Open evidence</Link>,
    };
  } else if (variant && status !== 'comparing' && status !== 'completed') {
    next = {
      title: 'Open the A/B comparison',
      body: 'The variant passed its checks. People will see both versions with neutral names and alternating order, on the same link.',
      action: <ActionButton action={setStudyPhase.bind(null, id, 'comparing')} label="Open comparison" variant="primary" />,
    };
  } else if (status === 'comparing') {
    next = {
      title: `Comparisons received: ${comparisons.count ?? 0}`,
      body: 'Preferences are shown with the denominator, reasons and limitations. Close the study when you are done.',
      action: <ActionButton action={setStudyPhase.bind(null, id, 'completed')} label="Complete study" confirmText="Complete the study? No more submissions will be accepted." />,
    };
  } else if (status === 'completed') {
    next = { title: 'Study completed', body: 'Results and the private export remain available to people with access.', action: <Link className="btn" href={`/lab/studies/${id}/data`}>View data</Link> };
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="panel stack" aria-labelledby="next-step">
        <div className="split">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h2 id="next-step" className="title-lg">{next.title}</h2>
            <p className="muted measure">{next.body}</p>
          </div>
          {next.action}
        </div>
        <div className="cluster" style={{ ['--gap' as string]: 'var(--s-6)' }}>
          <div className="stat"><span className="stat-value">{(assignments.data ?? []).length}/{s.participants_target}</span><span className="stat-label">people accepted</span></div>
          <div className="stat"><span className="stat-value">{playtestDeliveries.length}</span><span className="stat-label">playtest submissions</span></div>
          <div className="stat"><span className="stat-value">{minutes(materialMs)}</span><span className="stat-label">of recording</span></div>
          <div className="stat"><span className="stat-value">{ev.length}</span><span className="stat-label">findings ({reviewed} reviewed)</span></div>
          <div className="stat"><span className="stat-value">{reviewMin} min</span><span className="stat-label">of team review</span></div>
          <div className="stat"><span className="stat-value">{comparisons.count ?? 0}</span><span className="stat-label">A/B comparisons</span></div>
        </div>
      </section>

      <section className="stack" aria-labelledby="material">
        <h2 id="material" className="section-title">Material received</h2>
        {(assignments.data ?? []).length === 0 ? (
          <p className="empty">No participants yet. {status === 'draft' ? 'Publish the study and create invites.' : 'Share the invites.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Person</th><th scope="col">Sessions</th><th scope="col">Submissions</th><th scope="col">Review</th></tr>
              </thead>
              <tbody>
                {(assignments.data ?? []).map((a) => {
                  const mine = sess.filter((x) => x.assignment_id === a.id).sort((x, y) => (x.phase + x.position).localeCompare(y.phase + y.position));
                  const dels = (deliveries.data ?? []).filter((d) => d.assignment_id === a.id);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.participant_code}</strong>
                        {a.status === 'withdrawn' && <span className="tag tag-warning" style={{ marginLeft: 6 }}>Withdrew</span>}
                      </td>
                      <td>
                        <ul className="stack small" style={{ listStyle: 'none', margin: 0, padding: 0, ['--gap' as string]: '6px' }}>
                          {mine.length === 0 && <li className="muted">No sessions</li>}
                          {mine.map((x) => {
                            const r = x.recordings as unknown as { status: string; duration_ms: number | null; method: string; has_audio: boolean } | null;
                            return (
                              <li key={x.id} className="cluster" style={{ ['--gap' as string]: '6px' }}>
                                <span>{x.phase === 'playtest' ? 'Playtest' : `Comparison ${x.position}`}: {x.neutral_label}</span>
                                {r ? (
                                  <span className={`tag ${r.status === 'verified' ? 'tag-success' : r.status === 'failed' ? 'tag-error' : 'tag-warning'}`}>
                                    {r.status === 'verified' ? `Recording ${mmss(r.duration_ms)}${r.has_audio ? ' with voice' : ''}` : r.status === 'failed' ? 'Upload failed' : 'Uploading'}
                                  </span>
                                ) : (
                                  <span className="tag tag-outline">{x.status === 'submitted' ? 'No recording (written)' : 'In progress'}</span>
                                )}
                                {r?.method === 'manual_upload' && <span className="tag tag-outline">Manual upload</span>}
                                {x.status === 'submitted' && (
                                  <ActionButton action={requestAnalysis.bind(null, id, x.id)} label="Analyze again" size="sm" variant="ghost" processQueue studyId={id} />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td className="small">
                        {dels.length === 0 && <span className="muted">Not submitted</span>}
                        {dels.map((d) => {
                          const auto = d.auto_checks as Record<string, unknown>;
                          return (
                            <div key={d.id} className="stack" style={{ ['--gap' as string]: '2px', marginBottom: 8 }}>
                              <strong>{d.phase === 'playtest' ? 'Playtest' : 'Comparison'}</strong>
                              <span className="muted">
                                {d.phase === 'playtest'
                                  ? `${auto.recording}; ${auto.game_events} events; ${auto.moments} comments; ${auto.answers} answers`
                                  : `${auto.game_events} events; reason of ${auto.reason_length} characters`}
                              </span>
                            </div>
                          );
                        })}
                      </td>
                      <td>
                        {dels.map((d) => (
                          <div key={d.id} style={{ marginBottom: 8 }}>
                            {d.status === 'submitted' ? (
                              <DeliveryReview studyId={id} deliveryId={d.id} />
                            ) : (
                              <span className={`tag ${d.status === 'valid' ? 'tag-success' : 'tag-error'}`}>{d.status === 'valid' ? 'Valid, test payout recorded' : `Not usable${d.note ? `: ${d.note}` : ''}`}</span>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="stack" aria-labelledby="invites">
          <h2 id="invites" className="section-title">Invites</h2>
          <InviteManager studyId={id} disabled={status === 'draft' || status === 'completed'} />
          {(invites.data ?? []).length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Link</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {(invites.data ?? []).map((inv) => {
                    const a = (inv.assignments as unknown as Array<{ participant_code: string; status: string }> | null)?.[0];
                    const expired = new Date(inv.expires_at).getTime() < Date.now();
                    return (
                      <tr key={inv.id}>
                        <td>{inv.label} <span className="mono muted">…{inv.token_hint}</span></td>
                        <td>{inv.revoked_at ? 'Revoked' : a ? `Accepted by ${a.participant_code}` : expired ? 'Expired' : 'Pending'}</td>
                        <td>{!inv.revoked_at && !a && <ActionButton action={revokeInvite.bind(null, id, inv.id)} label="Revoke" size="sm" variant="ghost" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack" aria-labelledby="budget">
          <div className="split">
            <h2 id="budget" className="section-title">Budget</h2>
            <span className="test-mode">Payments in test mode</span>
          </div>
          {b && (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr><th scope="row">Spending cap</th><td className="num">{money(b.cap)}</td></tr>
                  <tr><th scope="row">Reserved for submissions in progress</th><td className="num">{money(b.reserved)}</td></tr>
                  <tr><th scope="row">Paid to people (test)</th><td className="num">{money(b.paid)}</td></tr>
                  <tr><th scope="row">Rewards to agent operators</th><td className="num">{money(b.agent_rewards)}</td></tr>
                  <tr><th scope="row">Available</th><td className="num"><strong>{money(b.remaining)}</strong></td></tr>
                  <tr><th scope="row">Expected subsidy</th><td className="num">{money(b.planned.subsidy)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="field-help">The internal reservation is not an escrow or a transfer. When the cap runs out, new assignments stop.</p>
        </section>
      </div>

      <details>
        <summary id="bounties">Bounties ({(bounties.data ?? []).length})</summary>
        <p className="field-help" style={{ marginBottom: 'var(--s-3)' }}>Each kind of work has its own criteria. People and agents are not compared with a single score.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Work</th><th scope="col">Evaluation criteria</th><th scope="col" className="num">Pay</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {(bounties.data ?? []).map((bo) => (
                <tr key={bo.id}>
                  <td>
                    <span className="tag tag-outline">{bo.kind.startsWith('human') ? 'Human' : 'Agent'}</span>
                    <div><strong>{BOUNTY_KIND_LABEL[bo.kind]}</strong></div>
                    <div className="small muted">{bo.instructions}</div>
                  </td>
                  <td className="small">
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {(bo.criteria as Array<{ key: string; text: string }>).map((c) => <li key={c.key}>{c.text}</li>)}
                    </ul>
                  </td>
                  <td className="num">{bo.kind === 'agent_intervention' ? 'Creator agent' : `${money(bo.reward_cents)}${bo.kind === 'human_playtest' ? ' per submission' : ''}`}</td>
                  <td>{bo.status === 'open' ? 'Open' : bo.status === 'draft' ? 'Draft' : 'Closed'}{bo.kind === 'human_playtest' ? ` (${(assignments.data ?? []).length}/${bo.slots})` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details open={(jobs.data ?? []).some((j) => j.status === 'failed' || j.status === 'queued')}>
        <summary id="jobs">Jobs ({(jobs.data ?? []).length})</summary>
        {(jobs.data ?? []).length === 0 ? (
          <p className="muted">No jobs yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Ran on</th><th scope="col">Details</th></tr></thead>
              <tbody>
                {(jobs.data ?? []).map((j) => (
                  <tr key={j.id}>
                    <td>{JOB_KIND_LABEL[j.kind] ?? j.kind}<div className="small muted">{dateTime(j.created_at)}</div></td>
                    <td><span className={`tag ${j.status === 'succeeded' ? 'tag-success' : j.status === 'failed' ? 'tag-error' : j.status === 'running' ? 'tag-warning' : ''}`}>{JOB_STATUS_LABEL[j.status]}</span></td>
                    <td className="num">{j.attempts}/{j.max_attempts}</td>
                    <td className="small mono">{j.runner ?? '-'}</td>
                    <td className="small">
                      {j.last_error && <p className={j.status === 'failed' ? 'field-error' : 'muted'}>{j.last_error}</p>}
                      {j.status === 'failed' && <ActionButton action={retryJobAction.bind(null, id, j.id)} label="Retry" size="sm" processQueue studyId={id} />}
                      {j.status === 'queued' && <ActionButton action={processQueueAction.bind(null, id)} label="Process now" size="sm" variant="ghost" processQueue studyId={id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {status === 'draft' && (
        <form action={deleteDraftStudy.bind(null, id)} className="split">
          <p className="muted small">This study is a draft. A draft can be deleted.</p>
          <button className="btn btn-danger btn-sm" type="submit">Delete draft</button>
        </form>
      )}
    </div>
  );
}
