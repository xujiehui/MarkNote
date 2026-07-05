import { isSyncCurrent } from '../sync/syncDisplayStatus';

export type LocalSaveState = 'idle' | 'saving' | 'saved';

export interface EditorStatusInput {
  saveState: LocalSaveState;
  syncConfigured: boolean;
  syncSessionActive: boolean;
  syncSyncing: boolean;
  syncCheckingBackend: boolean;
  syncError: string;
  syncLastResultOk?: boolean;
  syncQueuePending?: number;
  syncQueueFailed?: number;
}

export type EditorStatusKind = 'saving' | 'syncing' | 'syncFailed' | 'saved' | 'localSaved';

export interface EditorStatus {
  kind: EditorStatusKind;
  tone: 'success' | 'warning' | 'error' | 'muted';
  canRetrySync: boolean;
  messageKey: 'editor.saveSaving' | 'editor.saveSaved' | 'editor.localSaved' | 'sync.syncing' | 'sync.failed';
}

export function resolveEditorStatus({
  saveState,
  syncConfigured,
  syncSessionActive,
  syncSyncing,
  syncCheckingBackend,
  syncError,
  syncLastResultOk,
  syncQueuePending = 0,
  syncQueueFailed = 0,
}: EditorStatusInput): EditorStatus {
  if (saveState === 'saving') {
    return {
      kind: 'saving',
      tone: 'warning',
      canRetrySync: false,
      messageKey: 'editor.saveSaving',
    };
  }

  if (syncError) {
    return {
      kind: 'syncFailed',
      tone: 'error',
      canRetrySync: syncConfigured && syncSessionActive && !syncSyncing && !syncCheckingBackend,
      messageKey: 'sync.failed',
    };
  }

  if (syncSyncing) {
    return {
      kind: 'syncing',
      tone: 'warning',
      canRetrySync: false,
      messageKey: 'sync.syncing',
    };
  }

  if (
    !syncConfigured ||
    !syncSessionActive ||
    !isSyncCurrent({
      lastResultOk: Boolean(syncLastResultOk),
      queuePending: syncQueuePending,
      queueFailed: syncQueueFailed,
    })
  ) {
    return {
      kind: 'localSaved',
      tone: 'muted',
      canRetrySync: false,
      messageKey: 'editor.localSaved',
    };
  }

  return {
    kind: 'saved',
    tone: 'success',
    canRetrySync: false,
    messageKey: 'editor.saveSaved',
  };
}
