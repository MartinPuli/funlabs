import type { SupabaseClient } from '@supabase/supabase-js';

export type ComparisonRow = {
  id: string;
  assignment_id: string;
  first_version_id: string;
  second_version_id: string;
  first_label: string;
  second_label: string;
  choice: 'first' | 'second' | 'none';
  preferred_version_id: string | null;
  reason: string;
  prior_exposure: boolean;
  created_at: string;
};

export type ComparisonSummary = {
  baseline: { id: string; label: string } | null;
  variant: { id: string; label: string } | null;
  total: number;
  preferBaseline: number;
  preferVariant: number;
  noPreference: number;
  byOrder: { baselineFirst: { total: number; preferBaseline: number; preferVariant: number; none: number }; variantFirst: { total: number; preferBaseline: number; preferVariant: number; none: number } };
  priorExposure: number;
  reasons: Array<{ participant: string; preferred: 'baseline' | 'variant' | 'none'; presented: string; reason: string; prior_exposure: boolean; created_at: string }>;
  limitations: string[];
};

/** Aggregates comparisons honestly: denominators, ties and limitations included. */
export async function comparisonSummary(client: SupabaseClient, studyId: string): Promise<ComparisonSummary> {
  const [sv, comps, assignments] = await Promise.all([
    client.from('study_versions').select('version_id, role, versions(label, status)').eq('study_id', studyId),
    client.from('comparisons').select('*').eq('study_id', studyId).order('created_at'),
    client.from('assignments').select('id, participant_code').eq('study_id', studyId),
  ]);
  const baselineRow = (sv.data ?? []).find((r) => r.role === 'baseline');
  const variantRow = (sv.data ?? []).find((r) => r.role === 'variant');
  const label = (r: typeof baselineRow) => (r?.versions as unknown as { label: string } | null)?.label ?? '?';
  const baseline = baselineRow ? { id: baselineRow.version_id, label: label(baselineRow) } : null;
  const variant = variantRow ? { id: variantRow.version_id, label: label(variantRow) } : null;
  const codes = new Map((assignments.data ?? []).map((a) => [a.id, a.participant_code]));
  const rows = (comps.data ?? []) as ComparisonRow[];

  const empty = () => ({ total: 0, preferBaseline: 0, preferVariant: 0, none: 0 });
  const out: ComparisonSummary = {
    baseline,
    variant,
    total: rows.length,
    preferBaseline: 0,
    preferVariant: 0,
    noPreference: 0,
    byOrder: { baselineFirst: empty(), variantFirst: empty() },
    priorExposure: 0,
    reasons: [],
    limitations: [],
  };
  for (const r of rows) {
    const pref = r.preferred_version_id === null ? 'none' : r.preferred_version_id === baseline?.id ? 'baseline' : 'variant';
    if (pref === 'baseline') out.preferBaseline++;
    else if (pref === 'variant') out.preferVariant++;
    else out.noPreference++;
    const bucket = r.first_version_id === baseline?.id ? out.byOrder.baselineFirst : out.byOrder.variantFirst;
    bucket.total++;
    if (pref === 'baseline') bucket.preferBaseline++;
    else if (pref === 'variant') bucket.preferVariant++;
    else bucket.none++;
    if (r.prior_exposure) out.priorExposure++;
    out.reasons.push({
      participant: codes.get(r.assignment_id) ?? 'P-?',
      preferred: pref,
      presented: `${r.first_label} first, then ${r.second_label}`,
      reason: r.reason,
      prior_exposure: r.prior_exposure,
      created_at: r.created_at,
    });
  }
  if (out.total > 0 && out.total < 30) out.limitations.push(`Sample of ${out.total} ${out.total === 1 ? 'person' : 'people'}: it describes what happened in this test and does not allow statistical conclusions or extrapolating to a market.`);
  if (out.priorExposure > 0) out.limitations.push(`${out.priorExposure} of ${out.total} had already played the baseline version: knowing the puzzle can favor the second version they play.`);
  if (out.byOrder.baselineFirst.total !== out.byOrder.variantFirst.total) out.limitations.push('The presentation order was not balanced.');
  return out;
}

export type PredictionPayload = {
  choice: 'baseline' | 'variant' | 'none';
  probabilities?: { baseline?: number; variant?: number; none?: number } | null;
  reasons: string;
  uncertainty: string;
};

export type PredictionEvaluation = {
  status: 'pending' | 'evaluated' | 'retrospective';
  observed: { total: number; baseline: number; variant: number; none: number };
  observedMajority: 'baseline' | 'variant' | 'none' | 'tie' | null;
  matchedMajority: boolean | null;
  brier: number | null;
  note: string;
};

/** Compares a dated prediction with the human preferences recorded afterwards. */
export function evaluatePrediction(pred: PredictionPayload, isRetrospective: boolean, s: Pick<ComparisonSummary, 'total' | 'preferBaseline' | 'preferVariant' | 'noPreference'>): PredictionEvaluation {
  const observed = { total: s.total, baseline: s.preferBaseline, variant: s.preferVariant, none: s.noPreference };
  if (s.total === 0) return { status: 'pending', observed, observedMajority: null, matchedMajority: null, brier: null, note: 'There are no human comparisons yet.' };
  const counts: Array<['baseline' | 'variant' | 'none', number]> = [
    ['baseline', s.preferBaseline],
    ['variant', s.preferVariant],
    ['none', s.noPreference],
  ];
  const max = Math.max(...counts.map((c) => c[1]));
  const leaders = counts.filter((c) => c[1] === max);
  const majority = leaders.length > 1 ? 'tie' : leaders[0][0];
  let brier: number | null = null;
  const p = pred.probabilities;
  if (p && [p.baseline, p.variant, p.none].every((v) => typeof v === 'number')) {
    const sum = (p.baseline ?? 0) + (p.variant ?? 0) + (p.none ?? 0);
    if (sum > 0) {
      const probs = { baseline: (p.baseline ?? 0) / sum, variant: (p.variant ?? 0) / sum, none: (p.none ?? 0) / sum };
      // Mean multi-class Brier score over each human answer (lower is better).
      let total = 0;
      for (const [k, n] of counts) {
        for (let i = 0; i < n; i++) total += (['baseline', 'variant', 'none'] as const).reduce((acc, c) => acc + (probs[c] - (c === k ? 1 : 0)) ** 2, 0);
      }
      brier = Math.round((total / s.total) * 1000) / 1000;
    }
  }
  const matched = majority === 'tie' ? null : pred.choice === majority;
  const note = isRetrospective
    ? 'Recorded after seeing human results: it counts as retrospective analysis, not as a prediction.'
    : majority === 'tie'
      ? 'People did not agree on a majority; the prediction cannot be compared with a winner.'
      : `${matched ? 'Matches' : 'Does not match'} the majority of ${s.total}. A single hit does not prove general judgment.`;
  return { status: isRetrospective ? 'retrospective' : 'evaluated', observed, observedMajority: majority, matchedMajority: isRetrospective ? null : matched, brier: isRetrospective ? null : brier, note };
}
