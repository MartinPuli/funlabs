import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { workerClient } from '@/lib/supabase/worker';
import { GRAVITY_ROOM_A_SHA256 } from '@/lib/game/builds.generated';
import { shortSha } from '@/lib/format';

export const metadata: Metadata = { title: 'Jugar Gravity Room' };
export const dynamic = 'force-dynamic';

type Playable = { key: string; label: string; src: string; sha: string; note: string; origin: string };

async function playableVersions(): Promise<Playable[]> {
  const list: Playable[] = [{ key: 'a', label: 'A', src: '/jugar/gravity-room/a', sha: GRAVITY_ROOM_A_SHA256, note: 'Versión original, tal como está en el repositorio (games/gravity-room/a).', origin: 'Repositorio' }];
  try {
    const worker = await workerClient();
    const products = await worker.from('products').select('id').eq('is_public_demo', true);
    const ids = (products.data ?? []).map((p) => p.id);
    if (ids.length) {
      const vs = await worker.from('versions').select('id, label, content_sha256, notes, origin, created_at').in('product_id', ids).eq('status', 'ready').eq('origin', 'agent_intervention').order('created_at');
      for (const v of vs.data ?? []) list.push({ key: v.id, label: v.label, src: `/jugar/v/${v.id}`, sha: v.content_sha256, note: v.notes || 'Variante producida por una intervención.', origin: 'Intervención de un agente, con comprobaciones aprobadas' });
    }
  } catch {
    // Without a database the repository version is still playable.
  }
  return list;
}

export default async function PlayPage(props: { searchParams: Promise<{ v?: string }> }) {
  const sp = await props.searchParams;
  const versions = await playableVersions();
  const current = versions.find((x) => x.key === sp.v) ?? versions[0];
  return (
    <>
      <SiteHeader current="/jugar" />
      <main id="contenido" className="page" style={{ paddingTop: 32, paddingBottom: 64 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
          <header className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h1>Gravity Room</h1>
            <p className="muted measure">Escapá de tres salas invirtiendo la gravedad. Acá se juega sin grabar nada. Para participar en un estudio hace falta una invitación.</p>
          </header>
          <nav aria-label="Versiones jugables" className="cluster">
            {versions.map((x) => (
              <Link key={x.key} className={`btn ${x.key === current.key ? 'btn-primary' : ''}`} href={x.key === 'a' ? '/jugar' : `/jugar?v=${x.key}`} aria-current={x.key === current.key ? 'true' : undefined}>
                Versión {x.label}
              </Link>
            ))}
          </nav>
          <div className="game-frame-wrap">
            <iframe key={current.key} className="game-frame" src={current.src} title={`Gravity Room, versión ${current.label}`} sandbox="allow-scripts" />
          </div>
          <div className="grid-2">
            <dl className="kv small">
              <dt>Versión</dt><dd>{current.label} ({current.origin})</dd>
              <dt>Hash del contenido</dt><dd className="mono">{shortSha(current.sha)}</dd>
              <dt>URL identificada</dt><dd><a className="mono" href={current.src} target="_blank" rel="noreferrer">{current.src}</a></dd>
              <dt>Qué cambia</dt><dd>{current.note}</dd>
            </dl>
            <div className="stack small" style={{ ['--gap' as string]: 'var(--s-2)' }}>
              <strong>Controles</strong>
              <span>Flechas o A y D: moverse</span>
              <span>Espacio: invertir la gravedad (apoyado en piso o techo)</span>
              <span>E: activar un interruptor cercano</span>
              <span>R: reiniciar la sala</span>
              <span className="muted">El juego corre aislado: sin red, sin cookies ni datos de FUNLABS.</span>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
