import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || 'dist';
const forbiddenPatterns = [
  { label: 'legacy Supabase environment variable', pattern: /(?:VITE|MARKNOTE)_SUPABASE_(?:URL|PUBLISHABLE_KEY|AUTH_REDIRECT_URL)/ },
  { label: 'Supabase project URL', pattern: /https:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)/i },
  { label: 'Supabase publishable key', pattern: /sb_publishable_[A-Za-z0-9_-]{16,}/ },
  { label: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{16,}/ },
];

if (!existsSync(root)) {
  throw new Error(`Distribution directory is missing: ${root}. Run npm run build first.`);
}

const matches = [];
for (const file of filesUnder(root)) {
  if (!/\.(?:html|js|css|json|map|svg|webmanifest)$/i.test(file)) {
    continue;
  }
  const content = readFileSync(file, 'utf8');
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) {
      matches.push(`${relative(root, file)}: ${label}`);
    }
  }
}

if (matches.length > 0) {
  throw new Error([
    'Distribution contains Supabase configuration that must be loaded from the sync backend API:',
    ...matches,
  ].join('\n'));
}

console.log(`Distribution config: ok (${root})`);

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
