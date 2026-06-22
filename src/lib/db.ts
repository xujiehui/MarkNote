import Dexie, { type Table } from 'dexie';
import { nanoid } from 'nanoid';
import type { Folder, ImageAttachment, Note, SyncDevice, SyncEntity, SyncOperation, SyncQueueItem, SyncState } from '../types';
import { stripHtml } from './html';

class MarkNoteDatabase extends Dexie {
  folders!: Table<Folder, string>;
  notes!: Table<Note, string>;
  images!: Table<ImageAttachment, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  syncStates!: Table<SyncState, string>;
  syncDevices!: Table<SyncDevice, string>;

  constructor() {
    super('marknote');
    this.version(1).stores({
      notes: '&id, updatedAt, createdAt, pinned, deletedAt, *tags',
      images: '&id, noteId',
    });
    this.version(2)
      .stores({
        folders: '&id, sortOrder, updatedAt',
        notes: '&id, folderId, updatedAt, createdAt, pinned, deletedAt, *tags',
        images: '&id, noteId',
      })
      .upgrade(async (transaction) => {
        const folders = transaction.table<Folder, string>('folders');
        const notes = transaction.table<Note, string>('notes');
        await folders.put(createFolderDraft({ id: DEFAULT_FOLDER_ID, name: '资料库', sortOrder: 0 }));
        await notes.toCollection().modify((note) => {
          note.folderId = note.folderId || DEFAULT_FOLDER_ID;
        });
      });
    this.version(3).stores({
      folders: '&id, sortOrder, updatedAt, deletedAt, syncStatus',
      notes: '&id, folderId, updatedAt, createdAt, pinned, deletedAt, syncStatus, *tags',
      images: '&id, noteId, updatedAt, deletedAt, syncStatus',
      syncQueue: '&id, entity, entityId, [entity+entityId], operation, updatedAt, createdAt',
      syncStates: '&id, provider, userId, deviceId, lastSyncedAt',
      syncDevices: '&id, provider, lastSeenAt',
    }).upgrade(async (transaction) => {
      const folders = transaction.table<Folder, string>('folders');
      const notes = transaction.table<Note, string>('notes');
      const images = transaction.table<ImageAttachment, string>('images');
      await folders.toCollection().modify((folder) => {
        folder.deletedAt = folder.deletedAt ?? null;
        folder.syncStatus = folder.syncStatus ?? 'local';
        folder.lastSyncedAt = folder.lastSyncedAt ?? null;
        folder.version = folder.version ?? 1;
      });
      await notes.toCollection().modify((note) => {
        note.syncStatus = note.syncStatus ?? 'local';
        note.lastSyncedAt = note.lastSyncedAt ?? null;
        note.version = note.version ?? 1;
      });
      await images.toCollection().modify((image) => {
        image.createdAt = image.createdAt ?? Date.now();
        image.updatedAt = image.updatedAt ?? image.createdAt;
        image.deletedAt = image.deletedAt ?? null;
        image.syncStatus = image.syncStatus ?? 'local';
        image.lastSyncedAt = image.lastSyncedAt ?? null;
      });
    });
  }
}

export const db = new MarkNoteDatabase();

export const DEFAULT_TAGS = ['工作', '个人', '代码', '学习', '灵感', '项目', '读书', '会议', 'AI', '设计'];
export const DEFAULT_FOLDER_ID = 'folder-library';
export const CODE_FOLDER_ID = 'folder-code-snippets';
export const ARCHIVE_FOLDER_ID = 'folder-archive';

const DEFAULT_FOLDERS: Folder[] = [
  createFolderDraft({ id: DEFAULT_FOLDER_ID, name: '资料库', sortOrder: 0 }),
  createFolderDraft({ id: CODE_FOLDER_ID, name: '代码片段', sortOrder: 1 }),
  createFolderDraft({ id: ARCHIVE_FOLDER_ID, name: '归档', sortOrder: 2 }),
];

