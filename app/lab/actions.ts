'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createUserClient } from '@/lib/supabase/server';
import { workerClient } from '@/lib/supabase/worker';
import { createInvitations, createStudyDraft, demoStudyInput, publishStudy, PublishError, syncStudyStatus } from '@/lib/studies';
import { enqueueJob, retryJob } from '@/lib/jobs';
import { settleDelivery } from '@/lib/budget';
import { newToken } from '@/lib/tokens';
import { CAPABILITIES, CREATOR_CONSENT_TEXT, type Capability } from '@/lib/catalog';
import { EXPORT_FIELDS, requestExport } from '@/lib/export';

export type ActionState = { ok: boolean; message?: string; errors?: Record<string, string>; data?: Record<string, unknown> };

async function requireUser() {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/sign-in');
  return { supabase, user: data.user };
}

/** Membership check through RLS: the study must be visible and workable. */
async function requireStudy(studyId: string, roles: Array<'owner' | 'collaborator' | 'researcher'> = ['owner', 'collaborator']) {
  const { supabase, user } = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(studyId)) throw new Error('Invalid study');
  const study = await supabase.from('studies').select('*').eq('id', studyId).maybeSingle();
  if (!study.data) throw new Error('You do not have access to this study');
  const member = await supabase.from('study_members').select('role').eq('study_id', studyId).eq('user_id', user.id).maybeSingle();
  const role = (member.data?.role ?? (study.data.owner_id === user.id ? 'owner' : null)) as 'owner' | 'collaborator' | 'researcher' | null;
  if (!role || !roles.includes(role)) throw new Error('Your role does not allow this action');
  return { supabase, user, study: study.data, role };
}

function fail(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

const refresh = (studyId: string) => revalidatePath(`/lab/studies/${studyId}`, 'layout');

// --------------------------------------------------------------- studies

export async function createDemoStudy(): Promise<void> {
  const { supabase, user } = await requireUser();
  const worker = await workerClient();
  const study = await createStudyDraft(supabase, worker, user.id, demoStudyInput(), { createdVia: 'ui' });
  redirect(`/lab/studies/${study.id}`);
}

const StudySchema = z.object({
  title: z.string().trim().min(3, 'Write a title of at least 3 characters').max(140),
  question: z.string().trim().min(10, 'The question needs at least 10 characters').max(1000),
  objective: z.enum(['clarity', 'fun', 'challenge', 'pacing', 'controls'], { message: 'Choose an objective' }),
  objective_detail: z.string().trim().max(500).optional().default(''),
  audience: z.string().trim().min(3, 'Describe the audience').max(500),
  task: z.string().trim().min(10, 'Describe the task for the person').max(1000),
  participants_target: z.coerce.number().int().min(1, 'Minimum 1 person').max(50, 'Maximum 50 people'),
  session_minutes: z.coerce.number().int().min(1, 'Minimum 1 minute').max(30, 'Maximum 30 minutes'),
  budget_cap: z.coerce.number().min(0, 'Cannot be negative').max(10000),
  tester_payment: z.coerce.number().min(0).max(1000),
  agent_reward: z.coerce.number().min(0).max(1000).optional().default(0),
  client_contribution: z.coerce.number().min(0).max(10000).optional().default(0),
});

export async function createStudy(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = StudySchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
    return fail('Check the highlighted fields.', errors);
  }
  const v = parsed.data;
  if (v.tester_payment * v.participants_target > v.budget_cap) {
    return fail('The spending cap does not cover payment for everyone.', { budget_cap: `You need at least ${(v.tester_payment * v.participants_target).toFixed(2)} for ${v.participants_target} people.` });
  }
  const { supabase, user } = await requireUser();
  const worker = await workerClient();
  let id: string;
  try {
    const study = await createStudyDraft(supabase, worker, user.id, {
      title: v.title,
      question: v.question,
      objective: v.objective,
      objective_detail: v.objective_detail,
      audience: v.audience,
      task: v.task,
      participants_target: v.participants_target,
      session_minutes: v.session_minutes,
      budget_cap_cents: Math.round(v.budget_cap * 100),
      tester_payment_cents: Math.round(v.tester_payment * 100),
      agent_reward_cents: Math.round(v.agent_reward * 100),
      client_contribution_cents: Math.round(v.client_contribution * 100),
      analysis_estimate_cents: 200,
      operation_estimate_cents: 300,
    });
    id = study.id;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save the draft.');
  }
  redirect(`/lab/studies/${id}`);
}

