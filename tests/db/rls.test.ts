/**
 * Database guarantees, tested against the local Supabase stack
 * (`npx supabase start`). Skipped when the stack is not reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvLocal } from '../helpers/env.ts';

const env = loadEnvLocal();
const URL = env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const reachable = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON } }).then((r) => r.ok).catch(() => false);
const local = URL.includes('127.0.0.1') || URL.includes('localhost');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

describe.skipIf(!reachable || !local || !SERVICE)('row level security and integrity', () => {
  const admin = createClient(URL, SERVICE, opts);
  const tag = randomBytes(4).toString('hex');
  const pw = randomBytes(18).toString('base64url');
  let a: SupabaseClient, b: SupabaseClient, researcher: SupabaseClient, worker: SupabaseClient, anon: SupabaseClient;
  const ids: Record<string, string> = {};
  const users: string[] = [];

  beforeAll(async () => {
    for (const who of ['a', 'b', 'r']) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${who}-${tag}@funlabs.test`, password: pw, email_confirm: true });
      if (error) throw error;
      users.push(data.user.id);
      ids[`user_${who}`] = data.user.id;
    }
    const wpw = randomBytes(24).toString('base64url');
    const { data: w, error: we } = await admin.auth.admin.createUser({ email: `worker-${tag}@funlabs.test`, password: wpw, email_confirm: true, app_metadata: { funlabs_role: 'worker' } });
    if (we) throw we;
    users.push(w.user.id);
    a = await signedIn(`a-${tag}@funlabs.test`, pw);
    b = await signedIn(`b-${tag}@funlabs.test`, pw);
    researcher = await signedIn(`r-${tag}@funlabs.test`, pw);
    worker = await signedIn(`worker-${tag}@funlabs.test`, wpw);
    anon = createClient(URL, ANON, opts);

    // Creator A: product + study
    const p = await a.from('products').insert({ owner_id: ids.user_a, slug: `gr-${tag}`, name: 'Gravity Room' }).select().single();
    if (p.error) throw p.error;
    ids.product = p.data.id;
    const s = await a.from('studies').insert({
      product_id: ids.product, owner_id: ids.user_a, title: 'Clarity room 1',
      question: 'Do people understand what they can activate?', objective: 'clarity', audience: 'People who have not played before',
      protocol: { task: 'Play for two minutes' }, participants_target: 3, session_minutes: 3,
      budget_cap_cents: 1000, tester_payment_cents: 300,
    }).select().single();
    if (s.error) throw s.error;
    ids.study = s.data.id;
    const m = await a.from('study_members').insert({ study_id: ids.study, user_id: ids.user_r, role: 'researcher' });
    if (m.error) throw m.error;

    // Worker: version, bounty, invitation, assignment, session, feedback
    const v = await worker.from('versions').insert({ product_id: ids.product, label: 'A', origin: 'repository', content_sha256: 'a'.repeat(64), bytes: 10 }).select().single();
    if (v.error) throw v.error;
    ids.version = v.data.id;
    const bo = await worker.from('bounties').insert({ study_id: ids.study, kind: 'human_playtest', title: 'Play and explain', instructions: 'x', deliverable: 'y', criteria: [] }).select().single();
    if (bo.error) throw bo.error;
    ids.bounty = bo.data.id;
    const inv = await worker.from('invitations').insert({ study_id: ids.study, bounty_id: ids.bounty, token_hash: 'b'.repeat(64), token_hint: 'bbbb', expires_at: new Date(Date.now() + 86400000).toISOString() }).select().single();
    if (inv.error) throw inv.error;
    const asg = await worker.from('assignments').insert({ study_id: ids.study, bounty_id: ids.bounty, invitation_id: inv.data.id, participant_code: 'P-1' }).select().single();
    if (asg.error) throw asg.error;
    ids.assignment = asg.data.id;
    const ses = await worker.from('sessions').insert({ study_id: ids.study, assignment_id: ids.assignment, version_id: ids.version, phase: 'playtest', neutral_label: 'Version 1' }).select().single();
    if (ses.error) throw ses.error;
    ids.session = ses.data.id;
    const fb = await worker.from('feedback').insert({ study_id: ids.study, session_id: ids.session, assignment_id: ids.assignment, kind: 'moment', t_ms: 21000, body: 'I do not know which object I can activate' }).select().single();
    if (fb.error) throw fb.error;
    ids.feedback = fb.data.id;
    const rec = await worker.from('recordings').insert({ study_id: ids.study, session_id: ids.session, storage_path: `${ids.study}/${ids.session}/rec.webm`, mime_type: 'video/webm', method: 'tab_capture', duration_ms: 60000 }).select().single();
    if (rec.error) throw rec.error;
  });

  afterAll(async () => {
    if (ids.study) await admin.from('studies').delete().eq('id', ids.study);
    if (ids.version) await admin.from('versions').delete().eq('id', ids.version);
    if (ids.product) await admin.from('products').delete().eq('id', ids.product);
    for (const u of users) await admin.auth.admin.deleteUser(u);
  });

  it('anon cannot read any table', async () => {
    for (const t of ['studies', 'sessions', 'recordings', 'feedback', 'evidence', 'agent_credentials', 'invitations']) {
      const { data, error } = await anon.from(t).select('*').limit(1);
      expect(error !== null || (data ?? []).length === 0, `anon read ${t}`).toBe(true);
    }
  });

  it('another creator cannot see the study or its material', async () => {
    const { data: st } = await b.from('studies').select('id').eq('id', ids.study);
    expect(st).toEqual([]);
    const { data: fb } = await b.from('feedback').select('id').eq('study_id', ids.study);
    expect(fb).toEqual([]);
    const upd = await b.from('studies').update({ title: 'hijack' }).eq('id', ids.study).select();
    expect(upd.data ?? []).toEqual([]);
  });

  it('a researcher sees the study but not sessions, comments or recordings', async () => {
    const { data: st } = await researcher.from('studies').select('id').eq('id', ids.study);
    expect(st?.length).toBe(1);
    for (const t of ['sessions', 'feedback', 'recordings', 'game_events']) {
      const { data } = await researcher.from(t).select('id').eq('study_id', ids.study);
      expect(data, t).toEqual([]);
    }
  });

  it('copies the human statement verbatim from the cited comment', async () => {
    const ev = await worker.from('evidence').insert({
      study_id: ids.study, version_id: ids.version, session_id: ids.session, origin: 'model',
      interval_start_ms: 21000, interval_end_ms: 29000, observation: 'Tries to move forward several times.',
      human_statement: 'Text invented by the model', human_statement_feedback_id: ids.feedback,
      structural_status: 'verified',
    }).select().single();
    expect(ev.error).toBeNull();
    expect(ev.data.human_statement).toBe('I do not know which object I can activate');
    ids.evidence = ev.data.id;

    const bad = await worker.from('evidence').insert({
      study_id: ids.study, version_id: ids.version, session_id: ids.session, origin: 'model',
      interval_start_ms: 0, interval_end_ms: 1000, observation: 'No source', human_statement: 'quote without comment',
      structural_status: 'unsupported',
    });
    expect(bad.error?.message).toMatch(/needs the comment/);
  });

  it('keeps review history and never rewrites the finding', async () => {
    const r1 = await a.from('evidence_reviews').insert({ evidence_id: ids.evidence, study_id: ids.study, reviewer_id: ids.user_a, reviewer_kind: 'creator', action: 'correct', corrected: { hypothesis: 'The initial instruction lasts a short time' } });
    expect(r1.error).toBeNull();
    const { data: ev } = await a.from('evidence').select('review_status, current, hypothesis').eq('id', ids.evidence).single();
    expect(ev?.review_status).toBe('corrected');
    expect(ev?.current).toEqual({ hypothesis: 'The initial instruction lasts a short time' });
    const rewrite = await worker.from('evidence').update({ observation: 'something else' }).eq('id', ids.evidence);
    expect(rewrite.error?.message).toMatch(/is not rewritten/);
    const forged = await a.from('evidence_reviews').insert({ evidence_id: ids.evidence, study_id: ids.study, reviewer_id: ids.user_b, reviewer_kind: 'creator', action: 'confirm' });
    expect(forged.error).not.toBeNull();
  });

  it('fixes the protocol once the study leaves draft', async () => {
    const pub = await worker.from('studies').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', ids.study);
    expect(pub.error).toBeNull();
    const change = await a.from('studies').update({ objective: 'fun' }).eq('id', ids.study);
    expect(change.error?.message).toMatch(/are fixed when published/);
    const rename = await a.from('studies').update({ title: 'Clarity of room 1' }).eq('id', ids.study);
    expect(rename.error).toBeNull();
    const status = await a.from('studies').update({ status: 'completed' }).eq('id', ids.study);
    expect(status.error?.message).toMatch(/managed by FUNLABS/);
  });

  it('reserves budget atomically under the cap and is idempotent', async () => {
    const r1 = await worker.rpc('reserve_budget', { p_study: ids.study, p_kind: 'reservation', p_amount: 600, p_key: `t-${tag}-1` });
    expect(r1.data.ok).toBe(true);
    const again = await worker.rpc('reserve_budget', { p_study: ids.study, p_kind: 'reservation', p_amount: 600, p_key: `t-${tag}-1` });
    expect(again.data.duplicate).toBe(true);
    const over = await worker.rpc('reserve_budget', { p_study: ids.study, p_kind: 'reservation', p_amount: 600, p_key: `t-${tag}-2` });
    expect(over.data).toMatchObject({ ok: false, reason: 'budget_exhausted' });
    const creator = await a.rpc('reserve_budget', { p_study: ids.study, p_kind: 'reservation', p_amount: 1, p_key: `t-${tag}-3` });
    expect(creator.error).not.toBeNull();
    const { data: summary } = await a.rpc('study_budget', { p_study: ids.study });
    expect(summary).toMatchObject({ cap: 1000, reserved: 600, remaining: 400, test_mode: true });
  });

  it('claims each job once and retries with backoff', async () => {
    const key = `job-${tag}`;
    const ins = await worker.from('jobs').insert({ study_id: ids.study, kind: 'analyze_session', idempotency_key: key, input: { session_id: ids.session }, max_attempts: 2 }).select().single();
    expect(ins.error).toBeNull();
    const dup = await worker.from('jobs').insert({ study_id: ids.study, kind: 'analyze_session', idempotency_key: key, input: {} });
    expect(dup.error?.code).toBe('23505');
    const [c1, c2] = await Promise.all([
      worker.rpc('claim_job', { p_kinds: ['analyze_session'], p_worker: 'w1', p_runner: 'test' }),
      worker.rpc('claim_job', { p_kinds: ['analyze_session'], p_worker: 'w2', p_runner: 'test' }),
    ]);
    const claimed = [...(c1.data ?? []), ...(c2.data ?? [])].filter((j: { idempotency_key: string }) => j.idempotency_key === key);
    expect(claimed.length).toBe(1);
    const fail = await worker.rpc('finish_job', { p_job: ins.data.id, p_ok: false, p_result: null, p_error: 'Gemini did not respond' });
    expect(fail.data.status).toBe('queued');
    expect(new Date(fail.data.run_after).getTime()).toBeGreaterThan(Date.now());
    const asCreator = await a.rpc('claim_job', { p_kinds: ['analyze_session'], p_worker: 'x', p_runner: 'x' });
    expect(asCreator.error).not.toBeNull();
  });

  it('keeps comments and comparisons append-only', async () => {
    const upd = await worker.from('feedback').update({ body: 'edited' }).eq('id', ids.feedback);
    expect(upd.error?.message).toMatch(/append-only/);
  });

  it('lets creators stream their recordings but not other studies', async () => {
    const path = `${ids.study}/${ids.session}/rec.webm`;
    const up = await worker.storage.from('recordings').upload(path, new Blob([randomUUID()], { type: 'video/webm' }), { contentType: 'video/webm' });
    expect(up.error).toBeNull();
    const own = await a.storage.from('recordings').createSignedUrl(path, 60);
    expect(own.error).toBeNull();
    const other = await b.storage.from('recordings').createSignedUrl(path, 60);
    expect(other.error).not.toBeNull();
    const res = await researcher.storage.from('recordings').createSignedUrl(path, 60);
    expect(res.error).not.toBeNull();
    await worker.storage.from('recordings').remove([path]);
  });
});
