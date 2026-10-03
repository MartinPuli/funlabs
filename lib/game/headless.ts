import vm from 'node:vm';
import { DRIVER_SOURCE } from './driver.ts';

export type RouteStep =
  | { do: 'hold'; keys: Array<'left' | 'right'>; frames: number; note?: string }
  | { do: 'release'; frames?: number; note?: string }
  | { do: 'press'; action: 'flip' | 'interact' | 'restart' | 'start'; note?: string }
  | { do: 'wait'; frames: number; keys?: Array<'left' | 'right'>; note?: string }
  | { do: 'until'; cond: RouteCondition; keys?: Array<'left' | 'right'>; max?: number; note?: string }
  | { do: 'expect'; cond: RouteCondition; note?: string };

export type RouteCondition = {
  grounded?: boolean;
  colGte?: number;
  colLte?: number;
  rowGte?: number;
  rowLte?: number;
  gravity?: 'up' | 'down';
  doorOpen?: boolean;
  level?: number;
  status?: 'title' | 'playing' | 'dying' | 'clear' | 'complete';
  switchesOn?: number;
  deaths?: number;
};

export type GameState = {
  status: string;
  level: number;
  levelCount: number;
  col: number | null;
  row: number | null;
  x: number | null;
  y: number | null;
  vx: number;
  vy: number;
  gravity: 'up' | 'down';
  grounded: boolean;
  doorOpen: boolean;
  switchesOn: number;
  switchesTotal: number;
  deaths: number;
  levelDeaths: number;
  totalFrames: number;
};

export type RouteRun = {
  ok: boolean;
  index?: number;
  reason?: string;
  step?: RouteStep;
  state: GameState;
  events: Array<{ type: string; frame: number; payload: Record<string, unknown> }>;
  errors: string[];
  renders: number;
  drawCalls: number | null;
  ms: number;
};

/** Returns the inline script with the given id, or null. */
export function extractScript(html: string, id: string): string | null {
  const re = new RegExp(`<script\\s+id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

/** Compiles a script without running it. Returns an error message or null. */
export function syntaxError(code: string, filename: string): string | null {
  try {
    new vm.Script(code, { filename });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export type HeadlessGame = {
  init(): { ok: boolean; state: GameState };
  run(steps: RouteStep[], opts?: { renderEvery?: number; timeoutMs?: number }): RouteRun;
  state(): GameState;
};

/**
 * Loads the game script of a build into an isolated vm context.
 * The context only contains the language built-ins; nothing from the host.
 */
export function loadHeadless(html: string, opts: { timeoutMs?: number } = {}): HeadlessGame {
  const code = extractScript(html, 'game');
  if (!code) throw new Error('The build has no <script id="game">');
  const context = vm.createContext(Object.create(null), {
    name: 'funlabs-headless',
    codeGeneration: { strings: false, wasm: false },
  });
  const timeout = opts.timeoutMs ?? 3000;
  new vm.Script(code, { filename: 'game.js' }).runInContext(context, { timeout });
  new vm.Script(DRIVER_SOURCE, { filename: 'driver.js' }).runInContext(context, { timeout });

  const call = (expr: string, ms: number) => vm.runInContext(expr, context, { timeout: ms }) as string;

  return {
    init() {
      return JSON.parse(call('__funlabsDriver.init({ stub: true })', timeout));
    },
    run(steps, runOpts = {}) {
      const json = JSON.stringify(JSON.stringify(steps));
      const every = runOpts.renderEvery ?? 4;
      return JSON.parse(call(`__funlabsDriver.run(${json}, ${every})`, runOpts.timeoutMs ?? 20000));
    },
    state() {
      return JSON.parse(call('__funlabsDriver.state()', timeout));
    },
  };
}
