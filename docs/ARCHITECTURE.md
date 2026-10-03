# FUNLABS: architecture and runbook

This is the technical guide to what is implemented. The product specification is in [`FUNLABS.md`](../FUNLABS.md).

## Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Game | `games/gravity-room/a/index.html` | Version A of Gravity Room. Levels and rules live in `@funlabs:locked` regions; only presentation is `@funlabs:editable`. It emits events through `postMessage`. |
| Fixed checks | `lib/checks/suite.ts`, `games/gravity-room/route.json` | Structure, scope, initialization, controls, restart, hazards, a known route that completes the 3 rooms, and drawing without errors. They are frozen (hashed) when the study is published. |
| Intervention scope | `lib/game/regions.ts`, `lib/game/patch.ts` | A change is a set of find/replace pairs that must land in editable regions; the rest of the file must stay identical. |
| Schema | `supabase/migrations/*.sql` | 32 tables with RLS, private buckets, Realtime, pg_cron + pg_net + Vault. |
| Interface | `app/` | Landing, `/lab` (creator), `/t/[token]` (tester), `/play`, `/agents`, `/status`. |
| Agent API | `lib/agent/*`, `app/api/agent/[tool]`, `app/api/mcp` | The same contract over REST and over MCP. |
| Jobs | `lib/jobs.ts`, `app/api/jobs/*`, `scripts/worker.mjs` | A Postgres queue (`claim_job` with `SKIP LOCKED`), retries with growing backoff. |
| Analysis | `lib/analysis/*` | Gemini (Files API + schema-constrained output) and structural validation of every source. |
| Intervention | `lib/intervention/*` | Claude (structured output, adaptive thinking, prompt caching, fallback on refusal). |

## Identities and trust

- **Creators** sign in with Supabase Auth; everything they see goes through RLS (`study_members`).
- **Testers** have no account: their invitation (`flt_...`) is the credential; only its hash is stored.
- **Agents** use work credentials (`fla_...`) with actor, study or product, capabilities and expiry. Never an administrative key.
- **The backend** acts with a dedicated identity (`app_metadata.funlabs_role = 'worker'`) to which RLS grants what processing needs. It does not use the service-role key in production.
- Game versions run in an `iframe` with `sandbox="allow-scripts"` and a CSP with no network, in an opaque origin.

## Data flow

1. The owner publishes a study: question, objective, protocol, budget and checks are fixed; a baseline run is queued.
2. The person opens `/t/<token>`, accepts (separate permissions), records the tab and plays. Events are stamped with the recording clock.
3. On delivery, `analyze_session` is queued. The job uploads the video to Gemini, asks for findings with an interval and sources, validates that each reference exists and belongs to the session, stores them and deletes the file at the provider.
4. The owner reviews (confirm, correct, reject with history) and picks findings; Claude proposes edits; `applyScopedEdits` applies them; an immutable version is recorded and `run_checks` is queued.
5. The variant moves to `study_versions` only if all checks pass. The comparison opens: neutral names and alternating order.
6. Results with denominator, order, reasons and limits. Agent predictions are evaluated against the preferences.
7. A private export of examples with the owner's and each participant's permission and reviewed findings. It never includes video.

## Running everything locally

```bash
npm install
npx supabase start -x edge-runtime,vector,logflare,imgproxy,supavisor   # Docker
npx supabase db reset                                                    # applies supabase/migrations
# Backend identity (once): generate a long password and keep it in .env.local
psql "$SUPABASE_DB_URL" -c "select private.provision_user('worker@funlabs.local', '<password>', '{\"funlabs_role\":\"worker\"}', 'FUNLABS worker')"
cp .env.example .env.local                                               # fill in the keys
npm run dev
npm test                  # unit
npm run db:test           # RLS and integrity (needs the local stack)
npx vitest run tests/integration   # agent API + MCP (needs the app and the stack)
npm run test:e2e          # Playwright: human circuit and A/B circuit
npm run test:agentic      # TesterArmy e2e: an agent drives the creator flow (needs ANTHROPIC_API_KEY)
```

## Environment variables

See `.env.example`. Provider keys are optional: if one is missing, the product shows the "not configured" state in `/status` and does not invent data.

## Deployment

- **Vercel**: the `funlabs` project is connected to the repository. Required variables: the Supabase ones, `FUNLABS_WORKER_EMAIL`/`FUNLABS_WORKER_PASSWORD`, `FUNLABS_CRON_SECRET`, and the Gemini and Anthropic keys (or AI Gateway with OIDC, no keys).
- **Hosted Supabase**: apply the migrations in order, create the backend identity with `private.provision_user` and store `funlabs_jobs_tick_url` and `funlabs_jobs_tick_secret` in Vault (see `scripts/configure-cron.sql`). With that, `pg_net` notifies the backend when a job is queued and `pg_cron` checks every minute as a fallback.

## Decisions and limits

- Payments are test mode; `payments_mode` and `livemode` have database constraints that prevent any other value.
- Checks run in a Node `vm` context inside the server function. **It is not a security boundary**: that is why interventions are only made by the creator agent and there is no code submission by external agents. Isolating those executions (Vercel Sandbox or Supabase Compute) is the step before opening that door.
- `scripts/worker.mjs` runs the same job loop outside Vercel. Each job records where it ran (`runner`). It is not advertised as Supabase Compute: the provisioning was not verified.
- All rehearsal material comes from bots and is marked `is_rehearsal`. No real person has used the product yet.
