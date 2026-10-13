import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readLocalEnv } from './sync-config.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const requiredRendererMarkers = [
  ['sync table write diagnostic', 'Sync table writes'],
  ['storage canary diagnostic', 'Attachment storage canary'],
  ['attachment placeholder hydration', 'marknote-attachment://'],
  ['nested network error cause reporting', 'caused by:'],
  ['network reachability diagnosis', 'before Auth/Data API checks could run'],
  ['network remediation hint', 'VPN/proxy/firewall'],
  ['local-first welcome copy', '内容会先自动保存到本地'],
];

try {
  const options = parseOptions(process.argv.slice(2));
  const archives = options.asar ? [options.asar] : findArchives(options.release);
  assert(archives.length > 0, `No unpacked desktop app.asar was found under ${options.release}. Build and package a native target first, or pass --asar <path>.`);
  for (const archive of archives) checkArchive(archive, options.dist);
  console.log(`Desktop package contents: ${archives.length} archive(s) verified. Native installation, signing, upgrade and OAuth smoke tests remain separate release checks.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function checkArchive(archive, dist) {
  assert(existsSync(archive), `Desktop package archive is missing: ${archive}`);
  assert(existsSync(join(dist, 'index.html')), `Current renderer build is missing: ${dist}. Run npm run build first.`);
  const files = new Set(asar.listPackage(archive).map((file) => file.replaceAll('\\', '/')));
  const text = (file) => Buffer.from(asar.extractFile(archive, file.replace(/^\//, ''))).toString('utf8');
  const bytes = (file) => Buffer.from(asar.extractFile(archive, file.replace(/^\//, '')));
  for (const file of ['/dist/index.html', '/dist/offline-manifest.json', '/dist/sw.js', '/dist-electron/main.js', '/dist-electron/preload.cjs', '/dist-electron/securityPolicy.js', '/dist-electron/authCallbackState.js', '/package.json']) {
    assert(files.has(file), `Desktop package is missing ${file}. Rebuild the renderer and Electron main process before packaging.`);
  }
  const packagedEntry = rendererEntry(text('/dist/index.html'));
  const currentEntry = rendererEntry(readFileSync(join(dist, 'index.html'), 'utf8'));
  assert(packagedEntry === currentEntry, 'Packaged renderer entry does not match the current build. Repackage before distributing.');
  assert(files.has(`/dist/${packagedEntry}`), `Desktop package is missing the renderer entry: ${packagedEntry}`);

  // Every artifact is checked: an unchanged entry alone does not establish
  // that a lazy workspace or another split bundle belongs to this build.
  for (const [relativePath, currentBytes] of filesUnder(dist)) {
    const packagedPath = `/dist/${relativePath}`;
    assert(files.has(packagedPath), `Desktop package is missing current renderer artifact: ${relativePath}`);
    assert(hash(bytes(packagedPath)) === hash(currentBytes), `Packaged renderer artifact differs from the current build: ${relativePath}`);
  }
  const rendererFiles = [...files].filter((file) => /^\/dist\/assets\/.+\.js$/.test(file));
  const rendererSource = rendererFiles.map(text).join('\n');
  for (const [label, marker] of requiredRendererMarkers) assertIncludes(rendererSource, marker, label);
  const mainSource = text('/dist-electron/main.js');
  for (const [label, marker] of [
    ['custom protocol registration', 'setAsDefaultProtocolClient'],
    ['macOS deep link handling', 'open-url'],
    ['auth callback IPC dispatch', 'marknote:auth-callback'],
    ['isolated renderer context', 'contextIsolation: true'],
    ['disabled renderer Node integration', 'nodeIntegration: false'],
    ['sandboxed renderer', 'sandbox: true'],
    ['renderer web security', 'webSecurity: true'],
    ['permission policy', 'setPermissionRequestHandler'],
  ]) assertIncludes(mainSource, marker, label);
  const preloadSource = text('/dist-electron/preload.cjs');
  for (const marker of ['onAuthCallback', 'clearAuthCallback']) assertIncludes(preloadSource, marker, 'auth callback bridge');
  assertIncludes(text('/dist/index.html'), 'Content-Security-Policy', 'production content security policy');
  const manifest = JSON.parse(text('/dist/offline-manifest.json'));
  assert(manifest.format === 1 && Array.isArray(manifest.entries) && manifest.entries.length > 0, 'Packaged offline artifact manifest is invalid.');
  for (const entry of manifest.entries) {
    assert(typeof entry.url === 'string' && /^\.\/[\w./-]+$/.test(entry.url) && !entry.url.includes('..'), 'Packaged offline artifact URL is invalid.');
    assert(hash(bytes(`/dist/${entry.url.slice(2)}`)) === entry.revision, `Packaged offline artifact checksum does not match: ${entry.url}`);
  }
  const env = readLocalEnv();
  const endpoint = (env.MARKNOTE_SYNC_CONFIG_URL || env.VITE_SYNC_CONFIG_URL || '').trim();
  for (const file of [...files].filter((file) => /^\/dist\/.+\.(?:js|html|css|json|webmanifest)$/.test(file))) assertNoEmbeddedConfig(text(file), endpoint);
  const packagedPackage = JSON.parse(text('/package.json'));
  const sourcePackage = JSON.parse(readFileSync('package.json', 'utf8'));
  assert(packagedPackage.name === sourcePackage.name && packagedPackage.version === sourcePackage.version, 'Packaged package name or version does not match the source repository.');
  assert(packagedPackage.main === 'dist-electron/main.js', 'Packaged Electron main entry is invalid.');
  assertReleaseCommands(sourcePackage);
  console.log(`Desktop package: ok (${archive})`);
  console.log(`Renderer entry: ${packagedEntry}; ${rendererFiles.length} renderer bundles inspected`);
}

function parseOptions(args) {
  const options = { release: 'release', dist: 'dist', asar: '' };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = flag?.replace(/^--/, '');
    assert(['release', 'dist', 'asar'].includes(key) && args[index + 1], 'Usage: check-desktop-package.mjs [--asar path] [--release directory] [--dist directory]');
    options[key] = resolve(args[index + 1]);
  }
  return options;
}

function findArchives(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith('.asar.unpacked')) return findArchives(file);
    return entry.isFile() && entry.name === 'app.asar' ? [file] : [];
  }).sort();
}

function* filesUnder(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(file, relativePath);
    else if (entry.isFile()) yield [relativePath, readFileSync(file)];
  }
}

function rendererEntry(html) {
  const match = html.match(/<script\b[^>]*\bsrc=["'](?:\.\/)?(assets\/[^"'<>?#]+\.js)["'][^>]*>/);
  assert(match, 'The renderer index is missing its local JavaScript entry.');
  return match[1];
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function assertIncludes(source, marker, label) { assert(source.includes(marker), `Packaged app is missing ${label}.`); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function assertNoEmbeddedConfig(source, endpoint) {
  for (const forbidden of [/(?:VITE|MARKNOTE)_SUPABASE_(?:URL|PUBLISHABLE_KEY|AUTH_REDIRECT_URL)/, /sb_publishable_[A-Za-z0-9_-]{16,}/, /sb_secret_[A-Za-z0-9_-]{16,}/]) {
    assert(!forbidden.test(source), 'Packaged renderer contains embedded Supabase credentials or project configuration. Load configuration from the sync backend API.');
  }
  const projects = [...source.matchAll(/https:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)/gi)];
  assert(projects.every(({ index }) => endpoint && index !== undefined && source.slice(index, index + endpoint.length) === endpoint), 'Packaged renderer contains an unapproved Supabase project URL.');
}

function assertReleaseCommands(packageJson) {
  const scripts = packageJson.scripts || {};
  for (const command of ['npm test', 'npm run desktop:pack', 'npm run check:desktop-package']) {
    assert(typeof scripts['verify:release:local'] === 'string' && scripts['verify:release:local'].includes(command), `verify:release:local must run ${command}.`);
  }
  for (const [name, expected] of Object.entries({
    'check:supabase-sync:oauth': 'node scripts/check-supabase-sync.mjs --oauth-login --require-auth',
    'check:supabase-migration': 'node scripts/apply-supabase-migration.mjs',
    'apply:supabase-migration': 'node scripts/apply-supabase-migration.mjs --apply',
    'print:supabase-readiness-check': 'node scripts/print-supabase-readiness-check.mjs',
    'verify:release:online': 'npm run check:google-oauth && npm run check:supabase-migration && npm run check:supabase-sync:oauth',
    'verify:release:online:manual': 'npm run check:google-oauth && npm run check:supabase-sync:oauth',
    'verify:release:online:apply': 'npm run check:google-oauth && npm run apply:supabase-migration && npm run check:supabase-sync:oauth',
  })) assert(scripts[name] === expected, `The required release verification command ${name} has changed or is missing.`);
}
