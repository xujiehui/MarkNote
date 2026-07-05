import assert from 'node:assert/strict';
import {
  AUTO_SYNC_DELAY_MS,
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
    true,
  );
  assert.equal(
    shouldRunInitialBackendVerification({
      configured: true,
      signedIn: true,
      syncing: false,
      checkingBackend: false,
      backendVerificationStatus: 'pending',
    }),
    true,
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

  console.log('sync auto-sync tests passed');
}

main();
