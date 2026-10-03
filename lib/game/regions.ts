import { createHash } from 'node:crypto';

export type RegionKind = 'locked' | 'editable';

export type Region = {
  kind: RegionKind;
  name: string;
  /** Offset of the start marker. */
  start: number;
  /** Offset just after the end marker. */
  end: number;
  /** Offset just after the start marker (content begins here). */
  contentStart: number;
  /** Offset of the end marker (content ends here). */
  contentEnd: number;
};

const MARKER = /\/\*\s*@funlabs:(locked|editable):(start|end)\s+([a-z0-9_-]+)\s*\*\//g;

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parses @funlabs region markers. Regions cannot nest and must be closed. */
export function parseRegions(source: string): { regions: Region[]; errors: string[] } {
  const regions: Region[] = [];
  const errors: string[] = [];
  let open: { kind: RegionKind; name: string; start: number; contentStart: number } | null = null;
  MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER.exec(source))) {
    const kind = m[1] as RegionKind;
    const edge = m[2];
    const name = m[3];
    if (edge === 'start') {
      if (open) {
        errors.push(`Region ${open.kind}:${open.name} was not closed before opening ${kind}:${name}`);
        continue;
      }
      open = { kind, name, start: m.index, contentStart: m.index + m[0].length };
    } else {
      if (!open || open.kind !== kind || open.name !== name) {
        errors.push(`Cierre inesperado ${kind}:${name}`);
        continue;
      }
      regions.push({ kind, name, start: open.start, end: m.index + m[0].length, contentStart: open.contentStart, contentEnd: m.index });
      open = null;
    }
  }
  if (open) errors.push(`Region ${open.kind}:${open.name} has no closing marker`);
  const seen = new Set<string>();
  for (const r of regions) {
    const key = `${r.kind}:${r.name}`;
    if (seen.has(key)) errors.push(`Duplicate region ${key}`);
    seen.add(key);
  }
  return { regions, errors };
}

/**
 * The "frame" of a build is its source with the content of editable regions
 * replaced by placeholders. Two builds with the same frame differ only inside
 * editable regions.
 */
export function frameOf(source: string, regions: Region[]): string {
  let out = '';
  let cursor = 0;
  for (const r of regions) {
    if (r.kind !== 'editable') continue;
    out += source.slice(cursor, r.contentStart) + `<<editable:${r.name}>>`;
    cursor = r.contentEnd;
  }
  return out + source.slice(cursor);
}

export function lockedDigests(source: string, regions: Region[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of regions) if (r.kind === 'locked') out[r.name] = sha256(source.slice(r.contentStart, r.contentEnd));
  return out;
}

export type ScopeComparison = {
  ok: boolean;
  errors: string[];
  changedEditable: string[];
  lockedDigests: Record<string, string>;
};

/** Compares a candidate build against its baseline: only editable regions may change. */
export function compareScope(baseline: string, candidate: string): ScopeComparison {
  const base = parseRegions(baseline);
  const cand = parseRegions(candidate);
  const errors = [...base.errors.map((e) => `Base: ${e}`), ...cand.errors.map((e) => `Variante: ${e}`)];
  const sig = (rs: Region[]) => rs.map((r) => `${r.kind}:${r.name}`).join(',');
  if (sig(base.regions) !== sig(cand.regions)) errors.push('The marked regions do not match the baseline version');
  if (frameOf(baseline, base.regions) !== frameOf(candidate, cand.regions)) {
    errors.push('There are changes outside the editable regions');
  }
  const baseLocked = lockedDigests(baseline, base.regions);
  const candLocked = lockedDigests(candidate, cand.regions);
  for (const [name, digest] of Object.entries(baseLocked)) {
    if (candLocked[name] !== digest) errors.push(`Locked region "${name}" changed`);
  }
  const changedEditable: string[] = [];
  for (const r of base.regions) {
    if (r.kind !== 'editable') continue;
    const other = cand.regions.find((x) => x.kind === 'editable' && x.name === r.name);
    if (other && baseline.slice(r.contentStart, r.contentEnd) !== candidate.slice(other.contentStart, other.contentEnd)) {
      changedEditable.push(r.name);
    }
  }
  return { ok: errors.length === 0, errors, changedEditable, lockedDigests: candLocked };
}
