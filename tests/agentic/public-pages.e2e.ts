import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Deterministic checks (locators only): no model is called.

test('the landing page says what FUNLABS does and links to the lab and the game', async ({ app, screen, browser }) => {
  await app.open('/');
  await expect(browser).toHaveTitle(/FUNLABS/);
  await expect(screen.getByRole('heading', 'Give your agent human evidence')).toBeVisible();
  await expect(screen.getByRole('link', 'Open the lab')).toBeVisible();
  await expect(screen.getByRole('link', 'Play Gravity Room')).toBeVisible();
});

test('the status page reports each integration honestly', async ({ app, screen }) => {
  await app.open('/status');
  await expect(screen.getByRole('heading', 'Integration status')).toBeVisible();
  await expect(screen.getByText('Supabase Compute')).toBeVisible();
  await expect(screen.getByText('Not used').first()).toBeVisible();
});

test('the agent docs list the tools and the error contract', async ({ app, screen }) => {
  await app.open('/agents');
  await expect(screen.getByRole('heading', 'Tools for agents')).toBeVisible();
  await expect(screen.getByText('submit_agent_work').first()).toBeVisible();
  await expect(screen.getByText('approval_required').first()).toBeVisible();
});
