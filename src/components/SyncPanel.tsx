import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Chrome, ClipboardCopy, Cloud, CloudOff, Loader2, LogOut, RefreshCcw, SearchCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { formatUpdatedAt } from '../lib/date';
import { resolveBackendVerification } from '../sync/backendVerification';
import { formatSyncDiagnosisReport, isSyncCurrent } from '../sync/syncDisplayStatus';
import type { SyncSessionState } from '../sync/useSyncSession';
import type { SyncBackendCheckItem } from '../sync/types';

interface SyncPanelProps {
  sync: SyncSessionState;
}

export function SyncPanel({ sync }: SyncPanelProps) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyResetTimerRef = useRef<number | null>(null);
  const backendCheck = sync.backendCheck;
  const syncCurrent = isSyncCurrent({
    lastResultOk: Boolean(sync.lastResult?.ok),
    queuePending: sync.queue.pending,
    queueFailed: sync.queue.failed,
  });
  const copyBackendReport = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard is not available.');
      }
      await navigator.clipboard.writeText(
        formatSyncDiagnosisReport({
          providerName: sync.providerName,
          configured: sync.configured,
          session: sync.session,
          queue: sync.queue,
          lastResult: sync.lastResult,
          error: sync.error,
          backendCheck,
        }),
      );
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
    scheduleCopyStatusReset();
  };

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  function scheduleCopyStatusReset() {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      copyResetTimerRef.current = null;
      setCopyStatus('idle');
    }, 1600);
  }

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
        <SyncErrorNotice message={sync.error} />
        {!sync.error ? (
          <div className="mb-2 break-words leading-5 text-gray-500">
            {syncCurrent && sync.lastResult ? t('sync.lastResult', { pushed: sync.lastResult.pushed, pulled: sync.lastResult.pulled }) : t('sync.ready')}
          </div>
        ) : null}
        <QueueSummary pending={sync.queue.pending} failed={sync.queue.failed} />
        <BackendVerificationSummary
          checked={Boolean(sync.backendCheck)}
          checking={sync.checkingBackend}
          items={sync.backendCheck?.items || []}
        />
        <BackendCheckList
          checkedAt={backendCheck?.checkedAt}
          items={backendCheck?.items || []}
          onCopyReport={copyBackendReport}
          copyStatus={copyStatus}
        />
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <button
            type="button"
            onClick={() => void sync.syncNow()}
            disabled={sync.syncing || sync.loading || sync.checkingBackend}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary-600 px-2 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            <RefreshCcw size={13} className={sync.syncing ? 'animate-spin' : ''} />
            {sync.syncing ? t('sync.syncing') : t('sync.syncNow')}
          </button>
          <button
            type="button"
            onClick={() => void sync.checkBackend()}
            disabled={sync.loading || sync.syncing || sync.checkingBackend}
            className="grid h-8 w-8 place-items-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
            aria-label={t('sync.diagnose')}
            title={t('sync.diagnose')}
          >
            {sync.checkingBackend ? <Loader2 size={13} className="animate-spin" /> : <SearchCheck size={13} />}
          </button>
          <button
            type="button"
            onClick={() => void sync.signOut()}
            disabled={sync.loading || sync.syncing || sync.checkingBackend}
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
      <p className="mb-2 leading-5 text-gray-500">{sync.authPending ? t('sync.oauthPending') : t('sync.oauthHint')}</p>
      <SyncErrorNotice message={sync.error} />
      <QueueSummary pending={sync.queue.pending} failed={sync.queue.failed} />
      <BackendCheckList
        checkedAt={backendCheck?.checkedAt}
        items={backendCheck?.items || []}
        onCopyReport={copyBackendReport}
        copyStatus={copyStatus}
      />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => void sync.signInWithOAuth('google')}
          disabled={sync.loading || sync.checkingBackend}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary-600 px-2 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
        >
          {sync.authPending ? <Loader2 size={13} className="animate-spin" /> : <Chrome size={13} />}
          {sync.authPending ? t('sync.oauthWaiting') : sync.loading ? t('sync.loading') : t('sync.signInWithGoogle')}
        </button>
        <button
          type="button"
          onClick={() => void sync.checkBackend()}
          disabled={sync.loading || sync.checkingBackend}
          className="grid h-8 w-8 place-items-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
          aria-label={t('sync.diagnose')}
          title={t('sync.diagnose')}
        >
          {sync.checkingBackend ? <Loader2 size={13} className="animate-spin" /> : <SearchCheck size={13} />}
        </button>
      </div>
    </div>
  );
}

