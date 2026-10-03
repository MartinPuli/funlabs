import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { comparisonSummary, evaluatePrediction, type PredictionPayload } from '@/lib/results';
import { dateTime } from '@/lib/format';
import { ActionButton } from '@/components/lab/ActionButton';
import { setStudyPhase } from '@/app/lab/actions';

export const metadata: Metadata = { title: 'Comparison' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="stack" style={{ ['--gap' as string]: '4px' }}>
      <div className="split" style={{ gap: 8 }}>
        <span>{label}</span>
        <strong className="mono">{n} of {total}</strong>
      </div>
      <div className="bar" role="img" aria-label={`${label}: ${n} of ${total}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function ComparisonPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, summary, subs, variantReady] = await Promise.all([
    supabase.from('studies').select('id, status, objective, question').eq('id', id).single(),
    comparisonSummary(supabase, id),
    supabase.from('agent_submissions').select('*').eq('study_id', id).eq('kind', 'prediction').order('created_at'),
    supabase.from('study_versions').select('version_id, versions(status)').eq('study_id', id).eq('role', 'variant'),
  ]);
  if (!study.data) return null;
  const s = study.data;
  const hasVariant = (variantReady.data ?? []).some((v) => (v.versions as unknown as { status: string } | null)?.status === 'ready');
  const bName = summary.baseline ? `version ${summary.baseline.label}` : 'the baseline version';
  const vName = summary.variant ? `version ${summary.variant.label}` : 'the variant';

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="panel stack" aria-labelledby="res">
        <div className="split">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h2 id="res" className="section-title">Human preferences</h2>
            <p className="muted measure">Fixed question: {s.question}</p>
          </div>
          {!hasVariant && <span className="tag tag-outline">No variant is ready yet</span>}
          {hasVariant && s.status !== 'comparing' && s.status !== 'completed' && (
            <ActionButton action={setStudyPhase.bind(null, id, 'comparing')} label="Open comparison" variant="primary" />
          )}
          {s.status === 'comparing' && <ActionButton action={setStudyPhase.bind(null, id, 'completed')} label="Complete study" confirmText="Complete the study? No more submissions will be accepted." />}
        </div>

        {summary.total === 0 ? (
          <div className="empty">
            <strong>Comparison pending</strong>
            <span className="muted">
              {s.status === 'comparing'
                ? 'The comparison is open. Waiting for the first answers; each person sees both versions with neutral names and alternating order.'
                : hasVariant
                  ? 'Open the comparison so that people who already tried the baseline version see both versions.'
                  : 'First you need a variant that has passed the checks. See the Versions tab.'}
            </span>
          </div>
        ) : (
          <>
            <p className="measure">
              With a sample of <strong>{summary.total}</strong> {summary.total === 1 ? 'person' : 'people'}, {summary.preferVariant} of {summary.total} preferred {vName}, {summary.preferBaseline} preferred {bName} and {summary.noPreference} had no preference.
            </p>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <Row label={`Preferred ${vName}`} n={summary.preferVariant} total={summary.total} />
              <Row label={`Preferred ${bName}`} n={summary.preferBaseline} total={summary.total} />
              <Row label="No preference" n={summary.noPreference} total={summary.total} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Preferences by presentation order</caption>
                <thead>
                  <tr><th scope="col">Order shown</th><th scope="col" className="num">People</th><th scope="col" className="num">{cap(vName)}</th><th scope="col" className="num">{cap(bName)}</th><th scope="col" className="num">No preference</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">{cap(bName)} first</th><td className="num">{summary.byOrder.baselineFirst.total}</td><td className="num">{summary.byOrder.baselineFirst.preferVariant}</td><td className="num">{summary.byOrder.baselineFirst.preferBaseline}</td><td className="num">{summary.byOrder.baselineFirst.none}</td></tr>
                  <tr><th scope="row">{cap(vName)} first</th><td className="num">{summary.byOrder.variantFirst.total}</td><td className="num">{summary.byOrder.variantFirst.preferVariant}</td><td className="num">{summary.byOrder.variantFirst.preferBaseline}</td><td className="num">{summary.byOrder.variantFirst.none}</td></tr>
                </tbody>
              </table>
            </div>
            {summary.limitations.length > 0 && (
              <div className="callout callout-warning">
                <strong>Limits of this test</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {summary.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {summary.reasons.length > 0 && (
        <section className="stack" aria-labelledby="reasons">
          <h2 id="reasons" className="section-title">Stated reasons</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Person</th><th scope="col">Chose</th><th scope="col">Order</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {summary.reasons.map((r) => (
                  <tr key={r.participant + r.created_at}>
                    <td><strong>{r.participant}</strong>{r.prior_exposure && <div className="small muted">Had already played the baseline</div>}</td>
                    <td>{r.preferred === 'baseline' ? cap(bName) : r.preferred === 'variant' ? cap(vName) : 'No preference'}</td>
                    <td className="small">{r.presented}</td>
                    <td><q>{r.reason}</q></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="preds">
        <h2 id="preds" className="section-title">Agent predictions</h2>
        <p className="field-help measure">Each prediction is timestamped before results are revealed. One made after seeing human results counts as retrospective analysis, not as a prediction. A single match does not prove general judgment.</p>
        {(subs.data ?? []).length === 0 ? (
          <p className="empty">No agent has submitted a prediction yet. Request one from the Agents tab.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Agent</th><th scope="col">Recorded</th><th scope="col">Predicted</th><th scope="col">Reasons and uncertainty</th><th scope="col">Evaluation</th></tr></thead>
              <tbody>
                {(subs.data ?? []).map((p) => {
                  const payload = p.payload as PredictionPayload;
                  const ev = evaluatePrediction(payload, p.is_retrospective, summary);
                  const chosen = payload.choice === 'baseline' ? cap(bName) : payload.choice === 'variant' ? cap(vName) : 'No preference';
                  return (
                    <tr key={p.id}>
                      <td>{p.actor}</td>
                      <td className="small">{dateTime(p.created_at)}{p.is_retrospective ? <div><span className="tag tag-warning">Retrospective</span></div> : <div><span className="tag tag-success">Before seeing results</span></div>}</td>
                      <td>{chosen}</td>
                      <td className="small"><div>{payload.reasons}</div><div className="muted">Uncertainty: {payload.uncertainty}</div></td>
                      <td className="small">
                        <span className={`tag ${ev.status === 'evaluated' ? 'tag-outline' : ev.status === 'pending' ? 'tag-outline' : 'tag-warning'}`}>{ev.status === 'evaluated' ? (ev.matchedMajority === null ? 'No majority' : ev.matchedMajority ? 'Matches the majority' : 'Does not match the majority') : ev.status === 'pending' ? 'Pending' : 'Does not count as a prediction'}</span>
                        <div className="muted">{ev.note}</div>
                        {ev.brier !== null && <div className="mono">Brier {ev.brier}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small"><Link href={`/lab/studies/${id}/agents`}>Manage agents and credentials</Link></p>
      </section>
    </div>
  );
}
