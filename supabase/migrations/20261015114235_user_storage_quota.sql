-- Per-user attachment quota for MarkNote sync.
-- The public client key is expected to be visible. Enforcement lives here so
-- direct Storage API calls cannot bypass the limits.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists private.marknote_storage_quota_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists private.marknote_storage_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 20971520),
  mime_type text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, storage_path)
);

create index if not exists marknote_storage_reservations_expiry_idx
  on private.marknote_storage_reservations(expires_at);

alter table private.marknote_storage_quota_locks enable row level security;
alter table private.marknote_storage_reservations enable row level security;
revoke all on table private.marknote_storage_quota_locks,
  private.marknote_storage_reservations from public, anon, authenticated;

create or replace function private.marknote_storage_path_valid(p_path text, p_user uuid)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_path is not null
    and pg_catalog.length(p_path) between 1 and 1024
    and pg_catalog.cardinality(pg_catalog.string_to_array(p_path, '/')) = 4
    and (pg_catalog.string_to_array(p_path, '/'))[1] = p_user::text
    and pg_catalog.length((pg_catalog.string_to_array(p_path, '/'))[2]) between 1 and 255
    and pg_catalog.length((pg_catalog.string_to_array(p_path, '/'))[3]) between 1 and 255
    and (pg_catalog.string_to_array(p_path, '/'))[2] not in ('.', '..')
    and (pg_catalog.string_to_array(p_path, '/'))[3] not in ('.', '..')
    and pg_catalog.strpos((pg_catalog.string_to_array(p_path, '/'))[2], E'\\') = 0
    and pg_catalog.strpos((pg_catalog.string_to_array(p_path, '/'))[3], E'\\') = 0
    and (pg_catalog.string_to_array(p_path, '/'))[2] !~ '[[:cntrl:]]'
    and (pg_catalog.string_to_array(p_path, '/'))[3] !~ '[[:cntrl:]]'
    and (pg_catalog.string_to_array(p_path, '/'))[4] ~ '^[a-f0-9]{64}$';
$$;