function BackendVerificationSummary({
  checked,
  checking,
  items,
}: {
  checked: boolean;
  checking: boolean;
  items: SyncBackendCheckItem[];
}) {
  const { t } = useI18n();
  const verification = resolveBackendVerification(items);
  const status = checked ? verification.status : 'pending';
  const Icon = checking ? Loader2 : status === 'verified' ? CheckCircle2 : AlertTriangle;
  const tone =
    status === 'verified'
      ? 'border-green-100 bg-green-50 text-success'
      : status === 'failed'
        ? 'border-red-100 bg-red-50 text-error'
        : 'border-amber-100 bg-amber-50 text-warning';
  const detailTone = status === 'failed' ? 'text-red-700' : status === 'verified' ? 'text-green-700' : 'text-amber-700';
  const title =
    status === 'verified'
      ? t('sync.backendVerified')
      : status === 'failed'
        ? t('sync.backendVerificationFailed')
        : t('sync.backendVerificationPending');
  const detail =
    status === 'verified'
      ? t('sync.backendVerifiedDetail')
      : status === 'failed'
        ? verification.failedItem?.message || t('sync.backendVerificationFailedDetail')
        : checking
          ? t('sync.backendVerificationCheckingDetail')
          : t('sync.backendVerificationPendingDetail');

  return (
    <div className={`mb-2 rounded-md border px-2 py-1.5 text-xs leading-5 ${tone}`}>
      <div className="mb-0.5 flex items-center gap-1.5 font-medium">
        <Icon size={13} className={checking ? 'animate-spin' : ''} />
        {title}
      </div>
      <div className={`break-words ${detailTone}`}>{detail}</div>
    </div>
  );
}

function SyncErrorNotice({ message }: { message: string }) {
  const { t } = useI18n();
  if (!message) {
    return null;
  }

  return (
    <div className="mb-2 rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-xs leading-5 text-error">
      <div className="mb-0.5 flex items-center gap-1.5 font-medium">
        <AlertTriangle size={13} />
        {t('sync.failed')}
      </div>
      <div className="break-words text-red-700">{message}</div>
    </div>
  );
}

function QueueSummary({ pending, failed }: { pending: number; failed: number }) {
  const { t } = useI18n();
  if (!pending) {
    return null;
  }

  return (
    <div className="mb-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 leading-5 text-gray-500">
      <div>{t('sync.queuePending', { count: pending })}</div>
      {failed ? <div className="text-error">{t('sync.queueFailed', { count: failed })}</div> : null}
    </div>
  );
}

function BackendCheckList({
  checkedAt,
  items,
  onCopyReport,
  copyStatus = 'idle',
}: {
  checkedAt?: number;
  items: SyncBackendCheckItem[];
  onCopyReport?: () => void | Promise<void>;
  copyStatus?: 'idle' | 'copied' | 'failed';
}) {
  const { locale, t } = useI18n();
  if (!items.length && !onCopyReport) {
    return null;
  }

  return (
    <div className="mb-2 space-y-1 border-y border-gray-200 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-gray-400">
        <span>{t('sync.backendCheck')}</span>
        <span className="flex items-center gap-2 normal-case tracking-normal">
          {onCopyReport ? (
            <button
              type="button"
              onClick={() => void onCopyReport()}
              className="grid h-6 w-6 place-items-center rounded-md text-gray-500 hover:bg-white hover:text-gray-700"
              aria-label={t('sync.copyBackendReport')}
              title={t('sync.copyBackendReport')}
            >
              <ClipboardCopy size={12} />
            </button>
          ) : null}
          {copyStatus === 'copied' ? <span className="text-green-600">{t('sync.backendReportCopied')}</span> : null}
          {copyStatus === 'failed' ? <span className="text-red-600">{t('sync.backendReportCopyFailed')}</span> : null}
          {checkedAt ? t('sync.backendCheckedAt', { time: formatUpdatedAt(checkedAt, locale) }) : null}
        </span>
      </div>
      {items.map((item) => {
        const Icon = item.status === 'ok' ? CheckCircle2 : AlertTriangle;
        const color = item.status === 'ok' ? 'text-success' : item.status === 'warning' ? 'text-warning' : 'text-error';
        return (
          <div key={`${item.name}-${item.code || item.status}`} className="grid grid-cols-[16px_1fr] gap-1.5 leading-5">
            <Icon size={13} className={`mt-0.5 ${color}`} />
            <div className="min-w-0">
              <div className="font-medium text-gray-700">
                {item.name}
                {item.code ? <span className="ml-1 font-mono text-[10px] text-gray-400">{item.code}</span> : null}
              </div>
              <div className="break-words text-gray-500">{item.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
