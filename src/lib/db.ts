import Dexie, { type Table } from 'dexie';
import { nanoid } from 'nanoid';
import type { Folder, ImageAttachment, Note } from '../types';
import { stripHtml } from './html';

class MarkNoteDatabase extends Dexie {
  folders!: Table<Folder, string>;
  notes!: Table<Note, string>;
  images!: Table<ImageAttachment, string>;

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
  }
}

export const db = new MarkNoteDatabase();

export const DEFAULT_TAGS = ['工作', '个人', '代码片段'];
export const DEFAULT_FOLDER_ID = 'folder-library';
export const CODE_FOLDER_ID = 'folder-code-snippets';
export const ARCHIVE_FOLDER_ID = 'folder-archive';

const DEFAULT_FOLDERS: Folder[] = [
  createFolderDraft({ id: DEFAULT_FOLDER_ID, name: '资料库', sortOrder: 0 }),
  createFolderDraft({ id: CODE_FOLDER_ID, name: '代码片段', sortOrder: 1 }),
  createFolderDraft({ id: ARCHIVE_FOLDER_ID, name: '归档', sortOrder: 2 }),
];

const WELCOME_CONTENT = `<h2>欢迎使用 MarkNote</h2>
<p>这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用。你可以拖拽或粘贴图片，也可以使用工具栏插入代码块。</p>
<pre><code class="language-javascript">const note = 'Write once, keep everywhere';
console.log(note);</code></pre>`;

const WELCOME_NOTE_ID = 'marknote-welcome-note';

export async function ensureSeedNote(): Promise<string> {
  await ensureDefaultFolders();

  const welcome = await db.notes.get(WELCOME_NOTE_ID);
  if (welcome) {
    if (!welcome.folderId) {
      await db.notes.update(welcome.id, { folderId: DEFAULT_FOLDER_ID });
    }
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
    tags: ['个人', '代码片段'],
    pinned: true,
  });
  await db.notes.put(note);
  return note.id;
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
  };
}

export async function createNote(input?: Partial<Note>): Promise<Note> {
  const note = createNoteDraft(input);
  await db.notes.add(note);
  return note;
}

export async function upsertNote(input: Partial<Note>): Promise<Note> {
  const note = createNoteDraft(input);
  await db.notes.put(note);
  return note;
}

export async function updateNote(id: string, changes: Partial<Note>): Promise<void> {
  const content = changes.content;
  await db.notes.update(id, {
    ...changes,
    rawContent: content === undefined ? changes.rawContent : stripHtml(content),
    updatedAt: changes.updatedAt ?? Date.now(),
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
  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const nextName = name.trim();
  if (!nextName) {
    return;
  }
  await db.folders.update(id, {
    name: nextName,
    updatedAt: Date.now(),
  });
}

export async function deleteFolder(id: string, targetFolderId = DEFAULT_FOLDER_ID): Promise<void> {
  if (id === DEFAULT_FOLDER_ID) {
    return;
  }
  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.notes.where('folderId').equals(id).modify({ folderId: targetFolderId });
    await db.folders.delete(id);
  });
}

export async function moveNoteToFolder(noteId: string, folderId: string): Promise<void> {
  await updateNote(noteId, { folderId });
}

export async function softDeleteNote(id: string): Promise<void> {
  await db.notes.update(id, {
    deletedAt: Date.now(),
    pinned: false,
    updatedAt: Date.now(),
  });
}

export async function restoreNote(id: string): Promise<void> {
  await db.notes.update(id, {
    deletedAt: null,
    updatedAt: Date.now(),
  });
}

export async function permanentlyDeleteNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.images, async () => {
    await db.images.where('noteId').equals(id).delete();
    await db.notes.delete(id);
  });
}

export async function purgeExpiredTrash(): Promise<void> {
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = await db.notes.where('deletedAt').below(threshold).toArray();
  await Promise.all(expired.map((note) => permanentlyDeleteNote(note.id)));
}
