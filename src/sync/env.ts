export interface SupabaseRuntimeConfig {
  url: string;
  publishableKey: string;
  authRedirectUrl?: string;
}

export type SyncRuntimeConfig =
  | {
      provider: 'disabled';
    }
  | {
      provider: 'supabase';
      supabase: SupabaseRuntimeConfig;
    };

type RuntimeConfigPayload = Record<string, unknown>;

let cachedConfigPromise: Promise<SyncRuntimeConfig> | null = null;

export function readSyncEnv(name: string): string | undefined {
  const env = globalThis.__MARKNOTE_ENV__ as Record<string, string | undefined> | undefined;
  return env?.[name];
}

export function hasSyncConfigSource(): boolean {
  return Boolean(readSyncEnv('VITE_SYNC_CONFIG_URL')?.trim());
}

export async function loadSyncConfig(): Promise<SyncRuntimeConfig> {
  if (!cachedConfigPromise) {
    cachedConfigPromise = loadSyncConfigUncached().catch((error) => {
      cachedConfigPromise = null;
      throw error;
    });
  }
  return cachedConfigPromise;
}

export function resetSyncConfigCacheForTests(): void {
  cachedConfigPromise = null;
}

async function loadSyncConfigUncached(): Promise<SyncRuntimeConfig> {
  const endpoint = readSyncEnv('VITE_SYNC_CONFIG_URL')?.trim();
  if (!endpoint) {
    return { provider: 'disabled' };
  }

  if (typeof fetch !== 'function') {
    throw new Error('Sync configuration backend API cannot be loaded because fetch is unavailable.');
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (error) {
    throw new Error(`Could not load sync configuration from backend API: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Could not load sync configuration from backend API: HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Sync configuration backend API returned invalid JSON: ${errorMessage(error)}`);
  }

  return normalizeSyncConfig(payload);
}

function normalizeSyncConfig(payload: unknown): SyncRuntimeConfig {
  if (!isRecord(payload)) {
    throw new Error('Sync configuration backend API returned an invalid payload.');
  }

  const provider = stringValue(payload.provider || payload.syncProvider) || 'supabase';
  if (provider === 'disabled') {
    return { provider: 'disabled' };
  }
  if (provider !== 'supabase') {
    throw new Error(`Sync configuration backend API returned unsupported provider: ${provider}.`);
  }

  const supabase = isRecord(payload.supabase) ? payload.supabase : payload;
  const url = stringValue(supabase.url || payload.supabaseUrl);
  const publishableKey = stringValue(
    supabase.publishableKey || supabase.anonKey || payload.supabasePublishableKey,
  );
  const authRedirectUrl = stringValue(supabase.authRedirectUrl || payload.supabaseAuthRedirectUrl);

  if (!url || !publishableKey) {
    throw new Error('Sync configuration backend API must return Supabase url and publishableKey.');
  }

  return {
    provider: 'supabase',
    supabase: {
      url,
      publishableKey,
      ...(authRedirectUrl ? { authRedirectUrl } : {}),
    },
  };
}

function isRecord(value: unknown): value is RuntimeConfigPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
