import { UploadCloud, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n';

interface ImportDialogProps {
  onClose: () => void;
  onImportFiles: (files: File[]) => Promise<void>;
}

export function ImportDialog({ onClose, onImportFiles }: ImportDialogProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0) {
      return;
    }

    setBusy(true);
    try {
      await onImportFiles(selected);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 p-6">
      <section className="w-full max-w-md rounded-lg border border-stone-200 bg-paper shadow-subtle">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{t('import.title')}</h2>
          <button
            type="button"
            onClick={onClose}
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
            }}
          />
        </div>
      </section>
    </div>
  );
}
