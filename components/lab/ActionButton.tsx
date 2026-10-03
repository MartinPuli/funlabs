'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/app/lab/actions';

/**
 * Runs a server action with visible pending, success and error states.
 * With `processQueue`, it then asks the backend to run queued jobs now.
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = 'default',
  confirmText,
  processQueue,
  studyId,
  size,
  disabled,
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  confirmText?: string;
  processQueue?: boolean;
  studyId?: string;
  size?: 'sm';
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ActionState | null>(null);
  const cls = ['btn', variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : '', size === 'sm' ? 'btn-sm' : ''].filter(Boolean).join(' ');

  return (
    <span className="stack" style={{ ['--gap' as string]: '4px', display: 'inline-flex' }}>
      <button
        type="button"
        className={cls}
        disabled={disabled || pending || processing}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          start(async () => {
            const res = await action();
            setResult(res);
            if (res.ok && processQueue) {
              setProcessing(true);
              try {
                await fetch('/api/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_id: studyId }) });
              } finally {
                setProcessing(false);
                router.refresh();
              }
            }
          });
        }}
      >
        {pending ? pendingLabel ?? 'One moment…' : processing ? 'Processing…' : label}
      </button>
      {result?.message && (
        <span className={result.ok ? 'small' : 'field-error'} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </span>
      )}
    </span>
  );
}
