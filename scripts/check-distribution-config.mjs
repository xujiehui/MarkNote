import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLocalEnv } from './sync-config.mjs';

const root = process.argv[2] || 'dist';
const localEnv = readLocalEnv();
const configuredEndpoint = (localEnv.MARKNOTE_SYNC_CONFIG_URL || localEnv.VITE_SYNC_CONFIG_URL || '').trim();
const requireSyncConfig = localEnv.MARKNOTE_REQUIRE_SYNC_CONFIG === '1';
const supabaseProjectUrlPattern = /https:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)/gi;
const forbiddenPatterns = [
  { label: 'legacy Supabase environment variable', pattern: /(?:VITE|MARKNOTE)_SUPABASE_(?:URL|PUBLISHABLE_KEY|AUTH_REDIRECT_URL)/ },
  { label: 'Supabase publishable key', pattern: /sb_publishable_[A-Za-z0-9_-]{16,}/ },
  { label: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{16,}/ },
];

if (!existsSync(root)) {
  throw new Error(`Distribution directory is missing: ${root}. Run npm run build first.`);
}
if (requireSyncConfig && !configuredEndpoint) {
  throw new Error('Distribution requires cloud sync, but VITE_SYNC_CONFIG_URL is missing.');
}

const matches = [];
let containsConfiguredEndpoint = false;
for (const file of filesUnder(root)) {
  if (!/\.(?:html|js|css|json|map|svg|webmanifest)$/i.test(file)) {
    continue;
  }
  const content = readFileSync(file, 'utf8');
  containsConfiguredEndpoint ||= Boolean(configuredEndpoint && content.includes(configuredEndpoint));
  if (containsUnapprovedSupabaseUrl(content, configuredEndpoint)) {
    matches.push(`${relative(root, file)}: Supabase project URL`);
  }
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) {
      matches.push(`${relative(root, file)}: ${label}`);
    }
  }
}

if (requireSyncConfig && !containsConfiguredEndpoint) {
  throw new Error('Distribution requires cloud sync, but the configured backend endpoint is missing from the build.');
}

if (matches.length > 0) {
  throw new Error([
    'Distribution contains Supabase configuration that must be loaded from the sync backend API:',
    ...matches,
  ].join('\n'));
}

console.log(`Distribution config: ok (${root})`);

function containsUnapprovedSupabaseUrl(content, endpoint) {
  const matches = [...content.matchAll(supabaseProjectUrlPattern)];
  return matches.some(({ index }) => {
    if (!endpoint || index === undefined) {
      return true;
    }
    return content.slice(index, index + endpoint.length) !== endpoint;
  });
}

function* filesUnder(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* filesUnder(file);
    } else if (entry.isFile() && statSync(file).size > 0) {
      yield file;
    }
  }
}
