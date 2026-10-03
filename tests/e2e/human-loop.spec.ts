/**
 * Technical rehearsal of the human loop against a running app + local Supabase.
 * The study is flagged as a rehearsal and every comment is labeled as a test:
 * a bot run is a functional check, never human evidence.
 */
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvLocal } from '../helpers/env.ts';

const env = loadEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/lab$/);
}

async function playABit(page: Page) {
  const frame = page.frameLocator('iframe[title^="Game"]');
  await frame.locator('canvas').click();
  await page.waitForTimeout(500);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(800);
}

test('human loop: publish, invite, record, deliver, review', async ({ browser }) => {
  const email = `creator-${Date.now()}@funlabs.test`;
  const password = 'long-technical-rehearsal-123';
  const { data: user, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  let studyId = '';
  try {
    const creator = await browser.newContext();
    const page = await creator.newPage();
    await signIn(page, email, password);

    await page.getByRole('button', { name: 'Example study' }).click();
    await expect(page).toHaveURL(/\/lab\/studies\/[0-9a-f-]{36}$/);
    studyId = page.url().split('/').pop()!;
    const flag = await admin.from('studies').update({ is_rehearsal: true }).eq('id', studyId);
    expect(flag.error).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Publish the request' })).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Publish study' }).click();
    await expect(page.getByText('Study published. The checks are now fixed.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Invite people')).toBeVisible();

    await page.getByLabel('Count').fill('2');
    await page.getByRole('button', { name: 'Create links' }).click();
    const link = (await page.locator('code.token-reveal').first().textContent())!.trim();
    expect(link).toMatch(/\/t\/flt_/);

    // ---------------------------------------------------------------- tester
    const testerCtx = await browser.newContext({ permissions: ['microphone'] });
    const tp = await testerCtx.newPage();
    await tp.goto(link);
    await expect(tp.getByText('Technical rehearsal: this data does not count as a real study')).toBeVisible();
    await tp.getByRole('checkbox', { name: /Take part and record/ }).check();
    await tp.getByRole('checkbox', { name: /Contribute data to research/ }).check();
    await tp.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(tp.getByRole('heading', { name: 'Play and tell us' })).toBeVisible();

    await tp.getByRole('button', { name: 'Share tab and record' }).click();
    const recording = await tp.getByText('Recording the game tab.').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (recording) {
      await playABit(tp);
      await tp.getByLabel('Note a moment').fill('[technical rehearsal, not a person] I do not know which object I can activate');
      await tp.getByRole('button', { name: 'Add note', exact: true }).click();
      await expect(tp.getByText(/Comment noted at/)).toBeVisible();
      await playABit(tp);
      await tp.getByRole('button', { name: 'Stop and save' }).click();
    } else {
      // Capture refused in this environment: manual upload path with a recorded bot run.
      const dir = path.resolve('.scratch/botrec');
      const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.endsWith('.webm')) : undefined;
      test.skip(!file, 'No tab capture and no fallback video');
      await tp.locator('input[type=file]').setInputFiles(path.join(dir, file!));
    }
    await expect(tp.getByText('Recording saved.')).toBeVisible({ timeout: 60_000 });

    await tp.getByLabel('What did you enjoy?').fill('[technical rehearsal] rehearsal answer');
    await tp.getByLabel(/Where did you not know how to continue/).fill('[technical rehearsal] rehearsal answer');
    await tp.getByLabel('What would you change?').fill('[technical rehearsal] rehearsal answer');
    await tp.getByRole('button', { name: 'Submit playtest' }).click();
    await expect(tp.getByRole('heading', { name: 'Thanks for taking part' })).toBeVisible();

    // --------------------------------------------------------------- creator
    await page.reload();
    await expect(page.getByRole('cell', { name: 'P-1' })).toBeVisible();
    await expect(page.getByText(/Recording \d\d:\d\d/)).toBeVisible();

    const rec = await admin.from('recordings').select('status, duration_ms, bytes, method').eq('study_id', studyId).single();
    expect(rec.data?.status).toBe('verified');
    const events = await admin.from('game_events').select('id', { count: 'exact', head: true }).eq('study_id', studyId);
    expect(events.count ?? 0).toBeGreaterThan(3);

    // Valid delivery → test-mode payout recorded.
    await page.getByRole('button', { name: 'Valid', exact: true }).click();
    await expect(page.getByText(/Payout recorded in test mode/)).toBeVisible();

    await page.goto(`/lab/studies/${studyId}/evidence`);
    await expect(page.locator('video')).toBeVisible();
    await expect(page.getByText('Final answers')).toBeVisible();
    console.log(JSON.stringify({ studyId, recording: rec.data, events: events.count, captured: recording }));
  } finally {
    if (process.env.E2E_KEEP !== '1') {
      if (studyId) {
        const objs = await admin.storage.from('recordings').list(studyId, { limit: 100 });
        for (const folder of objs.data ?? []) {
          const inner = await admin.storage.from('recordings').list(`${studyId}/${folder.name}`);
          await admin.storage.from('recordings').remove((inner.data ?? []).map((o) => `${studyId}/${folder.name}/${o.name}`));
        }
        await admin.from('studies').delete().eq('id', studyId);
      }
      if (user?.user) await admin.auth.admin.deleteUser(user.user.id);
    }
  }
});
