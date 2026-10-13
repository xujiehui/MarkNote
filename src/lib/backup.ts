import { nanoid } from 'nanoid';
import type { Folder, ImageAttachment, Note } from '../types';
import { attachmentIdFromRefUrl, attachmentRefUrl, extractAttachmentRefIds, replaceAttachmentDataUrlsWithRefs, restoreAttachmentRefs } from './attachmentContent';
import { db, enqueueSync, getWorkspaceEpoch, isWorkspaceCurrent, type MarkNoteDatabase } from './db';
import { stripHtml } from './html';
import { sanitizeContentUrl, sanitizeNoteContent, type ContentUrlKind } from './sanitizeContent';

export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 20 * 1024 * 1024;
const MAX_RECORDS = 100_000;

export interface BackupHistory {
  id: string;
  noteId: string;
  title: string;
  content: string;
  createdAt: number;
}

/** An explicit allowlist: authentication/session settings never enter a backup. */
export interface BackupPreferences {
  customTags?: string[];
  hiddenTags?: string[];
  tagColors?: Record<string, string>;
}

export interface BackupData {
  notes: Note[];
  folders: Folder[];
  attachments: ImageAttachment[];
  history?: BackupHistory[];
  preferences?: BackupPreferences;
}

export interface BackupPackage {
  format: 'marknote-backup';
  version: 2;
  exportedAt: number;
  notes: Note[];
  folders: Folder[];
  attachments: ImageAttachment[];
  history: BackupHistory[];
  preferences: BackupPreferences;
  warnings: string[];
  integrity: {
    algorithm: 'SHA-256';
    payload: string;
    attachments: Record<string, string>;
  };
}

export interface ParsedImportPackage extends BackupData {
  version: 0 | 1 | 2;
  history: BackupHistory[];
  preferences: BackupPreferences;
  integrityVerified: boolean;
  warnings: string[];
}

export interface RestorePlan extends BackupData {
  history: BackupHistory[];
  preferences: BackupPreferences;
  skippedNotes: number;
  warnings: string[];
}

/** Capture a consistent snapshot, rather than racing four independent table reads with sync. */
export async function readBackupData(database: MarkNoteDatabase = db): Promise<Required<Omit<BackupData, 'preferences'>>> {
  const epoch = getWorkspaceEpoch();
  if (database !== db) throw new Error('导出空间已切换，请重新开始备份。');
  const data = await database.transaction('r', [database.folders, database.notes, database.images, database.noteHistory], async () => {
    const [folders, notes, attachments, history] = await Promise.all([
      database.folders.toArray(), database.notes.toArray(), database.images.toArray(), database.noteHistory.toArray(),
    ]);
    return { folders, notes, attachments, history };
  });
  if (!isWorkspaceCurrent(epoch)) throw new Error('导出期间空间已切换，请重新开始备份。');
  return data;
}

export async function createBackupPackage(data: BackupData): Promise<BackupPackage> {
  const payload = {
    format: 'marknote-backup' as const,
    version: 2 as const,
    exportedAt: Date.now(),
    folders: data.folders.map(cleanFolder),
    notes: data.notes.map((note) => cleanNote({ ...note, content: replaceAttachmentDataUrlsWithRefs(note.content) })),
    attachments: data.attachments.map(cleanAttachment),
    history: (data.history || []).map((snapshot) => cleanHistory({ ...snapshot, content: replaceAttachmentDataUrlsWithRefs(snapshot.content) })),
    preferences: cleanPreferences(data.preferences || {}),
    warnings: [] as string[],
  };
  validateReferences(payload);
  payload.warnings = externalMediaWarnings(payload);
  const hashes: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const attachment of payload.attachments) {
    hashes[attachment.id] = await sha256(attachmentBytes(attachment));
  }
  const backup: BackupPackage = {
    ...payload,
    integrity: { algorithm: 'SHA-256', payload: await sha256(canonicalJson(payload)), attachments: hashes },
  };
  if (new TextEncoder().encode(JSON.stringify(backup)).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('备份超过 100 MB 上限，请先分批导出笔记或清理附件。');
  }
  return backup;
}

