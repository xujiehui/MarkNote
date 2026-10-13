import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ImportDialog } from '../src/components/ImportDialog';
import { I18nContext } from '../src/i18n-context';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body><button id="launcher">导入</button><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' });
installDomGlobals({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, DOMParser: dom.window.DOMParser, File: dom.window.File, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

async function main() {
  const root = createRoot(document.getElementById('root')!);
  let imports = 0;
  let closed = 0;
  const launcher = document.getElementById('launcher') as HTMLButtonElement;
  launcher.focus();
  await act(async () => {
    root.render(<I18nContext.Provider value={{ language: 'zh-CN', locale: 'zh-CN', setLanguage: () => undefined, t: (key) => key }}>
      <ImportDialog onClose={() => { closed += 1; }} onImportFiles={async () => { imports += 1; throw new Error('存储空间不足'); }} />
    </I18nContext.Provider>);
  });
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'import.close');
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  async function select(file: File) {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  }
  await select(new File(['# 安全正文\n\ntext'], 'note.md', { type: 'text/markdown' }));
  assert.match(document.body.textContent || '', /预检完成：1 篇笔记/);
  assert.equal(imports, 0, 'preflight never writes before explicit confirmation');
  const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '确认导入')!;
  await act(async () => { confirm.click(); });
  assert.equal(imports, 1);
  assert.equal(closed, 0, 'failed restore keeps dialog and preview available');
  assert.equal(document.querySelector('[role="alert"]')?.textContent, '存储空间不足');
  await select(new File(['{bad-json'], 'invalid.json', { type: 'application/json' }));
  assert.match(document.querySelector('[role="alert"]')?.textContent || '', /JSON 文件格式无效/);
  assert.equal(document.querySelector('select'), null, 'invalid input cannot keep an old actionable preview');
  assert.equal(imports, 1);
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(closed, 1);
  await act(async () => { root.unmount(); });
  assert.equal(document.activeElement, launcher, 'closing restores keyboard focus');
  console.log('import preflight/failure/focus tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
