import assert from 'node:assert/strict';
import {
  attachmentStorageBytes,
  formatBytes,
  storageUsagePercent,
  storageUsedBytes,
} from '../src/lib/storageUsage';
import type { ImageAttachment, Note } from '../src/types';

const note: Note = {
  id: 'note-1',
  title: 'Note',
  content: '<p>Hello</p>',
  folderId: 'folder-1',
  createdAt: 1,
  updatedAt: 2,
  tags: ['work'],
  pinned: false,
};

const attachments: ImageAttachment[] = [
  {
    id: 'image-sized',
    noteId: note.id,
    data: '',
    mimeType: 'image/png',
    sizeBytes: 10,
  },
  {
    id: 'image-data-url',
    noteId: note.id,
    data: 'data:text/plain;base64,aGVsbG8=',
    mimeType: 'text/plain',
  },
  {
    id: 'image-deleted',
    noteId: note.id,
    data: 'data:text/plain;base64,aGVsbG8=',
    mimeType: 'text/plain',
    sizeBytes: 1000,
    deletedAt: 3,
  },
];

assert.equal(attachmentStorageBytes(attachments), 15);
assert.equal(storageUsedBytes([note], attachments), new Blob([`${note.title}${note.content}${note.tags.join('')}`]).size + 15);
assert.equal(storageUsagePercent(0, 100), 0);
assert.equal(storageUsagePercent(1, 1000), 1);
assert.equal(storageUsagePercent(150, 100), 100);
assert.equal(formatBytes(512), '512 B');
assert.equal(formatBytes(1536), '1.5 KB');
assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');

console.log('storage usage tests passed');
