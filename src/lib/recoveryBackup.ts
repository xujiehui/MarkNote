import { saveAs } from 'file-saver';
import { nanoid } from 'nanoid';
import type { Folder, ImageAttachment, Note, NoteDraftRecord, NoteEditorDraftRecord, NoteHistoryRecord } from '../types';
import { attachmentIdFromRefUrl } from './attachmentContent';
import { db, DEFAULT_FOLDER_ID, getWorkspaceEpoch, isWorkspaceCurrent, type MarkNoteDatabase } from './db';
import { stripHtml } from './html';
import { sanitizeContentUrl, sanitizeNoteContent, type ContentUrlKind } from './sanitizeContent';

export interface RecoveryDraftInput {
  noteId: string;
  title: string;
  content: string;
  revision?: number;
  updatedAt?: number;
  baseVersion?: number;
}

interface RawRecoveryDraft extends RecoveryDraftInput {
  id?: string;
  editorId?: string;
  recoveredNoteId?: string;
}

export interface RecoveryPackage {
  format: 'marknote-emergency-recovery';
  version: 1;
  exportedAt: number;
  complete: false;
  warnings: string[];
  /** Legacy-importable, safe standalone copies. The raw repair sources below are never rendered. */
  notes: Note[];
  recovery: {
    version: 1;
    notes: Partial<Note>[];
    folders: Partial<Folder>[];
    attachments: Partial<ImageAttachment>[];
    history: NoteHistoryRecord[];
    legacyDrafts: RawRecoveryDraft[];
    editorDrafts: RawRecoveryDraft[];
    memoryDrafts: RawRecoveryDraft[];
    missingMediaCount: number;
    externalMediaCount: number;
  };
}

/** Read-only rescue does not recover, flush, consume, mark or modify any draft. */
export async function createRecoveryPackage(database: MarkNoteDatabase, inMemoryDrafts: readonly RecoveryDraftInput[] = []): Promise<RecoveryPackage> {
  const epoch = getWorkspaceEpoch();
  if (database !== db) throw new Error('恢复导出空间已切换，请重新开始。');
  const memoryDrafts = inMemoryDrafts.map(pickDraft);
  const snapshot = await database.transaction('r', [database.notes, database.folders, database.images, database.noteHistory, database.drafts, database.editorDrafts], async () => {
    const [notes, folders, attachments, history, legacyDrafts, editorDrafts] = await Promise.all([
      database.notes.toArray(), database.folders.toArray(), database.images.toArray(), database.noteHistory.toArray(), database.drafts.toArray(), database.editorDrafts.toArray(),
    ]);
    return { notes, folders, attachments, history, legacyDrafts, editorDrafts };
  });
  if (!isWorkspaceCurrent(epoch)) throw new Error('恢复导出期间空间已切换，请重新开始。');
  const attachments = new Map(snapshot.attachments.map((attachment) => [attachment.id, attachment]));
  const counts = { missingMediaCount: 0, externalMediaCount: 0 };
  const sourceNotes = new Map(snapshot.notes.map((note) => [note.id, note]));
  const notes = snapshot.notes.map((note) => safeRecoveryNote(note.title, note.content, note.id, note, attachments, counts));
  // Source records are deliberately kept distinct: timestamps and even identical contents
  // do not establish that another editor's or an orphaned draft is expendable.
  const appendDrafts = (drafts: readonly RecoveryDraftInput[], label: string) => {
    for (const draft of drafts) notes.push(safeRecoveryNote(`${draft.title || '未命名笔记'}（${label}）`, draft.content, draft.noteId, sourceNotes.get(draft.noteId), attachments, counts));
  };
  appendDrafts(snapshot.legacyDrafts, '旧版草稿应急恢复');
  appendDrafts(snapshot.editorDrafts, '编辑器草稿应急恢复');
  appendDrafts(memoryDrafts, '当前草稿应急恢复');
  const warnings = ['这是应急恢复文件，不是完整 V2 备份。可安全导入的笔记副本与未经修改的原始业务数据分别保留；原始 recovery 数据仅供修复，不会直接渲染。'];
  if (counts.missingMediaCount) warnings.push(`${counts.missingMediaCount} 个媒体引用缺少可恢复字节，导入副本使用明确占位说明；原始引用仍保存在 recovery 数据中。`);
  if (counts.externalMediaCount) warnings.push(`${counts.externalMediaCount} 个外部媒体引用保留为链接，断网时可能不可用。`);
  return {
    format: 'marknote-emergency-recovery', version: 1, complete: false, exportedAt: Date.now(), warnings, notes,
    recovery: {
      version: 1, notes: snapshot.notes.map(pickNote), folders: snapshot.folders.map(pickFolder), attachments: snapshot.attachments.map(pickAttachment),
      history: snapshot.history.map((history) => ({ id: history.id, noteId: history.noteId, title: history.title, content: history.content, createdAt: history.createdAt })),
      legacyDrafts: snapshot.legacyDrafts.map(pickDraft), editorDrafts: snapshot.editorDrafts.map(pickDraft), memoryDrafts,
      ...counts,
    },
  };
}

