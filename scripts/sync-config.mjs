import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readLocalEnv() {
  return {
    ...readEnvFile('.env'),
    ...readEnvFile('.env.local'),
    ...process.env,
  };
}

export async function loadSupabaseRuntimeConfig(env = {}) {
  const endpoint = (env.MARKNOTE_SYNC_CONFIG_URL || env.VITE_SYNC_CONFIG_URL || '').trim();
  if (!endpoint) {
    return { provider: 'disabled' };
  }

  const payload = await fetchSyncConfig(endpoint);
  return normalizeSyncConfig(payload);
}

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(resolve(path), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const [key, ...valueParts] = line.split('=');
          return [key, valueParts.join('=').replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

async function fetchSyncConfig(endpoint) {
  let response;
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

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Sync configuration backend API returned invalid JSON: ${errorMessage(error)}`);
  }
}

function normalizeSyncConfig(payload) {
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
    supabase.publishableKey ||
      supabase.anonKey ||
      payload.supabasePublishableKey,
  );
  const authRedirectUrl = stringValue(
    supabase.authRedirectUrl || payload.supabaseAuthRedirectUrl,
  );

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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
