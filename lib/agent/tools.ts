import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CAPABILITIES, OBJECTIVE_LABEL, type Capability } from '../catalog.ts';
import { env } from '../env.ts';
import { comparisonSummary, evaluatePrediction, type PredictionPayload } from '../results.ts';
import { createStudyDraft, publishStudy, PublishError, type StudyRow } from '../studies.ts';
import { materializeIntervention } from '../intervention/run.ts';
import { requestExport, EXPORT_FIELDS } from '../export.ts';
import { validateFinding, type ProposedFinding, type SessionMaterial, type ValidatedFinding } from '../analysis/validate.ts';
import { syncStudyStatus } from '../studies.ts';
import { AgentError, requireCapability, type AgentActor } from './auth.ts';
import { evaluateAnalysis } from './evaluate.ts';

export type ToolContext = { worker: SupabaseClient; actor: AgentActor; transport: 'rest' | 'mcp' };

type ToolDef<S extends z.ZodType> = {
  name: string;
  description: string;
  capability: Capability;
  /** Which credential kinds may call it. */
  kinds: Array<'creator_agent' | 'participant_agent'>;
  schema: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<Record<string, unknown>>;
};

function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const uuid = z.string().uuid();
const objective = z.enum(['clarity', 'fun', 'challenge', 'pacing', 'controls']);
const category = z.enum(['clarity', 'difficulty', 'enjoyment', 'controls', 'pacing', 'bug', 'other']);

// ---------------------------------------------------------------- helpers

async function loadStudy(ctx: ToolContext, studyId: string): Promise<StudyRow> {
  const { data } = await ctx.worker.from('studies').select('*').eq('id', studyId).maybeSingle();
  const c = ctx.actor.credential;
  // Same answer whether it does not exist or belongs to someone else.
  if (!data || data.product_id !== c.product_id || (c.study_id && c.study_id !== data.id)) throw new AgentError('not_found', 'Estudio no encontrado para esta credencial', 404);
  return data as StudyRow;
}

async function versionsOf(worker: SupabaseClient, studyId: string) {
  const { data } = await worker.from('study_versions').select('role, version_id, versions(id, label, status, content_sha256, origin)').eq('study_id', studyId);
  return (data ?? []).map((r) => {
    const v = r.versions as unknown as { id: string; label: string; status: string; content_sha256: string; origin: string };
    return { version_id: r.version_id, role: r.role as 'baseline' | 'variant', label: v.label, status: v.status, origin: v.origin, content_sha256: v.content_sha256, play_url: v.status === 'ready' ? `${env.siteUrl}/jugar/v/${v.id}` : null };
  });
}

async function productInfo(worker: SupabaseClient, productId: string) {
  const { data } = await worker.from('products').select('id, slug, name, owner_id, spending_policy').eq('id', productId).single();
  return data as { id: string; slug: string; name: string; owner_id: string; spending_policy: { agent_can_publish?: boolean; max_budget_cents?: number } };
}

// Specific objectives first: a generic word like "gusta" must not outrank "ritmo".
const OBJECTIVE_HINTS: Array<[RegExp, z.infer<typeof objective>]> = [
  [/ritmo|espera|lent|rápid|rapid/i, 'pacing'],
  [/control|tecla|respond/i, 'controls'],
  [/desaf|dificult|reto/i, 'challenge'],
  [/clar|entend|instruc|señal|comprend/i, 'clarity'],
  [/divert|fun\b|disfrut|gust/i, 'fun'],
];

function inferObjective(question: string): z.infer<typeof objective> {
  return OBJECTIVE_HINTS.find(([re]) => re.test(question))?.[1] ?? 'clarity';
}

function findingOut(e: Record<string, unknown>, sources: Array<Record<string, unknown>>) {
  const cur = (e.current ?? {}) as Record<string, string>;
  return {
    evidence_id: e.id,
    study_id: e.study_id,
    version_id: e.version_id,
    session_id: e.session_id,
    interval_ms: { start: e.interval_start_ms, end: e.interval_end_ms },
    observation: cur.observation ?? e.observation,
    human_statement: e.human_statement ?? null,
    hypothesis: cur.hypothesis ?? e.hypothesis ?? null,
    alternative: e.alternative ?? null,
    next_test: cur.next_test ?? e.next_test ?? null,
    category: e.category,
    preserve: e.preserve,
    sources: sources.map((s) => ({ kind: s.kind, source_id: s.source_id, t_ms: s.t_ms, verified: s.verified })),
    structural_status: e.structural_status,
    review_status: e.review_status,
    origin: e.origin,
    generated_by: e.generated_by,
  };
}

async function coverage(worker: SupabaseClient, studyIds: string[], versionId?: string | null) {
  if (!studyIds.length) return { studies: 0, sessions: 0, recording_minutes: 0, game_events: 0, comments: 0, findings: { total: 0, confirmed: 0, corrected: 0, unreviewed: 0, rejected: 0, verified_sources: 0, unsupported: 0 } };
  let sq = worker.from('sessions').select('id, status, recordings(duration_ms, status)').in('study_id', studyIds).in('status', ['recorded', 'submitted']);
  if (versionId) sq = sq.eq('version_id', versionId);
  const sessions = (await sq).data ?? [];
  const ids = sessions.map((s) => s.id);
  const minutes = sessions.reduce((a, s) => a + (((s.recordings as unknown as { duration_ms: number | null; status: string } | null)?.status === 'verified' ? (s.recordings as unknown as { duration_ms: number | null }).duration_ms : 0) ?? 0), 0) / 60000;
  const [events, comments, ev] = await Promise.all([
    ids.length ? worker.from('game_events').select('id', { count: 'exact', head: true }).in('session_id', ids) : Promise.resolve({ count: 0 }),
    ids.length ? worker.from('feedback').select('id', { count: 'exact', head: true }).in('session_id', ids) : Promise.resolve({ count: 0 }),
    ids.length ? worker.from('evidence').select('review_status, structural_status').in('session_id', ids) : Promise.resolve({ data: [] as Array<{ review_status: string; structural_status: string }> }),
  ]);
  const f = ev.data ?? [];
  const count = (k: string) => f.filter((x) => x.review_status === k).length;
  return {
    studies: studyIds.length,
    sessions: sessions.length,
    recording_minutes: Math.round(minutes * 10) / 10,
    game_events: events.count ?? 0,
    comments: comments.count ?? 0,
    findings: { total: f.length, confirmed: count('confirmed'), corrected: count('corrected'), unreviewed: count('unreviewed'), rejected: count('rejected'), verified_sources: f.filter((x) => x.structural_status === 'verified').length, unsupported: f.filter((x) => x.structural_status === 'unsupported').length },
  };
}

