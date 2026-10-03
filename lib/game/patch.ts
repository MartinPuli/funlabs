import { compareScope, parseRegions } from './regions.ts';

export type Edit = { find: string; replace: string; reason?: string };

export type AppliedEdit = { index: number; region: string; at: number; removed: number; added: number; reason?: string };

export type PatchResult =
  | { ok: true; source: string; applied: AppliedEdit[]; changedRegions: string[] }
  | { ok: false; errors: string[] };

export const PATCH_LIMITS = { maxEdits: 24, maxFindLength: 20000, maxReplaceLength: 30000, maxResultBytes: 300_000 };

function countOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * Applies find/replace edits to a build, allowing changes only inside
 * `@funlabs:editable` regions. Every edit must match exactly once. The final
 * result is compared with the baseline: locked regions and everything outside
 * editable regions must stay byte-identical.
 */
export function applyScopedEdits(baseline: string, edits: Edit[]): PatchResult {
  const errors: string[] = [];
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, errors: ['La intervención no contiene cambios'] };
  if (edits.length > PATCH_LIMITS.maxEdits) return { ok: false, errors: [`Demasiados cambios (${edits.length} > ${PATCH_LIMITS.maxEdits})`] };

  let current = baseline;
  const applied: AppliedEdit[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (typeof e?.find !== 'string' || typeof e?.replace !== 'string') { errors.push(`Cambio ${i + 1}: formato inválido`); continue; }
    if (!e.find.length) { errors.push(`Cambio ${i + 1}: el texto a buscar está vacío`); continue; }
    if (e.find.length > PATCH_LIMITS.maxFindLength || e.replace.length > PATCH_LIMITS.maxReplaceLength) { errors.push(`Cambio ${i + 1}: supera el tamaño permitido`); continue; }
    if (e.find.includes('@funlabs:') || e.replace.includes('@funlabs:')) { errors.push(`Cambio ${i + 1}: no puede tocar los marcadores de región`); continue; }
    if (/<\/?script/i.test(e.replace)) { errors.push(`Cambio ${i + 1}: no puede agregar ni cerrar etiquetas <script>`); continue; }

    const hits = countOccurrences(current, e.find);
    if (hits.length === 0) { errors.push(`Cambio ${i + 1}: no se encontró el texto a reemplazar`); continue; }
    if (hits.length > 1) { errors.push(`Cambio ${i + 1}: el texto a reemplazar aparece ${hits.length} veces; debe ser único`); continue; }
    const at = hits[0];
    const { regions } = parseRegions(current);
    const region = regions.find((r) => r.kind === 'editable' && at >= r.contentStart && at + e.find.length <= r.contentEnd);
    if (!region) { errors.push(`Cambio ${i + 1}: queda fuera de una región editable`); continue; }

    current = current.slice(0, at) + e.replace + current.slice(at + e.find.length);
    applied.push({ index: i, region: region.name, at, removed: e.find.length, added: e.replace.length, reason: e.reason });
  }
  if (errors.length) return { ok: false, errors };
  if (Buffer.byteLength(current, 'utf8') > PATCH_LIMITS.maxResultBytes) return { ok: false, errors: ['El build resultante supera el tamaño permitido'] };

  const scope = compareScope(baseline, current);
  if (!scope.ok) return { ok: false, errors: scope.errors };
  if (scope.changedEditable.length === 0) return { ok: false, errors: ['El resultado es idéntico a la versión base'] };
  return { ok: true, source: current, applied, changedRegions: scope.changedEditable };
}
