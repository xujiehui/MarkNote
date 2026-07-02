import type { Folder, ImageAttachment, Note, SyncDevice } from '../types';

export type SyncProviderId = 'disabled' | 'supabase' | 'custom';

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  user: AuthUser;
  accessToken?: string;
}

export type OAuthProvider = 'google' | 'github';

export interface RemoteSnapshot {
  folders: Folder[];
  notes: Note[];
  attachments: ImageAttachment[];
  serverTime: number;
}

export interface PushPayload {
  folders: Folder[];
  notes: Note[];
  attachments: ImageAttachment[];
  deleted: {
    folders: string[];
    notes: string[];
    attachments: string[];
  };
}

export interface RemoteSyncAdapter {
  readonly id: SyncProviderId;
  readonly name: string;
  readonly configured: boolean;
  getSession(): Promise<AuthSession | null>;
  signInWithOAuth(provider: OAuthProvider): Promise<void>;
  completeOAuthSignIn(callbackUrl: string): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  registerDevice(device: SyncDevice): Promise<void>;
  pull(lastPulledAt: number): Promise<RemoteSnapshot>;
  push(payload: PushPayload): Promise<{ syncedAt: number }>;
  uploadAttachment?(attachment: ImageAttachment): Promise<{ storagePath: string; publicUrl?: string }>;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  syncedAt?: number;
  error?: string;
}

export class SyncUnavailableError extends Error {
  constructor(message = 'Sync provider is not configured.') {
    super(message);
    this.name = 'SyncUnavailableError';
  }
}
