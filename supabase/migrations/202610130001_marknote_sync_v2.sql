-- MarkNote sync v2: auth-scoped CAS, idempotent mutations, commit-ordered paging.
-- Apply after 202606190001_marknote_sync_schema.sql. Old clients become read-only.
-- The per-user counter row lock lasts to COMMIT: an uncommitted lower sequence
-- can never appear after a client has observed a higher committed sequence.

create table if not exists public.marknote_sync_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence between 0 and 9007199254740991),
  initialized boolean not null default false
);
create table if not exists public.marknote_sync_entities (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in ('folder', 'note', 'attachment')),
  entity_id text not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  sequence bigint not null,
  deleted boolean not null default false,
  document jsonb,
  primary key (user_id, entity, entity_id),
  check ((deleted and document is null) or (not deleted and jsonb_typeof(document) = 'object'))
);
create table if not exists public.marknote_sync_changes (
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence bigint not null,
  entity text not null,
  entity_id text not null,
  revision bigint not null,
  operation text not null check (operation in ('upsert', 'delete')),
  document jsonb,
  primary key (user_id, sequence)
);
create table if not exists public.marknote_sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null,
  entity text not null,
  entity_id text not null,
  payload_hash bytea not null,
  receipt jsonb not null,
  primary key (user_id, mutation_id)
);
create table if not exists public.marknote_sync_storage_gc (
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  primary key(user_id,storage_path)
);
alter table public.marknote_sync_storage_gc enable row level security;
revoke all on public.marknote_sync_storage_gc from public,anon,authenticated;

create index if not exists marknote_sync_changes_entity_idx
  on public.marknote_sync_changes (user_id, entity, entity_id);
create index if not exists marknote_sync_receipts_entity_idx
  on public.marknote_sync_receipts (user_id, entity, entity_id);

alter table public.marknote_sync_counters enable row level security;
alter table public.marknote_sync_entities enable row level security;
alter table public.marknote_sync_changes enable row level security;
alter table public.marknote_sync_receipts enable row level security;
-- V2 internal tables have no client policies or grants. Only scoped RPCs access them.
revoke all on public.marknote_sync_counters, public.marknote_sync_entities,
  public.marknote_sync_changes, public.marknote_sync_receipts from public, anon, authenticated;
-- Closing the old write API is essential: direct upsert would bypass CAS and the log.
revoke insert, update, delete on public.folders, public.notes, public.attachments from authenticated, anon, public;

create or replace function public.marknote_sync_lock_v2()
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_user uuid := auth.uid();
  v_initialized boolean;
  v_seq bigint;
  v_row record;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.marknote_sync_counters(user_id) values(v_user) on conflict do nothing;
  select initialized, last_sequence into v_initialized, v_seq
    from public.marknote_sync_counters where user_id = v_user for update;
  if v_initialized then return; end if;
  -- Bootstrap exactly once while the same per-user lock is held. Versions from
  -- the old client are untrusted; each existing row starts at server revision 1.
  for v_row in
    select * from (
    select 'folder'::text as entity, f.id as entity_id,
      jsonb_build_object('id',f.id,'name',f.name,'sortOrder',f.sort_order,
        'createdAt',floor(extract(epoch from f.created_at)*1000),
        'updatedAt',floor(extract(epoch from f.updated_at)*1000),
        'deletedAt',case when f.deleted_at is null then null else floor(extract(epoch from f.deleted_at)*1000) end) as document
      from public.folders f where f.user_id = v_user
    union all
    select 'note', n.id,
      jsonb_build_object('id',n.id,'folderId',n.folder_id,'title',n.title,'content',n.content,
        'rawContent',n.raw_content,'tags',to_jsonb(n.tags),'pinned',n.pinned,
        'createdAt',floor(extract(epoch from n.created_at)*1000),
        'updatedAt',floor(extract(epoch from n.updated_at)*1000),
        'deletedAt',case when n.deleted_at is null then null else floor(extract(epoch from n.deleted_at)*1000) end)
      from public.notes n where n.user_id = v_user
    union all
    select 'attachment', a.id,
      jsonb_build_object('id',a.id,'noteId',a.note_id,'storagePath',a.storage_path,
        'mimeType',a.mime_type,'sizeBytes',a.size_bytes,
        'createdAt',floor(extract(epoch from a.created_at)*1000),
        'updatedAt',floor(extract(epoch from a.updated_at)*1000),
        'deletedAt',case when a.deleted_at is null then null else floor(extract(epoch from a.deleted_at)*1000) end)
      from public.attachments a where a.user_id = v_user
    ) legacy
    order by case entity when 'folder' then 1 when 'note' then 2 else 3 end, entity_id
  loop
    v_seq := v_seq + 1;
    insert into public.marknote_sync_entities(user_id,entity,entity_id,revision,sequence,document)
      values(v_user,v_row.entity,v_row.entity_id,1,v_seq,v_row.document);
    insert into public.marknote_sync_changes(user_id,sequence,entity,entity_id,revision,operation,document)
      values(v_user,v_seq,v_row.entity,v_row.entity_id,1,'upsert',v_row.document);
  end loop;
  update public.marknote_sync_counters set initialized = true,last_sequence = v_seq where user_id = v_user;
