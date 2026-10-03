import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createUserClient } from '@/lib/supabase/server';
import { StatusPipeline } from '@/components/lab/StatusPipeline';
import { StudyTabs } from '@/components/lab/StudyTabs';
import { LiveRefresh } from '@/components/lab/LiveRefresh';
import { OBJECTIVE_LABEL, type StudyStatus } from '@/lib/catalog';

export default async function StudyLayout(props: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createUserClient();
  const { data: study } = await supabase.from('studies').select('id, title, status, is_rehearsal, objective, products(name)').eq('id', id).maybeSingle();
  if (!study) notFound();
  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
        <p className="small">
          <Link href="/lab">Studies</Link> / {(study.products as unknown as { name: string } | null)?.name}
        </p>
        <div className="split">
          <h1>{study.title}</h1>
          <div className="cluster">
            {study.is_rehearsal && <span className="tag tag-warning">Technical rehearsal</span>}
            <span className="tag">Objective: {OBJECTIVE_LABEL[study.objective]}</span>
            <LiveRefresh studyId={study.id} />
          </div>
        </div>
        <StatusPipeline status={study.status as StudyStatus} />
      </div>
      <StudyTabs studyId={study.id} />
      <div>{props.children}</div>
    </div>
  );
}
