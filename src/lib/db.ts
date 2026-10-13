import Dexie, { type Table } from 'dexie';
import { nanoid } from 'nanoid';
import type { Folder, ImageAttachment, Note, NoteDraftRecord, NoteEditorDraftRecord, NoteHistoryRecord, SyncDevice, SyncEntity, SyncOperation, SyncQueueItem, SyncState, SyncTombstone } from '../types';
import { stripHtml } from './html';
import { sanitizeContentUrl, sanitizeNoteContent } from './sanitizeContent';
import { attachmentIdFromRefUrl, attachmentRefUrl } from './attachmentContent';
import { createLocalConflictCopy } from './cloneNoteAttachments';
import { dataUrlMimeType, dataUrlSizeBytes } from './image';
import { getWorkspaceEpoch, getWorkspaceSnapshot, invalidateWorkspaceEpoch, publishWorkspace, workspaceForAccount, type WorkspaceSnapshot } from '../workspace/state';

export { getWorkspaceEpoch, getWorkspaceSnapshot, isWorkspaceCurrent, subscribeWorkspace, workspaceStorageKey } from '../workspace/state';

export class MarkNoteDatabase extends Dexie {
  folders!: Table<Folder, string>;
  notes!: Table<Note, string>;
  images!: Table<ImageAttachment, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  syncStates!: Table<SyncState, string>;
  syncDevices!: Table<SyncDevice, string>;
  drafts!: Table<NoteDraftRecord, string>;
  editorDrafts!: Table<NoteEditorDraftRecord, string>;
  noteHistory!: Table<NoteHistoryRecord, string>;
  tombstones!: Table<SyncTombstone, string>;
  localMetadata!: Table<{ id: string; value: unknown }, string>;

  constructor(name = 'marknote') {
    super(name);
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
    this.version(4).stores({
      drafts: '&noteId, updatedAt',
      noteHistory: '&id, noteId, [noteId+createdAt], createdAt',
      tombstones: '&id, [entity+entityId], entity, entityId, deletedAt',
      localMetadata: '&id',
    });
    // Keep the v4 draft table as a recoverable source. New editors never share a draft slot.
    this.version(5).stores({
      editorDrafts: '&id, noteId, editorId, updatedAt, [noteId+editorId]',
    });
  }
}

export let db = new MarkNoteDatabase();
const databases = new Map<string, MarkNoteDatabase>([['marknote', db]]);
let requestedWorkspaceId = 'guest';
let switchRequest = 0;
let workspaceSwitchChain: Promise<unknown> = Promise.resolve();

export interface DatabaseOptions {
  database?: MarkNoteDatabase;
}

export interface SyncWriteOptions extends DatabaseOptions {
  enqueueSync?: boolean;
}

export interface WorkspaceSwitchContext {
  fromDatabase: MarkNoteDatabase;
  fromWorkspace: WorkspaceSnapshot;
  toWorkspace: WorkspaceSnapshot;
}

const workspaceSwitchGuards = new Set<(context: WorkspaceSwitchContext) => Promise<void> | void>();

export function getActiveDatabase(): MarkNoteDatabase {
  return db;
}

export function registerWorkspaceSwitchGuard(guard: (context: WorkspaceSwitchContext) => Promise<void> | void): () => void {
  workspaceSwitchGuards.add(guard);
  return () => workspaceSwitchGuards.delete(guard);
}

/** Never infer the owner of legacy data: the existing database remains the guest space. */
export function switchWorkspaceAccount(userId: string | null, provider = 'supabase'): Promise<WorkspaceSnapshot> {
  const target = workspaceForAccount(userId, provider);
  if (target.id === getWorkspaceSnapshot().id && target.id === requestedWorkspaceId) {
    return db.open().then(() => {
      if (target.id === requestedWorkspaceId && target.id === getWorkspaceSnapshot().id
        && getWorkspaceSnapshot().epoch !== getWorkspaceEpoch()) {
        publishWorkspace({ ...getWorkspaceSnapshot(), epoch: getWorkspaceEpoch() });
      }
      return getWorkspaceSnapshot();
    });
  }
  requestedWorkspaceId = target.id;
  const request = ++switchRequest;
  const epoch = invalidateWorkspaceEpoch();
  const next = { ...target, epoch };
  const switchOperation = workspaceSwitchChain.catch(() => undefined).then(async () => {
    if (request !== switchRequest) {
      return getWorkspaceSnapshot();
    }
    const fromDatabase = db;
    const fromWorkspace = getWorkspaceSnapshot();
    let targetDatabase = databases.get(next.databaseName);
    if (!targetDatabase) {
      targetDatabase = new MarkNoteDatabase(next.databaseName);
      databases.set(next.databaseName, targetDatabase);
    }
    await targetDatabase.open();
    for (const guard of workspaceSwitchGuards) {
      await guard({ fromDatabase, fromWorkspace, toWorkspace: next });
    }
    if (request !== switchRequest) {
      return getWorkspaceSnapshot();
    }
    db = targetDatabase;
    publishWorkspace(next);
    return next;
  });
  workspaceSwitchChain = switchOperation;
  return switchOperation.catch((error) => {
    if (request === switchRequest) {
      requestedWorkspaceId = getWorkspaceSnapshot().id;
      // The old account remains active; discard old network responses without stranding its epoch.
      publishWorkspace({ ...getWorkspaceSnapshot(), epoch: getWorkspaceEpoch() });
    }
    throw error;
  });
}

export const DEFAULT_TAGS = ['工作', '个人', '代码', '学习', '灵感', '项目', '读书', '会议', 'AI', '设计'];
export const DEFAULT_FOLDER_ID = 'folder-library';
export const CODE_FOLDER_ID = 'folder-code-snippets';
export const ARCHIVE_FOLDER_ID = 'folder-archive';

const DEFAULT_FOLDERS: Folder[] = [
  createFolderDraft({ id: DEFAULT_FOLDER_ID, name: '资料库', sortOrder: 0 }),
  createFolderDraft({ id: CODE_FOLDER_ID, name: '代码片段', sortOrder: 1 }),
  createFolderDraft({ id: ARCHIVE_FOLDER_ID, name: '归档', sortOrder: 2 }),
];

