import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createSyncEngine } from './engine';
import { getRemoteSyncAdapter } from './adapters';
import {
  AUTO_SYNC_DELAY_MS,
  shouldAutoSync,
  shouldRetryAfterSuccessfulDiagnosis,
  shouldRunInitialBackendVerification,
} from './autoSync';
import { backendCheckFailureResult } from './backendCheckResult';
import { claimDesktopOAuthCallback, clearDesktopOAuthCallback, releaseDesktopOAuthCallback } from './desktopOAuthCallback';
import { consumeCurrentOAuthCallbackUrl } from './oauthCallback';
import { patchSessionChangeState, resolveSessionChangeState, type SyncSessionChangePatch } from './sessionChange';
import { resolveQueueErrorStatus, summarizeSyncQueue } from './sessionStatus';
import { resolveBackendVerification } from './backendVerification';
import {
  backendCheckStorageKey,
  backendCheckStorageKeyForUser,
  clearStoredBackendCheck,
  readStoredBackendCheck,
  writeStoredBackendCheck,
} from './backendCheckStorage';
import { errorWithCauseMessage } from './supabaseError';
import { db } from '../lib/db';
import type { AuthSession, OAuthProvider, SyncBackendCheckResult, SyncResult } from './types';

const handledDesktopCallbackUrls = new Set<string>();

export interface SyncQueueSummary {
  pending: number;
  failed: number;
  firstError: string;
}

export interface SyncSessionState {
  configured: boolean;
  providerName: string;
  session: AuthSession | null;
  loading: boolean;
  authPending: boolean;
  syncing: boolean;
  checkingBackend: boolean;
  lastResult: SyncResult | null;
  backendCheck: SyncBackendCheckResult | null;
  queue: SyncQueueSummary;
  error: string;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<SyncResult>;
  checkBackend: () => Promise<SyncBackendCheckResult>;
}

