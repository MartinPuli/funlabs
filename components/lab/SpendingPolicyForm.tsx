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
          setMsg({ ok: res.ok, text: res.message ?? (res.ok ? 'Guardado' : 'No se pudo guardar') });
        });
      }}
    >
      <h3>Política de gasto para agentes</h3>
      <p className="small muted measure">Un agente puede preparar un encargo, pero publicar trabajo remunerado requiere esta política o tu aprobación puntual. Hoy todos los pagos son de modo prueba.</p>
      <label className="choice">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => setOn(e.target.checked)} />
        <span>Permitir que agentes con la capacidad <span className="mono">study:publish</span> publiquen estudios</span>
      </label>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="pol-max">Límite máximo por estudio (USD)</label>
        <input id="pol-max" className="input" type="number" min={0} step="0.01" value={max} disabled={disabled || !on} onChange={(e) => setMax(e.target.value)} />
      </div>
      <div className="cluster">
        <button className="btn" type="submit" disabled={pending || disabled}>{pending ? 'Guardando…' : 'Guardar política'}</button>
        {msg && <span className={msg.ok ? 'small' : 'field-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
      </div>
    </form>
  );
}
