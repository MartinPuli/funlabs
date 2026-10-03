import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSuiteDefinition, runHeadlessSuite, suitePassed, suiteDigest } from '../../lib/checks/suite.ts';
import { applyScopedEdits } from '../../lib/game/patch.ts';
import { compareScope, parseRegions } from '../../lib/game/regions.ts';
import { unifiedDiff } from '../../lib/game/diff.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = fs.readFileSync(path.join(root, 'games/gravity-room/a/index.html'), 'utf8');
const routeFile = JSON.parse(fs.readFileSync(path.join(root, 'games/gravity-room/route.json'), 'utf8'));
const suite = buildSuiteDefinition(routeFile);

describe('regions', () => {
  it('finds the locked and editable regions of version A', () => {
    const { regions, errors } = parseRegions(baseline);
    expect(errors).toEqual([]);
    expect(regions.map((r) => `${r.kind}:${r.name}`)).toEqual(['locked:levels', 'locked:rules', 'editable:presentation']);
  });

  it('treats an identical copy as in scope with no changes', () => {
    const cmp = compareScope(baseline, baseline);
    expect(cmp.ok).toBe(true);
    expect(cmp.changedEditable).toEqual([]);
  });
});

describe('fixed check suite on version A', () => {
  it('passes every check', () => {
    const results = runHeadlessSuite(suite, baseline);
    const failing = results.filter((r) => r.status !== 'passed');
    expect(failing).toEqual([]);
    expect(suitePassed(results)).toBe(true);
    expect(results.map((r) => r.key)).toEqual(suite.checks.map((c) => c.key));
  });

  it('has a stable digest', () => {
    expect(suiteDigest(suite)).toBe(suiteDigest(buildSuiteDefinition(routeFile)));
  });
});

describe('scoped edits', () => {
  const highlight = {
    find: "ctx.fillStyle = on ? palette.ledOn : palette.ledOff;",
    replace: "ctx.fillStyle = on ? palette.ledOn : '#ffb347';",
    reason: 'LED visible cuando está apagado',
  };

  it('accepts a change inside the presentation region and keeps the suite green', () => {
    const res = applyScopedEdits(baseline, [highlight]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changedRegions).toEqual(['presentation']);
    const results = runHeadlessSuite(suite, res.source, baseline);
    expect(results.filter((r) => r.status !== 'passed')).toEqual([]);
    const diff = unifiedDiff(baseline, res.source, { fromLabel: 'A', toLabel: 'B' });
    expect(diff).toContain("-        ctx.fillStyle = on ? palette.ledOn : palette.ledOff;");
    expect(diff).toContain("+        ctx.fillStyle = on ? palette.ledOn : '#ffb347';");
  });

  it('rejects a change to the level data (the puzzle must be preserved)', () => {
    const res = applyScopedEdits(baseline, [{ find: "'#P.........^^^^^^^^........D.#',", replace: "'#P..........................D#'," }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(' ')).toMatch(/fuera de una región editable/);
  });

  it('rejects a change to the physics', () => {
    const res = applyScopedEdits(baseline, [{ find: 'var G = 0.5, MAX_VY = 8.5;', replace: 'var G = 0.2, MAX_VY = 8.5;' }]);
    expect(res.ok).toBe(false);
  });

  it('rejects edits that touch region markers or add script tags', () => {
    expect(applyScopedEdits(baseline, [{ find: '/* @funlabs:editable:end presentation */', replace: '' }]).ok).toBe(false);
    expect(applyScopedEdits(baseline, [{ find: highlight.find, replace: highlight.find + '</script><script>alert(1)' }]).ok).toBe(false);
  });

  it('rejects ambiguous and missing anchors', () => {
    const ambiguous = applyScopedEdits(baseline, [{ find: 'ctx.fillStyle', replace: 'ctx.fillStyle' }]);
    expect(ambiguous.ok).toBe(false);
    const missing = applyScopedEdits(baseline, [{ find: 'esto no existe', replace: 'x' }]);
    expect(missing.ok).toBe(false);
  });

  it('flags a presentation change that breaks rendering', () => {
    const res = applyScopedEdits(baseline, [{ find: 'function drawHud(ctx, v) {', replace: 'function drawHud(ctx, v) { if (v.status === "playing") { throw new Error("hud roto"); }' }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const results = runHeadlessSuite(suite, res.source, baseline);
    const render = results.find((r) => r.key === 'render_without_errors');
    expect(render?.status).toBe('failed');
    expect(suitePassed(results)).toBe(false);
  });

  it('times out instead of hanging on an infinite loop in presentation', () => {
    const res = applyScopedEdits(baseline, [{ find: 'function drawHud(ctx, v) {', replace: 'function drawHud(ctx, v) { if (v.status === "playing") { while (true) {} }' }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const results = runHeadlessSuite(suite, res.source, baseline);
    expect(suitePassed(results)).toBe(false);
  }, 60_000);
});