export function useSyncSession(): SyncSessionState {
  const adapter = useMemo(() => getRemoteSyncAdapter(), []);
  const engine = useMemo(() => createSyncEngine(adapter), [adapter]);
  const legacyBackendCheckKey = backendCheckStorageKey(adapter.id);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(adapter.configured);
  const [authPending, setAuthPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkingBackend, setCheckingBackend] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [backendCheck, setBackendCheck] = useState<SyncBackendCheckResult | null>(null);
  const [error, setError] = useState('');
  const [queueError, setQueueError] = useState('');
  const sessionChangeStateRef = useRef({
    session,
    authPending,
    lastResult,
    backendCheck,
    error,
    queueError,
    clearStoredBackendCheck: false,
  });
  const queue = useLiveQuery(async () => {
    const items = await db.syncQueue.toArray();
    return summarizeSyncQueue(items);
  }, [], { pending: 0, failed: 0, firstError: '' });

  const patchSessionStateRef = useCallback((patch: SyncSessionChangePatch) => {
    sessionChangeStateRef.current = patchSessionChangeState(sessionChangeStateRef.current, patch);
  }, []);

  const runBackendCheck = useCallback(async () => {
    setCheckingBackend(true);
    try {
      let result: SyncBackendCheckResult;
      try {
        result = adapter.checkBackend
          ? await adapter.checkBackend()
          : {
              ok: false,
              checkedAt: Date.now(),
              items: [
                {
                  name: adapter.name,
                  status: 'error' as const,
                  message: 'This sync provider does not expose backend diagnostics.',
                },
              ],
        };
      } catch (nextError: unknown) {
        result = backendCheckFailureResult(adapter.name, nextError);
      }
      const userId = sessionChangeStateRef.current.session?.user.id;
      if (userId) {
        writeStoredBackendCheck(backendCheckStorageKeyForUser(adapter.id, userId), result);
      }
      const firstError = result.items.find((item) => item.status === 'error');
      const nextError = firstError ? firstError.message : result.ok ? '' : sessionChangeStateRef.current.error;
      patchSessionStateRef({ backendCheck: result, error: nextError });
      setBackendCheck(result);
      if (firstError) {
        setError(firstError.message);
      } else if (result.ok) {
        setError('');
      }
      return result;
    } finally {
      setCheckingBackend(false);
    }
  }, [adapter, patchSessionStateRef]);

  const applySessionChange = useCallback(
    (nextSession: AuthSession | null) => {
      const next = resolveSessionChangeState(sessionChangeStateRef.current, nextSession);
      const storedBackendCheck = next.session
        ? readStoredBackendCheck(backendCheckStorageKeyForUser(adapter.id, next.session.user.id))
        : null;
      if (next.session && storedBackendCheck && !next.backendCheck) {
        next.backendCheck = storedBackendCheck;
        next.clearStoredBackendCheck = false;
      }
      sessionChangeStateRef.current = next;
      setSession(next.session);
      setAuthPending(next.authPending);
      setLastResult(next.lastResult);
      setBackendCheck(next.backendCheck);
      setError(next.error);
      setQueueError(next.queueError);
      if (next.clearStoredBackendCheck) {
        clearStoredBackendCheck(legacyBackendCheckKey);
      }
      return next;
    },
    [adapter.id, legacyBackendCheckKey],
  );

  const syncNow = useCallback(async () => {
    setSyncing(true);
    patchSessionStateRef({ error: '', queueError: '' });
    setError('');
    setQueueError('');
    try {
      const result = await engine.syncNow();
      patchSessionStateRef({ lastResult: result });
      setLastResult(result);
      if (!result.ok && result.error) {
        patchSessionStateRef({ error: result.error });
        setError(result.error);
        void runBackendCheck();
      }
      return result;
    } finally {
      setSyncing(false);
    }
  }, [engine, patchSessionStateRef, runBackendCheck]);

  const checkBackend = useCallback(async () => {
    const result = await runBackendCheck();
    if (
      shouldRetryAfterSuccessfulDiagnosis({
        configured: adapter.configured,
        signedIn: Boolean(sessionChangeStateRef.current.session),
        syncing,
        checkingBackend: false,
        pending: queue.pending,
        failed: queue.failed,
        backendOk: result.ok,
      })
    ) {
      void syncNow();
    }
    return result;
  }, [adapter.configured, queue.failed, queue.pending, runBackendCheck, syncing, syncNow]);

  useEffect(() => {
    const queueErrorResolution = resolveQueueErrorStatus({
      currentError: sessionChangeStateRef.current.error,
      previousQueueError: sessionChangeStateRef.current.queueError,
      nextQueueError: queue.firstError,
      signedIn: Boolean(sessionChangeStateRef.current.session),
      syncing,
    });
    patchSessionStateRef({ error: queueErrorResolution.error, queueError: queueErrorResolution.queueError });
    setQueueError(queueErrorResolution.queueError);
    setError(queueErrorResolution.error);
  }, [patchSessionStateRef, queue.firstError, session, syncing]);

  useEffect(() => {
    const backendVerificationStatus = backendCheck ? resolveBackendVerification(backendCheck.items).status : null;
    if (
      shouldRunInitialBackendVerification({
        configured: adapter.configured,
        signedIn: Boolean(session),
        syncing,
        checkingBackend,
        backendVerificationStatus,
      })
    ) {
      void runBackendCheck();
      return;
    }

    if (
      !shouldAutoSync({
        configured: adapter.configured,
        signedIn: Boolean(session),
        syncing,
        checkingBackend,
        pending: queue.pending,
        failed: queue.failed,
        backendVerificationStatus,
      })
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void syncNow();
    }, AUTO_SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [adapter.configured, backendCheck, checkingBackend, queue.failed, queue.pending, runBackendCheck, session, syncing, syncNow]);

  useEffect(() => {
    sessionChangeStateRef.current = {
      session,
      authPending,
      lastResult,
      backendCheck,
      error,
      queueError,
      clearStoredBackendCheck: false,
    };
  }, [authPending, backendCheck, error, lastResult, queueError, session]);

  useEffect(() => {
    if (!adapter.configured || !adapter.onSessionChange) {
      return;
    }

    return adapter.onSessionChange((nextSession) => {
      applySessionChange(nextSession);
    });
  }, [adapter, applySessionChange]);

  const completeDesktopOAuthCallback = useCallback(
    async (callbackUrl: string | null | undefined) => {
      const claimedCallbackUrl = claimDesktopOAuthCallback(handledDesktopCallbackUrls, callbackUrl);
      if (!claimedCallbackUrl) {
        return;
      }
      setLoading(true);
      patchSessionStateRef({ error: '', queueError: '' });
      setError('');
      setQueueError('');
      try {
        const nextSession = await adapter.completeOAuthSignIn(claimedCallbackUrl);
        const next = applySessionChange(nextSession);
        if (nextSession) {
          await clearDesktopOAuthCallback(window.marknoteDesktop, claimedCallbackUrl);
          void runBackendCheck();
        } else if (!next.session) {
          releaseDesktopOAuthCallback(handledDesktopCallbackUrls, claimedCallbackUrl);
        }
      } catch (nextError: unknown) {
        releaseDesktopOAuthCallback(handledDesktopCallbackUrls, claimedCallbackUrl);
        const message = errorMessage(nextError);
        patchSessionStateRef({ authPending: false, error: message });
        setAuthPending(false);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [adapter, applySessionChange, patchSessionStateRef, runBackendCheck],
  );

  useEffect(() => {
    if (!adapter.configured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const callbackUrl = consumeCurrentOAuthCallbackUrl();
    const sessionPromise = callbackUrl ? adapter.completeOAuthSignIn(callbackUrl) : adapter.getSession();

    sessionPromise
      .then((nextSession) => {
        if (!cancelled) {
          applySessionChange(nextSession);
          if (nextSession) {
            void runBackendCheck();
          }
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          const message = errorMessage(nextError);
          patchSessionStateRef({ error: message });
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, applySessionChange, patchSessionStateRef, runBackendCheck]);

  useEffect(() => {
    const unsubscribe = window.marknoteDesktop?.onAuthCallback?.((callbackUrl) => {
      void completeDesktopOAuthCallback(callbackUrl);
    });
    return () => {
      unsubscribe?.();
    };
  }, [completeDesktopOAuthCallback]);

  useEffect(() => {
    let cancelled = false;
    window.marknoteDesktop?.getAuthCallback?.()
      .then((callbackUrl) => {
        if (!cancelled) {
          void completeDesktopOAuthCallback(callbackUrl);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          const message = errorMessage(nextError);
          patchSessionStateRef({ error: message });
          setError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [completeDesktopOAuthCallback, patchSessionStateRef]);

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setLoading(true);
      patchSessionStateRef({ error: '', queueError: '' });
      setError('');
      setQueueError('');
      try {
        await adapter.signInWithOAuth(provider);
        patchSessionStateRef({ authPending: true });
        setAuthPending(true);
      } catch (nextError) {
        const message = errorMessage(nextError);
        patchSessionStateRef({ authPending: false, error: message });
        setAuthPending(false);
        setError(message);
        return;
      } finally {
        setLoading(false);
      }
    },
    [adapter, patchSessionStateRef],
  );

  const signOut = useCallback(async () => {
    setLoading(true);
    patchSessionStateRef({ error: '' });
    setError('');
    try {
      await adapter.signOut();
      applySessionChange(null);
    } catch (nextError) {
      const message = errorMessage(nextError);
      patchSessionStateRef({ error: message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [adapter, applySessionChange, patchSessionStateRef]);

  return {
    configured: adapter.configured,
    providerName: adapter.name,
    session,
    loading,
    authPending,
    syncing,
    checkingBackend,
    lastResult,
    backendCheck,
    queue,
    error,
    signInWithOAuth,
    signOut,
    syncNow,
    checkBackend,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? errorWithCauseMessage(error) : 'Something went wrong.';
}
