/**
 * In-context driver for Gravity Room builds.
 *
 * This is plain JavaScript (kept as a string) that is evaluated *inside* the
 * environment where the game runs: a Node `vm` context for headless checks or
 * a real browser page for Playwright checks. No host objects are passed into
 * that environment; the driver builds its own canvas stub and only returns
 * JSON strings, so a patched build cannot reach host references.
 */
export const DRIVER_SOURCE = String.raw`
var __funlabsDriver = (function () {
  'use strict';
  var noop = function () {};

  function makeStubContext(width, height) {
    var store = {
      globalAlpha: 1, lineWidth: 1, font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000',
      textAlign: 'start', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over',
      shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      imageSmoothingEnabled: true, filter: 'none', direction: 'inherit', letterSpacing: '0px',
      canvas: { width: width, height: height }
    };
    var calls = 0;
    var gradient = { addColorStop: noop };
    var api = {
      measureText: function (t) { calls++; return { width: String(t).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(t).length * 8 }; },
      createLinearGradient: function () { calls++; return gradient; },
      createRadialGradient: function () { calls++; return gradient; },
      createConicGradient: function () { calls++; return gradient; },
      createPattern: function () { calls++; return {}; },
      getImageData: function (x, y, w, h) { calls++; var n = Math.max(0, Math.min(4096 * 4096, (w | 0) * (h | 0))) * 4; return { width: w, height: h, data: new Uint8ClampedArray(n) }; },
      createImageData: function (w, h) { calls++; return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)) }; },
      isPointInPath: function () { calls++; return false; },
      isPointInStroke: function () { calls++; return false; },
      getLineDash: function () { calls++; return []; },
      getTransform: function () { calls++; return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    };
    var ctx = new Proxy(store, {
      get: function (target, key) {
        if (Object.prototype.hasOwnProperty.call(api, key)) return api[key];
        if (key in target) return target[key];
        return function () { calls++; };
      },
      set: function (target, key, value) { target[key] = value; return true; }
    });
    return { ctx: ctx, calls: function () { return calls; } };
  }

  var game = null, stub = null, useStub = true, events = [], errors = [], renders = 0;

  function record(list) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      events.push({ type: e.type, frame: e.frame, payload: e.payload });
      if (events.length > 20000) events.shift();
    }
  }

  function safeRender() {
    try { game.render(); renders++; }
    catch (err) { if (errors.length < 20) errors.push('render: ' + (err && err.message ? err.message : String(err))); }
  }

  function step(n, renderEvery) {
    for (var i = 0; i < n; i++) {
      game.step();
      var drained = game.drainEvents();
      record(drained);
      if (renderEvery && (drained.length || (game.getState().totalFrames % renderEvery) === 0)) safeRender();
    }
  }

  function matches(cond, st) {
    if (!cond) return true;
    if (cond.grounded !== undefined && st.grounded !== cond.grounded) return false;
    if (cond.colGte !== undefined && !(st.col >= cond.colGte)) return false;
    if (cond.colLte !== undefined && !(st.col <= cond.colLte)) return false;
    if (cond.rowGte !== undefined && !(st.row >= cond.rowGte)) return false;
    if (cond.rowLte !== undefined && !(st.row <= cond.rowLte)) return false;
    if (cond.gravity !== undefined && st.gravity !== cond.gravity) return false;
    if (cond.doorOpen !== undefined && st.doorOpen !== cond.doorOpen) return false;
    if (cond.level !== undefined && st.level !== cond.level) return false;
    if (cond.status !== undefined && st.status !== cond.status) return false;
    if (cond.switchesOn !== undefined && st.switchesOn !== cond.switchesOn) return false;
    if (cond.deaths !== undefined && st.deaths !== cond.deaths) return false;
    return true;
  }

  function setHeld(keys) {
    var want = { left: false, right: false };
    for (var i = 0; i < (keys || []).length; i++) want[keys[i]] = true;
    game.setKey('left', want.left);
    game.setKey('right', want.right);
  }

  function runSteps(steps, renderEvery) {
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (s.do === 'hold') { setHeld(s.keys); step(s.frames, renderEvery); }
      else if (s.do === 'release') { setHeld([]); step(s.frames || 1, renderEvery); }
      else if (s.do === 'press') { game.press(s.action); step(1, renderEvery); }
      else if (s.do === 'wait') { setHeld(s.keys || []); step(s.frames, renderEvery); }
      else if (s.do === 'until') {
        setHeld(s.keys || []);
        var max = s.max || 600, ok = false;
        for (var f = 0; f < max; f++) {
          if (matches(s.cond, game.getState())) { ok = true; break; }
          step(1, renderEvery);
        }
        if (!ok && !matches(s.cond, game.getState())) return { ok: false, index: i, step: s, reason: 'condition not reached within ' + max + ' frames', state: game.getState() };
      }
      else if (s.do === 'expect') {
        if (!matches(s.cond, game.getState())) return { ok: false, index: i, step: s, reason: 'expectation failed', state: game.getState() };
      }
      else return { ok: false, index: i, step: s, reason: 'unknown step' };
    }
    setHeld([]);
    return { ok: true };
  }

  return {
    init: function (opts) {
      opts = opts || {};
      events = []; errors = []; renders = 0;
      useStub = opts.stub !== false;
      var ctx = null;
      if (useStub) { stub = makeStubContext(960, 540); ctx = stub.ctx; }
      else if (opts.canvasId && typeof document !== 'undefined') { ctx = document.getElementById(opts.canvasId).getContext('2d'); }
      game = GravityRoom.createGame({ ctx: ctx, emit: noop });
      safeRender();
      return JSON.stringify({ ok: true, state: game.getState() });
    },
    adopt: function (existing) {
      // Browser mode: drive the build's own game instance.
      game = existing; events = []; errors = []; renders = 0; useStub = false;
      return JSON.stringify({ ok: true, state: game.getState() });
    },
    state: function () { return JSON.stringify(game.getState()); },
    run: function (stepsJson, renderEvery) {
      var steps = JSON.parse(stepsJson);
      var started = Date.now();
      var res;
      try { res = runSteps(steps, renderEvery === undefined ? 4 : renderEvery); }
      catch (err) { res = { ok: false, reason: 'exception: ' + (err && err.message ? err.message : String(err)) }; }
      res.state = game.getState();
      res.events = events.slice();
      res.errors = errors.slice();
      res.renders = renders;
      res.drawCalls = stub ? stub.calls() : null;
      res.ms = Date.now() - started;
      return JSON.stringify(res);
    }
  };
})();
`;
