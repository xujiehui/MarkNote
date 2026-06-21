import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Folder, ImageAttachment, Note, SyncDevice } from '../types';
import type { AuthSession, PushPayload, RemoteSnapshot, RemoteSyncAdapter, SignInInput, SignUpInput } from './types';

const FOLDERS_TABLE = 'folders';
const NOTES_TABLE = 'notes';
const ATTACHMENTS_TABLE = 'attachments';
const DEVICES_TABLE = 'devices';
const ATTACHMENTS_BUCKET = 'attachments';

interface RemoteFolderRow {
  id: string;
  user_id?: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number | null;
}

interface RemoteNoteRow {
  id: string;
  user_id?: string;
  folder_id: string;
  title: string;
  content: string;
  raw_content: string | null;
  tags: string[] | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number | null;
}

interface RemoteAttachmentRow {
  id: string;
  user_id?: string;
  note_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RemoteDeviceRow {
  id: string;
  name: string;
  platform: string;
  last_seen_at: string;
}

export class SupabaseSyncAdapter implements RemoteSyncAdapter {
  readonly id = 'supabase' as const;
  readonly name = 'Supabase';
  readonly configured: boolean;
  private readonly client: SupabaseClient | null;

  constructor(url: string | undefined, publishableKey: string | undefined) {
    this.configured = Boolean(url && publishableKey);
    this.client = this.configured && url && publishableKey ? createClient(url, publishableKey) : null;
  }

  async getSession(): Promise<AuthSession | null> {
    const client = this.requireClient();
    const {
      data: { session },
      error,
    } = await client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }
    if (!session?.user) {
      return null;
    }
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
      },
      accessToken: session.access_token,
    };
  }

  async signIn(input: SignInInput): Promise<AuthSession> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error || !data.session?.user) {
      throw new Error(error?.message || 'Unable to sign in.');
    }
    return {
      user: {
        id: data.session.user.id,
        email: data.session.user.email,
      },
      accessToken: data.session.access_token,
    };
  }

  async signUp(input: SignUpInput): Promise<AuthSession> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: input.displayName ? { display_name: input.displayName } : undefined,
      },
    });
    if (error || !data.user) {
      throw new Error(error?.message || 'Unable to create account.');
    }
    return {
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      accessToken: data.session?.access_token,
    };
  }

  async signOut(): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  async registerDevice(device: SyncDevice): Promise<void> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session) {
      return;
    }
    const row: RemoteDeviceRow & { user_id: string } = {
      id: device.id,
      user_id: session.user.id,
      name: device.name,
      platform: device.provider,
      last_seen_at: toIso(device.lastSeenAt),
    };
    const { error } = await client.from(DEVICES_TABLE).upsert(row);
    if (error) {
      throw new Error(error.message);
    }
  }

  async pull(lastPulledAt: number): Promise<RemoteSnapshot> {
    const client = this.requireClient();
    const since = toIso(lastPulledAt || 0);
    const [folders, notes, attachments] = await Promise.all([
      client.from(FOLDERS_TABLE).select('*').gt('updated_at', since),
      client.from(NOTES_TABLE).select('*').gt('updated_at', since),
      client.from(ATTACHMENTS_TABLE).select('*').gt('updated_at', since),
    ]);

    if (folders.error) {
      throw new Error(folders.error.message);
    }
    if (notes.error) {
      throw new Error(notes.error.message);
    }
    if (attachments.error) {
      throw new Error(attachments.error.message);
    }

    return {
      folders: ((folders.data || []) as RemoteFolderRow[]).map(folderFromRow),
      notes: ((notes.data || []) as RemoteNoteRow[]).map(noteFromRow),
      attachments: ((attachments.data || []) as RemoteAttachmentRow[]).map(attachmentFromRow),
      serverTime: Date.now(),
    };
  }

  async push(payload: PushPayload): Promise<{ syncedAt: number }> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session) {
      throw new Error('Please sign in before syncing.');
    }

    const userId = session.user.id;
    const folderRows = payload.folders.map((folder) => folderToRow(folder, userId));
    const noteRows = payload.notes.map((note) => noteToRow(note, userId));
    const attachmentRows = payload.attachments
      .filter((attachment) => attachment.storagePath)
      .map((attachment) => attachmentToRow(attachment, userId));

    if (folderRows.length) {
      const { error } = await client.from(FOLDERS_TABLE).upsert(folderRows);
      if (error) {
        throw new Error(error.message);
      }
    }
    if (noteRows.length) {
      const { error } = await client.from(NOTES_TABLE).upsert(noteRows);
      if (error) {
        throw new Error(error.message);
      }
    }
    if (attachmentRows.length) {
      const { error } = await client.from(ATTACHMENTS_TABLE).upsert(attachmentRows);
      if (error) {
        throw new Error(error.message);
      }
    }

    const deletedAt = new Date().toISOString();
    await Promise.all([
      ...payload.deleted.folders.map((id) => softDeleteRemote(client, FOLDERS_TABLE, id, deletedAt)),
      ...payload.deleted.notes.map((id) => softDeleteRemote(client, NOTES_TABLE, id, deletedAt)),
      ...payload.deleted.attachments.map((id) => softDeleteRemote(client, ATTACHMENTS_TABLE, id, deletedAt)),
    ]).then((results) => {
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        throw new Error(failed.error.message);
      }
    });

    return { syncedAt: Date.now() };
  }

  async uploadAttachment(attachment: ImageAttachment): Promise<{ storagePath: string; publicUrl?: string }> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session) {
      throw new Error('Please sign in before uploading attachments.');
    }
    const blob = dataUrlToBlob(attachment.data, attachment.mimeType);
    const storagePath = attachment.storagePath || `${session.user.id}/${attachment.noteId}/${attachment.id}`;
    const { error } = await client.storage.from(ATTACHMENTS_BUCKET).upload(storagePath, blob, {
      contentType: attachment.mimeType,
      upsert: true,
    });
    if (error) {
      throw new Error(error.message);
    }
    const { data } = client.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(storagePath);
    return { storagePath, publicUrl: data.publicUrl };
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    return this.client;
  }
}

