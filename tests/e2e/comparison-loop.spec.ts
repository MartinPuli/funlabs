/**
 * Rehearsal of the second half of the cycle: variant → checks → blind A/B with
 * recordings → results. Everything is a labeled technical rehearsal (bot), not
 * human evidence, and is removed afterwards unless E2E_KEEP=1.
 */
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from '../helpers/env.ts';

const fileEnv = loadEnvLocal();
for (const [k, v] of Object.entries(fileEnv)) if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

async function recordAndPlay(page: Page, label: string, savedCount: number) {
  await page.getByRole('button', { name: 'Share tab and record' }).click();
  await expect(page.getByText('Recording the game tab.')).toBeVisible({ timeout: 15_000 });
  const frame = page.frameLocator('iframe[title^="Game"]').last();
  await frame.locator('canvas').click();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop and save' }).click();
  await expect(page.getByText('Recording saved.')).toHaveCount(savedCount, { timeout: 60_000 });
  void label;
}

test('comparison loop: variant passes checks, blind A/B, results', async ({ browser }) => {
  const { newToken: _n } = await import('../../lib/tokens.ts');
  void _n;
  const { workerClient } = await import('../../lib/supabase/worker.ts');
  const { ensureGravityRoomProduct, createStudyDraft, demoStudyInput, publishStudy, createInvitations } = await import('../../lib/studies.ts');
  const { materializeIntervention } = await import('../../lib/intervention/run.ts');
  const { runJobs } = await import('../../lib/jobs.ts');

  const worker = await workerClient();
  const email = `comparison-${Date.now()}@funlabs.test`;
  const password = 'long-technical-rehearsal-123';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  const ownerId = created.data.user!.id;
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  await userClient.auth.signInWithPassword({ email, password });
  let studyId = '';
  let productId = '';
  try {
    const { product, versionA } = await ensureGravityRoomProduct(userClient, worker, ownerId);
    productId = product.id;
    const study = await createStudyDraft(userClient, worker, ownerId, { ...demoStudyInput(), title: 'Technical rehearsal of the A/B circuit', participants_target: 1, budget_cap_cents: 3000 }, { isRehearsal: true });
    studyId = study.id;
    await publishStudy(worker, studyId, { via: 'ui' });
    const [invite] = await createInvitations(userClient, ownerId, studyId, 1);
    const link = `${BASE}/t/${invite.token}`;

    // ---- the person plays version A and delivers
    const tctx = await browser.newContext({ permissions: ['microphone'] });
    const tp = await tctx.newPage();
    await tp.goto(link);
    await tp.getByRole('checkbox', { name: /Take part and record/ }).check();
    await tp.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(tp.getByRole('heading', { name: 'Play and tell us' })).toBeVisible();
    await recordAndPlay(tp, 'A', 1);
    for (const q of ['What did you enjoy?', /Where did you not know how to continue/, 'What would you change?']) await tp.getByLabel(q).fill('[technical rehearsal] rehearsal answer');
    await tp.getByRole('button', { name: 'Submit playtest' }).click();
    await expect(tp.getByRole('heading', { name: 'Thanks for taking part' })).toBeVisible();

    // ---- the creator's agent changes only the presentation; fixed checks decide
    const res = await materializeIntervention(worker, {
      studyId,
      baseVersionId: versionA.id,
      actor: 'Technical rehearsal',
      objective: 'clarity',
      proposal: { summary: 'The unlit LED looks orange.', rationale: 'Technical rehearsal of the circuit.', evidence_ids: [], preserve: 'Levels and physics.', edits: [{ find: 'ctx.fillStyle = on ? palette.ledOn : palette.ledOff;', replace: "ctx.fillStyle = on ? palette.ledOn : '#ffb347';" }] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (let i = 0; i < 30; i++) {
      const v = await worker.from('versions').select('status').eq('id', res.versionId).single();
      if (v.data?.status !== 'checking') break;
      await runJobs(worker, { kinds: ['run_checks'], maxJobs: 3, deadlineMs: 60_000 });
      await new Promise((r) => setTimeout(r, 500));
    }
    expect((await worker.from('versions').select('status').eq('id', res.versionId).single()).data?.status).toBe('ready');
    const failed = await worker.from('checks').select('check_key, status').eq('version_id', res.versionId).neq('status', 'passed');
    expect(failed.data).toEqual([]);
    expect((await worker.from('studies').update({ status: 'comparing' }).eq('id', studyId)).error).toBeNull();

    // ---- blind comparison: neutral names, order set by the participant's seed
    await tp.reload();
    await expect(tp.getByRole('heading', { name: 'Compare two versions' })).toBeVisible();
    const first = tp.getByRole('heading', { level: 2 }).filter({ hasText: /(Amber|Sky) version/ }).first();
    await expect(first).toBeVisible();
    expect(await tp.content()).not.toMatch(/version [AB]\b|orange|ffb347/i);
    await recordAndPlay(tp, 'first', 1);
    await expect(tp.getByRole('button', { name: 'Share tab and record' })).toBeVisible();
    await recordAndPlay(tp, 'second', 2);
    await tp.getByRole('radio', { name: 'No preference' }).check();
    await tp.getByLabel('Why?').fill('[technical rehearsal] I noticed no differences');
    await tp.getByRole('button', { name: 'Submit comparison' }).click();
    await expect(tp.getByRole('heading', { name: 'Thanks for taking part' })).toBeVisible();

    // ---- the creator sees honest results after a reload
    const cctx = await browser.newContext();
    const cp = await cctx.newPage();
    await cp.goto(`${BASE}/sign-in`);
    await cp.getByLabel('Email').fill(email);
    await cp.getByLabel('Password', { exact: true }).fill(password);
    await cp.getByRole('button', { name: 'Sign in' }).click();
    await expect(cp).toHaveURL(/\/lab$/);
    await cp.goto(`${BASE}/lab/studies/${studyId}/comparison`);
    await expect(cp.getByText(/With a sample of 1 person/)).toBeVisible();
    await expect(cp.getByText('No preference').first()).toBeVisible();
    await expect(cp.getByText(/Sample of 1 person: it describes what happened in this test/)).toBeVisible();
    await expect(cp.getByText('[technical rehearsal] I noticed no differences')).toBeVisible();

    const cmp = await worker.from('comparisons').select('choice, first_label, second_label, preferred_version_id, prior_exposure').eq('study_id', studyId);
    expect(cmp.data).toHaveLength(1);
    expect(cmp.data![0]).toMatchObject({ choice: 'none', preferred_version_id: null, prior_exposure: true });
    const sess = await worker.from('sessions').select('phase, neutral_label, recordings(status)').eq('study_id', studyId);
    expect(sess.data!.filter((s) => s.phase === 'comparison')).toHaveLength(2);
    const budget = await worker.rpc('study_budget', { p_study: studyId });
    expect(budget.data.reserved).toBe(1000); // playtest + comparison reserved, nothing paid until a person validates
    console.log(JSON.stringify({ studyId, labels: cmp.data![0], budget: budget.data }));
  } finally {
    if (process.env.E2E_KEEP !== '1') {
      if (studyId) {
        const top = await admin.storage.from('recordings').list(studyId, { limit: 100 });
        for (const f of top.data ?? []) {
          const inner = await admin.storage.from('recordings').list(`${studyId}/${f.name}`);
          await admin.storage.from('recordings').remove((inner.data ?? []).map((o) => `${studyId}/${f.name}/${o.name}`));
        }
        await admin.from('studies').delete().eq('id', studyId);
      }
      if (productId) {
        await admin.from('versions').delete().eq('product_id', productId);
        await admin.from('products').delete().eq('id', productId);
      }
      await admin.auth.admin.deleteUser(ownerId);
    }
  }
});