const LEGACY_WELCOME_SYNC_LINE = '<li>所有内容会自动保存到云端</li>';
const LOCAL_FIRST_WELCOME_SYNC_LINE = '<li>内容会先自动保存到本地，登录后再同步到云端</li>';
const WELCOME_CONTENT = `<h1>👋 欢迎使用 MarkNote</h1>
<p>这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用。你可以拖拽粘贴图片，也可以使用工具栏插入代码块。</p>
<h3>📌 快速开始</h3>
<ul>
<li>在左侧创建或选择笔记本</li>
<li>在中间列表选择笔记</li>
<li>在右侧开始编辑你的内容</li>
${LOCAL_FIRST_WELCOME_SYNC_LINE}
</ul>
<h3>💻 代码示例</h3>
<pre><code class="language-javascript">const note = 'Write once, keep everywhere';
console.log(note);
export default note;</code></pre>
<h3>✨ 更多功能</h3>
<ul data-type="taskList">
<li data-type="taskItem" data-checked="true"><p>支持 Markdown 语法</p></li>
<li data-type="taskItem" data-checked="true"><p>支持代码高亮</p></li>
<li data-type="taskItem" data-checked="false"><p>支持导入导出</p></li>
<li data-type="taskItem" data-checked="false"><p>支持多端同步</p></li>
</ul>`;
const LEGACY_WELCOME_CONTENT = WELCOME_CONTENT.replace(LOCAL_FIRST_WELCOME_SYNC_LINE, LEGACY_WELCOME_SYNC_LINE);
const LEGACY_TASK_ITEM_WELCOME_CONTENT = removeWelcomeTaskItemTypes(WELCOME_CONTENT);
const LEGACY_SYNC_AND_TASK_ITEM_WELCOME_CONTENT = removeWelcomeTaskItemTypes(LEGACY_WELCOME_CONTENT);
const PLAIN_TASK_LIST_WELCOME_CONTENT = stripWelcomeTaskListAttrs(WELCOME_CONTENT);
const PLAIN_TASK_LIST_AND_LEGACY_SYNC_WELCOME_CONTENT = stripWelcomeTaskListAttrs(LEGACY_WELCOME_CONTENT);
const WELCOME_TEMPLATE_CONTENTS = new Set([
  LEGACY_WELCOME_CONTENT,
  LEGACY_TASK_ITEM_WELCOME_CONTENT,
  LEGACY_SYNC_AND_TASK_ITEM_WELCOME_CONTENT,
  PLAIN_TASK_LIST_WELCOME_CONTENT,
  PLAIN_TASK_LIST_AND_LEGACY_SYNC_WELCOME_CONTENT,
]);
const WELCOME_TEMPLATE_TEXT_CONTENTS = [
  WELCOME_CONTENT,
  LEGACY_WELCOME_CONTENT,
  LEGACY_TASK_ITEM_WELCOME_CONTENT,
  LEGACY_SYNC_AND_TASK_ITEM_WELCOME_CONTENT,
  PLAIN_TASK_LIST_WELCOME_CONTENT,
  PLAIN_TASK_LIST_AND_LEGACY_SYNC_WELCOME_CONTENT,
];
let welcomeTemplateTextCache: Set<string> | null = null;

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

