import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'dist');
const template = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const marker = '/*__MARKNOTE_PRECACHE__*/ null';
if (!existsSync(join(directory, 'index.html')) || !existsSync(join(directory, 'assets'))) {
  throw new Error('A complete Vite production build is required before generating the offline manifest.');
}
if (!template.includes(marker)) throw new Error('The offline worker template marker is missing.');

// Only public, built artifacts belong here. Local configuration, source maps,
// credentials and arbitrary JSON files must never enter the offline cache.
const paths = [
  'index.html',
  'manifest.webmanifest',
  'marknote.svg',
  ...filesUnder(join(directory, 'assets')).map((path) => relative(directory, path).replaceAll('\\', '/')),
].filter((path) => existsSync(join(directory, path)) && /\.(?:html|js|css|webmanifest|svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf)$/i.test(path)).sort();
const entries = paths.map((path) => ({
  url: `./${path}`,
  revision: createHash('sha256').update(readFileSync(join(directory, path))).digest('hex'),
}));
const version = createHash('sha256').update(template).update(JSON.stringify(entries)).digest('hex').slice(0, 24);
const manifest = { format: 1, version, entries };
writeFileSync(join(directory, 'sw.js'), template.replace(marker, JSON.stringify(manifest)));
writeFileSync(join(directory, 'offline-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Offline app shell: ${entries.length} artifacts (${version})`);

function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
  });
}
