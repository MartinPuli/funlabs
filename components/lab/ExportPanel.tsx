'use client';

import { useActionState, useState, useTransition } from 'react';
import { exportDownloadUrl, requestExportAction, setCreatorConsent, type ActionState } from '@/app/lab/actions';
import { EXPORT_FIELDS } from '@/lib/export-fields';

const FIELD_LABEL: Record<string, string> = {
  protocol: 'Protocolo del estudio',
  versions: 'Versiones y hashes',
  predictions: 'Predicciones de agentes (fechadas)',
  sessions: 'Sesiones y participantes',
  events: 'Eventos de la partida',
  comments: 'Comentarios y respuestas',
  evidence: 'Hallazgos revisados con fuentes',
  interventions: 'Intervenciones, diff y comprobaciones',
  comparisons: 'Preferencias A/B con motivos',
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
                setErr(res.message ?? 'No se pudo guardar');
              } else setErr(null);
            });
          }}
        />
        <span>
          <strong>Autorizo como titular del producto el uso de ejemplos de este estudio en un export de investigación</strong>
          <span className="field-help" style={{ display: 'block' }}>Solo entran ejemplos con permiso de cada participante y hallazgos revisados. El video no se incluye.</span>
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
      <h3>Pedir un export privado</h3>
      <div className="field">
        <label htmlFor="exp-purpose">Finalidad</label>
        <input id="exp-purpose" name="purpose" className="input" required minLength={5} maxLength={500} placeholder="Evaluar si un agente anticipa la preferencia de un público" />
      </div>
      <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <legend>Campos</legend>
        {EXPORT_FIELDS.map((f) => (
          <label key={f} className="choice"><input type="checkbox" name="fields" value={f} defaultChecked /><span>{FIELD_LABEL[f]}</span></label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Formato</legend>
        <div className="cluster">
          <label className="choice"><input type="radio" name="format" value="json" defaultChecked /><span>JSON</span></label>
          <label className="choice"><input type="radio" name="format" value="jsonl" /><span>JSON por líneas</span></label>
        </div>
      </fieldset>
      {state.message && <p className={state.ok ? 'callout callout-success' : 'callout callout-warning'} role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Pidiendo…' : 'Pedir export'}</button></div>
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
            else setErr(res.message ?? 'No se pudo descargar');
          })
        }
      >
        {pending ? 'Firmando…' : 'Descargar (enlace temporal)'}
      </button>
      {err && <span className="field-error" role="alert">{err}</span>}
    </span>
  );
}
