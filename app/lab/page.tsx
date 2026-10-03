import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { STATUS_LABEL, OBJECTIVE_LABEL, type StudyStatus } from '@/lib/catalog';
import { createDemoStudy } from './actions';

export const metadata: Metadata = { title: 'Lab' };

export default async function LabHome() {
  const supabase = await createUserClient();
  const { data: studies } = await supabase
    .from('studies')
    .select('id, title, status, objective, created_at, is_rehearsal, participants_target, products(name)')
    .order('created_at', { ascending: false });
  const list = studies ?? [];
  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
      <div className="split">
        <h1>Studies</h1>
        <div className="cluster">
          <form action={createDemoStudy}>
            <button className="btn" type="submit">Example study</button>
          </form>
          <Link className="btn btn-primary" href="/lab/studies/new">New study</Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <h2>No studies yet</h2>
          <p className="muted measure">
            The example study uses Gravity Room with the MVP question: improve clarity while keeping the challenge. It stays a draft until you publish it.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Study</th>
                <th scope="col">Product</th>
                <th scope="col">Objective</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/lab/studies/${s.id}`}>{s.title}</Link>
                    {s.is_rehearsal && <span className="tag tag-warning" style={{ marginLeft: 8 }}>Technical rehearsal</span>}
                  </td>
                  <td>{(s.products as unknown as { name: string } | null)?.name ?? '-'}</td>
                  <td>{OBJECTIVE_LABEL[s.objective] ?? s.objective}</td>
                  <td>
                    <span className={`tag ${s.status === 'draft' ? 'tag-outline' : s.status === 'completed' ? 'tag-success' : ''}`}>{STATUS_LABEL[s.status as StudyStatus]}</span>
                  </td>
                  <td className="nowrap">{new Date(s.created_at).toLocaleDateString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
