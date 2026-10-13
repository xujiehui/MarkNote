import { syncMigrationSql } from './supabase-schema.mjs';
try { console.log(syncMigrationSql()); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
