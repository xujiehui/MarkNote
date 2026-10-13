import { UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { MAX_IMPORT_BYTES } from '../lib/backup';
import { parseImportPackage, type ParsedImportPackage } from '../lib/importExport';

interface ImportDialogProps {
  onClose: () => void;
  onImportFiles: (files: File[], options?: { strategy: 'copy' | 'skip-existing' }) => Promise<void>;
}

export function ImportDialog({ onClose, onImportFiles }: ImportDialogProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ParsedImportPackage[]>([]);
  const [error, setError] = useState('');
  const [strategy, setStrategy] = useState<'copy' | 'skip-existing'>('copy');
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([type="hidden"]):not(.hidden):not([disabled]), [tabindex="0"]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  async function handleFiles(files: FileList | File[]) {
    if (busy) return;
    const selected = Array.from(files);
    if (selected.length === 0) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (selected.length > 1000 || selected.reduce((sum, file) => sum + file.size, 0) > MAX_IMPORT_BYTES) throw new Error('一次导入最多 1000 个文件，总大小不超过 100 MB。');
      const packages: ParsedImportPackage[] = [];
      for (const file of selected) packages.push(await parseImportPackage(file));
      setSelectedFiles(selected);
      setPreview(packages);
    } catch (cause) {
      setSelectedFiles([]);
      setPreview([]);
      setError(cause instanceof Error ? cause.message : '导入文件预检失败，请检查文件后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (busy || !selectedFiles.length) return;
    setBusy(true);
    setError('');
    try {
      await onImportFiles(selectedFiles, { strategy });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败，原有笔记未被覆盖，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 p-6">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" className="w-full max-w-md rounded-lg border border-stone-200 bg-paper shadow-subtle">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h2 id="import-dialog-title" className="text-base font-semibold text-ink">{t('import.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-md text-stone-500 hover:bg-stone-100"
            aria-label={t('import.close')}
            title={t('import.close')}
          >
            <X size={17} />
          </button>
        </header>

        <div className="p-5">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void handleFiles(event.dataTransfer.files);
            }}
            className={`grid min-h-[180px] w-full place-items-center rounded-md border border-dashed p-6 text-center transition ${
              dragOver ? 'border-moss bg-moss/10' : 'border-stone-300 bg-white hover:bg-stone-50'
            }`}
          >
            <span className="grid justify-items-center gap-3">
              <UploadCloud size={28} className="text-moss" />
              <span className="text-sm font-medium text-ink">{busy ? t('import.busy') : t('import.dropOrChoose')}</span>
              <span className="text-xs text-stone-500">{t('import.supported')}</span>
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".md,.markdown,.html,.json,text/markdown,text/html,application/json"
            className="hidden"
            onChange={(event) => {
              if (event.target.files) {
                void handleFiles(event.target.files);
              }
              event.target.value = '';
            }}
          />
          {preview.length > 0 && (
            <div className="mt-4 grid gap-3 text-sm text-ink">
              <p aria-live="polite">预检完成：{preview.reduce((sum, item) => sum + item.notes.length, 0)} 篇笔记、{preview.reduce((sum, item) => sum + item.folders.length, 0)} 个笔记本、{preview.reduce((sum, item) => sum + item.attachments.length, 0)} 个附件、{preview.reduce((sum, item) => sum + item.history.length, 0)} 条历史。</p>
              {preview.some((item) => item.version === 2) && <p className="text-moss">V2 备份完整性校验通过。</p>}
              {Array.from(new Set(preview.flatMap((item) => item.warnings))).map((warning) => <p key={warning} className="text-xs text-amber-800">{warning}</p>)}
              <label className="grid gap-1">
                恢复方式
                <select value={strategy} onChange={(event) => setStrategy(event.target.value as typeof strategy)} disabled={busy} className="rounded border border-stone-300 bg-white px-3 py-2">
                  <option value="copy">创建独立副本，保留目录结构</option>
                  <option value="skip-existing">跳过相同标识的笔记，其余创建副本</option>
                </select>
              </label>
              <p className="text-xs text-stone-500">现有笔记不会被覆盖。恢复包中的登录凭据与云端文件路径不会导入。</p>
              <button type="button" onClick={() => void confirmImport()} disabled={busy} className="rounded-md bg-moss px-4 py-2 text-white disabled:opacity-50">{busy ? t('import.busy') : '确认导入'}</button>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </div>
      </section>
    </div>
  );
}
