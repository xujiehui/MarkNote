import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { highlightCodeBlocks } from '../src/editor/codeBlockUtils';

function main() {
  const editableDom = new JSDOM(
    '<!doctype html><html><body><div contenteditable="true"><pre><code class="language-javascript">const value = 1;</code></pre></div></body></html>',
  );
  Object.assign(globalThis, {
    document: editableDom.window.document,
  });

  const editableCode = editableDom.window.document.querySelector('code');
  assert.ok(editableCode);
  const editableHtmlBefore = editableCode.innerHTML;
  highlightCodeBlocks(editableDom.window.document);
  assert.equal(editableCode.innerHTML, editableHtmlBefore);
  assert.equal(editableCode.getAttribute('data-highlighted'), null);
  assert.equal(editableCode.closest('pre')?.getAttribute('data-code-label'), 'JavaScript');
  assert.equal(editableCode.closest('pre')?.getAttribute('data-line-numbers'), '1');

  const readOnlyDom = new JSDOM(
    '<!doctype html><html><body><article><pre><code class="language-javascript">const value = 1;</code></pre></article></body></html>',
  );
  Object.assign(globalThis, {
    document: readOnlyDom.window.document,
  });
  const readOnlyCode = readOnlyDom.window.document.querySelector('code');
  assert.ok(readOnlyCode);
  highlightCodeBlocks(readOnlyDom.window.document);
  assert.equal(readOnlyCode.getAttribute('data-highlighted'), 'yes');
  assert.match(readOnlyCode.innerHTML, /hljs-/);
  assert.equal(readOnlyCode.closest('pre')?.getAttribute('data-code-label'), 'JavaScript');

  console.log('code block utils tests passed');
}

main();
