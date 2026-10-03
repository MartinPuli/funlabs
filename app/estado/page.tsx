import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { getPlatformStatus } from '@/lib/status';
import { dateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Estado de integraciones' };
export const dynamic = 'force-dynamic';

const STATE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Activa', cls: 'tag-success' },
  error: { label: 'Con error', cls: 'tag-error' },
  not_configured: { label: 'No configurada', cls: 'tag-warning' },
  not_used: { label: 'No se usa', cls: 'tag-outline' },
};

export default async function StatusPage() {
  const s = await getPlatformStatus();
  const db = s.database;
  return (
    <>
      <SiteHeader />
      <main id="contenido" className="page" style={{ paddingTop: 40, paddingBottom: 64 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
          <header className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
            <h1>Estado de integraciones</h1>
            <p className="muted measure">Qué está conectado en este despliegue y cómo se comprobó. Lo que no está verificado figura como tal; no hay logos decorativos.</p>
            <p className="small muted">Entorno: {s.environment.vercel ? `Vercel (${s.environment.vercelEnv}, ${s.environment.region})` : 'local'}. Los trabajos corren en <span className="mono">{s.environment.runner}</span>. Comprobado {dateTime(s.generatedAt)}.</p>
          </header>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Integración</th><th scope="col">Estado</th><th scope="col">Qué hace aquí</th><th scope="col">Detalle</th><th scope="col">Cómo se comprobó</th></tr></thead>
              <tbody>
                {s.integrations.map((i) => (
                  <tr key={i.key}>
                    <th scope="row">{i.name}</th>
                    <td><span className={`tag ${STATE[i.state].cls}`}>{STATE[i.state].label}</span></td>
                    <td className="small">{i.role}</td>
                    <td className="small">{i.detail}</td>
                    <td className="small muted">{i.checkedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {db && (
            <section className="stack" aria-labelledby="db">
              <h2 id="db" className="section-title">Base de datos y trabajos</h2>
              <dl className="kv">
                <dt>Extensiones</dt><dd className="mono">{db.extensions.join(', ')}</dd>
                <dt>Tareas programadas</dt><dd>{db.cron_jobs.map((j) => `${j.name} (${j.schedule})${j.active ? '' : ' inactiva'}`).join(', ') || 'ninguna'}</dd>
                <dt>Despertar inmediato de trabajos</dt><dd>{db.wakeup_configured ? 'Configurado: al encolar un trabajo, la base avisa al backend con pg_net; pg_cron revisa cada minuto como respaldo.' : 'No configurado: los trabajos se procesan al pedirlo desde el laboratorio.'}</dd>
                <dt>Trabajos</dt><dd>{db.jobs.queued} en cola, {db.jobs.running} en curso, {db.jobs.succeeded} terminados, {db.jobs.failed} fallidos</dd>
                <dt>Almacenamiento</dt><dd>{db.buckets.map((b) => `${b.id} (${b.public ? 'público' : 'privado'})`).join(', ')}</dd>
              </dl>
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
