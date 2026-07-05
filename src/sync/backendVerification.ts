import type { SyncBackendCheckItem } from './types';

export const SYNC_TABLE_WRITES_CHECK_NAME = 'Sync table writes';
export const ATTACHMENT_STORAGE_CANARY_CHECK_NAME = 'Attachment storage canary';

const REQUIRED_BACKEND_VERIFICATION_CHECKS = [
  SYNC_TABLE_WRITES_CHECK_NAME,
  ATTACHMENT_STORAGE_CANARY_CHECK_NAME,
] as const;

export type BackendVerificationStatus = 'pending' | 'verified' | 'failed';

export interface BackendVerificationResult {
  status: BackendVerificationStatus;
  failedItem: SyncBackendCheckItem | null;
  missingChecks: string[];
}

export function resolveBackendVerification(items: SyncBackendCheckItem[]): BackendVerificationResult {
  const failedItem = items.find((item) => item.status === 'error') || null;
  if (failedItem) {
    return {
      status: 'failed',
      failedItem,
      missingChecks: missingRequiredChecks(items),
    };
  }

  const missingChecks = missingRequiredChecks(items);
  return {
    status: missingChecks.length ? 'pending' : 'verified',
    failedItem: null,
    missingChecks,
  };
}

function missingRequiredChecks(items: SyncBackendCheckItem[]): string[] {
  return REQUIRED_BACKEND_VERIFICATION_CHECKS.filter(
    (requiredName) => !items.some((item) => item.name === requiredName && item.status === 'ok'),
  );
}
