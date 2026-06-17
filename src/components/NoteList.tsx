import { FixedSizeList as VirtualList } from 'react-window';
import { Folder, Pin, MoreVertical, Trash2, RotateCcw } from 'lucide-react';
import type { Folder as NoteFolder, Note } from '../types';
import { formatUpdatedAt } from '../lib/date';
import { getPreview } from '../lib/html';

interface NoteListProps {
  notes: Note[];
  folders: NoteFolder[];
  activeNoteId?: string;
  title: string;
  isTrash: boolean;
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
  onSelectNote,
  onContextMenu,
  onRestoreNote,
  onDeleteForever,
}: NoteListProps) {
  return (
    <section className="grid h-full w-[300px] shrink-0 grid-rows-[auto_1fr] border-r border-stone-200 bg-paper">
      <header className="flex h-[73px] items-end justify-between border-b border-stone-200 px-4 pb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-xs text-stone-500">{notes.length} 条记录</p>
        </div>
      </header>

      {notes.length === 0 ? (
        <div className="grid place-items-center px-6 text-center text-sm text-stone-500">
          {isTrash ? '回收站为空' : '没有匹配的笔记'}
        </div>
      ) : (
        <VirtualList height={window.innerHeight - 73} itemCount={notes.length} itemSize={96} width={300}>
          {({ index, style }) => {
            const note = notes[index];
            const active = note.id === activeNoteId;
            const folder = folders.find((item) => item.id === note.folderId);
            return (
              <div style={style}>
                <article
                  onClick={() => onSelectNote(note.id)}
                  onContextMenu={(event) => onContextMenu(event, note)}
                  className={`mx-3 mt-3 h-[84px] cursor-default rounded-md border p-3 transition ${
                    active
                      ? 'border-moss bg-white shadow-subtle'
                      : 'border-transparent bg-white/70 hover:border-stone-200 hover:bg-white'
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-semibold text-ink">{note.title || '未命名笔记'}</h3>
                    <span className="flex shrink-0 items-center gap-1 text-stone-400">
                      {note.pinned ? <Pin size={13} className="fill-moss text-moss" /> : null}
                      <MoreVertical size={14} />
                    </span>
                  </div>
                  <p className="line-clamp-1 text-xs text-stone-500">{getPreview(note.content)}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <time className="text-xs text-stone-400">{formatUpdatedAt(note.updatedAt)}</time>
                    {isTrash ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          title="还原"
                          aria-label="还原"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRestoreNote(note.id);
                          }}
                          className="grid h-6 w-6 place-items-center rounded border border-stone-200 bg-white text-stone-600 hover:bg-stone-100"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          type="button"
                          title="彻底删除"
                          aria-label="彻底删除"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteForever(note.id);
                          }}
                          className="grid h-6 w-6 place-items-center rounded border border-stone-200 bg-white text-clay hover:bg-stone-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-1">
                        {folder ? (
                          <span className="flex min-w-0 items-center gap-1 rounded bg-linen px-1.5 py-0.5 text-[11px] text-stone-500">
                            <Folder size={11} />
                            <span className="max-w-[72px] truncate">{folder.name}</span>
                          </span>
                        ) : null}
                        {note.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="rounded bg-linen px-1.5 py-0.5 text-[11px] text-stone-500">
                            {tag}
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