export async function publishStudyAction(studyId: string): Promise<ActionState> {
  const { study, user } = await requireStudy(studyId, ['owner']);
  if (study.status !== 'draft') return fail('The study has already been published.');
  const worker = await workerClient();
  try {
    await publishStudy(worker, studyId, { userId: user.id, via: 'ui' });
  } catch (err) {
    if (err instanceof PublishError) return fail(err.problems.join(' '));
    return fail(err instanceof Error ? err.message : 'Could not publish.');
  }
  refresh(studyId);
  return { ok: true, message: 'Study published. The checks are now fixed.' };
}

export async function deleteDraftStudy(studyId: string): Promise<void> {
  const { supabase } = await requireStudy(studyId, ['owner']);
  await supabase.from('studies').delete().eq('id', studyId).eq('status', 'draft');
  redirect('/lab');
}

export async function setStudyPhase(studyId: string, phase: 'comparing' | 'completed'): Promise<ActionState> {
  const { study } = await requireStudy(studyId, ['owner']);
  const worker = await workerClient();
  if (phase === 'comparing') {
    const sv = await worker.from('study_versions').select('role, versions(status)').eq('study_id', studyId).eq('role', 'variant');
    const ready = (sv.data ?? []).some((r) => (r.versions as unknown as { status: string } | null)?.status === 'ready');
    if (!ready) return fail('There is no variant yet that has passed its checks.');
    if (!['evidence_ready', 'analyzing', 'collecting'].includes(study.status)) return fail('The comparison opens after evidence has been received.');
  }
  if (phase === 'completed' && study.status === 'draft') return fail('A draft cannot be completed.');
  await worker.from('studies').update({ status: phase, ...(phase === 'completed' ? { completed_at: new Date().toISOString() } : {}) }).eq('id', studyId);
  refresh(studyId);
  return { ok: true, message: phase === 'comparing' ? 'Comparison open: people see the new task on their same link.' : 'Study completed.' };
}

// ----------------------------------------------------------- invitations

export async function createInvitesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const studyId = String(form.get('study_id') ?? '');
  const count = Math.max(1, Math.min(20, Number(form.get('count') ?? 1)));
  const { supabase, user, study } = await requireStudy(studyId);
  if (study.status === 'draft') return fail('Publish the study before inviting people.');
  try {
    const invites = await createInvitations(supabase, user.id, studyId, count);
    refresh(studyId);
    return { ok: true, message: 'Copy the links now: for security they are not shown again.', data: { invites } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not create the invites.');
  }
}

export async function revokeInvite(studyId: string, inviteId: string): Promise<ActionState> {
  const { supabase } = await requireStudy(studyId);
  await supabase.from('invitations').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId).eq('study_id', studyId);
  refresh(studyId);
  return { ok: true };
}

// ------------------------------------------------------------ deliveries

export async function reviewDelivery(studyId: string, deliveryId: string, valid: boolean, note: string): Promise<ActionState> {
  const { supabase, user } = await requireStudy(studyId);
  const d = await supabase.from('deliveries').select('id, assignment_id, phase, study_id, status').eq('id', deliveryId).eq('study_id', studyId).single();
  if (d.error) return fail('Submission not found.');
  if (d.data.status !== 'submitted') return fail('This submission has already been reviewed.');
  if (!valid && !note.trim()) return fail('Explain the reason: the person can ask for a review.');
  const upd = await supabase.from('deliveries').update({ status: valid ? 'valid' : 'invalid', note: note.trim() || null, reviewed_by: user.id }).eq('id', deliveryId);
  if (upd.error) return fail(upd.error.message);
  const worker = await workerClient();
  const settled = await settleDelivery(worker, d.data as { id: string; assignment_id: string; phase: 'playtest' | 'comparison'; study_id: string }, valid, note.trim());
  refresh(studyId);
  return { ok: true, message: valid ? `Valid submission. Payout recorded in test mode (${(settled.amount / 100).toFixed(2)}).` : 'Submission marked as not usable. The reservation was released.' };
}