/** Sessions an actor may use as material. Participant agents only get text from people who authorized research. */
async function usableSessions(ctx: ToolContext, studyId: string) {
  const sessions = await ctx.worker
    .from('sessions')
    .select('id, assignment_id, version_id, phase, position, neutral_label, status, recordings(id, duration_ms, status, storage_path), versions(label)')
    .eq('study_id', studyId)
    .in('status', ['recorded', 'submitted']);
  let rows = sessions.data ?? [];
  if (ctx.actor.credential.kind === 'participant_agent') {
    const consents = await ctx.worker.from('consent_records').select('assignment_id, purpose, granted, created_at').eq('study_id', studyId).eq('subject', 'participant').eq('purpose', 'research_sharing').order('created_at');
    const latest = new Map<string, boolean>();
    for (const c of consents.data ?? []) if (c.assignment_id) latest.set(c.assignment_id, c.granted);
    const withdrawn = await ctx.worker.from('assignments').select('id').eq('study_id', studyId).eq('status', 'withdrawn');
    const w = new Set((withdrawn.data ?? []).map((a) => a.id));
    rows = rows.filter((s) => latest.get(s.assignment_id) === true && !w.has(s.assignment_id));
  }
  return rows;
}

async function sessionMaterial(worker: SupabaseClient, sessions: Awaited<ReturnType<typeof usableSessions>>) {
  const ids = sessions.map((s) => s.id);
  const [events, feedback] = await Promise.all([
    ids.length ? worker.from('game_events').select('id, session_id, seq, t_ms, type, payload').in('session_id', ids).order('seq').limit(20000) : Promise.resolve({ data: [] as Array<{ id: number; session_id: string; seq: number; t_ms: number; type: string; payload: Record<string, unknown> }> }),
    ids.length ? worker.from('feedback').select('id, session_id, kind, t_ms, question_key, body').in('session_id', ids).order('created_at') : Promise.resolve({ data: [] as Array<{ id: string; session_id: string; kind: string; t_ms: number | null; question_key: string | null; body: string }> }),
  ]);
  const out = new Map<string, { material: SessionMaterial; events: NonNullable<typeof events.data>; feedback: NonNullable<typeof feedback.data> }>();
  for (const s of sessions) {
    const rec = s.recordings as unknown as { id: string; duration_ms: number | null; status: string } | null;
    const evs = (events.data ?? []).filter((e) => e.session_id === s.id);
    const fbs = (feedback.data ?? []).filter((f) => f.session_id === s.id);
    out.set(s.id, {
      events: evs,
      feedback: fbs,
      material: {
        durationMs: rec?.status === 'verified' ? rec.duration_ms : null,
        recordingId: rec?.status === 'verified' ? rec.id : null,
        events: new Map(evs.map((e) => [String(e.id), { id: e.id, t_ms: e.t_ms, type: e.type }])),
        feedback: new Map(fbs.map((f) => [f.id, { id: f.id, t_ms: f.kind === 'moment' ? f.t_ms : null, body: f.body }])),
      },
    });
  }
  return out;
}

// ------------------------------------------------------------------ tools

