
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/202606190001_marknote_sync_schema.sql');

try {
  console.log(readFileSync(migrationPath, 'utf8').trimEnd());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
