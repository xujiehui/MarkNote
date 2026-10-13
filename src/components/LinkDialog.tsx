import { useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useI18n } from '../i18n';
import { sanitizeContentUrl } from '../lib/sanitizeContent';

export function LinkDialog({ initialUrl, onApply, onClose }: { initialUrl: string; onApply: (url: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState(false);
  useDialogFocus(ref, onClose);
  function apply() {
    const value = url.trim();
    const safe = value ? sanitizeContentUrl(value, 'link') : '';
    if (safe === null) { setError(true); return; }
    onApply(safe); onClose();
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="link-dialog-title" tabIndex={-1} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="link-dialog-title" className="mb-3 font-semibold">{t('editor.link')}</h2>
        <label className="block text-sm">{t('editor.linkUrl')}<input type="url" value={url} onChange={(event) => { setUrl(event.target.value); setError(false); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} className="mt-2 w-full rounded-lg border p-2" /></label>
        {error ? <p role="alert" className="mt-2 text-sm text-red-700">{t('editor.linkInvalid')}</p> : null}
        <div className="mt-4 flex gap-3"><button type="button" onClick={apply} className="rounded-lg bg-blue-600 px-3 py-2 text-white">{t('editor.linkApply')}</button><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2">{t('editor.cancel')}</button></div>
      </section>
    </div>
  );
}
