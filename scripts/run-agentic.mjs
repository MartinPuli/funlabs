// Runs the agentic e2e suite against a running app (default http://localhost:3000)
// and the local Supabase stack, with a throwaway creator that is removed afterwards.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = { ...process.env };
for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split('\n') : []) {
  const i = line.indexOf('=');
  if (i > 0 && !line.startsWith('#') && env[line.slice(0, i)] === undefined) env[line.slice(0, i)] = line.slice(i + 1);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `agentic-${Date.now()}@funlabs.test`;
const password = randomBytes(18).toString('base64url');
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const userId = created.data.user.id;
let status = 1;
try {
  const run = spawnSync('npx', ['e2e', 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...env, E2E_CREATOR_EMAIL: email, E2E_CREATOR_PASSWORD: password, E2E_TELEMETRY_DISABLED: '1' },
  });
  status = run.status ?? 1;
} finally {
  const studies = await admin.from('studies').select('id').eq('owner_id', userId);
  for (const s of studies.data ?? []) await admin.from('studies').delete().eq('id', s.id);
  const products = await admin.from('products').select('id').eq('owner_id', userId);
  for (const p of products.data ?? []) {
    await admin.from('versions').delete().eq('product_id', p.id);
    await admin.from('products').delete().eq('id', p.id);
  }
  await admin.auth.admin.deleteUser(userId);
}
process.exit(status);
