import type { SupabaseClient } from '@supabase/supabase-js';
import { BOUNTY_TEMPLATES, FINAL_QUESTIONS, NEUTRAL_LABELS, type StudyStatus } from './catalog.ts';
import { GRAVITY_ROOM_A_HTML } from './game/builds.generated.ts';
import { newToken } from './tokens.ts';
import { ensureCheckSuite, registerVersion } from './versions.ts';
import { enqueueJob } from './jobs.ts';

export type StudyRow = {
  id: string;
  product_id: string;
  owner_id: string;
  title: string;
  question: string;
  objective: string;
  objective_detail: string;
  audience: string;
  protocol: Protocol;
  participants_target: number;
  session_minutes: number;
  status: StudyStatus;
  currency: string;
  budget_cap_cents: number;
  tester_payment_cents: number;
  agent_reward_cents: number;
  analysis_estimate_cents: number;
  operation_estimate_cents: number;
  client_contribution_cents: number;
  creator_research_consent: boolean;
  check_suite_id: string | null;
  created_via: string;
  is_rehearsal: boolean;
  published_at: string | null;
  created_at: string;
};

export type Protocol = {
  task: string;
  final_questions: Array<{ key: string; text: string }>;
  comparison: { enabled: boolean; neutral_labels: string[]; order: 'alternate' };
  recording: { surface: 'tab'; microphone: 'optional'; camera: false };
  payment_rule: string;
};

export function defaultProtocol(task?: string): Protocol {
  return {
    task: task ?? BOUNTY_TEMPLATES.human_playtest.instructions,
    final_questions: FINAL_QUESTIONS.map((q) => ({ ...q })),
    comparison: { enabled: true, neutral_labels: [...NEUTRAL_LABELS], order: 'alternate' },
    recording: { surface: 'tab', microphone: 'optional', camera: false },
    payment_rule: 'Se paga cada entrega válida (material utilizable, tarea realizada, comentarios relacionados), sin importar si a la persona le gustó.',
  };
}

export type StudyDraftInput = {
  title: string;
  question: string;
  objective: 'clarity' | 'fun' | 'challenge' | 'pacing' | 'controls';
  objective_detail?: string;
  audience: string;
  task?: string;
  participants_target: number;
  session_minutes: number;
  budget_cap_cents: number;
  tester_payment_cents: number;
  agent_reward_cents?: number;
  analysis_estimate_cents?: number;
  operation_estimate_cents?: number;
  client_contribution_cents?: number;
};

/** Ensures the creator owns the Gravity Room product with version A registered. */
export async function ensureGravityRoomProduct(user: SupabaseClient, worker: SupabaseClient, userId: string) {
  const found = await user.from('products').select('*').eq('owner_id', userId).eq('slug', 'gravity-room').maybeSingle();
  if (found.error) throw new Error(`Buscar producto: ${found.error.message}`);
  let product = found.data;
  if (!product) {
    const ins = await user
      .from('products')
      .insert({ owner_id: userId, slug: 'gravity-room', name: 'Gravity Room', description: 'Juego web corto: invertí la gravedad para escapar de tres salas.', kind: 'web_game' })
      .select('*')
      .single();
    if (ins.error) throw new Error(`Crear producto: ${ins.error.message}`);
    product = ins.data;
  }
  const versionA = await registerVersion(worker, {
    productId: product.id,
    label: 'A',
    html: GRAVITY_ROOM_A_HTML,
    origin: 'repository',
    status: 'ready',
    notes: 'Versión original del repositorio (games/gravity-room/a).',
    createdBy: userId,
  });
  return { product, versionA };
}

