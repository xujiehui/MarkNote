import type { BackendVerificationStatus } from './backendVerification';

export const AUTO_SYNC_DELAY_MS = 1200;
export const AUTO_SYNC_POLL_MS = 30_000;
export const MAX_AUTO_SYNC_RETRIES = 5;

export function isRetryableSyncError(message: string): boolean {
  return !/sign in|signed.in account|account changed|workspace changed|protocol|jwt|unauthorized|permission denied|not configured|history-only|unsafe|integrity|size limit|invalid .*sync|does not match/i.test(message);
}

export function autoSyncRetryDelay(attempt: number, random = Math.random()): number {
  const exponential = Math.min(60_000, AUTO_SYNC_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.8 + Math.max(0, Math.min(1, random)) * 0.4));
}

export interface AutoSyncState {
  configured: boolean;
  signedIn: boolean;
  syncing: boolean;
  checkingBackend: boolean;
  pending: number;
  failed: number;
  backendVerificationStatus: BackendVerificationStatus | null;
  retryAttempt?: number;
  online?: boolean;
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
    state.backendVerificationStatus === null
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
    (state.pending > 0 || (state.retryAttempt !== undefined && state.retryAttempt > 0 && state.retryAttempt <= MAX_AUTO_SYNC_RETRIES)) &&
    (state.retryAttempt === undefined || state.retryAttempt <= MAX_AUTO_SYNC_RETRIES) &&
    (state.failed === 0 || (state.retryAttempt !== undefined && state.retryAttempt <= MAX_AUTO_SYNC_RETRIES)) &&
    state.online !== false &&
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
