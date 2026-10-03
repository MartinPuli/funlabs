import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Internal budget ledger. Every amount is test mode during the MVP. A
 * reservation is not an escrow and a payout entry is not a transfer: they
 * record what FUNLABS committed for each valid delivery.
 */

export type BudgetSummary = {
  cap: number;
  reserved: number;
  paid: number;
  agent_rewards: number;
  analysis: number;
  operation: number;
  committed: number;
  remaining: number;
  contribution_recorded: number;
  contribution_planned: number;
  subsidy_required: number;
  planned: { testers: number; agent_rewards: number; analysis: number; operation: number; contribution: number; subsidy: number };
  test_mode: true;
};

async function reservedFor(worker: SupabaseClient, assignmentId: string, phase: 'playtest' | 'comparison') {
  const key = `reserve:${assignmentId}:${phase}`;
  const { data } = await worker.from('budget_entries').select('id, study_id, amount_cents').eq('idempotency_key', key).maybeSingle();
  return data;
}

/** A valid delivery is paid (test mode) regardless of what the person thought of the game. */
export async function settleDelivery(worker: SupabaseClient, delivery: { id: string; assignment_id: string; phase: 'playtest' | 'comparison'; study_id: string }, valid: boolean, note: string) {
  const reservation = await reservedFor(worker, delivery.assignment_id, delivery.phase);
  const amount = reservation?.amount_cents ?? 0;
  if (reservation) {
    await worker.from('budget_entries').upsert(
      { study_id: delivery.study_id, kind: 'release', amount_cents: amount, assignment_id: delivery.assignment_id, delivery_id: delivery.id, idempotency_key: `release:${delivery.assignment_id}:${delivery.phase}`, note: valid ? 'Reserva aplicada al pago' : `Reserva liberada: ${note}` },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  }
  if (valid && amount > 0) {
    await worker.from('budget_entries').upsert(
      { study_id: delivery.study_id, kind: 'payout', amount_cents: amount, assignment_id: delivery.assignment_id, delivery_id: delivery.id, idempotency_key: `payout:${delivery.id}`, note: 'Pago por entrega válida (modo prueba)' },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    await worker.from('payment_events').upsert(
      { study_id: delivery.study_id, provider: 'internal', event_type: 'test_payout_recorded', external_id: `payout:${delivery.id}`, signature_verified: true, payload: { delivery_id: delivery.id, amount_cents: amount, note: 'Registro interno en modo prueba. No es una transferencia.' } },
      { onConflict: 'external_id', ignoreDuplicates: true },
    );
  }
  return { amount, paid: valid && amount > 0 };
}

export async function releaseAssignment(worker: SupabaseClient, studyId: string, assignmentId: string, why: string) {
  for (const phase of ['playtest', 'comparison'] as const) {
    const reservation = await reservedFor(worker, assignmentId, phase);
    if (!reservation) continue;
    const paid = await worker.from('budget_entries').select('id').eq('assignment_id', assignmentId).eq('kind', 'release').eq('idempotency_key', `release:${assignmentId}:${phase}`).maybeSingle();
    if (paid.data) continue;
    await worker.from('budget_entries').upsert(
      { study_id: studyId, kind: 'release', amount_cents: reservation.amount_cents, assignment_id: assignmentId, idempotency_key: `release:${assignmentId}:${phase}`, note: why },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  }
}

export function money(cents: number | null | undefined, currency = 'usd'): string {
  const v = (cents ?? 0) / 100;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2 }).format(v);
}
