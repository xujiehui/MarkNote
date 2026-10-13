import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { MessageChannel } from 'node:worker_threads';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PwaUpdate } from '../src/components/PwaUpdate';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { I18nContext } from '../src/i18n-context';
import { registerOfflineWorker } from '../src/lib/serviceWorker';
import { installDomGlobals } from './domGlobals';

const virtualConsole = new VirtualConsole();
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/?app=1', virtualConsole });
installDomGlobals({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, MessageChannel, IS_REACT_ACT_ENVIRONMENT: true });
const messages: unknown[] = [];
const registration = Object.assign(new dom.window.EventTarget(), { active: { postMessage: (_message: unknown, ports: import('node:worker_threads').MessagePort[]) => ports[0].postMessage({ type: 'MARKNOTE_OFFLINE_STATUS', ready: true }) }, waiting: { postMessage: (message: unknown) => messages.push(message) }, installing: null });
Object.defineProperty(dom.window.navigator, 'serviceWorker', { value: Object.assign(new dom.window.EventTarget(), {
  controller: {}, register: async () => registration, ready: Promise.resolve(registration),
}) });

async function main() {
  await registerOfflineWorker('/');
  const root = createRoot(document.getElementById('root')!);
  let canSave = false;
  let saved = 0;
  await act(async () => {
    root.render(<I18nContext.Provider value={{ language: 'en', locale: 'en-US', setLanguage: () => undefined, t: (key) => key }}>
      <PwaUpdate prepareUpdate={async () => { if (!canSave) throw new Error('Disk full'); saved += 1; }} />
    </I18nContext.Provider>);
  });
  const update = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Save and update')!;
  assert.ok(update);
  assert.equal(messages.length, 0);
  await act(async () => update.click());
  assert.equal(saved, 0);
  assert.equal(messages.length, 0, 'A failed save must never activate the update');
  assert.match(document.querySelector('[role="status"]')?.textContent || '', /did not complete/);
  assert.equal(update.disabled, false, 'Failure must leave a retry action');
  canSave = true;
  await act(async () => update.click());
  assert.equal(saved, 1);
  assert.equal(messages.length, 1, 'The update activates only after persistence succeeds');
  await act(async () => dom.window.navigator.serviceWorker.dispatchEvent(new dom.window.Event('controllerchange')));
  await act(async () => root.unmount());

  const diagnostic: unknown[][] = [];
  const originalError = console.error;
  function Crashed(): React.ReactNode { throw new Error('PRIVATE NOTE CONTENT'); }
  console.error = (...args: unknown[]) => { diagnostic.push(args); };
  try {
    const fallbackRoot = createRoot(document.getElementById('root')!);
    await act(async () => fallbackRoot.render(<ErrorBoundary><Crashed /></ErrorBoundary>));
    assert.ok(document.querySelector('[role="alert"]'));
    assert.match(document.querySelector('[role="alert"]')?.textContent || '', /Saved local notes remain/);
    assert.equal(document.body.textContent?.includes('PRIVATE NOTE CONTENT'), false);
    const ownDiagnostic = diagnostic.find(([first]) => first === 'MarkNote could not render the application.');
    assert.ok(ownDiagnostic);
    assert.equal(JSON.stringify(ownDiagnostic).includes('PRIVATE NOTE CONTENT'), false, 'The application boundary must not log note-bearing exception text');
    await act(async () => fallbackRoot.unmount());
  } finally { console.error = originalError; }
  console.log('PWA update persistence guard and application error recovery tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
