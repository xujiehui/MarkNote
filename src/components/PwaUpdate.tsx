import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { activateOfflineUpdate, getOfflineState, subscribeOfflineState } from '../lib/serviceWorker';

export function PwaUpdate({ prepareUpdate }: { prepareUpdate: () => Promise<void> }) {
  const { language } = useI18n();
  const [offline, setOffline] = useState(getOfflineState);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const zh = language === 'zh-CN';
  useEffect(() => subscribeOfflineState(setOffline), []);
  useEffect(() => { if (offline.updateAvailable) setDismissed(false); }, [offline.updateAvailable]);

  async function update() {
    setBusy(true);
    setFailed(false);
    try {
      await prepareUpdate();
      await activateOfflineUpdate();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  if (!offline.updateAvailable || dismissed) return null;
  return (
    <aside aria-label={zh ? '应用更新' : 'Application update'} className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-xl border border-[#d8d2c8] bg-[#fbfaf7] p-4 text-[#34302b] shadow-xl">
      <p role="status" className="mb-3 text-sm">
        {failed
          ? (zh ? '保存或更新未完成。你的编辑仍保留，请重试。' : 'Saving or updating did not complete. Your editor remains open; please retry.')
          : (zh ? '新版本已就绪。保存当前编辑后可重新打开应用。' : 'An update is ready. Save your current edits and reopen the app.')}
      </p>
      <div className="flex gap-3">
        <button type="button" disabled={busy} onClick={() => void update()} className="rounded-lg bg-[#34302b] px-3 py-2 text-sm text-white disabled:opacity-60">
          {busy ? (zh ? '正在保存并更新…' : 'Saving and updating…') : (zh ? '保存并更新' : 'Save and update')}
        </button>
        <button type="button" disabled={busy} onClick={() => setDismissed(true)} className="rounded-lg border border-[#d8d2c8] px-3 py-2 text-sm">
          {zh ? '稍后' : 'Later'}
        </button>
      </div>
    </aside>
  );
}
