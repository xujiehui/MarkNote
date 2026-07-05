import type { SyncBackendCheckResult } from './types';

export function backendCheckFailureResult(providerName: string, error: unknown, checkedAt = Date.now()): SyncBackendCheckResult {
  return {
    ok: false,
    checkedAt,
    items: [
      {
        name: providerName,
        status: 'error',
        message: error instanceof Error ? error.message : 'Backend diagnostics failed.',
      },
    ],
  };
}
