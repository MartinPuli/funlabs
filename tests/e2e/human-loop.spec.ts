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
  await page.goto('/entrar');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/lab$/);
}

async function playABit(page: Page) {
  const frame = page.frameLocator('iframe[title^="Juego"]');
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
  const email = `creador-${Date.now()}@funlabs.test`;
  const password = 'ensayo-tecnico-largo-123';
  const { data: user, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  let studyId = '';
  try {
    const creator = await browser.newContext();
    const page = await creator.newPage();
    await signIn(page, email, password);

    await page.getByRole('button', { name: 'Estudio de ejemplo' }).click();
    await expect(page).toHaveURL(/\/lab\/estudios\/[0-9a-f-]{36}$/);
    studyId = page.url().split('/').pop()!;
    const flag = await admin.from('studies').update({ is_rehearsal: true }).eq('id', studyId);
    expect(flag.error).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Publicar el encargo' })).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Publicar estudio' }).click();
    await expect(page.getByText('Estudio publicado. Las comprobaciones quedaron fijadas.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Invitar personas')).toBeVisible();

    await page.getByLabel('Cantidad').fill('2');
    await page.getByRole('button', { name: 'Crear enlaces' }).click();
    const link = (await page.locator('code.token-reveal').first().textContent())!.trim();
    expect(link).toMatch(/\/t\/flt_/);

    // ---------------------------------------------------------------- tester
    const testerCtx = await browser.newContext({ permissions: ['microphone'] });
    const tp = await testerCtx.newPage();
    await tp.goto(link);
    await expect(tp.getByText('Ensayo técnico: estos datos no cuentan como estudio real')).toBeVisible();
    await tp.getByRole('checkbox', { name: /Participar y grabar/ }).check();
    await tp.getByRole('checkbox', { name: /Aportar datos a investigación/ }).check();
    await tp.getByRole('button', { name: 'Aceptar y continuar' }).click();
    await expect(tp.getByRole('heading', { name: 'Jugá y contanos' })).toBeVisible();

    await tp.getByRole('button', { name: 'Compartir pestaña y grabar' }).click();
    const recording = await tp.getByText('Grabando la pestaña del juego.').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    if (recording) {
      await playABit(tp);
      await tp.getByLabel('Anotar un momento').fill('[prueba técnica, no es una persona] no sé qué objeto puedo activar');
      await tp.getByRole('button', { name: 'Anotar', exact: true }).click();
      await expect(tp.getByText(/Comentario anotado en/)).toBeVisible();
      await playABit(tp);
      await tp.getByRole('button', { name: 'Detener y guardar' }).click();
    } else {
      // Capture refused in this environment: manual upload path with a recorded bot run.
      const dir = path.resolve('.scratch/botrec');
      const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.endsWith('.webm')) : undefined;
      test.skip(!file, 'Sin captura de pestaña y sin video de respaldo');
      await tp.locator('input[type=file]').setInputFiles(path.join(dir, file!));
    }
    await expect(tp.getByText('Grabación guardada.')).toBeVisible({ timeout: 60_000 });

    await tp.getByLabel('¿Qué disfrutaste?').fill('[prueba técnica] respuesta de ensayo');
    await tp.getByLabel(/¿Dónde no supiste cómo seguir/).fill('[prueba técnica] respuesta de ensayo');
    await tp.getByLabel('¿Qué cambiarías?').fill('[prueba técnica] respuesta de ensayo');
    await tp.getByRole('button', { name: 'Enviar entrega' }).click();
    await expect(tp.getByRole('heading', { name: 'Gracias por participar' })).toBeVisible();

    // --------------------------------------------------------------- creator
    await page.reload();
    await expect(page.getByRole('cell', { name: 'P-1' })).toBeVisible();
    await expect(page.getByText(/Grabación \d\d:\d\d/)).toBeVisible();

    const rec = await admin.from('recordings').select('status, duration_ms, bytes, method').eq('study_id', studyId).single();
    expect(rec.data?.status).toBe('verified');
    const events = await admin.from('game_events').select('id', { count: 'exact', head: true }).eq('study_id', studyId);
    expect(events.count ?? 0).toBeGreaterThan(3);

    // Valid delivery → test-mode payout recorded.
    await page.getByRole('button', { name: 'Válida' }).click();
    await expect(page.getByText(/Pago registrado en modo prueba/)).toBeVisible();

    await page.goto(`/lab/estudios/${studyId}/evidencia`);
    await expect(page.locator('video')).toBeVisible();
    await expect(page.getByText('Respuestas finales')).toBeVisible();
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
