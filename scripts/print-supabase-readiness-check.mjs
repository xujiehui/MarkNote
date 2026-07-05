
const readinessCheckSql = String.raw`
-- MarkNote Supabase sync readiness check.
-- Paste this into the Supabase SQL Editor after applying the migration.

with expected_tables(table_name) as (
  values
    ('profiles'),
    ('devices'),
    ('folders'),
    ('notes'),
    ('attachments')
),
required_privileges(privilege_type) as (
  values
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE')
),
expected_public_policies(table_name, policy_name) as (
  values
    ('profiles', 'Users can read own profile'),
    ('profiles', 'Users can insert own profile'),
    ('profiles', 'Users can update own profile'),
    ('devices', 'Users can read own devices'),
    ('devices', 'Users can insert own devices'),
    ('devices', 'Users can update own devices'),
    ('devices', 'Users can delete own devices'),
    ('folders', 'Users can read own folders'),
    ('folders', 'Users can insert own folders'),
    ('folders', 'Users can update own folders'),
    ('folders', 'Users can delete own folders'),
    ('notes', 'Users can read own notes'),
    ('notes', 'Users can insert own notes'),
    ('notes', 'Users can update own notes'),
    ('notes', 'Users can delete own notes'),
    ('attachments', 'Users can read own attachments'),
    ('attachments', 'Users can insert own attachments'),
    ('attachments', 'Users can update own attachments'),
    ('attachments', 'Users can delete own attachments')
),
expected_storage_policies(policy_name) as (
  values
    ('Users can read own attachment objects'),
    ('Users can upload own attachment objects'),
    ('Users can update own attachment objects'),
    ('Users can delete own attachment objects')
),
missing_tables as (
  select e.table_name
  from expected_tables e
  left join information_schema.tables t
    on t.table_schema = 'public'
   and t.table_name = e.table_name
  where t.table_name is null
),
missing_grants as (
  select e.table_name, p.privilege_type
  from expected_tables e
  cross join required_privileges p
  left join information_schema.role_table_grants g
    on g.table_schema = 'public'
   and g.table_name = e.table_name
   and g.grantee = 'authenticated'
   and g.privilege_type = p.privilege_type
  where g.table_name is null
),
missing_rls as (
  select e.table_name
  from expected_tables e
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = e.table_name
      and c.relkind in ('r', 'p')
      and c.relrowsecurity is true
  )
),
missing_public_policies as (
  select e.table_name, e.policy_name
  from expected_public_policies e
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = e.table_name
   and p.policyname = e.policy_name
  where p.policyname is null
),
missing_storage_policies as (
  select e.policy_name
  from expected_storage_policies e
  left join pg_policies p
    on p.schemaname = 'storage'
   and p.tablename = 'objects'
   and p.policyname = e.policy_name
  where p.policyname is null
),
missing_storage_grants as (
  select p.privilege_type
  from required_privileges p
  left join information_schema.role_table_grants g
    on g.table_schema = 'storage'
   and g.table_name = 'objects'
   and g.grantee = 'authenticated'
   and g.privilege_type = p.privilege_type
  where g.table_name is null
),
bucket_ready as (
  select exists (
    select 1
    from storage.buckets
    where id = 'attachments'
      and name = 'attachments'
      and public is false
  ) as ok
)
select 'tables' as check_name,
       not exists (select 1 from missing_tables) as ok,
       coalesce((select string_agg(table_name, ', ' order by table_name) from missing_tables), 'ok') as detail
union all
select 'authenticated grants',
       not exists (select 1 from missing_grants),
       coalesce((select string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type) from missing_grants), 'ok')
union all
select 'rls',
       not exists (select 1 from missing_rls),
       coalesce((select string_agg(table_name, ', ' order by table_name) from missing_rls), 'ok')
union all
select 'public policies',
       not exists (select 1 from missing_public_policies),
       coalesce((select string_agg(table_name || ':' || policy_name, ', ' order by table_name, policy_name) from missing_public_policies), 'ok')
union all
select 'attachments bucket',
       (select ok from bucket_ready),
       case when (select ok from bucket_ready) then 'ok' else 'missing or public' end
union all
select 'storage grants',
       not exists (select 1 from missing_storage_grants),
       coalesce((select string_agg(privilege_type, ', ' order by privilege_type) from missing_storage_grants), 'ok')
union all
select 'storage policies',
       not exists (select 1 from missing_storage_policies),
       coalesce((select string_agg(policy_name, ', ' order by policy_name) from missing_storage_policies), 'ok');
`;

try {
  console.log(readinessCheckSql.trim());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
