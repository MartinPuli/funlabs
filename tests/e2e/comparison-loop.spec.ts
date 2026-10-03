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
  await page.getByRole('button', { name: 'Compartir pestaña y grabar' }).click();
  await expect(page.getByText('Grabando la pestaña del juego.')).toBeVisible({ timeout: 15_000 });
  const frame = page.frameLocator('iframe[title^="Juego"]').last();
  await frame.locator('canvas').click();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Detener y guardar' }).click();
  await expect(page.getByText('Grabación guardada.')).toHaveCount(savedCount, { timeout: 60_000 });
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
  const email = `comparacion-${Date.now()}@funlabs.test`;
  const password = 'ensayo-tecnico-largo-123';
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
    const study = await createStudyDraft(userClient, worker, ownerId, { ...demoStudyInput(), title: 'Ensayo técnico del circuito A/B', participants_target: 1, budget_cap_cents: 3000 }, { isRehearsal: true });
    studyId = study.id;
    await publishStudy(worker, studyId, { via: 'ui' });
    const [invite] = await createInvitations(userClient, ownerId, studyId, 1);
    const link = `${BASE}/t/${invite.token}`;

    // ---- the person plays version A and delivers
    const tctx = await browser.newContext({ permissions: ['microphone'] });
    const tp = await tctx.newPage();
    await tp.goto(link);
    await tp.getByRole('checkbox', { name: /Participar y grabar/ }).check();
    await tp.getByRole('button', { name: 'Aceptar y continuar' }).click();
    await expect(tp.getByRole('heading', { name: 'Jugá y contanos' })).toBeVisible();
    await recordAndPlay(tp, 'A', 1);
    for (const q of ['¿Qué disfrutaste?', /¿Dónde no supiste cómo seguir/, '¿Qué cambiarías?']) await tp.getByLabel(q).fill('[prueba técnica] respuesta de ensayo');
    await tp.getByRole('button', { name: 'Enviar entrega' }).click();
    await expect(tp.getByRole('heading', { name: 'Gracias por participar' })).toBeVisible();

    // ---- the creator's agent changes only the presentation; fixed checks decide
    const res = await materializeIntervention(worker, {
      studyId,
      baseVersionId: versionA.id,
      actor: 'Ensayo técnico',
      objective: 'clarity',
      proposal: { summary: 'El LED apagado se ve naranja.', rationale: 'Ensayo técnico del circuito.', evidence_ids: [], preserve: 'Niveles y física.', edits: [{ find: 'ctx.fillStyle = on ? palette.ledOn : palette.ledOff;', replace: "ctx.fillStyle = on ? palette.ledOn : '#ffb347';" }] },
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
    await expect(tp.getByRole('heading', { name: 'Compará dos versiones' })).toBeVisible();
    const first = tp.getByRole('heading', { level: 2 }).filter({ hasText: /Versión (Ámbar|Celeste)/ }).first();
    await expect(first).toBeVisible();
    expect(await tp.content()).not.toMatch(/versión [AB]\b|naranja|ffb347/i);
    await recordAndPlay(tp, 'first', 1);
    await expect(tp.getByRole('button', { name: 'Compartir pestaña y grabar' })).toBeVisible();
    await recordAndPlay(tp, 'second', 2);
    await tp.getByRole('radio', { name: 'Sin preferencia' }).check();
    await tp.getByLabel('¿Por qué?').fill('[prueba técnica] no noté diferencias');
    await tp.getByRole('button', { name: 'Enviar comparación' }).click();
    await expect(tp.getByRole('heading', { name: 'Gracias por participar' })).toBeVisible();

    // ---- the creator sees honest results after a reload
    const cctx = await browser.newContext();
    const cp = await cctx.newPage();
    await cp.goto(`${BASE}/entrar`);
    await cp.getByLabel('Correo').fill(email);
    await cp.getByLabel('Contraseña', { exact: true }).fill(password);
    await cp.getByRole('button', { name: 'Entrar' }).click();
    await expect(cp).toHaveURL(/\/lab$/);
    await cp.goto(`${BASE}/lab/estudios/${studyId}/comparacion`);
    await expect(cp.getByText(/Con una muestra de 1 persona/)).toBeVisible();
    await expect(cp.getByText('Sin preferencia').first()).toBeVisible();
    await expect(cp.getByText(/Muestra de 1 persona: describe lo que pasó en esta prueba/)).toBeVisible();
    await expect(cp.getByText('[prueba técnica] no noté diferencias')).toBeVisible();

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
