'use client';

import { useState, useTransition } from 'react';
import { setSpendingPolicy } from '@/app/lab/actions';

/** The budget holder decides whether agents can publish paid work, and up to what limit. */
export function SpendingPolicyForm({ studyId, enabled, maxUsd, disabled }: { studyId: string; enabled: boolean; maxUsd: number; disabled?: boolean }) {
  const [on, setOn] = useState(enabled);
  const [max, setMax] = useState(String(maxUsd));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await setSpendingPolicy(studyId, on, Number(max) || 0);
          setMsg({ ok: res.ok, text: res.message ?? (res.ok ? 'Saved' : 'Could not save') });
        });
      }}
    >
      <h3>Spending policy for agents</h3>
      <p className="small muted measure">An agent can prepare a request, but publishing paid work requires this policy or your one-off approval. All payments are in test mode today.</p>
      <label className="choice">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => setOn(e.target.checked)} />
        <span>Allow agents with the <span className="mono">study:publish</span> capability to publish studies</span>
      </label>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="pol-max">Maximum cap per study (USD)</label>
        <input id="pol-max" className="input" type="number" min={0} step="0.01" value={max} disabled={disabled || !on} onChange={(e) => setMax(e.target.value)} />
      </div>
      <div className="cluster">
        <button className="btn" type="submit" disabled={pending || disabled}>{pending ? 'Saving…' : 'Save policy'}</button>
        {msg && <span className={msg.ok ? 'small' : 'field-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
      </div>
    </form>
  );
}
