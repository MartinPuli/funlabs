<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FUNLABS notes for coding agents

- Product spec (Spanish): `FUNLABS.md`. Architecture and runbook: `docs/ARCHITECTURE.md`.
- Shared server code lives in `lib/` and uses explicit `.ts` import extensions so Node scripts can import it directly.
- Never put service keys or provider keys in the repo. Local secrets go in `.env.local` (gitignored).
- Testers and agents never get a database identity: they use scoped tokens against `/api/*`, and the backend acts as the worker identity.
- Gravity Room builds: only `@funlabs:editable` regions may change in an intervention. Checks in `lib/checks/suite.ts` are fixed per study.