// -------------------------------------------------------------- evidence

export async function reviewEvidence(studyId: string, evidenceId: string, action: 'confirm' | 'correct' | 'reject', note: string, corrected?: Record<string, string>): Promise<ActionState> {
  const { supabase, user } = await requireStudy(studyId);
  const clean = corrected ? Object.fromEntries(Object.entries(corrected).filter(([k, v]) => ['hypothesis', 'alternative', 'next_test', 'observation'].includes(k) && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 2000)])) : undefined;
  if (action === 'correct' && (!clean || Object.keys(clean).length === 0)) return fail('Write the correction.');
  if (action === 'reject' && !note.trim()) return fail('Say why it is rejected: it stays in the history.');
  const ins = await supabase.from('evidence_reviews').insert({ evidence_id: evidenceId, study_id: studyId, reviewer_id: user.id, reviewer_kind: 'creator', action, note: note.trim() || null, corrected: clean ?? null });
  if (ins.error) return fail(ins.error.message);
  refresh(studyId);
  return { ok: true };
}

const FindingSchema = z.object({
  study_id: z.string().uuid(),
  session_id: z.string().uuid(),
  start_ms: z.coerce.number().int().min(0),
  end_ms: z.coerce.number().int().min(1),
  observation: z.string().trim().min(3, 'Describe what happened').max(2000),
  feedback_id: z.string().uuid().optional().or(z.literal('')),
  hypothesis: z.string().trim().max(2000).optional().default(''),
  next_test: z.string().trim().max(2000).optional().default(''),
  category: z.enum(['clarity', 'difficulty', 'enjoyment', 'controls', 'pacing', 'bug', 'other']),
  preserve: z.string().optional(),
});

/** A finding written by a person of the team, with the same structure and checks. */
export async function addHumanFinding(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = FindingSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid data');
  const v = parsed.data;
  if (v.end_ms <= v.start_ms) return fail('The end of the interval must be after the start.');
  const { supabase, user } = await requireStudy(v.study_id);
  const session = await supabase.from('sessions').select('id, version_id').eq('id', v.session_id).eq('study_id', v.study_id).single();
  if (session.error) return fail('Session not found.');
  const rec = await supabase.from('recordings').select('id, duration_ms').eq('session_id', v.session_id).maybeSingle();
  const inside = !rec.data?.duration_ms || v.end_ms <= rec.data.duration_ms + 2000;
  const ev = await supabase
    .from('evidence')
    .insert({
      study_id: v.study_id,
      version_id: session.data.version_id,
      session_id: v.session_id,
      origin: 'human',
      created_by: user.id,
      interval_start_ms: v.start_ms,
      interval_end_ms: Math.min(v.end_ms, rec.data?.duration_ms ?? v.end_ms),
      observation: v.observation,
      human_statement_feedback_id: v.feedback_id || null,
      hypothesis: v.hypothesis || null,
      next_test: v.next_test || null,
      category: v.category,
      preserve: v.preserve === 'on',
      structural_status: inside ? (v.feedback_id ? 'verified' : 'partial') : 'unsupported',
      generated_by: { provider: 'human', reviewer_id: user.id },
    })
    .select('id')
    .single();
  if (ev.error) return fail(ev.error.message);
  if (rec.data) await supabase.from('evidence_sources').insert({ evidence_id: ev.data.id, kind: 'recording', source_id: rec.data.id, t_ms: v.start_ms, verified: inside });
  if (v.feedback_id) await supabase.from('evidence_sources').insert({ evidence_id: ev.data.id, kind: 'feedback', source_id: v.feedback_id, verified: true });
  const worker = await workerClient();
  await syncStudyStatus(worker, v.study_id);
  refresh(v.study_id);
  return { ok: true, message: 'Finding added.' };
}

