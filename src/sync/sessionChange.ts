import type { AuthSession, SyncBackendCheckResult, SyncResult } from './types';

export interface SyncSessionChangeState {
  session: AuthSession | null;
  authPending: boolean;
  lastResult: SyncResult | null;
  backendCheck: SyncBackendCheckResult | null;
  error: string;
  queueError: string;
  clearStoredBackendCheck: boolean;
}

export type SyncSessionChangePatch = Partial<Omit<SyncSessionChangeState, 'clearStoredBackendCheck'>>;

export function patchSessionChangeState(
  current: SyncSessionChangeState,
  patch: SyncSessionChangePatch,
): SyncSessionChangeState {
  return {
    ...current,
    ...patch,
    clearStoredBackendCheck: false,
  };
}

export function resolveSessionChangeState(
  current: SyncSessionChangeState,
  nextSession: AuthSession | null,
): SyncSessionChangeState {
  if (!nextSession) {
    return {
      ...current,
      session: null,
      authPending: false,
      lastResult: null,
      backendCheck: null,
      error: '',
      queueError: '',
      clearStoredBackendCheck: true,
    };
  }

  const nextUserId = nextSession.user.id;
  const currentUserId = current.session?.user.id ?? null;
  const accountChanged = currentUserId !== nextUserId;

  return {
    ...current,
    session: nextSession,
    authPending: false,
    lastResult: accountChanged ? null : current.lastResult,
    backendCheck: accountChanged ? null : current.backendCheck,
    error: '',
    queueError: '',
    clearStoredBackendCheck: accountChanged,
  };
}
