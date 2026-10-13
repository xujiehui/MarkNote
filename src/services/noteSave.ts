import { nanoid } from 'nanoid';
import { addNoteHistory, createNoteDraft, db, getEditorDrafts, removeEditorDraft, saveEditorDraft, recoverEditorDrafts, recoverAllEditorDrafts, updateNote } from '../lib/db';
import { cloneNoteAttachments, createLocalConflictCopy } from '../lib/cloneNoteAttachments';
import type { Note } from '../types';

export interface NoteDraftSnapshot {
  noteId: string;
  title: string;
  content: string;
  revision: number;
  updatedAt: number;
  baseVersion?: number;
}

export interface NoteSaveStore {
  persistDraft(snapshot: NoteDraftSnapshot): Promise<void>;
  readDraft(noteId: string): Promise<NoteDraftSnapshot | undefined>;
  commitDraft(snapshot: NoteDraftSnapshot): Promise<{ noteId: string; version: number } | void>;
  recoverAll?(): Promise<void>;
}

export type NoteSaveEvent =
  | { state: 'saving' | 'saved'; snapshot: NoteDraftSnapshot; savedNoteId?: string; savedVersion?: number }
  | { state: 'error'; snapshot: NoteDraftSnapshot; error: unknown };

/** Owns drafts independently of component lifetimes and serializes durable writes. */
export class NoteSaveCoordinator {
  private pending = new Map<string, NoteDraftSnapshot>();
  private tail: Promise<void> = Promise.resolve();
  private revision = Date.now();

  constructor(private readonly store: NoteSaveStore, private readonly onEvent?: (event: NoteSaveEvent) => void) {}

  stage(noteId: string, title: string, content: string, baseVersion?: number): NoteDraftSnapshot {
    const snapshot = { noteId, title, content, revision: ++this.revision, updatedAt: Date.now(), baseVersion: this.pending.get(noteId)?.baseVersion ?? baseVersion };
    this.pending.set(noteId, snapshot);
    this.onEvent?.({ state: 'saving', snapshot });
    void this.enqueue(async () => {
      try {
        await this.store.persistDraft(snapshot);
      } catch (error) {
        this.onEvent?.({ state: 'error', snapshot, error });
        throw error;
      }
    }).catch(() => undefined);
    return snapshot;
  }

  async recoverAll(): Promise<void> { await this.store.recoverAll?.(); }

  async recover(noteId: string): Promise<NoteDraftSnapshot | undefined> {
    const existing = this.pending.get(noteId);
    if (existing) return existing;
    const recovered = await this.store.readDraft(noteId);
    if (!recovered) return undefined;
    // Reading disk must never replace edits made while the read was pending.
    if (this.pending.has(noteId)) return this.pending.get(noteId);
    this.revision = Math.max(this.revision, recovered.revision);
    this.pending.set(noteId, recovered);
    return recovered;
  }

  pendingDrafts(): NoteDraftSnapshot[] { return [...this.pending.values()].map((draft) => ({ ...draft })); }

  hasPending(noteId?: string): boolean {
    return noteId ? this.pending.has(noteId) : this.pending.size > 0;
  }

  async flush(noteId: string): Promise<void> {
    while (this.pending.has(noteId)) {
      const snapshot = this.pending.get(noteId)!;
      await this.enqueue(async () => {
        try {
          // Retry persistence as well as commit after an earlier quota/transient failure.
          await this.store.persistDraft(snapshot);
          const result = await this.store.commitDraft(snapshot);
          if (this.pending.get(noteId)?.revision === snapshot.revision) {
            this.pending.delete(noteId);
            this.onEvent?.({ state: 'saved', snapshot, savedNoteId: result?.noteId, savedVersion: result?.version });
          }
        } catch (error) {
          this.onEvent?.({ state: 'error', snapshot, error });
          throw error;
        }
      });
    }
  }

  async flushAll(): Promise<void> {
    while (this.pending.size) {
      for (const noteId of [...this.pending.keys()]) await this.flush(noteId);
    }
    await this.tail;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.tail.then(operation, operation);
    this.tail = task.catch(() => undefined);
    return task;
  }
}