// ------------------------------------------------------------------ jobs

export async function requestAnalysis(studyId: string, sessionId: string): Promise<ActionState> {
  const { user } = await requireStudy(studyId);
  const worker = await workerClient();
  const prev = await worker.from('jobs').select('id', { count: 'exact', head: true }).eq('kind', 'analyze_session').like('idempotency_key', `analyze:${sessionId}:%`);
  const job = await enqueueJob(worker, { studyId, kind: 'analyze_session', key: `analyze:${sessionId}:v${(prev.count ?? 0) + 1}`, input: { session_id: sessionId }, createdBy: user.id });
  refresh(studyId);
  return { ok: true, message: 'Analysis queued.', data: { job_id: job.id } };
}

export async function retryJobAction(studyId: string, jobId: string): Promise<ActionState> {
  await requireStudy(studyId);
  const worker = await workerClient();
  const job = await worker.from('jobs').select('study_id').eq('id', jobId).single();
  if (job.data?.study_id !== studyId) return fail('Job not found.');
  await retryJob(worker, jobId);
  refresh(studyId);
  return { ok: true, message: 'Job retried.' };
}

export async function requestIntervention(studyId: string, evidenceIds: string[]): Promise<ActionState> {
  const { user, study } = await requireStudy(studyId, ['owner']);
  if (!study.check_suite_id) return fail('Publish the study before intervening: checks are fixed when you publish.');
  if (!evidenceIds.length) return fail('Choose at least one finding that motivates the change.');
  const worker = await workerClient();
  const base = await worker.from('study_versions').select('version_id').eq('study_id', studyId).eq('role', 'baseline').single();
  if (base.error) return fail('The baseline version is missing.');
  const ids = [...new Set(evidenceIds)].sort();
  const job = await enqueueJob(worker, {
    studyId,
    kind: 'intervention',
    key: `intervention:${studyId}:${ids.join(',').slice(0, 300)}:${Date.now()}`,
    input: { base_version_id: base.data.version_id, evidence_ids: ids, requested_by: user.id },
    maxAttempts: 2,
    createdBy: user.id,
  });
  refresh(studyId);
  return { ok: true, message: 'Claude is preparing a scoped variant.', data: { job_id: job.id } };
}

// ---------------------------------------------------------------- agents

const CredentialSchema = z.object({
  study_id: z.string().uuid(),
  label: z.string().trim().min(2, 'Name the credential').max(80),
  kind: z.enum(['creator_agent', 'participant_agent']),
  bounty_id: z.string().uuid().optional().or(z.literal('')),
  days: z.coerce.number().int().min(1).max(30),
  scope: z.enum(['study', 'product']).optional().default('study'),
});

export async function createCredentialAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = CredentialSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid data');
  const v = parsed.data;
  const caps = form.getAll('capabilities').map(String).filter((c): c is Capability => c in CAPABILITIES);
  if (!caps.length) return fail('Choose at least one capability.');
  if (v.kind === 'participant_agent' && !v.bounty_id) return fail('A participating agent works on a bounty: choose one.');
  const { user, study } = await requireStudy(v.study_id, ['owner']);
  if (v.kind === 'participant_agent') {
    const b = await (await workerClient()).from('bounties').select('id, kind').eq('id', v.bounty_id).eq('study_id', v.study_id).maybeSingle();
    if (!b.data || !['agent_prediction', 'agent_analysis'].includes(b.data.kind)) return fail('The chosen bounty does not accept participating agents in the MVP.');
  }
  const t = newToken('fla');
  const studyScoped = v.kind === 'participant_agent' || v.scope === 'study';
  const allowed = v.kind === 'participant_agent' ? caps.filter((c) => c === 'evidence:read' || c === 'work:submit') : caps;
  // Credentials are minted by the backend after the owner check: there is no insert policy for creators.
  const worker = await workerClient();
  const ins = await worker.from('agent_credentials').insert({
    product_id: study.product_id,
    study_id: studyScoped ? v.study_id : null,
    bounty_id: v.kind === 'participant_agent' ? v.bounty_id : null,
    kind: v.kind,
    label: v.label,
    token_hash: t.hash,
    token_hint: t.hint,
    capabilities: allowed,
    created_by: user.id,
    expires_at: new Date(Date.now() + v.days * 86400_000).toISOString(),
  });
  if (ins.error) return fail(ins.error.message);
  refresh(v.study_id);
  return { ok: true, message: 'Copy the token now: it is not shown again.', data: { token: t.token } };
}

