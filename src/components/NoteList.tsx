import { FixedSizeList as VirtualList } from 'react-window';
import { ChevronDown, Folder, MoreVertical, Pin, Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Folder as NoteFolder, Note, NoteQuickFilter, NoteSortMode } from '../types';
import { formatUpdatedAt } from '../lib/date';
import { getPreview } from '../lib/html';
import { getFolderDisplayName, getTagDisplayName, useI18n } from '../i18n';

interface NoteListProps {
  notes: Note[];
  folders: NoteFolder[];
  activeNoteId?: string;
  title: string;
  isTrash: boolean;
  sortMode: NoteSortMode;
  quickFilter: NoteQuickFilter;
  onSortModeChange: (mode: NoteSortMode) => void;
  onQuickFilterChange: (filter: NoteQuickFilter) => void;
  onCreateNote: () => void;
  onSelectNote: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, note: Note) => void;
  onRestoreNote: (id: string) => void;
  onDeleteForever: (id: string) => void;
}

export function NoteList({
  notes,
  folders,
  activeNoteId,
  title,
  isTrash,
  sortMode,
  quickFilter,
  onSortModeChange,
  onQuickFilterChange,
  onCreateNote,
  onSelectNote,
  onContextMenu,
  onRestoreNote,
  onDeleteForever,
}: NoteListProps) {
  const { locale, t } = useI18n();

  return (
    <section className="grid h-full w-[360px] shrink-0 grid-rows-[auto_1fr] border-r border-gray-200 bg-gray-50">
      <header className="border-b border-gray-200 px-4 py-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500">{t('note.records', { count: notes.length })}</p>
          </div>
          <button
            type="button"
            onClick={onCreateNote}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white transition hover:bg-primary-700 active:scale-[0.98]"
            title={t('sidebar.createNote')}
            aria-label={t('sidebar.createNote')}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="relative">
            <span className="sr-only">{t('note.sort')}</span>
            <select
              value={sortMode}
              onChange={(event) => onSortModeChange(event.target.value as NoteSortMode)}
              className="h-9 w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 pr-8 text-xs font-medium text-gray-700 outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            >
              <option value="updated">{t('note.sortUpdated')}</option>
              <option value="created">{t('note.sortCreated')}</option>
              <option value="title">{t('note.sortTitle')}</option>
              <option value="favorite">{t('note.filterPinned')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          </label>
          <label className="relative">
            <span className="sr-only">{t('note.filter')}</span>
            <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <select
              value={quickFilter}
              onChange={(event) => onQuickFilterChange(event.target.value as NoteQuickFilter)}
              className="h-9 w-full appearance-none rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-xs font-medium text-gray-700 outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            >
              <option value="all">{t('note.filter')}</option>
              <option value="pinned">{t('note.filterPinned')}</option>
              <option value="recent7">{t('note.filterRecent7')}</option>
              <option value="recent30">{t('note.filterRecent30')}</option>
              <option value="archived">{t('note.filterArchived')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          </label>
        </div>
      </header>

      {notes.length === 0 ? (
        <div className="grid place-items-center px-6 text-center text-sm text-gray-500">
          {isTrash ? t('note.trashEmpty') : t('note.noMatches')}
        </div>
      ) : (
        <VirtualList height={Math.max(320, window.innerHeight - 185)} itemCount={notes.length} itemSize={132} width={360}>
          {({ index, style }) => {
            const note = notes[index];
            const active = note.id === activeNoteId;
            const folder = folders.find((item) => item.id === note.folderId);
            return (
              <div style={style}>
                <article
                  onClick={() => onSelectNote(note.id)}
                  onContextMenu={(event) => onContextMenu(event, note)}
                  className={`note-card mx-3 mt-3 h-[116px] cursor-default rounded-lg border p-4 transition ${
                    active
                      ? 'is-active border-primary-200 bg-primary-50 shadow-subtle'
                      : 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-subtle'
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-semibold text-gray-900">{note.title || t('note.untitled')}</h3>
                    <span className="flex shrink-0 items-center gap-1 text-gray-400">
                      {note.pinned ? <Pin size={13} className="fill-primary-500 text-primary-500" /> : null}
                      <MoreVertical size={14} />
                    </span>
                  </div>
                  <p className="line-clamp-2 min-h-[32px] text-xs leading-4 text-gray-500">
                    {getPreview(note.content, 48, t('note.emptyPreview'))}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <time className="text-xs text-gray-400">{formatUpdatedAt(note.updatedAt, locale)}</time>
                    {isTrash ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          title={t('note.restore')}
                          aria-label={t('note.restore')}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRestoreNote(note.id);
                          }}
                          className="grid h-6 w-6 place-items-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          type="button"
                          title={t('note.deleteForever')}
                          aria-label={t('note.deleteForever')}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteForever(note.id);
                          }}
                          className="grid h-6 w-6 place-items-center rounded border border-gray-200 bg-white text-error hover:bg-gray-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-1">
                        {folder ? (
                          <span className="flex min-w-0 items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                            <Folder size={11} />
                            <span className="max-w-[72px] truncate">{getFolderDisplayName(folder, t)}</span>
                          </span>
                        ) : null}
                        {note.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="rounded-md bg-primary-50 px-1.5 py-0.5 text-[11px] text-primary-700">
                            {getTagDisplayName(tag, t)}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </article>
              </div>
            );
          }}
        </VirtualList>
      )}
    </section>
  );
}
