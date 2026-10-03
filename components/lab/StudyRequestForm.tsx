'use client';

import { useActionState, useState } from 'react';
import { createStudy, type ActionState } from '@/app/lab/actions';
import { BOUNTY_TEMPLATES, OBJECTIVE_LABEL, OBJECTIVE_MEASURE } from '@/lib/catalog';

const initial: ActionState = { ok: false };

function Field({ id, label, help, error, children }: { id: string; label: string; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <span id={`${id}-help`} className="field-help">{help}</span>}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** StudyRequest: question, version, audience, protocol and budget. Saving a draft never publishes paid work. */
export function StudyRequestForm() {
  const [state, action, pending] = useActionState(createStudy, initial);
  const [v, setV] = useState({
    title: 'Gravity Room: clarity of the opening',
    question: 'Do people playing for the first time understand what they can activate and how to move forward, without the puzzle losing its challenge?',
    objective: 'clarity',
    objective_detail: 'Improve clarity while keeping the challenge.',
    audience: 'People who have not played before, on a computer with a keyboard.',
    task: BOUNTY_TEMPLATES.human_playtest.instructions,
    participants_target: '3',
    session_minutes: '3',
    budget_cap: '30',
    tester_payment: '5',
    agent_reward: '3',
    client_contribution: '10',
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const err = (k: string) => state.errors?.[k];
  const aria = (k: string, help = false) => ({
    'aria-invalid': err(k) ? true : undefined,
    'aria-describedby': [help ? `${k}-help` : '', err(k) ? `${k}-error` : ''].filter(Boolean).join(' ') || undefined,
  });

  const n = Number(v.participants_target) || 0;
  // A tester can deliver a playtest and, if it opens, a comparison: both are paid.
  const testers = (Number(v.tester_payment) || 0) * n * 2;
  const planned = testers + (Number(v.agent_reward) || 0) * 2 + 2 + 3;
  const subsidy = Math.max(0, planned - (Number(v.client_contribution) || 0));

  return (
    <form action={action} className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }} noValidate>
      {state.message && !state.ok && (
        <p className="callout callout-error" role="alert">
          {state.message}
        </p>
      )}
      <section className="panel stack" aria-labelledby="q-title">
        <h2 id="q-title" style={{ fontSize: 20 }}>Question and objective</h2>
        <Field id="title" label="Title" error={err('title')}>
          <input id="title" name="title" className="input" value={v.title} onChange={set('title')} {...aria('title')} />
        </Field>
        <Field id="question" label="Study question" help="What you want to know. Do not assume the problem exists." error={err('question')}>
          <textarea id="question" name="question" className="textarea" value={v.question} onChange={set('question')} {...aria('question', true)} />
        </Field>
        <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <legend>Objective (fixed when you publish)</legend>
          {Object.entries(OBJECTIVE_LABEL).map(([key, label]) => (
            <label key={key} className="choice">
              <input type="radio" name="objective" value={key} checked={v.objective === key} onChange={set('objective')} />
              <span>
                <strong>{label}</strong>
                <span className="field-help" style={{ display: 'block' }}>Measured by: {OBJECTIVE_MEASURE[key]}</span>
              </span>
            </label>
          ))}
          {err('objective') && <span className="field-error">{err('objective')}</span>}
        </fieldset>
        <Field id="objective_detail" label="Objective detail" help="For example, what must not be lost when changing things." error={err('objective_detail')}>
          <input id="objective_detail" name="objective_detail" className="input" value={v.objective_detail} onChange={set('objective_detail')} {...aria('objective_detail', true)} />
        </Field>
      </section>

      <section className="panel stack" aria-labelledby="p-title">
        <h2 id="p-title" style={{ fontSize: 20 }}>Audience and protocol</h2>
        <p className="field-help">Baseline version: Gravity Room A (repository). People play in a browser tab; the A/B comparison uses neutral names and alternating order.</p>
        <Field id="audience" label="Audience" error={err('audience')}>
          <input id="audience" name="audience" className="input" value={v.audience} onChange={set('audience')} {...aria('audience')} />
        </Field>
        <Field id="task" label="Task for each person" help="Shown in the invite." error={err('task')}>
          <textarea id="task" name="task" className="textarea" value={v.task} onChange={set('task')} {...aria('task', true)} />
        </Field>
        <div className="grid-2">
          <Field id="participants_target" label="People" error={err('participants_target')}>
            <input id="participants_target" name="participants_target" className="input" type="number" min={1} max={50} inputMode="numeric" value={v.participants_target} onChange={set('participants_target')} {...aria('participants_target')} />
          </Field>
          <Field id="session_minutes" label="Duration per session (minutes)" error={err('session_minutes')}>
            <input id="session_minutes" name="session_minutes" className="input" type="number" min={1} max={30} inputMode="numeric" value={v.session_minutes} onChange={set('session_minutes')} {...aria('session_minutes')} />
          </Field>
        </div>
      </section>

      <section className="panel stack" aria-labelledby="b-title">
        <div className="split">
          <h2 id="b-title" style={{ fontSize: 20 }}>Budget</h2>
          <span className="test-mode">Payments in test mode</span>
        </div>
        <div className="grid-2">
          <Field id="budget_cap" label="Spending cap (USD)" help="New assignments stop when it runs out." error={err('budget_cap')}>
            <input id="budget_cap" name="budget_cap" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.budget_cap} onChange={set('budget_cap')} {...aria('budget_cap', true)} />
          </Field>
          <Field id="tester_payment" label="Payment per valid submission (USD)" error={err('tester_payment')}>
            <input id="tester_payment" name="tester_payment" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.tester_payment} onChange={set('tester_payment')} {...aria('tester_payment')} />
          </Field>
          <Field id="agent_reward" label="Reward per agent bounty (USD)" help="For the agent operator, not for the agent." error={err('agent_reward')}>
            <input id="agent_reward" name="agent_reward" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.agent_reward} onChange={set('agent_reward')} {...aria('agent_reward', true)} />
          </Field>
          <Field id="client_contribution" label="Client contribution (USD)" error={err('client_contribution')}>
            <input id="client_contribution" name="client_contribution" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.client_contribution} onChange={set('client_contribution')} {...aria('client_contribution')} />
          </Field>
        </div>
        <dl className="kv small" aria-live="polite">
          <dt>Expected human payout</dt>
          <dd>{testers.toFixed(2)} USD (up to 2 submissions per person)</dd>
          <dt>Estimated analysis and operation</dt>
          <dd>5.00 USD</dd>
          <dt>Required subsidy</dt>
          <dd>{subsidy.toFixed(2)} USD = human payout + rewards + analysis + operation − contribution</dd>
        </dl>
      </section>

      <div className="cluster">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save draft'}
        </button>
        <span className="field-help">Saving does not publish or commit spending. You publish from the study page.</span>
      </div>
    </form>
  );
}
