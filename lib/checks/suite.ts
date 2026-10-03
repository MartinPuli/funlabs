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
      { key: 'build_structure', label: 'Estructura del build', claim: 'El archivo tiene los scripts del juego y del arranque, compila y no supera el tamaño permitido.' },
      { key: 'scope_preserved', label: 'Alcance respetado', claim: 'Fuera de las regiones editables el archivo es idéntico a la versión base: mismos niveles, reglas y puente de eventos.' },
      { key: 'initializes', label: 'Inicializa', claim: 'El juego se crea y dibuja la pantalla de título sin errores.' },
      { key: 'controls_respond', label: 'Controles', claim: 'Moverse a la derecha desplaza al personaje y la inversión de gravedad cambia su dirección.' },
      { key: 'restart_restores', label: 'Reinicio', claim: 'Reiniciar la sala devuelve al personaje al inicio y emite el evento correspondiente.' },
      { key: 'death_and_respawn', label: 'Peligros', claim: 'Tocar pinchos produce una caída y el personaje reaparece en la sala.' },
      { key: 'known_route_completes', label: 'Recorrido conocido', claim: 'Un recorrido fijo completa las tres salas. No demuestra que otros caminos sean posibles ni que el juego sea divertido.' },
      { key: 'render_without_errors', label: 'Dibujo sin errores', claim: 'Dibujar cada estado recorrido no lanza excepciones.' },
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
    return { error: /timed out/i.test(msg) ? `Tiempo agotado: ${msg}` : `Excepción: ${msg}`, ms: Date.now() - t };
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

  // 1. Estructura
  {
    const t = Date.now();
    const game = extractScript(candidate, 'game');
    const boot = extractScript(candidate, 'boot');
    const problems: string[] = [];
    if (!game) problems.push('Falta <script id="game">');
    if (!boot) problems.push('Falta <script id="boot">');
    const bytes = Buffer.byteLength(candidate, 'utf8');
    if (bytes > def.maxBytes) problems.push(`Tamaño ${bytes} > ${def.maxBytes} bytes`);
    const gErr = game ? syntaxError(game, 'game.js') : null;
    const bErr = boot ? syntaxError(boot, 'boot.js') : null;
    if (gErr) problems.push(`Error de sintaxis en el juego: ${gErr}`);
    if (bErr) problems.push(`Error de sintaxis en el arranque: ${bErr}`);
    out.push(result('build_structure', def, problems.length ? 'failed' : 'passed', problems.length ? problems.join('; ') : `Compila (${bytes} bytes)`, { bytes, problems, sha256: sha256(candidate) }, Date.now() - t));
    if (problems.length) return finishSkipped(out, def, 'La estructura del build no es válida');
  }

  // 2. Alcance
  {
    const t = Date.now();
    const { regions, errors } = parseRegions(candidate);
    const problems = [...errors];
    for (const req of def.requiredRegions) {
      if (!regions.some((r) => r.kind === req.kind && r.name === req.name)) problems.push(`Falta la región ${req.kind}:${req.name}`);
    }
    let changed: string[] = [];
    if (baseline) {
      const cmp = compareScope(baseline, candidate);
      problems.push(...cmp.errors);
      changed = cmp.changedEditable;
    }
    out.push(result('scope_preserved', def, problems.length ? 'failed' : 'passed',
      problems.length ? problems.join('; ') : baseline ? `Solo cambiaron regiones editables: ${changed.join(', ') || 'ninguna'}` : 'Versión base: regiones requeridas presentes',
      { problems, changedRegions: changed, comparedWithBaseline: Boolean(baseline) }, Date.now() - t));
    if (problems.length) return finishSkipped(out, def, 'El alcance no se respetó');
  }

  // 3. Inicialización
  let load: ReturnType<typeof loadHeadless>;
  {
    const t = Date.now();
    try {
      load = loadHeadless(candidate);
      const init = load.init();
      const ok = init.ok && init.state.status === 'title';
      out.push(result('initializes', def, ok ? 'passed' : 'failed', ok ? 'Pantalla de título lista' : `Estado inesperado: ${init.state.status}`, { state: init.state }, Date.now() - t));
      if (!ok) return finishSkipped(out, def, 'El juego no inicializa');
    } catch (err) {
      out.push(result('initializes', def, 'error', `Excepción: ${err instanceof Error ? err.message : String(err)}`, {}, Date.now() - t));
      return finishSkipped(out, def, 'El juego no inicializa');
    }
  }

  const fresh = () => { const g = loadHeadless(candidate); g.init(); return g; };

  // 4. Controles
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
      ok ? 'El personaje se movió y la gravedad se invirtió' : `Movió: ${moved}; invirtió: ${flipped}${run.reason ? '; ' + run.reason : ''}`,
      { x: run.state.x, gravity: run.state.gravity, events: counts }, ms));
    }
  }

  // 5. Reinicio
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
    out.push(result('restart_restores', def, ok ? 'passed' : 'failed', ok ? 'Volvió al inicio de la sala' : run.reason ?? 'No se emitió el evento de reinicio', { state: run.state, restartEvent }, ms));
    }
  }

  // 6. Peligros
  {
    const r = timed(() => fresh().run(def.deathRoute, { timeoutMs: 5000 }));
    if (r.error !== undefined) { out.push(result('death_and_respawn', def, 'error', r.error, {}, r.ms)); renderErrors.push(r.error); }
    else {
    const { value: run, ms } = r;
    renderErrors.push(...run.errors); drawCalls += run.drawCalls ?? 0;
    const counts = eventCounts(run);
    const ok = run.ok && (counts.death ?? 0) === 1 && (counts.respawn ?? 0) === 1;
    out.push(result('death_and_respawn', def, ok ? 'passed' : 'failed', ok ? 'Caída y reaparición correctas' : run.reason ?? 'Eventos de caída o reaparición ausentes', { events: counts, state: run.state }, ms));
    }
  }

  // 7. Recorrido conocido
  {
    const r = timed(() => fresh().run(def.route, { renderEvery: 2, timeoutMs: 20000 }));
    if (r.error !== undefined) { out.push(result('known_route_completes', def, 'error', r.error, {}, r.ms)); renderErrors.push(r.error); }
    else {
    const { value: run, ms } = r;
    renderErrors.push(...run.errors); drawCalls += run.drawCalls ?? 0;
    const counts = eventCounts(run);
    const ok = run.ok && run.state.status === 'complete' && (counts.level_complete ?? 0) === run.state.levelCount;
    out.push(result('known_route_completes', def, ok ? 'passed' : 'failed',
      ok ? `Completó ${counts.level_complete} salas en ${run.state.totalFrames} cuadros sin caídas` : `Se detuvo en el paso ${run.index ?? '?'}: ${run.reason ?? 'no terminó'}`,
      { state: run.state, events: counts, failedStep: run.step ?? null, frames: run.state.totalFrames }, ms));
    }
  }

  // 8. Dibujo
  {
    const ok = renderErrors.length === 0 && drawCalls > 0;
    out.push(result('render_without_errors', def, ok ? 'passed' : 'failed',
      ok ? `Sin excepciones al dibujar (${drawCalls} llamadas al canvas)` : renderErrors.length ? renderErrors.slice(0, 3).join('; ') : 'No se registraron dibujos',
      { errors: renderErrors.slice(0, 10), drawCalls }, 0));
  }
  return out;
}

function finishSkipped(out: CheckResult[], def: SuiteDefinition, why: string): CheckResult[] {
  for (const c of def.checks) {
    if (!out.some((r) => r.key === c.key)) out.push({ key: c.key, label: c.label, status: 'skipped', summary: `Omitido: ${why}`, details: {}, durationMs: 0 });
  }
  return out;
}

export function suitePassed(results: CheckResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === 'passed');
}
