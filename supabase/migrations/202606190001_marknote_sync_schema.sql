-- MarkNote sync schema for Supabase.
-- Apply with Supabase CLI or SQL editor, then run Security Advisor before production.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.folders (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create table if not exists public.notes (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id text not null,
  title text not null,
  content text not null,
  raw_content text,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  primary key (user_id, id)
);

create table if not exists public.attachments (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists devices_user_id_idx on public.devices(user_id);
create index if not exists folders_user_updated_idx on public.folders(user_id, updated_at);
create index if not exists notes_user_updated_idx on public.notes(user_id, updated_at);
create index if not exists notes_user_folder_idx on public.notes(user_id, folder_id);
create index if not exists attachments_user_updated_idx on public.attachments(user_id, updated_at);
create index if not exists attachments_user_note_idx on public.attachments(user_id, note_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.devices to authenticated;
grant select, insert, update, delete on table public.folders to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.email
    )
  )
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can read own devices"
  on public.devices for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own devices"
  on public.devices for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own devices"
  on public.devices for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own devices"
  on public.devices for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own folders"
  on public.folders for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own folders"
  on public.folders for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own folders"
  on public.folders for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own folders"
  on public.folders for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own notes"
  on public.notes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own notes"
  on public.notes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own notes"
  on public.notes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own notes"
  on public.notes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own attachments"
  on public.attachments for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own attachments"
  on public.attachments for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own attachments"
  on public.attachments for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own attachments"
  on public.attachments for delete
  to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

grant select, insert, update, delete on table storage.objects to authenticated;

create policy "Users can read own attachment objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can upload own attachment objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can update own attachment objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can delete own attachment objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
