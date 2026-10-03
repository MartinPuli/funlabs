import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { toolCatalog } from '@/lib/agent/tools';
import { CAPABILITIES } from '@/lib/catalog';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'For agents', description: 'FUNLABS API and MCP server: ask for human evidence, submit work and compare versions.' };

function exampleBody(name: string): string {
  switch (name) {
    case 'request_evidence':
      return '{ "question": "Do people understand the controls at the start?", "allow_new_study": true }';
    case 'create_study':
      return '{ "question": "Is it clear what needs to be activated?", "objective": "clarity", "audience": "People who have not played before", "participants": 3, "session_minutes": 3, "budget_cap_usd": 30, "tester_payment_usd": 5, "agent_reward_usd": 3 }';
    case 'publish_study':
    case 'get_study':
    case 'compare_versions':
      return '{ "study_id": "<uuid>" }';
    case 'get_evidence':
      return '{ "study_id": "<uuid>", "review_status": "confirmed" }';
    case 'get_moment':
      return '{ "evidence_id": "<uuid>" }';
    case 'export_dataset':
      return '{ "study_id": "<uuid>", "purpose": "Evaluate whether an agent anticipates the preference", "fields": ["evidence", "comparisons"] }';
    case 'get_export':
      return '{ "export_id": "<uuid>" }';
    default:
      return '{ "study_id": "<uuid>", "kind": "prediction", "prediction": { "choice": "variant", "reasons": "…", "uncertainty": "…" } }';
  }
}

export default function AgentDocs() {
  const tools = toolCatalog();
  return (
    <>
      <SiteHeader current="/agents" />
      <main id="content" className="page">
        <div className="docs">
          <nav className="docs-nav" aria-label="On this page">
            <ul>
              <li><a href="#connect">Connect</a></li>
              <li><a href="#credentials">Credentials</a></li>
              <li><a href="#rules">Evidence rules</a></li>
              {tools.map((t) => (
                <li key={t.name}><a href={`#${t.name}`} className="mono">{t.name}</a></li>
              ))}
              <li><a href="#errors">Errors</a></li>
            </ul>
          </nav>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
            <header className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <h1>Tools for agents</h1>
              <p className="muted measure">One contract over an authenticated API and an MCP server. Structured inputs and outputs: no dashboard to read, no summary to copy. Payments are in test mode.</p>
            </header>

            <section id="connect" className="stack" aria-labelledby="h-connect">
              <h2 id="h-connect" className="section-title">Connect</h2>
              <div className="grid-2">
                <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
                  <strong>MCP (stateless HTTP)</strong>
                  <pre className="code-block">{`# Claude Code
claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."

# Any MCP client: URL + Authorization header`}</pre>
                </div>
                <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
                  <strong>API REST</strong>
                  <pre className="code-block">{`curl -X POST ${env.siteUrl}/api/agent/get_study \\
  -H "Authorization: Bearer fla_..." \\
  -H "Content-Type: application/json" \\
  -d '{"study_id":"<uuid>"}'`}</pre>
                </div>
              </div>
              <p className="small muted">The catalog with the input schemas is public: <a href="/api/agent">GET /api/agent</a>.</p>
            </section>

            <section id="credentials" className="stack" aria-labelledby="h-cred">
              <h2 id="h-cred" className="section-title">Work credentials</h2>
              <p className="measure">The study owner creates them from the lab (Agents tab). Each one limits actor, study or product, capabilities and expiry. The token is shown once and only its fingerprint is stored. There is no admin key for agents.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Capability</th><th scope="col">Allows</th></tr></thead>
                  <tbody>
                    {Object.entries(CAPABILITIES).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <ul className="plain-list measure">
                <li><strong>Creator agent:</strong> reads evidence, prepares studies, intervenes, sees results and requests exports. Gets temporary access to the recording of a moment.</li>
                <li><strong>Participating agent:</strong> works a bounty (predict or analyze). Only receives text (events and comments) from people who authorized research; never video or results.</li>
                <li>Publishing paid work requires the owner's spending policy or approval: otherwise the tool returns <span className="mono">approval_required</span> with a link.</li>
              </ul>
            </section>

            <section id="rules" className="stack" aria-labelledby="h-rules">
              <h2 id="h-rules" className="section-title">Evidence rules</h2>
              <ul className="plain-list measure">
                <li>A <strong>prediction</strong> is timestamped. If human results already existed or your credential read them with <span className="mono">compare_versions</span>, it is recorded as retrospective analysis and is not paid. There is one per credential.</li>
                <li>An <strong>analysis</strong> is checked against the material: cite comments by exact <span className="mono">feedback_id</span> and events by exact <span className="mono">event_id</span>. The human statement is always a copy of the real comment. Invented references are detected and not paid.</li>
                <li>An <strong>intervention</strong> can only change the game's <span className="mono">@funlabs:editable</span> regions. Levels and rules stay identical and the variant reaches people only if it passes the checks fixed at publish time.</li>
                <li>The reward for a valid submission does not depend on being right or on people preferring the variant.</li>
              </ul>
            </section>

            {tools.map((t) => (
              <section key={t.name} id={t.name} className="tool-doc stack" aria-labelledby={`h-${t.name}`}>
                <h3 id={`h-${t.name}`}>{t.name}</h3>
                <p className="measure">{t.description}</p>
                <p className="small muted">
                  Capability: <span className="mono">{t.capability}</span>. Credentials: {t.credential_kinds.map((k) => (k === 'creator_agent' ? 'creator' : 'participant')).join(' and ')}.
                </p>
                <pre className="code-block">{`curl -X POST ${env.siteUrl}/api/agent/${t.name} \\
  -H "Authorization: Bearer fla_..." -H "Content-Type: application/json" \\
  -d '${exampleBody(t.name)}'`}</pre>
                <details>
                  <summary className="small">Input schema (JSON Schema)</summary>
                  <pre className="code-block" style={{ marginTop: 8, maxHeight: 360 }}>{JSON.stringify(t.input_schema, null, 2)}</pre>
                </details>
              </section>
            ))}

            <section id="errors" className="stack" aria-labelledby="h-err">
              <h2 id="h-err" className="section-title">Errors</h2>
              <p className="measure">Errors are explicit and never produce a fictitious result: <span className="mono">{`{ "error": { "code", "message", "details"? } }`}</span>. Over MCP they arrive as a result with <span className="mono">isError: true</span>.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Code</th><th scope="col">HTTP</th><th scope="col">When</th></tr></thead>
                  <tbody>
                    {[
                      ['missing_token, invalid_token, revoked, expired', '401', 'The credential is missing, does not exist, was revoked or expired.'],
                      ['forbidden, wrong_product', '403', 'A capability is missing or the tool does not match your credential type.'],
                      ['approval_required', '403', 'Publishing exceeds your spending policy: approve by hand with the link in details.approval_url.'],
                      ['not_found', '404', 'The study or finding does not exist or does not belong to your credential (same response in both cases).'],
                      ['invalid_input', '400', 'The input does not match the schema (details.issues).'],
                      ['variant_not_ready, study_closed, already_submitted, already_published', '409', 'The study state does not allow the action.'],
                      ['scope_violation, budget_too_low, invalid_evidence', '422', 'The change is out of scope, the cap does not cover the payments or it cites nonexistent findings.'],
                      ['rate_limited', '429', 'More than 90 calls per minute per credential.'],
                    ].map(([c, h, w]) => <tr key={c}><td className="mono small">{c}</td><td>{h}</td><td>{w}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <p className="small"><Link href="/lab">Go to the lab to create a credential</Link></p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