export function createDatabaseSaveStore(database = db, onRecovered?: (noteIds: string[]) => void): NoteSaveStore {
  const editorId = nanoid();
  const committed = new Map<string, { noteId: string; version: number }>();
  const originalMetadata = new Map<string, Partial<Note>>();
  return {
    persistDraft: async (snapshot) => {
      if (!originalMetadata.has(snapshot.noteId)) {
        const note = await database.notes.get(snapshot.noteId);
        if (note) originalMetadata.set(note.id, { id: note.id, folderId: note.folderId, tags: [...note.tags], pinned: note.pinned });
      }
      await saveEditorDraft(snapshot, editorId, { database });
    },
    recoverAll: async () => {
      const result = await recoverAllEditorDrafts(editorId, { database });
      if (result.recoveredNoteIds.length) onRecovered?.(result.recoveredNoteIds);
      if (result.errors.length) throw new Error(`${result.errors.length} draft(s) could not be fully recovered. Export a recovery file before repairing missing attachments.`);
    },
    readDraft: async (noteId) => { const result = await recoverEditorDrafts(noteId, editorId, { database }); if (result.recoveredNoteIds.length) onRecovered?.(result.recoveredNoteIds); return result.draft; },
    commitDraft: async (snapshot) => {
      const result = await database.transaction('rw', database.tables, async () => {
        const ownCommit = committed.get(snapshot.noteId);
        const ownedDraft = (await getEditorDrafts(snapshot.noteId, { database })).find((draft) => draft.editorId === editorId);
        const previous = await database.notes.get(ownCommit?.noteId || ownedDraft?.recoveredNoteId || snapshot.noteId);
        if (!previous) {
          const original = createNoteDraft({ ...originalMetadata.get(snapshot.noteId), id: snapshot.noteId });
          const copy = await createLocalConflictCopy(original, `${snapshot.title.trim() || 'Untitled'}（恢复副本）`, snapshot.content, database);
          await removeEditorDraft(snapshot.noteId, editorId, snapshot.revision, { database });
          return { noteId: copy.id, version: copy.version || 1 };
        }
        const content = previous.id === snapshot.noteId ? snapshot.content : await cloneNoteAttachments(snapshot.noteId, previous.id, snapshot.content, database);
        const expectedVersion = !ownCommit && ownedDraft?.recoveredNoteId
          ? previous.version
          : ownCommit?.noteId === snapshot.noteId
          ? Math.max(ownCommit.version, snapshot.baseVersion ?? 0)
          : ownCommit?.version ?? snapshot.baseVersion;
        if (expectedVersion !== undefined && previous.version !== expectedVersion) {
          const copy = await createLocalConflictCopy(previous, `${snapshot.title.trim() || 'Untitled'}（冲突副本）`, content, database);
          await addNoteHistory({ id: `${copy.id}-${snapshot.revision}`, noteId: copy.id, title: copy.title, content: copy.content, createdAt: Date.now() }, { database });
          await removeEditorDraft(snapshot.noteId, editorId, snapshot.revision, { database });
          const result = { noteId: copy.id, version: copy.version || 1 };
          return result;
        }
        await addNoteHistory({ id: `${previous.id}-before-${previous.version || previous.updatedAt}`, noteId: previous.id, title: previous.title, content: previous.content, createdAt: previous.updatedAt }, { database });
        await updateNote(previous.id, {
          title: snapshot.title.trim() || 'Untitled',
          content,
          updatedAt: Date.now(),
        }, { database });
        await addNoteHistory({
          id: `${snapshot.noteId}-${snapshot.revision}`,
          noteId: previous.id,
          title: snapshot.title.trim() || 'Untitled',
          content,
          createdAt: Date.now(),
        }, { database });
        await removeEditorDraft(snapshot.noteId, editorId, snapshot.revision, { database });
        const result = { noteId: previous.id, version: (await database.notes.get(previous.id))!.version || 1 };
        return result;
      });
      committed.set(snapshot.noteId, result);
      return result;
    },
  };
}
