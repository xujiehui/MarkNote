import { Edit3, FolderPlus, Trash2 } from 'lucide-react';
import { DEFAULT_FOLDER_ID } from '../lib/db';
import type { Folder as NoteFolder } from '../types';

interface FolderContextMenuState {
  folder: NoteFolder;
  x: number;
  y: number;
}

interface FolderContextMenuProps {
  state: FolderContextMenuState;
  onCreateFolder: () => void;
  onRenameFolder: (folder: NoteFolder) => void;
  onDeleteFolder: (folder: NoteFolder) => void;
}

const MENU_WIDTH = 184;
const MENU_HEIGHT = 132;
const VIEWPORT_GAP = 8;

export function FolderContextMenu({
  state,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: FolderContextMenuProps) {
  const { folder } = state;
  const canDelete = folder.id !== DEFAULT_FOLDER_ID;
  const viewport = getViewportSize();
  const left = clampToViewport(state.x, MENU_WIDTH, viewport.width);
  const top = clampToViewport(state.y, MENU_HEIGHT, viewport.height);

  return (
    <div
      className="fixed z-50 overflow-hidden rounded-md border border-stone-200 bg-white py-1 text-sm shadow-subtle"
      style={{ left, top, width: MENU_WIDTH }}
      role="menu"
      aria-label={`${folder.name} 文件夹操作`}
      data-testid="folder-context-menu"
    >
      <button
        type="button"
        onClick={onCreateFolder}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100"
        role="menuitem"
        data-testid="folder-context-create"
      >
        <FolderPlus size={15} />
        新建文件夹
      </button>
      <button
        type="button"
        onClick={() => onRenameFolder(folder)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100"
        role="menuitem"
        data-testid="folder-context-rename"
      >
        <Edit3 size={15} />
        重命名
      </button>
      <button
        type="button"
        onClick={() => onDeleteFolder(folder)}
        disabled={!canDelete}
        className="flex h-9 w-full items-center gap-2 border-t border-stone-100 px-3 text-left text-clay hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-white"
        role="menuitem"
        data-testid="folder-context-delete"
      >
        <Trash2 size={15} />
        删除
      </button>
    </div>
  );
}

function clampToViewport(position: number, size: number, viewportSize: number): number {
  return Math.max(VIEWPORT_GAP, Math.min(position, viewportSize - size - VIEWPORT_GAP));
}

function getViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: MENU_WIDTH + VIEWPORT_GAP * 2, height: MENU_HEIGHT + VIEWPORT_GAP * 2 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}
