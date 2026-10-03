import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { CAPABILITIES, BOUNTY_KIND_LABEL, type Capability } from '@/lib/catalog';
import { dateTime } from '@/lib/format';
import { ActionButton } from '@/components/lab/ActionButton';
import { CredentialForm } from '@/components/lab/CredentialForm';
import { SpendingPolicyForm } from '@/components/lab/SpendingPolicyForm';
import { revokeCredential } from '@/app/lab/actions';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Agentes' };

const TOOL_LABEL: Record<string, string> = {
  request_evidence: 'Consulta evidencia',
  create_study: 'Crea un estudio',
  publish_study: 'Publica un estudio',
  get_study: 'Lee el estado del estudio',
  get_evidence: 'Lee evidencia',
  get_moment: 'Abre un momento',
  submit_agent_work: 'Entrega trabajo',
  compare_versions: 'Consulta resultados',
  export_dataset: 'Pide un export',
  get_export: 'Consulta un export',
};

export default async function AgentsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const study = await supabase.from('studies').select('id, product_id, status, created_via, owner_id').eq('id', id).single();
  if (!study.data) return null;
  const [product, creds, calls, subs, bounties, member] = await Promise.all([
    supabase.from('products').select('id, slug, spending_policy').eq('id', study.data.product_id).single(),
    supabase.from('agent_credentials').select('*').eq('product_id', study.data.product_id).order('created_at', { ascending: false }),
    supabase.from('agent_tool_calls').select('id, credential_id, tool, transport, status, error_code, duration_ms, output_summary, input, created_at, agent_credentials(label, kind)').eq('study_id', id).order('created_at', { ascending: false }).limit(40),
    supabase.from('agent_submissions').select('id, actor, kind, is_retrospective, status, evaluation, created_at, bounty_id').eq('study_id', id).order('created_at', { ascending: false }),
    supabase.from('bounties').select('id, kind, title').eq('study_id', id),
    supabase.auth.getUser(),
  ]);
  const isOwner = member.data.user?.id === study.data.owner_id;
  const policy = (product.data?.spending_policy ?? {}) as { agent_can_publish?: boolean; max_budget_cents?: number };
  const visibleCreds = (creds.data ?? []).filter((c) => !c.study_id || c.study_id === id);

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="stack" aria-labelledby="how">
        <h2 id="how" className="section-title">Cómo se conecta un agente</h2>
        <p className="muted measure">Los agentes usan las mismas herramientas que ves en la interfaz, con entradas y salidas estructuradas. No necesitan leer un tablero ni copiar un resumen.</p>
        <div className="grid-2">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <strong>API REST</strong>
            <pre className="code-block">{`curl -X POST ${env.siteUrl}/api/agent/get_evidence \\
  -H "Authorization: Bearer fla_..." \\
  -H "Content-Type: application/json" \\
  -d '{"study_id":"${id}"}'`}</pre>
          </div>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <strong>Servidor MCP (HTTP)</strong>
            <pre className="code-block">{`claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."`}</pre>
          </div>
        </div>
        <p className="small"><Link href="/agentes">Referencia completa de herramientas</Link></p>
      </section>

      <SpendingPolicyForm studyId={id} enabled={Boolean(policy.agent_can_publish)} maxUsd={(policy.max_budget_cents ?? 0) / 100} disabled={!isOwner} />

      <section className="stack" aria-labelledby="creds">
        <h2 id="creds" className="section-title">Credenciales de trabajo</h2>
        <p className="field-help measure">Cada credencial limita actor, estudio, capacidades y caducidad. Nunca es una clave administrativa. Solo se guarda su huella: el token se muestra una vez.</p>
        {visibleCreds.length === 0 ? (
          <p className="empty">Todavía no hay credenciales para este producto.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Alcance y capacidades</th><th scope="col">Estado</th><th scope="col"><span className="visually-hidden">Acciones</span></th></tr></thead>
              <tbody>
                {visibleCreds.map((c) => {
                  const expired = new Date(c.expires_at).getTime() < Date.now();
                  const b = (bounties.data ?? []).find((x) => x.id === c.bounty_id);
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.label}</strong><div className="mono small muted">…{c.token_hint}</div></td>
                      <td>{c.kind === 'creator_agent' ? 'Agente creador' : 'Agente participante'}{b && <div className="small muted">{BOUNTY_KIND_LABEL[b.kind]}</div>}</td>
                      <td className="small">
                        <div>{c.study_id ? 'Este estudio' : 'Todo el producto'}</div>
                        <div className="muted">{(c.capabilities as Capability[]).map((cap) => <span key={cap} className="mono" title={CAPABILITIES[cap]} style={{ marginRight: 8 }}>{cap}</span>)}</div>
                      </td>
                      <td className="small">
                        {c.revoked_at ? <span className="tag tag-error">Revocada</span> : expired ? <span className="tag tag-warning">Vencida</span> : <span className="tag tag-success">Activa</span>}
                        <div className="muted">Vence {dateTime(c.expires_at)}</div>
                        <div className="muted">{c.last_used_at ? `Último uso ${dateTime(c.last_used_at)}` : 'Sin uso todavía'}</div>
                        {c.labels_seen_at && <div className="muted">Vio resultados humanos el {dateTime(c.labels_seen_at)}</div>}
                      </td>
                      <td>{!c.revoked_at && !expired && isOwner && <ActionButton action={revokeCredential.bind(null, id, c.id)} label="Revocar" size="sm" variant="danger" confirmText="¿Revocar la credencial? Deja de funcionar al instante." />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {isOwner && study.data.status !== 'draft' ? (
          <CredentialForm studyId={id} bounties={bounties.data ?? []} />
        ) : isOwner ? (
          <CredentialForm studyId={id} bounties={bounties.data ?? []} />
        ) : (
          <p className="callout">Solo quien es titular del estudio crea credenciales.</p>
        )}
      </section>

      <section className="stack" aria-labelledby="runs">
        <h2 id="runs" className="section-title">Actividad de los agentes</h2>
        <p className="field-help measure">Acciones observables y sus resultados. Nunca se registra razonamiento privado ni credenciales.</p>
        {(calls.data ?? []).length === 0 ? (
          <p className="empty">Sin actividad todavía.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Cuándo</th><th scope="col">Agente</th><th scope="col">Herramienta</th><th scope="col">Resultado</th><th scope="col" className="num">ms</th></tr></thead>
              <tbody>
                {(calls.data ?? []).map((c) => {
                  const cred = c.agent_credentials as unknown as { label: string; kind: string } | null;
                  const out = (c.output_summary ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={c.id}>
                      <td className="small nowrap">{dateTime(c.created_at)}</td>
                      <td className="small">{cred?.label ?? '?'}<div className="muted">{c.transport === 'mcp' ? 'MCP' : 'REST'}</div></td>
                      <td><strong>{TOOL_LABEL[c.tool] ?? c.tool}</strong><div className="mono small muted">{c.tool}</div></td>
                      <td className="small">
                        <span className={`tag ${c.status === 'ok' ? 'tag-success' : c.status === 'denied' ? 'tag-warning' : 'tag-error'}`}>{c.status === 'ok' ? 'Correcto' : c.status === 'denied' ? 'Denegado' : 'Error'}{c.error_code ? `: ${c.error_code}` : ''}</span>
                        {c.status === 'ok' && <div className="muted">{Object.entries(out).filter(([, v]) => typeof v !== 'object').slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>}
                      </td>
                      <td className="num mono">{c.duration_ms ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="subs">
        <h2 id="subs" className="section-title">Entregas de agentes</h2>
        {(subs.data ?? []).length === 0 ? (
          <p className="empty">Ningún agente entregó trabajo para este estudio.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Registrada</th><th scope="col">Agente</th><th scope="col">Trabajo</th><th scope="col">Evaluación</th></tr></thead>
              <tbody>
                {(subs.data ?? []).map((s) => {
                  const ev = (s.evaluation ?? {}) as { valid?: boolean; reasons?: string[]; criteria?: Record<string, number | null>; counts?: Record<string, number>; note?: string; accepted?: boolean };
                  return (
                    <tr key={s.id}>
                      <td className="small nowrap">{dateTime(s.created_at)}{s.kind === 'prediction' && (s.is_retrospective ? <div><span className="tag tag-warning">Retrospectivo</span></div> : <div><span className="tag tag-success">Antes de resultados</span></div>)}</td>
                      <td className="small">{s.actor}</td>
                      <td>{s.kind === 'prediction' ? 'Predicción de preferencia' : s.kind === 'analysis' ? 'Análisis de evidencia' : 'Intervención'}</td>
                      <td className="small">
                        {s.kind === 'analysis' && ev.counts && (
                          <>
                            <span className={`tag ${ev.valid ? 'tag-success' : 'tag-error'}`}>{ev.valid ? 'Válido' : 'No válido'}</span>
                            <div className="muted">{ev.counts.findings} hallazgos: {ev.counts.verified} verificados, {ev.counts.partial} parciales, {ev.counts.unsupported} sin fuente. Cobertura {Math.round((ev.criteria?.coverage ?? 0) * 100)}%.</div>
                            {ev.reasons?.map((r) => <div key={r} className="field-error">{r}</div>)}
                          </>
                        )}
                        {s.kind === 'prediction' && <Link href={`/lab/estudios/${id}/comparacion`}>Ver evaluación</Link>}
                        {s.kind === 'intervention' && <Link href={`/lab/estudios/${id}/versiones`}>Ver intervención</Link>}
                      </td>
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
