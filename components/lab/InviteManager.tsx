'use client';

import { useActionState, useState } from 'react';
import { createInvitesAction, type ActionState } from '@/app/lab/actions';

/** Creates invitation links. Tokens are shown once: only their hash is stored. */
export function InviteManager({ studyId, disabled }: { studyId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(createInvitesAction, { ok: false } as ActionState);
  const [copied, setCopied] = useState<string | null>(null);
  const invites = (state.data?.invites as Array<{ label: string; token: string }> | undefined) ?? [];
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="stack">
      <form action={action} className="cluster">
        <input type="hidden" name="study_id" value={studyId} />
        <label htmlFor="invite-count" className="small">Cantidad</label>
        <input id="invite-count" name="count" type="number" min={1} max={20} defaultValue={3} className="input" style={{ width: 96 }} />
        <button className="btn" type="submit" disabled={pending || disabled}>
          {pending ? 'Creando…' : 'Crear enlaces'}
        </button>
      </form>
      {state.message && <p className={state.ok ? 'callout callout-warning' : 'field-error'} role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
      {invites.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, ['--gap' as string]: 'var(--s-2)' }}>
          {invites.map((inv) => {
            const url = `${origin}/t/${inv.token}`;
            return (
              <li key={inv.token} className="stack" style={{ ['--gap' as string]: '4px' }}>
                <span className="small"><strong>{inv.label}</strong></span>
                <div className="cluster">
                  <code className="token-reveal grow">{url}</code>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(url);
                      setCopied(inv.token);
                    }}
                  >
                    {copied === inv.token ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
