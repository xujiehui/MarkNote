import type { SyncBackendCheckResult } from './types';

const BACKEND_CHECK_STORAGE_PREFIX = 'marknote-sync-backend-check';

export function backendCheckStorageKey(providerId: string): string {
  return `${BACKEND_CHECK_STORAGE_PREFIX}:${providerId}`;
}

export function backendCheckStorageKeyForUser(providerId: string, userId: string): string {
  return `${BACKEND_CHECK_STORAGE_PREFIX}:${providerId}:${userId}`;
}

export function readStoredBackendCheck(key: string): SyncBackendCheckResult | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return parseStoredBackendCheck(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredBackendCheck(key: string, result: SyncBackendCheckResult): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(result));
  } catch {
    // Diagnostics are helpful but non-critical; sync should keep working if storage quota is exhausted.
  }
}

export function clearStoredBackendCheck(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore localStorage failures during sign-out cleanup.
  }
}

function parseStoredBackendCheck(value: unknown): SyncBackendCheckResult | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<SyncBackendCheckResult>;
  if (typeof candidate.ok !== 'boolean' || typeof candidate.checkedAt !== 'number' || !Array.isArray(candidate.items)) {
    return null;
  }
  const items = candidate.items.filter((item): item is SyncBackendCheckResult['items'][number] => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }
    const checkItem = item as SyncBackendCheckResult['items'][number];
    return (
      typeof checkItem.name === 'string' &&
      (checkItem.status === 'ok' || checkItem.status === 'warning' || checkItem.status === 'error') &&
      typeof checkItem.message === 'string' &&
      (checkItem.code === undefined || typeof checkItem.code === 'string')
    );
  });
  return {
    ok: candidate.ok,
    checkedAt: candidate.checkedAt,
    items,
  };
}
