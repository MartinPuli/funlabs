import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { BOUNTY_KIND_LABEL, STATUS_LABEL, type StudyStatus } from '@/lib/catalog';
import { dateTime, JOB_KIND_LABEL, JOB_STATUS_LABEL, minutes, mmss, money, shortSha } from '@/lib/format';
import type { BudgetSummary } from '@/lib/budget';
import { ActionButton } from '@/components/lab/ActionButton';
import { InviteManager } from '@/components/lab/InviteManager';
import { DeliveryReview } from '@/components/lab/DeliveryReview';
import { deleteDraftStudy, processQueueAction, publishStudyAction, requestAnalysis, retryJobAction, revokeInvite, setStudyPhase } from '@/app/lab/actions';

export default async function StudyOverview(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, versions, bounties, invites, assignments, deliveries, sessions, jobs, budget, evidence, comparisons, reviewTime] = await Promise.all([
    supabase.from('studies').select('*').eq('id', id).single(),
    supabase.from('study_versions').select('role, version_id, versions(id, label, status, content_sha256, origin, created_at)').eq('study_id', id),
    supabase.from('bounties').select('*').eq('study_id', id).order('created_at'),
    supabase.from('invitations').select('id, label, token_hint, expires_at, revoked_at, created_at, assignments(participant_code, status)').eq('study_id', id).order('created_at'),
    supabase.from('assignments').select('id, participant_code, status, accepted_at').eq('study_id', id).order('accepted_at'),
    supabase.from('deliveries').select('*').eq('study_id', id).order('created_at'),
    supabase.from('sessions').select('id, assignment_id, phase, position, neutral_label, status, recordings(status, duration_ms, method, has_audio)').eq('study_id', id),
    supabase.from('jobs').select('id, kind, status, attempts, max_attempts, runner, last_error, created_at, finished_at, input').eq('study_id', id).order('created_at', { ascending: false }).limit(15),
    supabase.rpc('study_budget', { p_study: id }),
    supabase.from('evidence').select('id, structural_status, review_status').eq('study_id', id),
    supabase.from('comparisons').select('id', { count: 'exact', head: true }).eq('study_id', id),
    supabase.from('review_time').select('seconds').eq('study_id', id),
  ]);
  if (!study.data) return null;
  const s = study.data;
  const status = s.status as StudyStatus;
  const b = budget.data as BudgetSummary | null;
  const ev = evidence.data ?? [];
  const sess = sessions.data ?? [];
  const codeOf = new Map((assignments.data ?? []).map((a) => [a.id, a.participant_code]));
  const materialMs = sess.reduce((acc, x) => acc + ((x.recordings as unknown as { duration_ms: number | null } | null)?.duration_ms ?? 0), 0);
  const playtestDeliveries = (deliveries.data ?? []).filter((d) => d.phase === 'playtest');
  const waiting = Math.max(0, s.participants_target - playtestDeliveries.length);
  const variant = (versions.data ?? []).find((v) => v.role === 'variant');
  const reviewed = ev.filter((e) => e.review_status !== 'unreviewed').length;
  const reviewMin = Math.round((reviewTime.data ?? []).reduce((a, r) => a + r.seconds, 0) / 60);

  let next: { title: string; body: string; action?: React.ReactNode } = { title: '', body: '' };
  if (status === 'draft') {
    next = {
      title: 'Publicar el encargo',
      body: 'Al publicar se fijan la pregunta, el objetivo, el protocolo, el presupuesto y el conjunto de comprobaciones. Después podés invitar personas.',
      action: <ActionButton action={publishStudyAction.bind(null, id)} label="Publicar estudio" variant="primary" pendingLabel="Publicando…" processQueue studyId={id} confirmText="Publicar fija la pregunta, el objetivo y el presupuesto. ¿Continuar?" />,
    };
  } else if (['published', 'collecting'].includes(status) && playtestDeliveries.length === 0) {
    next = { title: (invites.data ?? []).length ? `Esperando ${waiting} ${waiting === 1 ? 'entrega' : 'entregas'}` : 'Invitar personas', body: 'Compartí un enlace por persona. Cada enlace es su credencial: no necesita cuenta.' };
  } else if (status === 'analyzing') {
    next = { title: 'Analizando material', body: 'Gemini propone hallazgos y FUNLABS verifica que cada fuente exista y pertenezca a la sesión. La página se actualiza sola.' };
  } else if (['evidence_ready', 'collecting'].includes(status) && !variant) {
    next = {
      title: reviewed < ev.length ? `Revisar evidencia (${ev.length - reviewed} sin revisar)` : 'Decidir una intervención',
      body: 'Confirmá, corregí o rechazá hallazgos y elegí cuáles motivan un cambio. Claude modifica una copia dentro del alcance permitido.',
      action: <Link className="btn btn-primary" href={`/lab/estudios/${id}/evidencia`}>Abrir evidencia</Link>,
    };
  } else if (variant && status !== 'comparing' && status !== 'completed') {
    next = {
      title: 'Abrir la comparación A/B',
      body: 'La variante pasó sus comprobaciones. Las personas verán las dos versiones con nombres neutrales y orden alternado, en su mismo enlace.',
      action: <ActionButton action={setStudyPhase.bind(null, id, 'comparing')} label="Abrir comparación" variant="primary" />,
    };
  } else if (status === 'comparing') {
    next = {
      title: `Comparaciones recibidas: ${comparisons.count ?? 0}`,
      body: 'Las preferencias se muestran con denominador, motivos y limitaciones. Cerrá el estudio cuando termines.',
      action: <ActionButton action={setStudyPhase.bind(null, id, 'completed')} label="Completar estudio" confirmText="¿Completar el estudio? No se aceptarán más entregas." />,
    };
  } else if (status === 'completed') {
    next = { title: 'Estudio completado', body: 'Los resultados y el export privado quedan disponibles para quienes tienen acceso.', action: <Link className="btn" href={`/lab/estudios/${id}/datos`}>Ver datos</Link> };
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="panel stack" aria-labelledby="next-step">
        <div className="split">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h2 id="next-step" className="section-title">{next.title}</h2>
            <p className="muted measure">{next.body}</p>
          </div>
          {next.action}
        </div>
        <div className="cluster" style={{ ['--gap' as string]: 'var(--s-6)' }}>
          <div className="stat"><span className="stat-value">{(assignments.data ?? []).length}/{s.participants_target}</span><span className="stat-label">personas aceptaron</span></div>
          <div className="stat"><span className="stat-value">{playtestDeliveries.length}</span><span className="stat-label">entregas de prueba</span></div>
          <div className="stat"><span className="stat-value">{minutes(materialMs)}</span><span className="stat-label">de grabación</span></div>
          <div className="stat"><span className="stat-value">{ev.length}</span><span className="stat-label">hallazgos ({reviewed} revisados)</span></div>
          <div className="stat"><span className="stat-value">{reviewMin} min</span><span className="stat-label">de revisión del equipo</span></div>
          <div className="stat"><span className="stat-value">{comparisons.count ?? 0}</span><span className="stat-label">comparaciones A/B</span></div>
        </div>
      </section>

      <section className="stack" aria-labelledby="material">
        <h2 id="material" className="section-title">Material recibido</h2>
        {(assignments.data ?? []).length === 0 ? (
          <p className="empty">Todavía no hay participantes. {status === 'draft' ? 'Publicá el estudio y creá invitaciones.' : 'Compartí las invitaciones.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Persona</th><th scope="col">Sesiones</th><th scope="col">Entregas</th><th scope="col">Evaluación</th></tr>
              </thead>
              <tbody>
                {(assignments.data ?? []).map((a) => {
                  const mine = sess.filter((x) => x.assignment_id === a.id).sort((x, y) => (x.phase + x.position).localeCompare(y.phase + y.position));
                  const dels = (deliveries.data ?? []).filter((d) => d.assignment_id === a.id);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.participant_code}</strong>
                        {a.status === 'withdrawn' && <span className="tag tag-warning" style={{ marginLeft: 6 }}>Se retiró</span>}
                      </td>
                      <td>
                        <ul className="stack small" style={{ listStyle: 'none', margin: 0, padding: 0, ['--gap' as string]: '6px' }}>
                          {mine.length === 0 && <li className="muted">Sin sesiones</li>}
                          {mine.map((x) => {
                            const r = x.recordings as unknown as { status: string; duration_ms: number | null; method: string; has_audio: boolean } | null;
                            return (
                              <li key={x.id} className="cluster" style={{ ['--gap' as string]: '6px' }}>
                                <span>{x.phase === 'playtest' ? 'Prueba' : `Comparación ${x.position}`}: {x.neutral_label}</span>
                                {r ? (
                                  <span className={`tag ${r.status === 'verified' ? 'tag-success' : r.status === 'failed' ? 'tag-error' : 'tag-warning'}`}>
                                    {r.status === 'verified' ? `Grabación ${mmss(r.duration_ms)}${r.has_audio ? ' con voz' : ''}` : r.status === 'failed' ? 'Subida fallida' : 'Subiendo'}
                                  </span>
                                ) : (
                                  <span className="tag tag-outline">{x.status === 'submitted' ? 'Sin grabación (escrito)' : 'En curso'}</span>
                                )}
                                {r?.method === 'manual_upload' && <span className="tag tag-outline">Subida manual</span>}
                                {x.status === 'submitted' && (
                                  <ActionButton action={requestAnalysis.bind(null, id, x.id)} label="Analizar de nuevo" size="sm" variant="ghost" processQueue studyId={id} />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td className="small">
                        {dels.length === 0 && <span className="muted">Sin entregar</span>}
                        {dels.map((d) => {
                          const auto = d.auto_checks as Record<string, unknown>;
                          return (
                            <div key={d.id} className="stack" style={{ ['--gap' as string]: '2px', marginBottom: 8 }}>
                              <strong>{d.phase === 'playtest' ? 'Prueba' : 'Comparación'}</strong>
                              <span className="muted">
                                {d.phase === 'playtest'
                                  ? `${auto.recording}; ${auto.game_events} eventos; ${auto.moments} comentarios; ${auto.answers} respuestas`
                                  : `${auto.game_events} eventos; motivo de ${auto.reason_length} caracteres`}
                              </span>
                            </div>
                          );
                        })}
                      </td>
                      <td>
                        {dels.map((d) => (
                          <div key={d.id} style={{ marginBottom: 8 }}>
                            {d.status === 'submitted' ? (
                              <DeliveryReview studyId={id} deliveryId={d.id} />
                            ) : (
                              <span className={`tag ${d.status === 'valid' ? 'tag-success' : 'tag-error'}`}>{d.status === 'valid' ? 'Válida, pago de prueba registrado' : `No utilizable${d.note ? `: ${d.note}` : ''}`}</span>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="stack" aria-labelledby="invites">
          <h2 id="invites" className="section-title">Invitaciones</h2>
          <InviteManager studyId={id} disabled={status === 'draft' || status === 'completed'} />
          {(invites.data ?? []).length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Enlace</th><th scope="col">Estado</th><th scope="col"><span className="visually-hidden">Acciones</span></th></tr></thead>
                <tbody>
                  {(invites.data ?? []).map((inv) => {
                    const a = (inv.assignments as unknown as Array<{ participant_code: string; status: string }> | null)?.[0];
                    const expired = new Date(inv.expires_at).getTime() < Date.now();
                    return (
                      <tr key={inv.id}>
                        <td>{inv.label} <span className="mono muted">…{inv.token_hint}</span></td>
                        <td>{inv.revoked_at ? 'Revocada' : a ? `Aceptada por ${a.participant_code}` : expired ? 'Vencida' : 'Pendiente'}</td>
                        <td>{!inv.revoked_at && !a && <ActionButton action={revokeInvite.bind(null, id, inv.id)} label="Revocar" size="sm" variant="ghost" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack" aria-labelledby="budget">
          <div className="split">
            <h2 id="budget" className="section-title">Presupuesto</h2>
            <span className="test-mode">Pagos en modo prueba</span>
          </div>
          {b && (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr><th scope="row">Límite de gasto</th><td className="num">{money(b.cap)}</td></tr>
                  <tr><th scope="row">Reservado para entregas en curso</th><td className="num">{money(b.reserved)}</td></tr>
                  <tr><th scope="row">Pagado a personas (prueba)</th><td className="num">{money(b.paid)}</td></tr>
                  <tr><th scope="row">Recompensas a operadores de agentes</th><td className="num">{money(b.agent_rewards)}</td></tr>
                  <tr><th scope="row">Disponible</th><td className="num"><strong>{money(b.remaining)}</strong></td></tr>
                  <tr><th scope="row">Subsidio previsto</th><td className="num">{money(b.planned.subsidy)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="field-help">La reserva interna no es un escrow ni una transferencia. Al agotarse el límite se detienen nuevas asignaciones.</p>
        </section>
      </div>

      <section className="stack" aria-labelledby="bounties">
        <h2 id="bounties" className="section-title">Bounties</h2>
        <p className="field-help">Cada tipo de trabajo tiene su propio criterio. No se comparan personas y agentes con un mismo puntaje.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Trabajo</th><th scope="col">Criterio de evaluación</th><th scope="col" className="num">Remuneración</th><th scope="col">Estado</th></tr></thead>
            <tbody>
              {(bounties.data ?? []).map((bo) => (
                <tr key={bo.id}>
                  <td>
                    <span className="tag tag-outline">{bo.kind.startsWith('human') ? 'Humano' : 'Agente'}</span>
                    <div><strong>{BOUNTY_KIND_LABEL[bo.kind]}</strong></div>
                    <div className="small muted">{bo.instructions}</div>
                  </td>
                  <td className="small">
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {(bo.criteria as Array<{ key: string; text: string }>).map((c) => <li key={c.key}>{c.text}</li>)}
                    </ul>
                  </td>
                  <td className="num">{bo.kind === 'agent_intervention' ? 'Agente creador' : `${money(bo.reward_cents)}${bo.kind === 'human_playtest' ? ' por entrega' : ''}`}</td>
                  <td>{bo.status === 'open' ? 'Abierto' : bo.status === 'draft' ? 'Borrador' : 'Cerrado'}{bo.kind === 'human_playtest' ? ` (${(assignments.data ?? []).length}/${bo.slots})` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" aria-labelledby="versions">
        <h2 id="versions" className="section-title">Versiones</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Versión</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Hash</th><th scope="col">Jugar</th></tr></thead>
            <tbody>
              {(versions.data ?? []).map((v) => {
                const ver = v.versions as unknown as { id: string; label: string; status: string; content_sha256: string; origin: string };
                return (
                  <tr key={v.version_id}>
                    <td><strong>{ver.label}</strong> <span className="small muted">{ver.origin === 'repository' ? 'repositorio' : 'intervención'}</span></td>
                    <td>{v.role === 'baseline' ? 'Base' : 'Variante'}</td>
                    <td>{ver.status === 'ready' ? 'Lista' : ver.status === 'checking' ? 'En comprobación' : 'Rechazada'}</td>
                    <td className="mono small">{shortSha(ver.content_sha256)}</td>
                    <td>{ver.status === 'ready' ? <a href={`/jugar/v/${ver.id}`} target="_blank" rel="noreferrer">Abrir versión {ver.label}</a> : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" aria-labelledby="jobs">
        <h2 id="jobs" className="section-title">Trabajos</h2>
        {(jobs.data ?? []).length === 0 ? (
          <p className="muted">Sin trabajos todavía.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Trabajo</th><th scope="col">Estado</th><th scope="col">Intentos</th><th scope="col">Dónde corrió</th><th scope="col">Detalle</th></tr></thead>
              <tbody>
                {(jobs.data ?? []).map((j) => (
                  <tr key={j.id}>
                    <td>{JOB_KIND_LABEL[j.kind] ?? j.kind}<div className="small muted">{dateTime(j.created_at)}</div></td>
                    <td><span className={`tag ${j.status === 'succeeded' ? 'tag-success' : j.status === 'failed' ? 'tag-error' : j.status === 'running' ? 'tag-warning' : ''}`}>{JOB_STATUS_LABEL[j.status]}</span></td>
                    <td className="num">{j.attempts}/{j.max_attempts}</td>
                    <td className="small mono">{j.runner ?? '-'}</td>
                    <td className="small">
                      {j.last_error && <p className={j.status === 'failed' ? 'field-error' : 'muted'}>{j.last_error}</p>}
                      {j.status === 'failed' && <ActionButton action={retryJobAction.bind(null, id, j.id)} label="Reintentar" size="sm" processQueue studyId={id} />}
                      {j.status === 'queued' && <ActionButton action={processQueueAction.bind(null, id)} label="Procesar ahora" size="sm" variant="ghost" processQueue studyId={id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {status === 'draft' && (
        <section className="stack">
          <h2 className="section-title">Borrador</h2>
          <p className="muted">Estado actual: {STATUS_LABEL[status]}. Un borrador se puede eliminar.</p>
          <form action={deleteDraftStudy.bind(null, id)}>
            <button className="btn btn-danger" type="submit">Eliminar borrador</button>
          </form>
        </section>
      )}
    </div>
  );
}
