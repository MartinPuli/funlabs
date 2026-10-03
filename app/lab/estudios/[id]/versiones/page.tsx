import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { dateTime, mmss, shortSha } from '@/lib/format';
import { DiffView } from '@/components/lab/DiffView';

export const metadata: Metadata = { title: 'Versiones' };

const INTERVENTION_STATUS: Record<string, string> = {
  proposed: 'Propuesta',
  checking: 'En comprobación',
  ready: 'Lista para comparar',
  checks_failed: 'No pasó las comprobaciones',
  rejected: 'Rechazada',
};

export default async function VersionsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createUserClient();
  const [study, sv, interventions, checks, suite] = await Promise.all([
    supabase.from('studies').select('id, product_id, check_suite_id, status').eq('id', id).single(),
    supabase.from('study_versions').select('role, version_id').eq('study_id', id),
    supabase.from('interventions').select('*').eq('study_id', id).order('created_at', { ascending: false }),
    supabase.from('checks').select('version_id, check_key, label, status, summary, runner, duration_ms, created_at').eq('study_id', id).order('created_at', { ascending: false }),
    supabase.from('studies').select('check_suites(sha256, suite_key, suite_version, definition)').eq('id', id).single(),
  ]);
  if (!study.data) return null;
  const versionIds = new Set<string>([...(sv.data ?? []).map((r) => r.version_id), ...(interventions.data ?? []).flatMap((i) => [i.base_version_id, i.result_version_id].filter(Boolean) as string[])]);
  const versions = versionIds.size
    ? await supabase.from('versions').select('id, label, status, origin, content_sha256, parent_version_id, created_at, notes').in('id', [...versionIds])
    : { data: [] as Array<{ id: string; label: string; status: string; origin: string; content_sha256: string; parent_version_id: string | null; created_at: string; notes: string }> };
  const evidenceIds = [...new Set((interventions.data ?? []).flatMap((i) => i.evidence_ids as string[]))];
  const evidence = evidenceIds.length
    ? await supabase.from('evidence').select('id, interval_start_ms, interval_end_ms, observation, session_id').in('id', evidenceIds)
    : { data: [] as Array<{ id: string; interval_start_ms: number; interval_end_ms: number; observation: string; session_id: string }> };
  const evById = new Map((evidence.data ?? []).map((e) => [e.id, e]));
  const vById = new Map((versions.data ?? []).map((v) => [v.id, v]));
  const roleOf = new Map((sv.data ?? []).map((r) => [r.version_id, r.role]));
  const suiteRow = suite.data?.check_suites as unknown as { sha256: string; suite_key: string; suite_version: number; definition: { checks: Array<{ key: string; label: string; claim: string }> } } | null;

  // Latest result per (version, check).
  const latest = new Map<string, NonNullable<typeof checks.data>[number]>();
  for (const c of checks.data ?? []) {
    const k = `${c.version_id}:${c.check_key}`;
    if (!latest.has(k)) latest.set(k, c);
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <section className="stack" aria-labelledby="suite">
        <h2 id="suite" className="section-title">Comprobaciones fijadas</h2>
        {suiteRow ? (
          <>
            <p className="muted measure">
              Se fijaron al publicar (conjunto {suiteRow.suite_key} v{suiteRow.suite_version}, hash <span className="mono">{shortSha(suiteRow.sha256)}</span>). Quien modifica el juego no puede editarlas. Verifican que la variante funciona, no que sea más divertida.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Comprobación</th>
                    <th scope="col">Qué afirma y qué no</th>
                    {[...versionIds].map((vid) => (
                      <th scope="col" key={vid}>Versión {vById.get(vid)?.label ?? '?'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suiteRow.definition.checks.map((c) => (
                    <tr key={c.key}>
                      <td><strong>{c.label}</strong></td>
                      <td className="small muted">{c.claim}</td>
                      {[...versionIds].map((vid) => {
                        const r = latest.get(`${vid}:${c.key}`);
                        return (
                          <td key={vid} className="small">
                            {r ? (
                              <span title={r.summary}>
                                <span className={`tag ${r.status === 'passed' ? 'tag-success' : r.status === 'skipped' ? 'tag-outline' : 'tag-error'}`}>{r.status === 'passed' ? 'Pasó' : r.status === 'failed' ? 'Falló' : r.status === 'skipped' ? 'Omitida' : 'Error'}</span>
                                <span className="muted" style={{ display: 'block' }}>{r.summary}</span>
                              </span>
                            ) : (
                              <span className="muted">Sin correr</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(checks.data ?? [])[0] && <p className="field-help">Última ejecución: {dateTime((checks.data ?? [])[0].created_at)} en {(checks.data ?? [])[0].runner}.</p>}
          </>
        ) : (
          <p className="empty">Las comprobaciones se fijan cuando publicás el estudio.</p>
        )}
      </section>

      <section className="stack" aria-labelledby="interventions">
        <div className="split">
          <h2 id="interventions" className="section-title">Intervenciones</h2>
          <Link className="btn" href={`/lab/estudios/${id}/evidencia`}>Elegir evidencia y proponer</Link>
        </div>
        {(interventions.data ?? []).length === 0 && (
          <p className="empty">Todavía no hay intervenciones. En la mesa de evidencia, marcá los hallazgos que motivan un cambio y pedile a Claude una variante acotada.</p>
        )}
        {(interventions.data ?? []).map((i) => {
          const result = i.result_version_id ? vById.get(i.result_version_id) : null;
          const model = i.model as { model?: string; served_by?: string; repair_rounds?: number; usage?: { output_tokens?: number } } | null;
          return (
            <article key={i.id} className="panel stack" aria-label={`Intervención ${result?.label ?? ''}`}>
              <div className="split">
                <div className="stack" style={{ ['--gap' as string]: '4px' }}>
                  <h3>{result ? `Versión ${result.label}` : 'Sin variante'} desde {vById.get(i.base_version_id)?.label ?? 'base'}</h3>
                  <span className="small muted">{i.actor}{model?.model ? `, ${model.model}${model.served_by && model.served_by !== model.model ? ` (respondió ${model.served_by})` : ''}` : ''}. {dateTime(i.created_at)}</span>
                </div>
                <div className="cluster">
                  <span className={`tag ${i.status === 'ready' ? 'tag-success' : i.status === 'checking' ? 'tag-warning' : i.status === 'proposed' ? '' : 'tag-error'}`}>{INTERVENTION_STATUS[i.status]}</span>
                  {result?.status === 'ready' && roleOf.get(result.id) === 'variant' && <a className="btn btn-sm" href={`/jugar/v/${result.id}`} target="_blank" rel="noreferrer">Jugar versión {result.label}</a>}
                </div>
              </div>
              <p><strong>{i.summary}</strong></p>
              <dl className="kv">
                <dt>Por qué</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{i.rationale}</dd>
                <dt>Qué conserva</dt>
                <dd>{i.preserve || '-'}</dd>
                <dt>Evidencia citada</dt>
                <dd>
                  {(i.evidence_ids as string[]).length === 0 && <span className="muted">Ninguna</span>}
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(i.evidence_ids as string[]).map((eid) => {
                      const e = evById.get(eid);
                      return e ? (
                        <li key={eid}>
                          <Link href={`/lab/estudios/${id}/evidencia?sesion=${e.session_id}`}>{mmss(e.interval_start_ms)} a {mmss(e.interval_end_ms)}</Link> {e.observation}
                        </li>
                      ) : (
                        <li key={eid} className="muted mono">{eid}</li>
                      );
                    })}
                  </ul>
                </dd>
                {result && (
                  <>
                    <dt>Versión resultante</dt>
                    <dd className="mono small">{shortSha(result.content_sha256)}</dd>
                  </>
                )}
                {model?.repair_rounds ? (
                  <>
                    <dt>Correcciones</dt>
                    <dd>{model.repair_rounds} ronda de corrección antes de entregar</dd>
                  </>
                ) : null}
              </dl>
              {Array.isArray(i.errors) && i.errors.length > 0 && (
                <div className="callout callout-error">
                  <strong>Motivos</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {(i.errors as string[]).map((err, k) => <li key={k}>{err}</li>)}
                  </ul>
                </div>
              )}
              {i.diff && (
                <details>
                  <summary>Ver el cambio ({(i.edits as unknown[]).length} {(i.edits as unknown[]).length === 1 ? 'edición' : 'ediciones'})</summary>
                  <DiffView diff={i.diff} />
                </details>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
