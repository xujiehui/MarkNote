import Dexie, { type Table } from 'dexie';
import { nanoid } from 'nanoid';
import type { ImageAttachment, Note } from '../types';
import { stripHtml } from './html';

class MarkNoteDatabase extends Dexie {
  notes!: Table<Note, string>;
  images!: Table<ImageAttachment, string>;

  constructor() {
    super('marknote');
    this.version(1).stores({
      notes: '&id, updatedAt, createdAt, pinned, deletedAt, *tags',
      images: '&id, noteId',
    });
  }
}

export const db = new MarkNoteDatabase();

export const DEFAULT_TAGS = ['工作', '个人', '代码片段'];

const WELCOME_CONTENT = `<h2>欢迎使用 MarkNote</h2>
<p>这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用。你可以拖拽或粘贴图片，也可以使用工具栏插入代码块。</p>
<pre><code class="language-javascript">const note = 'Write once, keep everywhere';
console.log(note);</code></pre>`;

const WELCOME_NOTE_ID = 'marknote-welcome-note';

export async function ensureSeedNote(): Promise<string> {
  const welcome = await db.notes.get(WELCOME_NOTE_ID);
  if (welcome) {
    return welcome.id;
  }

  const count = await db.notes.count();
  if (count > 0) {
    const first = await db.notes.orderBy('updatedAt').reverse().first();
    return first?.id || '';
  }

  const note = createNoteDraft({
    id: WELCOME_NOTE_ID,
    title: '欢迎使用 MarkNote',
    content: WELCOME_CONTENT,
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
