const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'marknote-package-check-'));
  try {
    const dist = join(temporary, 'dist');
    const app = join(temporary, 'application');
    const archive = join(temporary, 'app.asar');
    const release = join(temporary, 'release');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<meta http-equiv="Content-Security-Policy" content="default-src self"><script type="module" src="./assets/index-test.js"></script>');
    writeFileSync(join(dist, 'assets/index-test.js'), 'console.log("Lazy workspace starts separately");');
    const workspace = ['Sync table writes', 'Attachment storage canary', 'marknote-attachment://', 'caused by:', 'before Auth/Data API checks could run', 'VPN/proxy/firewall', '内容会先自动保存到本地'].join('\n');
    writeFileSync(join(dist, 'assets/NoteWorkspace-test.js'), JSON.stringify(workspace));
    regenerate(dist);
    cpSync(dist, join(app, 'dist'), { recursive: true });
    mkdirSync(join(app, 'dist-electron'));
    writeFileSync(join(app, 'dist-electron/main.js'), 'const preferences={contextIsolation: true,nodeIntegration: false,sandbox: true,webSecurity: true}; const names=["setAsDefaultProtocolClient","open-url","marknote:auth-callback","setPermissionRequestHandler"];');
    writeFileSync(join(app, 'dist-electron/preload.cjs'), 'module.exports={onAuthCallback(){},clearAuthCallback(){}};');
    writeFileSync(join(app, 'dist-electron/securityPolicy.js'), 'export const PRODUCTION_CSP="default-src self";');
    writeFileSync(join(app, 'dist-electron/authCallbackState.js'), 'export const protocol="marknote";');
    cpSync('package.json', join(app, 'package.json'));
    await asar.createPackage(app, archive);

    const explicit = run(['--asar', archive, '--dist', dist]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stdout, /2 renderer bundles inspected/, 'The diagnostics can live in a lazy workspace chunk');
    assert.match(explicit.stdout, /Native installation, signing, upgrade and OAuth smoke tests remain separate/);
    for (const platform of ['mac/MarkNote.app/Contents/Resources', 'mac-arm64/MarkNote.app/Contents/Resources', 'win-unpacked/resources']) {
      mkdirSync(join(release, platform), { recursive: true });
      copyFileSync(archive, join(release, platform, 'app.asar'));
    }
    const discovered = run(['--release', release, '--dist', dist]);
    assert.equal(discovered.status, 0, discovered.stderr);
    assert.match(discovered.stdout, /3 archive\(s\) verified/);

    writeFileSync(join(app, 'dist/assets/NoteWorkspace-test.js'), `${JSON.stringify(workspace)}; console.log("stale chunk");`);
    await asar.createPackage(app, archive);
    assert.match(run(['--asar', archive, '--dist', dist]).stderr, /artifact differs/, 'A matching entry must not hide a stale lazy chunk');
    cpSync(dist, join(app, 'dist'), { recursive: true });
    rmSync(join(app, 'dist-electron/securityPolicy.js'));
    await asar.createPackage(app, archive);
    assert.match(run(['--asar', archive, '--dist', dist]).stderr, /missing \/dist-electron\/securityPolicy\.js/);
    writeFileSync(join(app, 'dist-electron/securityPolicy.js'), 'export const PRODUCTION_CSP="default-src self";');
    rmSync(join(app, 'dist/assets/NoteWorkspace-test.js'));
    await asar.createPackage(app, archive);
    assert.match(run(['--asar', archive, '--dist', dist]).stderr, /missing current renderer artifact/);

    writeFileSync(join(dist, 'assets/NoteWorkspace-test.js'), `${JSON.stringify(workspace)}; const key="sb_secret_${'a'.repeat(20)}";`);
    regenerate(dist);
    cpSync(dist, join(app, 'dist'), { recursive: true });
    await asar.createPackage(app, archive);
    const embedded = run(['--asar', archive, '--dist', dist]);
    assert.equal(embedded.status, 1);
    assert.match(embedded.stderr, /embedded Supabase credentials/);

    writeFileSync(join(dist, 'assets/NoteWorkspace-test.js'), JSON.stringify(workspace));
    regenerate(dist);
    const badManifest = JSON.parse(readFileSync(join(dist, 'offline-manifest.json'), 'utf8'));
    badManifest.entries[0].revision = '0'.repeat(64);
    writeFileSync(join(dist, 'offline-manifest.json'), JSON.stringify(badManifest));
    cpSync(dist, join(app, 'dist'), { recursive: true });
    await asar.createPackage(app, archive);
    assert.match(run(['--asar', archive, '--dist', dist]).stderr, /offline artifact checksum/);
    assert.equal(run(['--unknown', 'value']).status, 1);
    assert.equal(run(['--asar', join(temporary, 'absent.asar'), '--dist', dist]).status, 1);
    console.log('Desktop archive discovery, lazy chunk integrity, security and release-check tests passed');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function regenerate(directory) {
  const result = spawnSync(process.execPath, ['scripts/generate-pwa-precache.mjs', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function run(args) {
  return spawnSync(process.execPath, ['scripts/check-desktop-package.mjs', ...args], {
    encoding: 'utf8', env: { ...process.env, MARKNOTE_SYNC_CONFIG_URL: '', VITE_SYNC_CONFIG_URL: '', MARKNOTE_REQUIRE_SYNC_CONFIG: '' },
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
