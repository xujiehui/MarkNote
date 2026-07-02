import type { AuthSession, OAuthProvider, RemoteSnapshot, RemoteSyncAdapter } from './types';
import { SyncUnavailableError } from './types';

export class DisabledSyncAdapter implements RemoteSyncAdapter {
  readonly id = 'disabled' as const;
  readonly name = 'Local only';
  readonly configured = false;

  async getSession(): Promise<AuthSession | null> {
    return null;
  }

  async signInWithOAuth(_provider: OAuthProvider): Promise<void> {
    void _provider;
    throw new SyncUnavailableError();
  }

  async completeOAuthSignIn(_callbackUrl: string): Promise<AuthSession | null> {
    void _callbackUrl;
    throw new SyncUnavailableError();
  }

  async signOut(): Promise<void> {
    return undefined;
  }

  async registerDevice(): Promise<void> {
    return undefined;
  }

  async pull(_lastPulledAt: number): Promise<RemoteSnapshot> {
    void _lastPulledAt;
    throw new SyncUnavailableError();
  }

  async push(): Promise<{ syncedAt: number }> {
    throw new SyncUnavailableError();
  }
}
