import type { Metadata } from 'next';
import { createUserClient } from '@/lib/supabase/server';
import { dateTime, money } from '@/lib/format';
import type { BudgetSummary } from '@/lib/budget';
import { CreatorConsent, DownloadButton, ExportForm } from '@/components/lab/ExportPanel';
import { providerStatus } from '@/lib/env';

export const metadata: Metadata = { title: 'Datos y presupuesto' };

const KIND_LABEL: Record<string, string> = {
  contribution: 'Aporte del cliente',
  reservation: 'Reserva por asignación',
  release: 'Reserva liberada o aplicada',
  payout: 'Pago por entrega válida',
  agent_reward: 'Recompensa al operador de un agente',
  analysis_cost: 'Costo de análisis',
  operation_cost: 'Costo de operación',
};

export default async function DataPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, budget, entries, events, exports, consents, assignments, reviewTime, user] = await Promise.all([
    supabase.from('studies').select('*').eq('id', id).single(),
    supabase.rpc('study_budget', { p_study: id }),
    supabase.from('budget_entries').select('*').eq('study_id', id).order('created_at', { ascending: false }).limit(60),
    supabase.from('payment_events').select('*').eq('study_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('dataset_exports').select('*').eq('study_id', id).order('created_at', { ascending: false }),
    supabase.from('consent_records').select('assignment_id, purpose, granted, created_at').eq('study_id', id).eq('subject', 'participant').order('created_at'),
    supabase.from('assignments').select('id, participant_code, status').eq('study_id', id).order('accepted_at'),
    supabase.from('review_time').select('seconds').eq('study_id', id),
    supabase.auth.getUser(),
  ]);
  if (!study.data) return null;
  const s = study.data;
  const b = budget.data as BudgetSummary | null;
  const isOwner = user.data.user?.id === s.owner_id;
  const latest = new Map<string, { research: boolean; training: boolean }>();
  for (const c of consents.data ?? []) {
    if (!c.assignment_id) continue;
    const cur = latest.get(c.assignment_id) ?? { research: false, training: false };
    if (c.purpose === 'research_sharing') cur.research = c.granted;
    if (c.purpose === 'model_training') cur.training = c.granted;
    latest.set(c.assignment_id, cur);
  }
  const reviewSeconds = (reviewTime.data ?? []).reduce((a, r) => a + r.seconds, 0);
  const providers = providerStatus();

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="stack" aria-labelledby="bud">
        <div className="split">
          <h2 id="bud" className="section-title">Presupuesto y subsidio</h2>
          <span className="test-mode">Pagos en modo prueba</span>
        </div>
        {b && (
          <div className="grid-2">
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Resumen del presupuesto</caption>
                <tbody>
                  <tr><th scope="row">Límite de gasto</th><td className="num">{money(b.cap)}</td></tr>
                  <tr><th scope="row">Reservado (entregas en curso)</th><td className="num">{money(b.reserved)}</td></tr>
                  <tr><th scope="row">Pagado a personas</th><td className="num">{money(b.paid)}</td></tr>
                  <tr><th scope="row">Recompensas a operadores de agentes</th><td className="num">{money(b.agent_rewards)}</td></tr>
                  <tr><th scope="row">Análisis y operación registrados</th><td className="num">{money(b.analysis + b.operation)}</td></tr>
                  <tr><th scope="row">Comprometido</th><td className="num"><strong>{money(b.committed)}</strong></td></tr>
                  <tr><th scope="row">Disponible</th><td className="num"><strong>{money(b.remaining)}</strong></td></tr>
                </tbody>
              </table>
            </div>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <p className="small"><strong>Subsidio previsto</strong> = pago humano + recompensa al operador del agente + análisis y procesamiento + operación − aporte del cliente.</p>
              <dl className="kv small">
                <dt>Pago humano previsto</dt><dd>{money(b.planned.testers)}</dd>
                <dt>Recompensas de agentes</dt><dd>{money(b.planned.agent_rewards)}</dd>
                <dt>Análisis estimado</dt><dd>{money(b.planned.analysis)}</dd>
                <dt>Operación estimada</dt><dd>{money(b.planned.operation)}</dd>
                <dt>Aporte del cliente</dt><dd>− {money(b.planned.contribution)}</dd>
                <dt><strong>Subsidio previsto</strong></dt><dd><strong>{money(b.planned.subsidy)}</strong></dd>
              </dl>
              <p className="field-help">El subsidio es una decisión previa con tope, no una recompensa por resultados favorables. Una reserva interna no es un escrow ni prueba una transferencia. Stripe: {providers.stripe.configured ? 'en modo prueba configurado' : 'no configurado en este entorno, el registro es interno'}.</p>
              <p className="field-help">Tiempo de revisión registrado en la mesa de evidencia: <strong>{Math.round(reviewSeconds / 60)} min</strong> (tiempo activo del equipo).</p>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Cuándo</th><th scope="col">Concepto</th><th scope="col" className="num">Monto</th><th scope="col">Nota</th></tr></thead>
            <tbody>
              {(entries.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">Sin movimientos.</td></tr>}
              {(entries.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="small nowrap">{dateTime(e.created_at)}</td>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td className="num">{e.kind === 'release' ? '−' : ''}{money(e.amount_cents)}</td>
                  <td className="small muted">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(events.data ?? []).length > 0 && (
          <details>
            <summary className="small"><strong>Eventos de pago ({(events.data ?? []).length})</strong></summary>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {(events.data ?? []).map((e) => <li key={e.id}><span className="mono">{e.event_type}</span> ({e.provider}, {e.signature_verified ? 'firma verificada' : 'sin firma'}) {dateTime(e.created_at)}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="stack" aria-labelledby="perm">
        <h2 id="perm" className="section-title">Permisos para investigación</h2>
        <p className="muted measure">Participar y aceptar la grabación no autoriza compartir datos. Para entrar a un export hacen falta la autorización del titular y la de cada participante, y los hallazgos deben estar revisados.</p>
        <CreatorConsent studyId={id} granted={s.creator_research_consent} disabled={!isOwner} />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Persona</th><th scope="col">Estado</th><th scope="col">Investigación</th><th scope="col">Entrenar o evaluar modelos</th></tr></thead>
            <tbody>
              {(assignments.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">Todavía no hay participantes.</td></tr>}
              {(assignments.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.participant_code}</strong></td>
                  <td>{a.status === 'withdrawn' ? 'Se retiró' : 'Participa'}</td>
                  <td>{latest.get(a.id)?.research ? 'Autorizado' : 'No autorizado'}</td>
                  <td>{latest.get(a.id)?.training ? 'Autorizado' : 'No autorizado'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" aria-labelledby="exp">
        <h2 id="exp" className="section-title">Export de investigación</h2>
        <p className="muted measure">Descarga privada de ejemplos autorizados, no un marketplace de datos. Un export no incluye video ni audio crudos. Un ID aleatorio no anonimiza voces ni grabaciones.</p>
        <ExportForm studyId={id} />
        {(exports.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Pedido</th><th scope="col">Estado</th><th scope="col">Contenido</th><th scope="col"><span className="visually-hidden">Descarga</span></th></tr></thead>
              <tbody>
                {(exports.data ?? []).map((e) => {
                  const ex = (e.excluded ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={e.id}>
                      <td className="small"><div>{e.purpose}</div><div className="muted">{dateTime(e.created_at)} · {e.requested_via === 'agent_api' ? 'por un agente' : 'desde la interfaz'} · {e.format}</div></td>
                      <td><span className={`tag ${e.status === 'ready' ? 'tag-success' : e.status === 'blocked' || e.status === 'failed' ? 'tag-error' : 'tag-warning'}`}>{e.status === 'ready' ? 'Listo' : e.status === 'blocked' ? 'Bloqueado' : e.status === 'failed' ? 'Falló' : e.status === 'expired' ? 'Venció' : 'Preparando'}</span></td>
                      <td className="small">
                        {e.status === 'blocked' && <span className="field-error">{e.blocked_reason}</span>}
                        {e.status === 'ready' && (
                          <>
                            <div>{e.item_count} participante(s); campos: {(e.fields as string[]).join(', ')}</div>
                            <div className="muted">Excluidos: {String(ex.participants_without_research_consent ?? 0)} sin permiso, {String(ex.participants_withdrawn ?? 0)} retirados, {String(ex.evidence_unreviewed ?? 0)} hallazgos sin revisar, {String(ex.evidence_rejected ?? 0)} rechazados. Video: {String(ex.raw_media ?? 'no incluido')}.</div>
                            <div className="muted">Vence {dateTime(e.expires_at)}</div>
                          </>
                        )}
                      </td>
                      <td>{e.status === 'ready' && <DownloadButton studyId={id} exportId={e.id} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
