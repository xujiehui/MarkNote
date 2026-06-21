import hljs from 'highlight.js/lib/common';

export function stripHtml(html: string): string {
  if (!html) {
    return '';
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach((node) => node.remove());
  doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, br').forEach((node) => node.append(' '));
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

export function getPreview(html: string, limit = 20, emptyText = 'Blank note'): string {
  const text = stripHtml(html);
  return text.length > limit ? `${text.slice(0, limit)}...` : text || emptyText;
}

export function sanitizeTitle(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
}

export function noteHtmlDocument(title: string, content: string): string {
  const preparedContent = prepareExportContent(content);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #24221f; background: #fbfaf7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 48px; line-height: 1.65; }
    main { max-width: 840px; margin: 0 auto; }
    h1, h2, h3 { line-height: 1.2; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    img[data-align="left"] { float: left; margin: 0 20px 16px 0; }
    img[data-align="right"] { float: right; margin: 0 0 16px 20px; }
    img[data-align="center"] { display: block; margin: 16px auto; clear: both; }
    pre { position: relative; background: #1e1e1e; color: #f5f5f5; border-radius: 8px; padding: 18px 18px 18px 54px; overflow-x: auto; }
    pre::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 42px; border-right: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); }
    pre::after { content: attr(data-line-numbers); position: absolute; left: 0; top: 18px; width: 34px; color: rgba(255,255,255,0.36); font: 13px/1.55 "SFMono-Regular", Consolas, "Liberation Mono", monospace; text-align: right; white-space: pre; user-select: none; }
    code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: #c586c0; }
    .hljs-string, .hljs-attr, .hljs-symbol { color: #ce9178; }
    .hljs-title, .hljs-function, .hljs-name { color: #dcdcaa; }
    .hljs-number, .hljs-literal { color: #b5cea8; }
    .hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }
    .hljs-variable, .hljs-template-variable { color: #9cdcfe; }
    .hljs-type, .hljs-class { color: #4ec9b0; }
    blockquote { border-left: 4px solid #4f6f52; margin-left: 0; padding-left: 16px; color: #55514a; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ded7cb; padding: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${preparedContent}
  </main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prepareExportContent(content: string): string {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  doc.querySelectorAll('pre code').forEach((code) => {
    const element = code as HTMLElement;
    const className = element.getAttribute('class') || '';
    const language = className.match(/language-([\w-]+)/)?.[1];
    const source = element.textContent || '';
    const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(source, { language }).value : hljs.highlightAuto(source).value;

    element.innerHTML = highlighted;
    element.classList.add('hljs');
    const pre = element.closest('pre');
    if (pre) {
      const lineCount = Math.max(1, source.split('\n').length);
      pre.setAttribute('data-line-numbers', Array.from({ length: lineCount }, (_value, index) => String(index + 1)).join('\n'));
    }
  });

  return doc.body.innerHTML;
}
