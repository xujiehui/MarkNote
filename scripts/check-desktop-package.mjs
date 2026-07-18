
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readLocalEnv } from './sync-config.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const appPath = join('release', 'mac', 'MarkNote.app');
const asarPath = join(appPath, 'Contents', 'Resources', 'app.asar');
const requiredRendererMarkers = [
  { label: 'sync table write diagnostic', text: 'Sync table writes' },
  { label: 'storage canary diagnostic', text: 'Attachment storage canary' },
  { label: 'attachment placeholder hydration', text: 'marknote-attachment://' },
  { label: 'nested network error cause reporting', text: 'caused by:' },
  { label: 'network reachability diagnosis', text: 'before Auth/Data API checks could run' },
  { label: 'network remediation hint', text: 'VPN/proxy/firewall' },
  {
    label: 'local-first signed-out copy',
    text: '\u5185\u5bb9\u4f1a\u5148\u81ea\u52a8\u4fdd\u5b58\u5230\u672c\u5730',
  },
];
const requiredMainMarkers = [
  { label: 'custom protocol registration', text: 'setAsDefaultProtocolClient' },
  { label: 'macOS deep link handling', text: 'open-url' },
  { label: 'auth callback IPC dispatch', text: 'marknote:auth-callback' },
];
const requiredPreloadMarkers = [
  { label: 'auth callback bridge', text: 'onAuthCallback' },
  { label: 'auth callback clear bridge', text: 'clearAuthCallback' },
];

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main() {
  assertFile(asarPath, `Packaged desktop app is missing at ${asarPath}. Run npm run desktop:pack first.`);

  const packageFiles = new Set(asar.listPackage(asarPath));
  assertPackageFile(packageFiles, '/dist/index.html');
  assertPackageFile(packageFiles, '/dist-electron/main.js');
  assertPackageFile(packageFiles, '/dist-electron/preload.cjs');
  assertPackageFile(packageFiles, '/package.json');

  const packagedIndexHtml = readPackageText('/dist/index.html');
  const packagedEntry = rendererEntryFromIndex(packagedIndexHtml, 'packaged dist/index.html');
  assertPackageFile(packageFiles, `/dist/${packagedEntry}`);

  assertFile(join('dist', 'index.html'), 'Current dist/index.html is missing. Run npm run build before checking the desktop package.');
  const currentEntry = rendererEntryFromIndex(readFileSync(join('dist', 'index.html'), 'utf8'), 'current dist/index.html');
  assert(
    packagedEntry === currentEntry,
    [
      `Packaged renderer entry ${packagedEntry} does not match current dist entry ${currentEntry}.`,
      'Run npm run desktop:pack so release/mac/MarkNote.app contains the latest frontend build.',
    ].join('\n'),
  );

  const packagedRenderer = readPackageText(`/dist/${packagedEntry}`);
  const packagedMain = readPackageText('/dist-electron/main.js');
  const packagedPreload = readPackageText('/dist-electron/preload.cjs');
  const packagedPackageJson = readPackageText('/package.json');
  const sourcePackageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  for (const marker of requiredRendererMarkers) {
    assertIncludes(packagedRenderer, marker.text, marker.label);
  }
  for (const marker of requiredMainMarkers) {
    assertIncludes(packagedMain, marker.text, marker.label);
  }
  for (const marker of requiredPreloadMarkers) {
    assertIncludes(packagedPreload, marker.text, marker.label);
  }
  const localEnv = readLocalEnv();
  const configuredEndpoint = (localEnv.MARKNOTE_SYNC_CONFIG_URL || localEnv.VITE_SYNC_CONFIG_URL || '').trim();
  assertNoEmbeddedSupabaseConfig(packagedRenderer, configuredEndpoint);
  assertIncludes(packagedPackageJson, '"main": "dist-electron/main.js"', 'Electron package main entry');
  assertLocalReleaseScript(sourcePackageJson);

  const appMtime = statSync(asarPath).mtimeMs;
  const distMtime = statSync(join('dist', currentEntry)).mtimeMs;
  assert(
    appMtime >= distMtime,
    [
      'Packaged app.asar is older than the current renderer asset.',
      'Run npm run desktop:pack again before distributing the desktop app.',
    ].join('\n'),
  );

  console.log(`Desktop package: ok (${asarPath})`);
  console.log(`Renderer entry: ${packagedEntry}`);
  console.log('Verified sync diagnostics, attachment hydration, OAuth callback bridge, and current dist entry.');
}

