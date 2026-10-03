/** Formatting helpers (stable on server and client). */
export function mmss(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function minutes(ms: number): string {
  const m = ms / 60000;
  return m < 1 ? `${Math.round(ms / 1000)} s` : `${m.toFixed(1)} min`;
}

export function money(cents: number | null | undefined, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2 }).format((cents ?? 0) / 100);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC';
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 10) : '-';
}

export const JOB_KIND_LABEL: Record<string, string> = {
  analyze_session: 'Gemini analysis',
  run_checks: 'Checks',
  intervention: 'Claude intervention',
  export_dataset: 'Research export',
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
