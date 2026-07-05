import assert from 'node:assert/strict';
import { resolveEditorStatus } from '../src/lib/editorStatus';

function main() {
  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'saving',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: 'Table missing',
    }),
    {
      kind: 'saving',
      tone: 'warning',
      canRetrySync: false,
      messageKey: 'editor.saveSaving',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'saved',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: 'Table missing',
    }),
    {
      kind: 'syncFailed',
      tone: 'error',
      canRetrySync: true,
      messageKey: 'sync.failed',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'saved',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: true,
      syncError: 'Table missing',
    }),
    {
      kind: 'syncFailed',
      tone: 'error',
      canRetrySync: false,
      messageKey: 'sync.failed',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'idle',
      syncConfigured: true,
      syncSessionActive: false,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: '',
    }),
    {
      kind: 'localSaved',
      tone: 'muted',
      canRetrySync: false,
      messageKey: 'editor.localSaved',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'idle',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: true,
      syncCheckingBackend: false,
      syncError: '',
    }),
    {
      kind: 'syncing',
      tone: 'warning',
      canRetrySync: false,
      messageKey: 'sync.syncing',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'idle',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: '',
    }),
    {
      kind: 'localSaved',
      tone: 'muted',
      canRetrySync: false,
      messageKey: 'editor.localSaved',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'idle',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: '',
      syncLastResultOk: true,
    }),
    {
      kind: 'saved',
      tone: 'success',
      canRetrySync: false,
      messageKey: 'editor.saveSaved',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'idle',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: '',
      syncLastResultOk: true,
      syncQueuePending: 1,
      syncQueueFailed: 0,
    }),
    {
      kind: 'localSaved',
      tone: 'muted',
      canRetrySync: false,
      messageKey: 'editor.localSaved',
    },
  );

  assert.deepEqual(
    resolveEditorStatus({
      saveState: 'idle',
      syncConfigured: true,
      syncSessionActive: true,
      syncSyncing: false,
      syncCheckingBackend: false,
      syncError: '',
      syncLastResultOk: true,
      syncQueuePending: 1,
      syncQueueFailed: 1,
    }),
    {
      kind: 'localSaved',
      tone: 'muted',
      canRetrySync: false,
      messageKey: 'editor.localSaved',
    },
  );

  console.log('editor status tests passed');
}

main();