function readPackageText(path) {
  return Buffer.from(asar.extractFile(asarPath, path.replace(/^\//, ''))).toString('utf8');
}

function rendererEntryFromIndex(html, label) {
  const match = html.match(/assets\/index-[^"'<>]+\.js/);
  assert(match, `Could not find renderer entry script in ${label}.`);
  return match[0];
}

function assertPackageFile(files, path) {
  assert(files.has(path), `Packaged app is missing ${path}. Run npm run desktop:pack again.`);
}

function assertFile(path, message) {
  assert(existsSync(path), message);
}

function assertIncludes(value, marker, label) {
  assert(value.includes(marker), `Packaged app is missing ${label} marker (${marker}).`);
}

function assertNoEmbeddedSupabaseConfig(value, endpoint) {
  const forbiddenPatterns = [
    /(?:VITE|MARKNOTE)_SUPABASE_(?:URL|PUBLISHABLE_KEY|AUTH_REDIRECT_URL)/,
    /sb_publishable_[A-Za-z0-9_-]{16,}/,
    /sb_secret_[A-Za-z0-9_-]{16,}/,
  ];
  assert(
    forbiddenPatterns.every((pattern) => !pattern.test(value)),
    'Packaged renderer contains embedded Supabase configuration. The app must load it from the sync backend API.',
  );
  const supabaseProjectUrlPattern = /https:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)/gi;
  assert(
    [...value.matchAll(supabaseProjectUrlPattern)].every(({ index }) =>
      endpoint && index !== undefined && value.slice(index, index + endpoint.length) === endpoint,
    ),
    'Packaged renderer contains an unapproved Supabase project URL. Only the configured sync backend endpoint may be embedded.',
  );
}

function assertLocalReleaseScript(packageJson) {
  const script = packageJson.scripts?.['verify:release:local'];
  assert(
    typeof script === 'string',
    'package.json is missing scripts.verify:release:local.',
  );

  for (const command of ['npm test', 'npm run desktop:pack', 'npm run check:desktop-package']) {
    assert(
      script.includes(command),
      `scripts.verify:release:local must run ${command}.`,
    );
  }
  assert(
    packageJson.scripts?.['check:supabase-sync:oauth'] === 'node scripts/check-supabase-sync.mjs --oauth-login --require-auth',
    'package.json is missing scripts.check:supabase-sync:oauth.',
  );
  assert(
    packageJson.scripts?.['check:supabase-migration'] === 'node scripts/apply-supabase-migration.mjs',
    'package.json is missing scripts.check:supabase-migration.',
  );
  assert(
    packageJson.scripts?.['apply:supabase-migration'] === 'node scripts/apply-supabase-migration.mjs --apply',
    'package.json is missing scripts.apply:supabase-migration.',
  );
  assert(
    packageJson.scripts?.['print:supabase-readiness-check'] === 'node scripts/print-supabase-readiness-check.mjs',
    'package.json is missing scripts.print:supabase-readiness-check.',
  );
  assert(
    packageJson.scripts?.['verify:release:online'] ===
      'npm run check:google-oauth && npm run check:supabase-migration && npm run check:supabase-sync:oauth',
    'package.json is missing scripts.verify:release:online.',
  );
  assert(
    packageJson.scripts?.['verify:release:online:manual'] ===
      'npm run check:google-oauth && npm run check:supabase-sync:oauth',
    'package.json is missing scripts.verify:release:online:manual.',
  );
  assert(
    packageJson.scripts?.['verify:release:online:apply'] ===
      'npm run check:google-oauth && npm run apply:supabase-migration && npm run check:supabase-sync:oauth',
    'package.json is missing scripts.verify:release:online:apply.',
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
