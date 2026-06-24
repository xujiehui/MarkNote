import { useState } from 'react';
import { FixedSizeList as VirtualList } from 'react-window';
import { Check, ListFilter, MoreHorizontal, Pin, Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Folder as NoteFolder, Note, NoteQuickFilter, NoteSortMode } from '../types';
import { formatUpdatedAt } from '../lib/date';
import { getPreview } from '../lib/html';
import { getTagDisplayName, useI18n } from '../i18n';

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
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const sortOptions: Array<{ mode: NoteSortMode; label: string }> = [
    { mode: 'updated', label: t('note.sortUpdated') },
    { mode: 'created', label: t('note.sortCreated') },
    { mode: 'title', label: t('note.sortTitle') },
    { mode: 'favorite', label: '收藏数' },
  ];
  const filterOptions: Array<{ mode: NoteQuickFilter; label: string }> = [
    { mode: 'all', label: '全部' },
    { mode: 'pinned', label: t('note.filterPinned') },
    { mode: 'archived', label: t('note.filterArchived') },
    { mode: 'recent7', label: t('note.filterRecent7') },
    { mode: 'recent30', label: t('note.filterRecent30') },
  ];

  return (
    <section className="grid h-full w-[360px] shrink-0 grid-rows-[auto_1fr] border-r border-[#e5e7eb] bg-white">
      <header className="px-5 pb-4 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold leading-tight text-[#111827]">{title}</h2>
            <p className="mt-1 text-[14px] text-[#6b7280]">{t('note.records', { count: notes.length })}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <IconMenuButton
                title={t('note.sort')}
                active={sortOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setSortOpen((value) => !value);
                  setFilterOpen(false);
                }}
              >
                <ListFilter size={18} />
              </IconMenuButton>
              {sortOpen ? (
                <MenuPanel>
                  {sortOptions.map((option) => (
                    <MenuOption
                      key={option.mode}
                      active={sortMode === option.mode}
                      label={option.label}
                      onClick={() => {
                        onSortModeChange(option.mode);
                        setSortOpen(false);
                      }}
                    />
                  ))}
                </MenuPanel>
              ) : null}
            </div>
            <div className="relative">
              <IconMenuButton
                title={t('note.filter')}
                active={filterOpen || quickFilter !== 'all'}
                onClick={(event) => {
                  event.stopPropagation();
                  setFilterOpen((value) => !value);
                  setSortOpen(false);
                }}
              >
                <SlidersHorizontal size={18} />
              </IconMenuButton>
              {filterOpen ? (
                <MenuPanel>
                  {filterOptions.map((option) => (
                    <MenuOption
                      key={option.mode}
                      active={quickFilter === option.mode}
                      label={option.label}
                      onClick={() => {
                        onQuickFilterChange(option.mode);
                        setFilterOpen(false);
                      }}
                    />
                  ))}
                </MenuPanel>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onCreateNote}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#2f7df6] text-white shadow-[0_10px_22px_rgba(47,125,246,0.25)] transition hover:bg-[#256ce0] active:scale-[0.98]"
              title={t('sidebar.createNote')}
              aria-label={t('sidebar.createNote')}
            >
              <Plus size={19} />
            </button>
          </div>
        </div>
      </header>

      {notes.length === 0 ? (
        <div className="grid place-items-center px-6 text-center text-sm text-[#6b7280]">
          {isTrash ? t('note.trashEmpty') : t('note.noMatches')}
        </div>
      ) : (
        <VirtualList height={Math.max(320, window.innerHeight - 90)} itemCount={notes.length} itemSize={144} width={360}>
          {({ index, style }) => {
            const note = notes[index];
            const active = note.id === activeNoteId;
            return (
              <div style={style}>
                <article
                  onClick={() => onSelectNote(note.id)}
                  onContextMenu={(event) => onContextMenu(event, note)}
                  className={`note-card mx-5 mt-2 h-[128px] cursor-default rounded-lg border p-4 transition ${
                    active
                      ? 'is-active border-[#d7e7ff] border-l-[#2f7df6] border-l-4 bg-[#f3f8ff] shadow-[0_12px_26px_rgba(15,23,42,0.05)]'
                      : 'border-[#e5e7eb] bg-white hover:-translate-y-0.5 hover:border-[#d4d8df] hover:shadow-[0_12px_26px_rgba(15,23,42,0.05)]'
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <h3 className="line-clamp-1 text-[16px] font-semibold leading-6 text-[#111827]">{note.title || t('note.untitled')}</h3>
                    <span className="flex shrink-0 items-center gap-4 text-[#4b5563]">
                      {note.pinned ? <Pin size={15} className="fill-[#2f7df6] text-[#2f7df6]" /> : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onContextMenu(event, note);
                        }}
                        className="grid h-6 w-6 place-items-center rounded-md hover:bg-[#eef2f7]"
                        aria-label="笔记操作"
                        title="笔记操作"
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </span>
                  </div>
                  <p className="line-clamp-2 min-h-[38px] text-[14px] leading-[1.5] text-[#4b5563]">
                    {notePreview(note, t('note.emptyPreview'))}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                    <time className="text-[14px] text-[#4b5563]">{formatUpdatedAt(note.updatedAt, locale)}</time>
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
                          className="grid h-6 w-6 place-items-center rounded border border-[#e5e7eb] bg-white text-[#4b5563] hover:bg-[#f3f4f6]"
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
                          className="grid h-6 w-6 place-items-center rounded border border-[#e5e7eb] bg-white text-[#ef4444] hover:bg-[#f3f4f6]"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-2">
                        {noteTags(note).map((tag) => (
                          <span key={tag} className={`rounded-lg px-2.5 py-1 text-[13px] font-medium ${tagPillClass(tag)}`}>
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

function IconMenuButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[#f3f4f6] ${
        active ? 'bg-[#eaf2ff] text-[#2f7df6]' : 'text-[#111827]'
      }`}
    >
      {children}
    </button>
  );
}

function MenuPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute right-0 top-10 z-40 w-40 overflow-hidden rounded-lg border border-[#e5e7eb] bg-white py-1 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-full items-center justify-between px-3 text-left transition ${
        active ? 'bg-[#eaf2ff] text-[#2f7df6]' : 'text-[#374151] hover:bg-[#f3f4f6]'
      }`}
    >
      <span>{label}</span>
      {active ? <Check size={14} /> : null}
    </button>
  );
}

function notePreview(note: Note, emptyPreview: string) {
  return getPreview(note.content, 54, emptyPreview);
}

function noteTags(note: Note) {
  return note.tags.slice(0, 2);
}

function tagPillClass(tag: string) {
  if (tag === '个人') {
    return 'bg-[#dcfce7] text-[#16a34a]';
  }
  if (tag === '代码' || tag === '代码片段') {
    return 'bg-[#f3e8ff] text-[#8b5cf6]';
  }
  if (tag === '工作') {
    return 'bg-[#dbeafe] text-[#2f7df6]';
  }
  if (tag === '学习') {
    return 'bg-[#ffedd5] text-[#f59e0b]';
  }
  if (tag === '灵感') {
    return 'bg-[#fce7f3] text-[#ec4899]';
  }
  return 'bg-[#dbeafe] text-[#2f7df6]';
}
