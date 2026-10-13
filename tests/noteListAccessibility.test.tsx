import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteList } from '../src/components/NoteList';
import { I18nContext } from '../src/i18n-context';
import { installDomGlobals } from './domGlobals';
import type { Note } from '../src/types';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/?app=1' });
let width = 390;
let height = 220;
const resizeCallbacks = new Set<() => void>();
installDomGlobals({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    constructor(private callback: () => void) { resizeCallbacks.add(callback); }
    observe() { /* The fixture invokes actual measured resize callbacks below. */ }
    disconnect() { resizeCallbacks.delete(this.callback); }
  },
});
const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return this.getAttribute('data-testid') === 'note-list-viewport'
    ? { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => undefined }
    : originalRect.call(this);
};

async function main() {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  const selected: string[] = [];
  let contextCalls = 0;
  let restored = 0;
  const note: Note = { id: 'one', title: 'Accessible note', rawContent: 'A plain text preview', content: '<p>Rich document</p>', folderId: 'local', createdAt: 1, updatedAt: 1, tags: [], pinned: false };
  function render(isTrash = false) {
    root.render(<I18nContext.Provider value={{ language: 'en', locale: 'en-US', setLanguage: () => undefined, t: (key) => key }}>
      <NoteList notes={[note]} folders={[]} activeNoteId="one" title="All notes" isTrash={isTrash} sortMode="updated" quickFilter="all"
        onSortModeChange={() => undefined} onQuickFilterChange={() => undefined} onCreateNote={() => undefined}
        onSelectNote={(id) => selected.push(id)} onContextMenu={() => { contextCalls += 1; }} onRestoreNote={() => { restored += 1; }} onDeleteForever={() => undefined} />
    </I18nContext.Provider>);
  }
  await act(async () => render());
  const listViewport = container.querySelector('[data-testid="note-list-viewport"]')!;
  const virtualScroller = listViewport.firstElementChild as HTMLElement;
  assert.equal(virtualScroller.style.width, '390px');
  assert.equal(virtualScroller.style.height, '220px', 'The measured list must fit short screens without a forced 320px minimum');
  const select = container.querySelector<HTMLButtonElement>('[data-note-select="one"]')!;
  assert.equal(select.tagName, 'BUTTON', 'Selection must use native keyboard-operable controls');
  assert.equal(select.getAttribute('aria-label'), 'Accessible note');
  assert.equal(select.getAttribute('aria-current'), 'true');
  assert.equal(container.querySelector('button button'), null, 'Card actions must not be nested inside the selection button');
  await act(async () => select.click());
  assert.deepEqual(selected, ['one']);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="note.actions"]')!.click());
  assert.equal(contextCalls, 1);
  assert.equal(selected.length, 1, 'Opening card actions must not select the note again');
  assert.match(container.textContent || '', /A plain text preview/);
  width = 680;
  height = 150;
  await act(async () => { for (const callback of resizeCallbacks) callback(); });
  assert.equal(virtualScroller.style.width, '680px');
  assert.equal(virtualScroller.style.height, '150px');
  await act(async () => render(true));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="note.restore"]')!.click());
  assert.equal(restored, 1);
  assert.equal(selected.length, 1, 'Restoring a note must not trigger card selection');
  await act(async () => root.unmount());
  assert.equal(resizeCallbacks.size, 0);
  console.log('Note list native selection, action separation and measured viewport tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
