import createDOMPurify, { type DOMPurify, type WindowLike } from 'dompurify';

export type ContentUrlKind = 'link' | 'image' | 'video' | 'audio' | 'file';
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4', 'audio/flac']);
const FILE_TYPES = new Set([
  'application/pdf', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed',
  'text/plain', 'text/csv', 'text/markdown', 'application/json',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function hasControlCharacters(value: string, includeSpace = false): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= (includeSpace ? 32 : 31) || character.charCodeAt(0) === 127);
}

export function isSafeRasterImageMimeType(type: string): boolean {
  return RASTER_IMAGE_TYPES.has(type.toLowerCase());
}

export function isSafeContentMimeType(type: string, kind: Exclude<ContentUrlKind, 'link'>): boolean {
  const mime = type.toLowerCase();
  return kind === 'image' ? RASTER_IMAGE_TYPES.has(mime)
    : kind === 'video' ? VIDEO_TYPES.has(mime)
      : kind === 'audio' ? AUDIO_TYPES.has(mime)
        : FILE_TYPES.has(mime) || RASTER_IMAGE_TYPES.has(mime) || VIDEO_TYPES.has(mime) || AUDIO_TYPES.has(mime);
}

/** URL policy is shared by imports, paste, synced content and export. */
export function sanitizeContentUrl(value: string, kind: ContentUrlKind): string | null {
  const url = value.trim();
  // A URL parser removes embedded whitespace from schemes. Reject it before parsing.
  if (!url || hasControlCharacters(url, true)) {
    return null;
  }
  if (kind === 'link' && /^#[^\s]*$/.test(url)) {
    return url;
  }
  if (kind !== 'link' && /^marknote-attachment:\/\/[^/?#]+$/.test(url)) {
    try {
      const id = decodeURIComponent(url.slice('marknote-attachment://'.length));
      return id && id.length <= 256 && !hasControlCharacters(id) ? url : null;
    } catch {
      return null;
    }
  }
  const data = url.match(/^data:([\w.+/-]+);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (data) {
    const mime = data[1].toLowerCase();
    const encoded = data[2];
    if (!encoded || encoded.length % 4 !== 0) {
      return null;
    }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if ((encoded.length * 3) / 4 - padding > MAX_ATTACHMENT_BYTES) return null;
    const allowed = kind !== 'link' && isSafeContentMimeType(mime, kind);
    return allowed ? `data:${mime};base64,${encoded}` : null;
  }
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname && !parsed.username && !parsed.password) {
      return parsed.href;
    }
    if (kind === 'link' && parsed.protocol === 'mailto:' && parsed.pathname && !/%0[ad]/i.test(url)) {
      return parsed.href;
    }
    // Blob URLs only identify transient resources belonging to this application's origin.
    if (kind !== 'link' && parsed.protocol === 'blob:' && typeof window !== 'undefined'
      && window.location.origin !== 'null' && parsed.origin === window.location.origin) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

let purifier: DOMPurify | undefined;
let purifierWindow: WindowLike | undefined;

function getPurifier(): DOMPurify {
  const domWindow = typeof window !== 'undefined' ? window : typeof document !== 'undefined' ? document.defaultView : null;
  if (!domWindow) {
    throw new Error('Content sanitization requires a browser DOM.');
  }
  if (purifier && purifierWindow === domWindow) {
    return purifier;
  }
  purifierWindow = domWindow;
  purifier = createDOMPurify(domWindow);
  if (!purifier.isSupported) {
    throw new Error('Content sanitization is unavailable in this browser.');
  }
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const name = data.attrName;
    const value = data.attrValue;
    if (name === 'src' || name === 'href' || name === 'poster') {
      const kind: ContentUrlKind = name === 'poster' ? 'image' : tag === 'img' ? 'image'
        : tag === 'audio' || (tag === 'source' && element.parentElement?.tagName === 'AUDIO') ? 'audio'
          : tag === 'video' || tag === 'source' ? 'video'
            : tag === 'file-attachment' || (tag === 'a' && element.hasAttribute('download')) ? 'file' : 'link';
      const isValidAttribute = name === 'href' ? tag === 'a' || tag === 'file-attachment'
        : name === 'poster' ? tag === 'video' : ['img', 'video', 'audio', 'source'].includes(tag);
      const safeUrl = isValidAttribute ? sanitizeContentUrl(value, kind) : null;
      data.keepAttr = Boolean(safeUrl);
      if (safeUrl) data.attrValue = safeUrl;
    } else if (name === 'style') {
      data.attrValue = sanitizeStyle(element, value);
      data.keepAttr = Boolean(data.attrValue);
    } else if (name === 'class') {
      data.attrValue = value.split(/\s+/).filter((item) => /^(?:language-[\w-]+|hljs(?:-[\w-]+)?|image-(?:left|right|center)|marknote-file-attachment)$/.test(item)).join(' ');
      data.keepAttr = Boolean(data.attrValue);
    } else if (name === 'width' || name === 'height') {
      data.keepAttr = ['img', 'video'].includes(tag) && isSafeDimension(value);
    } else if (name === 'data-type') {
      data.keepAttr = (tag === 'ul' && value === 'taskList') || (tag === 'li' && value === 'taskItem');
    } else if (name === 'data-checked') {
      data.keepAttr = tag === 'li' && /^(?:true|false)$/.test(value);
    } else if (name === 'data-align') {
      data.keepAttr = tag === 'img' && /^(?:left|right|center)$/.test(value);
    } else if (name === 'data-attachment-id' || name === 'data-code-block-id') {
      data.keepAttr = Boolean(value) && value.length <= 256 && !hasControlCharacters(value, true);
    } else if (name === 'data-line-numbers') {
      data.keepAttr = tag === 'pre' && value.length <= 50000 && /^\d+(?:\n\d+)*$/.test(value);
    } else if (name === 'data-marknote-remote-error') {
      data.keepAttr = tag === 'img' && value === 'true';
    } else if (name === 'type') {
      data.keepAttr = tag === 'input' ? value === 'checkbox' : tag === 'source' && (VIDEO_TYPES.has(value.toLowerCase()) || AUDIO_TYPES.has(value.toLowerCase()));
    } else if (name === 'colspan' || name === 'rowspan') {
      data.keepAttr = ['td', 'th'].includes(tag) && /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100;
    } else if (name === 'start') {
      data.keepAttr = tag === 'ol' && /^-?\d{1,6}$/.test(value);
    } else if (name === 'download' || name === 'filename') {
      data.keepAttr = ['a', 'file-attachment'].includes(tag);
    } else if (name === 'target') {
      data.keepAttr = tag === 'a' && value === '_blank';
    }
  });
  purifier.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;
    if (element.tagName === 'A' && element.hasAttribute('href')) {
      element.removeAttribute('rel');
      element.setAttribute('rel', 'noopener noreferrer');
    }
    if (element.tagName === 'INPUT') {
      // Task controls are inert; only the editor decides whether they are interactive.
      element.removeAttribute('type');
      element.removeAttribute('disabled');
      element.setAttribute('type', 'checkbox');
      element.setAttribute('disabled', '');
    }
  });
  return purifier;
}

