import { Braces, FileCode2, FileDown, FileText } from 'lucide-react';
import type { ExportFormat } from '../types';

interface ExportMenuProps {
  onExport: (format: ExportFormat) => void;
  onClose: () => void;
}

export function ExportMenu({ onExport }: ExportMenuProps) {
  return (
    <div className="fixed bottom-[74px] left-3 z-40 w-[216px] overflow-hidden rounded-md border border-stone-200 bg-white py-1 text-sm shadow-subtle">
      <button
        type="button"
        onClick={() => onExport('html')}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100"
      >
        <FileCode2 size={15} />
        导出为 HTML
      </button>
      <button
        type="button"
        onClick={() => onExport('pdf')}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100"
      >
        <FileDown size={15} />
        导出为 PDF
      </button>
      <button
        type="button"
        onClick={() => onExport('markdown')}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100"
      >
        <FileText size={15} />
        导出为 Markdown
      </button>
      <button
        type="button"
        onClick={() => onExport('json')}
        className="flex h-9 w-full items-center gap-2 border-t border-stone-100 px-3 text-left text-stone-700 hover:bg-stone-100"
      >
        <Braces size={15} />
        全量 JSON 备份
      </button>
    </div>
  );
}
