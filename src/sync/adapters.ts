import { DisabledSyncAdapter } from './disabledAdapter';
import { readSyncEnv } from './env';
import { SupabaseSyncAdapter } from './supabaseAdapter';
import type { RemoteSyncAdapter } from './types';

let cachedAdapter: RemoteSyncAdapter | null = null;

export function getRemoteSyncAdapter(): RemoteSyncAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const provider = readSyncEnv('VITE_SYNC_PROVIDER') || 'supabase';
  if (provider === 'supabase') {
    const adapter = new SupabaseSyncAdapter(
      readSyncEnv('VITE_SUPABASE_URL'),
      readSyncEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
    );
    cachedAdapter = adapter.configured ? adapter : new DisabledSyncAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledSyncAdapter();
  return cachedAdapter;
}
