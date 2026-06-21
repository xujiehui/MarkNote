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

export function highlightCodeBlocks(root: ParentNode = document): void {
  root.querySelectorAll('pre code').forEach((block) => {
    const element = block as HTMLElement;
    const pre = element.closest('pre');
    if (pre) {
      updateLineNumbers(pre, element);
    }
    if (element.dataset.highlighted === 'yes') {
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