const requestEvidence = defineTool({
  name: 'request_evidence',
  description:
    'Consulta evidencia existente del producto de esta credencial: cobertura, procedencia y límites. No publica bounties ni cobra. Si no hay material compatible lo dice, y con allow_new_study devuelve un borrador de estudio (una propuesta, nada se crea).',
  capability: 'evidence:read' as Capability,
  kinds: ['creator_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({
    question: z.string().min(5).max(1000).describe('Qué querés saber. No presupongas que el problema existe.'),
    product: z.string().max(80).optional().describe('Slug del producto; debe coincidir con el de la credencial.'),
    version_id: uuid.optional().describe('Versión exacta. Por defecto, la versión base del estudio más reciente.'),
    audience: z.string().max(500).optional(),
    sources: z.array(z.enum(['recording', 'game_events', 'comments', 'findings'])).optional().describe('Tipos de evidencia deseados.'),
    allow_new_study: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  async run(ctx: ToolContext, input) {
    const c = ctx.actor.credential;
    const product = await productInfo(ctx.worker, c.product_id);
    if (input.product && input.product !== product.slug) throw new AgentError('wrong_product', `Esta credencial pertenece al producto "${product.slug}", no a "${input.product}".`, 403);
    let q = ctx.worker.from('studies').select('*').eq('product_id', c.product_id).neq('status', 'draft').order('created_at', { ascending: false });
    if (c.study_id) q = q.eq('id', c.study_id);
    const studies = ((await q).data ?? []) as StudyRow[];
    let versionId = input.version_id ?? null;
    if (!versionId && studies[0]) versionId = (await versionsOf(ctx.worker, studies[0].id)).find((v) => v.role === 'baseline')?.version_id ?? null;
    const cov = await coverage(ctx.worker, studies.map((s) => s.id), versionId);
    const compatible = [];
    for (const s of studies) {
      const sc = await coverage(ctx.worker, [s.id], versionId);
      if (sc.sessions > 0 || sc.findings.total > 0) compatible.push({ study_id: s.id, title: s.title, status: s.status, objective: s.objective, question: s.question, audience: s.audience, is_rehearsal: s.is_rehearsal, coverage: sc });
    }
    const wanted = new Set(input.sources ?? ['findings']);
    let findings: ReturnType<typeof findingOut>[] = [];
    if (wanted.has('findings') && compatible.length) {
      let eq = ctx.worker.from('evidence').select('*, evidence_sources(*)').in('study_id', compatible.map((s) => s.study_id)).neq('review_status', 'rejected');
      if (versionId) eq = eq.eq('version_id', versionId);
      const rows = (await eq.limit(200)).data ?? [];
      const rank = (e: Record<string, unknown>) => (e.review_status === 'confirmed' ? 0 : e.review_status === 'corrected' ? 1 : 2) * 10 + (e.structural_status === 'verified' ? 0 : e.structural_status === 'partial' ? 1 : 2);
      rows.sort((a, b) => rank(a) - rank(b) || a.interval_start_ms - b.interval_start_ms);
      findings = rows.slice(0, input.limit).map((e) => findingOut(e, (e.evidence_sources ?? []) as Array<Record<string, unknown>>));
    }
    const gaps: string[] = [];
    if (!compatible.length) gaps.push('No hay estudios con material para este producto y esta versión.');
    if (compatible.length && cov.recording_minutes === 0) gaps.push('Hay hallazgos o eventos, pero ninguna grabación verificada.');
    if (compatible.length && cov.findings.total > 0 && cov.findings.confirmed + cov.findings.corrected === 0) gaps.push('Ningún hallazgo fue revisado por una persona del equipo: tratalos como hipótesis.');
    if (compatible.some((s) => s.is_rehearsal)) gaps.push('Parte del material es de ensayos técnicos con bots, no de personas.');
    if (cov.sessions > 0 && cov.sessions < 5) gaps.push(`Solo ${cov.sessions} sesiones: sirve para decidir un cambio, no para generalizar.`);
    const out: Record<string, unknown> = {
      scope: { product: product.slug, version_id: versionId },
      compatible_studies: compatible,
      coverage: cov,
      findings,
      gaps,
      limits: ['No hay búsqueda semántica: se devuelven los hallazgos de los estudios del mismo producto y versión, los revisados primero.', 'Solo evidencia del producto de esta credencial.'],
      question_echo: input.question,
      draft_study: null,
    };
    if (!compatible.length && input.allow_new_study) {
      const participants = 3;
      const pay = 5;
      const reward = 3;
      const analysis = 2;
      const ops = 3;
      out.draft_study = {
        note: 'Propuesta. Nada se creó ni se cobró: enviala a create_study y publicá con publish_study.',
        question: input.question,
        objective: inferObjective(input.question),
        objective_inferred: true,
        audience: input.audience ?? 'Personas que no jugaron antes',
        participants,
        session_minutes: 3,
        tester_payment_usd: pay,
        agent_reward_usd: reward,
        budget_cap_usd: participants * pay * 2 + reward * 2 + analysis + ops,
        estimate_usd: { human_payments: participants * pay * 2, agent_rewards: reward * 2, analysis, operation: ops },
        payments_mode: 'test',
      };
    }
    return out;
  },
});

const createStudyTool = defineTool({
  name: 'create_study',
  description: 'Crea un estudio en BORRADOR con pregunta, objetivo, público, protocolo y límite de presupuesto. No publica ni compromete gasto. Devuelve la estimación y qué hace falta para publicar.',
  capability: 'study:create' as Capability,
  kinds: ['creator_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({
    title: z.string().min(3).max(140).optional(),
    question: z.string().min(10).max(1000),
    objective,
    objective_detail: z.string().max(500).optional(),
    audience: z.string().min(3).max(500),
    task: z.string().min(10).max(1000).optional().describe('Tarea que verá cada persona.'),
    participants: z.number().int().min(1).max(50),
    session_minutes: z.number().int().min(1).max(30),
    baseline_version_id: uuid.optional(),
    budget_cap_usd: z.number().min(0).max(10000),
    tester_payment_usd: z.number().min(0).max(1000),
    agent_reward_usd: z.number().min(0).max(1000).optional().default(0),
    client_contribution_usd: z.number().min(0).max(10000).optional().default(0),
  }),
  async run(ctx: ToolContext, input) {
    const c = ctx.actor.credential;
    if (c.study_id) throw new AgentError('forbidden', 'Esta credencial está limitada a un estudio: no puede crear otros.', 403);
    const product = await productInfo(ctx.worker, c.product_id);
    let baseline = input.baseline_version_id ?? null;
    if (baseline) {
      const v = await ctx.worker.from('versions').select('id, status, product_id').eq('id', baseline).maybeSingle();
      if (!v.data || v.data.product_id !== c.product_id || v.data.status !== 'ready') throw new AgentError('invalid_version', 'La versión base no existe en este producto o no está lista.', 422);
    } else {
      const v = await ctx.worker.from('versions').select('id').eq('product_id', c.product_id).eq('status', 'ready').eq('origin', 'repository').order('created_at').limit(1).maybeSingle();
      baseline = v.data?.id ?? null;
    }
    if (!baseline) throw new AgentError('no_version', 'El producto no tiene una versión base lista.', 409);
    const planned = Math.round(input.tester_payment_usd * 100) * input.participants;
    if (planned > Math.round(input.budget_cap_usd * 100)) throw new AgentError('budget_too_low', `El límite de gasto no cubre el pago a ${input.participants} personas (${(planned / 100).toFixed(2)} USD).`, 422, { minimum_usd: planned / 100 });
    const owner = product.owner_id;
    const study = await createStudyDraft(ctx.worker, ctx.worker, owner, {
      title: input.title ?? `Estudio: ${input.question.slice(0, 80)}`,
      question: input.question,
      objective: input.objective,
      objective_detail: input.objective_detail,
      audience: input.audience,
      task: input.task,
      participants_target: input.participants,
      session_minutes: input.session_minutes,
      budget_cap_cents: Math.round(input.budget_cap_usd * 100),
      tester_payment_cents: Math.round(input.tester_payment_usd * 100),
      agent_reward_cents: Math.round(input.agent_reward_usd * 100),
      client_contribution_cents: Math.round(input.client_contribution_usd * 100),
      analysis_estimate_cents: 200,
      operation_estimate_cents: 300,
    }, { productId: c.product_id, baselineVersionId: baseline, createdVia: 'agent_api' });
    const publish = await publishDecision(ctx, study);
    return {
      study_id: study.id,
      status: study.status,
      objective: { key: input.objective, label: OBJECTIVE_LABEL[input.objective] },
      estimate_usd: {
        human_payments_max: (input.tester_payment_usd * input.participants * 2),
        agent_rewards_max: input.agent_reward_usd * 2,
        analysis: 2,
        operation: 3,
        client_contribution: input.client_contribution_usd,
        subsidy_required: Math.max(0, input.tester_payment_usd * input.participants * 2 + input.agent_reward_usd * 2 + 5 - input.client_contribution_usd),
      },
      spend_limit_usd: input.budget_cap_usd,
      payments_mode: 'test',
      publish,
      review_url: `${env.siteUrl}/lab/estudios/${study.id}`,
    };
  },
});

async function publishDecision(ctx: ToolContext, study: { id: string; budget_cap_cents: number }) {
  const product = await productInfo(ctx.worker, ctx.actor.credential.product_id);
  const policy = product.spending_policy ?? {};
  const hasCap = ctx.actor.credential.capabilities.includes('study:publish');
  const withinPolicy = Boolean(policy.agent_can_publish) && study.budget_cap_cents <= (policy.max_budget_cents ?? 0);
  return {
    agent_can_publish: hasCap && withinPolicy,
    requires_approval: !(hasCap && withinPolicy),
    why: !hasCap ? 'La credencial no tiene la capacidad study:publish.' : !policy.agent_can_publish ? 'El titular no habilitó la publicación por agentes.' : study.budget_cap_cents > (policy.max_budget_cents ?? 0) ? `El límite supera el máximo autorizado (${((policy.max_budget_cents ?? 0) / 100).toFixed(2)} USD).` : null,
    approval_url: `${env.siteUrl}/lab/estudios/${study.id}`,
  };
}