export async function parseJsonImportPackage(text: string): Promise<ParsedImportPackage> {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('导入文件超过 100 MB 上限。');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('JSON 文件格式无效。');
  }
  const root = Array.isArray(value) ? { notes: value } : object(value, '备份');
  const version = root.version;
  if (version !== undefined && version !== 1 && version !== 2) throw new Error('不支持此备份版本，请使用兼容版本导入。');
  const v2 = version === 2;
  if (v2) {
    if (root.format !== 'marknote-backup') throw new Error('不是有效的 MarkNote V2 备份。');
    const integrity = object(root.integrity, '校验清单');
    if (integrity.algorithm !== 'SHA-256') throw new Error('备份缺少受支持的完整性校验。');
    const payload = { ...root };
    delete payload.integrity;
    if (await sha256(canonicalJson(payload)) !== integrity.payload) throw new Error('备份完整性校验失败：文件内容已损坏或被修改。');
    const hashes = object(integrity.attachments, '附件校验清单');
    const rawAttachments = list(root.attachments, '附件');
    for (const raw of rawAttachments) {
      const attachment = cleanAttachment(raw);
      if (await sha256(attachmentBytes(attachment)) !== hashes[attachment.id]) throw new Error('附件完整性校验失败。');
    }
  }
  const rawNotes = list(root.notes, '笔记');
  if (v2) for (const raw of rawNotes) {
    const row = object(raw, '笔记');
    string(row.id, '笔记标识', 512);
    string(row.folderId, '文件夹标识', 512);
    string(row.content, '笔记正文', MAX_CONTENT_LENGTH);
  }
  const notes = rawNotes.map(cleanNote);
  const folders = v2 ? list(root.folders, '文件夹').map(cleanFolder) : legacyFolders(notes);
  const attachments = v2 ? list(root.attachments, '附件').map(cleanAttachment) : [];
  const history = v2 ? list(root.history, '历史').map(cleanHistory) : [];
  const preferences = v2 ? cleanPreferences(root.preferences) : {};
  const warnings = v2 ? externalMediaWarnings({ notes, history }) : ['旧版备份仅包含笔记；独立附件、完整目录与历史无法从此文件恢复。'];
  const parsed: ParsedImportPackage = { version: v2 ? 2 : 1, notes, folders, attachments, history, preferences, warnings, integrityVerified: v2 };
  if (v2) validateReferences(parsed);
  else {
    uniqueIds(notes, '笔记');
    if (notes.some((note) => extractAttachmentRefIds(note.content).size)) warnings.push('部分旧笔记使用附件引用，但备份不含附件字节。');
  }
  return parsed;
}

/** All imported entities get fresh IDs; selecting skip is explicit and never overwrites. */
export function buildRestorePlan(
  source: ParsedImportPackage,
  options: { strategy?: 'copy' | 'skip-existing'; existingNoteIds?: Iterable<string>; targetFolderId?: string } = {},
): RestorePlan {
  const existing = new Set(options.existingNoteIds || []);
  const selected = source.notes.filter((note) => options.strategy !== 'skip-existing' || !existing.has(note.id));
  const noteIds = new Map(selected.map((note) => [note.id, nanoid()]));
  const folderIds = new Map(source.folders.map((folder) => [folder.id, nanoid()]));
  const selectedAttachments = source.attachments.filter((attachment) => noteIds.has(attachment.noteId));
  const attachmentIds = new Map(selectedAttachments.map((attachment) => [attachment.id, nanoid()]));
  const currentReferencedIds = new Set(selected.flatMap((note) => Array.from(extractAttachmentRefIds(replaceAttachmentDataUrlsWithRefs(note.content)))));
  const historyReferencedIds = new Set(source.history.filter((snapshot) => noteIds.has(snapshot.noteId))
    .flatMap((snapshot) => Array.from(extractAttachmentRefIds(replaceAttachmentDataUrlsWithRefs(snapshot.content)))));
  const referencedIds = new Set([...currentReferencedIds, ...historyReferencedIds]);
  const attachments = selectedAttachments.map((attachment) => {
    const historyOnly = !currentReferencedIds.has(attachment.id) && (attachment.historyOnly === true || historyReferencedIds.has(attachment.id));
    return {
      ...cleanAttachment(attachment), id: attachmentIds.get(attachment.id)!, noteId: noteIds.get(attachment.noteId)!,
      syncStatus: historyOnly ? 'local' as const : 'pending' as const,
      historyOnly, retainedForHistory: historyOnly,
      // This is a new entity. Referenced historical bytes must not be purged by an old delete marker.
      deletedAt: attachment.data && referencedIds.has(attachment.id) ? null : attachment.deletedAt,
      version: 1,
    };
  });
  const content = (html: string) => sanitizeNoteContent(restoreAttachmentRefs(remapAttachmentRefs(html, attachmentIds), attachments));
  return {
    folders: source.folders.map((folder) => ({ ...cleanFolder(folder), id: folderIds.get(folder.id)!, syncStatus: 'pending', version: 1 })),
    notes: selected.map((note) => ({
      ...cleanNote(note), id: noteIds.get(note.id)!, content: content(note.content),
      folderId: folderIds.get(note.folderId) || options.targetFolderId || note.folderId,
      rawContent: stripHtml(content(note.content)), syncStatus: 'pending', version: 1,
    })),
    attachments,
    history: source.history.filter((snapshot) => noteIds.has(snapshot.noteId)).map((snapshot) => ({
      ...cleanHistory(snapshot), id: nanoid(), noteId: noteIds.get(snapshot.noteId)!,
      content: sanitizeNoteContent(replaceAttachmentDataUrlsWithRefs(remapAttachmentRefs(snapshot.content, attachmentIds))),
    })),
    preferences: cleanPreferences(source.preferences),
    warnings: [...source.warnings],
    skippedNotes: source.notes.length - selected.length,
  };
}

