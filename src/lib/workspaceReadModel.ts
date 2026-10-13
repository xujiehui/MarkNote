import type { ImageAttachment, Note } from '../types';
import type { MarkNoteDatabase } from './db';
import { escapeHtml, stripHtml } from './html';
import { dataUrlSizeBytes } from './image';

const MAX_CODE_PREVIEWS = 5;
const MAX_CODE_PREVIEW_CHARACTERS = 400;

/** Lists keep text and metadata only; the selected note must read its full record separately. */
export async function readNoteSummaries(database: MarkNoteDatabase): Promise<Note[]> {
  const notes: Note[] = [];
  await database.notes.each((note) => {
    notes.push({
      ...note,
      content: codePreviewMarkup(note.content),
      rawContent: note.rawContent || stripHtml(note.content),
    });
  });
  return notes;
}

/** A cursor releases each raw data URL after deriving capacity metadata. */
export async function readAttachmentSummaries(database: MarkNoteDatabase): Promise<ImageAttachment[]> {
  const attachments: ImageAttachment[] = [];
  await database.images.each((attachment) => {
    const derivedSize = attachment.data ? dataUrlSizeBytes(attachment.data) : undefined;
    attachments.push({
      ...attachment,
      data: '',
      sizeBytes: derivedSize ?? attachment.sizeBytes ?? 0,
    });
  });
  return attachments;
}

function codePreviewMarkup(content: string): string {
  if (!content || !/<pre\b/i.test(content)) return '';
  const doc = new DOMParser().parseFromString(content, 'text/html');
  return Array.from(doc.querySelectorAll('pre code')).slice(0, MAX_CODE_PREVIEWS).map((block) => {
    const language = (block.getAttribute('class') || '').match(/(?:^|\s)language-([\w-]+)/)?.[1]?.slice(0, 64);
    const className = language ? ` class="language-${language}"` : '';
    const source = (block.textContent || '').slice(0, MAX_CODE_PREVIEW_CHARACTERS);
    // Build markup from text; scripts, attributes and media never survive this read model.
    return `<pre><code${className}>${escapeHtml(source)}</code></pre>`;
  }).join('');
}