export async function ensureSeedNote(options?: DatabaseOptions): Promise<string> {
  const database = options?.database ?? db;
  await ensureDefaultFolders({ database });

  if (database.name !== 'marknote') {
    // Sample/legacy content belongs to the guest space and must never be uploaded at sign-in.
    return (await database.notes.orderBy('updatedAt').reverse().first())?.id ?? '';
  }

  const welcome = await database.notes.get(WELCOME_NOTE_ID);
  if (welcome) {
    const nextContent = shouldMigrateWelcomeTemplate(welcome) ? normalizeWelcomeContent(welcome.content) : welcome.content;
    await database.notes.update(welcome.id, {
      folderId: welcome.folderId || DEFAULT_FOLDER_ID,
      tags: welcome.tags?.length ? welcome.tags : ['资料库', '个人'],
      pinned: welcome.pinned ?? true,
      ...(nextContent === welcome.content
        ? {}
        : {
            content: nextContent,
            rawContent: stripHtml(nextContent),
          }),
    });
    await ensureSampleNotes({ database });
    return welcome.id;
  }

  const count = await database.notes.count();
  if (count > 0) {
    await database.notes
      .filter((note) => !note.folderId)
      .modify((note) => {
        note.folderId = DEFAULT_FOLDER_ID;
      });
    const first = await database.notes.orderBy('updatedAt').reverse().first();
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
  await database.notes.put(note);
  await ensureSampleNotes({ database });
  return note.id;
}

function shouldMigrateWelcomeTemplate(note: Note): boolean {
  return (note.version ?? 1) <= 1 && (note.syncStatus ?? 'local') === 'local';
}

function normalizeWelcomeContent(content: string): string {
  if (WELCOME_TEMPLATE_CONTENTS.has(content) || hasWelcomeTemplateText(content)) {
    return WELCOME_CONTENT;
  }
  return content;
}

function hasWelcomeTemplateText(content: string): boolean {
  const text = stripHtml(content);
  if (!welcomeTemplateTextCache) {
    welcomeTemplateTextCache = new Set(WELCOME_TEMPLATE_TEXT_CONTENTS.map((template) => stripHtml(template)));
  }
  return welcomeTemplateTextCache.has(text);
}

function removeWelcomeTaskItemTypes(content: string): string {
  return content.replace(/<li data-type="taskItem" data-checked="(true|false)">/g, '<li data-checked="$1">');
}

function stripWelcomeTaskListAttrs(content: string): string {
  return content
    .replace('<ul data-type="taskList">\n', '<ul>\n')
    .replace(/<li data-type="taskItem" data-checked="(?:true|false)">/g, '<li>');
}

async function ensureSampleNotes(options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  const now = Date.now();
  for (const [index, sample] of SAMPLE_NOTES.entries()) {
    const existing = await database.notes.get(sample.id);
    if (existing) {
      continue;
    }
    await database.notes.put(
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
  const content = sanitizeNoteContent(input?.content ?? '<p></p>');
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
    remoteRevision: input?.remoteRevision,
  };
}

export function createImageAttachmentDraft(input: Partial<ImageAttachment> & Pick<ImageAttachment, 'noteId' | 'data'>): ImageAttachment {
  const now = Date.now();
  return {
    id: input.id ?? nanoid(),
    noteId: input.noteId,
    data: input.data,
    mimeType: input.mimeType || 'application/octet-stream',
    storagePath: input.storagePath,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    deletedAt: input.deletedAt ?? null,
    syncStatus: input.syncStatus ?? 'local',
    lastSyncedAt: input.lastSyncedAt ?? null,
    version: input.version ?? 1,
    remoteRevision: input.remoteRevision,
    retainedForHistory: input.retainedForHistory,
    historyOnly: input.historyOnly,
  };
}

export async function createNote(input?: Partial<Note>, options?: DatabaseOptions): Promise<Note> {
  const database = options?.database ?? db;
  const note = createNoteDraft(input);
  await database.transaction('rw', database.notes, database.syncQueue, async () => {
    await database.notes.add({ ...note, syncStatus: 'pending' });
    await enqueueSync('note', note.id, 'upsert', { database });
  });
  return note;
}

export async function upsertNote(input: Partial<Note>, options?: SyncWriteOptions): Promise<Note> {
  const database = options?.database ?? db;
  const enqueue = options?.enqueueSync ?? true;
  let note = createNoteDraft(input);
  await database.transaction('rw', database.notes, database.syncQueue, async () => {
    const existing = await database.notes.get(note.id);
    note = createNoteDraft({ ...existing, ...input, id: note.id,
      version: enqueue ? Math.max(input.version ?? 1, (existing?.version ?? 0) + 1) : input.version,
    });
    await database.notes.put(enqueue ? { ...note, syncStatus: 'pending' } : note);
    if (enqueue) {
      await enqueueSync('note', note.id, 'upsert', { database });
    }
  });
  return note;
}

export async function updateNote(id: string, changes: Partial<Note>, options?: SyncWriteOptions): Promise<void> {
  const database = options?.database ?? db;
  const enqueue = options?.enqueueSync ?? true;
  const content = changes.content === undefined ? undefined : sanitizeNoteContent(changes.content);
  const nextUpdatedAt = changes.updatedAt ?? Date.now();
  await database.transaction('rw', [database.notes, database.images, database.syncQueue, database.tombstones, database.noteHistory, database.drafts, database.editorDrafts], async () => {
    const existing = await database.notes.get(id);
    if (!existing) {
      throw new Error('This note no longer exists in its original workspace.');
    }
    await database.notes.update(id, {
      ...changes,
      ...(content === undefined ? {} : { content }),
      rawContent: content === undefined ? (changes.rawContent ?? existing.rawContent) : stripHtml(content),
      updatedAt: nextUpdatedAt,
      syncStatus: enqueue ? 'pending' : (changes.syncStatus ?? existing?.syncStatus ?? 'local'),
      version: enqueue ? Math.max(changes.version ?? 1, (existing.version ?? 0) + 1) : (changes.version ?? existing.version),
    });
    if (enqueue) {
      await enqueueSync('note', id, 'upsert', { database });
    }
    if (enqueue && content !== undefined) {
      const restoredContent = await markDetachedAttachmentsDeleted(id, content, nextUpdatedAt, { database });
      if (restoredContent !== content) {
        await database.notes.update(id, { content: restoredContent, rawContent: stripHtml(restoredContent) });
        await enqueueSync('note', id, 'upsert', { database });
      }
    }
  });
}

export async function createImageAttachment(input: Partial<ImageAttachment> & Pick<ImageAttachment, 'noteId' | 'data'>, options?: DatabaseOptions): Promise<ImageAttachment> {
  const database = options?.database ?? db;
  const attachment = createImageAttachmentDraft(input);
  await database.transaction('rw', database.images, database.syncQueue, async () => {
    await database.images.put({ ...attachment, syncStatus: 'pending' });
    await enqueueSync('attachment', attachment.id, 'upsert', { database });
  });
  return attachment;
}

export async function updateImageAttachment(
  id: string,
  changes: Partial<ImageAttachment>,
  options?: SyncWriteOptions,
): Promise<void> {
  const database = options?.database ?? db;
  const enqueue = options?.enqueueSync ?? true;
  const nextUpdatedAt = changes.updatedAt ?? Date.now();
  await database.transaction('rw', database.images, database.syncQueue, database.tombstones, async () => {
    const existing = await database.images.get(id);
    if (!existing) {
      throw new Error('This attachment no longer exists in its original workspace.');
    }
    if (existing.historyOnly && changes.data !== undefined && changes.data !== existing.data) {
      throw new Error('Saved historical attachment bytes are immutable. Create a fresh attachment for replacement.');
    }
    await database.images.update(id, {
      ...changes,
      updatedAt: nextUpdatedAt,
      storagePath: changes.storagePath ?? (changes.data ? undefined : existing?.storagePath),
      syncStatus: enqueue ? 'pending' : (changes.syncStatus ?? existing?.syncStatus ?? 'local'),
      version: enqueue ? Math.max(changes.version ?? 1, (existing.version ?? 0) + 1) : (changes.version ?? existing.version),
    });
    if (enqueue) {
      if (changes.deletedAt) {
        await putTombstone('attachment', id, changes.deletedAt, existing.remoteRevision, database);
      }
      await enqueueSync('attachment', id, changes.deletedAt ? 'delete' : 'upsert', { database });
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
    remoteRevision: input?.remoteRevision,
  };
}

export async function ensureDefaultFolders(options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  await database.transaction('rw', database.folders, database.notes, async () => {
    for (const folder of DEFAULT_FOLDERS) {
      const existing = await database.folders.get(folder.id);
      if (!existing) {
        await database.folders.put(folder);
      }
    }
    await database.notes
      .filter((note) => !note.folderId)
      .modify((note) => {
        note.folderId = DEFAULT_FOLDER_ID;
      });
  });
}

export async function createFolder(name = '新建文件夹', options?: DatabaseOptions): Promise<Folder> {
  const database = options?.database ?? db;
  const maxSortFolder = await database.folders.orderBy('sortOrder').last();
  const folder = createFolderDraft({
    name,
    sortOrder: (maxSortFolder?.sortOrder ?? 0) + 1,
  });
  await database.transaction('rw', database.folders, database.syncQueue, async () => {
    await database.folders.add({ ...folder, syncStatus: 'pending' });
    await enqueueSync('folder', folder.id, 'upsert', { database });
  });
  return folder;
}

export async function upsertFolder(input: Partial<Folder>, options?: SyncWriteOptions): Promise<Folder> {
  const database = options?.database ?? db;
  const enqueue = options?.enqueueSync ?? true;
  let folder = createFolderDraft(input);
  await database.transaction('rw', database.folders, database.syncQueue, async () => {
    const existing = await database.folders.get(folder.id);
    folder = createFolderDraft({ ...existing, ...input, id: folder.id,
      version: enqueue ? Math.max(input.version ?? 1, (existing?.version ?? 0) + 1) : input.version,
    });
    await database.folders.put(enqueue ? { ...folder, syncStatus: 'pending' } : folder);
    if (enqueue) {
      await enqueueSync('folder', folder.id, 'upsert', { database });
    }
  });
  return folder;
}

export async function renameFolder(id: string, name: string, options?: SyncWriteOptions): Promise<void> {
  const database = options?.database ?? db;
  const nextName = name.trim();
  if (!nextName) {
    return;
  }
  const enqueue = options?.enqueueSync ?? true;
  await database.transaction('rw', database.folders, database.syncQueue, async () => {
    const existing = await database.folders.get(id);
    if (!existing) {
      throw new Error('This folder no longer exists in its original workspace.');
    }
    await database.folders.update(id, {
      name: nextName,
      updatedAt: Date.now(),
      syncStatus: enqueue ? 'pending' : (existing?.syncStatus ?? 'local'),
      version: (existing?.version ?? 0) + 1,
    });
    if (enqueue) {
      await enqueueSync('folder', id, 'upsert', { database });
    }
  });
}

export async function deleteFolder(id: string, targetFolderId = DEFAULT_FOLDER_ID, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  if (id === DEFAULT_FOLDER_ID) {
    return;
  }
  await database.transaction('rw', database.folders, database.notes, database.syncQueue, database.tombstones, async () => {
    const now = Date.now();
    const existing = await database.folders.get(id);
    const moved = await database.notes.where('folderId').equals(id).toArray();
    await database.notes.where('folderId').equals(id).modify((note) => {
      note.folderId = targetFolderId;
      note.updatedAt = now;
      note.syncStatus = 'pending';
      note.version = (note.version ?? 0) + 1;
    });
    await enqueueSync('folder', id, 'delete', { database });
    await putTombstone('folder', id, now, existing?.remoteRevision, database);
    await database.folders.delete(id);
    for (const note of moved) {
      await enqueueSync('note', note.id, 'upsert', { database });
    }
  });
}

export async function deleteFolderLocally(id: string, targetFolderId = DEFAULT_FOLDER_ID, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  if (id === DEFAULT_FOLDER_ID) {
    return;
  }
  await database.transaction('rw', database.folders, database.notes, async () => {
    await database.notes.where('folderId').equals(id).modify((note) => {
      note.folderId = targetFolderId;
    });
    await database.folders.delete(id);
  });
}

export async function moveNoteToFolder(noteId: string, folderId: string, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  await updateNote(noteId, { folderId }, { database });
}

export async function softDeleteNote(id: string, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  await database.transaction('rw', database.notes, database.syncQueue, async () => {
    const existing = await database.notes.get(id);
    await database.notes.update(id, {
      deletedAt: Date.now(),
      pinned: false,
      updatedAt: Date.now(),
      syncStatus: 'pending',
      version: (existing?.version ?? 0) + 1,
    });
    await enqueueSync('note', id, 'upsert', { database });
  });
}

export async function restoreNote(id: string, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  await database.transaction('rw', database.notes, database.syncQueue, async () => {
    const existing = await database.notes.get(id);
    await database.notes.update(id, {
      deletedAt: null,
      updatedAt: Date.now(),
      syncStatus: 'pending',
      version: (existing?.version ?? 0) + 1,
    });
    await enqueueSync('note', id, 'upsert', { database });
  });
}

export async function permanentlyDeleteNote(id: string, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  await database.transaction('rw', database.tables, async () => {
    // Another tab may still own uncommitted input. Preserve it independently before removing bytes.
    await recoverEditorDrafts(id, `local-purge:${nanoid()}`, { database, skipMatchingCommitted: true });
    const existing = await database.notes.get(id);
    const images = await database.images.where('noteId').equals(id).toArray();
    const now = Date.now();
    for (const image of images) {
      if (image.historyOnly && !image.storagePath && !(image.remoteRevision ?? 0)
        && !(await database.syncQueue.where('[entity+entityId]').equals(['attachment', image.id]).count())) {
        await database.images.delete(image.id);
        continue;
      }
      await database.images.put({
          ...image,
          data: '',
          deletedAt: now,
          updatedAt: now,
          syncStatus: 'pending',
          version: (image.version ?? 0) + 1,
        });
      await enqueueSync('attachment', image.id, 'delete', { database });
      await putTombstone('attachment', image.id, now, image.remoteRevision, database);
      await database.images.delete(image.id);
    }
    await enqueueSync('note', id, 'delete', { database,
      snapshot: existing ? { ...existing, content: '', rawContent: '', title: '', tags: [], deletedAt: now, version: (existing.version ?? 0) + 1 } : undefined,
    });
    await putTombstone('note', id, now, existing?.remoteRevision, database);
    await database.notes.delete(id);
    await database.drafts.delete(id);
    await database.editorDrafts.where('noteId').equals(id).delete();
    await database.noteHistory.where('noteId').equals(id).delete();
  });
  await removeLegacyNoteHistory(id, database);
}

export async function purgeExpiredTrash(options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = await database.notes.where('deletedAt').below(threshold).toArray();
  await Promise.all(expired.map((note) => permanentlyDeleteNote(note.id, { database })));
}

export async function markSynced(entity: SyncEntity, entityId: string, syncedAt = Date.now(), options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  const table = entityTable(entity, database);
  if (!table) {
    return;
  }
  await table.update(entityId, {
    syncStatus: 'synced',
    lastSyncedAt: syncedAt,
  });
}

export async function clearSyncQueueItem(id: string, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  await database.syncQueue.delete(id);
}

export async function saveDraft(draft: NoteDraftRecord, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  const cleanDraft = { ...draft, content: sanitizeNoteContent(draft.content) };
  await database.transaction('rw', database.drafts, async () => {
    const existing = await database.drafts.get(draft.noteId);
    if (existing && existing.revision > draft.revision) {
      return;
    }
    await database.drafts.put(cleanDraft);
  });
}

export async function getDraft(noteId: string, options?: DatabaseOptions): Promise<NoteDraftRecord | undefined> {
  const database = options?.database ?? db;
  return database.drafts.get(noteId);
}

export interface EditorDraftRecovery {
  draft?: NoteEditorDraftRecord;
  recoveredNoteIds: string[];
}

export function editorDraftId(noteId: string, editorId: string): string {
  if (!editorId.trim()) throw new Error('A persistent draft requires a unique editor ID.');
  return `${encodeURIComponent(noteId)}:${encodeURIComponent(editorId)}`;
}

export async function saveEditorDraft(draft: NoteDraftRecord, editorId: string, options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  const id = editorDraftId(draft.noteId, editorId);
  const cleanDraft: NoteEditorDraftRecord = { ...draft, content: sanitizeNoteContent(draft.content), id, editorId };
  await database.transaction('rw', database.editorDrafts, async () => {
    const existing = await database.editorDrafts.get(id);
    if (existing && existing.revision > draft.revision) return;
    if (existing?.revision === draft.revision) {
      if (existing.title !== cleanDraft.title || existing.content !== cleanDraft.content) {
        throw new Error('The same editor draft revision cannot represent different content.');
      }
      return;
    }
    // A newly edited candidate needs its own recovery copy, independent of the earlier generation.
    await database.editorDrafts.put({ ...cleanDraft, recoveredNoteId: undefined });
  });
}

export async function getEditorDrafts(noteId: string, options?: DatabaseOptions): Promise<NoteEditorDraftRecord[]> {
  const database = options?.database ?? db;
  return database.editorDrafts.where('noteId').equals(noteId).toArray();
}

export async function removeEditorDraft(noteId: string, editorId: string, expectedRevision?: number, options?: DatabaseOptions): Promise<boolean> {
  const database = options?.database ?? db;
  const id = editorDraftId(noteId, editorId);
  return database.transaction('rw', database.editorDrafts, async () => {
    const existing = await database.editorDrafts.get(id);
    if (!existing || (expectedRevision !== undefined && existing.revision !== expectedRevision)) return false;
    await database.editorDrafts.delete(id);
    return true;
  });
}

/** Other tabs keep ownership of their drafts. Recovery only creates visible, independent copies. */
export async function recoverEditorDrafts(noteId: string, editorId: string, options?: DatabaseOptions & { skipMatchingCommitted?: boolean }): Promise<EditorDraftRecovery> {
  return recoverDraftCandidates(noteId, editorId, options);
}

async function recoverDraftCandidates(
  noteId: string,
  editorId: string,
  options?: DatabaseOptions & { skipMatchingCommitted?: boolean },
  selection?: { editorDraftId?: string; legacyOnly?: boolean; skipLegacy?: boolean },
): Promise<EditorDraftRecovery> {
  const database = options?.database ?? db;
  return database.transaction('rw', database.tables, async () => {
    const allCandidates = await getEditorDrafts(noteId, { database });
    const own = allCandidates.find((candidate) => candidate.editorId === editorId);
    const candidates = selection?.legacyOnly ? [] : selection?.editorDraftId
      ? allCandidates.filter((candidate) => candidate.id === selection.editorDraftId) : allCandidates;
    const legacy = selection?.skipLegacy ? undefined : await database.drafts.get(noteId);
    const recoveredNoteIds: string[] = [];
    if ((!legacy || legacy.recoveredNoteId) && !candidates.some((candidate) => candidate.editorId !== editorId && !candidate.recoveredNoteId)) {
      return { draft: own, recoveredNoteIds };
    }
    const committedNote = await database.notes.get(noteId);
    const previous = committedNote ?? createNoteDraft({ id: noteId, folderId: DEFAULT_FOLDER_ID });
    const matchesCommitted = (candidate: NoteDraftRecord) => Boolean(options?.skipMatchingCommitted && committedNote
      && candidate.title.trim() === committedNote.title.trim() && sanitizeNoteContent(candidate.content) === committedNote.content);
    if (!(await database.folders.get(previous.folderId))) {
      await ensureDefaultFolders({ database });
      previous.folderId = DEFAULT_FOLDER_ID;
    }
    for (const candidate of candidates) {
      if (candidate.editorId === editorId || candidate.recoveredNoteId || matchesCommitted(candidate)) continue;
      const copy = await createLocalConflictCopy(previous, `${candidate.title.trim() || '未命名笔记'}（恢复的草稿）`, candidate.content, database);
      await database.editorDrafts.update(candidate.id, { recoveredNoteId: copy.id });
      recoveredNoteIds.push(copy.id);
    }
    if (legacy && !legacy.recoveredNoteId && !matchesCommitted(legacy)) {
      const copy = await createLocalConflictCopy(previous, `${legacy.title.trim() || '未命名笔记'}（恢复的草稿）`, legacy.content, database);
      await database.drafts.update(noteId, { recoveredNoteId: copy.id });
      recoveredNoteIds.push(copy.id);
    }
    return { draft: own, recoveredNoteIds };
  });
}

/** Include orphaned drafts whose original note was removed remotely while a tab was editing. */
export async function recoverAllEditorDrafts(editorId: string, options?: DatabaseOptions): Promise<{
  recoveredNoteIds: string[];
  errors: Array<{ noteId: string; message: string }>;
}> {
  const database = options?.database ?? db;
  const [current, legacy] = await Promise.all([database.editorDrafts.toArray(), database.drafts.toArray()]);
  const recoveredNoteIds: string[] = [];
  const errors: Array<{ noteId: string; message: string }> = [];
  const recoverCandidate = async (noteId: string, selection: { editorDraftId?: string; legacyOnly?: boolean; skipLegacy?: boolean }) => {
    try {
      const result = await recoverDraftCandidates(noteId, editorId, { database }, selection);
      recoveredNoteIds.push(...result.recoveredNoteIds);
    } catch (error) {
      errors.push({ noteId, message: error instanceof Error ? error.message : 'The draft could not be restored.' });
    }
  };
  // Each candidate owns a transaction, so one missing blob cannot hide another healthy editor.
  for (const candidate of current) {
    if (candidate.editorId !== editorId && !candidate.recoveredNoteId) {
      await recoverCandidate(candidate.noteId, { editorDraftId: candidate.id, skipLegacy: true });
    }
  }
  for (const candidate of legacy) {
    if (!candidate.recoveredNoteId) await recoverCandidate(candidate.noteId, { legacyOnly: true });
  }
  return { recoveredNoteIds, errors };
}

/** A delayed save cannot remove a newer persisted draft. */
export async function removeDraft(noteId: string, expectedRevision?: number, options?: DatabaseOptions): Promise<boolean> {
  const database = options?.database ?? db;
  return database.transaction('rw', database.drafts, async () => {
    const existing = await database.drafts.get(noteId);
    if (!existing || (expectedRevision !== undefined && existing.revision !== expectedRevision)) {
      return false;
    }
    await database.drafts.delete(noteId);
    return true;
  });
}

export async function addNoteHistory(history: NoteHistoryRecord, options?: DatabaseOptions & { force?: boolean }): Promise<void> {
  const database = options?.database ?? db;
  const cleanHistory = { ...history, content: sanitizeNoteContent(history.content) };
  await database.transaction('rw', [database.noteHistory, database.notes, database.images, database.drafts, database.editorDrafts, database.syncQueue, database.tombstones], async () => {
    const histories = await database.noteHistory.where('noteId').equals(history.noteId).sortBy('createdAt');
    const latest = histories.at(-1);
    if (latest && latest.title === cleanHistory.title && latest.content === cleanHistory.content) {
      return;
    }
    // The current note already contains the newest content. Keep the earlier version of this window.
    if (!options?.force && latest && cleanHistory.createdAt - latest.createdAt < 5 * 60 * 1000) {
      return;
    }
    cleanHistory.content = await historyContentWithRefs(cleanHistory.content, history.noteId, database);
    if (latest && latest.title === cleanHistory.title && latest.content === cleanHistory.content) return;
    await database.noteHistory.put(cleanHistory);
    const all = await database.noteHistory.where('noteId').equals(history.noteId).sortBy('createdAt');
    const discarded = all.slice(0, Math.max(0, all.length - 24));
    if (discarded.length) {
      await database.noteHistory.bulkDelete(discarded.map((entry) => entry.id));
      const note = await database.notes.get(history.noteId);
      await markDetachedAttachmentsDeleted(history.noteId, note?.content ?? '', Date.now(), { database, restoreAttachments: false });
    }
  });
}

/** Restore only this note's checked metadata; missing historical bytes never produce a partial restore. */
export async function hydrateNoteHistoryContent(content: string, noteId: string, options?: DatabaseOptions): Promise<string> {
  const database = options?.database ?? db;
  const safeContent = sanitizeNoteContent(content);
  const attachments = await database.images.where('noteId').equals(noteId).toArray();
  const bytesById = new Map(attachments.filter((attachment) => attachment.data).map((attachment) => [attachment.id, attachment]));
  const document = new DOMParser().parseFromString(safeContent, 'text/html');
  for (const element of document.querySelectorAll('[src], [href], [poster]')) {
    for (const attribute of ['src', 'href', 'poster']) {
      const id = attachmentIdFromRefUrl(element.getAttribute(attribute));
      if (!id) continue;
      const bytes = bytesById.get(id)?.data;
      if (!bytes) throw new Error('This saved version references missing attachment bytes. Restore a complete backup before applying it.');
      element.setAttribute(attribute, bytes);
      if (attribute !== 'poster') element.setAttribute('data-attachment-id', id);
    }
  }
  return sanitizeNoteContent(document.body.innerHTML);
}

/** Snapshot references point to deduplicated immutable bytes, rather than mutable current attachments. */
async function historyContentWithRefs(content: string, noteId: string, database: MarkNoteDatabase): Promise<string> {
  const attachments = await database.images.where('noteId').equals(noteId).toArray();
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const historyByData = new Map(attachments.filter((attachment) => attachment.historyOnly && attachment.data)
    .map((attachment) => [attachment.data, attachment]));
  const document = new DOMParser().parseFromString(content, 'text/html');
  let changed = false;
  for (const element of document.querySelectorAll('img[src], video[src], video[poster], audio[src], source[src], a[download][href], file-attachment[href]')) {
    for (const attribute of ['src', 'href', 'poster']) {
      const url = element.getAttribute(attribute);
      if (!url) continue;
      const sourceId = attachmentIdFromRefUrl(url) || (attribute === 'poster' ? '' : element.getAttribute('data-attachment-id')) || '';
      const source = byId.get(sourceId);
      const data = url.startsWith('data:') ? url : source?.data;
      if (!data) continue;
      let immutable = historyByData.get(data);
      if (!immutable) {
        immutable = createImageAttachmentDraft({ noteId, data, mimeType: dataUrlMimeType(data), sizeBytes: dataUrlSizeBytes(data),
          historyOnly: true, retainedForHistory: true, syncStatus: 'local', remoteRevision: 0 });
        await database.images.add(immutable);
        historyByData.set(data, immutable);
      }
      element.setAttribute(attribute, attachmentRefUrl(immutable.id));
      if (attribute !== 'poster') element.setAttribute('data-attachment-id', immutable.id);
      changed = true;
    }
  }
  return changed ? sanitizeNoteContent(document.body.innerHTML) : content;
}

export async function getNoteHistory(noteId: string, options?: DatabaseOptions): Promise<NoteHistoryRecord[]> {
  const database = options?.database ?? db;
  return (await database.noteHistory.where('noteId').equals(noteId).sortBy('createdAt')).reverse();
}

/** Copy legacy history once, retaining the original storage entry for recovery. */
export async function migrateLegacyNoteHistory(options?: DatabaseOptions): Promise<void> {
  const database = options?.database ?? db;
  if (database.name !== 'marknote' || typeof window === 'undefined') {
    return;
  }
  const markerId = 'legacy-note-history-copied';
  if (await database.localMetadata.get(markerId)) {
    return;
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem('marknote-note-snapshots');
  } catch {
    // IndexedDB still works when browser policy blocks localStorage; leave the source untouched.
    return;
  }
  if (!raw) {
    return;
  }
  const histories: NoteHistoryRecord[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Legacy note history could not be read; its original data has been retained.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Legacy note history has an unsupported format; its original data has been retained.');
  }
  for (const [noteId, snapshots] of Object.entries(parsed)) {
    if (!Array.isArray(snapshots)) {
      throw new Error('Legacy note history has an unsupported entry; its original data has been retained.');
    }
    for (const snapshot of snapshots) {
      if (!snapshot || typeof snapshot.id !== 'string' || typeof snapshot.title !== 'string'
        || typeof snapshot.content !== 'string' || !Number.isFinite(snapshot.createdAt)) {
        throw new Error('Legacy note history contains an invalid version; its original data has been retained.');
      }
      histories.push({ id: `legacy:${encodeURIComponent(noteId)}:${snapshot.id}`, noteId,
        title: snapshot.title, content: sanitizeNoteContent(snapshot.content), createdAt: snapshot.createdAt });
    }
  }
  await database.transaction('rw', database.tables, async () => {
    if (await database.localMetadata.get(markerId)) {
      return;
    }
    const byNoteId = new Map<string, NoteHistoryRecord[]>();
    for (const history of histories) {
      const entries = byNoteId.get(history.noteId) ?? [];
      entries.push(history);
      byNoteId.set(history.noteId, entries);
    }
    for (const [originalNoteId, entries] of byNoteId) {
      if (await database.notes.get(originalNoteId)) continue;
      // Startup recovery can run concurrently with migration. Save every candidate while
      // its original attachment IDs still resolve, before reassigning/removing old metadata.
      await recoverEditorDrafts(originalNoteId, `legacy-history-migration:${nanoid()}`, { database });
      const latest = [...entries].sort((a, b) => b.createdAt - a.createdAt)[0];
      // Never recreate a previously purged ID. Its old versions become a clearly named new note.
      const source = createNoteDraft({ id: originalNoteId });
      const recovered = await createLocalConflictCopy(source, `${latest.title.trim() || '未命名笔记'}（历史恢复）`, latest.content, database);
      for (const history of entries) {
        history.content = await hydrateNoteHistoryContent(history.content, originalNoteId, { database });
        history.noteId = recovered.id;
      }
      const originalAttachments = await database.images.where('noteId').equals(originalNoteId).toArray();
      for (const attachment of originalAttachments) {
        if (attachment.data) {
          if (!sanitizeContentUrl(attachment.data, 'file')) {
            throw new Error('A legacy historical attachment could not be restored safely. Its original data has been retained.');
          }
          const immutable = createImageAttachmentDraft({ id: nanoid(), noteId: recovered.id, data: attachment.data,
            mimeType: dataUrlMimeType(attachment.data), sizeBytes: dataUrlSizeBytes(attachment.data),
            historyOnly: true, retainedForHistory: true, syncStatus: 'local', remoteRevision: 0 });
          await database.images.add(immutable);
        }
        // Preserve old remote control metadata without leaving orphan business rows in backups.
        const queued = await database.syncQueue.where('[entity+entityId]').equals(['attachment', attachment.id]).first();
        if (queued && !queued.snapshot) await database.syncQueue.update(queued.id, { snapshot: attachment });
        await database.images.delete(attachment.id);
      }
    }
    for (const history of histories) history.content = await historyContentWithRefs(history.content, history.noteId, database);
    await database.noteHistory.bulkPut(histories);
    await database.localMetadata.put({ id: markerId, value: { count: histories.length, migratedAt: Date.now() } });
  });
}

async function putTombstone(entity: SyncEntity, entityId: string, deletedAt: number, remoteRevision: number | undefined, database: MarkNoteDatabase): Promise<void> {
  const id = `${entity}:${entityId}`;
  const existing = await database.tombstones.get(id);
  await database.tombstones.put({ id, entity, entityId, deletedAt, remoteRevision: remoteRevision ?? existing?.remoteRevision });
}

async function removeLegacyNoteHistory(noteId: string, database: MarkNoteDatabase): Promise<void> {
  if (database.name !== 'marknote' || typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem('marknote-note-snapshots');
    if (!raw) return;
    const snapshots: unknown = JSON.parse(raw);
    if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) {
      throw new Error('Unsupported legacy history format.');
    }
    if (!Object.prototype.hasOwnProperty.call(snapshots, noteId)) return;
    delete (snapshots as Record<string, unknown>)[noteId];
    window.localStorage.setItem('marknote-note-snapshots', JSON.stringify(snapshots));
  } catch {
    throw new Error('The note was deleted, but its older browser history could not be cleared. Browser storage needs attention.');
  }
}

export async function enqueueSync(entity: SyncEntity, entityId: string, operation: SyncOperation, options?: DatabaseOptions & { snapshot?: Folder | Note | ImageAttachment; baseRemoteRevision?: number }): Promise<void> {
  const database = options?.database ?? db;
  const now = Date.now();
  const existing = await database.syncQueue.where('[entity+entityId]').equals([entity, entityId]).first();
  const snapshot = options?.snapshot ?? await entityTable(entity, database)?.get(entityId);
  const mutation = {
    operation,
    updatedAt: now,
    mutationId: nanoid(),
    localRevision: snapshot?.version ?? ((existing?.localRevision ?? 0) + 1),
    baseRemoteRevision: options?.baseRemoteRevision ?? snapshot?.remoteRevision ?? existing?.baseRemoteRevision ?? 0,
    snapshot,
    attempts: 0,
    lastError: undefined,
  };
  if (existing) {
    await database.syncQueue.update(existing.id, mutation);
    return;
  }

  await database.syncQueue.put({
    id: nanoid(),
    entity,
    entityId,
    createdAt: now,
    ...mutation,
  });
}

async function markDetachedAttachmentsDeleted(noteId: string, content: string, deletedAt: number, options?: DatabaseOptions & { restoreAttachments?: boolean }): Promise<string> {
  const database = options?.database ?? db;
  const attachedIds = extractAttachmentIds(content);
  const history = await database.noteHistory.where('noteId').equals(noteId).toArray();
  const draft = await database.drafts.get(noteId);
  const editorDrafts = await database.editorDrafts.where('noteId').equals(noteId).toArray();
  const historyIds = new Set(history.flatMap((entry) => [...extractAttachmentIds(entry.content)]));
  // A newer draft can still be using a blob that an older save has detached.
  if (draft) for (const id of extractAttachmentIds(draft.content)) historyIds.add(id);
  for (const editorDraft of editorDrafts) for (const id of extractAttachmentIds(editorDraft.content)) historyIds.add(id);
  const attachments = await database.images.where('noteId').equals(noteId).toArray();
  const replacements = new Map<string, string>();
  for (const attachment of attachments) {
    if (attachedIds.has(attachment.id)) {
      if (attachment.historyOnly && attachment.data && options?.restoreAttachments !== false) {
        const restored = createImageAttachmentDraft({ ...attachment, id: nanoid(), storagePath: undefined, deletedAt: null,
          remoteRevision: 0, historyOnly: false, retainedForHistory: false, syncStatus: 'pending', updatedAt: deletedAt, version: 1 });
        await database.images.put(restored);
        await enqueueSync('attachment', restored.id, 'upsert', { database });
        replacements.set(attachment.id, restored.id);
        continue;
      }
      if (attachment.deletedAt && attachment.data && options?.restoreAttachments !== false) {
        // A confirmed remote purge cannot reuse its ID. Restore bytes as a fresh attachment.
        const restored = createImageAttachmentDraft({ ...attachment, id: nanoid(), deletedAt: null, storagePath: undefined,
          remoteRevision: 0, retainedForHistory: false, historyOnly: false, syncStatus: 'pending', updatedAt: deletedAt, version: 1 });
        await database.images.put(restored);
        await enqueueSync('attachment', restored.id, 'upsert', { database });
        await database.images.update(attachment.id, { retainedForHistory: true });
        replacements.set(attachment.id, restored.id);
      } else if (attachment.retainedForHistory) {
        await database.images.update(attachment.id, { retainedForHistory: false });
      }
      continue;
    }
    if (historyIds.has(attachment.id)) {
      await database.images.update(attachment.id, { retainedForHistory: true });
      continue;
    }
    if (attachment.deletedAt && !attachment.retainedForHistory) {
      continue;
    }
    if (attachment.historyOnly && !attachment.storagePath) {
      // Unused local-only history blobs have no remote deletion to send.
      await database.images.delete(attachment.id);
      continue;
    }
    await database.images.put({
      ...attachment,
      data: '',
      deletedAt,
      updatedAt: deletedAt,
      syncStatus: 'pending',
      version: (attachment.version ?? 0) + 1,
      retainedForHistory: false,
    });
    await enqueueSync('attachment', attachment.id, 'delete', { database });
    await putTombstone('attachment', attachment.id, deletedAt, attachment.remoteRevision, database);
  }
  if (!replacements.size) return content;
  const document = new DOMParser().parseFromString(content, 'text/html');
  for (const element of document.querySelectorAll('[data-attachment-id], [src], [href], [poster]')) {
    const oldId = element.getAttribute('data-attachment-id') || '';
    const newId = replacements.get(oldId);
    if (newId) element.setAttribute('data-attachment-id', newId);
    for (const attribute of ['src', 'href', 'poster']) {
      const value = element.getAttribute(attribute);
      const restoredId = replacements.get(attachmentIdFromRefUrl(value));
      if (restoredId) {
        element.setAttribute(attribute, `marknote-attachment://${encodeURIComponent(restoredId)}`);
        element.setAttribute('data-attachment-id', restoredId);
      }
    }
  }
  return document.body.innerHTML;
}

function extractAttachmentIds(content: string): Set<string> {
  if (!content) {
    return new Set();
  }
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const ids = new Set(
    Array.from(doc.querySelectorAll('[data-attachment-id]'))
      .map((element) => element.getAttribute('data-attachment-id') || '')
      .filter(Boolean),
  );
  for (const element of doc.querySelectorAll('[src], [href], [poster]')) {
    for (const attribute of ['src', 'href', 'poster']) {
      const id = attachmentIdFromRefUrl(element.getAttribute(attribute));
      if (id) ids.add(id);
    }
  }
  return ids;
}

function entityTable(entity: SyncEntity, database = db): Table<Folder | Note | ImageAttachment, string> | null {
  if (entity === 'folder') {
    return database.folders as Table<Folder | Note | ImageAttachment, string>;
  }
  if (entity === 'note') {
    return database.notes as Table<Folder | Note | ImageAttachment, string>;
  }
  if (entity === 'attachment') {
    return database.images as Table<Folder | Note | ImageAttachment, string>;
  }
  return null;
}