const WELCOME_CONTENT = `<h1>👋 欢迎使用 MarkNote</h1>
<p>这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用。你可以拖拽粘贴图片，也可以使用工具栏插入代码块。</p>
<h3>📌 快速开始</h3>
<ul>
<li>在左侧创建或选择笔记本</li>
<li>在中间列表选择笔记</li>
<li>在右侧开始编辑你的内容</li>
<li>所有内容会自动保存到云端</li>
</ul>
<h3>💻 代码示例</h3>
<pre><code class="language-javascript">const note = 'Write once, keep everywhere';
console.log(note);
export default note;</code></pre>
<h3>✨ 更多功能</h3>
<ul data-type="taskList">
<li data-checked="true"><p>支持 Markdown 语法</p></li>
<li data-checked="true"><p>支持代码高亮</p></li>
<li data-checked="false"><p>支持导入导出</p></li>
<li data-checked="false"><p>支持多端同步</p></li>
</ul>`;

const WELCOME_NOTE_ID = 'marknote-welcome-note';
const SAMPLE_NOTES: Array<Partial<Note> & { id: string }> = [
  {
    id: 'marknote-code-snippets-note',
    title: '如何使用代码片段功能',
    content: '<p>在 MarkNote 中，代码片段功能可以帮助你更好地管理和复用代码。</p>',
    folderId: CODE_FOLDER_ID,
    tags: ['代码'],
    pinned: false,
  },
  {
    id: 'marknote-design-review-note',
    title: '项目复盘：MarkNote 设计',
    content: '<p>本次迭代优化了整体 UI/UX，提升了编辑体验和交互效率。</p>',
    folderId: DEFAULT_FOLDER_ID,
    tags: ['工作'],
    pinned: false,
  },
  {
    id: 'marknote-deep-work-note',
    title: '读书笔记：《深度工作》',
    content: '<p>深度工作是一种专注的工作方式，能够帮助我们更高效地完成任务。</p>',
    folderId: DEFAULT_FOLDER_ID,
    tags: ['学习'],
    pinned: false,
  },
  {
    id: 'marknote-future-ideas-note',
    title: '灵感记录：关于未来的想法',
    content: '<p>一些关于产品方向和生活的灵感记录，随时更新。</p>',
    folderId: DEFAULT_FOLDER_ID,
    tags: ['灵感'],
    pinned: false,
  },
  {
    id: 'marknote-markdown-cheatsheet-note',
    title: 'Markdown 语法备忘',
    content: '<p>常用的 Markdown 语法速查表。</p>',
    folderId: DEFAULT_FOLDER_ID,
    tags: ['学习'],
    pinned: false,
  },
];

export async function ensureSeedNote(): Promise<string> {
  await ensureDefaultFolders();

  const welcome = await db.notes.get(WELCOME_NOTE_ID);
  if (welcome) {
    await db.notes.update(welcome.id, {
      folderId: welcome.folderId || DEFAULT_FOLDER_ID,
      content: WELCOME_CONTENT,
      rawContent: stripHtml(WELCOME_CONTENT),
      tags: ['资料库', '个人'],
      pinned: true,
    });
    await ensureSampleNotes();
    return welcome.id;
  }

  const count = await db.notes.count();
  if (count > 0) {
    await db.notes
      .filter((note) => !note.folderId)
      .modify((note) => {
        note.folderId = DEFAULT_FOLDER_ID;
      });
    const first = await db.notes.orderBy('updatedAt').reverse().first();
    return first?.id || '';
  }

  const note = createNoteDraft({
    id: WELCOME_NOTE_ID,
    title: '欢迎使用 MarkNote',
    content: WELCOME_CONTENT,
    folderId: DEFAULT_FOLDER_ID,
    tags: ['资料库', '个人'],
    pinned: true,
  });
  await db.notes.put(note);
  await ensureSampleNotes();
  return note.id;
}

async function ensureSampleNotes(): Promise<void> {
  const now = Date.now();
  for (const [index, sample] of SAMPLE_NOTES.entries()) {
    const existing = await db.notes.get(sample.id);
    if (existing) {
      continue;
    }
    await db.notes.put(
      createNoteDraft({
        ...sample,
        createdAt: now - (index + 2) * 24 * 60 * 60 * 1000,
        updatedAt: now - (index + 2) * 24 * 60 * 60 * 1000,
      }),
    );
  }
}

export function createNoteDraft(input?: Partial<Note>): Note {
  const now = Date.now();
  const content = input?.content ?? '<p></p>';
  return {
    id: input?.id ?? nanoid(),
    title: input?.title?.trim() || '未命名笔记',
    content,
    rawContent: input?.rawContent ?? stripHtml(content),
    folderId: input?.folderId || DEFAULT_FOLDER_ID,
    createdAt: input?.createdAt ?? now,
    updatedAt: input?.updatedAt ?? now,
    tags: input?.tags ?? [],
    pinned: input?.pinned ?? false,
    deletedAt: input?.deletedAt ?? null,
    syncStatus: input?.syncStatus ?? 'local',
    lastSyncedAt: input?.lastSyncedAt ?? null,
    version: input?.version ?? 1,
  };
}

