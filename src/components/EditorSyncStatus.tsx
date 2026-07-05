import { Loader2, SearchCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { resolveEditorStatus, type LocalSaveState } from '../lib/editorStatus';

interface EditorSyncStatusProps {
  saveState: LocalSaveState;
  syncConfigured: boolean;
  syncSessionActive: boolean;
  syncSyncing: boolean;
  syncCheckingBackend: boolean;
  syncError: string;
  syncLastResultOk: boolean;
  syncQueuePending: number;
  syncQueueFailed: number;
  onSyncRetry: () => void;
  onSyncDiagnose: () => void;
}

export function EditorSyncStatus({
  saveState,
  syncConfigured,
  syncSessionActive,
  syncSyncing,
  syncCheckingBackend,
  syncError,
  syncLastResultOk,
  syncQueuePending,
  syncQueueFailed,
  onSyncRetry,
  onSyncDiagnose,
}: EditorSyncStatusProps) {
  const { t } = useI18n();
  const editorStatus = resolveEditorStatus({
    saveState,
    syncConfigured,
    syncSessionActive,
    syncSyncing,
    syncCheckingBackend,
    syncError,
    syncLastResultOk,
    syncQueuePending,
    syncQueueFailed,
  });

  return (
    <div className="flex h-6 items-center gap-1.5 text-[13px] text-[#4b5563]" title={syncError || undefined}>
      <span
        className={`h-2 w-2 rounded-full ${
          editorStatus.tone === 'error'
            ? 'bg-[#ef4444]'
            : editorStatus.tone === 'warning'
              ? 'bg-[#f59e0b]'
              : editorStatus.tone === 'muted'
                ? 'bg-[#9ca3af]'
                : 'bg-[#22c55e]'
        }`}
      />
      <span>{t(editorStatus.messageKey)}</span>
      {editorStatus.canRetrySync ? (
        <>
          <button
            type="button"
            onClick={onSyncRetry}
            disabled={syncCheckingBackend}
            className="ml-1 h-6 rounded-md border border-[#fecaca] px-2 text-[12px] font-medium text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-60"
          >
            {t('sync.retry')}
          </button>
          <button
            type="button"
            onClick={onSyncDiagnose}
            disabled={syncCheckingBackend}
            className="grid h-6 w-6 place-items-center rounded-md border border-[#fecaca] text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-60"
            title={t('sync.diagnose')}
            aria-label={t('sync.diagnose')}
          >
            {syncCheckingBackend ? <Loader2 size={13} className="animate-spin" /> : <SearchCheck size={13} />}
          </button>
        </>
      ) : null}
    </div>
  );
}
