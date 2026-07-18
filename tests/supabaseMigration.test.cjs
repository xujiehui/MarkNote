
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const sql = readFileSync('supabase/migrations/202606190001_marknote_sync_schema.sql', 'utf8');
const configSql = readFileSync('supabase/migrations/202607180003_marknote_sync_config_bucket.sql', 'utf8');

assert.match(sql, /grant select, insert, update, delete on table public\.notes to authenticated;/i);
assert.match(sql, /alter table public\.notes enable row level security;/i);
assert.match(sql, /create policy "Users can update own notes"[\s\S]*using \(\(select auth\.uid\(\)\) = user_id\)[\s\S]*with check \(\(select auth\.uid\(\)\) = user_id\)/i);
assert.match(sql, /create or replace function public\.handle_new_user\(\)[\s\S]*security definer[\s\S]*if tg_table_schema <> 'auth' or tg_table_name <> 'users' then[\s\S]*raise exception 'public\.handle_new_user can only be invoked by the auth\.users trigger';/i);
assert.match(sql, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated;/i);
assert.match(sql, /constraint notes_user_folder_fk[\s\S]*foreign key \(user_id, folder_id\)[\s\S]*references public\.folders\(user_id, id\)/i);
assert.match(sql, /constraint attachments_user_note_fk[\s\S]*foreign key \(user_id, note_id\)[\s\S]*references public\.notes\(user_id, id\)/i);
assert.match(sql, /do \$\$[\s\S]*alter table public\.notes[\s\S]*add constraint notes_user_folder_fk[\s\S]*when duplicate_object then null;[\s\S]*end;\s*\$\$;/i);
assert.match(sql, /do \$\$[\s\S]*alter table public\.attachments[\s\S]*add constraint attachments_user_note_fk[\s\S]*when duplicate_object then null;[\s\S]*end;\s*\$\$;/i);
assert.match(sql, /do \$\$[\s\S]*alter table public\.notes[\s\S]*add constraint notes_user_folder_fk[\s\S]*not valid[\s\S]*when duplicate_object then null;[\s\S]*end;\s*\$\$;/i);
assert.match(sql, /do \$\$[\s\S]*alter table public\.attachments[\s\S]*add constraint attachments_user_note_fk[\s\S]*not valid[\s\S]*when duplicate_object then null;[\s\S]*end;\s*\$\$;/i);
assert.match(sql, /insert into storage\.buckets \(id, name, public\)[\s\S]*values \('attachments', 'attachments', false\)/i);
assert.match(sql, /grant select, insert, update, delete on table storage\.objects to authenticated;/i);
assert.match(sql, /create policy "Users can update own attachment objects"[\s\S]*for update[\s\S]*using[\s\S]*with check/i);
assert.match(sql, /create policy "Users can delete own attachment objects"[\s\S]*for delete[\s\S]*using/i);
assert.match(sql, /notify pgrst, 'reload schema';/i);
assert.match(configSql, /insert into storage\.buckets \(id, name, public\)[\s\S]*values \('marknote-config', 'marknote-config', true\)/i);
assert.match(configSql, /on conflict \(id\) do update set public = true;/i);
assert.doesNotMatch(configSql, /sb_(?:publishable|secret)_/i);

console.log('supabase migration tests passed');