end;
$$;
revoke all on function public.marknote_sync_lock_v2() from public, anon, authenticated;

create or replace function public.marknote_sync_push_v2(p_mutations jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_user uuid := auth.uid();
  v_mutation jsonb;
  v_id text;
  v_entity text;
  v_entity_id text;
  v_operation text;
  v_expected bigint;
  v_local bigint;
  v_hash bytea;
  v_saved public.marknote_sync_receipts%rowtype;
  v_current public.marknote_sync_entities%rowtype;
  v_doc jsonb;
  v_revision bigint;
  v_sequence bigint;
  v_receipt jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_now bigint;
  v_created bigint;
  v_keys text[];
  v_child record;
  v_prefix text;
begin
  perform public.marknote_sync_lock_v2();
  if jsonb_typeof(p_mutations) is distinct from 'array' or jsonb_array_length(p_mutations) > 100 then
    raise exception 'Expected a mutation array with at most 100 entries' using errcode = '22023';
  end if;
  for v_mutation in select value from jsonb_array_elements(p_mutations)
  loop
    v_id := v_mutation->>'mutationId';
    v_entity := v_mutation->>'entity';
    v_entity_id := v_mutation->>'entityId';
    v_operation := v_mutation->>'operation';
    if jsonb_typeof(v_mutation) is distinct from 'object' or v_id is null or length(v_id) not between 1 and 200
      or v_entity is null or v_entity not in ('folder','note','attachment')
      or v_entity_id is null or length(v_entity_id) not between 1 and 200
      or v_operation is null or v_operation not in ('upsert','delete')
      or jsonb_typeof(v_mutation->'expectedRevision') is distinct from 'number'
      or (v_mutation->>'expectedRevision') !~ '^[0-9]+$'
      or jsonb_typeof(v_mutation->'localRevision') is distinct from 'number'
      or (v_mutation->>'localRevision') !~ '^[0-9]+$' then
      raise exception 'Invalid mutation envelope' using errcode = '22023';
    end if;
    v_expected := (v_mutation->>'expectedRevision')::bigint;
    v_local := (v_mutation->>'localRevision')::bigint;
    if v_expected > 9007199254740991 or v_local > 9007199254740991 then
      raise exception 'Revision exceeds supported safe integer range' using errcode = '22023';
    end if;
    v_hash := sha256(convert_to(v_mutation::text, 'UTF8'));
    select * into v_saved from public.marknote_sync_receipts where user_id = v_user and mutation_id = v_id;
    if found then
      if v_saved.payload_hash <> v_hash then
        raise exception 'Mutation id reused with different payload' using errcode = '22023';
      end if;
      v_receipts := v_receipts || jsonb_build_array(v_saved.receipt || '{"replayed":true}'::jsonb);
      continue;
    end if;
    select * into v_current from public.marknote_sync_entities
      where user_id = v_user and entity = v_entity and entity_id = v_entity_id;
    v_revision := coalesce(v_current.revision, 0);
    v_sequence := coalesce(v_current.sequence, 0);
    if v_revision <> v_expected or (coalesce(v_current.deleted,false) and v_operation = 'upsert') then
      v_receipt := jsonb_build_object('mutationId',v_id,'entity',v_entity,'entityId',v_entity_id,
        'localRevision',v_local,'status','conflict','revision',v_revision,'sequence',v_sequence,
        'value',v_current.document,'replayed',false);
    else
      v_now := floor(extract(epoch from clock_timestamp())*1000);
      v_doc := null;
      if v_operation = 'upsert' then
        if jsonb_typeof(v_mutation->'value') is distinct from 'object'
          or v_mutation->'value'->>'id' is distinct from v_entity_id then
          raise exception 'Mutation entity id does not match its document' using errcode = '22023';
        end if;
        v_keys := case v_entity
          when 'folder' then array['id','name','sortOrder','createdAt','updatedAt','deletedAt']
          when 'note' then array['id','folderId','title','content','rawContent','tags','pinned','createdAt','updatedAt','deletedAt']
          else array['id','noteId','storagePath','mimeType','sizeBytes','createdAt','updatedAt','deletedAt'] end;
        select jsonb_object_agg(key,value) into v_doc from jsonb_each(v_mutation->'value') where key = any(v_keys);
        if (v_doc ? 'deletedAt' and v_doc->'deletedAt' <> 'null'::jsonb and
          (jsonb_typeof(v_doc->'deletedAt') is distinct from 'number' or (v_doc->>'deletedAt') !~ '^[0-9]+$'
            or (v_doc->>'deletedAt')::numeric > 9007199254740991)) then
          raise exception 'Invalid deletion time' using errcode = '22023';
        end if;
        if v_entity = 'folder' and (jsonb_typeof(v_doc->'name') is distinct from 'string'
            or jsonb_typeof(v_doc->'sortOrder') is distinct from 'number'
            or abs((v_doc->>'sortOrder')::numeric) > 9007199254740991) then
          raise exception 'Invalid folder document' using errcode = '22023';
        elsif v_entity = 'note' then
          if jsonb_typeof(v_doc->'title') is distinct from 'string'
            or jsonb_typeof(v_doc->'content') is distinct from 'string'
            or jsonb_typeof(v_doc->'folderId') is distinct from 'string'
            or jsonb_typeof(v_doc->'tags') is distinct from 'array'
            or jsonb_typeof(v_doc->'pinned') is distinct from 'boolean'
            or (v_doc ? 'rawContent' and v_doc->'rawContent' <> 'null'::jsonb and jsonb_typeof(v_doc->'rawContent') <> 'string')
            or exists(select 1 from jsonb_array_elements(v_doc->'tags') tag where jsonb_typeof(tag) <> 'string') then
            raise exception 'Invalid note document' using errcode = '22023';
          end if;
          if not exists(select 1 from public.marknote_sync_entities where user_id = v_user and entity = 'folder'
              and entity_id = v_doc->>'folderId' and not deleted) then
            raise exception 'Note parent folder is missing or permanently deleted' using errcode = '23503';
          end if;
        elsif v_entity = 'attachment' then
          v_prefix := v_user::text || '/' || (v_doc->>'noteId') || '/' || v_entity_id || '/';
          if jsonb_typeof(v_doc->'mimeType') is distinct from 'string'
            or jsonb_typeof(v_doc->'noteId') is distinct from 'string'
            or jsonb_typeof(v_doc->'storagePath') is distinct from 'string'
            or not starts_with(v_doc->>'storagePath', v_user::text || '/')
            or v_entity_id ~ '[[:cntrl:]/\\]' or v_doc->>'noteId' ~ '[[:cntrl:]/\\]'
            or v_doc->>'storagePath' ~ '(^|/)\.\.?(/|$)|//|[\\?#]'
            or (v_doc ? 'sizeBytes' and v_doc->'sizeBytes' <> 'null'::jsonb and
              (jsonb_typeof(v_doc->'sizeBytes') <> 'number' or (v_doc->>'sizeBytes') !~ '^[0-9]+$'
                or (v_doc->>'sizeBytes')::numeric > 9007199254740991)) then
            raise exception 'Invalid attachment document or storage owner' using errcode = '22023';
          end if;
          if v_doc->>'storagePath' is distinct from v_current.document->>'storagePath' and
            (not starts_with(v_doc->>'storagePath',v_prefix)
              or substring(v_doc->>'storagePath' from length(v_prefix)+1) !~ '^[a-f0-9]{64}$') then
            raise exception 'New attachment objects require an immutable identity-scoped hash path' using errcode = '22023';
          end if;
          if not exists(select 1 from public.marknote_sync_entities where user_id = v_user and entity = 'note'
              and entity_id = v_doc->>'noteId' and not deleted) then
            raise exception 'Attachment parent note is missing or permanently deleted' using errcode = '23503';
          end if;
        end if;
        -- Client modification clocks never decide sync order. Preserve creation
        -- time when present; server update clocks are informational only.
        v_created := case when v_current.document is not null then (v_current.document->>'createdAt')::bigint
          when coalesce(v_doc->>'createdAt','') ~ '^[0-9]+$' then least((v_doc->>'createdAt')::bigint,v_now)
          else v_now end;
        v_doc := v_doc || jsonb_build_object('createdAt',v_created,'updatedAt',v_now);
      else
        if v_entity = 'folder' and exists(select 1 from public.marknote_sync_entities
          where user_id = v_user and entity = 'note' and not deleted and document->>'folderId' = v_entity_id) then
          raise exception 'Move or permanently delete every remote note before deleting its folder' using errcode = '23503';
        end if;
        -- A device may not have downloaded all images attached to this note.
        -- Cascade on the server under the same user lock and transaction.
        if v_entity = 'note' then
          for v_child in select entity_id,revision from public.marknote_sync_entities
            where user_id = v_user and entity = 'attachment' and not deleted and document->>'noteId' = v_entity_id
            order by entity_id
          loop
            perform public.marknote_sync_push_v2(jsonb_build_array(jsonb_build_object(
              'mutationId','cascade-' || encode(sha256(convert_to(v_id || ':' || v_child.entity_id,'UTF8')),'hex'),
              'entity','attachment','entityId',v_child.entity_id,'operation','delete',
              'expectedRevision',v_child.revision,'localRevision',0,'value',null)));
          end loop;
        end if;
        if v_entity = 'attachment' then
          insert into public.marknote_sync_storage_gc(user_id,storage_path)
            select v_user,path from (
              select document->>'storagePath' as path from public.marknote_sync_changes
                where user_id = v_user and entity = v_entity and entity_id = v_entity_id
              union select v_current.document->>'storagePath'
            ) blobs where path is not null and path like v_user::text || '/%'
            on conflict do nothing;
        end if;
        -- Permanent deletion keeps the identity/revision tombstone, but purges
        -- bodies from earlier pages and receipts. Metadata ordering stays intact.
        update public.marknote_sync_changes set document = null, operation = 'delete'
          where user_id = v_user and entity = v_entity and entity_id = v_entity_id;
        update public.marknote_sync_receipts set receipt = jsonb_set(receipt,'{value}','null'::jsonb)
          where user_id = v_user and entity = v_entity and entity_id = v_entity_id;
        -- Legacy bootstrap source must not retain the removed content either.
        if v_entity = 'note' then
          update public.notes set title = '',content = '',raw_content = null,tags = '{}',deleted_at = clock_timestamp()
            where user_id = v_user and id = v_entity_id;
        elsif v_entity = 'folder' then
          update public.folders set name = '',deleted_at = clock_timestamp() where user_id = v_user and id = v_entity_id;
        else
          update public.attachments set storage_path = '',size_bytes = null,deleted_at = clock_timestamp() where user_id = v_user and id = v_entity_id;
        end if;
      end if;
      v_revision := v_revision + 1;
      update public.marknote_sync_counters set last_sequence = last_sequence + 1 where user_id = v_user
        returning last_sequence into v_sequence;
      insert into public.marknote_sync_entities(user_id,entity,entity_id,revision,sequence,deleted,document)
        values(v_user,v_entity,v_entity_id,v_revision,v_sequence,v_operation = 'delete',v_doc)
        on conflict(user_id,entity,entity_id) do update set revision = excluded.revision,
          sequence = excluded.sequence,deleted = excluded.deleted,document = excluded.document;
      insert into public.marknote_sync_changes(user_id,sequence,entity,entity_id,revision,operation,document)
        values(v_user,v_sequence,v_entity,v_entity_id,v_revision,v_operation,v_doc);
      v_receipt := jsonb_build_object('mutationId',v_id,'entity',v_entity,'entityId',v_entity_id,
        'localRevision',v_local,'status','applied','revision',v_revision,'sequence',v_sequence,
        'value',v_doc,'replayed',false);
    end if;
    insert into public.marknote_sync_receipts(user_id,mutation_id,entity,entity_id,payload_hash,receipt)
      values(v_user,v_id,v_entity,v_entity_id,v_hash,v_receipt);
    v_receipts := v_receipts || jsonb_build_array(v_receipt);
  end loop;
  return v_receipts;
end;
$$;

create or replace function public.marknote_sync_pull_v2(p_after_seq bigint, p_upper_bound bigint default null, p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_user uuid := auth.uid();
  v_upper bigint;
  v_next bigint;
  v_changes jsonb;
  v_more boolean;
begin
  perform public.marknote_sync_lock_v2();
  select last_sequence into v_upper from public.marknote_sync_counters where user_id = v_user;
  if p_after_seq is null or p_after_seq < 0 or p_after_seq > v_upper
    or p_limit is null or p_limit not between 1 and 500
    or (p_upper_bound is not null and (p_upper_bound < p_after_seq or p_upper_bound > v_upper)) then
    raise exception 'Invalid sync cursor, snapshot bound, or page size' using errcode = '22023';
  end if;
  v_upper := coalesce(p_upper_bound,v_upper);
  select coalesce(jsonb_agg(jsonb_build_object('entity',entity,'entityId',entity_id,'revision',revision,
      'sequence',sequence,'operation',operation,'value',document) order by sequence),'[]'::jsonb),max(sequence)
    into v_changes,v_next from (
      select * from public.marknote_sync_changes where user_id = v_user
        and sequence > p_after_seq and sequence <= v_upper order by sequence limit p_limit
    ) page;
  v_next := coalesce(v_next,p_after_seq);
  v_more := exists(select 1 from public.marknote_sync_changes where user_id = v_user and sequence > v_next and sequence <= v_upper);
  return jsonb_build_object('changes',v_changes,'nextSequence',case when v_more then v_next else v_upper end,
    'upperBound',v_upper,'hasMore',v_more,'serverTime',floor(extract(epoch from clock_timestamp())*1000));
end;
$$;

-- Storage object deletion is retriable and happens only after the entity CAS
-- tombstone commits. GC jobs survive a crash between tombstone and file removal.
create or replace function public.marknote_sync_collect_storage_v2(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  perform public.marknote_sync_lock_v2();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid storage GC page size' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(storage_path),'[]'::jsonb) into v_result from (
    select g.storage_path from public.marknote_sync_storage_gc g where g.user_id = v_user
      and not exists(select 1 from public.marknote_sync_entities e where e.user_id = v_user
        and e.entity = 'attachment' and not e.deleted and e.document->>'storagePath' = g.storage_path)
    order by g.storage_path limit p_limit
  ) jobs;
  return v_result;
end;
$$;

create or replace function public.marknote_sync_ack_storage_v2(p_paths text[])
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_user uuid := auth.uid();
begin
  perform public.marknote_sync_lock_v2();
  if p_paths is null or cardinality(p_paths) > 100 then raise exception 'Invalid storage GC acknowledgement' using errcode = '22023'; end if;
  delete from public.marknote_sync_storage_gc where user_id = v_user and storage_path = any(p_paths);
end;
$$;

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
  -- PostgreSQL subtransaction exception rolls back all diagnostic writes. It
  -- proves the actual RPC path rather than relying on a table-exists probe.
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
    raise exception using errcode = 'MN002',message = 'diagnostic passed';
  exception when sqlstate 'MN002' then null;
  end;
  return jsonb_build_object('protocolVersion',2,'capabilities',jsonb_build_array('cas','idempotency','sequence','tombstones','snapshot-paging'));
end;
$$;

revoke all on function public.marknote_sync_push_v2(jsonb),
  public.marknote_sync_pull_v2(bigint,bigint,integer),public.marknote_sync_check_v2(),
  public.marknote_sync_collect_storage_v2(integer),public.marknote_sync_ack_storage_v2(text[]) from public, anon;
grant execute on function public.marknote_sync_push_v2(jsonb),
  public.marknote_sync_pull_v2(bigint,bigint,integer),public.marknote_sync_check_v2(),
  public.marknote_sync_collect_storage_v2(integer),public.marknote_sync_ack_storage_v2(text[]) to authenticated;
-- Reload the PostgREST schema cache after applying the migration.
notify pgrst, 'reload schema';
