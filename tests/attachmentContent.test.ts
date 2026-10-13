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

const downloadLink = `<a href="${pdfData}" download="brief.pdf" data-attachment-id="file-1">附件</a>`;
const remoteLink = replaceAttachmentDataUrlsWithRefs(downloadLink);
assert.equal(remoteLink.includes(pdfData), false, 'download links must use stable refs during sync');
assert.equal(restoreAttachmentRefs(remoteLink, [{ id: 'file-1', noteId: 'note-1', data: pdfData, mimeType: 'application/pdf' }]).includes(pdfData), true);
assert.deepEqual(Array.from(extractAttachmentRefIds(`<a href="${attachmentRefUrl('file-1')}" download>文件</a>`)), ['file-1']);
assert.equal(attachmentIdFromRefUrl('marknote-attachment://%E0%A4'), '', 'malformed percent encodings cannot crash loading');
const sourceElement = `<audio controls><source src="marknote-attachment://audio-1" type="audio/mpeg"></audio>`;
assert.deepEqual(Array.from(extractAttachmentRefIds(sourceElement)), ['audio-1']);
assert.match(restoreAttachmentRefs(sourceElement, [{ id: 'audio-1', noteId: 'note-1', data: 'data:audio/mpeg;base64,aGVsbG8=', mimeType: 'audio/mpeg' }]), /data:audio\/mpeg;base64,aGVsbG8=/);
const withPoster = '<video src="marknote-attachment://video-1" poster="marknote-attachment://image-1" data-attachment-id="video-1"></video>';
assert.deepEqual(Array.from(extractAttachmentRefIds(withPoster)).sort(), ['image-1', 'video-1']);
const restoredPoster = restoreAttachmentRefs(withPoster, [{ id: 'video-1', noteId: 'note-1', data: 'data:video/mp4;base64,aGVsbG8=', mimeType: 'video/mp4' }, { id: 'image-1', noteId: 'note-1', data: imageData, mimeType: 'image/png' }]);
assert.match(restoredPoster, /poster="data:image\/png/);
assert.match(restoredPoster, /data-attachment-id="video-1"/, 'poster hydration cannot replace the video attachment identity');

console.log('attachment content tests passed');
