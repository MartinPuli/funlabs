import { NextResponse } from 'next/server';
import { z } from 'zod';
import { workerClient } from '@/lib/supabase/worker';
import { bearer } from '@/lib/tokens';
import {
  acceptInvite,
  addMoment,
  appendEvents,
  confirmRecording,
  createUploadUrl,
  myEvidence,
  participantNote,
  setResearchConsent,
  startPhase,
  submitComparison,
  submitPlaytest,
  TesterError,
  testerState,
  withdraw,
} from '@/lib/tester';
import { releaseAssignment } from '@/lib/budget';

export const dynamic = 'force-dynamic';

const schemas = {
  state: z.object({}),
  accept: z.object({ participation: z.boolean(), research: z.boolean(), training: z.boolean() }),
  start: z.object({ phase: z.enum(['playtest', 'comparison']) }),
  events: z.object({
    session_id: z.string().uuid(),
    events: z.array(z.object({ seq: z.number().int().min(0), t_ms: z.number().min(0), type: z.string().min(1).max(40), payload: z.record(z.string(), z.unknown()).optional(), clock: z.enum(['recording', 'session']).optional() })).max(500),
  }),
  moment: z.object({ session_id: z.string().uuid(), t_ms: z.number().min(0).nullable(), body: z.string().min(1).max(4000) }),
  'upload-url': z.object({ session_id: z.string().uuid(), mime_type: z.string().min(3).max(100), method: z.string().max(40) }),
  'confirm-recording': z.object({ session_id: z.string().uuid(), duration_ms: z.number().min(0).nullable(), has_audio: z.boolean(), bytes: z.number().min(0).nullable(), surface: z.string().max(40).nullable().optional(), cropped: z.boolean().optional() }),
  submit: z.object({ session_id: z.string().uuid(), answers: z.record(z.string(), z.string().max(4000)) }),
  compare: z.object({ choice: z.enum(['first', 'second', 'none']), reason: z.string().min(1).max(2000) }),
  consent: z.object({ purpose: z.enum(['research_sharing', 'model_training']), granted: z.boolean() }),
  evidence: z.object({}),
  note: z.object({ evidence_id: z.string().uuid(), note: z.string().min(1).max(2000) }),
  withdraw: z.object({}),
} as const;

type Action = keyof typeof schemas;

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!(action in schemas)) return NextResponse.json({ error: { code: 'unknown_action', message: 'Unknown action' } }, { status: 404 });
  const token = bearer(request.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: { code: 'missing_token', message: 'The invite is missing' } }, { status: 401 });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = schemas[action as Action].safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: 'invalid_input', message: 'Invalid data', issues: parsed.error.issues.slice(0, 5) } }, { status: 400 });
  const input = parsed.data as Record<string, never>;

  try {
    const worker = await workerClient();
    switch (action as Action) {
      case 'state': {
        const s = await testerState(worker, token);
        return NextResponse.json({
          phase: s.phase,
          study: { title: s.ctx.study.title, status: s.ctx.study.status, session_minutes: s.ctx.study.session_minutes, payment_cents: s.ctx.study.tester_payment_cents, currency: s.ctx.study.currency, protocol: s.ctx.study.protocol, rehearsal: s.ctx.study.is_rehearsal },
          bounty: { title: s.ctx.bounty.title, instructions: s.ctx.bounty.instructions, deliverable: s.ctx.bounty.deliverable, criteria: s.ctx.bounty.criteria },
          assignment: s.ctx.assignment ? { code: s.ctx.assignment.participant_code, status: s.ctx.assignment.status } : null,
          sessions: s.sessions,
          deliveries: s.deliveries,
          consents: s.consents,
          comparison: { open: s.comparisonOpen, done: s.comparisonDone },
        });
      }
      case 'accept': {
        const p = parsed.data as z.infer<(typeof schemas)['accept']>;
        const a = await acceptInvite(worker, token, p);
        return NextResponse.json({ assignment: { code: a.participant_code } });
      }
      case 'start': {
        const p = parsed.data as z.infer<(typeof schemas)['start']>;
        return NextResponse.json({ sessions: await startPhase(worker, token, p.phase) });
      }
      case 'events': {
        const p = parsed.data as z.infer<(typeof schemas)['events']>;
        return NextResponse.json(await appendEvents(worker, token, p.session_id, p.events));
      }
      case 'moment': {
        const p = parsed.data as z.infer<(typeof schemas)['moment']>;
        return NextResponse.json({ comment: await addMoment(worker, token, p.session_id, p.t_ms, p.body) });
      }
      case 'upload-url': {
        const p = parsed.data as z.infer<(typeof schemas)['upload-url']>;
        return NextResponse.json(await createUploadUrl(worker, token, p.session_id, p.mime_type, p.method));
      }
      case 'confirm-recording': {
        const p = parsed.data as z.infer<(typeof schemas)['confirm-recording']>;
        return NextResponse.json(await confirmRecording(worker, token, p.session_id, { duration_ms: p.duration_ms, has_audio: p.has_audio, bytes: p.bytes, surface: p.surface ?? null, cropped: p.cropped }));
      }
      case 'submit': {
        const p = parsed.data as z.infer<(typeof schemas)['submit']>;
        return NextResponse.json(await submitPlaytest(worker, token, p.session_id, p.answers));
      }
      case 'compare': {
        const p = parsed.data as z.infer<(typeof schemas)['compare']>;
        return NextResponse.json(await submitComparison(worker, token, p.choice, p.reason));
      }
      case 'consent': {
        const p = parsed.data as z.infer<(typeof schemas)['consent']>;
        return NextResponse.json(await setResearchConsent(worker, token, p.purpose, p.granted));
      }
      case 'evidence':
        return NextResponse.json({ evidence: await myEvidence(worker, token) });
      case 'note': {
        const p = parsed.data as z.infer<(typeof schemas)['note']>;
        return NextResponse.json(await participantNote(worker, token, p.evidence_id, p.note));
      }
      case 'withdraw': {
        const s = await testerState(worker, token);
        const res = await withdraw(worker, token);
        if (s.ctx.assignment) await releaseAssignment(worker, s.ctx.study.id, s.ctx.assignment.id, 'The person withdrew before submitting');
        return NextResponse.json(res);
      }
    }
    void input;
  } catch (err) {
    if (err instanceof TesterError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    console.error('[tester]', action, err);
    return NextResponse.json({ error: { code: 'server_error', message: 'Something failed on our side. Try again.' } }, { status: 500 });
  }
}
