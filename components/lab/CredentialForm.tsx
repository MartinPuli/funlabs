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
      <h3>Nueva credencial de trabajo</h3>
      <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <legend>Quién la usa</legend>
        <label className="choice">
          <input type="radio" name="kind" value="creator_agent" checked={kind === 'creator_agent'} onChange={() => setKind('creator_agent')} />
          <span><strong>Agente creador</strong><span className="field-help" style={{ display: 'block' }}>Consulta evidencia, prepara estudios, interviene y ve resultados.</span></span>
        </label>
        <label className="choice">
          <input type="radio" name="kind" value="participant_agent" checked={kind === 'participant_agent'} onChange={() => setKind('participant_agent')} />
          <span><strong>Agente participante</strong><span className="field-help" style={{ display: 'block' }}>Trabaja un bounty: predice una preferencia o analiza evidencia. No ve video ni resultados.</span></span>
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="cred-label">Nombre</label>
        <input id="cred-label" name="label" className="input" required minLength={2} maxLength={80} placeholder={kind === 'creator_agent' ? 'Claude Code del equipo' : 'Agente analista de la empresa X'} />
      </div>
      {kind === 'participant_agent' && (
        <div className="field">
          <label htmlFor="cred-bounty">Bounty</label>
          <select id="cred-bounty" name="bounty_id" className="select" required defaultValue="">
            <option value="" disabled>Elegí un bounty</option>
            {agentBounties.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </div>
      )}
      {kind === 'creator_agent' && (
        <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <legend>Alcance</legend>
          <label className="choice"><input type="radio" name="scope" value="study" defaultChecked /><span>Solo este estudio</span></label>
          <label className="choice"><input type="radio" name="scope" value="product" /><span>Todo el producto (necesario para crear estudios nuevos)</span></label>
        </fieldset>
      )}
      <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <legend>Capacidades</legend>
        {caps.map((c) => (
          <label key={c} className="choice">
            <input type="checkbox" name="capabilities" value={c} defaultChecked={c !== 'study:publish' && c !== 'export:request'} />
            <span><span className="mono">{c}</span><span className="field-help" style={{ display: 'block' }}>{CAPABILITIES[c]}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="cred-days">Vence en (días)</label>
        <input id="cred-days" name="days" type="number" min={1} max={30} defaultValue={7} className="input" />
      </div>
      {state.message && !state.ok && <p className="field-error" role="alert">{state.message}</p>}
      {token && (
        <div className="stack callout callout-warning" role="status" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <strong>{state.message}</strong>
          <code className="token-reveal">{token}</code>
          <div className="cluster">
            <button type="button" className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(token); setCopied(true); }}>{copied ? 'Copiado' : 'Copiar token'}</button>
            <span className="small">Usalo como <span className="mono">Authorization: Bearer …</span> en la API REST o en el servidor MCP.</span>
          </div>
        </div>
      )}
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Creando…' : 'Crear credencial'}</button></div>
    </form>
  );
}
