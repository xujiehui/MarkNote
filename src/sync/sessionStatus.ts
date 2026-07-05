import type { SyncQueueItem } from '../types';

export interface SyncQueueStatus {
  pending: number;
  failed: number;
  firstError: string;
}

export interface QueueErrorResolutionInput {
  currentError: string;
  previousQueueError: string;
  nextQueueError: string;
  signedIn: boolean;
  syncing: boolean;
}

export interface QueueErrorResolution {
  error: string;
  queueError: string;
}

export function summarizeSyncQueue(items: SyncQueueItem[]): SyncQueueStatus {
  const failedItems = [...items]
    .filter((item) => Boolean(item.lastError))
    .sort((first, second) => first.updatedAt - second.updatedAt || first.createdAt - second.createdAt);
  return {
    pending: items.length,
    failed: failedItems.length,
    firstError: failedItems[0]?.lastError || '',
  };
}

export function resolveQueueErrorStatus({
  currentError,
  previousQueueError,
  nextQueueError,
  signedIn,
  syncing,
}: QueueErrorResolutionInput): QueueErrorResolution {
  if (!signedIn) {
    return {
      error: currentError === previousQueueError ? '' : currentError,
      queueError: '',
    };
  }

  if (syncing) {
    return {
      error: currentError === previousQueueError ? '' : currentError,
      queueError: previousQueueError,
    };
  }

  if (nextQueueError) {
    return {
      error: !currentError || currentError === previousQueueError ? nextQueueError : currentError,
      queueError: nextQueueError,
    };
  }

  return {
    error: currentError === previousQueueError ? '' : currentError,
    queueError: '',
  };
}