export async function restoreImportPackage(
  plan: RestorePlan, options?: { database?: MarkNoteDatabase; epoch?: number },
): Promise<{ noteIds: string[]; skippedNotes: number; preferences: BackupPreferences }> {
  const database = options?.database ?? db;
  const epoch = options?.epoch ?? getWorkspaceEpoch();
  if (database !== db || !isWorkspaceCurrent(epoch)) throw new Error('导入期间空间已切换，请在目标空间重新导入。');
  if (!plan.notes.length && !plan.folders.length) return { noteIds: [], skippedNotes: plan.skippedNotes, preferences: plan.preferences };
  await database.transaction('rw', [database.folders, database.notes, database.images, database.noteHistory, database.syncQueue], async () => {
    if (!isWorkspaceCurrent(epoch)) throw new Error('导入期间空间已切换，请在目标空间重新导入。');
    // add(), instead of put(), deliberately aborts the entire transaction on an ID collision.
    await database.folders.bulkAdd(plan.folders);
    await database.notes.bulkAdd(plan.notes);
    await database.images.bulkAdd(plan.attachments);
    await database.noteHistory.bulkAdd(plan.history);
    for (const folder of plan.folders) await enqueueSync('folder', folder.id, 'upsert', { database });
    for (const note of plan.notes) await enqueueSync('note', note.id, 'upsert', { database });
    for (const attachment of plan.attachments) {
      if (!attachment.historyOnly) await enqueueSync('attachment', attachment.id, attachment.deletedAt ? 'delete' : 'upsert', { database });
    }
    if (!isWorkspaceCurrent(epoch)) throw new Error('导入期间空间已切换，已撤销此次导入。');
  });
  return { noteIds: plan.notes.map((note) => note.id), skippedNotes: plan.skippedNotes, preferences: plan.preferences };
}

export function remapAttachmentRefs(html: string, ids: ReadonlyMap<string, string>): string {
  const doc = new DOMParser().parseFromString(sanitizeNoteContent(html), 'text/html');
  doc.querySelectorAll('[data-attachment-id], img[src], video[src], video[poster], audio[src], source[src], a[href], file-attachment[href]').forEach((element) => {
    const oldId = element.getAttribute('data-attachment-id');
    if (oldId && ids.has(oldId)) element.setAttribute('data-attachment-id', ids.get(oldId)!);
    for (const attribute of ['src', 'href', 'poster']) {
      const ref = attachmentIdFromRefUrl(element.getAttribute(attribute));
      if (ref && ids.has(ref)) element.setAttribute(attribute, attachmentRefUrl(ids.get(ref)!));
    }
  });
  return doc.body.innerHTML;
}

