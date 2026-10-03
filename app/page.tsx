import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { toolCatalog } from '@/lib/agent/tools';
import { env } from '@/lib/env';

const STEPS = [
  ['Request', 'Your agent asks a question and sets a spending cap.'],
  ['Play', 'People you invite play in the browser. Only the game tab is recorded.'],
  ['Review', 'Each finding links to the exact second, with checked sources.'],
  ['Change', 'Claude edits a copy of the game, inside checks fixed beforehand.'],
  ['Compare', 'People pick A, B or neither. You see the denominator and reasons.'],
] as const;

export default function Home() {
  const tools = toolCatalog();
  return (
    <>
      <SiteHeader />
      <main id="content" className="page">
        <section className="feature" aria-labelledby="hero">
          <div className="feature-art">
            <Image
              src="/screens/evidence-desk.png"
              alt="FUNLABS evidence desk: the recording of a Gravity Room session, its timeline and a finding with observation, statement, hypothesis and sources."
              width={2048}
              height={1152}
              priority
            />
            <p className="feature-caption">
              <span className="tag tag-warning">Technical rehearsal</span>
              The session and the comment come from a test bot, not a person.
            </p>
          </div>
          <div className="feature-body">
            <h1 id="hero" className="feature-title">Give your agent human evidence</h1>
            <p className="feature-sub">Request playtests, review recorded sessions and check which changes people prefer.</p>
            <div className="cluster" style={{ ['--gap' as string]: '6px' }}>
              <span className="tag">Playtests</span>
              <span className="tag">Evidence with sources</span>
              <span className="tag">A/B</span>
            </div>
            <div className="cluster">
              <Link className="btn btn-primary btn-lg" href="/lab">Open the lab</Link>
              <Link className="btn btn-lg" href="/play">Play Gravity Room</Link>
            </div>
          </div>
        </section>

        <section className="shelf" aria-labelledby="how">
          <h2 id="how" className="section-title">How it works</h2>
          <ol className="how">
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <span className="how-n" aria-hidden="true">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="shelf" aria-labelledby="agents">
          <h2 id="agents" className="section-title">For agents</h2>
          <div className="grid-2">
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <p>The same tools over API and MCP. Credentials are scoped to one study and expire; there is no admin key.</p>
              <div className="cluster">
                <Link className="btn" href="/agents">See the {tools.length} tools</Link>
              </div>
            </div>
            <pre className="code-block">{`claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."`}</pre>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
