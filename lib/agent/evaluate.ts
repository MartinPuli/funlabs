import type { ValidatedFinding } from '../analysis/validate.ts';

export type AnalysisEvaluation = {
  criteria: {
    /** Findings whose references all exist and fall inside the material. */
    verified_ratio: number;
    /** Findings with a valid interval inside the recording. */
    intervals_ok_ratio: number;
    /** Citations (comments, events) that exist among those cited. */
    citations_ok_ratio: number | null;
    /** Sessions with at least one finding / sessions available. */
    coverage: number;
    /** Findings that keep observation and interpretation apart. */
    separation_ratio: number;
  };
  counts: { findings: number; verified: number; partial: number; unsupported: number; invented_references: number; sessions_available: number; sessions_covered: number };
  valid: boolean;
  reasons: string[];
  note: string;
};

/**
 * Structural evaluation of an agent's analysis. It rewards findings that can be
 * checked against the material, never the opinion of another model, and it
 * never pays for invented references.
 */
export function evaluateAnalysis(
  findings: Array<ValidatedFinding & { session_id: string; inventedReferences: number; hypothesisRaw: string | null }>,
  sessionsAvailable: number,
): AnalysisEvaluation {
  const n = findings.length;
  const verified = findings.filter((f) => f.structural_status === 'verified').length;
  const partial = findings.filter((f) => f.structural_status === 'partial').length;
  const unsupported = findings.filter((f) => f.structural_status === 'unsupported').length;
  const invented = findings.reduce((acc, f) => acc + f.inventedReferences, 0);
  const intervalsOk = findings.filter((f) => !f.notes.some((x) => /intervalo|termina después|empieza después/i.test(x)) && f.structural_status !== 'unsupported').length;
  const cited = findings.reduce((acc, f) => acc + f.sources.filter((s) => s.kind !== 'recording').length, 0);
  const citedOk = findings.reduce((acc, f) => acc + f.sources.filter((s) => s.kind !== 'recording' && s.verified).length, 0);
  const covered = new Set(findings.map((f) => f.session_id)).size;
  const separated = findings.filter((f) => !f.hypothesis || f.hypothesis.trim().toLowerCase() !== f.observation.trim().toLowerCase()).length;
  const ratio = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100) / 100);

  const criteria = {
    verified_ratio: ratio(verified, n),
    intervals_ok_ratio: ratio(intervalsOk, n),
    citations_ok_ratio: cited === 0 ? null : ratio(citedOk, cited),
    coverage: ratio(covered, sessionsAvailable),
    separation_ratio: ratio(separated, n),
  };
  const reasons: string[] = [];
  if (n === 0) reasons.push('La entrega no incluye hallazgos.');
  if (invented > 0) reasons.push(`${invented} referencia(s) a comentarios o eventos que no existen en esa sesión: no se paga por inventar evidencia.`);
  if (n > 0 && unsupported / n > 0.34) reasons.push('Más de un tercio de los hallazgos no tiene intervalo o fuente verificable.');
  const valid = reasons.length === 0;
  return {
    criteria,
    counts: { findings: n, verified, partial, unsupported, invented_references: invented, sessions_available: sessionsAvailable, sessions_covered: covered },
    valid,
    reasons,
    note: 'Evaluación estructural automática: comprueba que las fuentes existan y los intervalos sean correctos. No juzga si la interpretación es acertada; una revisión humana puede confirmar o rechazar cada hallazgo.',
  };
}
