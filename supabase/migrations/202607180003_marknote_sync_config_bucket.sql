-- Public runtime configuration is served as one Storage object so distributed
-- clients only need the endpoint URL. Upload sync-config.json separately from
-- the dashboard; it may contain a publishable key, never a secret/service key.
insert into storage.buckets (id, name, public)
values ('marknote-config', 'marknote-config', true)
on conflict (id) do update set public = true;
