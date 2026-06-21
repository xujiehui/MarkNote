import {
  ArchiveRestore,
  BookOpen,
  Box,
  Code2,
  Download,
  Folder,
  FolderOpen,
  Inbox,
  Import,
  Plus,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { ARCHIVE_FOLDER_ID, CODE_FOLDER_ID, DEFAULT_FOLDER_ID, DEFAULT_TAGS } from '../lib/db';
import { getFolderDisplayName, getTagDisplayName, useI18n } from '../i18n';
import type { SyncSessionState } from '../sync/useSyncSession';
import type { Folder as NoteFolder, WorkspaceFilter } from '../types';
import { LanguageSwitch } from './LanguageSwitch';
import { SyncPanel } from './SyncPanel';

interface SidebarProps {
  query: string;
  folders: NoteFolder[];
  activeFilter: WorkspaceFilter;
  folderCounts: Record<string, number>;
  trashCount: number;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: WorkspaceFilter) => void;
  onCreateFolder: () => void;
  onFolderContextMenu: (event: React.MouseEvent, folder: NoteFolder) => void;
  onCreateNote: () => void;
  onImportClick: () => void;
  onExportClick: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  editingFolderId?: string;
  editingFolderName: string;
  onEditingFolderNameChange: (value: string) => void;
  onCommitFolderRename: () => void;
  onCancelFolderRename: () => void;
  sync: SyncSessionState;
}

