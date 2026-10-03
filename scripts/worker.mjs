// Long-running job worker. Same code path as /api/jobs/tick, outside Vercel.
//   node scripts/worker.mjs            # loop until stopped
//   node scripts/worker.mjs --once     # drain the queue and exit
// Reads .env.local if present. Reports where it ran in each job (FUNLABS_RUNNER).
import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#') && process.env[line.slice(0, i)] === undefined) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
}
process.env.FUNLABS_RUNNER ??= `worker (${process.env.HOSTNAME ?? 'local'})`;

const { workerClient } = await import('../lib/supabase/worker.ts');
const { runJobs } = await import('../lib/jobs.ts');
const once = process.argv.includes('--once');
const worker = await workerClient();
console.log(`[worker] runner: ${process.env.FUNLABS_RUNNER}`);
let stop = false;
process.on('SIGINT', () => (stop = true));
process.on('SIGTERM', () => (stop = true));
do {
  const report = await runJobs(worker, { maxJobs: 10, deadlineMs: 240_000 });
  for (const p of report.processed) console.log(`[worker] ${p.kind} ${p.ok ? 'ok' : 'FAILED: ' + p.error} (${p.ms} ms)`);
  if (once && report.stoppedBecause === 'empty') break;
  if (report.stoppedBecause === 'empty') await new Promise((r) => setTimeout(r, 5000));
} while (!stop);