const publishStudyTool = defineTool({
  name: 'publish_study',
  description: 'Publica un borrador si el titular autorizó la publicación por agentes y el límite está dentro de su política de gasto. Si no, devuelve un error con el enlace para aprobarlo a mano. Fija pregunta, objetivo, presupuesto y comprobaciones.',
  capability: 'study:publish' as Capability,
  kinds: ['creator_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({ study_id: uuid }),
  async run(ctx: ToolContext, input) {
    const study = await loadStudy(ctx, input.study_id);
    if (study.status !== 'draft') throw new AgentError('already_published', `El estudio ya está ${study.status}.`, 409);
    const decision = await publishDecision(ctx, study);
    if (!decision.agent_can_publish) throw new AgentError('approval_required', decision.why ?? 'Hace falta la aprobación del titular.', 403, { approval_url: decision.approval_url });
    try {
      const res = await publishStudy(ctx.worker, study.id, { via: 'agent_api' });
      return { study_id: study.id, status: 'published', check_suite_sha256: res.suiteSha, note: 'Pregunta, objetivo, presupuesto y comprobaciones quedaron fijados.' };
    } catch (err) {
      if (err instanceof PublishError) throw new AgentError('invalid_study', err.problems.join(' '), 422, { problems: err.problems });
      throw err;
    }
  },
});

const getStudy = defineTool({
  name: 'get_study',
  description: 'Estado persistido de un estudio: versiones, protocolo y los trabajos visibles para esta credencial.',
  capability: 'evidence:read' as Capability,
  kinds: ['creator_agent', 'participant_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({ study_id: uuid }),
  async run(ctx: ToolContext, input) {
    const study = await loadStudy(ctx, input.study_id);
    const c = ctx.actor.credential;
    const [versions, bounties, jobs, budget] = await Promise.all([
      versionsOf(ctx.worker, study.id),
      ctx.worker.from('bounties').select('id, kind, title, instructions, deliverable, criteria, reward_cents, slots, status').eq('study_id', study.id),
      c.kind === 'creator_agent' ? ctx.worker.from('jobs').select('id, kind, status, attempts, last_error, created_at, finished_at').eq('study_id', study.id).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      c.kind === 'creator_agent' ? ctx.worker.rpc('study_budget', { p_study: study.id }) : Promise.resolve({ data: null }),
    ]);
    const mine = c.kind === 'participant_agent' ? (bounties.data ?? []).filter((b) => b.id === c.bounty_id) : bounties.data ?? [];
    const out: Record<string, unknown> = {
      study_id: study.id,
      title: study.title,
      status: study.status,
      question: study.question,
      objective: study.objective,
      audience: study.audience,
      protocol: study.protocol,
      participants_target: study.participants_target,
      session_minutes: study.session_minutes,
      is_rehearsal: study.is_rehearsal,
      payments_mode: 'test',
      versions,
      bounties: mine.map((b) => ({ ...b, reward_usd: b.reward_cents / 100 })),
    };
    if (c.kind === 'creator_agent') {
      out.jobs = jobs.data;
      out.budget_cents = budget.data;
    }
    return out;
  },
});

const getEvidence = defineTool({
  name: 'get_evidence',
  description:
    'Evidencia de un estudio con observaciones, declaraciones humanas e hipótesis separadas, con referencias y cobertura. Una credencial de creador recibe hallazgos; un agente participante recibe el material en texto (eventos y comentarios) de quienes autorizaron investigación, nunca video.',
  capability: 'evidence:read' as Capability,
  kinds: ['creator_agent', 'participant_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({
    study_id: uuid,
    version_id: uuid.optional(),
    include: z.array(z.enum(['findings', 'sessions'])).optional().describe('Por defecto: findings para creadores, sessions para agentes participantes.'),
    category: category.optional(),
    review_status: z.enum(['unreviewed', 'confirmed', 'corrected', 'rejected']).optional(),
    limit: z.number().int().min(1).max(100).optional().default(50),
  }),
  async run(ctx: ToolContext, input) {
    const study = await loadStudy(ctx, input.study_id);
    const c = ctx.actor.credential;
    const include = new Set(input.include ?? (c.kind === 'creator_agent' ? ['findings'] : ['sessions']));
    if (c.kind === 'participant_agent' && include.has('findings') && c.bounty_id) {
      const b = await ctx.worker.from('bounties').select('kind').eq('id', c.bounty_id).single();
      if (b.data?.kind === 'agent_prediction') include.delete('findings');
    }
    const sessions = await usableSessions(ctx, study.id);
    const scoped = input.version_id ? sessions.filter((s) => s.version_id === input.version_id) : sessions;
    const out: Record<string, unknown> = {
      study_id: study.id,
      objective: study.objective,
      question: study.question,
      coverage: await coverage(ctx.worker, [study.id], input.version_id ?? null),
      sessions_available: scoped.length,
      is_rehearsal: study.is_rehearsal,
    };
    if (c.kind === 'participant_agent') (out.coverage as Record<string, unknown>).note = 'Solo sesiones de personas que autorizaron el uso para investigación.';
    if (include.has('findings') && c.kind === 'creator_agent') {
      let q = ctx.worker.from('evidence').select('*, evidence_sources(*)').eq('study_id', study.id);
      if (input.version_id) q = q.eq('version_id', input.version_id);
      if (input.category) q = q.eq('category', input.category);
      if (input.review_status) q = q.eq('review_status', input.review_status);
      const rows = (await q.order('interval_start_ms').limit(input.limit)).data ?? [];
      out.findings = rows.map((e) => findingOut(e, (e.evidence_sources ?? []) as Array<Record<string, unknown>>));
    }
    if (include.has('sessions')) {
      const mat = await sessionMaterial(ctx.worker, scoped.slice(0, 20));
      out.sessions = scoped.slice(0, 20).map((s, i) => {
        const m = mat.get(s.id)!;
        const rec = s.recordings as unknown as { duration_ms: number | null; status: string } | null;
        return {
          session_id: s.id,
          participant: `P-${i + 1}`,
          version_id: s.version_id,
          version_label: (s.versions as unknown as { label: string } | null)?.label ?? null,
          phase: s.phase,
          recording_ms: rec?.status === 'verified' ? rec.duration_ms : null,
          events: m.events.filter((e) => !['move', 'hidden', 'visible'].includes(e.type)).map((e) => ({ event_id: String(e.id), t_ms: e.t_ms, type: e.type, payload: e.payload })),
          comments: m.feedback.map((f) => ({ feedback_id: f.id, kind: f.kind, t_ms: f.t_ms, question: f.question_key, text: f.body })),
        };
      });
      out.material_notes = ['Los tiempos están en milisegundos desde el comienzo de la grabación.', 'Citá comentarios por feedback_id y eventos por event_id exactos: las referencias inventadas se detectan y no se pagan.'];
    }
    return out;
  },
});

const getMoment = defineTool({
  name: 'get_moment',
  description: 'Un hallazgo: intervalo, comentario, fuentes y acceso temporal al material autorizado. No devuelve datos de otros estudios.',
  capability: 'evidence:read' as Capability,
  kinds: ['creator_agent', 'participant_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({ evidence_id: uuid }),
  async run(ctx: ToolContext, input) {
    const ev = await ctx.worker.from('evidence').select('*, evidence_sources(*)').eq('id', input.evidence_id).maybeSingle();
    if (!ev.data) throw new AgentError('not_found', 'Hallazgo no encontrado para esta credencial', 404);
    await loadStudy(ctx, ev.data.study_id);
    const c = ctx.actor.credential;
    if (c.kind === 'participant_agent') {
      const allowed = new Set((await usableSessions(ctx, ev.data.study_id)).map((s) => s.id));
      if (!allowed.has(ev.data.session_id)) throw new AgentError('not_found', 'Hallazgo no encontrado para esta credencial', 404);
    }
    const out: Record<string, unknown> = { finding: findingOut(ev.data, (ev.data.evidence_sources ?? []) as Array<Record<string, unknown>>) };
    const events = await ctx.worker.from('game_events').select('id, t_ms, type, payload').eq('session_id', ev.data.session_id).gte('t_ms', Math.max(0, ev.data.interval_start_ms - 3000)).lte('t_ms', ev.data.interval_end_ms + 3000).order('seq').limit(200);
    out.events_in_interval = (events.data ?? []).filter((e) => !['move', 'hidden', 'visible'].includes(e.type)).map((e) => ({ event_id: String(e.id), t_ms: e.t_ms, type: e.type, payload: e.payload }));
    if (c.kind === 'creator_agent') {
      const rec = await ctx.worker.from('recordings').select('storage_path, status, mime_type').eq('session_id', ev.data.session_id).maybeSingle();
      if (rec.data?.status === 'verified') {
        const signed = await ctx.worker.storage.from('recordings').createSignedUrl(rec.data.storage_path, 300);
        out.media = signed.data ? { url: `${signed.data.signedUrl}#t=${(ev.data.interval_start_ms / 1000).toFixed(1)},${(ev.data.interval_end_ms / 1000).toFixed(1)}`, expires_in_s: 300, mime_type: rec.data.mime_type, note: 'Acceso temporal. No lo guardes ni lo compartas.' } : { error: 'No se pudo firmar el acceso' };
      } else out.media = null;
    } else out.media = null;
    return out;
  },
});

const PredictionSchema = z.object({
  choice: z.enum(['baseline', 'variant', 'none']).describe('baseline = versión base, variant = la variante, none = sin preferencia.'),
  probabilities: z.object({ baseline: z.number().min(0).max(1), variant: z.number().min(0).max(1), none: z.number().min(0).max(1) }).optional().describe('Opcional. Si se envía, se evalúa con puntaje de Brier.'),
  reasons: z.string().min(10).max(2000),
  uncertainty: z.string().min(5).max(1000),
});

const FindingInput = z.object({
  session_id: uuid,
  start_ms: z.number().int().min(0),
  end_ms: z.number().int().min(1),
  observation: z.string().min(3).max(2000),
  feedback_id: uuid.optional(),
  event_ids: z.array(z.union([z.string(), z.number()])).max(20).optional().default([]),
  hypothesis: z.string().max(2000).optional(),
  alternative: z.string().max(2000).optional(),
  next_test: z.string().max(2000).optional(),
  category: category.optional().default('other'),
  preserve: z.boolean().optional().default(false),
});

const InterventionInput = z.object({
  base_version_id: uuid.optional(),
  summary: z.string().min(5).max(1000),
  rationale: z.string().min(10).max(4000),
  evidence_ids: z.array(uuid).max(30),
  preserve: z.string().max(1000).optional().default(''),
  expected_effect: z.string().max(1000).optional(),
  risks: z.string().max(1000).optional(),
  edits: z.array(z.object({ find: z.string().min(1).max(20000), replace: z.string().max(30000), reason: z.string().max(500).optional() })).min(1).max(24),
});

const submitWork = defineTool({
  name: 'submit_agent_work',
  description:
    'Entrega trabajo de un bounty de agente. kind=prediction (una por credencial; queda fechada antes de revelar resultados y, si ya existen o ya los viste, cuenta como análisis retrospectivo), kind=analysis (hallazgos con intervalo y fuentes exactas; se verifican) o kind=intervention (solo credenciales de creador: ediciones find/replace dentro de las regiones editables).',
  capability: 'work:submit' as Capability,
  kinds: ['creator_agent', 'participant_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({
    study_id: uuid,
    bounty_id: uuid.optional(),
    kind: z.enum(['prediction', 'analysis', 'intervention']),
    prediction: PredictionSchema.optional(),
    findings: z.array(FindingInput).max(30).optional(),
    intervention: InterventionInput.optional(),
  }),
  async run(ctx: ToolContext, input) {
    const study = await loadStudy(ctx, input.study_id);
    const c = ctx.actor.credential;
    if (['draft', 'completed', 'archived'].includes(study.status)) throw new AgentError('study_closed', `El estudio está ${study.status}: no recibe entregas.`, 409);
    let bounty: { id: string; kind: string; reward_cents: number; status: string } | null = null;
    if (c.kind === 'participant_agent') {
      if (!c.bounty_id) throw new AgentError('forbidden', 'La credencial no está asociada a un bounty.', 403);
      const b = await ctx.worker.from('bounties').select('id, kind, reward_cents, status, study_id').eq('id', c.bounty_id).single();
      if (!b.data || b.data.study_id !== study.id) throw new AgentError('forbidden', 'La credencial no corresponde a este estudio.', 403);
      if (input.bounty_id && input.bounty_id !== b.data.id) throw new AgentError('forbidden', 'La credencial solo trabaja sobre su bounty.', 403);
      bounty = b.data;
      const expected = bounty.kind === 'agent_prediction' ? 'prediction' : bounty.kind === 'agent_analysis' ? 'analysis' : 'intervention';
      if (input.kind !== expected) throw new AgentError('wrong_kind', `Este bounty espera kind=${expected}.`, 422);
      if (input.kind === 'intervention') throw new AgentError('not_available', 'En el MVP las intervenciones las realiza el agente creador: abrirlo a participantes externos requiere ejecución aislada.', 403);
      if (bounty.status !== 'open') throw new AgentError('bounty_closed', 'El bounty no está abierto.', 409);
    }
    const dup = await ctx.worker.from('agent_submissions').select('id').eq('credential_id', c.id).eq('study_id', study.id).eq('kind', input.kind === 'intervention' ? 'intervention' : input.kind).limit(1);
    if (input.kind !== 'intervention' && (dup.data ?? []).length) throw new AgentError('already_submitted', 'Esta credencial ya entregó este tipo de trabajo para el estudio (una entrega por credencial).', 409);

    if (input.kind === 'prediction') return submitPrediction(ctx, study, bounty, input.prediction);
    if (input.kind === 'analysis') return submitAnalysis(ctx, study, bounty, input.findings);
    return submitIntervention(ctx, study, input.intervention);
  },
});

async function chargeAgentReward(ctx: ToolContext, studyId: string, submissionId: string, cents: number, note: string) {
  if (cents <= 0) return { paid: false, amount_usd: 0, reason: 'Sin recompensa configurada' };
  const r = await ctx.worker.rpc('reserve_budget', { p_study: studyId, p_kind: 'agent_reward', p_amount: cents, p_key: `agent_reward:${submissionId}`, p_submission: submissionId, p_note: note });
  if (r.error || !r.data?.ok) return { paid: false, amount_usd: 0, reason: r.data?.reason === 'budget_exhausted' ? 'Presupuesto agotado: la entrega se registró sin recompensa.' : (r.error?.message ?? 'No se pudo reservar') };
  await ctx.worker.from('payment_events').upsert({ study_id: studyId, provider: 'internal', event_type: 'test_agent_reward_recorded', external_id: `agent_reward:${submissionId}`, signature_verified: true, payload: { submission_id: submissionId, amount_cents: cents, note: 'Registro interno en modo prueba, para el operador del agente. No es una transferencia.' } }, { onConflict: 'external_id', ignoreDuplicates: true });
  return { paid: true, amount_usd: cents / 100, reason: 'Recompensa de prueba registrada para el operador del agente' };
}

async function submitPrediction(ctx: ToolContext, study: StudyRow, bounty: { reward_cents: number } | null, prediction: z.infer<typeof PredictionSchema> | undefined) {
  if (!prediction) throw new AgentError('invalid_input', 'Falta el campo prediction.', 400);
  const versions = await versionsOf(ctx.worker, study.id);
  const baseline = versions.find((v) => v.role === 'baseline');
  const variant = versions.find((v) => v.role === 'variant' && v.status === 'ready');
  if (!baseline || !variant) throw new AgentError('variant_not_ready', 'Todavía no hay dos versiones listas para predecir.', 409);
  if (prediction.probabilities) {
    const sum = prediction.probabilities.baseline + prediction.probabilities.variant + prediction.probabilities.none;
    if (Math.abs(sum - 1) > 0.02) throw new AgentError('invalid_input', `Las probabilidades deben sumar 1 (suman ${sum.toFixed(2)}).`, 422);
  }
  const c = ctx.actor.credential;
  const results = await ctx.worker.from('comparisons').select('id', { count: 'exact', head: true }).eq('study_id', study.id);
  const resultsExisted = (results.count ?? 0) > 0;
  const labelsSeen = Boolean(c.labels_seen_at);
  const retrospective = resultsExisted || labelsSeen;
  const payload = { ...prediction, baseline_version_id: baseline.version_id, variant_version_id: variant.version_id };
  const ins = await ctx.worker
    .from('agent_submissions')
    .insert({ study_id: study.id, bounty_id: bounty ? c.bounty_id : null, credential_id: c.id, actor: `${c.label} (credencial ${c.kind === 'creator_agent' ? 'de creador' : 'de participante'})`, kind: 'prediction', input_version_ids: [baseline.version_id, variant.version_id], payload, is_retrospective: retrospective, results_existed: resultsExisted, status: 'received' })
    .select('id, created_at')
    .single();
  if (ins.error) throw new Error(`Registrar predicción: ${ins.error.message}`);
  const summary = await comparisonSummary(ctx.worker, study.id);
  const evaluation = evaluatePrediction(payload as PredictionPayload, retrospective, summary);
  await ctx.worker.from('agent_submissions').update({ evaluation, status: 'evaluated', evaluated_at: new Date().toISOString() }).eq('id', ins.data.id);
  const reward = bounty && !retrospective ? await chargeAgentReward(ctx, study.id, ins.data.id, bounty.reward_cents, 'Predicción válida registrada antes de revelar resultados') : { paid: false, amount_usd: 0, reason: retrospective ? 'No cuenta como predicción: hay resultados humanos o ya los viste.' : 'Sin bounty asociado' };
  return {
    submission_id: ins.data.id,
    kind: 'prediction',
    recorded_at: ins.data.created_at,
    is_retrospective: retrospective,
    status: retrospective ? 'Registrada como análisis retrospectivo' : 'Registrada antes de revelar resultados humanos',
    evaluation,
    reward,
    note: 'La recompensa depende de que la predicción sea válida y esté fechada antes de los resultados, no de acertar.',
  };
}

async function submitAnalysis(ctx: ToolContext, study: StudyRow, bounty: { reward_cents: number } | null, findings: z.infer<typeof FindingInput>[] | undefined) {
  if (!findings || !findings.length) throw new AgentError('invalid_input', 'Falta el campo findings con al menos un hallazgo.', 400);
  const c = ctx.actor.credential;
  const sessions = await usableSessions(ctx, study.id);
  const material = await sessionMaterial(ctx.worker, sessions);
  const allowed = new Set(sessions.map((s) => s.id));
  const validated: Array<ValidatedFinding & { session_id: string; inventedReferences: number; hypothesisRaw: string | null }> = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  findings.forEach((f, i) => {
    if (!allowed.has(f.session_id)) {
      rejected.push({ index: i, reason: 'La sesión no existe en el material disponible para esta credencial.' });
      return;
    }
    const m = material.get(f.session_id)!;
    const proposed: ProposedFinding = {
      start_ms: f.start_ms,
      end_ms: f.end_ms,
      observation: f.observation,
      feedback_ref: f.feedback_id ?? null,
      event_refs: f.event_ids.map(String),
      visual_basis: null,
      hypothesis: f.hypothesis ?? null,
      alternative: f.alternative ?? null,
      next_test: f.next_test ?? null,
      category: f.category,
      preserve: f.preserve,
    };
    const v = validateFinding(proposed, m.material);
    const invented = v.notes.filter((n) => /no existe/i.test(n)).length;
    validated.push({ ...v, session_id: f.session_id, inventedReferences: invented, hypothesisRaw: f.hypothesis ?? null });
  });
  const evaluation = evaluateAnalysis(validated, sessions.length);
  if (rejected.length) {
    evaluation.valid = false;
    evaluation.reasons.push(`${rejected.length} hallazgo(s) apuntan a sesiones fuera del material disponible.`);
  }
  const sub = await ctx.worker
    .from('agent_submissions')
    .insert({ study_id: study.id, bounty_id: bounty ? c.bounty_id : null, credential_id: c.id, actor: `${c.label} (credencial ${c.kind === 'creator_agent' ? 'de creador' : 'de participante'})`, kind: 'analysis', payload: { findings, rejected }, evaluation, status: 'evaluated', evaluated_at: new Date().toISOString() })
    .select('id, created_at')
    .single();
  if (sub.error) throw new Error(`Registrar análisis: ${sub.error.message}`);
  const evidenceIds: string[] = [];
  for (const v of validated) {
    const ses = sessions.find((s) => s.id === v.session_id)!;
    const ev = await ctx.worker
      .from('evidence')
      .insert({
        study_id: study.id,
        version_id: ses.version_id,
        session_id: v.session_id,
        origin: 'agent',
        agent_submission_id: sub.data.id,
        interval_start_ms: v.interval_start_ms,
        interval_end_ms: v.interval_end_ms,
        observation: v.observation,
        human_statement_feedback_id: v.feedback_id,
        hypothesis: v.hypothesis,
        alternative: v.alternative,
        next_test: v.next_test,
        category: v.category,
        preserve: v.preserve,
        structural_status: v.structural_status,
        generated_by: { provider: 'agent', actor: c.label, credential_id: c.id },
      })
      .select('id')
      .single();
    if (ev.error) throw new Error(`Guardar hallazgo del agente: ${ev.error.message}`);
    evidenceIds.push(ev.data.id);
    if (v.sources.length) await ctx.worker.from('evidence_sources').insert(v.sources.map((s) => ({ evidence_id: ev.data.id, kind: s.kind, source_id: s.source_id, t_ms: s.t_ms, verified: s.verified, note: s.note })));
  }
  await ctx.worker.from('agent_submissions').update({ evidence_refs: evidenceIds }).eq('id', sub.data.id);
  await syncStudyStatus(ctx.worker, study.id);
  const reward = bounty && evaluation.valid ? await chargeAgentReward(ctx, study.id, sub.data.id, bounty.reward_cents, 'Análisis con fuentes verificables') : { paid: false, amount_usd: 0, reason: evaluation.valid ? 'Sin bounty asociado' : evaluation.reasons.join(' ') };
  return {
    submission_id: sub.data.id,
    kind: 'analysis',
    recorded_at: sub.data.created_at,
    stored_findings: evidenceIds.length,
    evidence_ids: evidenceIds,
    rejected,
    evaluation,
    reward,
  };
}

async function submitIntervention(ctx: ToolContext, study: StudyRow, p: z.infer<typeof InterventionInput> | undefined) {
  if (!p) throw new AgentError('invalid_input', 'Falta el campo intervention.', 400);
  if (ctx.actor.credential.kind !== 'creator_agent') throw new AgentError('forbidden', 'Solo el agente creador puede intervenir.', 403);
  if (!study.check_suite_id) throw new AgentError('not_published', 'Publicá el estudio antes de intervenir: las comprobaciones se fijan al publicar.', 409);
  const versions = await versionsOf(ctx.worker, study.id);
  const baseId = p.base_version_id ?? versions.find((v) => v.role === 'baseline')?.version_id;
  if (!baseId || !versions.some((v) => v.version_id === baseId)) throw new AgentError('invalid_version', 'La versión base no pertenece al estudio.', 422);
  const ev = await ctx.worker.from('evidence').select('id').eq('study_id', study.id).in('id', p.evidence_ids.length ? p.evidence_ids : ['00000000-0000-0000-0000-000000000000']);
  const known = new Set((ev.data ?? []).map((e) => e.id));
  const unknown = p.evidence_ids.filter((id) => !known.has(id));
  if (unknown.length) throw new AgentError('invalid_evidence', 'Algunos hallazgos citados no existen en este estudio.', 422, { unknown });
  const c = ctx.actor.credential;
  const sub = await ctx.worker
    .from('agent_submissions')
    .insert({ study_id: study.id, credential_id: c.id, actor: `${c.label} (credencial de creador)`, kind: 'intervention', input_version_ids: [baseId], payload: p, evidence_refs: p.evidence_ids, status: 'received' })
    .select('id')
    .single();
  if (sub.error) throw new Error(`Registrar intervención: ${sub.error.message}`);
  const res = await materializeIntervention(ctx.worker, {
    studyId: study.id,
    baseVersionId: baseId,
    actor: `${c.label} (credencial de creador)`,
    objective: study.objective,
    proposal: { summary: p.summary, rationale: p.rationale, evidence_ids: p.evidence_ids, preserve: p.preserve, edits: p.edits, expected_effect: p.expected_effect, risks: p.risks },
    submissionId: sub.data.id,
  });
  if (!res.ok) {
    await ctx.worker.from('agent_submissions').update({ status: 'rejected', evaluation: { accepted: false, errors: res.errors } }).eq('id', sub.data.id);
    throw new AgentError('scope_violation', 'El cambio no cumple el alcance permitido.', 422, { errors: res.errors, intervention_id: res.interventionId });
  }
  await ctx.worker.from('agent_submissions').update({ status: 'received', evaluation: { accepted: true, version_id: res.versionId, checks_job_id: res.checksJobId } }).eq('id', sub.data.id);
  return { submission_id: sub.data.id, kind: 'intervention', intervention_id: res.interventionId, version_id: res.versionId, version_label: res.label, checks_job_id: res.checksJobId, status: 'En comprobación: la variante llega a las personas solo si pasa las comprobaciones fijadas. Consultá get_study.' };
}

const compareVersions = defineTool({
  name: 'compare_versions',
  description: 'Preferencias humanas entre versiones exactas: motivos, orden, denominador y limitaciones. Puede devolver «pendiente» o «sin preferencia». Al consultar resultados, tus predicciones posteriores cuentan como retrospectivas.',
  capability: 'results:read' as Capability,
  kinds: ['creator_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({ study_id: uuid }),
  async run(ctx: ToolContext, input) {
    const study = await loadStudy(ctx, input.study_id);
    const s = await comparisonSummary(ctx.worker, study.id);
    if (s.total > 0 && !ctx.actor.credential.labels_seen_at) {
      await ctx.worker.from('agent_credentials').update({ labels_seen_at: new Date().toISOString() }).eq('id', ctx.actor.credential.id);
    }
    return {
      study_id: study.id,
      status: s.total === 0 ? 'pendiente' : 'con_resultados',
      objective: study.objective,
      versions: { baseline: s.baseline, variant: s.variant },
      denominator: s.total,
      prefer_baseline: s.preferBaseline,
      prefer_variant: s.preferVariant,
      no_preference: s.noPreference,
      by_order: s.byOrder,
      prior_exposure: s.priorExposure,
      answers: s.reasons,
      limitations: s.limitations,
      is_rehearsal: study.is_rehearsal,
      note: s.total === 0 ? 'Todavía no hay comparaciones humanas. No se infiere ninguna preferencia.' : 'Resultados de una muestra pequeña: describen esta prueba, no el mercado.',
    };
  },
});

const exportDataset = defineTool({
  name: 'export_dataset',
  description: 'Pide un export privado de ejemplos autorizados. Solo incluye material con permisos vigentes del titular y de cada participante, y hallazgos revisados. Nunca incluye video crudo. Devuelve un trabajo; consultá get_export.',
  capability: 'export:request' as Capability,
  kinds: ['creator_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({
    study_id: uuid,
    purpose: z.string().min(5).max(500),
    fields: z.array(z.enum(EXPORT_FIELDS)).min(1).optional().default([...EXPORT_FIELDS]),
    format: z.enum(['json', 'jsonl']).optional().default('json'),
  }),
  async run(ctx: ToolContext, input) {
    const study = await loadStudy(ctx, input.study_id);
    const exp = await requestExport(ctx.worker, { studyId: study.id, userId: null, purpose: input.purpose, fields: input.fields, format: input.format, via: 'agent_api' });
    return { export_id: exp.id, status: exp.status, blocked_reason: exp.blocked_reason, note: exp.status === 'blocked' ? 'Faltan permisos: explicamos cuáles en blocked_reason.' : 'En preparación. Consultá get_export.' };
  },
});

const getExport = defineTool({
  name: 'get_export',
  description: 'Estado de un export y, si está listo, una URL privada y temporal de descarga.',
  capability: 'export:request' as Capability,
  kinds: ['creator_agent'] as Array<'creator_agent' | 'participant_agent'>,
  schema: z.object({ export_id: uuid }),
  async run(ctx: ToolContext, input) {
    const exp = await ctx.worker.from('dataset_exports').select('*').eq('id', input.export_id).maybeSingle();
    if (!exp.data) throw new AgentError('not_found', 'Export no encontrado', 404);
    await loadStudy(ctx, exp.data.study_id);
    const out: Record<string, unknown> = { export_id: exp.data.id, status: exp.data.status, blocked_reason: exp.data.blocked_reason, manifest: exp.data.manifest, excluded: exp.data.excluded, expires_at: exp.data.expires_at };
    if (exp.data.status === 'ready' && exp.data.storage_path && (!exp.data.expires_at || new Date(exp.data.expires_at).getTime() > Date.now())) {
      const signed = await ctx.worker.storage.from('exports').createSignedUrl(exp.data.storage_path, 300);
      if (signed.data) out.download = { url: signed.data.signedUrl, expires_in_s: 300 };
    }
    return out;
  },
});

export const TOOLS = [requestEvidence, createStudyTool, publishStudyTool, getStudy, getEvidence, getMoment, submitWork, compareVersions, exportDataset, getExport] as unknown as Array<ToolDef<z.ZodType>>;

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolCatalog() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    capability: t.capability,
    capability_description: CAPABILITIES[t.capability],
    credential_kinds: t.kinds,
    input_schema: z.toJSONSchema(t.schema, { target: 'draft-7' }),
  }));
}

