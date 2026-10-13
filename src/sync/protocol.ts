import type { Folder, ImageAttachment, Note, SyncEntity } from '../types';

/** A frozen queue generation. expectedRevision is a server revision, never a client timestamp. */
export interface SyncMutation {
  mutationId: string;
  entity: SyncEntity;
  entityId: string;
  operation: 'upsert' | 'delete';
  expectedRevision: number;
  localRevision: number;
  value: Folder | Note | ImageAttachment | null;
}

export type RemoteEntityValue = Folder | Note | ImageAttachment;

export interface MutationReceipt {
  mutationId: string;
  entity: SyncEntity;
  entityId: string;
  localRevision: number;
  status: 'applied' | 'conflict';
  revision: number;
  sequence: number;
  value: RemoteEntityValue | null;
  replayed: boolean;
}

export interface RemoteChange {
  entity: SyncEntity;
  entityId: string;
  operation: 'upsert' | 'delete';
  revision: number;
  sequence: number;
  value: RemoteEntityValue | null;
}

/** Pages in a pull share upperBound; later commits are fetched by the next pull. */
export interface RemoteChangePage {
  changes: RemoteChange[];
  nextSequence: number;
  upperBound: number;
  hasMore: boolean;
  serverTime: number;
}

export const SYNC_PROTOCOL_VERSION = 2;
export const SYNC_PROTOCOL_CHECK_NAME = 'Versioned sync protocol';
export const SYNC_PUSH_RPC = 'marknote_sync_push_v2';
export const SYNC_PULL_RPC = 'marknote_sync_pull_v2';

export function assertSyncInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}
