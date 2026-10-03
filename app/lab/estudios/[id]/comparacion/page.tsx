import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { comparisonSummary, evaluatePrediction, type PredictionPayload } from '@/lib/results';
import { dateTime } from '@/lib/format';
import { ActionButton } from '@/components/lab/ActionButton';
import { setStudyPhase } from '@/app/lab/actions';

export const metadata: Metadata = { title: 'Comparación' };

function Row({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="stack" style={{ ['--gap' as string]: '4px' }}>
      <div className="split" style={{ gap: 8 }}>
        <span>{label}</span>
        <strong className="mono">{n} de {total}</strong>
      </div>
      <div className="bar" role="img" aria-label={`${label}: ${n} de ${total}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function ComparisonPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, summary, subs, variantReady] = await Promise.all([
    supabase.from('studies').select('id, status, objective, question').eq('id', id).single(),
    comparisonSummary(supabase, id),
    supabase.from('agent_submissions').select('*').eq('study_id', id).eq('kind', 'prediction').order('created_at'),
    supabase.from('study_versions').select('version_id, versions(status)').eq('study_id', id).eq('role', 'variant'),
  ]);
  if (!study.data) return null;
  const s = study.data;
  const hasVariant = (variantReady.data ?? []).some((v) => (v.versions as unknown as { status: string } | null)?.status === 'ready');
  const bName = summary.baseline ? `versión ${summary.baseline.label}` : 'versión base';
  const vName = summary.variant ? `versión ${summary.variant.label}` : 'variante';

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="panel stack" aria-labelledby="res">
        <div className="split">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h2 id="res" className="section-title">Preferencias humanas</h2>
            <p className="muted measure">Pregunta fijada: {s.question}</p>
          </div>
          {!hasVariant && <span className="tag tag-outline">Todavía no hay variante lista</span>}
          {hasVariant && s.status !== 'comparing' && s.status !== 'completed' && (
            <ActionButton action={setStudyPhase.bind(null, id, 'comparing')} label="Abrir comparación" variant="primary" />
          )}
          {s.status === 'comparing' && <ActionButton action={setStudyPhase.bind(null, id, 'completed')} label="Completar estudio" confirmText="¿Completar el estudio? No se aceptarán más entregas." />}
        </div>

        {summary.total === 0 ? (
          <div className="empty">
            <strong>Comparación pendiente</strong>
            <span className="muted">
              {s.status === 'comparing'
                ? 'La comparación está abierta. Esperando las primeras respuestas; cada persona ve las dos versiones con nombres neutrales y orden alternado.'
                : hasVariant
                  ? 'Abrí la comparación para que las personas que ya probaron la versión base vean las dos versiones.'
                  : 'Primero hace falta una variante que haya pasado las comprobaciones. Mirá la pestaña Versiones.'}
            </span>
          </div>
        ) : (
          <>
            <p className="measure">
              Con una muestra de <strong>{summary.total}</strong> {summary.total === 1 ? 'persona' : 'personas'}, {summary.preferVariant} de {summary.total} {summary.preferVariant === 1 ? 'prefirió' : 'prefirieron'} la {vName}, {summary.preferBaseline} la {bName} y {summary.noPreference} no {summary.noPreference === 1 ? 'tuvo' : 'tuvieron'} preferencia.
            </p>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <Row label={`Prefirieron la ${vName}`} n={summary.preferVariant} total={summary.total} />
              <Row label={`Prefirieron la ${bName}`} n={summary.preferBaseline} total={summary.total} />
              <Row label="Sin preferencia" n={summary.noPreference} total={summary.total} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Preferencias según el orden de presentación</caption>
                <thead>
                  <tr><th scope="col">Orden presentado</th><th scope="col" className="num">Personas</th><th scope="col" className="num">{vName}</th><th scope="col" className="num">{bName}</th><th scope="col" className="num">Sin preferencia</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">{bName} primero</th><td className="num">{summary.byOrder.baselineFirst.total}</td><td className="num">{summary.byOrder.baselineFirst.preferVariant}</td><td className="num">{summary.byOrder.baselineFirst.preferBaseline}</td><td className="num">{summary.byOrder.baselineFirst.none}</td></tr>
                  <tr><th scope="row">{vName} primero</th><td className="num">{summary.byOrder.variantFirst.total}</td><td className="num">{summary.byOrder.variantFirst.preferVariant}</td><td className="num">{summary.byOrder.variantFirst.preferBaseline}</td><td className="num">{summary.byOrder.variantFirst.none}</td></tr>
                </tbody>
              </table>
            </div>
            {summary.limitations.length > 0 && (
              <div className="callout callout-warning">
                <strong>Límites de esta prueba</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {summary.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {summary.reasons.length > 0 && (
        <section className="stack" aria-labelledby="reasons">
          <h2 id="reasons" className="section-title">Motivos declarados</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Persona</th><th scope="col">Eligió</th><th scope="col">Orden</th><th scope="col">Motivo</th></tr></thead>
              <tbody>
                {summary.reasons.map((r) => (
                  <tr key={r.participant + r.created_at}>
                    <td><strong>{r.participant}</strong>{r.prior_exposure && <div className="small muted">Ya había jugado la base</div>}</td>
                    <td>{r.preferred === 'baseline' ? bName : r.preferred === 'variant' ? vName : 'Sin preferencia'}</td>
                    <td className="small">{r.presented}</td>
                    <td><q>{r.reason}</q></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="preds">
        <h2 id="preds" className="section-title">Predicciones de agentes</h2>
        <p className="field-help measure">Cada predicción queda fechada antes de revelar resultados. Una hecha después de ver resultados humanos cuenta como análisis retrospectivo, no como predicción. Una coincidencia aislada no demuestra juicio general.</p>
        {(subs.data ?? []).length === 0 ? (
          <p className="empty">Ningún agente entregó una predicción todavía. Se encarga desde la pestaña Agentes.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Agente</th><th scope="col">Registrada</th><th scope="col">Predijo</th><th scope="col">Motivos e incertidumbre</th><th scope="col">Evaluación</th></tr></thead>
              <tbody>
                {(subs.data ?? []).map((p) => {
                  const payload = p.payload as PredictionPayload;
                  const ev = evaluatePrediction(payload, p.is_retrospective, summary);
                  const chosen = payload.choice === 'baseline' ? bName : payload.choice === 'variant' ? vName : 'Sin preferencia';
                  return (
                    <tr key={p.id}>
                      <td>{p.actor}</td>
                      <td className="small">{dateTime(p.created_at)}{p.is_retrospective ? <div><span className="tag tag-warning">Retrospectivo</span></div> : <div><span className="tag tag-success">Antes de ver resultados</span></div>}</td>
                      <td>{chosen}</td>
                      <td className="small"><div>{payload.reasons}</div><div className="muted">Incertidumbre: {payload.uncertainty}</div></td>
                      <td className="small">
                        <span className={`tag ${ev.status === 'evaluated' ? 'tag-outline' : ev.status === 'pending' ? 'tag-outline' : 'tag-warning'}`}>{ev.status === 'evaluated' ? (ev.matchedMajority === null ? 'Sin mayoría' : ev.matchedMajority ? 'Coincide con la mayoría' : 'No coincide con la mayoría') : ev.status === 'pending' ? 'Pendiente' : 'No cuenta como predicción'}</span>
                        <div className="muted">{ev.note}</div>
                        {ev.brier !== null && <div className="mono">Brier {ev.brier}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small"><Link href={`/lab/estudios/${id}/agentes`}>Gestionar agentes y credenciales</Link></p>
      </section>
    </div>
  );
}
