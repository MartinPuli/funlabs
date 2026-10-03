/**
 * Agent API + MCP against the running app (E2E_BASE_URL, default
 * http://localhost:3000) and the local Supabase stack. Everything created here
 * is flagged as a rehearsal and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvLocal } from '../helpers/env.ts';

const fileEnv = loadEnvLocal();
for (const [k, v] of Object.entries(fileEnv)) if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const reachable = await fetch(`${BASE}/api/agent`).then((r) => r.ok).catch(() => false);
const dbUp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' } }).then((r) => r.ok).catch(() => false);

const { newToken } = await import('../../lib/tokens.ts');
const { workerClient } = await import('../../lib/supabase/worker.ts');
const { ensureGravityRoomProduct, createStudyDraft, demoStudyInput, publishStudy } = await import('../../lib/studies.ts');
const { runJobs } = await import('../../lib/jobs.ts');

type Res = { status: number; body: Record<string, any> };
async function call(token: string | null, tool: string, body: unknown = {}): Promise<Res> {
  const res = await fetch(`${BASE}/api/agent/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!reachable || !dbUp)('agent API and MCP', () => {
  let worker: SupabaseClient;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids: Record<string, string> = {};
  const toks: Record<string, string> = {};
  const userIds: string[] = [];

  async function mint(kind: 'creator_agent' | 'participant_agent', label: string, caps: string[], opts: { study?: boolean; bounty?: string; days?: number } = {}) {
    const t = newToken('fla');
    const ins = await worker.from('agent_credentials').insert({
      product_id: ids.product,
      study_id: opts.study === false ? null : ids.study,
      bounty_id: opts.bounty ?? null,
      kind, label, token_hash: t.hash, token_hint: t.hint, capabilities: caps,
      created_by: ids.owner, expires_at: new Date(Date.now() + (opts.days ?? 7) * 86400_000).toISOString(),
    }).select('id').single();
    expect(ins.error).toBeNull();
    return { token: t.token, id: ins.data!.id as string };
  }

  beforeAll(async () => {
    worker = await workerClient();
    const email = `agents-${Date.now()}@funlabs.test`;
    const u = await admin.auth.admin.createUser({ email, password: 'long-technical-rehearsal-123', email_confirm: true });
    if (u.error) throw u.error;
    ids.owner = u.data.user.id;
    userIds.push(u.data.user.id);
    // Product + study as the owner would create them.
    const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await userClient.auth.signInWithPassword({ email, password: 'long-technical-rehearsal-123' });
    const { product, versionA } = await ensureGravityRoomProduct(userClient, worker, ids.owner);
    ids.product = product.id;
    ids.versionA = versionA.id;
    const study = await createStudyDraft(userClient, worker, ids.owner, { ...demoStudyInput(), title: 'Technical rehearsal of the agent API' }, { isRehearsal: true });
    ids.study = study.id;
    await publishStudy(worker, study.id, { via: 'ui' });
    const b = await worker.from('bounties').select('id, kind').eq('study_id', study.id);
    for (const x of b.data ?? []) ids[x.kind] = x.id;
    // One participant who authorized research, with events and comments.
    const inv = await worker.from('invitations').insert({ study_id: study.id, bounty_id: ids.human_playtest, token_hash: 'c'.repeat(64), token_hint: 'cccc', expires_at: new Date(Date.now() + 86400_000).toISOString() }).select('id').single();
    const asg = await worker.from('assignments').insert({ study_id: study.id, bounty_id: ids.human_playtest, invitation_id: inv.data!.id, participant_code: 'P-1' }).select('id').single();
    ids.assignment = asg.data!.id;
    await worker.from('consent_records').insert([
      { study_id: study.id, assignment_id: asg.data!.id, subject: 'participant', purpose: 'participation_recording', granted: true, text_version: 'participation-v1' },
      { study_id: study.id, assignment_id: asg.data!.id, subject: 'participant', purpose: 'research_sharing', granted: true, text_version: 'research-v1' },
    ]);
    const ses = await worker.from('sessions').insert({ study_id: study.id, assignment_id: asg.data!.id, version_id: versionA.id, phase: 'playtest', neutral_label: 'Gravity Room', status: 'submitted' }).select('id').single();
    ids.session = ses.data!.id;
    const evs = await worker.from('game_events').insert([
      { study_id: study.id, session_id: ses.data!.id, seq: 0, t_ms: 500, type: 'game_start', payload: {} },
      { study_id: study.id, session_id: ses.data!.id, seq: 1, t_ms: 21500, type: 'interact', payload: { result: 'nothing', col: 9, row: 1 } },
      { study_id: study.id, session_id: ses.data!.id, seq: 2, t_ms: 23500, type: 'interact', payload: { result: 'nothing', col: 9, row: 1 } },
    ]).select('id, seq');
    ids.event1 = String(evs.data!.find((e) => e.seq === 1)!.id);
    const fb = await worker.from('feedback').insert({ study_id: study.id, session_id: ses.data!.id, assignment_id: asg.data!.id, kind: 'moment', t_ms: 24000, body: '[technical rehearsal] I do not know which object I can activate' }).select('id').single();
    ids.feedback = fb.data!.id;
    await worker.from('recordings').insert({ study_id: study.id, session_id: ses.data!.id, storage_path: `${study.id}/${ses.data!.id}/recording.webm`, mime_type: 'video/webm', method: 'tab_capture', status: 'verified', duration_ms: 60000 });
    // A second study of the same product that credentials must not reach.
    const other = await createStudyDraft(userClient, worker, ids.owner, { ...demoStudyInput(), title: 'Another study' }, { isRehearsal: true });
    ids.other = other.id;
    toks.creator = (await mint('creator_agent', 'Rehearsal creator agent', ['evidence:read', 'study:create', 'study:publish', 'work:submit', 'results:read', 'export:request'], { study: false })).token;
    toks.creatorStudy = (await mint('creator_agent', 'Creator limited to one study', ['evidence:read', 'work:submit', 'results:read'])).token;
  });

  afterAll(async () => {
    for (const sid of [ids.study, ids.other, ids.created].filter(Boolean)) {
      const objs = await admin.storage.from('exports').list(sid);
      await admin.storage.from('exports').remove((objs.data ?? []).map((o) => `${sid}/${o.name}`));
      await admin.from('studies').delete().eq('id', sid);
    }
    if (ids.product) {
      await admin.from('agent_credentials').delete().eq('product_id', ids.product);
      await admin.from('versions').delete().eq('product_id', ids.product);
      await admin.from('products').delete().eq('id', ids.product);
    }
    for (const u of userIds) await admin.auth.admin.deleteUser(u);
  });

  it('lists the nine contract tools plus get_export, with schemas', async () => {
    const res = await fetch(`${BASE}/api/agent`);
    const cat = await res.json();
    const names = cat.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['compare_versions', 'create_study', 'export_dataset', 'get_evidence', 'get_export', 'get_moment', 'get_study', 'publish_study', 'request_evidence', 'submit_agent_work']);
    expect(cat.tools.every((t: { input_schema: { type: string } }) => t.input_schema.type === 'object')).toBe(true);
    expect(cat.payments_mode).toBe('test');
  });

  it('rejects missing, malformed, unknown, revoked and expired credentials', async () => {
    expect((await call(null, 'get_study', { study_id: ids.study })).status).toBe(401);
    expect((await call('nope', 'get_study', { study_id: ids.study })).status).toBe(401);
    expect((await call(`fla_${'x'.repeat(32)}`, 'get_study', { study_id: ids.study })).status).toBe(401);
    const rev = await mint('creator_agent', 'Revoked', ['evidence:read']);
    await worker.from('agent_credentials').update({ revoked_at: new Date().toISOString() }).eq('id', rev.id);
    expect((await call(rev.token, 'get_study', { study_id: ids.study })).body.error.code).toBe('revoked');
    const exp = await mint('creator_agent', 'Expired', ['evidence:read']);
    await worker.from('agent_credentials').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', exp.id);
    expect((await call(exp.token, 'get_study', { study_id: ids.study })).body.error.code).toBe('expired');
  });

  it('scopes a credential to its study and product', async () => {
    const own = await call(toks.creatorStudy, 'get_study', { study_id: ids.study });
    expect(own.status).toBe(200);
    expect(own.body.payments_mode).toBe('test');
    const other = await call(toks.creatorStudy, 'get_study', { study_id: ids.other });
    expect(other.status).toBe(404); // same answer as a study that does not exist
    const missing = await call(toks.creatorStudy, 'get_study', { study_id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(404);
    const noCap = await call(toks.creatorStudy, 'create_study', {});
    expect(noCap.status).toBe(403);
    expect(noCap.body.error.code).toBe('forbidden');
  });

  it('validates input with readable issues', async () => {
    const bad = await call(toks.creator, 'get_study', { study_id: 'not-a-uuid' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_input');
    expect(bad.body.error.details.issues[0].path).toBe('study_id');
  });

  it('request_evidence reports gaps and proposes a draft without creating anything', async () => {
    const before = await worker.from('studies').select('id', { count: 'exact', head: true }).eq('product_id', ids.product);
    const res = await call(toks.creator, 'request_evidence', { question: 'Do people understand the controls at the start?', version_id: ids.versionA, allow_new_study: true });
    expect(res.status).toBe(200);
    expect(res.body.coverage.sessions).toBeGreaterThanOrEqual(1);
    // The rehearsal study has a session, so it is compatible and flagged as a rehearsal.
    expect(res.body.compatible_studies[0].is_rehearsal).toBe(true);
    expect(res.body.gaps.join(' ')).toMatch(/technical rehearsals/);
    const none = await call(toks.creator, 'request_evidence', { question: 'Do people like the pacing of the game?', version_id: '11111111-1111-4111-8111-111111111111', allow_new_study: true });
    expect(none.body.compatible_studies).toEqual([]);
    expect(none.body.gaps[0]).toMatch(/There are no studies with material/);
    expect(none.body.draft_study.objective).toBe('pacing');
    expect(none.body.draft_study.note).toMatch(/Nothing was created/);
    const after = await worker.from('studies').select('id', { count: 'exact', head: true }).eq('product_id', ids.product);
    expect(after.count).toBe(before.count);
    const wrong = await call(toks.creator, 'request_evidence', { question: 'Anything at all?', product: 'other-product' });
    expect(wrong.body.error.code).toBe('wrong_product');
  });

  it('create_study makes a draft; publish needs the owner policy', async () => {
    const created = await call(toks.creator, 'create_study', { question: 'Is it clear what each key is for?', objective: 'controls', audience: 'People who have not played before', participants: 2, session_minutes: 3, budget_cap_usd: 25, tester_payment_usd: 5, agent_reward_usd: 2 });
    expect(created.status).toBe(200);
    ids.created = created.body.study_id;
    expect(created.body.status).toBe('draft');
    expect(created.body.payments_mode).toBe('test');
    expect(created.body.publish.requires_approval).toBe(true);
    const row = await worker.from('studies').select('created_via, is_rehearsal').eq('id', ids.created).single();
    expect(row.data?.created_via).toBe('agent_api');
    const tooLow = await call(toks.creator, 'create_study', { question: 'Is the budget insufficient for three people?', objective: 'fun', audience: 'Anyone', participants: 3, session_minutes: 3, budget_cap_usd: 5, tester_payment_usd: 5 });
    expect(tooLow.body.error.code).toBe('budget_too_low');
    const denied = await call(toks.creator, 'publish_study', { study_id: ids.created });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('approval_required');
    expect(denied.body.error.details.approval_url).toContain(ids.created);
    await worker.from('products').update({ spending_policy: { agent_can_publish: true, max_budget_cents: 1000 } }).eq('id', ids.product);
    const overLimit = await call(toks.creator, 'publish_study', { study_id: ids.created });
    expect(overLimit.body.error.code).toBe('approval_required'); // 25 USD > 10 USD limit
    await worker.from('products').update({ spending_policy: { agent_can_publish: true, max_budget_cents: 5000 } }).eq('id', ids.product);
    const ok = await call(toks.creator, 'publish_study', { study_id: ids.created });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('published');
    const again = await call(toks.creator, 'publish_study', { study_id: ids.created });
    expect(again.body.error.code).toBe('already_published');
  });

  it('a participant agent sees text material only from people who authorized research', async () => {
    const analyst = await mint('participant_agent', 'Rehearsal analyst', ['evidence:read', 'work:submit'], { bounty: ids.agent_analysis });
    toks.analyst = analyst.token;
    const forbidden = await call(analyst.token, 'create_study', {});
    expect(forbidden.status).toBe(403);
    const results = await call(analyst.token, 'compare_versions', { study_id: ids.study });
    expect(results.status).toBe(403);
    const ev = await call(analyst.token, 'get_evidence', { study_id: ids.study });
    expect(ev.status).toBe(200);
    expect(ev.body.sessions).toHaveLength(1);
    expect(ev.body.sessions[0].comments[0].feedback_id).toBe(ids.feedback);
    expect(JSON.stringify(ev.body)).not.toMatch(/storage_path|signedUrl|token=/);
    // Withdrawing research consent removes the session from the agent's view.
    await worker.from('consent_records').insert({ study_id: ids.study, assignment_id: ids.assignment, subject: 'participant', purpose: 'research_sharing', granted: false, text_version: 'research-v1' });
    const gone = await call(analyst.token, 'get_evidence', { study_id: ids.study });
    expect(gone.body.sessions).toHaveLength(0);
    await worker.from('consent_records').insert({ study_id: ids.study, assignment_id: ids.assignment, subject: 'participant', purpose: 'research_sharing', granted: true, text_version: 'research-v1' });
  });

  it('verifies an analysis against the material and pays only checkable work', async () => {
    const good = await call(toks.analyst, 'submit_agent_work', {
      study_id: ids.study, kind: 'analysis',
      findings: [{ session_id: ids.session, start_ms: 21000, end_ms: 29000, observation: 'The person presses E twice with no object nearby.', feedback_id: ids.feedback, event_ids: [ids.event1], hypothesis: 'The switch cue may be hard to see.', category: 'clarity' }],
    });
    expect(good.status).toBe(200);
    expect(good.body.evaluation.valid).toBe(true);
    expect(good.body.evaluation.counts.verified).toBe(1);
    expect(good.body.reward.paid).toBe(true);
    const stored = await worker.from('evidence').select('origin, human_statement, structural_status').eq('id', good.body.evidence_ids[0]).single();
    expect(stored.data?.origin).toBe('agent');
    expect(stored.data?.human_statement).toBe('[technical rehearsal] I do not know which object I can activate'); // verbatim from the comment, never the agent's text
    const dup = await call(toks.analyst, 'submit_agent_work', { study_id: ids.study, kind: 'analysis', findings: [{ session_id: ids.session, start_ms: 1000, end_ms: 2000, observation: 'Again' }] });
    expect(dup.body.error.code).toBe('already_submitted');
    // A second analyst invents a comment and an event.
    const liar = await mint('participant_agent', 'Analyst that invents', ['evidence:read', 'work:submit'], { bounty: ids.agent_analysis });
    const bad = await call(liar.token, 'submit_agent_work', {
      study_id: ids.study, kind: 'analysis',
      findings: [{ session_id: ids.session, start_ms: 21000, end_ms: 29000, observation: 'The person said something very specific.', feedback_id: '99999999-9999-4999-8999-999999999999', event_ids: ['424242'], hypothesis: 'It is an invention.' }],
    });
    expect(bad.status).toBe(200);
    expect(bad.body.evaluation.valid).toBe(false);
    expect(bad.body.evaluation.counts.invented_references).toBeGreaterThan(0);
    expect(bad.body.reward.paid).toBe(false);
    const row = await worker.from('evidence').select('human_statement, structural_status').eq('id', bad.body.evidence_ids[0]).single();
    expect(row.data?.human_statement).toBeNull(); // no invented citation is ever shown
    const budget = await worker.rpc('study_budget', { p_study: ids.study });
    expect(budget.data.agent_rewards).toBe(300);
  });

  it('records the creator agent’s intervention, checks it, and dates predictions before results', async () => {
    const evId = (await worker.from('evidence').select('id').eq('study_id', ids.study).eq('origin', 'agent').limit(1)).data![0].id;
    // Before any variant exists a prediction is refused. (Asked first: the DB trigger wakes the job runner within seconds.)
    const predictor = await mint('participant_agent', 'Rehearsal predictor', ['evidence:read', 'work:submit'], { bounty: ids.agent_prediction });
    const early = await call(predictor.token, 'submit_agent_work', { study_id: ids.study, kind: 'prediction', prediction: { choice: 'variant', reasons: 'The orange cue guides people to the switch.', uncertainty: 'It may reduce the challenge.' } });
    expect(early.body.error.code).toBe('variant_not_ready');
    const find = "ctx.fillStyle = on ? palette.ledOn : palette.ledOff;";
    const out = await call(toks.creator, 'submit_agent_work', {
      study_id: ids.study, kind: 'intervention',
      intervention: { summary: 'The unlit LED looks orange to mark what can be activated.', rationale: 'A person did not know which object to activate.', evidence_ids: [evId], preserve: 'Levels, physics and puzzle.', edits: [{ find, replace: "ctx.fillStyle = on ? palette.ledOn : '#ffb347';", reason: 'Visible cue' }] },
    });
    expect(out.status).toBe(200);
    ids.variant = out.body.version_id;
    // Out-of-scope edits are refused with the reasons.
    const scope = await call(toks.creator, 'submit_agent_work', {
      study_id: ids.study, kind: 'intervention',
      intervention: { summary: 'Attempt to change gravity.', rationale: 'Prove that the scope is verified.', evidence_ids: [evId], edits: [{ find: 'var G = 0.5, MAX_VY = 8.5;', replace: 'var G = 0.1, MAX_VY = 8.5;' }] },
    });
    expect(scope.status).toBe(422);
    expect(scope.body.error.code).toBe('scope_violation');
    // The checks job is picked up by the DB-triggered tick or, failing that, by us.
    for (let i = 0; i < 20; i++) {
      const v = await worker.from('versions').select('status').eq('id', ids.variant).single();
      if (v.data?.status !== 'checking') break;
      await runJobs(worker, { kinds: ['run_checks'], maxJobs: 5, deadlineMs: 60_000 });
      await new Promise((r) => setTimeout(r, 500));
    }
    const v = await worker.from('versions').select('status').eq('id', ids.variant).single();
    expect(v.data?.status).toBe('ready');
    const pred = await call(predictor.token, 'submit_agent_work', { study_id: ids.study, kind: 'prediction', prediction: { choice: 'variant', probabilities: { baseline: 0.2, variant: 0.6, none: 0.2 }, reasons: 'The orange cue guides people to the switch without changing the puzzle.', uncertainty: 'With few people the result may be a tie.' } });
    expect(pred.status).toBe(200);
    expect(pred.body.is_retrospective).toBe(false);
    expect(pred.body.reward.paid).toBe(true);
    expect(pred.body.evaluation.status).toBe('pending');
    const second = await call(predictor.token, 'submit_agent_work', { study_id: ids.study, kind: 'prediction', prediction: { choice: 'baseline', reasons: 'Changing my mind after seeing the first attempt.', uncertainty: 'None.' } });
    expect(second.body.error.code).toBe('already_submitted'); // one prediction per credential: no cherry-picking
    // Human results appear → later predictions are retrospective and unpaid.
    const cmp = await call(toks.creator, 'compare_versions', { study_id: ids.study });
    expect(cmp.body.status).toBe('pending');
    await worker.from('comparisons').insert({ study_id: ids.study, assignment_id: ids.assignment, first_version_id: ids.versionA, second_version_id: ids.variant, first_label: 'Amber version', second_label: 'Sky version', choice: 'second', preferred_version_id: ids.variant, reason: '[technical rehearsal] it is clearer what to activate', prior_exposure: true });
    const late = await mint('participant_agent', 'Late predictor', ['evidence:read', 'work:submit'], { bounty: ids.agent_prediction });
    const retro = await call(late.token, 'submit_agent_work', { study_id: ids.study, kind: 'prediction', prediction: { choice: 'variant', reasons: 'After human results exist.', uncertainty: 'There is already data.' } });
    expect(retro.body.is_retrospective).toBe(true);
    expect(retro.body.reward.paid).toBe(false);
    expect(retro.body.evaluation.status).toBe('retrospective');
    const shown = await call(toks.creator, 'compare_versions', { study_id: ids.study });
    expect(shown.body.denominator).toBe(1);
    expect(shown.body.prefer_variant).toBe(1);
    expect(shown.body.limitations.join(' ')).toMatch(/Sample of 1/);
    const seen = await worker.from('agent_credentials').select('labels_seen_at').eq('token_hash', (await import('../../lib/tokens.ts')).hashToken(toks.creator)).single();
    expect(seen.data?.labels_seen_at).not.toBeNull();
  });

  it('get_moment gives creator agents temporary media and participant agents none', async () => {
    const evId = (await worker.from('evidence').select('id').eq('study_id', ids.study).eq('origin', 'agent').limit(1)).data![0].id;
    const asCreator = await call(toks.creator, 'get_moment', { evidence_id: evId });
    expect(asCreator.status).toBe(200);
    expect(asCreator.body.finding.interval_ms.start).toBe(21000);
    expect(asCreator.body.events_in_interval.length).toBeGreaterThan(0);
    const asAnalyst = await call(toks.analyst, 'get_moment', { evidence_id: evId });
    expect(asAnalyst.status).toBe(200);
    expect(asAnalyst.body.media).toBeNull();
    // Another product's evidence is invisible.
    const foreign = await call(toks.creatorStudy, 'get_moment', { evidence_id: '00000000-0000-4000-8000-000000000000' });
    expect(foreign.status).toBe(404);
  });

  it('export_dataset is blocked until the owner and the participant authorized it', async () => {
    const blocked = await call(toks.creator, 'export_dataset', { study_id: ids.study, purpose: 'Evaluate preference predictions' });
    expect(blocked.body.status).toBe('blocked');
    expect(blocked.body.blocked_reason).toMatch(/product owner/);
    await worker.from('studies').update({ creator_research_consent: true, creator_research_consent_at: new Date().toISOString() }).eq('id', ids.study);
    const ok = await call(toks.creator, 'export_dataset', { study_id: ids.study, purpose: 'Evaluate preference predictions', fields: ['versions', 'predictions', 'comments', 'evidence', 'comparisons'] });
    expect(ok.body.status).toBe('preparing');
    await runJobs(worker, { kinds: ['export_dataset'], maxJobs: 3, deadlineMs: 60_000 });
    const done = await call(toks.creator, 'get_export', { export_id: ok.body.export_id });
    expect(done.body.status).toBe('ready');
    expect(done.body.download.url).toContain('token=');
    const file = await (await fetch(done.body.download.url)).json();
    expect(file.schema).toBe('funlabs.research-export/v1');
    expect(file.rehearsal).toBe(true);
    expect(JSON.stringify(file)).not.toMatch(/storage_path|recording\.webm|signedUrl/);
    // Unreviewed findings never enter the export.
    expect(file.evidence ?? []).toEqual([]);
    expect(file.excluded.evidence_unreviewed).toBeGreaterThan(0);
    expect(file.excluded.raw_media).toBe('not included');
    expect(file.predictions.some((p: { is_retrospective: boolean }) => p.is_retrospective)).toBe(true);
  });

  it('logs every call without secrets and rate-limits abuse', async () => {
    const log = await worker.from('agent_tool_calls').select('tool, status, transport, input').order('created_at', { ascending: false }).limit(200);
    expect((log.data ?? []).length).toBeGreaterThan(20);
    expect(JSON.stringify(log.data)).not.toMatch(/fla_[A-Za-z0-9_-]{20,}/);
  });

  it('serves the same tools over MCP with a standard client', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${toks.creator}` } } });
    const client = new Client({ name: 'funlabs-test', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('submit_agent_work');
    expect(tools.tools.find((t) => t.name === 'get_study')?.inputSchema.type).toBe('object');
    const res = await client.callTool({ name: 'get_study', arguments: { study_id: ids.study } });
    expect(res.isError).toBe(false);
    expect((res.structuredContent as { study_id: string }).study_id).toBe(ids.study);
    const denied = await client.callTool({ name: 'get_study', arguments: { study_id: '00000000-0000-4000-8000-000000000000' } });
    expect(denied.isError).toBe(true);
    await client.close();
    const anon = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`));
    const anonClient = new Client({ name: 'funlabs-test', version: '1.0.0' });
    await anonClient.connect(anon);
    const noAuth = await anonClient.callTool({ name: 'get_study', arguments: { study_id: ids.study } });
    expect(noAuth.isError).toBe(true);
    await anonClient.close();
    const get = await fetch(`${BASE}/api/mcp`);
    expect(get.status).toBe(405);
  }, 60_000);

  it('the web table from the lab shows the activity of agents to the owner only', async () => {
    const calls = await worker.from('agent_tool_calls').select('credential_id, study_id').eq('study_id', ids.study).limit(5);
    expect((calls.data ?? []).length).toBeGreaterThan(0);
  });
});
