'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewDelivery } from '@/app/lab/actions';

/** Marks a delivery valid (paid in test mode) or not usable (with a reason). */
export function DeliveryReview({ studyId, deliveryId }: { studyId: string; deliveryId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (valid: boolean) =>
    start(async () => {
      const res = await reviewDelivery(studyId, deliveryId, valid, note);
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? 'Done' : 'Error') });
      if (res.ok) router.refresh();
    });
  return (
    <div className="stack" style={{ ['--gap' as string]: '6px' }}>
      <div className="cluster" style={{ ['--gap' as string]: '6px' }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(true)}>
          Valid
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Not usable
        </button>
      </div>
      {open && (
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <label className="small" htmlFor={`dn-${deliveryId}`}>Reason (the person can ask for a review)</label>
          <textarea id={`dn-${deliveryId}`} className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div>
            <button type="button" className="btn btn-sm btn-danger" disabled={pending || !note.trim()} onClick={() => run(false)}>
              Confirm
            </button>
          </div>
        </div>
      )}
      {msg && <span className={msg.ok ? 'small' : 'field-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
    </div>
  );
}
