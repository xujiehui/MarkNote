import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  attachmentIdFromRefUrl,
  attachmentRefUrl,
  extractAttachmentRefIds,
  replaceAttachmentDataUrlsWithRefs,
  restoreAttachmentRefs,
} from '../src/lib/attachmentContent';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
});

const imageData = 'data:image/png;base64,aGVsbG8=';
const pdfData = 'data:application/pdf;base64,cGRm';
const source = [
  `<p>media</p>`,
  `<img src="${imageData}" data-attachment-id="image-1">`,
  `<file-attachment href="${pdfData}" data-attachment-id="file-1" filename="brief.pdf"></file-attachment>`,
].join('');

const remote = replaceAttachmentDataUrlsWithRefs(source);
assert.equal(remote.includes(imageData), false);
assert.equal(remote.includes(pdfData), false);
assert.equal(remote.includes(attachmentRefUrl('image-1')), true);
assert.equal(remote.includes(attachmentRefUrl('file-1')), true);
assert.equal(attachmentIdFromRefUrl(attachmentRefUrl('image-1')), 'image-1');
assert.deepEqual(Array.from(extractAttachmentRefIds(remote)).sort(), ['file-1', 'image-1']);

const restored = restoreAttachmentRefs(remote, [
  {
    id: 'image-1',
    noteId: 'note-1',
    data: imageData,
    mimeType: 'image/png',
  },
  {
    id: 'file-1',
    noteId: 'note-1',
    data: pdfData,
    mimeType: 'application/pdf',
  },
]);

assert.equal(restored.includes(imageData), true);
assert.equal(restored.includes(pdfData), true);

console.log('attachment content tests passed');
