import type { Metadata } from 'next';
import Link from 'next/link';
import { StudyRequestForm } from '@/components/lab/StudyRequestForm';

export const metadata: Metadata = { title: 'Nuevo estudio' };

export default function NewStudyPage() {
  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)', maxWidth: 820 }}>
      <p className="small"><Link href="/lab">Estudios</Link></p>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <h1>Nuevo estudio</h1>
        <p className="muted measure">La pregunta y el objetivo se fijan al publicar: no se cambian después para declarar que una variante ganó.</p>
      </div>
      <StudyRequestForm />
    </div>
  );
}
