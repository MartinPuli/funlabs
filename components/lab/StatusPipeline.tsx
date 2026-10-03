import { STATUS_LABEL, STUDY_FLOW, type StudyStatus } from '@/lib/catalog';

/** Study states from FUNLABS.md: draft → published → collecting → analyzing → evidence_ready → comparing → completed. */
export function StatusPipeline({ status }: { status: StudyStatus }) {
  const current = STUDY_FLOW.indexOf(status as (typeof STUDY_FLOW)[number]);
  return (
    <ol className="pipeline" aria-label="Estado del estudio">
      {STUDY_FLOW.map((s, i) => {
        const state = status === 'archived' ? 'todo' : i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            {state === 'done' && <span aria-hidden="true">✓</span>}
            {STATUS_LABEL[s]}
            {state === 'done' && <span className="visually-hidden"> (completado)</span>}
          </li>
        );
      })}
    </ol>
  );
}
