import { useEffect, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Box,
  Code2,
  Cloud,
  Download,
  Folder,
  FolderOpen,
  HelpCircle,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { ARCHIVE_FOLDER_ID, CODE_FOLDER_ID, DEFAULT_FOLDER_ID } from '../lib/db';
import { getFolderDisplayName, getTagDisplayName, useI18n } from '../i18n';
import type { SyncSessionState } from '../sync/useSyncSession';
import { isSyncCurrent, syncDisplayError } from '../sync/syncDisplayStatus';
import type { Folder as NoteFolder, SearchResultGroups, WorkspaceFilter } from '../types';
import { tagDotStyle } from '../lib/tags';
import { SyncPanel } from './SyncPanel';

interface SidebarProps {
  query: string;
  folders: NoteFolder[];
  activeFilter: WorkspaceFilter;
  totalNotesCount: number;
  folderCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  tags: string[];
  tagColors: Record<string, string>;
  trashCount: number;
  storageUsedLabel: string;
  storagePercent: number;
  workspaceName: string;
  searchResults: SearchResultGroups;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: WorkspaceFilter) => void;
  onWorkspaceChange: (value: string) => void;
  onSearchNoteSelect: (noteId: string) => void;
  onSearchTagSelect: (tag: string) => void;
  onSearchCodeSelect: (noteId: string) => void;
  onCreateFolder: () => void;
  onCreateTag: () => void;
  onFolderContextMenu: (event: React.MouseEvent, folder: NoteFolder) => void;
  onCreateNote: () => void;
  onImportClick: () => void;
  onExportClick: () => void;
  onTogglePanel: () => void;
  onToggleTheme: () => void;
  collapsed: boolean;
  darkMode: boolean;
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
  totalNotesCount,
  folderCounts,
  tagCounts,
  tags,
  tagColors,
  trashCount,
  storageUsedLabel,
  storagePercent,
  workspaceName,
  searchResults,
  onQueryChange,
  onFilterChange,
  onWorkspaceChange,
  onSearchNoteSelect,
  onSearchTagSelect,
  onSearchCodeSelect,
  onCreateFolder,
  onCreateTag,
  onFolderContextMenu,
  onCreateNote,
  onImportClick,
  onExportClick,
  onTogglePanel,
  onToggleTheme,
  collapsed,
  darkMode,
  searchInputRef,
  editingFolderId,
  editingFolderName,
  onEditingFolderNameChange,
  onCommitFolderRename,
  onCancelFolderRename,
  sync,
}: SidebarProps) {
  const { t } = useI18n();
  const [showAllTags, setShowAllTags] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<string[]>(() => readWorkspaceOptions(workspaceName));
  const tagItems = showAllTags ? tags : tags.slice(0, 5);
  const moreTags = Math.max(0, tags.length - 5);
  const customFolders = folders.filter((folder) => ![DEFAULT_FOLDER_ID, CODE_FOLDER_ID, ARCHIVE_FOLDER_ID].includes(folder.id));
  const syncError = syncDisplayError(sync.error, sync.backendCheck, { includeBackendCheck: Boolean(sync.session) });
  const syncCurrent = isSyncCurrent({
    lastResultOk: Boolean(sync.lastResult?.ok),
    queuePending: sync.queue.pending,
    queueFailed: sync.queue.failed,
  });
  const syncLabel = sync.syncing
    ? t('sync.syncing')
    : sync.checkingBackend
      ? t('sync.backendChecking')
    : syncError
      ? t('sync.failed')
      : !sync.configured
        ? t('sync.localOnly')
        : sync.session
          ? syncCurrent
            ? t('sync.synced')
            : t('sync.ready')
          : t('sync.signInRequired');
  const syncClassName = syncError
    ? 'text-[#ef4444]'
    : sync.syncing || sync.checkingBackend
      ? 'text-[#f59e0b]'
      : sync.configured && sync.session
        ? 'text-[#22c55e]'
        : 'text-[#6b7280]';
  const hasSearchQuery = query.trim().length > 0;
  const showSearchPanel = !collapsed && (searchOpen || hasSearchQuery);

  useEffect(() => {
    function closeFloatingMenus() {
      setSearchOpen(false);
      setWorkspaceOpen(false);
      setSettingsOpen(false);
      setSyncPanelOpen(false);
    }

    window.addEventListener('click', closeFloatingMenus);
    return () => window.removeEventListener('click', closeFloatingMenus);
  }, []);
  const primaryNavItems = [
    {
      id: 'all',
      active: activeFilter === 'all',
      icon: WalletCards,
      label: t('filter.allNotes'),
      count: totalNotesCount,
      onClick: () => onFilterChange('all'),
    },
    {
      id: 'library',
      active: activeFilter === `folder:${DEFAULT_FOLDER_ID}`,
      icon: Archive,
      label: t('folder.library'),
      count: folderCounts[DEFAULT_FOLDER_ID] || 0,
      onClick: () => onFilterChange(`folder:${DEFAULT_FOLDER_ID}`),
    },
    {
      id: 'code',
      active: activeFilter === `folder:${CODE_FOLDER_ID}`,
      icon: Code2,
      label: t('folder.codeSnippets'),
      count: folderCounts[CODE_FOLDER_ID] || 0,
      onClick: () => onFilterChange(`folder:${CODE_FOLDER_ID}`),
    },
    {
      id: 'archive',
      active: activeFilter === `folder:${ARCHIVE_FOLDER_ID}`,
      icon: Box,
      label: t('folder.archive'),
      count: folderCounts[ARCHIVE_FOLDER_ID] || 0,
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
  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 1400);
  }

  function changeWorkspace(name: string) {
    setWorkspaces((current) => {
      const next = mergeWorkspaces(current, name);
      writeWorkspaceOptions(next);
      return next;
    });
    onWorkspaceChange(name);
    setWorkspaceOpen(false);
  }

  function createWorkspace() {
    const name = window.prompt(t('sidebar.workspaceCreatePrompt'), t('sidebar.workspaceNewName'))?.trim();
    if (!name) {
      return;
    }
    setWorkspaces((current) => {
      const next = current.includes(name) ? current : [...current, name];
      writeWorkspaceOptions(next);
      return next;
    });
    changeWorkspace(name);
  }

  return (
    <aside className={`grid h-full shrink-0 grid-rows-[auto_1fr_auto] border-r border-[#e5e7eb] bg-[#f5f6f8] transition-[width] duration-300 ${collapsed ? 'w-[76px]' : 'w-[270px]'}`}>
      <div className="min-w-0 px-5 pt-4">
        <div className="marknote-fake-traffic-lights mb-3 flex h-4 items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#ffbd2e] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#28c840] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" />
        </div>

        <div className="relative mb-5 flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => onFilterChange('all')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#2f7df6] text-lg font-semibold text-white shadow-[0_10px_24px_rgba(47,125,246,0.25)] outline-none transition hover:bg-[#2563eb] focus-visible:ring-2 focus-visible:ring-[#2f7df6]/30"
            aria-label={t('filter.allNotes')}
            title={t('filter.allNotes')}
          >
            M
          </button>
          <div className={`min-w-0 flex-1 ${collapsed ? 'hidden' : ''}`}>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[19px] font-semibold leading-tight text-[#151a23]">MarkNote</h1>
              <span className="rounded-md bg-[#dce9ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#2f7df6]">Pro</span>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setWorkspaceOpen((value) => !value);
                setSearchOpen(false);
                setSyncPanelOpen(false);
              }}
              className="mt-1 flex max-w-full items-center gap-1 truncate rounded-md text-left text-[13px] text-[#6b7280] outline-none transition hover:text-[#111827] focus-visible:ring-2 focus-visible:ring-[#2f7df6]/20"
              aria-haspopup="menu"
              aria-expanded={workspaceOpen}
            >
              <span className="truncate">{workspaceName}</span>
              <ChevronDown size={13} />
            </button>
          </div>
          {workspaceOpen && !collapsed ? (
            <div
              className="absolute left-0 top-14 z-40 w-full overflow-hidden rounded-xl border border-[#e5e7eb] bg-white p-1 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]"
              onMouseDown={(event) => event.preventDefault()}
              role="menu"
            >
              {workspaces.map((workspace) => (
                <button
                  key={workspace}
                  type="button"
                  onClick={() => changeWorkspace(workspace)}
                  className={`flex h-9 w-full items-center justify-between rounded-lg px-3 text-left ${
                    workspace === workspaceName ? 'bg-[#eaf2ff] font-semibold text-[#2563eb]' : 'text-[#374151] hover:bg-[#f3f4f6]'
                  }`}
                  role="menuitem"
                >
                  <span className="truncate">{workspace}</span>
                  {workspace === workspaceName ? <span className="text-xs">✓</span> : null}
                </button>
              ))}
              <button type="button" onClick={createWorkspace} className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[#374151] hover:bg-[#f3f4f6]" role="menuitem">
                <Plus size={15} />
                {t('sidebar.workspaceCreate')}
              </button>
            </div>
          ) : null}
        </div>

        <div className={`relative ${collapsed ? 'hidden' : ''}`}>
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6b7280]" size={17} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setSearchOpen(true);
              onQueryChange(event.target.value);
            }}
            onMouseDown={() => setSearchOpen(true)}
            onClick={() => setSearchOpen(true)}
            onFocus={() => {
              setSearchOpen(true);
              setWorkspaceOpen(false);
              setSyncPanelOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchOpen(false);
                event.currentTarget.blur();
              }
            }}
            className="h-11 w-full rounded-lg border border-transparent bg-[#eaedf2] pl-11 pr-14 text-[14px] text-[#111827] outline-none transition placeholder:text-[#6b7280] focus:border-[#2f7df6]/30 focus:bg-white focus:ring-4 focus:ring-[#2f7df6]/10"
            placeholder={t('sidebar.searchPlaceholder')}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#6b7280]">
            ⌘K
          </span>
          {showSearchPanel ? (
            <SearchResultsPanel
              hasSearchQuery={hasSearchQuery}
              results={searchResults}
              tagColors={tagColors}
              onSelectNote={(noteId) => {
                onSearchNoteSelect(noteId);
                setSearchOpen(false);
              }}
              onSelectTag={(tag) => {
                onSearchTagSelect(tag);
                setSearchOpen(false);
              }}
              onSelectCode={(noteId) => {
                onSearchCodeSelect(noteId);
                setSearchOpen(false);
              }}
            />
          ) : null}
        </div>
      </div>

      <div className={`min-w-0 overflow-x-hidden overflow-y-auto px-5 py-5 ${collapsed ? 'px-3' : ''}`}>
        <div className="mb-6 space-y-1">
          {primaryNavItems.map((item) => (
            <SidebarNavButton key={item.id} active={item.active} icon={item.icon} label={item.label} count={item.count} collapsed={collapsed} onClick={item.onClick} />
          ))}
        </div>

        <div className="mb-3 h-px bg-[#e2e5ea]" />

        <div className="mb-2 flex items-center justify-between px-2 text-[13px] font-medium text-[#6b7280]">
          <span className={collapsed ? 'hidden' : ''}>{t('sidebar.folders')}</span>
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
        <div className="mb-5 space-y-1">
          {customFolders.map((folder) => {
            const active = activeFilter === `folder:${folder.id}`;
            const editing = editingFolderId === folder.id;
            const folderName = getFolderDisplayName(folder, t);
            const rowClassName = `group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition ${
              active ? 'border-l-2 border-[#2f7df6] bg-[#eaf2ff] text-[#2f7df6] shadow-[0_1px_2px_rgba(15,23,42,0.04)]' : 'text-[#374151] hover:bg-white/70'
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
                  {active ? <FolderOpen size={15} className="shrink-0" /> : <Folder size={15} className="shrink-0" />}
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
                    className={`min-w-0 flex-1 rounded border border-[#2f7df6] bg-white px-1.5 py-0.5 text-sm text-[#111827] outline-none ring-2 ring-[#2f7df6]/15 ${collapsed ? 'hidden' : ''}`}
                    aria-label={t('folder.editName')}
                    data-testid={`folder-rename-input-${folder.id}`}
                  />
                  <span className={`text-[13px] text-[#6b7280] ${collapsed ? 'hidden' : ''}`}>{folderCounts[folder.id] || 0}</span>
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
                title={collapsed ? folderName : undefined}
              >
                {active ? <FolderOpen size={15} className="shrink-0" /> : <Folder size={15} className="shrink-0" />}
                <span className={`min-w-0 flex-1 truncate ${collapsed ? 'hidden' : ''}`}>{folderName}</span>
                <span className={`text-[13px] text-[#6b7280] ${collapsed ? 'hidden' : ''}`}>{folderCounts[folder.id] || 0}</span>
              </button>
            );
          })}
          {customFolders.length === 0 && !collapsed ? <div className="rounded-lg px-3 py-2 text-[13px] text-[#9ca3af]">{t('sidebar.noFolders')}</div> : null}
        </div>

        <div className="mb-3 h-px bg-[#e2e5ea]" />

        <div className="mb-2 flex items-center justify-between px-2 text-[13px] font-medium text-[#6b7280]">
          <span className={collapsed ? 'hidden' : ''}>{t('sidebar.tags')}</span>
          <button
            type="button"
            onClick={onCreateTag}
            className="grid h-6 w-6 place-items-center rounded-md text-[#6b7280] transition hover:bg-white hover:text-[#111827]"
            aria-label={t('sidebar.newTag')}
            title={t('sidebar.newTag')}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="mb-3 space-y-1">
          {tagItems.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onFilterChange(`tag:${tag}`)}
              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition ${
                activeFilter === `tag:${tag}` ? 'bg-white text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : 'text-[#4b5563] hover:bg-white/70'
              }`}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={tagDotStyle(tag, tagColors)} />
              <span className={`min-w-0 flex-1 truncate ${collapsed ? 'hidden' : ''}`}>{getTagDisplayName(tag, t)}</span>
              <span className={`text-[13px] text-[#6b7280] ${collapsed ? 'hidden' : ''}`}>{tagCounts[tag] || 0}</span>
            </button>
          ))}
          {moreTags > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllTags((value) => !value)}
              className="flex h-10 w-full items-center justify-between rounded-lg px-3 text-[15px] text-[#4b5563] hover:bg-white/70"
              aria-expanded={showAllTags}
            >
              <span className="flex items-center gap-2">
                <ChevronDown size={15} />
                <span className={collapsed ? 'hidden' : ''}>{showAllTags ? t('sidebar.collapseTags') : t('sidebar.moreTags')}</span>
              </span>
              <ChevronRight className={showAllTags ? 'rotate-90' : ''} size={15} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 p-5">
        <div className={`relative mb-4 rounded-xl border border-[#e4e7ed] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] ${collapsed ? 'hidden' : ''}`}>
          {syncPanelOpen ? (
            <div className="absolute bottom-[calc(100%+10px)] left-0 right-0 z-50" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
              <SyncPanel sync={sync} />
            </div>
          ) : null}
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_50%_28%,#ffd8ad_0_24%,transparent_25%),radial-gradient(circle_at_40%_34%,#111827_0_4%,transparent_5%),radial-gradient(circle_at_60%_34%,#111827_0_4%,transparent_5%),linear-gradient(180deg,#e9f4ff_0_55%,#57a5ff_56%_100%)] text-sm font-semibold text-white shadow-inner">
              <span className="mt-5 h-5 w-8 rounded-t-full bg-[#1f2937]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[16px] font-semibold text-[#111827]">{sync.session?.user.email || t('sync.localWorkspace')}</p>
                <span className="rounded-md bg-[#dce9ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#2f7df6]">Pro</span>
              </div>
              <p className={`mt-1 flex items-center gap-1 text-[13px] ${syncClassName}`}>
                <span className="grid h-4 w-4 place-items-center rounded-full border border-current text-[10px]">✓</span>
                {syncLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (sync.session && !syncError) {
                  void sync.syncNow();
                  return;
                }
                setSyncPanelOpen((value) => !value);
              }}
              className="grid h-8 w-8 place-items-center rounded-lg text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-60"
              title={sync.session ? t('sync.syncNow') : t('sync.signInTitle')}
              aria-label={sync.session ? t('sync.syncNow') : t('sync.signInTitle')}
              disabled={sync.loading || sync.syncing || sync.checkingBackend}
            >
              <Cloud size={17} />
            </button>
          </div>
          <div className="mb-2 flex items-center justify-between text-[13px] text-[#6b7280]">
            <span>{t('sidebar.storageUsed')}</span>
            <span>{storageUsedLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#e5e7eb]">
            <div className="h-full rounded-full bg-[#2f7df6]" style={{ width: `${storagePercent}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between px-2 text-[#374151]">
          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setSettingsOpen((value) => !value);
              }}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white"
              title={t('sidebar.settings')}
              aria-label={t('sidebar.settings')}
            >
              <Settings size={19} />
            </button>
            {settingsOpen ? (
              <div className="absolute bottom-10 left-0 z-40 w-44 overflow-hidden rounded-lg border border-[#e5e7eb] bg-white py-1 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                <button type="button" onClick={onCreateNote} className="flex h-9 w-full items-center gap-2 px-3 text-left text-[#374151] hover:bg-[#f3f4f6]">
                  <Plus size={15} />
                  {t('sidebar.createNote')}
                </button>
                <button type="button" onClick={onCreateFolder} className="flex h-9 w-full items-center gap-2 px-3 text-left text-[#374151] hover:bg-[#f3f4f6]">
                  <Folder size={15} />
                  {t('sidebar.newFolder')}
                </button>
                <button type="button" onClick={onImportClick} className="flex h-9 w-full items-center gap-2 px-3 text-left text-[#374151] hover:bg-[#f3f4f6]">
                  <Upload size={15} />
                  {t('sidebar.import')}
                </button>
                <button type="button" onClick={onExportClick} className="flex h-9 w-full items-center gap-2 px-3 text-left text-[#374151] hover:bg-[#f3f4f6]">
                  <Download size={15} />
                  {t('sidebar.export')}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white"
            title={darkMode ? t('sidebar.lightMode') : t('sidebar.darkMode')}
            aria-label={darkMode ? t('sidebar.lightMode') : t('sidebar.darkMode')}
          >
            <Sun size={19} />
          </button>
          <button
            type="button"
            onClick={() => showNotice(t('sidebar.helpHint'))}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white"
            title={t('sidebar.help')}
            aria-label={t('sidebar.help')}
          >
            <HelpCircle size={19} />
          </button>
          <button type="button" onClick={onTogglePanel} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white" title={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')} aria-label={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}>
            {collapsed ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}
          </button>
        </div>
        {notice ? <div className="mt-2 rounded-lg bg-[#111827] px-3 py-2 text-xs text-white">{notice}</div> : null}
      </div>
    </aside>
  );
}

interface SidebarNavButtonProps {
  active: boolean;
  icon: LucideIcon;
  label: string;
  count?: number;
  collapsed: boolean;
  onClick: () => void;
}

function SidebarNavButton({ active, icon: Icon, label, count, collapsed, onClick }: SidebarNavButtonProps) {
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
      <span className={`min-w-0 flex-1 truncate ${collapsed ? 'hidden' : ''}`}>{label}</span>
      {typeof count === 'number' ? <span className={`text-[13px] text-[#6b7280] ${collapsed ? 'hidden' : ''}`}>{count}</span> : null}
    </button>
  );
}

function SearchResultsPanel({
  hasSearchQuery,
  results,
  tagColors,
  onSelectNote,
  onSelectTag,
  onSelectCode,
}: {
  hasSearchQuery: boolean;
  results: SearchResultGroups;
  tagColors: Record<string, string>;
  onSelectNote: (noteId: string) => void;
  onSelectTag: (tag: string) => void;
  onSelectCode: (noteId: string) => void;
}) {
  const { t } = useI18n();
  const hasResults = results.recentNotes.length + results.notes.length + results.tags.length + results.codeBlocks.length > 0;

  return (
    <div
      className="absolute left-0 right-0 top-12 z-50 max-h-[560px] overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
      onMouseDown={(event) => event.preventDefault()}
      data-search-results-panel="true"
    >
      {!hasResults ? (
        <div className="rounded-lg bg-[#f8fafc] px-3 py-4 text-center text-xs text-[#6b7280]">
          {hasSearchQuery ? t('sidebar.searchEmpty') : t('sidebar.searchNoRecent')}
        </div>
      ) : null}

      {!hasSearchQuery ? (
        <SearchGroup title={t('sidebar.searchRecent')} emptyText={t('sidebar.searchNoRecent')}>
          {results.recentNotes.map((note) => (
            <SearchNoteButton key={note.id} title={note.title} preview={note.preview} onClick={() => onSelectNote(note.id)} />
          ))}
        </SearchGroup>
      ) : (
        <>
          <SearchGroup title={t('sidebar.searchRecent')}>
            {results.recentNotes.map((note) => (
              <SearchNoteButton key={note.id} title={note.title} preview={note.preview} onClick={() => onSelectNote(note.id)} />
            ))}
          </SearchGroup>
          <SearchGroup title={t('sidebar.searchNotes')} emptyText={t('sidebar.searchEmpty')}>
            {results.notes.map((note) => (
              <SearchNoteButton key={note.id} title={note.title} preview={note.preview} onClick={() => onSelectNote(note.id)} />
            ))}
          </SearchGroup>
          <SearchGroup title={t('sidebar.searchTags')} emptyText={t('sidebar.searchEmpty')}>
            {results.tags.map((tag) => (
              <button
                key={tag.tag}
                type="button"
                onClick={() => onSelectTag(tag.tag)}
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[#374151] hover:bg-[#f3f4f6]"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={tagDotStyle(tag.tag, tagColors)} />
                <span className="min-w-0 flex-1 truncate"># {getTagDisplayName(tag.tag, t)}</span>
                <span className="text-xs text-[#9ca3af]">{tag.count}</span>
              </button>
            ))}
          </SearchGroup>
          <SearchGroup title={t('sidebar.searchCode')} emptyText={t('sidebar.searchEmpty')}>
            {results.codeBlocks.map((block, index) => (
              <button
                key={`${block.noteId}-${index}-${block.language}`}
                type="button"
                onClick={() => onSelectCode(block.noteId)}
                className="w-full rounded-lg px-2 py-2 text-left hover:bg-[#f3f4f6]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold text-[#111827]">{block.noteTitle}</span>
                  <span className="shrink-0 rounded bg-[#eaf2ff] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#2563eb]">{block.language}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-mono text-[11px] leading-5 text-[#6b7280]">{block.preview}</div>
              </button>
            ))}
          </SearchGroup>
        </>
      )}
    </div>
  );
}

function SearchGroup({ title, emptyText, children }: { title: string; emptyText?: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasChildren && !emptyText) {
    return null;
  }

  return (
    <section className="py-1">
      <div className="mb-1 px-2 text-[11px] font-semibold uppercase text-[#9ca3af]">{title}</div>
      <div className="space-y-1">{hasChildren ? children : <div className="rounded-lg px-2 py-2 text-xs text-[#9ca3af]">{emptyText}</div>}</div>
    </section>
  );
}

function SearchNoteButton({ title, preview, onClick }: { title: string; preview: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-lg px-2 py-2 text-left hover:bg-[#f3f4f6]">
      <div className="truncate text-xs font-semibold text-[#111827]">{title}</div>
      <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#6b7280]">{preview}</div>
    </button>
  );
}

function readWorkspaceOptions(activeWorkspace: string) {
  try {
    const raw = window.localStorage.getItem('marknote-workspace-options');
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return mergeWorkspaces(parsed, activeWorkspace);
  } catch {
    return mergeWorkspaces([], activeWorkspace);
  }
}

function writeWorkspaceOptions(workspaces: string[]) {
  window.localStorage.setItem('marknote-workspace-options', JSON.stringify(workspaces));
}

function mergeWorkspaces(workspaces: string[], activeWorkspace: string) {
  const defaults = ['Workspace Pro', 'Personal Space'];
  return Array.from(new Set([...defaults, activeWorkspace, ...workspaces].filter(Boolean)));
}