create or replace function private.marknote_storage_mime_allowed(p_mime_type text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select pg_catalog.lower(p_mime_type) = any(array[
    'image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif',
    'video/mp4','video/webm','video/ogg',
    'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm',
    'audio/aac','audio/mp4','audio/flac',
    'application/pdf','application/octet-stream','application/zip','application/x-zip-compressed',
    'text/plain','text/csv','text/markdown','application/json','application/msword',
    'application/vnd.ms-excel','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]);
$$;

create or replace function public.marknote_sync_storage_usage_v2()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_used_bytes bigint := 0;
  v_object_count bigint := 0;
  v_reserved_bytes bigint := 0;
  v_reserved_objects bigint := 0;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select
    coalesce(sum(case when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
      then (o.metadata->>'size')::bigint else 0 end), 0),
    count(*)
  into v_used_bytes, v_object_count
  from storage.objects o
  where o.bucket_id = 'attachments'
    and (storage.foldername(o.name))[1] = v_user::text;

  select coalesce(sum(r.size_bytes), 0), count(*)
  into v_reserved_bytes, v_reserved_objects
  from private.marknote_storage_reservations r
  where r.user_id = v_user
    and r.expires_at > pg_catalog.clock_timestamp()
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'attachments' and o.name = r.storage_path
    );

  return jsonb_build_object(
    'usedBytes', v_used_bytes,
    'quotaBytes', 104857600,
    'objectCount', v_object_count,
    'objectLimit', 1000,
    'maxFileBytes', 20971520,
    'reservedBytes', v_reserved_bytes,
    'reservedObjects', v_reserved_objects
  );
end;
$$;

create or replace function public.marknote_sync_reserve_storage_v2(
  p_path text,
  p_size_bytes bigint,
  p_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_used_bytes bigint := 0;
  v_object_count bigint := 0;
  v_reserved_bytes bigint := 0;
  v_reserved_objects bigint := 0;
  v_object_exists boolean := false;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.marknote_storage_path_valid(p_path, v_user) then
    raise exception 'Invalid attachment storage path' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes not between 0 and 20971520 then
    raise exception 'Attachment exceeds the 20 MiB size limit' using errcode = '22023';
  end if;
  if not private.marknote_storage_mime_allowed(p_mime_type) then
    raise exception 'Attachment MIME type is not allowed' using errcode = '22023';
  end if;

  insert into private.marknote_storage_quota_locks(user_id)
  values (v_user)
  on conflict (user_id) do nothing;
  perform 1 from private.marknote_storage_quota_locks where user_id = v_user for update;

  delete from private.marknote_storage_reservations
  where user_id = v_user and expires_at <= pg_catalog.clock_timestamp();

  select
    coalesce(sum(case when coalesce(o.metadata->>'size', '') ~ '^[0-9]+$'
      then (o.metadata->>'size')::bigint else 0 end), 0),
    count(*),
    coalesce(bool_or(o.name = p_path), false)
  into v_used_bytes, v_object_count, v_object_exists
  from storage.objects o
  where o.bucket_id = 'attachments'
    and (storage.foldername(o.name))[1] = v_user::text;

  select coalesce(sum(r.size_bytes), 0), count(*)
  into v_reserved_bytes, v_reserved_objects
  from private.marknote_storage_reservations r
  where r.user_id = v_user
    and r.storage_path <> p_path
    and r.expires_at > pg_catalog.clock_timestamp()
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'attachments' and o.name = r.storage_path
    );

  if not v_object_exists and v_used_bytes + v_reserved_bytes + p_size_bytes > 104857600 then
    raise exception 'Cloud attachment storage quota exceeded' using errcode = 'MN003';
  end if;
  if not v_object_exists and v_object_count + v_reserved_objects + 1 > 1000 then
    raise exception 'Cloud attachment object limit exceeded' using errcode = 'MN003';
  end if;

  insert into private.marknote_storage_reservations(
    user_id, storage_path, size_bytes, mime_type, expires_at
  ) values (
    v_user, p_path, p_size_bytes, pg_catalog.lower(p_mime_type),
    pg_catalog.clock_timestamp() + interval '15 minutes'
  )
  on conflict (user_id, storage_path) do update set
    size_bytes = excluded.size_bytes,
    mime_type = excluded.mime_type,
    expires_at = excluded.expires_at,
    created_at = pg_catalog.clock_timestamp();

  return public.marknote_sync_storage_usage_v2();
end;
$$;

create or replace function public.marknote_sync_release_storage_v2(p_path text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from private.marknote_storage_reservations
  where user_id = v_user and storage_path = p_path;
end;
$$;

-- Storage calls the INSERT policy once for the permission probe and again
-- with final object metadata. Both must match an unexpired reservation.
create or replace function private.marknote_storage_upload_allowed(p_name text, p_metadata jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_size_text text := coalesce(p_metadata->>'size', p_metadata->>'contentLength', '');
  v_mime_type text := pg_catalog.lower(coalesce(p_metadata->>'mimetype', ''));
begin
  if v_user is null or v_size_text !~ '^[0-9]+$' then
    return false;
  end if;
  return exists (
    select 1 from private.marknote_storage_reservations r
    where r.user_id = v_user
      and r.storage_path = p_name
      and r.expires_at > pg_catalog.clock_timestamp()
      and r.size_bytes = v_size_text::bigint
      and r.mime_type = v_mime_type
  );
end;
$$;

revoke all on function private.marknote_storage_path_valid(text,uuid),
  private.marknote_storage_mime_allowed(text),
  private.marknote_storage_upload_allowed(text,jsonb) from public, anon, authenticated;
grant execute on function private.marknote_storage_upload_allowed(text,jsonb) to authenticated;

revoke all on function public.marknote_sync_storage_usage_v2(),
  public.marknote_sync_reserve_storage_v2(text,bigint,text),
  public.marknote_sync_release_storage_v2(text) from public, anon;
grant execute on function public.marknote_sync_storage_usage_v2(),
  public.marknote_sync_reserve_storage_v2(text,bigint,text),
  public.marknote_sync_release_storage_v2(text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  20971520,
  array[
    'image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif',
    'video/mp4','video/webm','video/ogg',
    'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm',
    'audio/aac','audio/mp4','audio/flac',
    'application/pdf','application/octet-stream','application/zip','application/x-zip-compressed',
    'text/plain','text/csv','text/markdown','application/json','application/msword',
    'application/vnd.ms-excel','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select, insert, delete on table storage.objects to authenticated;

drop policy if exists "Users can upload own attachment objects" on storage.objects;
create policy "Users can upload own attachment objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.marknote_storage_upload_allowed(name, metadata)
  );

drop policy if exists "Users can update own attachment objects" on storage.objects;
drop policy if exists "MarkNote attachments are immutable" on storage.objects;
create policy "MarkNote attachments are immutable"
  on storage.objects as restrictive for update
  to anon, authenticated
  using (bucket_id <> 'attachments')
  with check (bucket_id <> 'attachments');

-- Expose the new quota capability through the existing protocol canary.
create or replace function public.marknote_sync_check_v2()
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_id text := 'marknote-protocol-check-' || gen_random_uuid()::text;
  v_mutation jsonb;
  v_receipts jsonb;
begin
  perform public.marknote_sync_lock_v2();
  if has_table_privilege('authenticated','public.folders','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.notes','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.attachments','INSERT,UPDATE,DELETE') then
    raise exception 'Legacy sync writes must be revoked before enabling protocol v2' using errcode = '42501';
  end if;
  begin
    v_mutation := jsonb_build_object('mutationId',v_id,'entity','folder','entityId',v_id,'operation','upsert',
      'expectedRevision',0,'localRevision',1,'value',jsonb_build_object('id',v_id,'name','diagnostic','sortOrder',0));
    v_receipts := public.marknote_sync_push_v2(jsonb_build_array(v_mutation));
    if v_receipts->0->>'status' <> 'applied' then raise exception 'CAS insert diagnostic failed'; end if;
    v_receipts := public.marknote_sync_push_v2(jsonb_build_array(v_mutation));
    if (v_receipts->0->>'replayed')::boolean is not true then raise exception 'Idempotency diagnostic failed'; end if;
    v_mutation := v_mutation || jsonb_build_object('mutationId',v_id || '-stale');
    v_receipts := public.marknote_sync_push_v2(jsonb_build_array(v_mutation));
    if v_receipts->0->>'status' <> 'conflict' then raise exception 'CAS conflict diagnostic failed'; end if;
    v_mutation := v_mutation || jsonb_build_object('mutationId',v_id || '-delete','operation','delete','expectedRevision',1,'value',null);
    v_receipts := public.marknote_sync_push_v2(jsonb_build_array(v_mutation));
    if v_receipts->0->>'status' <> 'applied' or v_receipts->0->'value' <> 'null'::jsonb then
      raise exception 'Tombstone diagnostic failed';
    end if;
    raise exception using errcode = 'MN002', message = 'diagnostic passed';
  exception when sqlstate 'MN002' then null;
  end;
  return jsonb_build_object(
    'protocolVersion', 2,
    'capabilities', jsonb_build_array('cas','idempotency','sequence','tombstones','snapshot-paging','storage-quota')
  );
end;
$$;

revoke all on function public.marknote_sync_check_v2() from public, anon;
grant execute on function public.marknote_sync_check_v2() to authenticated;

notify pgrst, 'reload schema';
