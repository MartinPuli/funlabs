# FUNLABS

**Give your agent human evidence.**

FUNLABS is a harness for agents that build interactive experiences. It connects paid human playtests, evidence-backed agent work and version comparisons, so creators can decide what to change and what to preserve.

The product and implementation plan is in [FUNLABS.md](FUNLABS.md), written in Spanish. It covers the pitch, human and agent bounties, data contracts, design system, sponsor integrations, MVP and the judging plan. Section 17 records what is implemented and verified, and what is not. The technical guide is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

Working prototype, not a launched product.

- Implemented: Gravity Room (the demo game), tab-recording tester flow, creator lab, evidence desk with Gemini analysis, a bounded Claude intervention checked by a frozen suite, blind A/B comparison, results, private research export, a REST API and an MCP server for agents, Supabase schema with RLS.
- Verified by tests: 11 unit tests for checks and patch scope, 9 for evidence validation, 10 database privacy tests, 14 API and MCP integration tests, and two Playwright rehearsals of the full cycle.
- Not done: no real person has used it yet (all rehearsal material comes from bots and is labeled), payments are test mode only and Stripe is not integrated, Supabase Compute is not used, and no demo video exists.

## Run it

```bash
npm install
npx supabase start -x edge-runtime,vector,logflare,imgproxy,supavisor
npx supabase db reset
cp .env.example .env.local   # fill in keys; see docs/ARCHITECTURE.md for the backend identity
npm run dev
```

Tests: `npm test`, `npm run db:test`, `npx vitest run tests/integration`, `npm run test:e2e`.
