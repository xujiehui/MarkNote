import assert from 'node:assert/strict';
import {
  AUTO_SYNC_DELAY_MS,
  AUTO_SYNC_POLL_MS,
  MAX_AUTO_SYNC_RETRIES,
  autoSyncRetryDelay,
  isRetryableSyncError,
  shouldAutoSync,
  shouldRunInitialBackendVerification,
  shouldRetryAfterSuccessfulDiagnosis,
  type AutoSyncState,
} from '../src/sync/autoSync';

const readyState: AutoSyncState = {
  configured: true,
  signedIn: true,
  syncing: false,
  checkingBackend: false,
  pending: 1,
  failed: 0,
  backendVerificationStatus: 'verified',
};

function main() {
  assert.equal(AUTO_SYNC_DELAY_MS, 1200);
  assert.equal(shouldAutoSync(readyState), true);

  assert.equal(shouldAutoSync({ ...readyState, configured: false }), false);
  assert.equal(shouldAutoSync({ ...readyState, signedIn: false }), false);
  assert.equal(shouldAutoSync({ ...readyState, syncing: true }), false);
  assert.equal(shouldAutoSync({ ...readyState, checkingBackend: true }), false);
  assert.equal(shouldAutoSync({ ...readyState, pending: 0 }), false);
  assert.equal(shouldAutoSync({ ...readyState, failed: 1 }), false);
  assert.equal(shouldAutoSync({ ...readyState, backendVerificationStatus: null }), false);
  assert.equal(shouldAutoSync({ ...readyState, backendVerificationStatus: 'pending' }), false);
  assert.equal(shouldAutoSync({ ...readyState, backendVerificationStatus: 'failed' }), false);

  assert.equal(
    shouldRunInitialBackendVerification({
      configured: true,
      signedIn: true,
      syncing: false,
      checkingBackend: false,
      backendVerificationStatus: null,
    }),
    true,
  );
  assert.equal(
    shouldRunInitialBackendVerification({
      configured: true,
      signedIn: true,
      syncing: false,
      checkingBackend: false,
      backendVerificationStatus: 'failed',
    }),
    false,
  );
  assert.equal(
    shouldRunInitialBackendVerification({
      configured: true,
      signedIn: true,
      syncing: false,
      checkingBackend: false,
      backendVerificationStatus: 'pending',
    }),
    false,
  );
  assert.equal(
    shouldRunInitialBackendVerification({
      configured: true,
      signedIn: true,
      syncing: false,
      checkingBackend: false,
      backendVerificationStatus: 'verified',
    }),
    false,
  );
  assert.equal(
    shouldRunInitialBackendVerification({
      configured: true,
      signedIn: true,
      syncing: true,
      checkingBackend: false,
      backendVerificationStatus: null,
    }),
    false,
  );

  assert.equal(shouldRetryAfterSuccessfulDiagnosis({ ...readyState, backendOk: true }), true);
  assert.equal(shouldRetryAfterSuccessfulDiagnosis({ ...readyState, backendOk: false }), false);
  assert.equal(shouldRetryAfterSuccessfulDiagnosis({ ...readyState, backendOk: true, pending: 0 }), false);
  assert.equal(shouldRetryAfterSuccessfulDiagnosis({ ...readyState, backendOk: true, failed: 1 }), true);
  assert.equal(shouldRetryAfterSuccessfulDiagnosis({ ...readyState, backendOk: true, checkingBackend: true }), false);

  assert.equal(AUTO_SYNC_POLL_MS, 30_000);
  assert.equal(MAX_AUTO_SYNC_RETRIES, 5);
  assert.equal(shouldAutoSync({ ...readyState, failed: 1, retryAttempt: 1 }), true);
  assert.equal(shouldAutoSync({ ...readyState, failed: 1, retryAttempt: 6 }), false);
  assert.equal(shouldAutoSync({ ...readyState, online: false }), false);
  assert.equal(shouldAutoSync({ ...readyState, failed: 0, retryAttempt: 6 }), false);
  assert.equal(shouldAutoSync({ ...readyState, pending: 0, failed: 0, retryAttempt: 1 }), true, 'idle failed pull can retry without local outbox');
  assert.equal(shouldAutoSync({ ...readyState, pending: 0, failed: 0, retryAttempt: 0 }), false);
  assert.equal(isRetryableSyncError('network down'), true);
  assert.equal(isRetryableSyncError('JWT expired; sign in again'), false);
  assert.equal(isRetryableSyncError('Versioned sync protocol is required'), false);
  assert.equal(isRetryableSyncError('permission denied for table notes'), false);
  assert.equal(autoSyncRetryDelay(1, 0.5), 1200);
  assert.equal(autoSyncRetryDelay(3, 0.5), 4800);
  assert.equal(autoSyncRetryDelay(10, 0.5), 60_000);
  console.log('sync auto-sync tests passed');
}

main();
