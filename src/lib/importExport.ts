import { saveAs } from 'file-saver';
import { marked } from 'marked';
import TurndownService from 'turndown';
import type { ImportResult, Note } from '../types';
import { createNoteDraft } from './db';
import { noteHtmlDocument, sanitizeTitle, stripHtml } from './html';

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
    return `![${element.alt || ''}](${element.getAttribute('src') || element.src})`;
  },
});

export function exportNoteAsHtml(note: Note): void {
  const blob = new Blob([noteHtmlDocument(note.title, note.content)], { type: 'text/html;charset=utf-8' });
  saveAs(blob, `${sanitizeTitle(note.title)}.html`);
}

export async function exportNoteAsPdf(note: Note): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.className = 'pdf-export-host';
  host.innerHTML = noteHtmlDocument(note.title, note.content);
  document.body.appendChild(host);

  try {
    const page = host.querySelector('main') as HTMLElement;
    const canvas = await html2canvas(page, {
      backgroundColor: '#fbfaf7',
      scale: Math.min(2, window.devicePixelRatio || 1),
      useCORS: true,
    });

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    const imageData = canvas.toDataURL('image/png');
    let heightLeft = imageHeight;
    let position = 0;

    pdf.addImage(imageData, 'PNG', 0, position, imageWidth, imageHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imageHeight;
      pdf.addPage();
      pdf.addImage(imageData, 'PNG', 0, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;
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
  const markdown = turndown.turndown(note.content);
  return `# ${note.title}\n\n${markdown}`;
}

export function exportAllAsJson(notes: Note[]): void {
  const payload = {
    version: 1,
    exportedAt: Date.now(),
    notes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  saveAs(blob, `marknote-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function parseImportFile(file: File): Promise<ImportResult[]> {
  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'json') {
    return parseJsonBackup(text, file.name);
  }

  if (extension === 'html' || file.type === 'text/html') {
    return [parseHtmlFile(text, file.name)];
  }

  if (extension === 'md' || extension === 'markdown' || file.type === 'text/markdown') {
    return [parseMarkdownFile(text, file.name)];
  }

  throw new Error('仅支持导入 .md、.html、.json 文件。');
}

function parseJsonBackup(text: string, fileName: string): ImportResult[] {
  const value = JSON.parse(text) as unknown;
  const notes = Array.isArray(value) ? value : (value as { notes?: unknown }).notes;
  if (!Array.isArray(notes)) {
    throw new Error(`${fileName} 不是有效的 MarkNote JSON 备份。`);
  }

  return notes.map((note) => {
    const draft = createNoteDraft(note as Partial<Note>);
    return {
      title: draft.title,
      content: draft.content,
      note: draft,
      tags: draft.tags,
    };
  });
}

function parseHtmlFile(text: string, fileName: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const title = doc.querySelector('h1')?.textContent?.trim() || doc.querySelector('title')?.textContent?.trim() || titleFromFile(fileName);
  doc.querySelectorAll('script').forEach((node) => node.remove());
  return {
    title,
    content: doc.body.innerHTML || '<p></p>',
  };
}

function parseMarkdownFile(text: string, fileName: string): ImportResult {
  const html = marked.parse(text, { async: false }) as string;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('h1')?.textContent?.trim() || titleFromFile(fileName);

  return {
    title,
    content: html,
  };
}

function titleFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || '导入笔记';
}

export function hasRemoteMarkdownImages(markdown: string): boolean {
  return /!\[[^\]]*]\((https?:\/\/[^)]+)\)/i.test(markdown);
}

export async function remoteImagesToBase64(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img[src^="http"]'));

  await Promise.all(
    images.map(async (image) => {
      try {
        const element = image as HTMLImageElement;
        const response = await fetch(element.src, { mode: 'cors' });
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);
        element.setAttribute('src', dataUrl);
      } catch {
        image.setAttribute('data-marknote-remote-error', 'true');
      }
    }),
  );

  return doc.body.innerHTML;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('图片转换失败。'));
    reader.readAsDataURL(blob);
  });
}

export function noteMatches(note: Note, query: string): boolean {
  const value = query.trim().toLowerCase();
  if (!value) {
    return true;
  }

  return `${note.title} ${note.rawContent || stripHtml(note.content)}`.toLowerCase().includes(value);
}
