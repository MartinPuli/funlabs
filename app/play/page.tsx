import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { workerClient } from '@/lib/supabase/worker';
import { GRAVITY_ROOM_A_SHA256 } from '@/lib/game/builds.generated';
import { shortSha } from '@/lib/format';

export const metadata: Metadata = { title: 'Play Gravity Room' };
export const dynamic = 'force-dynamic';

type Playable = { key: string; label: string; src: string; sha: string; note: string; origin: string };

async function playableVersions(): Promise<Playable[]> {
  const list: Playable[] = [{ key: 'a', label: 'A', src: '/play/gravity-room/a', sha: GRAVITY_ROOM_A_SHA256, note: 'Original version, exactly as in the repository (games/gravity-room/a).', origin: 'Repository' }];
  try {
    const worker = await workerClient();
    const products = await worker.from('products').select('id').eq('is_public_demo', true);
    const ids = (products.data ?? []).map((p) => p.id);
    if (ids.length) {
      const vs = await worker.from('versions').select('id, label, content_sha256, notes, origin, created_at').in('product_id', ids).eq('status', 'ready').eq('origin', 'agent_intervention').order('created_at');
      for (const v of vs.data ?? []) list.push({ key: v.id, label: v.label, src: `/play/v/${v.id}`, sha: v.content_sha256, note: v.notes || 'Variant produced by an intervention.', origin: 'Agent intervention, with checks passed' });
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
      <SiteHeader current="/play" />
      <main id="content" className="page" style={{ paddingTop: 32, paddingBottom: 64 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
          <header className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h1>Gravity Room</h1>
            <p className="muted measure">Escape three rooms by flipping gravity. Playing here records nothing. Taking part in a study requires an invite.</p>
          </header>
          <nav aria-label="Playable versions" className="cluster">
            {versions.map((x) => (
              <Link key={x.key} className={`btn ${x.key === current.key ? 'btn-primary' : ''}`} href={x.key === 'a' ? '/play' : `/play?v=${x.key}`} aria-current={x.key === current.key ? 'true' : undefined}>
                Version {x.label}
              </Link>
            ))}
          </nav>
          <div className="game-frame-wrap">
            <iframe key={current.key} className="game-frame" src={current.src} title={`Gravity Room, version ${current.label}`} sandbox="allow-scripts" />
          </div>
          <div className="grid-2">
            <dl className="kv small">
              <dt>Version</dt><dd>{current.label} ({current.origin})</dd>
              <dt>Content hash</dt><dd className="mono">{shortSha(current.sha)}</dd>
              <dt>Identified URL</dt><dd><a className="mono" href={current.src} target="_blank" rel="noreferrer">{current.src}</a></dd>
              <dt>What changes</dt><dd>{current.note}</dd>
            </dl>
            <div className="stack small" style={{ ['--gap' as string]: 'var(--s-2)' }}>
              <strong>Controls</strong>
              <span>Arrow keys or A and D: move</span>
              <span>Space: flip gravity (while standing on the floor or ceiling)</span>
              <span>E: activate a nearby switch</span>
              <span>R: restart the room</span>
              <span className="muted">The game runs isolated: no network, no cookies and no FUNLABS data.</span>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
