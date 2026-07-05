import assert from 'node:assert/strict';
import { resolveQueueErrorStatus, summarizeSyncQueue } from '../src/sync/sessionStatus';
import type { SyncQueueItem } from '../src/types';

function queueItem(id: string, lastError?: string, updatedAt = 1, createdAt = 1): SyncQueueItem {
  return {
    id,
    entity: 'note',
    entityId: `note-${id}`,
    operation: 'upsert',
    createdAt,
    updatedAt,
    attempts: lastError ? 1 : 0,
    lastError,
  };
}

function main() {
  assert.deepEqual(summarizeSyncQueue([]), {
    pending: 0,
    failed: 0,
    firstError: '',
  });

  assert.deepEqual(summarizeSyncQueue([queueItem('1'), queueItem('2')]), {
    pending: 2,
    failed: 0,
    firstError: '',
  });

  assert.deepEqual(
    summarizeSyncQueue([
      queueItem('1'),
      queueItem('2', 'storage offline'),
      queueItem('3', 'permission denied'),
    ]),
    {
      pending: 3,
      failed: 2,
      firstError: 'storage offline',
    },
  );

  assert.deepEqual(
    summarizeSyncQueue([
      queueItem('newer', 'newer failure', 30, 1),
      queueItem('older', 'older failure', 10, 1),
      queueItem('same-time-older-created', 'older created failure', 30, 0),
    ]),
    {
      pending: 3,
      failed: 3,
      firstError: 'older failure',
    },
  );

  assert.deepEqual(
    summarizeSyncQueue([
      queueItem('same-time-newer-created', 'newer created failure', 30, 2),
      queueItem('same-time-older-created', 'older created failure', 30, 1),
    ]),
    {
      pending: 2,
      failed: 2,
      firstError: 'older created failure',
    },
  );

  assert.deepEqual(
    resolveQueueErrorStatus({
      currentError: '',
      previousQueueError: '',
      nextQueueError: 'storage offline',
      signedIn: true,
      syncing: false,
    }),
    {
      error: 'storage offline',
      queueError: 'storage offline',
    },
  );

  assert.deepEqual(
    resolveQueueErrorStatus({
      currentError: 'Storage bucket is missing.',
      previousQueueError: 'storage offline',
      nextQueueError: 'permission denied',
      signedIn: true,
      syncing: false,
    }),
    {
      error: 'Storage bucket is missing.',
      queueError: 'permission denied',
    },
  );

  assert.deepEqual(
    resolveQueueErrorStatus({
      currentError: 'storage offline',
      previousQueueError: 'storage offline',
      nextQueueError: 'storage offline',
      signedIn: true,
      syncing: true,
    }),
    {
      error: '',
      queueError: 'storage offline',
    },
  );

  assert.deepEqual(
    resolveQueueErrorStatus({
      currentError: 'storage offline',
      previousQueueError: 'storage offline',
      nextQueueError: '',
      signedIn: true,
      syncing: false,
    }),
    {
      error: '',
      queueError: '',
    },
  );

  assert.deepEqual(
    resolveQueueErrorStatus({
      currentError: '',
      previousQueueError: '',
      nextQueueError: 'storage offline',
      signedIn: false,
      syncing: false,
    }),
    {
      error: '',
      queueError: '',
    },
  );

  assert.deepEqual(
    resolveQueueErrorStatus({
      currentError: 'storage offline',
      previousQueueError: 'storage offline',
      nextQueueError: 'storage offline',
      signedIn: false,
      syncing: false,
    }),
    {
      error: '',
      queueError: '',
    },
  );

  console.log('sync session status tests passed');
}

main();