/** Creates a draft study owned by the user, with baseline and the four bounty types. */
export async function createStudyDraft(
  user: SupabaseClient,
  worker: SupabaseClient,
  userId: string,
  input: StudyDraftInput,
  opts: { productId?: string; baselineVersionId?: string; createdVia?: 'ui' | 'agent_api' | 'seed'; isRehearsal?: boolean } = {},
): Promise<StudyRow> {
  let productId = opts.productId;
  let baselineId = opts.baselineVersionId;
  if (!productId || !baselineId) {
    const { product, versionA } = await ensureGravityRoomProduct(user, worker, userId);
    productId = productId ?? product.id;
    baselineId = baselineId ?? versionA.id;
  }
  const client = opts.createdVia === 'agent_api' ? worker : user;
  const ins = await client
    .from('studies')
    .insert({
      product_id: productId,
      owner_id: userId,
      title: input.title,
      question: input.question,
      objective: input.objective,
      objective_detail: input.objective_detail ?? '',
      audience: input.audience,
      protocol: defaultProtocol(input.task),
      participants_target: input.participants_target,
      session_minutes: input.session_minutes,
      budget_cap_cents: input.budget_cap_cents,
      tester_payment_cents: input.tester_payment_cents,
      agent_reward_cents: input.agent_reward_cents ?? 0,
      analysis_estimate_cents: input.analysis_estimate_cents ?? 0,
      operation_estimate_cents: input.operation_estimate_cents ?? 0,
      client_contribution_cents: input.client_contribution_cents ?? 0,
      created_via: opts.createdVia ?? 'ui',
      is_rehearsal: opts.isRehearsal ?? false,
    })
    .select('*')
    .single();
  if (ins.error) throw new Error(`Crear estudio: ${ins.error.message}`);
  const study = ins.data as StudyRow;

  const sv = await client.from('study_versions').insert({ study_id: study.id, version_id: baselineId, role: 'baseline' });
  if (sv.error) throw new Error(`Asociar versión base: ${sv.error.message}`);

  const reward = input.agent_reward_cents ?? 0;
  const bounties = [
    { kind: 'human_playtest' as const, reward: input.tester_payment_cents, slots: input.participants_target },
    { kind: 'agent_prediction' as const, reward, slots: 1 },
    { kind: 'agent_analysis' as const, reward, slots: 1 },
    { kind: 'agent_intervention' as const, reward: 0, slots: 1 },
  ];
  const rows = bounties.map((b) => {
    const t = BOUNTY_TEMPLATES[b.kind];
    return {
      study_id: study.id,
      kind: b.kind,
      title: t.title,
      instructions: b.kind === 'human_playtest' && input.task ? input.task : t.instructions,
      deliverable: t.deliverable,
      criteria: t.criteria.map((text, i) => ({ key: `c${i + 1}`, text })),
      reward_cents: b.reward,
      slots: b.slots,
      status: 'draft',
    };
  });
  const bi = await client.from('bounties').insert(rows);
  if (bi.error) throw new Error(`Crear bounties: ${bi.error.message}`);
  return study;
}

export function demoStudyInput(): StudyDraftInput {
  return {
    title: 'Gravity Room: claridad del comienzo',
    question: '¿Las personas que juegan por primera vez entienden qué pueden activar y cómo avanzar, sin que el puzzle pierda desafío?',
    objective: 'clarity',
    objective_detail: 'Mejorar la claridad conservando el desafío. No eliminar dificultades que las personas disfrutan.',
    audience: 'Personas que no jugaron antes a Gravity Room, en computadora con teclado.',
    participants_target: 3,
    session_minutes: 3,
    budget_cap_cents: 3000,
    tester_payment_cents: 500,
    agent_reward_cents: 300,
    analysis_estimate_cents: 200,
    operation_estimate_cents: 300,
    client_contribution_cents: 1000,
  };
}

export class PublishError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems.join(' '));
    this.problems = problems;
  }
}

