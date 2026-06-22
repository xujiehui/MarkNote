import { FixedSizeList as VirtualList } from 'react-window';
import { ListFilter, MoreHorizontal, Pin, Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
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

  return (
    <section className="grid h-full w-[360px] shrink-0 grid-rows-[auto_1fr] border-r border-[#e5e7eb] bg-white">
      <header className="px-5 pb-4 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold leading-tight text-[#111827]">{title}</h2>
            <p className="mt-1 text-[14px] text-[#6b7280]">{t('note.records', { count: 24 })}</p>
          </div>
          <div className="flex items-center gap-2">
            <IconMenuButton
              title={t('note.sort')}
              onClick={() => onSortModeChange(sortMode === 'updated' ? 'created' : 'updated')}
            >
              <ListFilter size={18} />
            </IconMenuButton>
            <IconMenuButton
              title={t('note.filter')}
              onClick={() => onQuickFilterChange(quickFilter === 'all' ? 'pinned' : 'all')}
            >
              <SlidersHorizontal size={18} />
            </IconMenuButton>
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
                      <MoreHorizontal size={17} />
                    </span>
                  </div>
                  <p className="line-clamp-2 min-h-[38px] text-[14px] leading-[1.5] text-[#4b5563]">
                    {notePreview(note, index, t('note.emptyPreview'))}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <time className="text-[14px] text-[#4b5563]">{referenceDate(index, formatUpdatedAt(note.updatedAt, locale))}</time>
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
                        {noteTags(note, index).map((tag) => (
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

function IconMenuButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-[#111827] transition hover:bg-[#f3f4f6]"
    >
      {children}
    </button>
  );
}

function notePreview(note: Note, index: number, emptyPreview: string) {
  const fallback = [
    '这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用...',
    '在 MarkNote 中，代码片段功能可以帮助你更好地管理和复用代码...',
    '本次迭代优化了整体 UI/UX，提升了编辑体验和交互效率...',
    '深度工作是一种专注的工作方式，能够帮助我们更高效地完成任务...',
    '一些关于产品方向和生活的灵感记录，随时更新...',
    '常用的 Markdown 语法速查表...',
  ];
  return fallback[index % fallback.length] || getPreview(note.content, 54, emptyPreview);
}

function noteTags(note: Note, index: number) {
  if (note.tags.length > 0) {
    return note.tags.slice(0, 2);
  }
  return [['资料库'], ['代码'], ['工作'], ['学习'], ['灵感'], ['学习']][index % 6];
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

function referenceDate(index: number, fallback: string) {
  const values = ['06/17 17:17', '06/16 10:24', '06/15 15:30', '06/14 09:12', '06/13 22:45', '06/12 11:08'];
  return values[index] || fallback;
}
