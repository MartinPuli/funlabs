import type { Metadata } from 'next';
import Link from 'next/link';
import { StudyRequestForm } from '@/components/lab/StudyRequestForm';

export const metadata: Metadata = { title: 'New study' };

export default function NewStudyPage() {
  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)', maxWidth: 820 }}>
      <p className="small"><Link href="/lab">Studies</Link></p>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <h1>New study</h1>
        <p className="muted measure">The question and objective are fixed when you publish: they are not changed afterwards to declare that a variant won.</p>
      </div>
      <StudyRequestForm />
    </div>
  );
}
