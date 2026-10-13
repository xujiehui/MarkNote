import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SYNC_MIGRATION_NAME = 'marknote_sync_v2';
export const SYNC_MIGRATION_VERSION = '202610130001';
export function syncMigrationSql() {
  const names = ['202606190001_marknote_sync_schema.sql', '202610130001_marknote_sync_v2.sql'];
  return ['begin;', ...names.map((name) => readFileSync(resolve('supabase/migrations',name),'utf8').trim()), 'commit;'].join('\n\n');
}

// Read-only metadata gates. Real authenticated CAS/replay checks are performed
// by marknote_sync_check_v2() in the app/online diagnostic; no JWT is invented.
export const readinessCheckSql = String.raw`
-- MarkNote Supabase sync readiness check (versioned protocol v2).
with expected_tables(table_name) as (
  values ('profiles'),('devices'),('folders'),('notes'),('attachments'),
    ('marknote_sync_counters'),('marknote_sync_entities'),('marknote_sync_changes'),
    ('marknote_sync_receipts'),('marknote_sync_storage_gc')
),
expected_grants(table_name,privilege_type) as (
  values ('profiles','SELECT'),('profiles','INSERT'),('profiles','UPDATE'),
    ('devices','SELECT'),('devices','INSERT'),('devices','UPDATE'),
    ('folders','SELECT'),('notes','SELECT'),('attachments','SELECT')
),
expected_rpc(signature) as (
  values ('public.marknote_sync_push_v2(jsonb)'),
    ('public.marknote_sync_pull_v2(bigint,bigint,integer)'),
    ('public.marknote_sync_check_v2()'),
    ('public.marknote_sync_collect_storage_v2(integer)'),
    ('public.marknote_sync_ack_storage_v2(text[])')
),
expected_public_policies(table_name,policy_name) as (
  values ('profiles','Users can read own profile'),('profiles','Users can insert own profile'),('profiles','Users can update own profile'),
    ('devices','Users can read own devices'),('devices','Users can insert own devices'),('devices','Users can update own devices'),
    ('folders','Users can read own folders'),('notes','Users can read own notes'),('attachments','Users can read own attachments')
),
expected_storage_policies(policy_name) as (
  values ('Users can read own attachment objects'),('Users can upload own attachment objects'),
    ('Users can update own attachment objects'),('Users can delete own attachment objects')
),
missing_tables as (
  select e.table_name from expected_tables e left join information_schema.tables t
    on t.table_schema='public' and t.table_name=e.table_name where t.table_name is null
),
missing_grants as (
  select e.table_name,e.privilege_type from expected_grants e left join information_schema.role_table_grants g
    on g.table_schema='public' and g.table_name=e.table_name and g.grantee = 'authenticated'
      and g.privilege_type=e.privilege_type where g.table_name is null
),
missing_rls as (
  select e.table_name from expected_tables e where not exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname = 'public' and c.relname=e.table_name and c.relkind in ('r', 'p') and c.relrowsecurity)
),
unsafe_legacy_writes as (
  select table_name from expected_tables where table_name in ('folders','notes','attachments') and
    case when to_regclass('public.'||table_name) is null then true
      else has_table_privilege('authenticated','public.'||table_name,'INSERT,UPDATE,DELETE') end
),
unsafe_internal_access as (
  select table_name from expected_tables where table_name like 'marknote_sync_%' and
    case when to_regclass('public.'||table_name) is null then true
      else has_table_privilege('authenticated','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE') end
),
unsafe_rpc as (
  select signature from expected_rpc e left join pg_proc p on p.oid=to_regprocedure(e.signature)
    where p.oid is null or not p.prosecdef or not coalesce(p.proconfig @> array['search_path=pg_catalog'],false)
      or not has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
      or pg_get_userbyid(p.proowner) in ('anon','authenticated')
  union all
  select 'public.marknote_sync_lock_v2()' where case when to_regprocedure('public.marknote_sync_lock_v2()') is null then true
    else has_function_privilege('authenticated','public.marknote_sync_lock_v2()','EXECUTE')
      or has_function_privilege('anon','public.marknote_sync_lock_v2()','EXECUTE') end
),
missing_public_policies as (
  select e.table_name,e.policy_name from expected_public_policies e left join pg_policies p
    on p.schemaname='public' and p.tablename=e.table_name and p.policyname=e.policy_name where p.policyname is null
),
missing_storage_policies as (
  select e.policy_name from expected_storage_policies e left join pg_policies p
    on p.schemaname='storage' and p.tablename='objects' and p.policyname=e.policy_name where p.policyname is null
),
missing_storage_grants as (
  select privilege_type from (values('SELECT'),('INSERT'),('UPDATE'),('DELETE')) expected(privilege_type)
    where not exists(select 1 from information_schema.role_table_grants g where g.table_schema='storage'
      and g.table_name='objects' and g.grantee = 'authenticated' and g.privilege_type=expected.privilege_type)
),
bucket_ready as (
  select exists(select 1 from storage.buckets where id='attachments' and name='attachments' and public is false) as ok
)
select 'tables' as check_name, not exists(select 1 from missing_tables) as ok,
  coalesce((select string_agg(table_name,', ' order by table_name) from missing_tables),'ok') as detail
union all select 'authenticated grants',not exists(select 1 from missing_grants),
  coalesce((select string_agg(table_name||':'||privilege_type,', ') from missing_grants),'ok')
union all select 'rls',not exists(select 1 from missing_rls),coalesce((select string_agg(table_name,', ') from missing_rls),'ok')
union all select 'legacy writes disabled',not exists(select 1 from unsafe_legacy_writes),coalesce((select string_agg(table_name,', ') from unsafe_legacy_writes),'ok')
union all select 'internal tables private',not exists(select 1 from unsafe_internal_access),coalesce((select string_agg(table_name,', ') from unsafe_internal_access),'ok')
union all select 'versioned RPC security',not exists(select 1 from unsafe_rpc),coalesce((select string_agg(signature,', ') from unsafe_rpc),'ok')
union all select 'public policies',not exists(select 1 from missing_public_policies),coalesce((select string_agg(table_name||':'||policy_name,', ') from missing_public_policies),'ok')
union all select 'attachments bucket',(select ok from bucket_ready),case when (select ok from bucket_ready) then 'ok' else 'missing or public' end
union all select 'storage rls',exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity),'storage.objects must use RLS'
union all select 'storage grants',not exists(select 1 from missing_storage_grants),coalesce((select string_agg(privilege_type,', ') from missing_storage_grants),'ok')
union all select 'storage policies',not exists(select 1 from missing_storage_policies),coalesce((select string_agg(policy_name,', ') from missing_storage_policies),'ok');
`;
export const REQUIRED_READINESS_CHECKS = ['tables','authenticated grants','rls','legacy writes disabled',
  'internal tables private','versioned RPC security','public policies','attachments bucket','storage rls','storage grants','storage policies'];
