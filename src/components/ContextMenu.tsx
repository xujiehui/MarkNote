import { Folder, Pin, Tags, Trash2 } from 'lucide-react';
import { DEFAULT_TAGS } from '../lib/db';
import type { Folder as NoteFolder, Note } from '../types';

interface ContextMenuState {
  note: Note;
  x: number;
  y: number;
}

interface ContextMenuProps {
  state: ContextMenuState;
  folders: NoteFolder[];
  onClose: () => void;
  onTogglePin: (note: Note) => void;
  onDelete: (note: Note) => void;
  onToggleTag: (note: Note, tag: string) => void;
  onMoveToFolder: (note: Note, folderId: string) => void;
}

export function ContextMenu({ state, folders, onTogglePin, onDelete, onToggleTag, onMoveToFolder }: ContextMenuProps) {
  const { note, x, y } = state;
  return (
    <div
      className="fixed z-50 w-48 overflow-hidden rounded-md border border-stone-200 bg-white py-1 text-sm shadow-subtle"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        onClick={() => onTogglePin(note)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100"
      >
        <Pin size={15} />
        {note.pinned ? '取消置顶' : '置顶'}
      </button>
      <div className="border-t border-stone-100 py-1">
        <div className="flex h-7 items-center gap-2 px-3 text-xs font-medium text-stone-500">
          <Folder size={13} />
          移动到文件夹
        </div>
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onMoveToFolder(note, folder.id)}
            className="flex h-8 w-full items-center justify-between px-3 text-left text-stone-700 hover:bg-stone-100"
          >
            <span className="truncate">{folder.name}</span>
            {note.folderId === folder.id ? <span className="h-2 w-2 rounded-full bg-moss" /> : null}
          </button>
        ))}
      </div>
      <div className="border-t border-stone-100 py-1">
        <div className="flex h-7 items-center gap-2 px-3 text-xs font-medium text-stone-500">
          <Tags size={13} />
          添加标签
        </div>
        {DEFAULT_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onToggleTag(note, tag)}
            className="flex h-8 w-full items-center justify-between px-3 text-left text-stone-700 hover:bg-stone-100"
          >
            <span>{tag}</span>
            {note.tags.includes(tag) ? <span className="h-2 w-2 rounded-full bg-moss" /> : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onDelete(note)}
        className="flex h-9 w-full items-center gap-2 border-t border-stone-100 px-3 text-left text-clay hover:bg-stone-100"
      >
        <Trash2 size={15} />
        删除
      </button>
    </div>
  );
}