function cleanNote(value: unknown): Note {
  const row = object(value, '笔记');
  const content = sanitizeNoteContent(string(row.content, '笔记正文', MAX_CONTENT_LENGTH, '<p></p>'));
  return {
    id: string(row.id, '笔记标识', 512, nanoid()), title: string(row.title, '笔记标题', 4096, '导入笔记'), content,
    rawContent: stripHtml(content), folderId: string(row.folderId, '文件夹标识', 512, 'folder-library'),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    tags: stringList(row.tags ?? [], '标签', 200), pinned: boolean(row.pinned, false),
    deletedAt: optionalTimestamp(row.deletedAt), version: revision(row.version), syncStatus: 'local', lastSyncedAt: null,
  };
}

function cleanFolder(value: unknown): Folder {
  const row = object(value, '文件夹');
  return {
    id: string(row.id, '文件夹标识', 512), name: string(row.name, '文件夹名称', 4096, '恢复的笔记本'),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    sortOrder: number(row.sortOrder, '目录顺序', 0), deletedAt: optionalTimestamp(row.deletedAt),
    version: revision(row.version), syncStatus: 'local', lastSyncedAt: null,
  };
}

function cleanAttachment(value: unknown): ImageAttachment {
  const row = object(value, '附件');
  const result: ImageAttachment = {
    id: string(row.id, '附件标识', 512), noteId: string(row.noteId, '附件所属笔记', 512),
    data: string(row.data, '附件数据', MAX_IMPORT_BYTES), mimeType: string(row.mimeType, '附件类型', 200),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), deletedAt: optionalTimestamp(row.deletedAt),
    syncStatus: 'local', lastSyncedAt: null,
  };
  if (row.historyOnly !== undefined && boolean(row.historyOnly, false)) {
    result.historyOnly = true;
    result.retainedForHistory = true;
  }
  result.sizeBytes = attachmentBytes(result).byteLength;
  return result;
}

function cleanHistory(value: unknown): BackupHistory {
  const row = object(value, '历史');
  return {
    id: string(row.id, '历史标识', 512), noteId: string(row.noteId, '历史所属笔记', 512),
    title: string(row.title, '历史标题', 4096, '导入笔记'),
    content: sanitizeNoteContent(string(row.content, '历史正文', MAX_CONTENT_LENGTH)), createdAt: timestamp(row.createdAt),
  };
}

function cleanPreferences(value: unknown): BackupPreferences {
  const row = object(value ?? {}, '偏好设置');
  const result: BackupPreferences = {};
  if (row.customTags !== undefined) result.customTags = stringList(row.customTags, '自定义标签', 2000);
  if (row.hiddenTags !== undefined) result.hiddenTags = stringList(row.hiddenTags, '隐藏标签', 2000);
  if (row.tagColors !== undefined) {
    const colors = object(row.tagColors, '标签颜色');
    if (Object.keys(colors).length > 2000) throw new Error('标签颜色数量过多。');
    result.tagColors = Object.fromEntries(Object.entries(colors).map(([key, color]) => {
      if (key.length > 200 || typeof color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(color)) throw new Error('标签颜色格式无效。');
      return [key, color];
    }));
  }
  return result;
}

function legacyFolders(notes: Note[]): Folder[] {
  return Array.from(new Set(notes.map((note) => note.folderId))).map((id, index) => cleanFolder({
    id, name: id === 'folder-library' ? '资料库（恢复）' : `恢复的笔记本 ${index + 1}`, createdAt: Date.now(), updatedAt: Date.now(), sortOrder: index,
  }));
}

function validateReferences(data: BackupData): void {
  const noteIds = uniqueIds(data.notes, '笔记');
  const folderIds = uniqueIds(data.folders, '文件夹');
  uniqueIds(data.attachments, '附件');
  uniqueIds(data.history || [], '历史');
  const attachments = new Map(data.attachments.map((attachment) => [attachment.id, attachment]));
  for (const note of data.notes) {
    if (!folderIds.has(note.folderId)) throw new Error('备份包含未找到所属文件夹的笔记。');
    validateContentAttachments(note.content, note.id, attachments);
  }
  for (const attachment of data.attachments) if (!noteIds.has(attachment.noteId)) throw new Error('备份包含未找到所属笔记的附件。');
  for (const snapshot of data.history || []) {
    if (!noteIds.has(snapshot.noteId)) throw new Error('备份包含未找到所属笔记的历史。');
    validateContentAttachments(snapshot.content, snapshot.noteId, attachments);
  }
}

