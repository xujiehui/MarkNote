import type { AuthSession, RemoteSnapshot, RemoteSyncAdapter, SignInInput, SignUpInput } from './types';
import { SyncUnavailableError } from './types';

export class DisabledSyncAdapter implements RemoteSyncAdapter {
  readonly id = 'disabled' as const;
  readonly name = 'Local only';
  readonly configured = false;

  async getSession(): Promise<AuthSession | null> {
    return null;
  }

  async signIn(_input: SignInInput): Promise<AuthSession> {
    void _input;
    throw new SyncUnavailableError();
  }

  async signUp(_input: SignUpInput): Promise<AuthSession> {
    void _input;
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
