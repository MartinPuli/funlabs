'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { testerCall, uploadWithProgress, TesterApiError } from './api';
import { withWebmDuration } from '@/lib/client/webm';

type Session = { id: string; neutral_label: string; play_url: string };
type Mode = 'choose' | 'starting' | 'recording' | 'playing' | 'uploading' | 'done' | 'failed';
type Comment = { id: string; t_ms: number | null; body: string };

export type SessionResult = { recorded: boolean; method: string | null; durationMs: number | null };

function mmss(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function pickMime(): string {
  const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

const SURFACE_METHOD: Record<string, string> = { browser: 'tab_capture', window: 'window_capture', monitor: 'screen_capture' };

/**
 * One play session: explicit choice between recording this tab or the written
 * alternative, the sandboxed game, timestamped comments and the upload.
 */
export function SessionRunner({ token, session, maxMinutes, onFinished }: { token: string; session: Session; maxMinutes: number; onFinished: (r: SessionResult) => void }) {
  const [mode, setMode] = useState<Mode>('choose');
  const [mic, setMic] = useState(false);
  const [status, setStatus] = useState('Ready to start.');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const clockStart = useRef<number | null>(null);
  const clockKind = useRef<'recording' | 'session'>('session');
  const seq = useRef(0);
  const buffer = useRef<Array<{ seq: number; t_ms: number; type: string; payload: Record<string, unknown>; clock: 'recording' | 'session' }>>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streams = useRef<MediaStream[]>([]);
  const meta = useRef<{ surface: string | null; cropped: boolean; hasAudio: boolean; mime: string }>({ surface: null, cropped: false, hasAudio: false, mime: '' });
  const pendingBlob = useRef<Blob | null>(null);
  const durationRef = useRef<number | null>(null);
  const methodRef = useRef<string>('tab_capture');

  const now = () => (clockStart.current === null ? null : Math.round(performance.now() - clockStart.current));

  const flush = useCallback(async () => {
    if (!buffer.current.length) return;
    const batch = buffer.current.splice(0, buffer.current.length);
    try {
      await testerCall(token, 'events', { session_id: session.id, events: batch });
    } catch {
      buffer.current.unshift(...batch); // keep and retry on the next flush
    }
  }, [token, session.id]);

  // Game events arrive from the sandboxed frame and are stamped on our clock.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data as { source?: string; type?: string; payload?: Record<string, unknown> };
      if (!d || d.source !== 'funlabs-game' || typeof d.type !== 'string') return;
      const t = now();
      if (t === null) return;
      buffer.current.push({ seq: seq.current++, t_ms: t, type: d.type.slice(0, 40), payload: d.payload ?? {}, clock: clockKind.current });
    }
    window.addEventListener('message', onMessage);
    const timer = window.setInterval(() => void flush(), 2500);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
    };
  }, [flush]);

  useEffect(() => {
    if (mode !== 'recording' && mode !== 'playing') return;
    const t = window.setInterval(() => {
      const v = now() ?? 0;
      setElapsed(v);
      if (mode === 'recording' && v > maxMinutes * 60_000) void stopRecording('The maximum session time was reached.');
    }, 500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, maxMinutes]);

  useEffect(() => () => streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop())), []);

  function focusGame() {
    frameRef.current?.focus();
    frameRef.current?.contentWindow?.postMessage({ source: 'funlabs-host', type: 'focus' }, '*');
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record the tab. You can upload your own recording or continue with the written alternative.');
      setMode('failed');
      return;
    }
    setMode('starting');
    setStatus('Choose "This tab" in the browser dialog to share only the game.');
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'exclude',
      } as DisplayMediaStreamOptions);
      streams.current.push(display);
      const [track] = display.getVideoTracks();
      const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface ?? null;
      meta.current.surface = surface;
      // Region capture: keep only the game frame when the tab itself is shared.
      const CropTargetCtor = (window as unknown as { CropTarget?: { fromElement(el: Element): Promise<unknown> } }).CropTarget;
      if (CropTargetCtor && surface === 'browser' && wrapRef.current && 'cropTo' in track) {
        try {
          const target = await CropTargetCtor.fromElement(wrapRef.current);
          await (track as MediaStreamTrack & { cropTo(t: unknown): Promise<void> }).cropTo(target);
          meta.current.cropped = true;
        } catch {
          meta.current.cropped = false;
        }
      }
      const tracks: MediaStreamTrack[] = [track];
      if (mic) {
        try {
          const voice = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          streams.current.push(voice);
          tracks.push(...voice.getAudioTracks());
          meta.current.hasAudio = true;
        } catch {
          meta.current.hasAudio = false;
          setStatus('Could not use the microphone. We continue without voice: you can write comments.');
        }
      }
      const mime = pickMime();
      meta.current.mime = mime;
      const rec = new MediaRecorder(new MediaStream(tracks), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 900_000, audioBitsPerSecond: 48_000 });
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.current.push(e.data);
      };
      track.addEventListener('ended', () => void stopRecording('You stopped sharing the tab.'));
      recorder.current = rec;
      methodRef.current = SURFACE_METHOD[surface ?? ''] ?? 'tab_capture';
      rec.start(1000);
      clockStart.current = performance.now();
      clockKind.current = 'recording';
      setMode('recording');
      setStatus(surface && surface !== 'browser' ? 'Recording. You shared something other than this tab: what you chose is being recorded.' : 'Recording the game tab.');
      window.setTimeout(focusGame, 50);
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
      setError(denied ? 'The tab was not shared. You can try again, upload your own recording or continue with the written alternative.' : `Could not start recording: ${err instanceof Error ? err.message : String(err)}`);
      setMode('failed');
    }
  }

  async function stopRecording(reason?: string) {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return;
    const duration = now();
    durationRef.current = duration;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    recorder.current = null;
    await flush();
    const type = meta.current.mime.split(';')[0] || 'video/webm';
    const raw = new Blob(chunks.current, { type });
    pendingBlob.current = await withWebmDuration(raw, duration ?? 0);
    if (reason) setStatus(reason);
    await upload();
  }

  async function upload() {
    const blob = pendingBlob.current;
    if (!blob) return;
    setMode('uploading');
    setError(null);
    setProgress(0);
    try {
      if (blob.size > 50 * 1024 * 1024) throw new Error('The recording is over 50 MB. Try a shorter session.');
      const url = await testerCall<{ signedUrl: string }>(token, 'upload-url', { session_id: session.id, mime_type: blob.type || 'video/webm', method: methodRef.current });
      await uploadWithProgress(url.signedUrl, blob, setProgress);
      await testerCall(token, 'confirm-recording', {
        session_id: session.id,
        duration_ms: durationRef.current,
        has_audio: meta.current.hasAudio,
        bytes: blob.size,
        surface: meta.current.surface,
        cropped: meta.current.cropped,
      });
      setMode('done');
      setStatus('Recording saved.');
      onFinished({ recorded: true, method: methodRef.current, durationMs: durationRef.current });
    } catch (err) {
      setError(err instanceof TesterApiError || err instanceof Error ? `The file could not be uploaded. ${err.message}` : 'The file could not be uploaded.');
      setMode('failed');
    }
  }

  function playWithoutRecording() {
    clockStart.current = performance.now();
    clockKind.current = 'session';
    setMode('playing');
    setStatus('Playing without recording. Write down what happens with the "Add note" button.');
    window.setTimeout(focusGame, 50);
  }

  async function finishWithoutRecording() {
    durationRef.current = now();
    await flush();
    setMode('done');
    onFinished({ recorded: false, method: null, durationMs: durationRef.current });
  }

  async function manualUpload(file: File) {
    methodRef.current = 'manual_upload';
    meta.current = { surface: null, cropped: false, hasAudio: false, mime: file.type };
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    const duration = await new Promise<number | null>((resolve) => {
      probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : null);
      probe.onerror = () => resolve(null);
      probe.src = URL.createObjectURL(file);
    });
    durationRef.current = duration;
    pendingBlob.current = file;
    await flush();
    await upload();
  }

  async function saveComment() {
    const body = draft.trim();
    if (!body) return;
    setSavingComment(true);
    try {
      const res = await testerCall<{ comment: Comment }>(token, 'moment', { session_id: session.id, t_ms: now(), body });
      setComments((c) => [...c, res.comment]);
      setDraft('');
      setStatus(`Comment noted at ${mmss(res.comment.t_ms)}.`);
      window.setTimeout(focusGame, 30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the comment.');
    } finally {
      setSavingComment(false);
    }
  }

  const active = mode === 'recording' || mode === 'playing';

  return (
    <section className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }} aria-labelledby={`s-${session.id}`}>
      <div className="split">
        <h2 id={`s-${session.id}`}>{session.neutral_label}</h2>
        <span className="mono" aria-live="off">
          {mode === 'recording' ? `Recording ${mmss(elapsed)}` : mode === 'playing' ? `Playing ${mmss(elapsed)}` : ''}
        </span>
      </div>

      <div className="record-controls panel panel-tight" role="group" aria-label="Recording controls">
        {mode === 'choose' && (
          <div className="stack">
            <p>Before playing, choose how to record the session. Only the game tab is recorded; no camera is used.</p>
            <label className="choice">
              <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
              <span>
                <strong>Also record my voice</strong>
                <span className="field-help" style={{ display: 'block' }}>Optional. Useful for thinking aloud while you play.</span>
              </span>
            </label>
            <div className="cluster">
              <button type="button" className="btn btn-primary" onClick={startRecording}>Share tab and record</button>
              <button type="button" className="btn" onClick={playWithoutRecording}>Play without recording</button>
            </div>
          </div>
        )}
        {mode === 'starting' && <p>Waiting for browser permission…</p>}
        {mode === 'recording' && (
          <div className="cluster">
            <span className="tag tag-error">Recording</span>
            <button type="button" className="btn" onClick={() => void stopRecording()}>Stop and save</button>
          </div>
        )}
        {mode === 'playing' && (
          <div className="cluster">
            <span className="tag">Not recording</span>
            <button type="button" className="btn" onClick={() => void finishWithoutRecording()}>I finished playing</button>
          </div>
        )}
        {mode === 'uploading' && (
          <div className="stack">
            <label htmlFor={`p-${session.id}`}>Uploading the recording</label>
            <progress id={`p-${session.id}`} max={1} value={progress} style={{ width: '100%', height: 12 }} />
          </div>
        )}
        {mode === 'done' && <p className="tag tag-success">Session saved</p>}
        {mode === 'failed' && (
          <div className="stack">
            <p className="field-error" role="alert">{error}</p>
            <div className="cluster">
              {pendingBlob.current ? (
                <button type="button" className="btn btn-primary" onClick={() => void upload()}>Retry upload</button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={startRecording}>Try recording again</button>
              )}
              <label className="btn">
                Upload your own recording
                <input type="file" accept="video/webm,video/mp4,video/quicktime" className="visually-hidden" onChange={(e) => e.target.files?.[0] && void manualUpload(e.target.files[0])} />
              </label>
              {!pendingBlob.current && <button type="button" className="btn" onClick={playWithoutRecording}>Play without recording</button>}
            </div>
            <p className="field-help">If you upload your own recording, it should be of this same session. It is recorded that you uploaded it manually.</p>
          </div>
        )}
        <p className="field-help live-region" aria-live="polite">{status}</p>
      </div>

      <div ref={wrapRef} className="game-frame-wrap" data-locked={!active || undefined}>
        <iframe
          ref={frameRef}
          src={session.play_url}
          title={`Game: ${session.neutral_label}`}
          sandbox="allow-scripts"
          className="game-frame"
          tabIndex={active ? 0 : -1}
        />
        {!active && (
          <div className="game-frame-cover">
            <p>{mode === 'done' ? 'Session finished.' : 'The game unlocks when you choose how to record the session.'}</p>
          </div>
        )}
      </div>

      {active && (
        <div className="stack panel panel-tight">
          <div className="field">
            <label htmlFor={`m-${session.id}`}>Note a moment</label>
            <textarea
              id={`m-${session.id}`}
              className="textarea"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="For example: I do not know what I can touch"
              aria-describedby={`mh-${session.id}`}
            />
            <span id={`mh-${session.id}`} className="field-help">It is saved with the game time. Then you go back to the game.</span>
          </div>
          <div className="cluster">
            <button type="button" className="btn" onClick={() => void saveComment()} disabled={savingComment || !draft.trim()}>
              {savingComment ? 'Saving…' : 'Add note'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={focusGame}>Back to the game</button>
          </div>
          {comments.length > 0 && (
            <ul className="stack" style={{ ['--gap' as string]: 'var(--s-2)', listStyle: 'none', margin: 0, padding: 0 }}>
              {comments.map((c) => (
                <li key={c.id} className="small">
                  <span className="mono">{mmss(c.t_ms)}</span> {c.body}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
