import { DisabledSyncAdapter } from './disabledAdapter';
import { hasSyncConfigSource, loadSyncConfig } from './env';
import { SupabaseSyncAdapter } from './supabaseAdapter';
import type {
  AuthSession,
  AuthSessionChangeHandler,
  OAuthProvider,
  PushPayload,
  RemoteSnapshot,
  RemoteSyncAdapter,
  SyncBackendCheckResult,
} from './types';
import type { ImageAttachment, SyncDevice } from '../types';

let cachedAdapter: RemoteSyncAdapter | null = null;

export function getRemoteSyncAdapter(): RemoteSyncAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  cachedAdapter = hasSyncConfigSource() ? new BackendConfiguredSupabaseAdapter() : new DisabledSyncAdapter();
  return cachedAdapter;
}

export function resetRemoteSyncAdapterForTests(): void {
  cachedAdapter = null;
}

class BackendConfiguredSupabaseAdapter implements RemoteSyncAdapter {
  readonly id = 'supabase' as const;
  readonly name = 'Supabase';
  readonly configured = true;
  private adapterPromise: Promise<SupabaseSyncAdapter> | null = null;

  async getSession(): Promise<AuthSession | null> {
    return (await this.requireAdapter()).getSession();
  }

  onSessionChange(handler: AuthSessionChangeHandler): () => void {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void this.requireAdapter()
      .then((adapter) => {
        if (cancelled || !adapter.onSessionChange) {
          return;
        }
        unsubscribe = adapter.onSessionChange(handler);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }

  async signInWithOAuth(provider: OAuthProvider): Promise<void> {
    return (await this.requireAdapter()).signInWithOAuth(provider);
  }

  async completeOAuthSignIn(callbackUrl: string): Promise<AuthSession | null> {
    return (await this.requireAdapter()).completeOAuthSignIn(callbackUrl);
  }

  async signOut(): Promise<void> {
    return (await this.requireAdapter()).signOut();
  }

  async checkBackend(): Promise<SyncBackendCheckResult> {
    try {
      return await (await this.requireAdapter()).checkBackend();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load sync configuration from backend API.';
      return {
        ok: false,
        checkedAt: Date.now(),
        items: [
          {
            name: 'Sync configuration',
            status: 'error',
            message,
          },
        ],
      };
    }
  }

  async registerDevice(device: SyncDevice): Promise<void> {
    return (await this.requireAdapter()).registerDevice(device);
  }

  async pull(lastPulledAt: number): Promise<RemoteSnapshot> {
    return (await this.requireAdapter()).pull(lastPulledAt);
  }

  async push(payload: PushPayload): Promise<{ syncedAt: number }> {
    return (await this.requireAdapter()).push(payload);
  }

  async uploadAttachment(attachment: ImageAttachment): Promise<{ storagePath: string; publicUrl?: string }> {
    return (await this.requireAdapter()).uploadAttachment(attachment);
  }

  async downloadAttachment(attachment: ImageAttachment): Promise<{ data: string }> {
    return (await this.requireAdapter()).downloadAttachment(attachment);
  }

  private requireAdapter(): Promise<SupabaseSyncAdapter> {
    if (!this.adapterPromise) {
      this.adapterPromise = loadSyncConfig()
        .then((config) => {
          if (config.provider === 'disabled') {
            throw new Error('Sync configuration backend API returned disabled sync provider.');
          }
          return new SupabaseSyncAdapter(config.supabase.url, config.supabase.publishableKey, undefined, {
            authRedirectUrl: config.supabase.authRedirectUrl,
          });
        })
        .catch((error) => {
          this.adapterPromise = null;
          throw error;
        });
    }
    return this.adapterPromise;
  }
}