export function Sidebar({
  query,
  folders,
  activeFilter,
  folderCounts,
  trashCount,
  onQueryChange,
  onFilterChange,
  onCreateFolder,
  onFolderContextMenu,
  onCreateNote,
  onImportClick,
  onExportClick,
  searchInputRef,
  editingFolderId,
  editingFolderName,
  onEditingFolderNameChange,
  onCommitFolderRename,
  onCancelFolderRename,
  sync,
}: SidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="grid h-full w-[240px] shrink-0 grid-rows-[auto_1fr_auto] border-r border-gray-200 bg-white xl:w-[240px] lg:w-[220px]">
      <div className="border-b border-gray-200 px-4 py-3">
        <button
          type="button"
          onClick={() => onFilterChange('all')}
          className="mb-3 flex h-[72px] w-full min-w-0 items-center gap-3 rounded-lg text-left outline-none transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary-300"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-sm">M</div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight text-gray-900">MarkNote</h1>
            <p className="truncate text-xs font-medium text-gray-500">{t('sidebar.workspace')}</p>
          </div>
        </button>
        <div className="mb-4">
          <LanguageSwitch compact fullWidth shortLabels />
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-14 text-sm text-gray-900 outline-none transition focus:border-primary-300 focus:bg-white focus:ring-2 focus:ring-primary-100"
            placeholder={t('sidebar.searchPlaceholder')}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-400">
            ⌘K
          </span>
        </label>
      </div>

      <div className="overflow-y-auto px-3 py-4">
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-gray-400">{t('sidebar.quickAccess')}</div>
        <div className="mb-5 space-y-1">
          <SidebarNavButton active={activeFilter === 'all'} icon={Inbox} label={t('filter.allNotes')} onClick={() => onFilterChange('all')} />
          <SidebarNavButton
            active={activeFilter === `folder:${DEFAULT_FOLDER_ID}`}
            icon={BookOpen}
            label={t('folder.library')}
            count={folderCounts[DEFAULT_FOLDER_ID] || 0}
            onClick={() => onFilterChange(`folder:${DEFAULT_FOLDER_ID}`)}
          />
          <SidebarNavButton
            active={activeFilter === `folder:${CODE_FOLDER_ID}`}
            icon={Code2}
            label={t('folder.codeSnippets')}
            count={folderCounts[CODE_FOLDER_ID] || 0}
            onClick={() => onFilterChange(`folder:${CODE_FOLDER_ID}`)}
          />
          <SidebarNavButton
            active={activeFilter === `folder:${ARCHIVE_FOLDER_ID}`}
            icon={Box}
            label={t('folder.archive')}
            count={folderCounts[ARCHIVE_FOLDER_ID] || 0}
            onClick={() => onFilterChange(`folder:${ARCHIVE_FOLDER_ID}`)}
          />
        </div>

        <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase text-gray-400">
          <span>{t('sidebar.folders')}</span>
          <button
            type="button"
            onClick={onCreateFolder}
            className="grid h-6 w-6 place-items-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label={t('sidebar.newFolder')}
            title={t('sidebar.newFolder')}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="mb-5 space-y-1">
          {folders.map((folder) => {
            const active = activeFilter === `folder:${folder.id}`;
            const editing = editingFolderId === folder.id;
            const folderName = getFolderDisplayName(folder, t);
            const rowClassName = `group flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition ${
              active ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`;

            if (editing) {
              return (
                <div
                  key={folder.id}
                  className={rowClassName}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`folder-row-${folder.id}`}
                  onContextMenu={(event) => onFolderContextMenu(event, folder)}
                >
                  {active ? <FolderOpen size={15} /> : <Folder size={15} />}
                  <input
                    value={editingFolderName}
                    onChange={(event) => onEditingFolderNameChange(event.target.value)}
                    onBlur={onCommitFolderRename}
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCommitFolderRename();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCancelFolderRename();
                      }
                    }}
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-moss bg-white px-1.5 py-0.5 text-sm text-ink outline-none ring-2 ring-moss/15"
                    aria-label={t('folder.editName')}
                    data-testid={`folder-rename-input-${folder.id}`}
                  />
                  <span className="text-xs text-gray-400">{folderCounts[folder.id] || 0}</span>
                </div>
              );
            }

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onFilterChange(`folder:${folder.id}`)}
                onContextMenu={(event) => onFolderContextMenu(event, folder)}
                className={rowClassName}
                aria-current={active ? 'page' : undefined}
                data-testid={`folder-row-${folder.id}`}
              >
                {active ? <FolderOpen size={15} /> : <Folder size={15} />}
                <span className="min-w-0 flex-1 truncate">{folderName}</span>
                <span className="text-xs text-gray-400">{folderCounts[folder.id] || 0}</span>
              </button>
            );
          })}
        </div>

        <div className="mb-2 px-2 text-xs font-semibold uppercase text-gray-400">{t('sidebar.tags')}</div>
        <div className="grid grid-cols-2 gap-1.5">
          {DEFAULT_TAGS.map((tag, index) => (
            <button
              key={tag}
              type="button"
              onClick={() => onFilterChange(`tag:${tag}`)}
              className={`flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-xs transition ${
                activeFilter === `tag:${tag}` ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${tagDotClassNames[index % tagDotClassNames.length]}`} />
              <span className="truncate">{getTagDisplayName(tag, t)}</span>
            </button>
          ))}
        </div>

      </div>

      <div className="space-y-2 border-t border-gray-200 p-3">
        <SyncPanel sync={sync} />
        <button
          type="button"
          onClick={() => onFilterChange('trash')}
          className={`flex h-9 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition ${
            activeFilter === 'trash' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <span className="flex items-center gap-2">
            <Trash2 size={15} />
            {t('filter.trash')}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{trashCount}</span>
        </button>
        <button
          type="button"
          onClick={onCreateNote}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white transition hover:bg-primary-700 active:scale-[0.98]"
        >
          <Plus size={16} />
          {t('sidebar.createNote')}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onImportClick}
            className="flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 transition hover:bg-gray-50"
          >
            <Import size={15} />
            {t('sidebar.import')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onExportClick();
            }}
            className="flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 transition hover:bg-gray-50"
          >
            <Download size={15} />
            {t('sidebar.export')}
          </button>
        </div>
        {activeFilter === 'trash' ? (
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            <ArchiveRestore size={14} />
            {t('sidebar.trashRetention')}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

const tagDotClassNames = [
  'bg-primary-500',
  'bg-success',
  'bg-warning',
  'bg-error',
  'bg-cyan-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-gray-800',
  'bg-amber-600',
];

interface SidebarNavButtonProps {
  active: boolean;
  icon: LucideIcon;
  label: string;
  count?: number;
  onClick: () => void;
}

function SidebarNavButton({ active, icon: Icon, label, count, onClick }: SidebarNavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition ${
        active ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <Icon size={15} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' ? <span className="text-xs text-gray-400">{count}</span> : null}
    </button>
  );
}
