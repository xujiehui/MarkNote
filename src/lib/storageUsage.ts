import type { ImageAttachment, Note } from '../types';
import { dataUrlSizeBytes } from './image';

export const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;

export function noteStorageBytes(notes: Note[]): number {
  return new Blob(notes.map((note) => `${note.title}${note.content}${note.tags.join('')}`)).size;
}

export function attachmentStorageBytes(attachments: ImageAttachment[]): number {
  return attachments
    .filter((attachment) => !attachment.deletedAt)
    .reduce((total, attachment) => total + (attachment.sizeBytes ?? dataUrlSizeBytes(attachment.data)), 0);
}

export function storageUsedBytes(notes: Note[], attachments: ImageAttachment[]): number {
  return noteStorageBytes(notes) + attachmentStorageBytes(attachments);
}

export function storageUsagePercent(usedBytes: number, quotaBytes = DEFAULT_STORAGE_QUOTA_BYTES): number {
  if (quotaBytes <= 0 || usedBytes <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(100, Math.round((usedBytes / quotaBytes) * 100)));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
