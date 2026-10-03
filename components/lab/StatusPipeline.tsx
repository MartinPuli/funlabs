import { STATUS_LABEL, STUDY_FLOW, type StudyStatus } from '@/lib/catalog';

/** Study states from FUNLABS.md: draft → published → collecting → analyzing → evidence_ready → comparing → completed. */
export function StatusPipeline({ status }: { status: StudyStatus }) {
  const current = STUDY_FLOW.indexOf(status as (typeof STUDY_FLOW)[number]);
  const stateOf = (i: number) => (status === 'archived' ? 'todo' : i < current ? 'done' : i === current ? 'current' : 'todo');
  return (
    <div className="pipeline" role="group" aria-label="Study status">
      <div className="pipeline-bar" aria-hidden="true">
        {STUDY_FLOW.map((s, i) => (
          <span key={s} data-state={stateOf(i)} />
        ))}
      </div>
      <p className="pipeline-label">
        <strong>{STATUS_LABEL[status]}</strong>
        {current >= 0 && ` · step ${current + 1} of ${STUDY_FLOW.length}`}
      </p>
      <ol className="visually-hidden">
        {STUDY_FLOW.map((s, i) => {
          const state = stateOf(i);
          return (
            <li key={s} aria-current={state === 'current' ? 'step' : undefined}>
              {STATUS_LABEL[s]}
              {state === 'done' ? ' (done)' : state === 'current' ? ' (current)' : ''}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
