import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorSyncStatus } from '../src/components/EditorSyncStatus';
import { I18nContext } from '../src/i18n-context';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/?app=1',
});

installDomGlobals({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const translations: Record<string, string> = {
  'editor.localSaved': 'Saved locally',
  'editor.saveSaved': 'Saved',
  'editor.saveSaving': 'Saving',
  'sync.diagnose': 'Diagnose sync',
  'sync.failed': 'Sync failed',
  'sync.retry': 'Retry sync',
  'sync.syncing': 'Syncing',
};

async function renderStatus(props: Partial<React.ComponentProps<typeof EditorSyncStatus>> = {}): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{
          language: 'en',
          locale: 'en-US',
          setLanguage: () => undefined,
          t: (key) => translations[key] || key,
        }}
      >
        <EditorSyncStatus
          saveState="saved"
          syncConfigured
          syncSessionActive
          syncSyncing={false}
          syncCheckingBackend={false}
          syncError="Table missing"
          syncLastResultOk={false}
          syncQueuePending={0}
          syncQueueFailed={0}
          onSyncRetry={() => undefined}
          onSyncDiagnose={() => undefined}
          {...props}
        />
      </I18nContext.Provider>,
    );
  });
  return { container, root };
}

async function main() {
  const clicked: string[] = [];
  let mounted = await renderStatus({
    onSyncRetry: () => clicked.push('retry'),
    onSyncDiagnose: () => clicked.push('diagnose'),
  });
  assert.match(mounted.container.textContent || '', /Sync failed/);
  const retryButton = mounted.container.querySelector<HTMLButtonElement>('button:not([aria-label])');
  assert.ok(retryButton);
  assert.equal(retryButton.disabled, false);
  const diagnoseButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Diagnose sync"]');
  assert.ok(diagnoseButton);
  assert.equal(diagnoseButton.disabled, false);
  await act(async () => {
    retryButton.click();
    diagnoseButton.click();
  });
  assert.deepEqual(clicked, ['retry', 'diagnose']);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderStatus({
    syncCheckingBackend: true,
    onSyncRetry: () => clicked.push('disabled-retry'),
    onSyncDiagnose: () => clicked.push('disabled-diagnose'),
  });
  assert.match(mounted.container.textContent || '', /Sync failed/);
  assert.equal(mounted.container.querySelector<HTMLButtonElement>('button:not([aria-label])'), null);
  assert.equal(mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Diagnose sync"]'), null);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderStatus({
    syncError: '',
    syncLastResultOk: true,
    syncQueuePending: 0,
    syncQueueFailed: 0,
  });
  assert.match(mounted.container.textContent || '', /Saved/);
  assert.equal(mounted.container.querySelector('button'), null);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderStatus({
    syncError: '',
    syncLastResultOk: true,
    syncQueuePending: 1,
    syncQueueFailed: 0,
  });
  assert.match(mounted.container.textContent || '', /Saved locally/);
  assert.equal(mounted.container.querySelector('button'), null);
  await act(async () => {
    mounted.root.unmount();
  });

  console.log('editor sync action tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
