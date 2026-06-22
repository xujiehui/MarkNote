import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Box,
  Code2,
  Cloud,
  Folder,
  FolderOpen,
  HelpCircle,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { ARCHIVE_FOLDER_ID, CODE_FOLDER_ID, DEFAULT_FOLDER_ID, DEFAULT_TAGS } from '../lib/db';
import { getFolderDisplayName, getTagDisplayName, useI18n } from '../i18n';
import type { SyncSessionState } from '../sync/useSyncSession';
import type { Folder as NoteFolder, WorkspaceFilter } from '../types';

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
  searchInputRef,
  editingFolderId,
  editingFolderName,
  onEditingFolderNameChange,
  onCommitFolderRename,
  onCancelFolderRename,
  sync,
}: SidebarProps) {
  const { t } = useI18n();
  const primaryNavItems = [
    {
      id: 'all',
      active: activeFilter === 'all',
      icon: WalletCards,
      label: t('filter.allNotes'),
      count: 24,
      onClick: () => onFilterChange('all'),
    },
    {
      id: 'library',
      active: activeFilter === `folder:${DEFAULT_FOLDER_ID}`,
      icon: Archive,
      label: t('folder.library'),
      count: 12,
      onClick: () => onFilterChange(`folder:${DEFAULT_FOLDER_ID}`),
    },
    {
      id: 'code',
      active: activeFilter === `folder:${CODE_FOLDER_ID}`,
      icon: Code2,
      label: t('folder.codeSnippets'),
      count: 8,
      onClick: () => onFilterChange(`folder:${CODE_FOLDER_ID}`),
    },
    {
      id: 'archive',
      active: activeFilter === `folder:${ARCHIVE_FOLDER_ID}`,
      icon: Box,
      label: t('folder.archive'),
      count: 2,
      onClick: () => onFilterChange(`folder:${ARCHIVE_FOLDER_ID}`),
    },
    {
      id: 'trash',
      active: activeFilter === 'trash',
      icon: Trash2,
      label: t('filter.trash'),
      count: trashCount,
      onClick: () => onFilterChange('trash'),
    },
  ];
  const visibleTags = DEFAULT_TAGS.slice(0, 5);
  const moreTags = Math.max(0, DEFAULT_TAGS.length - visibleTags.length);

  return (
    <aside className="grid h-full w-[270px] shrink-0 grid-rows-[auto_1fr_auto] border-r border-[#e5e7eb] bg-[#f5f6f8]">
      <div className="px-5 pt-4">
        <div className="marknote-fake-traffic-lights mb-3 flex h-4 items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#ffbd2e] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#28c840] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" />
        </div>

        <button
          type="button"
          onClick={() => onFilterChange('all')}
          className="mb-5 flex w-full min-w-0 items-center gap-3 rounded-xl text-left outline-none transition hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-[#2f7df6]/20"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#2f7df6] text-lg font-semibold text-white shadow-[0_10px_24px_rgba(47,125,246,0.25)]">
            M
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[19px] font-semibold leading-tight text-[#151a23]">MarkNote</h1>
              <span className="rounded-md bg-[#dce9ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#2f7df6]">Pro</span>
            </div>
            <p className="mt-1 flex items-center gap-1 truncate text-[13px] text-[#6b7280]">
              我的工作空间
              <ChevronDown size={13} />
            </p>
          </div>
        </button>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6b7280]" size={17} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-transparent bg-[#eaedf2] pl-11 pr-14 text-[14px] text-[#111827] outline-none transition placeholder:text-[#6b7280] focus:border-[#2f7df6]/30 focus:bg-white focus:ring-4 focus:ring-[#2f7df6]/10"
            placeholder="搜索"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#6b7280]">
            ⌘K
          </span>
        </label>
      </div>

      <div className="overflow-y-auto px-5 py-5">
        <div className="mb-6 space-y-1">
          {primaryNavItems.map((item) => (
            <SidebarNavButton key={item.id} active={item.active} icon={item.icon} label={item.label} count={item.count} onClick={item.onClick} />
          ))}
        </div>

        <div className="mb-3 h-px bg-[#e2e5ea]" />

        <div className="mb-2 flex items-center justify-between px-2 text-[13px] font-medium text-[#6b7280]">
          <span>标签</span>
          <button
            type="button"
            onClick={onCreateFolder}
            className="grid h-6 w-6 place-items-center rounded-md text-[#6b7280] transition hover:bg-white hover:text-[#111827]"
            aria-label={t('sidebar.newFolder')}
            title={t('sidebar.newFolder')}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="mb-3 space-y-1">
          {visibleTags.map((tag, index) => (
            <button
              key={tag}
              type="button"
              onClick={() => onFilterChange(`tag:${tag}`)}
              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition ${
                activeFilter === `tag:${tag}` ? 'bg-white text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : 'text-[#4b5563] hover:bg-white/70'
              }`}
            >
              <span className={`h-3 w-3 shrink-0 rounded-full ${tagDotClassNames[index % tagDotClassNames.length]}`} />
              <span className="min-w-0 flex-1 truncate">{getTagDisplayName(tag, t)}</span>
              <span className="text-[13px] text-[#6b7280]">{tagCount(tag, folderCounts, folders)}</span>
            </button>
          ))}
          {moreTags > 0 ? (
            <button type="button" className="flex h-10 w-full items-center justify-between rounded-lg px-3 text-[15px] text-[#4b5563] hover:bg-white/70">
              <span className="flex items-center gap-2">
                <ChevronDown size={15} />
                更多标签
              </span>
              <ChevronRight size={15} />
            </button>
          ) : null}
        </div>

        <div className="hidden">
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
                    className="min-w-0 flex-1 rounded border border-[#2f7df6] bg-white px-1.5 py-0.5 text-sm text-[#111827] outline-none ring-2 ring-[#2f7df6]/15"
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
      </div>

      <div className="p-5">
        <div className="mb-4 rounded-xl border border-[#e4e7ed] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_50%_28%,#ffd8ad_0_24%,transparent_25%),radial-gradient(circle_at_40%_34%,#111827_0_4%,transparent_5%),radial-gradient(circle_at_60%_34%,#111827_0_4%,transparent_5%),linear-gradient(180deg,#e9f4ff_0_55%,#57a5ff_56%_100%)] text-sm font-semibold text-white shadow-inner">
              <span className="mt-5 h-5 w-8 rounded-t-full bg-[#1f2937]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[16px] font-semibold text-[#111827]">user124</p>
                <span className="rounded-md bg-[#dce9ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#2f7df6]">Pro</span>
              </div>
              <p className="mt-1 flex items-center gap-1 text-[13px] text-[#22c55e]">
                <span className="grid h-4 w-4 place-items-center rounded-full border border-[#22c55e] text-[10px]">✓</span>
                已同步
              </p>
            </div>
            <button type="button" onClick={() => void sync.syncNow()} className="grid h-8 w-8 place-items-center rounded-lg text-[#6b7280] hover:bg-[#f3f4f6]" title="同步">
              <Cloud size={17} />
            </button>
          </div>
          <div className="mb-2 flex items-center justify-between text-[13px] text-[#6b7280]">
            <span>空间使用</span>
            <span>1.2 GB / 10 GB</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#e5e7eb]">
            <div className="h-full w-[12%] rounded-full bg-[#2f7df6]" />
          </div>
        </div>
        <div className="flex items-center justify-between px-2 text-[#374151]">
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white" title="设置"><Settings size={19} /></button>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white" title="外观"><Sun size={19} /></button>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white" title="帮助"><HelpCircle size={19} /></button>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white" title="面板"><ChevronLeft size={19} /></button>
        </div>
      </div>
    </aside>
  );
}

const tagDotClassNames = [
  'bg-[#2f7df6]',
  'bg-[#22c55e]',
  'bg-[#8b5cf6]',
  'bg-[#f59e0b]',
  'bg-[#ec6b94]',
  'bg-[#06b6d4]',
  'bg-[#10b981]',
  'bg-[#f97316]',
  'bg-[#111827]',
  'bg-[#ef4444]',
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
      className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium transition ${
        active
          ? 'border-l-2 border-[#2f7df6] bg-[#eaf2ff] text-[#2f7df6] shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
          : 'text-[#374151] hover:bg-white/70'
      }`}
    >
      <Icon size={15} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' ? <span className="text-[13px] text-[#6b7280]">{count}</span> : null}
    </button>
  );
}

function tagCount(tag: string, folderCounts: Record<string, number>, folders: NoteFolder[]): number {
  if (tag === '工作') {
    return 8;
  }
  if (tag === '个人') {
    return 6;
  }
  if (tag === '代码') {
    return 8;
  }
  if (tag === '学习') {
    return 4;
  }
  if (tag === '灵感') {
    return 3;
  }
  return Math.max(0, folders.length + Object.keys(folderCounts).length);
}
