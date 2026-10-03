'use client';

import { useActionState, useState } from 'react';
import { createCredentialAction, type ActionState } from '@/app/lab/actions';
import { CAPABILITIES, CREATOR_AGENT_CAPABILITIES, PREDICTION_AGENT_CAPABILITIES } from '@/lib/catalog';

type Bounty = { id: string; kind: string; title: string };

/** Mints a scoped work credential. The token is shown once; only its hash is stored. */
export function CredentialForm({ studyId, bounties }: { studyId: string; bounties: Bounty[] }) {
  const [state, action, pending] = useActionState(createCredentialAction, { ok: false } as ActionState);
  const [kind, setKind] = useState<'creator_agent' | 'participant_agent'>('creator_agent');
  const [copied, setCopied] = useState(false);
  const token = state.data?.token as string | undefined;
  const caps = kind === 'creator_agent' ? CREATOR_AGENT_CAPABILITIES : PREDICTION_AGENT_CAPABILITIES;
  const agentBounties = bounties.filter((b) => b.kind === 'agent_prediction' || b.kind === 'agent_analysis');

  return (
    <form action={action} className="panel stack" key={kind}>
      <input type="hidden" name="study_id" value={studyId} />
      <h3>New work credential</h3>
      <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <legend>Who uses it</legend>
        <label className="choice">
          <input type="radio" name="kind" value="creator_agent" checked={kind === 'creator_agent'} onChange={() => setKind('creator_agent')} />
          <span><strong>Creator agent</strong><span className="field-help" style={{ display: 'block' }}>Reads evidence, prepares studies, intervenes and sees results.</span></span>
        </label>
        <label className="choice">
          <input type="radio" name="kind" value="participant_agent" checked={kind === 'participant_agent'} onChange={() => setKind('participant_agent')} />
          <span><strong>Participating agent</strong><span className="field-help" style={{ display: 'block' }}>Works a bounty: predicts a preference or analyzes evidence. Does not see video or results.</span></span>
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="cred-label">Name</label>
        <input id="cred-label" name="label" className="input" required minLength={2} maxLength={80} placeholder={kind === 'creator_agent' ? 'The team\'s Claude Code' : 'Company X analyst agent'} />
      </div>
      {kind === 'participant_agent' && (
        <div className="field">
          <label htmlFor="cred-bounty">Bounty</label>
          <select id="cred-bounty" name="bounty_id" className="select" required defaultValue="">
            <option value="" disabled>Choose a bounty</option>
            {agentBounties.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </div>
      )}
      {kind === 'creator_agent' && (
        <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <legend>Scope</legend>
          <label className="choice"><input type="radio" name="scope" value="study" defaultChecked /><span>This study only</span></label>
          <label className="choice"><input type="radio" name="scope" value="product" /><span>The whole product (needed to create new studies)</span></label>
        </fieldset>
      )}
      <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <legend>Capabilities</legend>
        {caps.map((c) => (
          <label key={c} className="choice">
            <input type="checkbox" name="capabilities" value={c} defaultChecked={c !== 'study:publish' && c !== 'export:request'} />
            <span><span className="mono">{c}</span><span className="field-help" style={{ display: 'block' }}>{CAPABILITIES[c]}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="cred-days">Expires in (days)</label>
        <input id="cred-days" name="days" type="number" min={1} max={30} defaultValue={7} className="input" />
      </div>
      {state.message && !state.ok && <p className="field-error" role="alert">{state.message}</p>}
      {token && (
        <div className="stack callout callout-warning" role="status" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <strong>{state.message}</strong>
          <code className="token-reveal">{token}</code>
          <div className="cluster">
            <button type="button" className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(token); setCopied(true); }}>{copied ? 'Copied' : 'Copy token'}</button>
            <span className="small">Use it as <span className="mono">Authorization: Bearer …</span> on the REST API or the MCP server.</span>
          </div>
        </div>
      )}
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create credential'}</button></div>
    </form>
  );
}
