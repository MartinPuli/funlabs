import { describe, expect, it } from 'vitest';
import { fromModelOutput, validateFinding, type SessionMaterial } from '../../lib/analysis/validate.ts';

const material: SessionMaterial = {
  durationMs: 60_000,
  recordingId: 'rec-1',
  events: new Map([
    ['e10', { id: 110, t_ms: 21_500, type: 'interact' }],
    ['e11', { id: 111, t_ms: 23_000, type: 'interact' }],
    ['e40', { id: 140, t_ms: 55_000, type: 'death' }],
  ]),
  feedback: new Map([['c1', { id: 'fb-uuid-1', t_ms: 24_000, body: 'I do not know which object I can activate' }]]),
};

const base = {
  observation: 'The person tries to move forward several times.',
  visual_basis: 'The character is seen next to the wall.',
  hypothesis: 'The interaction cue may be hard to see.',
  alternative: 'They may not have understood the initial instruction.',
  next_test: 'Change the visual cue and keep the puzzle.',
  category: 'clarity',
  preserve: false,
};

describe('validateFinding', () => {
  it('verifies a finding whose events and comment exist inside the interval', () => {
    const v = validateFinding({ ...base, start_ms: 21_000, end_ms: 29_000, feedback_ref: 'c1', event_refs: ['e10', 'e11'] }, material);
    expect(v.structural_status).toBe('verified');
    expect(v.feedback_id).toBe('fb-uuid-1');
    expect(v.sources.map((s) => s.kind)).toEqual(['recording', 'game_event', 'game_event', 'feedback']);
    expect(v.sources.every((s) => s.verified)).toBe(true);
  });

  it('drops an invented comment reference instead of showing a citation', () => {
    const v = validateFinding({ ...base, start_ms: 21_000, end_ms: 29_000, feedback_ref: 'c9', event_refs: ['e10'] }, material);
    expect(v.feedback_id).toBeNull();
    expect(v.structural_status).toBe('partial');
    expect(v.notes.join(' ')).toMatch(/does not exist/);
  });

  it('flags events outside the interval and unknown events', () => {
    const v = validateFinding({ ...base, start_ms: 21_000, end_ms: 29_000, feedback_ref: null, event_refs: ['e40', 'e99'] }, material);
    expect(v.structural_status).toBe('partial');
    const ev = v.sources.find((s) => s.source_id === '140');
    expect(ev?.verified).toBe(false);
  });

  it('marks an interval beyond the recording as unsupported (hypothesis only)', () => {
    const v = validateFinding({ ...base, start_ms: 90_000, end_ms: 95_000, feedback_ref: 'c1', event_refs: [] }, material);
    expect(v.structural_status).toBe('unsupported');
    expect(v.sources[0]).toMatchObject({ kind: 'recording', verified: false });
  });

  it('clamps an end that overshoots the recording by a little', () => {
    const v = validateFinding({ ...base, start_ms: 54_000, end_ms: 61_500, feedback_ref: null, event_refs: ['e40'] }, material);
    expect(v.interval_end_ms).toBe(60_000);
    expect(v.structural_status).toBe('verified');
  });

  it('accepts a video-only observation as partial evidence', () => {
    const v = validateFinding({ ...base, start_ms: 5_000, end_ms: 9_000, feedback_ref: null, event_refs: [] }, material);
    expect(v.structural_status).toBe('partial');
    expect(v.notes.join(' ')).toMatch(/only by what is visible/);
  });

  it('rejects inverted or overly long intervals', () => {
    expect(validateFinding({ ...base, start_ms: 9_000, end_ms: 5_000, feedback_ref: null, event_refs: [] }, material).structural_status).toBe('unsupported');
    expect(validateFinding({ ...base, start_ms: 0, end_ms: 59_000, feedback_ref: null, event_refs: [] }, { ...material, durationMs: 300_000 }).structural_status).toBe('partial');
    expect(validateFinding({ ...base, start_ms: 0, end_ms: 200_000, feedback_ref: null, event_refs: [] }, { ...material, durationMs: 300_000 }).structural_status).toBe('unsupported');
  });

  it('works without a recording (written alternative)', () => {
    const v = validateFinding({ ...base, start_ms: 21_000, end_ms: 29_000, feedback_ref: 'c1', event_refs: ['e10'] }, { ...material, durationMs: null, recordingId: null });
    expect(v.structural_status).toBe('verified');
    expect(v.sources.some((s) => s.kind === 'recording')).toBe(false);
  });
});

describe('fromModelOutput', () => {
  it('converts seconds to milliseconds and ignores malformed fields', () => {
    const out = fromModelOutput({ findings: [{ start_s: 21, end_s: 29.5, observation: 'x', feedback_id: '', event_ids: ['e1', 7], category: 'clarity', preserve: 1 }] });
    expect(out[0]).toMatchObject({ start_ms: 21_000, end_ms: 29_500, feedback_ref: null, event_refs: ['e1'], preserve: true });
    expect(fromModelOutput({ nope: true })).toEqual([]);
  });
});
