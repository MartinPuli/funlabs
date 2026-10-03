import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { anthropic } from '@ai-sdk/anthropic';

/**
 * Agentic end-to-end tests (TesterArmy `e2e`). Steps written with
 * `agent.act` / `agent.assert` use Claude to drive the real interface; tests
 * written with locators need no model. Run with `npm run test:agentic`, which
 * creates a throwaway creator account and removes it afterwards.
 */
export default {
  agents: { default: { model: anthropic('claude-sonnet-5-5') } },
  targets: [{ engine: web(), app: { url: process.env.E2E_BASE_URL ?? 'http://localhost:3000' } }],
  credentials: {
    creator: {
      username: process.env.E2E_CREATOR_EMAIL ?? '',
      password: process.env.E2E_CREATOR_PASSWORD ?? '',
    },
  },
} satisfies E2EConfig;
