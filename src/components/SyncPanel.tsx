import { Chrome, Cloud, CloudOff, LogOut, RefreshCcw } from 'lucide-react';
import { useI18n } from '../i18n';
import type { SyncSessionState } from '../sync/useSyncSession';

interface SyncPanelProps {
  sync: SyncSessionState;
}

export function SyncPanel({ sync }: SyncPanelProps) {
  const { t } = useI18n();

  if (!sync.configured) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <div className="mb-1 flex items-center gap-2 font-medium text-gray-700">
          <CloudOff size={14} />
          {t('sync.localOnly')}
        </div>
        <p>{t('sync.configureHint')}</p>
      </div>
    );
  }

  if (sync.session) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <div className="mb-2 flex min-w-0 items-center gap-2 font-medium text-gray-800">
          <Cloud size={14} className="shrink-0 text-success" />
          <span className="min-w-0 flex-1 truncate">{sync.session.user.email || t('sync.account')}</span>
        </div>
        <div className="mb-2 text-gray-500">
          {sync.lastResult?.ok
            ? t('sync.lastResult', { pushed: sync.lastResult.pushed, pulled: sync.lastResult.pulled })
            : sync.error || t('sync.ready')}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={() => void sync.syncNow()}
            disabled={sync.syncing || sync.loading}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary-600 px-2 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            <RefreshCcw size={13} className={sync.syncing ? 'animate-spin' : ''} />
            {sync.syncing ? t('sync.syncing') : t('sync.syncNow')}
          </button>
          <button
            type="button"
            onClick={() => void sync.signOut()}
            disabled={sync.loading || sync.syncing}
            className="grid h-8 w-8 place-items-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
            aria-label={t('sync.signOut')}
            title={t('sync.signOut')}
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="mb-2 flex items-center gap-2 font-medium text-gray-800">
        <Cloud size={14} className="text-primary-600" />
        {t('sync.signInTitle')}
      </div>
      <p className="mb-2 leading-5 text-gray-500">{t('sync.oauthHint')}</p>
      {sync.error ? <div className="mb-2 text-xs text-error">{sync.error}</div> : null}
      <button
        type="button"
        onClick={() => void sync.signInWithOAuth('google')}
        disabled={sync.loading}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-2 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
      >
        <Chrome size={13} />
        {sync.loading ? t('sync.loading') : t('sync.signInWithGoogle')}
      </button>
    </div>
  );
}
