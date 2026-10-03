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
    title: 'Gravity Room: claridad del comienzo',
    question: '¿Las personas que juegan por primera vez entienden qué pueden activar y cómo avanzar, sin que el puzzle pierda desafío?',
    objective: 'clarity',
    objective_detail: 'Mejorar la claridad conservando el desafío.',
    audience: 'Personas que no jugaron antes, en computadora con teclado.',
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
        <h2 id="q-title" style={{ fontSize: 20 }}>Pregunta y objetivo</h2>
        <Field id="title" label="Título" error={err('title')}>
          <input id="title" name="title" className="input" value={v.title} onChange={set('title')} {...aria('title')} />
        </Field>
        <Field id="question" label="Pregunta del estudio" help="Lo que querés saber. No presupongas que el problema existe." error={err('question')}>
          <textarea id="question" name="question" className="textarea" value={v.question} onChange={set('question')} {...aria('question', true)} />
        </Field>
        <fieldset className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <legend>Objetivo (se fija al publicar)</legend>
          {Object.entries(OBJECTIVE_LABEL).map(([key, label]) => (
            <label key={key} className="choice">
              <input type="radio" name="objective" value={key} checked={v.objective === key} onChange={set('objective')} />
              <span>
                <strong>{label}</strong>
                <span className="field-help" style={{ display: 'block' }}>Se mide con: {OBJECTIVE_MEASURE[key]}</span>
              </span>
            </label>
          ))}
          {err('objective') && <span className="field-error">{err('objective')}</span>}
        </fieldset>
        <Field id="objective_detail" label="Detalle del objetivo" help="Por ejemplo, qué no hay que perder al cambiar." error={err('objective_detail')}>
          <input id="objective_detail" name="objective_detail" className="input" value={v.objective_detail} onChange={set('objective_detail')} {...aria('objective_detail', true)} />
        </Field>
      </section>

      <section className="panel stack" aria-labelledby="p-title">
        <h2 id="p-title" style={{ fontSize: 20 }}>Público y protocolo</h2>
        <p className="field-help">Versión base: Gravity Room A (repositorio). Las personas juegan en la pestaña del navegador; la comparación A/B usa nombres neutrales y orden alternado.</p>
        <Field id="audience" label="Público" error={err('audience')}>
          <input id="audience" name="audience" className="input" value={v.audience} onChange={set('audience')} {...aria('audience')} />
        </Field>
        <Field id="task" label="Tarea para cada persona" help="Se muestra en la invitación." error={err('task')}>
          <textarea id="task" name="task" className="textarea" value={v.task} onChange={set('task')} {...aria('task', true)} />
        </Field>
        <div className="grid-2">
          <Field id="participants_target" label="Personas" error={err('participants_target')}>
            <input id="participants_target" name="participants_target" className="input" type="number" min={1} max={50} inputMode="numeric" value={v.participants_target} onChange={set('participants_target')} {...aria('participants_target')} />
          </Field>
          <Field id="session_minutes" label="Duración por sesión (minutos)" error={err('session_minutes')}>
            <input id="session_minutes" name="session_minutes" className="input" type="number" min={1} max={30} inputMode="numeric" value={v.session_minutes} onChange={set('session_minutes')} {...aria('session_minutes')} />
          </Field>
        </div>
      </section>

      <section className="panel stack" aria-labelledby="b-title">
        <div className="split">
          <h2 id="b-title" style={{ fontSize: 20 }}>Presupuesto</h2>
          <span className="test-mode">Pagos en modo prueba</span>
        </div>
        <div className="grid-2">
          <Field id="budget_cap" label="Límite de gasto (USD)" help="Se detienen nuevas asignaciones al agotarse." error={err('budget_cap')}>
            <input id="budget_cap" name="budget_cap" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.budget_cap} onChange={set('budget_cap')} {...aria('budget_cap', true)} />
          </Field>
          <Field id="tester_payment" label="Pago por entrega válida (USD)" error={err('tester_payment')}>
            <input id="tester_payment" name="tester_payment" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.tester_payment} onChange={set('tester_payment')} {...aria('tester_payment')} />
          </Field>
          <Field id="agent_reward" label="Recompensa por bounty de agente (USD)" help="Para el operador del agente, no para el agente." error={err('agent_reward')}>
            <input id="agent_reward" name="agent_reward" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.agent_reward} onChange={set('agent_reward')} {...aria('agent_reward', true)} />
          </Field>
          <Field id="client_contribution" label="Aporte del cliente (USD)" error={err('client_contribution')}>
            <input id="client_contribution" name="client_contribution" className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v.client_contribution} onChange={set('client_contribution')} {...aria('client_contribution')} />
          </Field>
        </div>
        <dl className="kv small" aria-live="polite">
          <dt>Pago humano previsto</dt>
          <dd>{testers.toFixed(2)} USD (hasta 2 entregas por persona)</dd>
          <dt>Análisis y operación estimados</dt>
          <dd>5.00 USD</dd>
          <dt>Subsidio requerido</dt>
          <dd>{subsidy.toFixed(2)} USD = pago humano + recompensas + análisis + operación − aporte</dd>
        </dl>
      </section>

      <div className="cluster">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar borrador'}
        </button>
        <span className="field-help">Guardar no publica ni compromete gasto. Publicás desde el estudio.</span>
      </div>
    </form>
  );
}