export async function createNote(input?: Partial<Note>): Promise<Note> {
  const note = createNoteDraft(input);
  await db.transaction('rw', db.notes, db.syncQueue, async () => {
    await db.notes.add({ ...note, syncStatus: 'pending' });
    await enqueueSync('note', note.id, 'upsert');
  });
  return note;
}

export async function upsertNote(input: Partial<Note>, options?: { enqueueSync?: boolean }): Promise<Note> {
  const enqueue = options?.enqueueSync ?? true;
  const note = createNoteDraft(input);
  const nextNote = enqueue ? { ...note, syncStatus: 'pending' as const } : note;
  await db.transaction('rw', db.notes, db.syncQueue, async () => {
    await db.notes.put(nextNote);
    if (enqueue) {
      await enqueueSync('note', note.id, 'upsert');
    }
  });
  return note;
}

export async function updateNote(id: string, changes: Partial<Note>, options?: { enqueueSync?: boolean }): Promise<void> {
  const enqueue = options?.enqueueSync ?? true;
  const content = changes.content;
  const existing = await db.notes.get(id);
  const nextUpdatedAt = changes.updatedAt ?? Date.now();
  await db.transaction('rw', db.notes, db.syncQueue, async () => {
    await db.notes.update(id, {
      ...changes,
      rawContent: content === undefined ? changes.rawContent : stripHtml(content),
      updatedAt: nextUpdatedAt,
      syncStatus: enqueue ? 'pending' : (changes.syncStatus ?? existing?.syncStatus ?? 'local'),
      version: changes.version ?? (existing?.version ?? 0) + 1,
    });
    if (enqueue) {
      await enqueueSync('note', id, 'upsert');
    }
  });
}

export function createFolderDraft(input?: Partial<Folder>): Folder {
  const now = Date.now();
  return {
    id: input?.id ?? nanoid(),
    name: input?.name?.trim() || '新建文件夹',
    createdAt: input?.createdAt ?? now,
    updatedAt: input?.updatedAt ?? now,
    sortOrder: input?.sortOrder ?? now,
    deletedAt: input?.deletedAt ?? null,
    syncStatus: input?.syncStatus ?? 'local',
    lastSyncedAt: input?.lastSyncedAt ?? null,
    version: input?.version ?? 1,
  };
}

export async function ensureDefaultFolders(): Promise<void> {
  await db.transaction('rw', db.folders, db.notes, async () => {
    for (const folder of DEFAULT_FOLDERS) {
      const existing = await db.folders.get(folder.id);
      if (!existing) {
        await db.folders.put(folder);
      }
    }
    await db.notes
      .filter((note) => !note.folderId)
      .modify((note) => {
        note.folderId = DEFAULT_FOLDER_ID;
      });
  });
}

export async function createFolder(name = '新建文件夹'): Promise<Folder> {
  const maxSortFolder = await db.folders.orderBy('sortOrder').last();
  const folder = createFolderDraft({
    name,
    sortOrder: (maxSortFolder?.sortOrder ?? 0) + 1,
  });
  await db.transaction('rw', db.folders, db.syncQueue, async () => {
    await db.folders.add({ ...folder, syncStatus: 'pending' });
    await enqueueSync('folder', folder.id, 'upsert');
  });
  return folder;
}

export async function upsertFolder(input: Partial<Folder>, options?: { enqueueSync?: boolean }): Promise<Folder> {
  const enqueue = options?.enqueueSync ?? true;
  const folder = createFolderDraft(input);
  await db.transaction('rw', db.folders, db.syncQueue, async () => {
    await db.folders.put(enqueue ? { ...folder, syncStatus: 'pending' } : folder);
    if (enqueue) {
      await enqueueSync('folder', folder.id, 'upsert');
    }
  });
  return folder;
}

