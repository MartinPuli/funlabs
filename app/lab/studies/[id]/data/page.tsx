import type { Metadata } from 'next';
import { createUserClient } from '@/lib/supabase/server';
import { dateTime, money } from '@/lib/format';
import type { BudgetSummary } from '@/lib/budget';
import { CreatorConsent, DownloadButton, ExportForm } from '@/components/lab/ExportPanel';
import { providerStatus } from '@/lib/env';

export const metadata: Metadata = { title: 'Data and budget' };

const KIND_LABEL: Record<string, string> = {
  contribution: 'Client contribution',
  reservation: 'Reservation per assignment',
  release: 'Reservation released or applied',
  payout: 'Payout for a valid submission',
  agent_reward: 'Reward to an agent operator',
  analysis_cost: 'Analysis cost',
  operation_cost: 'Operation cost',
};

export default async function DataPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, budget, entries, events, exports, consents, assignments, reviewTime, user] = await Promise.all([
    supabase.from('studies').select('*').eq('id', id).single(),
    supabase.rpc('study_budget', { p_study: id }),
    supabase.from('budget_entries').select('*').eq('study_id', id).order('created_at', { ascending: false }).limit(60),
    supabase.from('payment_events').select('*').eq('study_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('dataset_exports').select('*').eq('study_id', id).order('created_at', { ascending: false }),
    supabase.from('consent_records').select('assignment_id, purpose, granted, created_at').eq('study_id', id).eq('subject', 'participant').order('created_at'),
    supabase.from('assignments').select('id, participant_code, status').eq('study_id', id).order('accepted_at'),
    supabase.from('review_time').select('seconds').eq('study_id', id),
    supabase.auth.getUser(),
  ]);
  if (!study.data) return null;
  const s = study.data;
  const b = budget.data as BudgetSummary | null;
  const isOwner = user.data.user?.id === s.owner_id;
  const latest = new Map<string, { research: boolean; training: boolean }>();
  for (const c of consents.data ?? []) {
    if (!c.assignment_id) continue;
    const cur = latest.get(c.assignment_id) ?? { research: false, training: false };
    if (c.purpose === 'research_sharing') cur.research = c.granted;
    if (c.purpose === 'model_training') cur.training = c.granted;
    latest.set(c.assignment_id, cur);
  }
  const reviewSeconds = (reviewTime.data ?? []).reduce((a, r) => a + r.seconds, 0);
  const providers = providerStatus();

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="stack" aria-labelledby="bud">
        <div className="split">
          <h2 id="bud" className="section-title">Budget and subsidy</h2>
          <span className="test-mode">Payments in test mode</span>
        </div>
        {b && (
          <div className="grid-2">
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Budget summary</caption>
                <tbody>
                  <tr><th scope="row">Spending cap</th><td className="num">{money(b.cap)}</td></tr>
                  <tr><th scope="row">Reserved (submissions in progress)</th><td className="num">{money(b.reserved)}</td></tr>
                  <tr><th scope="row">Paid to people</th><td className="num">{money(b.paid)}</td></tr>
                  <tr><th scope="row">Rewards to agent operators</th><td className="num">{money(b.agent_rewards)}</td></tr>
                  <tr><th scope="row">Analysis and operation recorded</th><td className="num">{money(b.analysis + b.operation)}</td></tr>
                  <tr><th scope="row">Committed</th><td className="num"><strong>{money(b.committed)}</strong></td></tr>
                  <tr><th scope="row">Available</th><td className="num"><strong>{money(b.remaining)}</strong></td></tr>
                </tbody>
              </table>
            </div>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <p className="small"><strong>Expected subsidy</strong> = human payout + agent operator reward + analysis and processing + operation − client contribution.</p>
              <dl className="kv small">
                <dt>Expected human payout</dt><dd>{money(b.planned.testers)}</dd>
                <dt>Agent rewards</dt><dd>{money(b.planned.agent_rewards)}</dd>
                <dt>Estimated analysis</dt><dd>{money(b.planned.analysis)}</dd>
                <dt>Estimated operation</dt><dd>{money(b.planned.operation)}</dd>
                <dt>Client contribution</dt><dd>− {money(b.planned.contribution)}</dd>
                <dt><strong>Expected subsidy</strong></dt><dd><strong>{money(b.planned.subsidy)}</strong></dd>
              </dl>
              <p className="field-help">The subsidy is a prior decision with a cap, not a reward for favorable results. An internal reservation is not an escrow and does not prove a transfer. Stripe: {providers.stripe.configured ? 'configured in test mode' : 'not configured in this environment, the record is internal'}.</p>
              <p className="field-help">Review time recorded on the evidence desk: <strong>{Math.round(reviewSeconds / 60)} min</strong> (active team time).</p>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col" className="num">Amount</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {(entries.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">No entries.</td></tr>}
              {(entries.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="small nowrap">{dateTime(e.created_at)}</td>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td className="num">{e.kind === 'release' ? '−' : ''}{money(e.amount_cents)}</td>
                  <td className="small muted">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(events.data ?? []).length > 0 && (
          <details>
            <summary className="small"><strong>Payment events ({(events.data ?? []).length})</strong></summary>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {(events.data ?? []).map((e) => <li key={e.id}><span className="mono">{e.event_type}</span> ({e.provider}, {e.signature_verified ? 'signature verified' : 'unsigned'}) {dateTime(e.created_at)}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="stack" aria-labelledby="perm">
        <h2 id="perm" className="section-title">Research permissions</h2>
        <p className="muted measure">Taking part and accepting the recording does not authorize sharing data. To be included in an export you need the owner's authorization and each participant's, and the findings must be reviewed.</p>
        <CreatorConsent studyId={id} granted={s.creator_research_consent} disabled={!isOwner} />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Person</th><th scope="col">Status</th><th scope="col">Research</th><th scope="col">Train or evaluate models</th></tr></thead>
            <tbody>
              {(assignments.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">No participants yet.</td></tr>}
              {(assignments.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.participant_code}</strong></td>
                  <td>{a.status === 'withdrawn' ? 'Withdrew' : 'Participating'}</td>
                  <td>{latest.get(a.id)?.research ? 'Authorized' : 'Not authorized'}</td>
                  <td>{latest.get(a.id)?.training ? 'Authorized' : 'Not authorized'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" aria-labelledby="exp">
        <h2 id="exp" className="section-title">Research export</h2>
        <p className="muted measure">A private download of authorized examples, not a data marketplace. An export does not include raw video or audio. A random ID does not anonymize voices or recordings.</p>
        <ExportForm studyId={id} />
        {(exports.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Contents</th><th scope="col"><span className="visually-hidden">Download</span></th></tr></thead>
              <tbody>
                {(exports.data ?? []).map((e) => {
                  const ex = (e.excluded ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={e.id}>
                      <td className="small"><div>{e.purpose}</div><div className="muted">{dateTime(e.created_at)} · {e.requested_via === 'agent_api' ? 'by an agent' : 'from the interface'} · {e.format}</div></td>
                      <td><span className={`tag ${e.status === 'ready' ? 'tag-success' : e.status === 'blocked' || e.status === 'failed' ? 'tag-error' : 'tag-warning'}`}>{e.status === 'ready' ? 'Ready' : e.status === 'blocked' ? 'Blocked' : e.status === 'failed' ? 'Failed' : e.status === 'expired' ? 'Expired' : 'Preparing'}</span></td>
                      <td className="small">
                        {e.status === 'blocked' && <span className="field-error">{e.blocked_reason}</span>}
                        {e.status === 'ready' && (
                          <>
                            <div>{e.item_count} participant(s); fields: {(e.fields as string[]).join(', ')}</div>
                            <div className="muted">Excluded: {String(ex.participants_without_research_consent ?? 0)} without permission, {String(ex.participants_withdrawn ?? 0)} withdrawn, {String(ex.evidence_unreviewed ?? 0)} unreviewed findings, {String(ex.evidence_rejected ?? 0)} rejected. Video: {String(ex.raw_media ?? 'not included')}.</div>
                            <div className="muted">Expires {dateTime(e.expires_at)}</div>
                          </>
                        )}
                      </td>
                      <td>{e.status === 'ready' && <DownloadButton studyId={id} exportId={e.id} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