function validateContentAttachments(content: string, noteId: string, attachments: Map<string, ImageAttachment>) {
  for (const id of extractAttachmentRefIds(content)) {
    const attachment = attachments.get(id);
    if (!attachment || attachment.noteId !== noteId || !attachment.data) throw new Error('备份缺少正文引用的附件，请先下载全部附件再导出。');
  }
  const doc = new DOMParser().parseFromString(content, 'text/html');
  doc.querySelectorAll('img[src], video[src], video[poster], audio[src], source[src], a[download][href], file-attachment[href]').forEach((element) => {
    for (const attribute of ['src', 'href', 'poster']) {
      const id = attachmentIdFromRefUrl(element.getAttribute(attribute));
      if (!id) continue;
      const attachment = attachments.get(id)!;
      const kind: ContentUrlKind = attribute === 'poster' || element.tagName === 'IMG' ? 'image'
        : element.tagName === 'VIDEO' || (element.tagName === 'SOURCE' && element.parentElement?.tagName !== 'AUDIO') ? 'video'
          : element.tagName === 'AUDIO' || element.tagName === 'SOURCE' ? 'audio' : 'file';
      if (!sanitizeContentUrl(attachment.data, kind)) throw new Error('附件类型与正文引用不匹配，无法安全恢复。');
    }
  });
}

function uniqueIds(rows: { id: string }[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${label}包含重复标识，无法安全恢复。`);
    ids.add(row.id);
  }
  return ids;
}

function externalMediaWarnings(data: { notes: Note[]; history: BackupHistory[] }): string[] {
  let count = 0;
  for (const row of [...data.notes, ...data.history]) {
    const doc = new DOMParser().parseFromString(row.content, 'text/html');
    doc.querySelectorAll('img[src], video[src], video[poster], audio[src], source[src], a[download][href], file-attachment[href]').forEach((element) => {
      for (const attribute of ['src', 'href', 'poster']) {
        const url = element.getAttribute(attribute) || '';
        if (/^https?:/i.test(url)) count += 1;
        if (url.startsWith('blob:')) throw new Error('正文包含未保存的临时媒体链接，请先保存附件再备份。');
      }
    });
  }
  return count ? [`备份含 ${count} 个外部媒体引用，未包含这些远端文件字节，断网时可能无法显示。`] : [];
}

function attachmentBytes(attachment: ImageAttachment): Uint8Array {
  if (!attachment.data && attachment.deletedAt) return new Uint8Array();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(attachment.data);
  if (!match || match[1].toLowerCase() !== attachment.mimeType.toLowerCase() || match[2].length % 4 !== 0) {
    throw new Error('附件数据无效或尚未下载，无法生成可恢复备份。');
  }
  if (!sanitizeContentUrl(attachment.data, 'file')) throw new Error('备份包含不受支持或可执行的附件类型。');
  try {
    return Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('附件编码无效。');
  }
}

async function sha256(value: string | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('完整性校验需要安全上下文，请通过 HTTPS 或本机地址打开应用。');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('备份结构嵌套过深，无法安全读取。');
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().filter((key) => row[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key], depth + 1)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效。`);
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error(`${label}列表无效或数量超过上限。`);
  return value;
}

function string(value: unknown, label: string, limit: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > limit || (limit <= 512 && !value.trim())) throw new Error(`${label}格式无效或超过长度上限。`);
  return value;
}

function stringList(value: unknown, label: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label}列表无效。`);
  return value.map((item) => string(item, label, 200));
}

function number(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`${label}格式无效。`);
  return value;
}

function timestamp(value: unknown): number {
  const result = number(value, '时间', Date.now());
  if (result < 0) throw new Error('时间格式无效。');
  return result;
}

function revision(value: unknown): number {
  const result = number(value, '版本', 1);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('版本格式无效。');
  return result;
}

function optionalTimestamp(value: unknown): number | null {
  return value == null ? null : timestamp(value);
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('布尔字段格式无效。');
  return value;
}
