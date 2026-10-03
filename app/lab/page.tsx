import type { Metadata } from 'next';
import Link from 'next/link';
import { createUserClient } from '@/lib/supabase/server';
import { STATUS_LABEL, OBJECTIVE_LABEL, type StudyStatus } from '@/lib/catalog';
import { createDemoStudy } from './actions';

export const metadata: Metadata = { title: 'Laboratorio' };

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
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <h1>Estudios</h1>
          <p className="muted measure">Cada estudio fija una pregunta y un objetivo, encarga pruebas humanas y conecta la evidencia con los cambios y las comparaciones.</p>
        </div>
        <div className="cluster">
          <form action={createDemoStudy}>
            <button className="btn" type="submit">Estudio de ejemplo</button>
          </form>
          <Link className="btn btn-primary" href="/lab/estudios/nuevo">Nuevo estudio</Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <h2 style={{ fontSize: 20 }}>Todavía no hay estudios</h2>
          <p className="muted measure">
            El estudio de ejemplo usa Gravity Room, un juego corto de este repositorio, con la pregunta del MVP: mejorar la claridad conservando el desafío. Queda en borrador hasta que lo publiques.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Estudio</th>
                <th scope="col">Producto</th>
                <th scope="col">Objetivo</th>
                <th scope="col">Estado</th>
                <th scope="col">Creado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/lab/estudios/${s.id}`}>{s.title}</Link>
                    {s.is_rehearsal && <span className="tag tag-warning" style={{ marginLeft: 8 }}>Ensayo técnico</span>}
                  </td>
                  <td>{(s.products as unknown as { name: string } | null)?.name ?? '-'}</td>
                  <td>{OBJECTIVE_LABEL[s.objective] ?? s.objective}</td>
                  <td>
                    <span className={`tag ${s.status === 'draft' ? 'tag-outline' : s.status === 'completed' ? 'tag-success' : ''}`}>{STATUS_LABEL[s.status as StudyStatus]}</span>
                  </td>
                  <td className="nowrap">{new Date(s.created_at).toLocaleDateString('es-AR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
