import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { CAPABILITIES, BOUNTY_KIND_LABEL, type Capability } from '@/lib/catalog';
import { dateTime } from '@/lib/format';
import { ActionButton } from '@/components/lab/ActionButton';
import { CredentialForm } from '@/components/lab/CredentialForm';
import { SpendingPolicyForm } from '@/components/lab/SpendingPolicyForm';
import { revokeCredential } from '@/app/lab/actions';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Agents' };

const TOOL_LABEL: Record<string, string> = {
  request_evidence: 'Queries evidence',
  create_study: 'Creates a study',
  publish_study: 'Publishes a study',
  get_study: 'Reads study status',
  get_evidence: 'Reads evidence',
  get_moment: 'Opens a moment',
  submit_agent_work: 'Submits work',
  compare_versions: 'Reads results',
  export_dataset: 'Requests an export',
  get_export: 'Reads an export',
};

export default async function AgentsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const study = await supabase.from('studies').select('id, product_id, status, created_via, owner_id').eq('id', id).single();
  if (!study.data) return null;
  const [product, creds, calls, subs, bounties, member] = await Promise.all([
    supabase.from('products').select('id, slug, spending_policy').eq('id', study.data.product_id).single(),
    supabase.from('agent_credentials').select('*').eq('product_id', study.data.product_id).order('created_at', { ascending: false }),
    supabase.from('agent_tool_calls').select('id, credential_id, tool, transport, status, error_code, duration_ms, output_summary, input, created_at, agent_credentials(label, kind)').eq('study_id', id).order('created_at', { ascending: false }).limit(40),
    supabase.from('agent_submissions').select('id, actor, kind, is_retrospective, status, evaluation, created_at, bounty_id').eq('study_id', id).order('created_at', { ascending: false }),
    supabase.from('bounties').select('id, kind, title').eq('study_id', id),
    supabase.auth.getUser(),
  ]);
  const isOwner = member.data.user?.id === study.data.owner_id;
  const policy = (product.data?.spending_policy ?? {}) as { agent_can_publish?: boolean; max_budget_cents?: number };
  const visibleCreds = (creds.data ?? []).filter((c) => !c.study_id || c.study_id === id);

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="stack" aria-labelledby="how">
        <h2 id="how" className="section-title">How an agent connects</h2>
        <p className="muted measure">Agents use the same tools you see in the interface, with structured inputs and outputs. They don't need to read a dashboard or copy a summary.</p>
        <div className="grid-2">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <strong>API REST</strong>
            <pre className="code-block">{`curl -X POST ${env.siteUrl}/api/agent/get_evidence \\
  -H "Authorization: Bearer fla_..." \\
  -H "Content-Type: application/json" \\
  -d '{"study_id":"${id}"}'`}</pre>
          </div>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <strong>MCP server (HTTP)</strong>
            <pre className="code-block">{`claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."`}</pre>
          </div>
        </div>
        <p className="small"><Link href="/agents">Full tool reference</Link></p>
      </section>

      <SpendingPolicyForm studyId={id} enabled={Boolean(policy.agent_can_publish)} maxUsd={(policy.max_budget_cents ?? 0) / 100} disabled={!isOwner} />

      <section className="stack" aria-labelledby="creds">
        <h2 id="creds" className="section-title">Work credentials</h2>
        <p className="field-help measure">Each credential limits actor, study, capabilities and expiry. It is never an admin key. Only its fingerprint is stored: the token is shown once.</p>
        {visibleCreds.length === 0 ? (
          <p className="empty">There are no credentials for this product yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Scope and capabilities</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {visibleCreds.map((c) => {
                  const expired = new Date(c.expires_at).getTime() < Date.now();
                  const b = (bounties.data ?? []).find((x) => x.id === c.bounty_id);
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.label}</strong><div className="mono small muted">…{c.token_hint}</div></td>
                      <td>{c.kind === 'creator_agent' ? 'Creator agent' : 'Participating agent'}{b && <div className="small muted">{BOUNTY_KIND_LABEL[b.kind]}</div>}</td>
                      <td className="small">
                        <div>{c.study_id ? 'This study' : 'The whole product'}</div>
                        <div className="muted">{(c.capabilities as Capability[]).map((cap) => <span key={cap} className="mono" title={CAPABILITIES[cap]} style={{ marginRight: 8 }}>{cap}</span>)}</div>
                      </td>
                      <td className="small">
                        {c.revoked_at ? <span className="tag tag-error">Revoked</span> : expired ? <span className="tag tag-warning">Expired</span> : <span className="tag tag-success">Active</span>}
                        <div className="muted">Expires {dateTime(c.expires_at)}</div>
                        <div className="muted">{c.last_used_at ? `Last used ${dateTime(c.last_used_at)}` : 'Not used yet'}</div>
                        {c.labels_seen_at && <div className="muted">Saw human results on {dateTime(c.labels_seen_at)}</div>}
                      </td>
                      <td>{!c.revoked_at && !expired && isOwner && <ActionButton action={revokeCredential.bind(null, id, c.id)} label="Revoke" size="sm" variant="danger" confirmText="Revoke the credential? It stops working immediately." />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {isOwner && study.data.status !== 'draft' ? (
          <CredentialForm studyId={id} bounties={bounties.data ?? []} />
        ) : isOwner ? (
          <CredentialForm studyId={id} bounties={bounties.data ?? []} />
        ) : (
          <p className="callout">Only the study owner can create credentials.</p>
        )}
      </section>

      <section className="stack" aria-labelledby="runs">
        <h2 id="runs" className="section-title">Agent activity</h2>
        <p className="field-help measure">Observable actions and their results. Private reasoning and credentials are never recorded.</p>
        {(calls.data ?? []).length === 0 ? (
          <p className="empty">No activity yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">When</th><th scope="col">Agent</th><th scope="col">Tool</th><th scope="col">Result</th><th scope="col" className="num">ms</th></tr></thead>
              <tbody>
                {(calls.data ?? []).map((c) => {
                  const cred = c.agent_credentials as unknown as { label: string; kind: string } | null;
                  const out = (c.output_summary ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={c.id}>
                      <td className="small nowrap">{dateTime(c.created_at)}</td>
                      <td className="small">{cred?.label ?? '?'}<div className="muted">{c.transport === 'mcp' ? 'MCP' : 'REST'}</div></td>
                      <td><strong>{TOOL_LABEL[c.tool] ?? c.tool}</strong><div className="mono small muted">{c.tool}</div></td>
                      <td className="small">
                        <span className={`tag ${c.status === 'ok' ? 'tag-success' : c.status === 'denied' ? 'tag-warning' : 'tag-error'}`}>{c.status === 'ok' ? 'OK' : c.status === 'denied' ? 'Denied' : 'Error'}{c.error_code ? `: ${c.error_code}` : ''}</span>
                        {c.status === 'ok' && <div className="muted">{Object.entries(out).filter(([, v]) => typeof v !== 'object').slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>}
                      </td>
                      <td className="num mono">{c.duration_ms ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="subs">
        <h2 id="subs" className="section-title">Agent submissions</h2>
        {(subs.data ?? []).length === 0 ? (
          <p className="empty">No agent has submitted work for this study.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Recorded</th><th scope="col">Agent</th><th scope="col">Work</th><th scope="col">Evaluation</th></tr></thead>
              <tbody>
                {(subs.data ?? []).map((s) => {
                  const ev = (s.evaluation ?? {}) as { valid?: boolean; reasons?: string[]; criteria?: Record<string, number | null>; counts?: Record<string, number>; note?: string; accepted?: boolean };
                  return (
                    <tr key={s.id}>
                      <td className="small nowrap">{dateTime(s.created_at)}{s.kind === 'prediction' && (s.is_retrospective ? <div><span className="tag tag-warning">Retrospective</span></div> : <div><span className="tag tag-success">Before results</span></div>)}</td>
                      <td className="small">{s.actor}</td>
                      <td>{s.kind === 'prediction' ? 'Preference prediction' : s.kind === 'analysis' ? 'Evidence analysis' : 'Intervention'}</td>
                      <td className="small">
                        {s.kind === 'analysis' && ev.counts && (
                          <>
                            <span className={`tag ${ev.valid ? 'tag-success' : 'tag-error'}`}>{ev.valid ? 'Valid' : 'Not valid'}</span>
                            <div className="muted">{ev.counts.findings} findings: {ev.counts.verified} verified, {ev.counts.partial} partial, {ev.counts.unsupported} unsupported. Coverage {Math.round((ev.criteria?.coverage ?? 0) * 100)}%.</div>
                            {ev.reasons?.map((r) => <div key={r} className="field-error">{r}</div>)}
                          </>
                        )}
                        {s.kind === 'prediction' && <Link href={`/lab/studies/${id}/comparison`}>View evaluation</Link>}
                        {s.kind === 'intervention' && <Link href={`/lab/studies/${id}/versions`}>View intervention</Link>}
                      </td>
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
