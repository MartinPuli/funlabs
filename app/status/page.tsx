import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { getPlatformStatus } from '@/lib/status';
import { dateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Integration status' };
export const dynamic = 'force-dynamic';

const STATE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'tag-success' },
  error: { label: 'Error', cls: 'tag-error' },
  not_configured: { label: 'Not configured', cls: 'tag-warning' },
  not_used: { label: 'Not used', cls: 'tag-outline' },
};

export default async function StatusPage() {
  const s = await getPlatformStatus();
  const db = s.database;
  return (
    <>
      <SiteHeader />
      <main id="content" className="page" style={{ paddingTop: 40, paddingBottom: 64 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
          <header className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
            <h1>Integration status</h1>
            <p className="muted measure">What is connected here and how it was checked. Anything unverified says so.</p>
            <p className="small muted">Environment: {s.environment.vercel ? `Vercel (${s.environment.vercelEnv}, ${s.environment.region})` : 'local'}. Jobs run on <span className="mono">{s.environment.runner}</span>. Checked {dateTime(s.generatedAt)}.</p>
          </header>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Integration</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead>
              <tbody>
                {s.integrations.map((i) => (
                  <tr key={i.key}>
                    <th scope="row">
                      <span>{i.name}</span>
                      <div className="small muted" style={{ fontWeight: 400 }}>{i.role}</div>
                    </th>
                    <td><span className={`tag ${STATE[i.state].cls}`}>{STATE[i.state].label}</span></td>
                    <td className="small">
                      {i.detail}
                      <div className="tiny muted">Checked by: {i.checkedBy}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {db && (
            <section className="stack" aria-labelledby="db">
              <h2 id="db" className="section-title">Database and jobs</h2>
              <dl className="kv">
                <dt>Extensions</dt><dd className="mono">{db.extensions.join(', ')}</dd>
                <dt>Scheduled tasks</dt><dd>{db.cron_jobs.map((j) => `${j.name} (${j.schedule})${j.active ? '' : ' inactive'}`).join(', ') || 'none'}</dd>
                <dt>Immediate job wake-up</dt><dd>{db.wakeup_configured ? 'Configured: when a job is queued, the database notifies the backend through pg_net; pg_cron checks every minute as a fallback.' : 'Not configured: jobs are processed when requested from the lab.'}</dd>
                <dt>Jobs</dt><dd>{db.jobs.queued} queued, {db.jobs.running} running, {db.jobs.succeeded} succeeded, {db.jobs.failed} failed</dd>
                <dt>Storage</dt><dd>{db.buckets.map((b) => `${b.id} (${b.public ? 'public' : 'private'})`).join(', ')}</dd>
              </dl>
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