export async function exportRecoveryAsJson(database: MarkNoteDatabase, inMemoryDrafts: readonly RecoveryDraftInput[] = []): Promise<void> {
  const epoch = getWorkspaceEpoch();
  const payload = await createRecoveryPackage(database, inMemoryDrafts);
  if (database !== db || !isWorkspaceCurrent(epoch)) throw new Error('恢复导出期间空间已切换，请重新开始。');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  saveAs(blob, `marknote-recovery-${new Date().toISOString().slice(0, 10)}.json`);
}

function safeRecoveryNote(title: string, raw: string, sourceNoteId: string, metadata: Note | undefined, attachments: Map<string, ImageAttachment>, counts: { missingMediaCount: number; externalMediaCount: number }): Note {
  const doc = new DOMParser().parseFromString(sanitizeNoteContent(raw), 'text/html');
  doc.querySelectorAll('img, video, audio, source, a[download], file-attachment').forEach((element) => {
    if (!doc.body.contains(element)) return;
    const tag = element.tagName;
    const attributes = tag === 'VIDEO' ? ['src', 'poster'] : tag === 'A' || tag === 'FILE-ATTACHMENT' ? ['href'] : ['src'];
    for (const attribute of attributes) {
      const url = element.getAttribute(attribute) || '';
      if (attribute === 'poster' && !url) continue;
      if ((tag === 'VIDEO' || tag === 'AUDIO') && !url && element.querySelector('source[src]')) continue;
      const id = attachmentIdFromRefUrl(url) || (attribute === 'poster' ? '' : element.getAttribute('data-attachment-id')) || '';
      const attachment = attachments.get(id);
      const kind: ContentUrlKind = attribute === 'poster' || tag === 'IMG' ? 'image'
        : tag === 'VIDEO' || (tag === 'SOURCE' && element.parentElement?.tagName !== 'AUDIO') ? 'video'
          : tag === 'AUDIO' || tag === 'SOURCE' ? 'audio' : 'file';
      const stored = attachment?.noteId === sourceNoteId ? sanitizeContentUrl(attachment.data, kind) : null;
      const safe = sanitizeContentUrl(url, kind);
      if (url.startsWith('data:') && safe) continue;
      if (stored) {
        element.setAttribute(attribute, stored);
        continue;
      }
      if (safe && /^https?:/i.test(safe)) {
        counts.externalMediaCount += 1;
        continue;
      }
      counts.missingMediaCount += 1;
      const placeholder = doc.createElement('span');
      const description = element.getAttribute('alt') || element.getAttribute('filename') || element.getAttribute('download') || '附件';
      placeholder.textContent = `[媒体缺失：${description}；原始引用保存在应急恢复文件中]`;
      if (attribute === 'poster') {
        element.removeAttribute('poster');
        element.after(placeholder);
      } else {
        const target = tag === 'SOURCE' && ['VIDEO', 'AUDIO'].includes(element.parentElement?.tagName || '') ? element.parentElement! : element;
        target.replaceWith(placeholder);
        break;
      }
    }
  });
  doc.querySelectorAll('[data-attachment-id]').forEach((element) => element.removeAttribute('data-attachment-id'));
  const content = sanitizeNoteContent(doc.body.innerHTML);
  const now = Date.now();
  return {
    id: nanoid(), title, content, rawContent: stripHtml(content), folderId: DEFAULT_FOLDER_ID,
    tags: metadata?.tags ? [...metadata.tags] : [], pinned: metadata?.pinned || false,
    createdAt: metadata?.createdAt ?? now, updatedAt: now, deletedAt: null, syncStatus: 'local', version: 1, lastSyncedAt: null,
  };
}

function pickDraft(draft: RecoveryDraftInput | NoteDraftRecord | NoteEditorDraftRecord): RawRecoveryDraft {
  const metadata = draft as Partial<NoteEditorDraftRecord>;
  return {
    noteId: draft.noteId, title: draft.title, content: draft.content, revision: draft.revision, updatedAt: draft.updatedAt,
    baseVersion: draft.baseVersion,
    ...(typeof metadata.id === 'string' ? { id: metadata.id } : {}),
    ...(typeof metadata.editorId === 'string' ? { editorId: metadata.editorId } : {}),
    ...(typeof metadata.recoveredNoteId === 'string' ? { recoveredNoteId: metadata.recoveredNoteId } : {}),
  };
}

function pickNote(note: Note): Partial<Note> {
  return { id: note.id, title: note.title, content: note.content, rawContent: note.rawContent, folderId: note.folderId, createdAt: note.createdAt, updatedAt: note.updatedAt, tags: [...note.tags], pinned: note.pinned, deletedAt: note.deletedAt, version: note.version };
}

function pickFolder(folder: Folder): Partial<Folder> {
  return { id: folder.id, name: folder.name, createdAt: folder.createdAt, updatedAt: folder.updatedAt, sortOrder: folder.sortOrder, deletedAt: folder.deletedAt, version: folder.version };
}

function pickAttachment(attachment: ImageAttachment): Partial<ImageAttachment> {
  return { id: attachment.id, noteId: attachment.noteId, data: attachment.data, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, createdAt: attachment.createdAt, updatedAt: attachment.updatedAt, deletedAt: attachment.deletedAt, retainedForHistory: attachment.retainedForHistory };
}
