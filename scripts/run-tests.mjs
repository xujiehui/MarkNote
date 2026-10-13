import { readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

writeFileSync('.tmp-tests/package.json', JSON.stringify({ type: 'commonjs' }));
const suites = [
  ...readdirSync('.tmp-tests/tests').filter((file) => file.endsWith('.test.js')).sort().map((file) => `.tmp-tests/tests/${file}`),
  ...readdirSync('tests').filter((file) => file.endsWith('.test.cjs')).sort().map((file) => `tests/${file}`),
];
if (!suites.length) throw new Error('No test suites discovered.');
let passed = 0;
const failed = [];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    failed.push(suite);
    continue;
  }
  passed += 1;
}
console.log(`Test suites: ${passed}/${suites.length} passed`);
if (failed.length) console.error(`Failed suites: ${failed.join(', ')}`);
