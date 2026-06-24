export interface Note {
  id: string;
  title: string;
  content: string;
  rawContent?: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  pinned: boolean;
  deletedAt?: number | null;
  syncStatus?: SyncStatus;
  lastSyncedAt?: number | null;
  version?: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  deletedAt?: number | null;
  syncStatus?: SyncStatus;
  lastSyncedAt?: number | null;
  version?: number;
}

export interface ImageAttachment {
  id: string;
  noteId: string;
  data: string;
  mimeType: string;
  storagePath?: string;
  sizeBytes?: number;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
  syncStatus?: SyncStatus;
  lastSyncedAt?: number | null;
}

export type SyncEntity = 'folder' | 'note' | 'attachment';

export type SyncOperation = 'upsert' | 'delete';

export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict' | 'error';

export interface SyncQueueItem {
  id: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError?: string;
}

export interface SyncDevice {
  id: string;
  name: string;
  provider: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface SyncState {
  id: string;
  provider: string;
  userId: string;
  deviceId: string;
  lastPulledAt: number;
  lastPushedAt: number;
  lastSyncedAt: number;
  status: SyncStatus;
  lastError?: string;
}

export type ExportFormat = 'html' | 'pdf' | 'markdown' | 'json';

export type WorkspaceFilter = 'all' | 'trash' | `folder:${string}` | `tag:${string}`;

export type NoteSortMode = 'updated' | 'created' | 'title' | 'favorite';

export type NoteQuickFilter = 'all' | 'pinned' | 'recent7' | 'recent30' | 'archived';

export type ShareType = 'private' | 'public' | 'team';

export type SharePermission = 'read' | 'comment' | 'edit';

export interface ShareSettings {
  type: ShareType;
  permission: SharePermission;
  linkId: string;
  updatedAt: number;
}

export interface SearchResultNote {
  id: string;
  title: string;
  preview: string;
}

export interface SearchResultTag {
  tag: string;
  count: number;
}

export interface SearchResultCodeBlock {
  noteId: string;
  noteTitle: string;
  language: string;
  preview: string;
}

export interface SearchResultGroups {
  recentNotes: SearchResultNote[];
  notes: SearchResultNote[];
  tags: SearchResultTag[];
  codeBlocks: SearchResultCodeBlock[];
}

export interface ImportResult {
  title: string;
  content: string;
  note?: Note;
  tags?: string[];
}
