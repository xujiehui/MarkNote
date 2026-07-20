import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '../src/components/Sidebar';
import { I18nContext } from '../src/i18n-context';
import type { SyncSessionState } from '../src/sync/useSyncSession';
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
  'sidebar.expandSidebar': 'Expand sidebar',
  'sidebar.collapseSidebar': 'Collapse sidebar',
};

const sync: SyncSessionState = {
  configured: false,
  providerName: 'Local',
  session: null,
  loading: false,
  authPending: false,
  syncing: false,
  checkingBackend: false,
  lastResult: null,
  backendCheck: null,
  queue: { pending: 0, failed: 0, firstError: '' },
  error: '',
  signInWithOAuth: async () => undefined,
  signOut: async () => undefined,
  syncNow: async () => ({ ok: true, pushed: 0, pulled: 0 }),
  checkBackend: async () => ({ ok: true, checkedAt: Date.now(), items: [] }),
};

async function main() {
  const container = document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  let toggleCount = 0;

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
        <Sidebar
          query=""
          folders={[]}
          activeFilter="all"
          totalNotesCount={0}
          folderCounts={{}}
          tagCounts={{}}
          tags={[]}
          tagColors={{}}
          trashCount={0}
          storageUsedLabel="0 B / 10 MB"
          storagePercent={0}
          workspaceName="Workspace Pro"
          searchResults={{ recentNotes: [], notes: [], tags: [], codeBlocks: [] }}
          onQueryChange={() => undefined}
          onFilterChange={() => undefined}
          onWorkspaceChange={() => undefined}
          onSearchNoteSelect={() => undefined}
          onSearchTagSelect={() => undefined}
          onSearchCodeSelect={() => undefined}
          onCreateFolder={() => undefined}
          onCreateTag={() => undefined}
          onFolderContextMenu={() => undefined}
          onCreateNote={() => undefined}
          onImportClick={() => undefined}
          onExportClick={() => undefined}
          onTogglePanel={() => {
            toggleCount += 1;
          }}
          onToggleTheme={() => undefined}
          collapsed
          darkMode={false}
          searchInputRef={createRef<HTMLInputElement>()}
          editingFolderName=""
          onEditingFolderNameChange={() => undefined}
          onCommitFolderRename={() => undefined}
          onCancelFolderRename={() => undefined}
          sync={sync}
        />
      </I18nContext.Provider>,
    );
  });

  const expandButton = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-expand-button"]');
  assert.ok(expandButton);
  assert.equal(expandButton.getAttribute('aria-label'), 'Expand sidebar');
  assert.equal(container.querySelectorAll('[aria-label="Expand sidebar"]').length, 1);
  assert.match(expandButton.className, /right-\[-14px\]/);

  const footerActions = container.querySelector<HTMLElement>('[data-testid="sidebar-footer-actions"]');
  assert.ok(footerActions);
  assert.match(footerActions.className, /flex-col/);

  await act(async () => {
    expandButton.click();
  });
  assert.equal(toggleCount, 1);

  await act(async () => {
    root.unmount();
  });

  console.log('sidebar collapse tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