function folderFromRow(row: RemoteFolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
    version: row.version ?? 1,
  };
}

function noteFromRow(row: RemoteNoteRow): Note {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    content: row.content,
    rawContent: row.raw_content || undefined,
    tags: row.tags || [],
    pinned: row.pinned,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
    version: row.version ?? 1,
  };
}

function attachmentFromRow(row: RemoteAttachmentRow): ImageAttachment {
  return {
    id: row.id,
    noteId: row.note_id,
    data: '',
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes ?? undefined,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
  };
}

function folderToRow(folder: Folder, userId: string): RemoteFolderRow {
  return {
    id: folder.id,
    user_id: userId,
    name: folder.name,
    sort_order: folder.sortOrder,
    created_at: toIso(folder.createdAt),
    updated_at: toIso(folder.updatedAt),
    deleted_at: folder.deletedAt ? toIso(folder.deletedAt) : null,
    version: folder.version ?? 1,
  };
}

function noteToRow(note: Note, userId: string): RemoteNoteRow {
  return {
    id: note.id,
    user_id: userId,
    folder_id: note.folderId,
    title: note.title,
    content: note.content,
    raw_content: note.rawContent || null,
    tags: note.tags,
    pinned: note.pinned,
    created_at: toIso(note.createdAt),
    updated_at: toIso(note.updatedAt),
    deleted_at: note.deletedAt ? toIso(note.deletedAt) : null,
    version: note.version ?? 1,
  };
}

function attachmentToRow(attachment: ImageAttachment, userId: string): RemoteAttachmentRow {
  return {
    id: attachment.id,
    user_id: userId,
    note_id: attachment.noteId,
    storage_path: attachment.storagePath || '',
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes ?? null,
    created_at: toIso(attachment.createdAt ?? Date.now()),
    updated_at: toIso(attachment.updatedAt ?? attachment.createdAt ?? Date.now()),
    deleted_at: attachment.deletedAt ? toIso(attachment.deletedAt) : null,
  };
}

function toIso(value: number): string {
  return new Date(value || 0).toISOString();
}

function fromIso(value: string): number {
  return new Date(value).getTime();
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const [, encoded = ''] = dataUrl.split(',');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function softDeleteRemote(client: SupabaseClient, table: string, id: string, deletedAt: string) {
  return client
    .from(table)
    .update({
      deleted_at: deletedAt,
      updated_at: deletedAt,
    })
    .eq('id', id);
}
