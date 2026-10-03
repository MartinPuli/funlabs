// Run the frozen check suite on a build file.
//   node scripts/run-checks.mjs games/gravity-room/a/index.html [baseline.html]
import fs from 'node:fs';
const { buildSuiteDefinition, runHeadlessSuite, suitePassed, suiteDigest } = await import('../lib/checks/suite.ts');
const route = JSON.parse(fs.readFileSync('games/gravity-room/route.json', 'utf8'));
const def = buildSuiteDefinition(route);
const [file, baseline] = process.argv.slice(2);
if (!file) { console.error('uso: node scripts/run-checks.mjs <build.html> [base.html]'); process.exit(2); }
const results = runHeadlessSuite(def, fs.readFileSync(file, 'utf8'), baseline ? fs.readFileSync(baseline, 'utf8') : undefined);
console.log(`suite ${def.id} v${def.version} (${suiteDigest(def).slice(0, 12)})`);
for (const r of results) console.log(`${r.status === 'passed' ? 'OK    ' : r.status.toUpperCase().padEnd(6)} ${r.label}: ${r.summary}`);
process.exit(suitePassed(results) ? 0 : 1);
