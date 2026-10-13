import { saveAs } from 'file-saver';
import { marked } from 'marked';
import TurndownService from 'turndown';
import type { Folder, ImageAttachment, ImportResult, Note } from '../types';
import { createNoteDraft } from './db';
import { noteHtmlDocument, sanitizeTitle, stripHtml } from './html';
import { createBackupPackage, MAX_IMPORT_BYTES, parseJsonImportPackage, type BackupHistory, type BackupPreferences, type ParsedImportPackage } from './backup';
import { isSafeRasterImageMimeType, sanitizeNoteContent } from './sanitizeContent';

export { buildRestorePlan, createBackupPackage, readBackupData, restoreImportPackage } from './backup';
export type { BackupHistory, BackupPreferences, ParsedImportPackage, RestorePlan } from './backup';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.addRule('codeBlocks', {
  filter: (node) => node.nodeName === 'PRE' && Boolean(node.querySelector('code')),
  replacement: (_content, node) => {
    const code = node.querySelector('code');
    const className = code?.getAttribute('class') || '';
    const language = className.match(/language-([\w-]+)/)?.[1] || '';
    const text = (code?.textContent || '').replace(/\n$/, '');
    return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`;
  },
});

turndown.addRule('base64Images', {
  filter: 'img',
  replacement: (_content, node) => {
    const element = node as HTMLImageElement;
    const alt = escapeMarkdownText(element.alt || '');
    const source = (element.getAttribute('src') || element.src).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `![${alt}](${source})`;
  },
});

export function exportNoteAsHtml(note: Note): void {
  const blob = new Blob([noteHtmlDocument(note.title, note.content)], { type: 'text/html;charset=utf-8' });
  saveAs(blob, `${sanitizeTitle(note.title)}.html`);
}

export async function exportNoteAsPdf(note: Note): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('iframe');
  host.title = 'PDF 导出预览';
  host.setAttribute('sandbox', 'allow-same-origin');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:960px;height:1200px;border:0;pointer-events:none';
  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('PDF 导出预览加载超时。')), 10_000);
    host.onload = () => { window.clearTimeout(timer); resolve(); };
    host.onerror = () => { window.clearTimeout(timer); reject(new Error('PDF 导出预览加载失败。')); };
  });
  host.srcdoc = noteHtmlDocument(note.title, sanitizeNoteContent(note.content));
  document.body.appendChild(host);

  try {
    await ready;
    const page = host.contentDocument?.querySelector('main') as HTMLElement | null;
    if (!page) throw new Error('PDF 导出预览不可用。');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const margin = 10;
    const imageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const imageHeight = pdf.internal.pageSize.getHeight() - margin * 2;
    const bounds = page.getBoundingClientRect();
    const pagePixelHeight = Math.floor((imageHeight / imageWidth) * bounds.width);
    const totalHeight = Math.max(page.scrollHeight, Math.ceil(bounds.height));
    if (!pagePixelHeight || Math.ceil(totalHeight / pagePixelHeight) > 200) throw new Error('笔记过长，PDF 最多支持 200 页，请分批导出。');
    // Render one bounded canvas per page. A single very tall canvas can exceed browser limits.
    for (let offset = 0; offset < totalHeight; offset += pagePixelHeight) {
      const pixels = Math.min(pagePixelHeight, totalHeight - offset);
      const canvas = await html2canvas(page, {
        backgroundColor: '#fbfaf7', scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true,
        x: bounds.left, y: bounds.top + offset, width: Math.ceil(bounds.width), height: pixels,
        windowWidth: 960, windowHeight: 1200,
      });
      if (offset > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imageWidth, (canvas.height * imageWidth) / canvas.width);
      canvas.width = 0;
      canvas.height = 0;
    }

    pdf.save(`${sanitizeTitle(note.title)}.pdf`);
  } finally {
    host.remove();
  }
}

export function exportNoteAsMarkdown(note: Note): void {
  const blob = new Blob([noteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, `${sanitizeTitle(note.title)}.md`);
}

export function noteToMarkdown(note: Pick<Note, 'title' | 'content'>): string {
  const markdown = turndown.turndown(sanitizeNoteContent(note.content));
  return `# ${escapeMarkdownText(note.title)}\n\n${markdown}`;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]{}()#+.!<>])/g, '\\$1');
}

export async function exportAllAsJson(
  notes: Note[], folders: Folder[], attachments: ImageAttachment[], history: BackupHistory[] = [], preferences: BackupPreferences = {},
): Promise<void> {
  const payload = await createBackupPackage({ notes, folders, attachments, history, preferences });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  saveAs(blob, `marknote-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function parseImportFile(file: File): Promise<ImportResult[]> {
  const parsed = await parseImportPackage(file);
  return parsed.notes.map((note) => ({ title: note.title, content: note.content, note, tags: note.tags }));
}

export async function parseImportPackage(file: File): Promise<ParsedImportPackage> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('导入文件超过 100 MB 上限。');
  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'json') {
    return parseJsonImportPackage(text);
  }

  if (extension === 'html' || file.type === 'text/html') {
    return plainImportPackage(parseHtmlFile(text, file.name));
  }

  if (extension === 'md' || extension === 'markdown' || file.type === 'text/markdown') {
    return plainImportPackage(parseMarkdownFile(text, file.name));
  }

  throw new Error('仅支持导入 .md、.html、.json 文件。');
}

function plainImportPackage(result: ImportResult): ParsedImportPackage {
  return {
    version: 0, notes: [createNoteDraft({ title: result.title, content: result.content, tags: result.tags || [] })],
    folders: [], attachments: [], history: [], preferences: {}, integrityVerified: false, warnings: [],
  };
}

function parseHtmlFile(text: string, fileName: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const title = doc.querySelector('h1')?.textContent?.trim() || doc.querySelector('title')?.textContent?.trim() || titleFromFile(fileName);
  return {
    title,
    content: sanitizeNoteContent(doc.body.innerHTML || '<p></p>'),
  };
}

function parseMarkdownFile(text: string, fileName: string): ImportResult {
  const html = marked.parse(text, { async: false }) as string;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('h1')?.textContent?.trim() || titleFromFile(fileName);

  return {
    title,
    content: sanitizeNoteContent(html),
  };
}

function titleFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || '导入笔记';
}

export function hasRemoteMarkdownImages(markdown: string): boolean {
  return /!\[[^\]]*]\((https?:\/\/[^)]+)\)/i.test(markdown);
}

export async function remoteImagesToBase64(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(sanitizeNoteContent(html), 'text/html');
  const images = Array.from(doc.querySelectorAll('img[src^="http"]'));

  // Keep memory/network use bounded when importing image-heavy documents.
  for (let start = 0; start < images.length; start += 3) {
    await Promise.all(images.slice(start, start + 3).map(async (image) => {
      try {
        const element = image as HTMLImageElement;
        const response = await fetch(element.src, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('图片下载失败。');
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > 10 * 1024 * 1024) throw new Error('远端图片超过 10 MB 上限。');
        const blob = await readLimitedImageResponse(response);
        if (!isSafeRasterImageMimeType(blob.type) || blob.size > 10 * 1024 * 1024) throw new Error('远端图片格式或大小不受支持。');
        const dataUrl = await blobToDataUrl(blob);
        element.setAttribute('src', dataUrl);
      } catch {
        image.setAttribute('data-marknote-remote-error', 'true');
      }
    }));
  }

  return sanitizeNoteContent(doc.body.innerHTML);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('图片转换失败。'));
    reader.readAsDataURL(blob);
  });
}

async function readLimitedImageResponse(response: Response): Promise<Blob> {
  const limit = 10 * 1024 * 1024;
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > limit) throw new Error('远端图片超过 10 MB 上限。');
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('远端图片超过 10 MB 上限。');
      }
      chunks.push(result.value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: (response.headers.get('content-type') || '').split(';')[0].trim() });
}

export function noteMatches(note: Note, query: string): boolean {
  const value = query.trim().toLowerCase();
  if (!value) {
    return true;
  }

  return `${note.title} ${note.rawContent || stripHtml(note.content)}`.toLowerCase().includes(value);
}
