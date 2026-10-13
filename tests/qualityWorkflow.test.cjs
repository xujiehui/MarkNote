const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const pinnedNode = readFileSync('.node-version', 'utf8').trim();
assert.equal(pinnedNode, '24.19.0');
assert.equal(readFileSync('.nvmrc', 'utf8').trim(), pinnedNode);
for (const name of ['pages', 'desktop-build']) {
  const source = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
  assert.match(source, /uses: \.\/\.github\/workflows\/quality\.yml/);
  assert.match(source, /build:\s+name:[^\n]+\s+needs: quality/);
  assert.ok(source.includes(`NODE_VERSION: '${pinnedNode}'`));
  assert.match(source, /run: npm install --global npm@11\.9\.0/);
}
const quality = readFileSync('.github/workflows/quality.yml', 'utf8');
assert.match(quality, /workflow_call:/);
assert.match(quality, /node-version-file: \.node-version/);
assert.match(quality, /NPM_VERSION: '11\.9\.0'/);
assert.match(quality, /run: npm install --global npm@11\.9\.0/);
assert.match(quality, /run: npm ci/);
assert.match(quality, /run: npm run lint/);
assert.match(quality, /run: npm test/);
assert.match(quality, /run: npm run desktop:build/);
assert.match(quality, /run: node tests\/pwaOffline\.test\.cjs --distribution dist/);
assert.match(quality, /run: npx playwright install --with-deps chromium/);
assert.match(quality, /run: npm run test:e2e/);
assert.match(quality, /- name: Upload failed browser traces\s+if: failure\(\)/);
assert.match(readFileSync('.github/workflows/desktop-build.yml', 'utf8'), /- name: Verify packaged app contents\s+if: env\.SHOULD_BUILD == 'true'\s+run: npm run check:desktop-package/);
console.log('Shared CI quality and pinned toolchain tests passed');
