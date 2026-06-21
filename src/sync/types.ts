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

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput extends SignInInput {
  displayName?: string;
}

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
  signIn(input: SignInInput): Promise<AuthSession>;
  signUp(input: SignUpInput): Promise<AuthSession>;
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
