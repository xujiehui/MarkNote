import {
  ArchiveRestore,
  Download,
  FolderOpen,
  Import,
  Plus,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';
import { DEFAULT_TAGS } from '../lib/db';
import type { TagFilter } from '../types';

interface SidebarProps {
  query: string;
  activeFilter: TagFilter;
  trashCount: number;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: TagFilter) => void;
  onCreateNote: () => void;
  onImportClick: () => void;
  onExportClick: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
}

export function Sidebar({
  query,
  activeFilter,
  trashCount,
  onQueryChange,
  onFilterChange,
  onCreateNote,
  onImportClick,
  onExportClick,
  searchInputRef,
}: SidebarProps) {
  return (
    <aside className="grid h-full w-[240px] shrink-0 grid-rows-[auto_1fr_auto] border-r border-stone-200 bg-linen">
      <div className="border-b border-stone-200 p-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-sm font-bold text-white">M</div>
          <div>
            <h1 className="text-lg font-semibold leading-tight text-ink">MarkNote</h1>
            <p className="text-xs text-stone-500">桌面笔记工作台</p>
          </div>
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={16} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-10 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/20"
            placeholder="搜索标题或正文"
          />
        </label>
      </div>

      <div className="overflow-y-auto px-3 py-4">
        <button
          type="button"
          onClick={() => onFilterChange('all')}
          className={`mb-3 flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium transition ${
            activeFilter === 'all' ? 'bg-white text-ink shadow-subtle' : 'text-stone-600 hover:bg-white/70'
          }`}
        >
          <FolderOpen size={16} />
          全部笔记
        </button>

        <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-stone-500">标签</div>
        <div className="space-y-1">
          {DEFAULT_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onFilterChange(tag)}
              className={`flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition ${
                activeFilter === tag ? 'bg-white text-ink shadow-subtle' : 'text-stone-600 hover:bg-white/70'
              }`}
            >
              <Tag size={15} />
              {tag}
            </button>
          ))}
        </div>

      </div>

      <div className="space-y-2 border-t border-stone-200 p-3">
        <button
          type="button"
          onClick={() => onFilterChange('trash')}
          className={`flex h-9 w-full items-center justify-between rounded-md px-3 text-left text-sm transition ${
            activeFilter === 'trash' ? 'bg-white text-ink shadow-subtle' : 'text-stone-600 hover:bg-white/70'
          }`}
        >
          <span className="flex items-center gap-2">
            <Trash2 size={15} />
            回收站
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-600">{trashCount}</span>
        </button>
        <button
          type="button"
          onClick={onCreateNote}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white transition hover:bg-graphite"
        >
          <Plus size={16} />
          新建笔记
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onImportClick}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white text-sm text-stone-700 transition hover:bg-stone-100"
          >
            <Import size={15} />
            导入
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onExportClick();
            }}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white text-sm text-stone-700 transition hover:bg-stone-100"
          >
            <Download size={15} />
            导出
          </button>
        </div>
        {activeFilter === 'trash' ? (
          <div className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs text-stone-500">
            <ArchiveRestore size={14} />
            删除笔记保留 30 天
          </div>
        ) : null}
      </div>
    </aside>
  );
}