function isSafeDimension(value: string): boolean {
  const match = value.match(/^(\d+(?:\.\d+)?)(%|px)?$/);
  return Boolean(match && Number(match[1]) > 0 && Number(match[1]) <= (match[2] === '%' ? 100 : 4096));
}

function sanitizeStyle(element: Element, value: string): string {
  const allowed: string[] = [];
  for (const declaration of value.split(';')) {
    const match = declaration.trim().match(/^([a-z-]+)\s*:\s*(.+)$/i);
    if (!match) continue;
    const property = match[1].toLowerCase();
    const content = match[2].trim().toLowerCase();
    if ((property === 'width' || property === 'height') && ['IMG', 'VIDEO'].includes(element.tagName) && isSafeDimension(content)) {
      allowed.push(`${property}: ${content}`);
    } else if (property === 'text-align' && /^(?:left|right|center|justify)$/.test(content)) {
      allowed.push(`${property}: ${content}`);
    } else if ((property === 'text-decoration' || property === 'text-decoration-line') && /^(?:underline|line-through|none)$/.test(content)) {
      allowed.push(`${property}: ${content}`);
    }
  }
  return allowed.length ? `${allowed.join('; ')};` : '';
}

/** Only editor-supported HTML survives. No script, foreign namespace or resource styling is accepted. */
export function sanitizeNoteContent(html: string): string {
  if (!html) return '';
  return getPurifier().sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'label', 'input', 'a', 'img', 'video', 'audio', 'source', 'file-attachment', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
    ALLOWED_ATTR: ['src', 'href', 'poster', 'alt', 'title', 'width', 'height', 'style', 'class', 'type', 'checked', 'disabled', 'controls', 'preload', 'download', 'filename', 'target', 'rel', 'start', 'colspan', 'rowspan', 'data-type', 'data-checked', 'data-align', 'data-attachment-id', 'data-code-block-id', 'data-line-numbers', 'data-marknote-remote-error'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // These attributes carry editor metadata, not URLs. Hooks above validate their values.
    ADD_URI_SAFE_ATTR: ['alt', 'title', 'width', 'height', 'style', 'class', 'type', 'checked', 'disabled', 'controls', 'preload', 'download', 'filename', 'target', 'rel', 'start', 'colspan', 'rowspan', 'data-type', 'data-checked', 'data-align', 'data-attachment-id', 'data-code-block-id', 'data-line-numbers', 'data-marknote-remote-error'],
    ADD_DATA_URI_TAGS: ['audio', 'video', 'source', 'file-attachment', 'a'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|marknote-attachment:\/\/|data:|blob:)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'template'],
    SANITIZE_NAMED_PROPS: true,
  });
}
