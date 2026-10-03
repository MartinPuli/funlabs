import fs from 'node:fs';
import path from 'node:path';

/** Reads .env.local (if present) without overriding the process environment. */
export function loadEnvLocal(file = path.resolve(process.cwd(), '.env.local')): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...process.env };
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}