export async function renameFolder(id: string, name: string, options?: { enqueueSync?: boolean }): Promise<void> {
  const nextName = name.trim();
  if (!nextName) {
    return;
  }
  const enqueue = options?.enqueueSync ?? true;
  const existing = await db.folders.get(id);
  await db.transaction('rw', db.folders, db.syncQueue, async () => {
    await db.folders.update(id, {
      name: nextName,
      updatedAt: Date.now(),
      syncStatus: enqueue ? 'pending' : (existing?.syncStatus ?? 'local'),
      version: (existing?.version ?? 0) + 1,
    });
    if (enqueue) {
      await enqueueSync('folder', id, 'upsert');
    }
  });
}

export async function deleteFolder(id: string, targetFolderId = DEFAULT_FOLDER_ID): Promise<void> {
  if (id === DEFAULT_FOLDER_ID) {
    return;
  }
  await db.transaction('rw', db.folders, db.notes, db.syncQueue, async () => {
    const now = Date.now();
    const moved = await db.notes.where('folderId').equals(id).toArray();
    await db.notes.where('folderId').equals(id).modify((note) => {
      note.folderId = targetFolderId;
      note.updatedAt = now;
      note.syncStatus = 'pending';
      note.version = (note.version ?? 0) + 1;
    });
    await db.folders.delete(id);
    await enqueueSync('folder', id, 'delete');
    for (const note of moved) {
      await enqueueSync('note', note.id, 'upsert');
    }
  });
}

export async function deleteFolderLocally(id: string, targetFolderId = DEFAULT_FOLDER_ID): Promise<void> {
  if (id === DEFAULT_FOLDER_ID) {
    return;
  }
  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.notes.where('folderId').equals(id).modify((note) => {
      note.folderId = targetFolderId;
      note.updatedAt = Date.now();
    });
    await db.folders.delete(id);
  });
}

export async function moveNoteToFolder(noteId: string, folderId: string): Promise<void> {
  await updateNote(noteId, { folderId });
}

export async function softDeleteNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.syncQueue, async () => {
    const existing = await db.notes.get(id);
    await db.notes.update(id, {
      deletedAt: Date.now(),
      pinned: false,
      updatedAt: Date.now(),
      syncStatus: 'pending',
      version: (existing?.version ?? 0) + 1,
    });
    await enqueueSync('note', id, 'upsert');
  });
}

export async function restoreNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.syncQueue, async () => {
    const existing = await db.notes.get(id);
    await db.notes.update(id, {
      deletedAt: null,
      updatedAt: Date.now(),
      syncStatus: 'pending',
      version: (existing?.version ?? 0) + 1,
    });
    await enqueueSync('note', id, 'upsert');
  });
}

export async function permanentlyDeleteNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.images, db.syncQueue, async () => {
    await db.images.where('noteId').equals(id).delete();
    await db.notes.delete(id);
    await enqueueSync('note', id, 'delete');
  });
}

export async function purgeExpiredTrash(): Promise<void> {
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = await db.notes.where('deletedAt').below(threshold).toArray();
  await Promise.all(expired.map((note) => permanentlyDeleteNote(note.id)));
}

export async function markSynced(entity: SyncEntity, entityId: string, syncedAt = Date.now()): Promise<void> {
  const table = entityTable(entity);
  if (!table) {
    return;
  }
  await table.update(entityId, {
    syncStatus: 'synced',
    lastSyncedAt: syncedAt,
  });
}

export async function clearSyncQueueItem(id: string): Promise<void> {
  await db.syncQueue.delete(id);
}

export async function enqueueSync(entity: SyncEntity, entityId: string, operation: SyncOperation): Promise<void> {
  const now = Date.now();
  const existing = await db.syncQueue.where('[entity+entityId]').equals([entity, entityId]).first().catch(() => undefined);
  if (existing) {
    await db.syncQueue.update(existing.id, {
      operation,
      updatedAt: now,
      lastError: undefined,
    });
    return;
  }

  await db.syncQueue.put({
    id: nanoid(),
    entity,
    entityId,
    operation,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  });
}

function entityTable(entity: SyncEntity): Table<Folder | Note | ImageAttachment, string> | null {
  if (entity === 'folder') {
    return db.folders as Table<Folder | Note | ImageAttachment, string>;
  }
  if (entity === 'note') {
    return db.notes as Table<Folder | Note | ImageAttachment, string>;
  }
  if (entity === 'attachment') {
    return db.images as Table<Folder | Note | ImageAttachment, string>;
  }
  return null;
}
