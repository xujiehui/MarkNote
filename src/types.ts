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
  /** Last server-confirmed revision, used as the base for conditional writes. */
  remoteRevision?: number;
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
  remoteRevision?: number;
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
  version?: number;
  remoteRevision?: number;
  /** Local-only bytes retained while a saved note version still references this attachment. */
  retainedForHistory?: boolean;
  /** Local immutable snapshot bytes; uploaded only if a restored current note uses them. */
  historyOnly?: boolean;
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
  /** Changes on every local mutation, even when the queue slot is reused. */
  mutationId?: string;
  localRevision?: number;
  baseRemoteRevision?: number;
  snapshot?: Folder | Note | ImageAttachment;
}

export interface NoteDraftRecord {
  noteId: string;
  title: string;
  content: string;
  updatedAt: number;
  revision: number;
  baseVersion?: number;
  recoveredNoteId?: string;
}

export interface NoteEditorDraftRecord extends NoteDraftRecord {
  id: string;
  editorId: string;
}

export interface NoteHistoryRecord {
  id: string;
  noteId: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface SyncTombstone {
  id: string;
  entity: SyncEntity;
  entityId: string;
  deletedAt: number;
  remoteRevision?: number;
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
  lastPulledSeq?: number;
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
