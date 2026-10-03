import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { toolCatalog } from '@/lib/agent/tools';
import { env } from '@/lib/env';

const FINDING_EXAMPLE = `{
  "evidence_id": "example-e01",
  "interval_ms": { "start": 21000, "end": 29000 },
  "observation": "The person tries to move forward several times.",
  "human_statement": "I don't know which object I can activate.",
  "hypothesis": "The interaction cue may be hard to see.",
  "alternative": "They may not have understood the initial instruction.",
  "next_test": "Change the visual cue and keep the puzzle.",
  "sources": [
    { "kind": "recording",  "verified": true },
    { "kind": "feedback",   "verified": true }
  ],
  "review_status": "unreviewed"
}`;

export default function Home() {
  const tools = toolCatalog();
  return (
    <>
      <SiteHeader />
      <main id="content">
        <section className="hero page">
          <div className="hero-copy stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <h1 className="hero-title">Give your agent human evidence</h1>
            <p className="hero-sub">Request playtests, review recorded sessions and check which changes people prefer.</p>
            <div className="cluster">
              <Link className="btn btn-primary btn-lg" href="/lab">Open the lab</Link>
              <Link className="btn btn-lg" href="/play">Play Gravity Room</Link>
            </div>
          </div>
          <figure className="hero-figure">
            <picture>
              <source srcSet="/screens/evidence-desk-rehearsal-dark.png" media="(prefers-color-scheme: dark)" />
              <Image src="/screens/evidence-desk-rehearsal-light.png" alt="FUNLABS evidence desk: the recording of a Gravity Room session, the timeline and a finding with observation, statement, hypothesis and sources." width={1860} height={1050} priority className="hero-shot" />
            </picture>
            <figcaption className="small muted">Real capture of the product's technical rehearsal. The session and the comment come from a test bot, not a person.</figcaption>
          </figure>
        </section>

        <section className="section page loop" aria-labelledby="loop">
          <h2 id="loop" className="section-heading">One design decision, from question to result</h2>
          <ol className="loop-list">
            <li>
              <h3>Request</h3>
              <p>Your agent publishes a version and a question, with audience, duration, number of people and a spending cap. If evidence for the same product and version already exists, it queries that before asking for new work.</p>
            </li>
            <li>
              <h3>Play</h3>
              <p>Each person gets a link, sees what is recorded and how much it pays, and plays in their browser. Only the game tab is recorded. Saying something is boring is a valid submission.</p>
            </li>
            <li>
              <h3>Review</h3>
              <p>Gemini proposes findings with an interval and sources. FUNLABS checks that each source exists and belongs to the session. From a finding you jump to the exact second of the recording with one click.</p>
            </li>
            <li>
              <h3>Change</h3>
              <p>Claude edits a copy of the game. It can only touch presentation: levels and rules stay identical. The variant reaches people only if it passes checks that were fixed before the change.</p>
            </li>
            <li>
              <h3>Compare</h3>
              <p>People play both versions with neutral names and alternating order. They can pick either one or neither. You see results with the denominator, reasons and limits.</p>
            </li>
          </ol>
        </section>

        <section className="section page" aria-labelledby="jobs">
          <h2 id="jobs" className="section-heading">People and agents are evaluated separately</h2>
          <p className="muted measure">There is no single score for testers, bots and analyst agents. Each kind of work has its own measure and says what it does not prove.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Work</th><th scope="col">How it is measured</th><th scope="col">What it does not prove</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Person: play and explain</th>
                  <td>Usable material, task attempted and comments about the session. A valid submission is paid even if the person did not like the game.</td>
                  <td>A pause or many attempts do not prove boredom.</td>
                </tr>
                <tr>
                  <th scope="row">Agent: predict a preference</th>
                  <td>Recorded with a timestamp before seeing results and compared with human preferences. If results already exist, it counts as retrospective analysis.</td>
                  <td>A single hit is not general judgment.</td>
                </tr>
                <tr>
                  <th scope="row">Agent: analyze evidence</th>
                  <td>Each finding is verified against the material: the cited interval, comment and event must exist. An invented citation is not paid.</td>
                  <td>A convincing report can still be misinterpreted.</td>
                </tr>
                <tr>
                  <th scope="row">Agent: propose an improvement</th>
                  <td>A working variant within the allowed scope, plus a later human preference, recorded separately.</td>
                  <td>More time playing is not more fun.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="section page split-sec" aria-labelledby="evidence">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
            <h2 id="evidence" className="section-heading">A finding separates what happened from what is assumed</h2>
            <p className="muted measure">Observation, the person's statement, interpretation and next test are separate fields. The statement is always a verbatim copy of a real comment: a model cannot write it.</p>
            <ul className="plain-list">
              <li>Sources are verified against the session, not trusted.</li>
              <li>Without a source, the finding is shown as a hypothesis.</li>
              <li>The person can correct how their comment was interpreted.</li>
              <li>Moments people enjoyed are recorded too, so you know what to keep.</li>
            </ul>
          </div>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <pre className="code-block" aria-label="Illustrative example of a finding">{FINDING_EXAMPLE}</pre>
            <p className="small muted">Illustrative example of the contract, not a real session.</p>
          </div>
        </section>

        <section className="section page" aria-labelledby="agents">
          <div className="split-sec">
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
              <h2 id="agents" className="section-heading">Your agent asks for evidence with tools, not by copying a summary</h2>
              <p className="muted measure">The same contract works over API and MCP. Credentials limit actor, study, capabilities and expiry; they are never an admin key. Publishing paid work requires a spending policy from the owner or their approval.</p>
              <div className="cluster">
                <Link className="btn btn-primary" href="/agents">See the {tools.length} tools</Link>
              </div>
            </div>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
              <pre className="code-block">{`claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."`}</pre>
              <pre className="code-block">{`> request_evidence({ question:
    "Do people understand the controls at the start?" })
{ "coverage": { "sessions": 3, "recording_minutes": 7.4 },
  "gaps": ["No finding has been reviewed..."],
  "findings": [ ... ] }`}</pre>
              <p className="small muted">If there is no matching material, the tool says so and proposes a draft study. It does not invent examples.</p>
            </div>
          </div>
        </section>

        <section className="section page" aria-labelledby="data">
          <h2 id="data" className="section-heading">Data for researching decisions, with separate permissions</h2>
          <div className="data-grid">
            <div>
              <h3>The unit</h3>
              <p>Version A, prior prediction, human experience, diagnosis, intervention, version B and preferences with reasons. Ties, negative results and abstentions are all kept.</p>
            </div>
            <div>
              <h3>The permissions</h3>
              <p>Accepting the recording does not authorize sharing data. Research and training are accepted separately, by each person and by the product owner, and can be withdrawn.</p>
            </div>
            <div>
              <h3>The export</h3>
              <p>Private download with events, comments and reviewed findings from authorized examples. It does not include video or audio. It is not a representative dataset or a marketplace.</p>
            </div>
          </div>
        </section>

        <section className="section page" aria-labelledby="limits">
          <h2 id="limits" className="section-heading">What it does not do yet</h2>
          <ul className="plain-list measure">
            <li>Payments are in test mode. Internal reservations are not an escrow or a transfer.</li>
            <li>There is no global network of testers: the people you invite take part.</li>
            <li>It works with web games we can instrument. An external site without integration would provide recording and answers, not events.</li>
            <li>With few people, results describe that test and do not allow generalizing.</li>
            <li>Interventions are made by the creator agent. Opening them to external agents requires isolated execution.</li>
          </ul>
          <p><Link href="/status">See the status of each integration in this environment</Link></p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
