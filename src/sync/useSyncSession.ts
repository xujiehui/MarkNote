import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSyncEngine } from './engine';
import { getRemoteSyncAdapter } from './adapters';
import type { AuthSession, OAuthProvider, SyncResult } from './types';

export interface SyncSessionState {
  configured: boolean;
  providerName: string;
  session: AuthSession | null;
  loading: boolean;
  syncing: boolean;
  lastResult: SyncResult | null;
  error: string;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<SyncResult>;
}

export function useSyncSession(): SyncSessionState {
  const adapter = useMemo(() => getRemoteSyncAdapter(), []);
  const engine = useMemo(() => createSyncEngine(adapter), [adapter]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(adapter.configured);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError('');
    try {
      const result = await engine.syncNow();
      setLastResult(result);
      if (!result.ok && result.error) {
        setError(result.error);
      }
      return result;
    } finally {
      setSyncing(false);
    }
  }, [engine]);

  useEffect(() => {
    if (!adapter.configured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    adapter
      .getSession()
      .then((nextSession) => {
        if (!cancelled) {
          setSession(nextSession);
          if (nextSession) {
            void syncNow();
          }
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(nextError));
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
  }, [adapter, syncNow]);

  useEffect(() => {
    const unsubscribe = window.marknoteDesktop?.onAuthCallback?.((callbackUrl) => {
      setLoading(true);
      setError('');
      adapter
        .completeOAuthSignIn(callbackUrl)
        .then((nextSession) => {
          setSession(nextSession);
          if (nextSession) {
            void syncNow();
          }
        })
        .catch((nextError: unknown) => {
          setError(errorMessage(nextError));
        })
        .finally(() => {
          setLoading(false);
        });
    });
    return () => {
      unsubscribe?.();
    };
  }, [adapter, syncNow]);

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setLoading(true);
      setError('');
      try {
        await adapter.signInWithOAuth(provider);
      } catch (nextError) {
        setError(errorMessage(nextError));
        return;
      } finally {
        setLoading(false);
      }
    },
    [adapter],
  );

  const signOut = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await adapter.signOut();
      setSession(null);
      setLastResult(null);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  return {
    configured: adapter.configured,
    providerName: adapter.name,
    session,
    loading,
    syncing,
    lastResult,
    error,
    signInWithOAuth,
    signOut,
    syncNow,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