/** Validates, freezes the check suite, opens bounties and publishes. */
export async function publishStudy(worker: SupabaseClient, studyId: string, actor: { userId?: string; via: 'ui' | 'agent_api' }) {
  const { data: study, error } = await worker.from('studies').select('*').eq('id', studyId).single();
  if (error || !study) throw new Error('Estudio inexistente');
  if (study.status !== 'draft') throw new PublishError([`El estudio ya está ${study.status}.`]);
  const problems: string[] = [];
  const sv = await worker.from('study_versions').select('version_id, role, versions(status)').eq('study_id', studyId);
  const baseline = (sv.data ?? []).find((r) => r.role === 'baseline');
  if (!baseline) problems.push('Falta la versión base.');
  const bounties = await worker.from('bounties').select('id, kind').eq('study_id', studyId);
  if (!(bounties.data ?? []).some((b) => b.kind === 'human_playtest')) problems.push('Falta el bounty humano.');
  const planned = study.tester_payment_cents * study.participants_target;
  if (planned > study.budget_cap_cents) {
    problems.push(`El límite de gasto (${study.budget_cap_cents / 100}) no cubre el pago a ${study.participants_target} personas (${planned / 100}).`);
  }
  if (problems.length) throw new PublishError(problems);

  const suite = await ensureCheckSuite(worker, study.product_id);
  const upd = await worker
    .from('studies')
    .update({ status: 'published', published_at: new Date().toISOString(), check_suite_id: suite.id })
    .eq('id', studyId)
    .eq('status', 'draft');
  if (upd.error) throw new Error(`Publicar: ${upd.error.message}`);
  await worker.from('bounties').update({ status: 'open' }).eq('study_id', studyId);
  // Reference run of the fixed checks on the baseline.
  if (baseline) {
    await enqueueJob(worker, {
      studyId,
      kind: 'run_checks',
      key: `checks:${studyId}:${baseline.version_id}:${suite.sha256.slice(0, 12)}`,
      input: { version_id: baseline.version_id, baseline_version_id: null, suite_id: suite.id },
    });
  }
  return { suiteId: suite.id, suiteSha: suite.sha256 };
}

export async function createInvitations(user: SupabaseClient, userId: string, studyId: string, count: number, labelPrefix = 'Tester') {
  const bounty = await user.from('bounties').select('id').eq('study_id', studyId).eq('kind', 'human_playtest').single();
  if (bounty.error) throw new Error(`Bounty humano: ${bounty.error.message}`);
  const existing = await user.from('invitations').select('id', { count: 'exact', head: true }).eq('study_id', studyId);
  const start = (existing.count ?? 0) + 1;
  const out: Array<{ label: string; token: string; hint: string }> = [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const t = newToken('flt');
    const label = `${labelPrefix} ${start + i}`;
    out.push({ label, token: t.token, hint: t.hint });
    rows.push({ study_id: studyId, bounty_id: bounty.data.id, token_hash: t.hash, token_hint: t.hint, label, created_by: userId, expires_at: new Date(Date.now() + 14 * 86400_000).toISOString() });
  }
  const ins = await user.from('invitations').insert(rows);
  if (ins.error) throw new Error(`Crear invitaciones: ${ins.error.message}`);
  return out;
}

/**
 * Moves a study between collecting, analyzing and evidence_ready based on the
 * material and the analysis jobs. Other transitions are explicit.
 */
export async function syncStudyStatus(worker: SupabaseClient, studyId: string): Promise<StudyStatus> {
  const { data: study } = await worker.from('studies').select('status').eq('id', studyId).single();
  if (!study) return 'draft';
  const status = study.status as StudyStatus;
  if (!['published', 'collecting', 'analyzing', 'evidence_ready'].includes(status)) return status;
  const [assignments, activeJobs, evidence] = await Promise.all([
    worker.from('assignments').select('id', { count: 'exact', head: true }).eq('study_id', studyId),
    worker.from('jobs').select('id', { count: 'exact', head: true }).eq('study_id', studyId).eq('kind', 'analyze_session').in('status', ['queued', 'running']),
    worker.from('evidence').select('id', { count: 'exact', head: true }).eq('study_id', studyId),
  ]);
  let next: StudyStatus = status;
  if ((activeJobs.count ?? 0) > 0) next = 'analyzing';
  else if ((evidence.count ?? 0) > 0) next = 'evidence_ready';
  else if ((assignments.count ?? 0) > 0) next = 'collecting';
  else next = 'published';
  if (next !== status) await worker.from('studies').update({ status: next }).eq('id', studyId);
  return next;
}
