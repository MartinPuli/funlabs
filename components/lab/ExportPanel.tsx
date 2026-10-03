'use client';

import { useActionState, useState, useTransition } from 'react';
import { exportDownloadUrl, requestExportAction, setCreatorConsent, type ActionState } from '@/app/lab/actions';
import { EXPORT_FIELDS } from '@/lib/export-fields';

const FIELD_LABEL: Record<string, string> = {
  protocol: 'Study protocol',
  versions: 'Versions and hashes',
  predictions: 'Agent predictions (timestamped)',
  sessions: 'Sessions and participants',
  events: 'Game events',
  comments: 'Comments and answers',
  evidence: 'Reviewed findings with sources',
  interventions: 'Interventions, diff and checks',
  comparisons: 'A/B preferences with reasons',
};

export function CreatorConsent({ studyId, granted, disabled }: { studyId: string; granted: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(granted);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
      <label className="choice">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled || pending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            start(async () => {
              const res = await setCreatorConsent(studyId, next);
              if (!res.ok) {
                setOn(!next);
                setErr(res.message ?? 'Could not save');
              } else setErr(null);
            });
          }}
        />
        <span>
          <strong>As the product owner, I authorize the use of examples from this study in a research export</strong>
          <span className="field-help" style={{ display: 'block' }}>Only examples with each participant's permission and reviewed findings are included. Video is not included.</span>
        </span>
      </label>
      {err && <p className="field-error" role="alert">{err}</p>}
    </div>
  );
}

export function ExportForm({ studyId }: { studyId: string }) {
  const [state, action, pending] = useActionState(requestExportAction, { ok: false } as ActionState);
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="study_id" value={studyId} />
      <h3>Request a private export</h3>
      <div className="field">
        <label htmlFor="exp-purpose">Purpose</label>
        <input id="exp-purpose" name="purpose" className="input" required minLength={5} maxLength={500} placeholder="Evaluate whether an agent anticipates an audience's preference" />
      </div>
      <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <legend>Fields</legend>
        {EXPORT_FIELDS.map((f) => (
          <label key={f} className="choice"><input type="checkbox" name="fields" value={f} defaultChecked /><span>{FIELD_LABEL[f]}</span></label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Format</legend>
        <div className="cluster">
          <label className="choice"><input type="radio" name="format" value="json" defaultChecked /><span>JSON</span></label>
          <label className="choice"><input type="radio" name="format" value="jsonl" /><span>JSON Lines</span></label>
        </div>
      </fieldset>
      {state.message && <p className={state.ok ? 'callout callout-success' : 'callout callout-warning'} role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Requesting…' : 'Request export'}</button></div>
    </form>
  );
}

export function DownloadButton({ studyId, exportId }: { studyId: string; exportId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="stack" style={{ ['--gap' as string]: '4px', display: 'inline-flex' }}>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await exportDownloadUrl(studyId, exportId);
            if (res.ok && res.data?.url) window.location.href = res.data.url as string;
            else setErr(res.message ?? 'Could not download');
          })
        }
      >
        {pending ? 'Signing…' : 'Download (temporary link)'}
      </button>
      {err && <span className="field-error" role="alert">{err}</span>}
    </span>
  );
}
