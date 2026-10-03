import { extractScript, loadHeadless, syntaxError, type RouteRun, type RouteStep } from '../game/headless.ts';
import { compareScope, parseRegions, sha256 } from '../game/regions.ts';

export const SUITE_ID = 'gravity-room-checks';
export const SUITE_VERSION = 1;

export type CheckStatus = 'passed' | 'failed' | 'error' | 'skipped';

export type CheckResult = {
  key: string;
  label: string;
  status: CheckStatus;
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
};

export type SuiteDefinition = {
  id: string;
  version: number;
  game: string;
  /** Checks run on every candidate, in order. */
  checks: Array<{ key: string; label: string; claim: string }>;
  route: RouteStep[];
  deathRoute: RouteStep[];
  requiredRegions: Array<{ kind: 'locked' | 'editable'; name: string }>;
  maxBytes: number;
};

/** The fixed suite. It is frozen (hashed) when a study is published. */
export function buildSuiteDefinition(routeFile: { route: RouteStep[]; deathRoute: RouteStep[] }): SuiteDefinition {
  return {
    id: SUITE_ID,
    version: SUITE_VERSION,
    game: 'gravity-room',
    checks: [
      { key: 'build_structure', label: 'Build structure', claim: 'The file has the game and boot scripts, compiles and does not exceed the allowed size.' },
      { key: 'scope_preserved', label: 'Scope respected', claim: 'Outside the editable regions the file is identical to the baseline version: same levels, rules and event bridge.' },
      { key: 'initializes', label: 'Initializes', claim: 'The game is created and draws the title screen without errors.' },
      { key: 'controls_respond', label: 'Controls', claim: 'Moving right shifts the character and flipping gravity changes its direction.' },
      { key: 'restart_restores', label: 'Restart', claim: 'Restarting the room returns the character to the start and emits the corresponding event.' },
      { key: 'death_and_respawn', label: 'Hazards', claim: 'Touching spikes causes a fall and the character respawns in the room.' },
      { key: 'known_route_completes', label: 'Known route', claim: 'A fixed route completes all three rooms. It does not prove that other paths are possible or that the game is fun.' },
      { key: 'render_without_errors', label: 'Drawing without errors', claim: 'Drawing every visited state throws no exceptions.' },
    ],
    route: routeFile.route,
    deathRoute: routeFile.deathRoute,
    requiredRegions: [
      { kind: 'locked', name: 'levels' },
      { kind: 'locked', name: 'rules' },
      { kind: 'editable', name: 'presentation' },
    ],
    maxBytes: 300_000,
  };
}

export function suiteDigest(def: SuiteDefinition): string {
  return sha256(JSON.stringify(def));
}

type Timed<T> = { value: T; ms: number; error?: undefined } | { value?: undefined; ms: number; error: string };

function timed<T>(fn: () => T): Timed<T> {
  const t = Date.now();
  try {
    const value = fn();
    return { value, ms: Date.now() - t };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: /timed out/i.test(msg) ? `Timed out: ${msg}` : `Exception: ${msg}`, ms: Date.now() - t };
  }
}

function result(key: string, def: SuiteDefinition, status: CheckStatus, summary: string, details: Record<string, unknown>, ms: number): CheckResult {
  const label = def.checks.find((c) => c.key === key)?.label ?? key;
  return { key, label, status, summary, details, durationMs: ms };
}

function eventCounts(run: RouteRun): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of run.events) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

/**
 * Runs the headless part of the suite. `baseline` is the build the candidate
 * was derived from (omit it when checking the baseline itself).
 */