export async function revokeCredential(studyId: string, credentialId: string): Promise<ActionState> {
  const { supabase } = await requireStudy(studyId, ['owner']);
  await supabase.from('agent_credentials').update({ revoked_at: new Date().toISOString() }).eq('id', credentialId);
  refresh(studyId);
  return { ok: true };
}

export async function setSpendingPolicy(studyId: string, agentCanPublish: boolean, maxBudget: number): Promise<ActionState> {
  const { supabase, study } = await requireStudy(studyId, ['owner']);
  const upd = await supabase
    .from('products')
    .update({ spending_policy: { agent_can_publish: agentCanPublish, max_budget_cents: Math.max(0, Math.round(maxBudget * 100)) } })
    .eq('id', study.product_id);
  if (upd.error) return fail(upd.error.message);
  refresh(studyId);
  return { ok: true, message: 'Spending policy saved.' };
}

// ------------------------------------------------------------- research

export async function setCreatorConsent(studyId: string, granted: boolean): Promise<ActionState> {
  const { supabase, user } = await requireStudy(studyId, ['owner']);
  const ins = await supabase.from('consent_records').insert({ study_id: studyId, user_id: user.id, subject: 'creator', purpose: 'research_sharing', granted, text_version: CREATOR_CONSENT_TEXT.version });
  if (ins.error) return fail(ins.error.message);
  const upd = await supabase.from('studies').update({ creator_research_consent: granted, creator_research_consent_at: new Date().toISOString() }).eq('id', studyId);
  if (upd.error) return fail(upd.error.message);
  refresh(studyId);
  return { ok: true };
}

export async function requestExportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const studyId = String(form.get('study_id') ?? '');
  const purpose = String(form.get('purpose') ?? '').trim();
  const format = form.get('format') === 'jsonl' ? 'jsonl' : 'json';
  const fields = form.getAll('fields').map(String).filter((f) => (EXPORT_FIELDS as readonly string[]).includes(f));
  if (purpose.length < 5) return fail('Describe the purpose of the export.', { purpose: 'Minimum 5 characters.' });
  if (!fields.length) return fail('Choose at least one field.');
  const { user } = await requireStudy(studyId, ['owner', 'collaborator', 'researcher']);
  const worker = await workerClient();
  const exp = await requestExport(worker, { studyId, userId: user.id, purpose, fields, format, via: 'ui' });
  refresh(studyId);
  if (exp.status === 'blocked') return fail(`Export blocked: ${exp.blocked_reason}`);
  return { ok: true, message: 'Export being prepared.', data: { export_id: exp.id } };
}

export async function exportDownloadUrl(studyId: string, exportId: string): Promise<ActionState> {
  const { supabase } = await requireStudy(studyId, ['owner', 'collaborator', 'researcher']);
  const exp = await supabase.from('dataset_exports').select('storage_path, status, expires_at').eq('id', exportId).eq('study_id', studyId).single();
  if (exp.error || exp.data.status !== 'ready' || !exp.data.storage_path) return fail('The export is not ready.');
  if (exp.data.expires_at && new Date(exp.data.expires_at).getTime() < Date.now()) return fail('The export expired. Request a new one.');
  const signed = await supabase.storage.from('exports').createSignedUrl(exp.data.storage_path, 300, { download: true });
  if (signed.error) return fail(signed.error.message);
  return { ok: true, data: { url: signed.data.signedUrl } };
}

/** Verifies access; the button then asks the backend to process the queue. */
export async function processQueueAction(studyId: string): Promise<ActionState> {
  await requireStudy(studyId);
  return { ok: true };
}
