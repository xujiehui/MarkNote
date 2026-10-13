import { nanoid } from 'nanoid';
import type { ImageAttachment, Note } from '../types';
import { attachmentIdFromRefUrl, attachmentRefUrl, restoreAttachmentRefs } from './attachmentContent';
import { createFolder, createNote, createNoteDraft, DEFAULT_FOLDER_ID, enqueueSync, ensureDefaultFolders, type MarkNoteDatabase } from './db';
import { dataUrlMimeType, dataUrlSizeBytes } from './image';
import { sanitizeContentUrl, sanitizeNoteContent, type ContentUrlKind } from './sanitizeContent';

interface AttachmentTarget {
  element: Element;
  attribute: 'src' | 'href' | 'poster';
  sourceId: string;
  kind: ContentUrlKind;
}

/** A copied note owns independent bytes/IDs; purging its source cannot break it. */
export async function createLocalConflictCopy(previous: Note, title: string, content: string, database: MarkNoteDatabase): Promise<Note> {
  return database.transaction('rw', [database.folders, database.notes, database.images, database.syncQueue], async () => {
    const previousFolder = await database.folders.get(previous.folderId);
    let folderId = previous.folderId;
    if (!previousFolder || previousFolder.deletedAt) {
      await ensureDefaultFolders({ database });
      const fallback = await database.folders.get(DEFAULT_FOLDER_ID);
      folderId = fallback && !fallback.deletedAt ? DEFAULT_FOLDER_ID : (await createFolder('恢复的笔记本', { database })).id;
    }
    const draft = createNoteDraft({ title, content, folderId, tags: [...previous.tags], pinned: previous.pinned, remoteRevision: 0 });
    const copiedContent = await cloneNoteAttachments(previous.id, draft.id, content, database);
    return createNote({ ...draft, content: copiedContent, rawContent: undefined }, { database });
  });
}

/** May run inside a parent transaction; includes attachment writes and upload snapshots atomically. */
export async function cloneNoteAttachments(sourceNoteId: string, newNoteId: string, content: string, database: MarkNoteDatabase): Promise<string> {
  if (!sourceNoteId || !newNoteId || sourceNoteId === newNoteId) throw new Error('附件复制需要独立的目标笔记。');
  return database.transaction('rw', [database.images, database.syncQueue], async () => {
    const sourceAttachments = new Map((await database.images.where('noteId').equals(sourceNoteId).toArray()).map((attachment) => [attachment.id, attachment]));
    const targetAttachments = new Map((await database.images.where('noteId').equals(newNoteId).toArray()).map((attachment) => [attachment.id, attachment]));
    const doc = new DOMParser().parseFromString(sanitizeNoteContent(content), 'text/html');
    const targets = collectTargets(doc);
    const copies = new Map<string, ImageAttachment>();
    const newCopies: ImageAttachment[] = [];
    for (const target of targets) {
      const source = sourceAttachments.get(target.sourceId);
      const owned = targetAttachments.get(target.sourceId);
      const url = target.element.getAttribute(target.attribute) || '';
      // A staged old tab may contain older bytes than the current attachment record.
      const data = url.startsWith('data:') ? url : owned?.data || source?.data || '';
      if (!data || !sanitizeContentUrl(data, target.kind)) throw new Error('冲突草稿引用的附件字节缺失或不安全，请先导出草稿并恢复附件。');
      const existing = copies.get(target.sourceId);
      if (existing && existing.data !== data) throw new Error('冲突草稿包含同一附件的不同字节版本，请先导出草稿检查。');
      if (existing) continue;
      if (owned && !owned.deletedAt && owned.data === data) {
        copies.set(target.sourceId, owned);
        continue;
      }
      const now = Date.now();
      const copy: ImageAttachment = {
        id: nanoid(), noteId: newNoteId, data, mimeType: dataUrlMimeType(data), sizeBytes: dataUrlSizeBytes(data),
        createdAt: now, updatedAt: now, deletedAt: null, syncStatus: 'pending', lastSyncedAt: null,
        version: 1, remoteRevision: 0,
      };
      copies.set(target.sourceId, copy);
      newCopies.push(copy);
    }
    for (const copy of newCopies) {
      await database.images.add(copy);
      await enqueueSync('attachment', copy.id, 'upsert', { database });
    }
    for (const target of targets) {
      const copy = copies.get(target.sourceId)!;
      target.element.setAttribute(target.attribute, attachmentRefUrl(copy.id));
      if (target.attribute !== 'poster') target.element.setAttribute('data-attachment-id', copy.id);
    }
    return sanitizeNoteContent(restoreAttachmentRefs(doc.body.innerHTML, copies.values()));
  });
}

function collectTargets(doc: Document): AttachmentTarget[] {
  const targets: AttachmentTarget[] = [];
  doc.querySelectorAll('img[src], video[src], video[poster], audio[src], source[src], a[download][href], file-attachment[href]').forEach((element) => {
    for (const attribute of ['src', 'href', 'poster'] as const) {
      const url = element.getAttribute(attribute);
      if (!url) continue;
      const sourceId = attachmentIdFromRefUrl(url) || (attribute === 'poster' ? '' : element.getAttribute('data-attachment-id')) || '';
      if (!sourceId) continue;
      const kind: ContentUrlKind = attribute === 'poster' || element.tagName === 'IMG' ? 'image'
        : element.tagName === 'VIDEO' || (element.tagName === 'SOURCE' && element.parentElement?.tagName !== 'AUDIO') ? 'video'
          : element.tagName === 'AUDIO' || element.tagName === 'SOURCE' ? 'audio' : 'file';
      targets.push({ element, attribute, sourceId, kind });
    }
  });
  return targets;
}
