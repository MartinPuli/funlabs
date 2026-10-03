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
      <main id="content" className="page" style={{ paddingTop: 24, paddingBottom: 32 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
          <header className="split">
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              <h1>Gravity Room</h1>
              <div className="cluster" style={{ ['--gap' as string]: '6px' }}>
                <span className="tag">Puzzle</span>
                <span className="tag">3 rooms</span>
                <span className="tag tag-outline">Playing here records nothing</span>
              </div>
            </div>
            {versions.length > 1 && (
              <nav aria-label="Playable versions" className="cluster" style={{ ['--gap' as string]: '6px' }}>
                {versions.map((x) => (
                  <Link key={x.key} className={`btn ${x.key === current.key ? 'btn-primary' : ''}`} href={x.key === 'a' ? '/play' : `/play?v=${x.key}`} aria-current={x.key === current.key ? 'true' : undefined}>
                    Version {x.label}
                  </Link>
                ))}
              </nav>
            )}
          </header>
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
            <dl className="kv small">
              <dt className="mono">← → · A D</dt><dd>Move</dd>
              <dt className="mono">Space</dt><dd>Flip gravity, standing on the floor or ceiling</dd>
              <dt className="mono">E</dt><dd>Activate a nearby switch</dd>
              <dt className="mono">R</dt><dd>Restart the room</dd>
            </dl>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
