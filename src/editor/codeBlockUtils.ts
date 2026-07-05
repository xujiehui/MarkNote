import hljs from 'highlight.js/lib/common';

export const CODE_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'go',
  'rust',
  'java',
  'csharp',
  'sql',
  'html',
  'css',
  'json',
  'bash',
  'markdown',
];

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  csharp: 'C#',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  bash: 'Bash',
  markdown: 'Markdown',
  mermaid: 'Mermaid',
};

export function codeLanguageLabel(language?: string | null): string {
  if (!language) {
    return 'Plain Text';
  }
  return CODE_LANGUAGE_LABELS[language] || language;
}

export function highlightCodeBlocks(root: ParentNode = document): void {
  root.querySelectorAll('pre code').forEach((block) => {
    const element = block as HTMLElement;
    const pre = element.closest('pre');
    if (pre) {
      const language = Array.from(element.classList)
        .find((className) => className.startsWith('language-'))
        ?.replace('language-', '');
      pre.setAttribute('data-code-label', codeLanguageLabel(language || 'javascript'));
      updateLineNumbers(pre, element);
    }
    if (isInsideEditableSurface(element) || element.dataset.highlighted === 'yes') {
      return;
    }
    hljs.highlightElement(element);
  });
}

export async function copyCodeFromPre(pre: HTMLPreElement): Promise<void> {
  const code = pre.querySelector('code')?.textContent || '';
  await navigator.clipboard.writeText(code);
}

function updateLineNumbers(pre: Element, code: HTMLElement): void {
  const lines = Math.max(1, (code.textContent || '').split('\n').length);
  pre.setAttribute(
    'data-line-numbers',
    Array.from({ length: lines }, (_value, index) => String(index + 1)).join('\n'),
  );
}

function isInsideEditableSurface(element: HTMLElement): boolean {
  return Boolean(element.closest('[contenteditable="true"]'));
}