// -------------------------------------------------------------- execution

const RATE_LIMIT_PER_MINUTE = 90;

function summarize(out: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) s[k] = `${v.length} elementos`;
    else if (v && typeof v === 'object') s[k] = '[objeto]';
    else if (typeof v === 'string') s[k] = v.length > 120 ? `${v.slice(0, 120)}…` : v;
    else s[k] = v;
  }
  return s;
}

function sanitizeInput(input: unknown): Record<string, unknown> {
  const raw = JSON.stringify(input ?? {});
  if (raw.length <= 4000) return (input ?? {}) as Record<string, unknown>;
  return { _truncated: true, size_bytes: raw.length, keys: input && typeof input === 'object' ? Object.keys(input as object) : [] };
}

/** Authenticates nothing: the caller passes an actor. Validates, authorizes, runs and logs one tool call. */
export async function executeTool(worker: SupabaseClient, actor: AgentActor, name: string, rawInput: unknown, transport: 'rest' | 'mcp'): Promise<Record<string, unknown>> {
  const tool = TOOL_BY_NAME.get(name);
  const started = Date.now();
  const c = actor.credential;
  let studyId: string | null = c.study_id;
  const log = async (status: 'ok' | 'error' | 'denied', code: string | null, out?: Record<string, unknown>) => {
    const input = (rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {}) as Record<string, unknown>;
    if (!studyId && typeof input.study_id === 'string') studyId = input.study_id;
    // A log row must never expose a study the credential cannot see.
    if (studyId) {
      const s = await worker.from('studies').select('product_id').eq('id', studyId).maybeSingle();
      if (!s.data || s.data.product_id !== c.product_id) studyId = null;
    }
    await worker.from('agent_tool_calls').insert({ credential_id: c.id, study_id: studyId, tool: name.slice(0, 60), transport, input: sanitizeInput(rawInput), output_summary: out ? summarize(out) : {}, status, error_code: code, duration_ms: Date.now() - started });
  };
  try {
    if (!tool) throw new AgentError('unknown_tool', `Herramienta desconocida: ${name}`, 404);
    if (!tool.kinds.includes(c.kind)) throw new AgentError('forbidden', `Esta herramienta no está disponible para credenciales de ${c.kind === 'creator_agent' ? 'creador' : 'agente participante'}.`, 403);
    requireCapability(actor, tool.capability);
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await worker.from('agent_tool_calls').select('id', { count: 'exact', head: true }).eq('credential_id', c.id).gte('created_at', since);
    if ((recent.count ?? 0) >= RATE_LIMIT_PER_MINUTE) throw new AgentError('rate_limited', `Demasiadas llamadas (${RATE_LIMIT_PER_MINUTE} por minuto). Esperá un momento.`, 429);
    const parsed = tool.schema.safeParse(rawInput ?? {});
    if (!parsed.success) throw new AgentError('invalid_input', 'Entrada inválida', 400, { issues: parsed.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const out = await tool.run({ worker, actor, transport }, parsed.data);
    await log('ok', null, out);
    return out;
  } catch (err) {
    if (err instanceof AgentError) {
      await log(err.status === 403 || err.status === 401 ? 'denied' : 'error', err.code).catch(() => undefined);
      throw err;
    }
    await log('error', 'server_error').catch(() => undefined);
    throw err;
  }
}