export function runHeadlessSuite(def: SuiteDefinition, candidate: string, baseline?: string): CheckResult[] {
  const out: CheckResult[] = [];
  const renderErrors: string[] = [];
  let drawCalls = 0;

  // 1. Structure
  {
    const t = Date.now();
    const game = extractScript(candidate, 'game');
    const boot = extractScript(candidate, 'boot');
    const problems: string[] = [];
    if (!game) problems.push('Missing <script id="game">');
    if (!boot) problems.push('Missing <script id="boot">');
    const bytes = Buffer.byteLength(candidate, 'utf8');
    if (bytes > def.maxBytes) problems.push(`Size ${bytes} > ${def.maxBytes} bytes`);
    const gErr = game ? syntaxError(game, 'game.js') : null;
    const bErr = boot ? syntaxError(boot, 'boot.js') : null;
    if (gErr) problems.push(`Syntax error in the game: ${gErr}`);
    if (bErr) problems.push(`Syntax error in the boot script: ${bErr}`);
    out.push(result('build_structure', def, problems.length ? 'failed' : 'passed', problems.length ? problems.join('; ') : `Compiles (${bytes} bytes)`, { bytes, problems, sha256: sha256(candidate) }, Date.now() - t));
    if (problems.length) return finishSkipped(out, def, 'The build structure is not valid');
  }

  // 2. Scope
  {
    const t = Date.now();
    const { regions, errors } = parseRegions(candidate);
    const problems = [...errors];
    for (const req of def.requiredRegions) {
      if (!regions.some((r) => r.kind === req.kind && r.name === req.name)) problems.push(`Missing region ${req.kind}:${req.name}`);
    }
    let changed: string[] = [];
    if (baseline) {
      const cmp = compareScope(baseline, candidate);
      problems.push(...cmp.errors);
      changed = cmp.changedEditable;
    }
    out.push(result('scope_preserved', def, problems.length ? 'failed' : 'passed',
      problems.length ? problems.join('; ') : baseline ? `Only editable regions changed: ${changed.join(', ') || 'none'}` : 'Baseline version: required regions present',
      { problems, changedRegions: changed, comparedWithBaseline: Boolean(baseline) }, Date.now() - t));
    if (problems.length) return finishSkipped(out, def, 'The scope was not respected');
  }

  // 3. Initialization
  let load: ReturnType<typeof loadHeadless>;
  {
    const t = Date.now();
    try {
      load = loadHeadless(candidate);
      const init = load.init();
      const ok = init.ok && init.state.status === 'title';
      out.push(result('initializes', def, ok ? 'passed' : 'failed', ok ? 'Title screen ready' : `Unexpected state: ${init.state.status}`, { state: init.state }, Date.now() - t));
      if (!ok) return finishSkipped(out, def, 'The game does not initialize');
    } catch (err) {
      out.push(result('initializes', def, 'error', `Exception: ${err instanceof Error ? err.message : String(err)}`, {}, Date.now() - t));
      return finishSkipped(out, def, 'The game does not initialize');
    }
  }

  const fresh = () => { const g = loadHeadless(candidate); g.init(); return g; };

  // 4. Controls
  {
    const r = timed(() => fresh().run([
      { do: 'press', action: 'start' },
      { do: 'hold', keys: ['right'], frames: 20 },
      { do: 'release', frames: 10 },
      { do: 'press', action: 'flip' },
      { do: 'wait', frames: 10 },
    ], { timeoutMs: 5000 }));
    if (r.error !== undefined) { out.push(result('controls_respond', def, 'error', r.error, {}, r.ms)); renderErrors.push(r.error); }
    else {
    const { value: run, ms } = r;
    renderErrors.push(...run.errors); drawCalls += run.drawCalls ?? 0;
    const counts = eventCounts(run);
    const moved = (run.state.x ?? 0) > 38 + 20;
    const flipped = run.state.gravity === 'up' && (counts.flip ?? 0) === 1;
    const ok = run.ok && moved && flipped;
    out.push(result('controls_respond', def, ok ? 'passed' : 'failed',
      ok ? 'The character moved and gravity flipped' : `Moved: ${moved}; flipped: ${flipped}${run.reason ? '; ' + run.reason : ''}`,
      { x: run.state.x, gravity: run.state.gravity, events: counts }, ms));
    }
  }

  // 5. Restart
  {
    const r = timed(() => fresh().run([
      { do: 'press', action: 'start' },
      { do: 'hold', keys: ['right'], frames: 25 },
      { do: 'press', action: 'restart' },
      { do: 'release', frames: 2 },
      { do: 'expect', cond: { status: 'playing', level: 1, colLte: 1 } },
    ], { timeoutMs: 5000 }));
    if (r.error !== undefined) { out.push(result('restart_restores', def, 'error', r.error, {}, r.ms)); renderErrors.push(r.error); }
    else {
    const { value: run, ms } = r;
    renderErrors.push(...run.errors); drawCalls += run.drawCalls ?? 0;
    const restartEvent = run.events.some((e) => e.type === 'restart');
    const ok = run.ok && restartEvent;
    out.push(result('restart_restores', def, ok ? 'passed' : 'failed', ok ? 'Returned to the start of the room' : run.reason ?? 'The restart event was not emitted', { state: run.state, restartEvent }, ms));
    }
  }

  // 6. Hazards
  {
    const r = timed(() => fresh().run(def.deathRoute, { timeoutMs: 5000 }));
    if (r.error !== undefined) { out.push(result('death_and_respawn', def, 'error', r.error, {}, r.ms)); renderErrors.push(r.error); }
    else {
    const { value: run, ms } = r;
    renderErrors.push(...run.errors); drawCalls += run.drawCalls ?? 0;
    const counts = eventCounts(run);
    const ok = run.ok && (counts.death ?? 0) === 1 && (counts.respawn ?? 0) === 1;
    out.push(result('death_and_respawn', def, ok ? 'passed' : 'failed', ok ? 'Fall and respawn correct' : run.reason ?? 'Fall or respawn events missing', { events: counts, state: run.state }, ms));
    }
  }

  // 7. Known route
  {
    const r = timed(() => fresh().run(def.route, { renderEvery: 2, timeoutMs: 20000 }));
    if (r.error !== undefined) { out.push(result('known_route_completes', def, 'error', r.error, {}, r.ms)); renderErrors.push(r.error); }
    else {
    const { value: run, ms } = r;
    renderErrors.push(...run.errors); drawCalls += run.drawCalls ?? 0;
    const counts = eventCounts(run);
    const ok = run.ok && run.state.status === 'complete' && (counts.level_complete ?? 0) === run.state.levelCount;
    out.push(result('known_route_completes', def, ok ? 'passed' : 'failed',
      ok ? `Completed ${counts.level_complete} rooms in ${run.state.totalFrames} frames without falls` : `Stopped at step ${run.index ?? '?'}: ${run.reason ?? 'did not finish'}`,
      { state: run.state, events: counts, failedStep: run.step ?? null, frames: run.state.totalFrames }, ms));
    }
  }

  // 8. Drawing
  {
    const ok = renderErrors.length === 0 && drawCalls > 0;
    out.push(result('render_without_errors', def, ok ? 'passed' : 'failed',
      ok ? `No exceptions while drawing (${drawCalls} canvas calls)` : renderErrors.length ? renderErrors.slice(0, 3).join('; ') : 'No drawing was recorded',
      { errors: renderErrors.slice(0, 10), drawCalls }, 0));
  }
  return out;
}

function finishSkipped(out: CheckResult[], def: SuiteDefinition, why: string): CheckResult[] {
  for (const c of def.checks) {
    if (!out.some((r) => r.key === c.key)) out.push({ key: c.key, label: c.label, status: 'skipped', summary: `Skipped: ${why}`, details: {}, durationMs: 0 });
  }
  return out;
}

export function suitePassed(results: CheckResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === 'passed');
}
