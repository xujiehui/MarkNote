import { Cloud, CloudOff, LogOut, RefreshCcw, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import type { SyncSessionState } from '../sync/useSyncSession';

interface SyncPanelProps {
  sync: SyncSessionState;
}

export function SyncPanel({ sync }: SyncPanelProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');

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
    <form
      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
      onSubmit={(event) => {
        event.preventDefault();
        void sync.signIn({ email, password, mode });
      }}
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-gray-800">
        <Cloud size={14} className="text-primary-600" />
        {t('sync.signInTitle')}
      </div>
      <div className="mb-2 grid grid-cols-2 rounded-md bg-gray-100 p-0.5">
        <button
          type="button"
          onClick={() => setMode('sign-in')}
          className={`h-7 rounded text-xs ${mode === 'sign-in' ? 'bg-white text-gray-900 shadow-subtle' : 'text-gray-500'}`}
        >
          {t('sync.signIn')}
        </button>
        <button
          type="button"
          onClick={() => setMode('sign-up')}
          className={`h-7 rounded text-xs ${mode === 'sign-up' ? 'bg-white text-gray-900 shadow-subtle' : 'text-gray-500'}`}
        >
          {t('sync.signUp')}
        </button>
      </div>
      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        autoComplete="email"
        required
        className="mb-2 h-8 w-full rounded-md border border-gray-200 px-2 text-xs outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
        placeholder={t('sync.email')}
      />
      <input
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
        required
        minLength={6}
        className="mb-2 h-8 w-full rounded-md border border-gray-200 px-2 text-xs outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
        placeholder={t('sync.password')}
      />
      {sync.error ? <div className="mb-2 text-xs text-error">{sync.error}</div> : null}
      <button
        type="submit"
        disabled={sync.loading}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-2 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
      >
        <UserPlus size={13} />
        {sync.loading ? t('sync.loading') : mode === 'sign-up' ? t('sync.createAccount') : t('sync.signInAction')}
      </button>
    </form>
  );
}
