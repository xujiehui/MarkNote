import { Copy, Download, Folder, Pin, Tags, Trash2 } from 'lucide-react';
import { getFolderDisplayName, getTagDisplayName, useI18n } from '../i18n';
import type { ExportFormat, Folder as NoteFolder, Note } from '../types';
import { tagDotStyle } from '../lib/tags';
import { clampContextMenuPosition } from '../lib/contextMenuPosition';

const MENU_WIDTH = 224;
const MENU_GAP = 8;

interface ContextMenuState {
  note: Note;
  x: number;
  y: number;
}

interface ContextMenuProps {
  state: ContextMenuState;
  folders: NoteFolder[];
  tags: string[];
  tagColors: Record<string, string>;
  onClose: () => void;
  onTogglePin: (note: Note) => void;
  onCopy: (note: Note) => void;
  onExport: (note: Note, format: ExportFormat) => void;
  onDelete: (note: Note) => void;
  onToggleTag: (note: Note, tag: string) => void;
  onMoveToFolder: (note: Note, folderId: string) => void;
}

export function ContextMenu({ state, folders, tags, tagColors, onTogglePin, onCopy, onExport, onDelete, onToggleTag, onMoveToFolder }: ContextMenuProps) {
  const { t } = useI18n();
  const { note, x, y } = state;
  const viewport = getViewportSize();
  const estimatedHeight = 72 + 133 + 29 + folders.length * 32 + 29 + tags.length * 32 + 37;
  const maxHeight = Math.max(0, viewport.height - MENU_GAP * 2);
  const position = clampContextMenuPosition({
    x,
    y,
    menuWidth: MENU_WIDTH,
    menuHeight: Math.min(estimatedHeight, maxHeight),
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    gap: MENU_GAP,
  });
  return (
    <div
      className="fixed z-50 w-56 overflow-x-hidden overflow-y-auto rounded-lg border border-[#e5e7eb] bg-white py-1 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]"
      style={{ left: position.left, top: position.top, maxHeight }}
    >
      <button
        type="button"
        onClick={() => onTogglePin(note)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-[#374151] hover:bg-[#f3f4f6]"
      >
        <Pin size={15} />
        {note.pinned ? t('context.unpin') : t('context.pin')}
      </button>
      <button
        type="button"
        onClick={() => onCopy(note)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-[#374151] hover:bg-[#f3f4f6]"
      >
        <Copy size={15} />
        复制
      </button>
      <div className="border-t border-[#eef0f3] py-1">
        <div className="flex h-7 items-center gap-2 px-3 text-xs font-medium text-[#6b7280]">
          <Download size={13} />
          导出
        </div>
        {[
          ['markdown', 'Markdown'],
          ['html', 'HTML'],
          ['pdf', 'PDF'],
        ].map(([format, label]) => (
          <button
            key={format}
            type="button"
            onClick={() => onExport(note, format as ExportFormat)}
            className="flex h-8 w-full items-center px-3 text-left text-[#374151] hover:bg-[#f3f4f6]"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="border-t border-[#eef0f3] py-1">
        <div className="flex h-7 items-center gap-2 px-3 text-xs font-medium text-[#6b7280]">
          <Folder size={13} />
          {t('context.moveToFolder')}
        </div>
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onMoveToFolder(note, folder.id)}
            className="flex h-8 w-full items-center justify-between px-3 text-left text-[#374151] hover:bg-[#f3f4f6]"
          >
            <span className="truncate">{getFolderDisplayName(folder, t)}</span>
            {note.folderId === folder.id ? <span className="h-2 w-2 rounded-full bg-[#2f7df6]" /> : null}
          </button>
        ))}
      </div>
      <div className="border-t border-[#eef0f3] py-1">
        <div className="flex h-7 items-center gap-2 px-3 text-xs font-medium text-[#6b7280]">
          <Tags size={13} />
          {t('context.addTag')}
        </div>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onToggleTag(note, tag)}
            className="flex h-8 w-full items-center justify-between px-3 text-left text-[#374151] hover:bg-[#f3f4f6]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={tagDotStyle(tag, tagColors)} />
              <span className="truncate">{getTagDisplayName(tag, t)}</span>
            </span>
            {note.tags.includes(tag) ? <span className="h-2 w-2 rounded-full bg-[#2f7df6]" /> : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onDelete(note)}
        className="sticky bottom-0 flex h-9 w-full items-center gap-2 border-t border-[#eef0f3] bg-white px-3 text-left text-[#ef4444] hover:bg-[#f3f4f6]"
      >
        <Trash2 size={15} />
        {t('context.delete')}
      </button>
    </div>
  );
}

function getViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: MENU_WIDTH + MENU_GAP * 2, height: 600 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}
