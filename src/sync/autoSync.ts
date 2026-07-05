import type { BackendVerificationStatus } from './backendVerification';

export const AUTO_SYNC_DELAY_MS = 1200;

export interface AutoSyncState {
  configured: boolean;
  signedIn: boolean;
  syncing: boolean;
  checkingBackend: boolean;
  pending: number;
  failed: number;
  backendVerificationStatus: BackendVerificationStatus | null;
}

export interface InitialBackendVerificationState {
  configured: boolean;
  signedIn: boolean;
  syncing: boolean;
  checkingBackend: boolean;
  backendVerificationStatus: BackendVerificationStatus | null;
}

export function shouldRunInitialBackendVerification(state: InitialBackendVerificationState): boolean {
  return (
    state.configured &&
    state.signedIn &&
    !state.syncing &&
    !state.checkingBackend &&
    state.backendVerificationStatus !== 'verified'
  );
}

export interface PostDiagnosisRetryState {
  configured: boolean;
  signedIn: boolean;
  syncing: boolean;
  checkingBackend: boolean;
  pending: number;
  failed: number;
  backendOk: boolean;
}

export function shouldAutoSync(state: AutoSyncState): boolean {
  return (
    state.configured &&
    state.signedIn &&
    !state.syncing &&
    !state.checkingBackend &&
    state.pending > 0 &&
    state.failed === 0 &&
    state.backendVerificationStatus === 'verified'
  );
}

export function shouldRetryAfterSuccessfulDiagnosis(state: PostDiagnosisRetryState): boolean {
  return (
    state.configured &&
    state.signedIn &&
    !state.syncing &&
    !state.checkingBackend &&
    state.pending > 0 &&
    state.backendOk
  );
}
