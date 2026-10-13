import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ExportFormat, Folder, Note, NoteQuickFilter, NoteSortMode, SearchResultGroups, ShareSettings, WorkspaceFilter } from './types';
import {
  ARCHIVE_FOLDER_ID,
  createFolder,
  createNote,
  db,
  DEFAULT_TAGS,
  DEFAULT_FOLDER_ID,
  deleteFolder,
  ensureSeedNote,
  moveNoteToFolder,
  permanentlyDeleteNote,
  purgeExpiredTrash,
  renameFolder,
  restoreNote,
  softDeleteNote,
  updateNote,
} from './lib/db';
import { stripHtml } from './lib/html';
import { isDraftSaveSnapshotCurrent, resolveActiveNoteDraftValue, shouldResetActiveNoteDraftMeta } from './lib/editorDraft';
import { estimateBrowserStorage, formatBytes, storageUsagePercent, storageUsedBytes, type BrowserStorageEstimate } from './lib/storageUsage';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { EditorPane, type NoteSnapshot } from './components/EditorPane';
import { ContextMenu } from './components/ContextMenu';
import { FolderContextMenu } from './components/FolderContextMenu';
import { ImportDialog } from './components/ImportDialog';
import { ExportMenu } from './components/ExportMenu';
import { getFolderDisplayName, getTagDisplayName, useI18n } from './i18n';
import { useSyncSession } from './sync/useSyncSession';
import { syncDisplayError } from './sync/syncDisplayStatus';
import { normalizeTags, TAG_PALETTE } from './lib/tags';
import { resolveActiveNoteSelection } from './lib/activeNoteSelection';
import { NoteSaveCoordinator, createDatabaseSaveStore } from './services/noteSave';
import { addNoteHistory, hydrateNoteHistoryContent, migrateLegacyNoteHistory, getWorkspaceSnapshot, getWorkspaceEpoch, isWorkspaceCurrent, registerWorkspaceSwitchGuard, subscribeWorkspace } from './lib/db';
import { PwaUpdate } from './components/PwaUpdate';
import { readNoteSummaries, readAttachmentSummaries } from './lib/workspaceReadModel';
import { useIndexedSearch } from './hooks/useIndexedSearch';
import type { SearchRecord } from './lib/searchIndex';

interface ContextState {
  note: Note;
  x: number;
  y: number;
}

interface FolderContextState {
  folder: Folder;
  x: number;
  y: number;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const RECENT_NOTE_LIMIT = 5;
const TAG_SEARCH_ALIASES: Record<string, string> = {
  工作: 'work',
  个人: 'personal',
  代码: 'code code snippets',
  代码片段: 'code code snippets',
  学习: 'learning study',
  灵感: 'ideas inspiration',
  项目: 'projects',
  读书: 'reading books',
  会议: 'meetings',
  AI: 'ai artificial intelligence',
  设计: 'design',
};

function usePersistentState<T>(setting: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const workspace = getWorkspaceSnapshot();
  const key = `marknote-space:${workspace.id}:${setting}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key) ?? (workspace.kind === 'guest' ? window.localStorage.getItem(setting) : null);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Keep the current session responsive even if image-heavy history exceeds quota.
    }
  }, [key, value]);

  return [value, setValue];
}

function createDefaultShareSettings(noteId: string): ShareSettings {
  return {
    type: 'private',
    permission: 'read',
    linkId: noteId,
    updatedAt: Date.now(),
  };
}

function uniqueRecentNoteIds(noteIds: string[], nextId: string) {
  return [nextId, ...noteIds.filter((id) => id !== nextId)].slice(0, RECENT_NOTE_LIMIT);
}

function NoteWorkspace() {
  const workspace = useSyncExternalStore(subscribeWorkspace, getWorkspaceSnapshot, getWorkspaceSnapshot);
  return <NoteWorkspaceContent key={workspace.id} />;
}

function NoteWorkspaceContent() {
  const { t } = useI18n();
  const database = db;
  const folders = useLiveQuery(() => database.folders.orderBy('sortOrder').toArray(), [], []);
  const notes = useLiveQuery(() => readNoteSummaries(database), [database], []);
  const attachments = useLiveQuery(() => readAttachmentSummaries(database), [database], []);
  const [activeNoteId, setActiveNoteId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<WorkspaceFilter>('all');
  const [sortMode, setSortMode] = useState<NoteSortMode>('updated');
  const [quickFilter, setQuickFilter] = useState<NoteQuickFilter>('all');
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextState | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState('');
  const [editingFolderName, setEditingFolderName] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState('marknote-sidebar-collapsed', false);
  const [darkMode, setDarkMode] = usePersistentState('marknote-dark-mode', false);
  const [workspaceToast, setWorkspaceToast] = useState('');
  const history = useLiveQuery(() => activeNoteId ? database.noteHistory.where('noteId').equals(activeNoteId).toArray() : [], [database, activeNoteId], []);
  const snapshotsByNoteId = useMemo(() => {
    const result: Record<string, NoteSnapshot[]> = {};
    for (const entry of history) (result[entry.noteId] ??= []).push(entry);
    for (const entries of Object.values(result)) entries.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }, [history]);
  const [customTags, setCustomTags] = usePersistentState<string[]>('marknote-custom-tags', []);
  const [hiddenTags, setHiddenTags] = usePersistentState<string[]>('marknote-hidden-tags', []);
  const [tagColors, setTagColors] = usePersistentState<Record<string, string>>('marknote-tag-colors', {});
  const [shareSettingsByNoteId, setShareSettingsByNoteId] = usePersistentState<Record<string, ShareSettings>>('marknote-share-settings', {});
  const workspaceName = getWorkspaceSnapshot().kind === 'guest' ? t('sync.localOnly') : (syncSessionName());
  function syncSessionName() { return t('sync.accountWorkspace'); }
  const [recentNoteIds, setRecentNoteIds] = usePersistentState<string[]>('marknote-recent-notes', []);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const sync = useSyncSession();
  const syncError = syncDisplayError(sync.error, sync.backendCheck, { includeBackendCheck: Boolean(sync.session) });
  const conflictCount = notes.filter((note) => note.syncStatus === 'conflict' || note.title.includes('（冲突副本）')).length;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeNoteIdRef = useRef('');
  const pendingActiveNoteIdRef = useRef('');
  const latestDraftRef = useRef({ noteId: '', title: '', content: '' });
  const lastSavedRef = useRef<{ noteId: string; version: number } | null>(null);
  const [saveError, setSaveError] = useState('');
  const [storageEstimate, setStorageEstimate] = useState<BrowserStorageEstimate>({ usedBytes: null, quotaBytes: null, persistent: false });
  const [mobilePane, setMobilePane] = useState<'list' | 'editor'>('list');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const translationRef = useRef(t);
  translationRef.current = t;
  const saves = useMemo(() => new NoteSaveCoordinator(createDatabaseSaveStore(database, (noteIds) => {
    if (!mounted.current || !noteIds.length) return;
    setWorkspaceToast(translationRef.current('editor.draftRecovered'));
    setActiveNoteId((current) => current || noteIds[0]);
  }), (event) => {
    if (!mounted.current) return;
    if (event.state === 'error') {
      setSaveError(event.error instanceof Error ? event.error.message : translationRef.current('editor.saveFailed'));
      setSaveState('error');
    } else if (isDraftSaveSnapshotCurrent(event.snapshot, latestDraftRef.current)) {
      setSaveState(event.state);
      if (event.state === 'saved') {
        if (event.savedNoteId && event.savedVersion !== undefined) lastSavedRef.current = { noteId: event.savedNoteId, version: event.savedVersion };
        setDirty(false); setSaveError('');
        if (event.savedNoteId && event.savedNoteId !== event.snapshot.noteId) { setActiveNoteId(event.savedNoteId); setWorkspaceToast(translationRef.current('sync.conflictsPreserved', { count: 1 })); }
      }
    }
  }), [database]);
  const runAction = useCallback((action: () => Promise<unknown>) => {
    void action().catch((error: unknown) => {
      if (mounted.current) setSaveError(error instanceof Error ? error.message : t('editor.saveFailed'));
    });
  }, [t]);
  useEffect(() => registerWorkspaceSwitchGuard(async () => { await saves.flushAll(); }), [saves]);
  const activeNote = useLiveQuery(() => activeNoteId ? database.notes.get(activeNoteId) : undefined, [database, activeNoteId]);
  const activeSnapshots = activeNoteId ? snapshotsByNoteId[activeNoteId] || [] : [];
  const activeShareSettings = activeNoteId ? shareSettingsByNoteId[activeNoteId] || createDefaultShareSettings(activeNoteId) : undefined;
  const activeFolderId = activeFilter.startsWith('folder:') ? activeFilter.slice('folder:'.length) : DEFAULT_FOLDER_ID;
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || folders[0];
  const folderNameById = useMemo(() => {
    return folders.reduce<Record<string, string>>((names, folder) => {
      names[folder.id] = getFolderDisplayName(folder, t);
      return names;
    }, {});
  }, [folders, t]);
  const codeBlocksByNote = useMemo(() => new Map(notes.filter((note) => !note.deletedAt && note.content.includes('<code'))
    .map((note) => [note.id, extractCodeBlocks(note)])), [notes]);
  const searchRecords = useMemo<SearchRecord[]>(() => notes.map((note) => ({
    id: note.id,
    text: `${note.title} ${note.rawContent} ${note.tags.map((tag) => `${tag} ${getTagDisplayName(tag, t)} ${TAG_SEARCH_ALIASES[tag] || ''}`).join(' ')} ${folderNameById[note.folderId] || ''} ${(codeBlocksByNote.get(note.id) || []).map((block) => `${block.language} ${block.text}`).join(' ')}`,
  })), [notes, folderNameById, t, codeBlocksByNote]);
  const indexedSearch = useIndexedSearch(searchRecords, query);
  const hasSearchQuery = Boolean(query.trim());

  useEffect(() => {
    runAction(async () => {
      try { await saves.recoverAll(); } catch (error) { if (mounted.current) setSaveError(error instanceof Error ? error.message : t('editor.operationFailed')); }
      await purgeExpiredTrash({ database }); const id = await ensureSeedNote({ database }); if (mounted.current) setActiveNoteId((current) => current || id); });
    runAction(() => migrateLegacyNoteHistory({ database }));
  }, [database, runAction, saves, t]);

  useEffect(() => {
    if (!activeFilter.startsWith('folder:') || folders.length === 0) {
      return;
    }
    const folderId = activeFilter.slice('folder:'.length);
    if (!folders.some((folder) => folder.id === folderId)) {
      setActiveFilter(`folder:${DEFAULT_FOLDER_ID}`);
    }
  }, [activeFilter, folders]);

  useEffect(() => {
    if (!editingFolderId || folders.some((folder) => folder.id === editingFolderId)) {
      return;
    }
    let cancelled = false;
    runAction(async () => {
      const folder = await database.folders.get(editingFolderId);
      if (cancelled || folder) {
        return;
      }
      setEditingFolderId('');
      setEditingFolderName('');
    });
    return () => {
      cancelled = true;
    };
  }, [database.folders, editingFolderId, folders, runAction]);

  const addSnapshot = useCallback(
    (noteId: string, title: string, content: string, options?: { force?: boolean; createdAt?: number }) => {
      const createdAt = options?.createdAt ?? Date.now();
      runAction(() => addNoteHistory({ id: `${noteId}-${createdAt}`, noteId, title, content, createdAt }, { database }));
    }, [database, runAction],
  );

  useEffect(() => {
    if (!activeNote) {
      activeNoteIdRef.current = '';
      setDraftTitle('');
      setDraftContent('');
      setDirty(false);
      return;
    }

    const noteChanged = activeNoteIdRef.current !== activeNote.id;
    if (!noteChanged && lastSavedRef.current?.noteId === activeNote.id && (activeNote.version || 0) < lastSavedRef.current.version) return;
    setDraftTitle((currentTitle) =>
      resolveActiveNoteDraftValue({
        current: currentTitle,
        incoming: activeNote.title,
        noteChanged,
        dirty,
      }),
    );
    setDraftContent((currentContent) =>
      resolveActiveNoteDraftValue({
        current: currentContent,
        incoming: activeNote.content,
        noteChanged,
        dirty,
      }),
    );
    if (shouldResetActiveNoteDraftMeta(noteChanged, dirty)) {
      setDirty(false);
      setSaveState('idle');
    }
    activeNoteIdRef.current = activeNote.id;
    if (noteChanged) {
      latestDraftRef.current = { noteId: activeNote.id, title: activeNote.title, content: activeNote.content };
      let cancelled = false;
      runAction(async () => {
        const recovered = await saves.recover(activeNote.id);
        if (!cancelled && mounted.current && activeNoteIdRef.current === activeNote.id && recovered) {
          latestDraftRef.current = recovered;
          setDraftTitle(recovered.title); setDraftContent(recovered.content); setDirty(true);
          setWorkspaceToast(t('editor.draftRecovered'));
        }
      });
      addSnapshot(activeNote.id, activeNote.title, activeNote.content, { createdAt: activeNote.updatedAt });
      return () => { cancelled = true; };
    }
  }, [activeNote, dirty, addSnapshot, runAction, saves, t]);

  useEffect(() => {
    latestDraftRef.current = {
      noteId: activeNoteId,
      title: draftTitle,
      content: draftContent,
    };
  }, [activeNoteId, draftTitle, draftContent]);

  useEffect(() => {
    if (!saves.hasPending()) return;
    const timer = window.setTimeout(() => runAction(() => saves.flushAll()), 500);
    return () => window.clearTimeout(timer);
  }, [activeNoteId, dirty, draftTitle, draftContent, runAction, saves]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') runAction(() => saves.flushAll()); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (saves.hasPending()) { event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('beforeunload', beforeUnload); };
  }, [runAction, saves]);

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (sortMode === 'favorite') {
        if (a.pinned !== b.pinned) {
          return Number(b.pinned) - Number(a.pinned);
        }
        return b.updatedAt - a.updatedAt;
      }
      if (sortMode === 'created') {
        return b.createdAt - a.createdAt;
      }
      if (sortMode === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (a.pinned !== b.pinned) {
        return Number(b.pinned) - Number(a.pinned);
      }
      return b.updatedAt - a.updatedAt;
    });
  }, [notes, sortMode]);

  const visibleNotes = useMemo(() => {
    return sortedNotes.filter((note) => {
      const inTrash = Boolean(note.deletedAt);
      if (activeFilter === 'trash') {
        return inTrash && (!hasSearchQuery || Boolean(indexedSearch.matches?.has(note.id)));
      }
      if (inTrash) {
        return false;
      }
      if (activeFilter.startsWith('folder:') && note.folderId !== activeFilter.slice('folder:'.length)) {
        return false;
      }
      if (activeFilter.startsWith('tag:') && !note.tags.includes(activeFilter.slice('tag:'.length))) {
        return false;
      }
      if (quickFilter === 'pinned' && !note.pinned) {
        return false;
      }
      if (quickFilter === 'recent7' && note.updatedAt < Date.now() - 7 * 24 * 60 * 60 * 1000) {
        return false;
      }
      if (quickFilter === 'recent30' && note.updatedAt < Date.now() - 30 * 24 * 60 * 60 * 1000) {
        return false;
      }
      if (quickFilter === 'archived' && note.folderId !== ARCHIVE_FOLDER_ID) {
        return false;
      }
      return !hasSearchQuery || Boolean(indexedSearch.matches?.has(note.id));
    });
  }, [sortedNotes, activeFilter, quickFilter, hasSearchQuery, indexedSearch.matches]);

  const trashCount = useMemo(() => notes.filter((note) => note.deletedAt).length, [notes]);
  const folderCounts = useMemo(() => {
    return notes.reduce<Record<string, number>>((counts, note) => {
      if (!note.deletedAt) {
        counts[note.folderId] = (counts[note.folderId] || 0) + 1;
      }
      return counts;
    }, {});
  }, [notes]);
  const activeNotes = useMemo(() => notes.filter((note) => !note.deletedAt), [notes]);
  const tagCounts = useMemo(() => {
    return activeNotes.reduce<Record<string, number>>((counts, note) => {
      for (const tag of note.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
      return counts;
    }, {});
  }, [activeNotes]);
  const allTags = useMemo(() => {
    const hidden = new Set(hiddenTags);
    return normalizeTags([...DEFAULT_TAGS, ...customTags, ...activeNotes.flatMap((note) => note.tags)]).filter((tag) => !hidden.has(tag));
  }, [activeNotes, customTags, hiddenTags]);
  const storageBytes = useMemo(() => storageUsedBytes(notes, attachments), [attachments, notes]);
  const storagePercent = storageUsagePercent(storageEstimate.usedBytes ?? storageBytes, storageEstimate.quotaBytes ?? 0);
  const storageUsedLabel = storageEstimate.quotaBytes
    ? `${formatBytes(storageEstimate.usedBytes ?? storageBytes)} / ${formatBytes(storageEstimate.quotaBytes)}`
    : `≈ ${formatBytes(storageBytes)}`;
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => { void estimateBrowserStorage().then((estimate) => { if (!cancelled) setStorageEstimate(estimate); }); }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [notes, attachments, saveState]);

  const searchResults = useMemo<SearchResultGroups>(() => {
    const value = query.trim().toLowerCase();
    const liveNotes = notes.filter((note) => !note.deletedAt);
    const recentNotes = recentNoteIds
      .map((id) => liveNotes.find((note) => note.id === id))
      .filter((note): note is Note => Boolean(note))
      .slice(0, RECENT_NOTE_LIMIT)
      .map((note) => noteToSearchResult(note));

    if (!value) {
      return {
        recentNotes,
        notes: [],
        tags: [],
        codeBlocks: [],
      };
    }

    const matchingNotes = liveNotes
      .filter((note) => indexedSearch.matches?.has(note.id))
      .slice(0, 6)
      .map((note) => noteToSearchResult(note));

    const matchingTags = allTags
      .filter((tag) => `${tag} ${getTagDisplayName(tag, t)} ${TAG_SEARCH_ALIASES[tag] || ''}`.toLowerCase().includes(value))
      .slice(0, 6)
      .map((tag) => ({
        tag,
        count: tagCounts[tag] || 0,
      }));

    const matchingCodeBlocks: SearchResultGroups['codeBlocks'] = [];
    for (const note of liveNotes) {
      if (!indexedSearch.matches?.has(note.id)) continue;
      for (const block of codeBlocksByNote.get(note.id) || []) {
        if (!`${block.language} ${block.text} ${note.title}`.toLowerCase().includes(value)) continue;
        matchingCodeBlocks.push({ noteId: note.id, noteTitle: note.title || t('note.untitled'), language: block.language, preview: block.text.slice(0, 120) || t('note.emptyPreview') });
        if (matchingCodeBlocks.length === 6) break;
      }
      if (matchingCodeBlocks.length === 6) break;
    }

    return {
      recentNotes,
      notes: matchingNotes,
      tags: matchingTags,
      codeBlocks: matchingCodeBlocks,
    };
  }, [allTags, query, notes, recentNoteIds, t, tagCounts, indexedSearch.matches, codeBlocksByNote]);

  const listTitle = useMemo(() => {
    if (activeFilter === 'all') {
      return t('filter.allNotes');
    }
    if (activeFilter === 'trash') {
      return t('filter.trash');
    }
    if (activeFilter.startsWith('folder:')) {
      return activeFolder ? getFolderDisplayName(activeFolder, t) : t('filter.folder');
    }
    if (activeFilter.startsWith('tag:')) {
      return `# ${getTagDisplayName(activeFilter.slice('tag:'.length), t)}`;
    }
    return t('filter.notes');
  }, [activeFilter, activeFolder, t]);

  useEffect(() => {
    if (indexedSearch.pending) return;
    const nextActiveNoteId = resolveActiveNoteSelection({
      activeNoteId,
      pendingNoteId: pendingActiveNoteIdRef.current,
      notes,
      visibleNotes,
    });
    if (pendingActiveNoteIdRef.current && notes.some((note) => note.id === pendingActiveNoteIdRef.current)) {
      pendingActiveNoteIdRef.current = '';
    }
    if (nextActiveNoteId === activeNoteId) {
      return;
    }
    let cancelled = false;
    runAction(async () => {
      await saves.flushAll();
      if (!cancelled && mounted.current) setActiveNoteId(nextActiveNoteId);
    });
    return () => { cancelled = true; };
  }, [activeNoteId, notes, visibleNotes, indexedSearch.pending, runAction, saves]);

  useEffect(() => {
    if (!activeNoteId || !notes.some((note) => note.id === activeNoteId && !note.deletedAt)) {
      return;
    }
    setRecentNoteIds((current) => uniqueRecentNoteIds(current, activeNoteId));
  }, [activeNoteId, notes, setRecentNoteIds]);

  useEffect(() => {
    function closeMenus() {
      setContextMenu(null);
      setFolderContextMenu(null);
      setShowExport(false);
    }

    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  useEffect(() => {
    function closeMenusOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      setContextMenu(null);
      setFolderContextMenu(null);
      setShowExport(false);
      setEditingFolderId('');
      setEditingFolderName('');
    }

    const closeNavigation = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileSidebar(false); };
    window.addEventListener('keydown', closeNavigation);
    window.addEventListener('keydown', closeMenusOnEscape);
    return () => { window.removeEventListener('keydown', closeNavigation); window.removeEventListener('keydown', closeMenusOnEscape); };
  }, []);

  const manualSave = useCallback(async () => {
    if (!activeNoteId) return;
    if (!saves.hasPending(activeNoteId)) saves.stage(activeNoteId, draftTitle, draftContent, activeNote?.version);
    await saves.flush(activeNoteId);
  }, [activeNote?.version, activeNoteId, draftContent, draftTitle, saves]);

  const selectNote = useCallback(async (noteId: string) => {
    await saves.flushAll();
    setActiveNoteId(noteId);
    setMobilePane('editor');
    setMobileSidebar(false);
  }, [saves]);

  const createNewNote = useCallback(async () => {
    await saves.flushAll();
    const folderId = activeFilter.startsWith('folder:') ? activeFilter.slice('folder:'.length) : DEFAULT_FOLDER_ID;
    const note = await createNote({ title: t('note.untitled'), content: '<p></p>', folderId }, { database });
    pendingActiveNoteIdRef.current = note.id;
    setActiveFilter(`folder:${folderId}`);
    setActiveNoteId(note.id);
    setMobilePane('editor');
    setMobileSidebar(false);
  }, [activeFilter, database, saves, t]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        runAction(createNewNote);
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        runAction(manualSave);
      }
      if (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.matchMedia('(max-width: 1279px)').matches) {
          setMobileSidebar(true);
          requestAnimationFrame(() => searchInputRef.current?.focus());
        } else searchInputRef.current?.focus();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')?.click();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('button[data-editor-insert-code]')?.click();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createNewNote, manualSave, runAction]);

  function setTitle(value: string) {
    const draft = { ...latestDraftRef.current, noteId: activeNoteId, title: value };
    latestDraftRef.current = draft;
    saves.stage(draft.noteId, draft.title, draft.content, activeNote?.version);
    setDraftTitle(value); setDirty(true);
  }

  function setContent(value: string) {
    const draft = { ...latestDraftRef.current, noteId: activeNoteId, content: value };
    latestDraftRef.current = draft;
    saves.stage(draft.noteId, draft.title, draft.content, activeNote?.version);
    setDraftContent(value); setDirty(true);
  }

  function showWorkspaceToast(message: string) {
    setWorkspaceToast(message);
    window.setTimeout(() => setWorkspaceToast(''), 1500);
  }

  async function togglePin(note: Note) {
    await saves.flushAll();
    await database.transaction('rw', database.tables, async () => {
      const current = await database.notes.get(note.id);
      if (current) await updateNote(current.id, { pinned: !current.pinned }, { database });
    });
    setContextMenu(null);
  }

  async function toggleTag(note: Note, tag: string) {
    await saves.flushAll();
    await database.transaction('rw', database.tables, async () => {
      const current = await database.notes.get(note.id);
      if (!current) return;
      const tags = current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : normalizeTags([...current.tags, tag]);
      await updateNote(current.id, { tags }, { database });
    });
    setContextMenu(null);
  }

  async function toggleActiveTag(tag: string) { if (activeNote) await toggleTag(activeNote, tag); }
  async function toggleActivePin() { if (activeNote) await togglePin(activeNote); }

  async function restoreSnapshot(snapshot: NoteSnapshot) {
    const noteId = activeNoteId;
    const epoch = getWorkspaceEpoch();
    const draftAtStart = { ...latestDraftRef.current };
    await saves.flushAll();
    const content = await hydrateNoteHistoryContent(snapshot.content, noteId, { database });
    if (!isWorkspaceCurrent(epoch) || activeNoteIdRef.current !== noteId || !mounted.current) return;
    const current = await database.notes.get(noteId);
    if (!isWorkspaceCurrent(epoch) || activeNoteIdRef.current !== noteId || !current) return;
    if (!isDraftSaveSnapshotCurrent(draftAtStart, latestDraftRef.current)) {
      showWorkspaceToast(t('editor.historyRestoreInterrupted'));
      return;
    }
    latestDraftRef.current = { noteId, title: snapshot.title, content };
    saves.stage(noteId, snapshot.title, content, current.version);
    setDraftTitle(snapshot.title);
    setDraftContent(content);
    setDirty(true);
    showWorkspaceToast('已恢复历史版本，等待自动保存');
  }

  function createTag(name: string, color: string) {
    const tag = name.trim();
    if (!tag) {
      return;
    }
    setCustomTags((current) => normalizeTags([...current, tag]));
    setHiddenTags((current) => current.filter((item) => item !== tag));
    setTagColors((current) => ({ ...current, [tag]: color }));
    showWorkspaceToast(`标签「${tag}」已创建`);
  }

  function changeTagColor(tag: string, color: string) {
    setTagColors((current) => ({ ...current, [tag]: color }));
  }

  async function replaceTag(oldTag: string, newTag: string) {
    await saves.flushAll();
    await database.transaction('rw', database.tables, async () => {
      const currentNotes = await database.notes.toArray();
      for (const note of currentNotes.filter((item) => item.tags.includes(oldTag))) {
        await updateNote(note.id, { tags: normalizeTags(note.tags.map((tag) => tag === oldTag ? newTag : tag)) }, { database });
      }
    });
  }

  async function renameTag(oldTag: string, newName: string) {
    const newTag = newName.trim();
    if (!newTag || oldTag === newTag) {
      return;
    }
    await replaceTag(oldTag, newTag);
    setCustomTags((current) => normalizeTags([...current.filter((tag) => tag !== oldTag), newTag]));
    if (DEFAULT_TAGS.includes(oldTag)) {
      setHiddenTags((current) => normalizeTags([...current, oldTag]));
    }
    setTagColors((current) => {
      const { [oldTag]: oldColor, ...rest } = current;
      return { ...rest, [newTag]: oldColor || current[newTag] || TAG_PALETTE[0] };
    });
    showWorkspaceToast(`标签「${oldTag}」已改为「${newTag}」`);
  }

  async function mergeTag(sourceTag: string, targetTag: string) {
    if (!targetTag || sourceTag === targetTag) {
      return;
    }
    await replaceTag(sourceTag, targetTag);
    setCustomTags((current) => current.filter((tag) => tag !== sourceTag));
    if (DEFAULT_TAGS.includes(sourceTag)) {
      setHiddenTags((current) => normalizeTags([...current, sourceTag]));
    }
    showWorkspaceToast(`标签「${sourceTag}」已合并到「${targetTag}」`);
  }

  async function deleteTag(tag: string) {
    await saves.flushAll();
    await database.transaction('rw', database.tables, async () => {
      const currentNotes = await database.notes.toArray();
      for (const note of currentNotes.filter((item) => item.tags.includes(tag))) {
        await updateNote(note.id, { tags: note.tags.filter((item) => item !== tag) }, { database });
      }
    });
    setCustomTags((current) => current.filter((item) => item !== tag));
    if (DEFAULT_TAGS.includes(tag)) {
      setHiddenTags((current) => normalizeTags([...current, tag]));
    }
    setTagColors((current) => {
      const next = { ...current };
      delete next[tag];
      return next;
    });
    showWorkspaceToast(`标签「${tag}」已删除`);
  }

  function updateShareSettings(changes: Partial<Pick<ShareSettings, 'type' | 'permission'>>) {
    if (!activeNoteId) {
      return;
    }
    setShareSettingsByNoteId((current) => {
      const previous = current[activeNoteId] || createDefaultShareSettings(activeNoteId);
      return {
        ...current,
        [activeNoteId]: {
          ...previous,
          ...changes,
          updatedAt: Date.now(),
        },
      };
    });
  }

  async function handleDelete(note: Note) {
    await saves.flushAll();
    await softDeleteNote(note.id, { database });
    if (note.id === activeNoteId) {
      const next = visibleNotes.find((item) => item.id !== note.id);
      setActiveNoteId(next?.id || '');
    }
    setContextMenu(null);
  }

  async function handleImport(files: File[], options?: { strategy: 'copy' | 'skip-existing' }) {
    await saves.flushAll();
    const { parseImportPackage, buildRestorePlan, restoreImportPackage } = await import('./lib/importExport');
    const epoch = getWorkspaceEpoch();
    for (const file of files) {
      const parsed = await parseImportPackage(file);
      if (!isWorkspaceCurrent(epoch)) throw new Error(t('editor.noteChanged'));
      const plan = buildRestorePlan(parsed, { strategy: options?.strategy || 'copy', targetFolderId: activeFolderId, existingNoteIds: new Set(notes.map((note) => note.id)) });
      const result = await restoreImportPackage(plan, { database, epoch });
      if (result.preferences.customTags) setCustomTags((current) => normalizeTags([...current, ...result.preferences.customTags!]));
      if (result.preferences.hiddenTags) setHiddenTags((current) => normalizeTags([...current, ...result.preferences.hiddenTags!]));
      if (result.preferences.tagColors) setTagColors((current) => ({ ...current, ...result.preferences.tagColors }));
      if (result.noteIds.length) {
        pendingActiveNoteIdRef.current = result.noteIds[0];
        setActiveNoteId(result.noteIds[0]);
        setActiveFilter('all');
      }
    }
  }

  async function handleCreateFolder() {
    const folder = await createFolder(t('folder.new'), { database });
    setActiveFilter(`folder:${folder.id}`);
    setFolderContextMenu(null);
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  }

  function handleStartRenameFolder(folder: Folder) {
    setActiveFilter(`folder:${folder.id}`);
    setFolderContextMenu(null);
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  }

  async function handleCommitFolderRename() {
    if (!editingFolderId) {
      return;
    }

    const name = editingFolderName.trim();
    if (name) {
      await renameFolder(editingFolderId, name, { database });
    }
    setEditingFolderId('');
    setEditingFolderName('');
  }

  function handleCancelFolderRename() {
    setEditingFolderId('');
    setEditingFolderName('');
  }

  async function handleDeleteFolder(folder: Folder) {
    await saves.flushAll();
    if (folder.id === DEFAULT_FOLDER_ID) {
      setFolderContextMenu(null);
      return;
    }
    const ok = window.confirm(
      t('folder.deleteConfirm', {
        name: getFolderDisplayName(folder, t),
        target: t('folder.library'),
      }),
    );
    if (!ok) {
      setFolderContextMenu(null);
      return;
    }
    await deleteFolder(folder.id, undefined, { database });
    setActiveFilter(`folder:${DEFAULT_FOLDER_ID}`);
    setFolderContextMenu(null);
  }

  async function handleMoveNoteToFolder(note: Note, folderId: string) {
    await saves.flushAll();
    await moveNoteToFolder(note.id, folderId, { database });
    setContextMenu(null);
  }

  async function selectNoteFromSearch(noteId: string) {
    await saves.flushAll();
    const note = notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }
    setActiveFilter(note.deletedAt ? 'trash' : `folder:${note.folderId}`);
    setActiveNoteId(note.id);
    setMobilePane('editor');
    setQuery('');
    setMobileSidebar(false);
  }

  function selectTagFromSearch(tag: string) {
    setActiveFilter(`tag:${tag}`);
    setQuery('');
    setMobilePane('list');
    setMobileSidebar(false);
  }

  async function handleCopyNote(note: Note) {
    await saves.flushAll();
    note = (await database.notes.get(note.id)) || note;
    await navigator.clipboard.writeText(`${note.title}\n\n${stripHtml(note.content)}`);
    setContextMenu(null);
    showWorkspaceToast('笔记内容已复制');
  }

  async function handleExportNote(note: Note, format: ExportFormat = 'markdown') {
    await saves.flushAll();
    note = (await database.notes.get(note.id)) || note;
    const { exportNoteAsHtml, exportNoteAsMarkdown, exportNoteAsPdf } = await import('./lib/importExport');
    if (format === 'html') {
      exportNoteAsHtml(note);
    }
    if (format === 'markdown') {
      exportNoteAsMarkdown(note);
    }
    if (format === 'pdf') {
      await exportNoteAsPdf(note);
    }
    setContextMenu(null);
    showWorkspaceToast('已开始导出笔记');
  }

  async function exportRecoveryBackup() {
    const { exportRecoveryAsJson } = await import('./lib/recoveryBackup');
    await exportRecoveryAsJson(database, saves.pendingDrafts());
  }

  async function handleExport(format: ExportFormat) {
    await saves.flushAll();
    const { exportAllAsJson, exportNoteAsHtml, exportNoteAsMarkdown, exportNoteAsPdf, readBackupData } = await import('./lib/importExport');
    setShowExport(false);
    const current = activeNote
      ? {
          ...activeNote,
          title: draftTitle || activeNote.title,
          content: draftContent || activeNote.content,
        }
      : undefined;

    if (format === 'json') {
      await saves.recoverAll();
      const { notes: savedNotes, folders: savedFolders, attachments: savedAttachments, history: savedHistory } = await readBackupData(database);
      await exportAllAsJson(savedNotes, savedFolders, savedAttachments, savedHistory, { customTags, hiddenTags, tagColors });
      return;
    }

    if (!current) {
      return;
    }

    if (format === 'html') {
      exportNoteAsHtml(current);
    }
    if (format === 'markdown') {
      exportNoteAsMarkdown(current);
    }
    if (format === 'pdf') {
      await exportNoteAsPdf(current);
    }
  }

  return (
    <div className={`marknote-workspace h-[100dvh] min-w-0 overflow-hidden bg-white text-[#111827] ${darkMode ? 'marknote-dark' : ''} mobile-pane-${mobilePane} ${mobileSidebar ? 'mobile-sidebar-open' : ''}`}>
      <div className="mobile-navigation" aria-label={t('sidebar.navigation')}>
        <button type="button" onClick={() => setMobileSidebar((value) => !value)} aria-expanded={mobileSidebar}>{t('sidebar.navigation')}</button>
        <button type="button" onClick={() => runAction(async () => { await saves.flushAll(); setMobilePane('list'); setMobileSidebar(false); })}>{t('filter.notes')}</button>
        <button type="button" onClick={() => runAction(createNewNote)}>{t('sidebar.createNote')}</button>
      </div>
      {mobileSidebar ? <button type="button" className="mobile-sidebar-backdrop" onClick={() => setMobileSidebar(false)} aria-label={t('sidebar.closeNavigation')} /> : null}
      <div className="workspace-columns flex h-full min-h-0 overflow-hidden">
        <Sidebar
          query={query}
          folders={folders}
          activeFilter={activeFilter}
          totalNotesCount={activeNotes.length}
          folderCounts={folderCounts}
          tagCounts={tagCounts}
          tags={allTags}
          tagColors={tagColors}
          trashCount={trashCount}
          storageUsedLabel={storageUsedLabel}
          storagePercent={storagePercent}
          workspaceName={workspaceName}
          searchResults={searchResults}
          onQueryChange={setQuery}
          onFilterChange={(value) => runAction(async () => { await saves.flushAll(); setActiveFilter(value); setMobilePane('list'); setMobileSidebar(false); })}
          onWorkspaceChange={() => undefined}
          onSearchNoteSelect={(id) => runAction(() => selectNoteFromSearch(id))}
          onSearchTagSelect={selectTagFromSearch}
          onSearchCodeSelect={(id) => runAction(() => selectNoteFromSearch(id))}
          onCreateFolder={() => runAction(handleCreateFolder)}
          onCreateTag={() => setTagManagerOpen(true)}
          editingFolderId={editingFolderId}
          editingFolderName={editingFolderName}
          onEditingFolderNameChange={setEditingFolderName}
          onCommitFolderRename={() => runAction(handleCommitFolderRename)}
          onCancelFolderRename={handleCancelFolderRename}
          onFolderContextMenu={(event, folder) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenu(null);
            setShowExport(false);
            setActiveFilter(`folder:${folder.id}`);
            setFolderContextMenu({ folder, x: event.clientX, y: event.clientY });
          }}
          onCreateNote={() => runAction(createNewNote)}
          onImportClick={() => setShowImport(true)}
          onExportClick={() => setShowExport((value) => !value)}
          onTogglePanel={() => {
            if (window.matchMedia('(max-width: 1279px)').matches) setMobileSidebar(false);
            else setSidebarCollapsed((value) => !value);
          }}
          onToggleTheme={() => setDarkMode((value) => !value)}
          collapsed={sidebarCollapsed && !mobileSidebar}
          darkMode={darkMode}
          searchInputRef={searchInputRef}
          sync={sync}
        />
        <NoteList
          notes={visibleNotes}
          folders={folders}
          activeNoteId={activeNoteId}
          title={listTitle}
          isTrash={activeFilter === 'trash'}
          sortMode={sortMode}
          quickFilter={quickFilter}
          searchPending={indexedSearch.pending}
          onSortModeChange={setSortMode}
          onQuickFilterChange={setQuickFilter}
          onCreateNote={() => runAction(createNewNote)}
          onSelectNote={(id) => runAction(() => selectNote(id))}
          onContextMenu={(event, note) => {
            event.preventDefault();
            setFolderContextMenu(null);
            setShowExport(false);
            setContextMenu({ note, x: event.clientX, y: event.clientY });
          }}
          onRestoreNote={(id) => runAction(() => restoreNote(id, { database }))}
          onDeleteForever={(id) => {
            if (window.confirm(t('note.deleteForeverConfirm'))) {
              runAction(async () => { await saves.flushAll(); await permanentlyDeleteNote(id, { database }); });
            }
          }}
        />
        <EditorPane key={activeNoteId || 'empty'}
          note={activeNote ? { ...activeNote, title: draftTitle, content: draftContent } : undefined}
          saveState={saveState}
          syncConfigured={sync.configured}
          syncSessionActive={Boolean(sync.session)}
          syncSyncing={sync.syncing}
          syncCheckingBackend={sync.checkingBackend}
          syncError={syncError}
          syncLastResultOk={Boolean(sync.lastResult?.ok)}
          syncQueuePending={sync.queue.pending}
          syncQueueFailed={sync.queue.failed}
          snapshots={activeSnapshots}
          shareSettings={activeShareSettings}
          tags={allTags}
          tagColors={tagColors}
          onTitleChange={setTitle}
          onContentChange={setContent}
          onManualSave={() => runAction(manualSave)}
          onSyncRetry={() => runAction(sync.syncNow)}
          onSyncDiagnose={() => runAction(sync.checkBackend)}
          onToggleTag={(tag) => runAction(() => toggleActiveTag(tag))}
          onTogglePin={() => runAction(toggleActivePin)}
          onDeleteNote={() => {
            if (activeNote && window.confirm('删除当前笔记？可在回收站恢复。')) {
              runAction(() => handleDelete(activeNote));
            }
          }}
          onRestoreSnapshot={(snapshot) => runAction(() => restoreSnapshot(snapshot))}
          onShareSettingsChange={updateShareSettings}
        />
      </div>

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          folders={folders}
          tags={allTags}
          tagColors={tagColors}
          onClose={() => setContextMenu(null)}
          onTogglePin={(note) => runAction(() => togglePin(note))}
          onCopy={(note) => runAction(() => handleCopyNote(note))}
          onExport={(note) => runAction(() => handleExportNote(note))}
          onDelete={(note) => runAction(() => handleDelete(note))}
          onToggleTag={(note, tag) => runAction(() => toggleTag(note, tag))}
          onMoveToFolder={(note, folderId) => runAction(() => handleMoveNoteToFolder(note, folderId))}
        />
      ) : null}
      {folderContextMenu ? (
        <FolderContextMenu
          state={folderContextMenu}
          onCreateFolder={() => runAction(handleCreateFolder)}
          onRenameFolder={handleStartRenameFolder}
          onDeleteFolder={(folder) => runAction(() => handleDeleteFolder(folder))}
        />
      ) : null}
      {conflictCount ? <div role="status" className="conflict-banner">{t('sync.conflictsPreserved', { count: conflictCount })}</div> : null}
      <PwaUpdate prepareUpdate={() => saves.flushAll()} />
      {saveError ? <div role="alert" className="save-error-banner"><span>{t(saveState === 'error' ? 'editor.saveFailed' : 'editor.operationFailed')}: {saveError}</span><button type="button" onClick={() => runAction(() => saves.flushAll())}>{t('sync.retry')}</button><button type="button" onClick={() => runAction(exportRecoveryBackup)}>{t('editor.exportRecovery')}</button></div> : null}
      {showImport ? <ImportDialog onClose={() => setShowImport(false)} onImportFiles={handleImport} /> : null}
      {showExport ? <ExportMenu onClose={() => setShowExport(false)} onExport={(format) => runAction(() => handleExport(format))} /> : null}
      {tagManagerOpen ? (
        <TagManagerDialog
          tags={allTags}
          tagColors={tagColors}
          tagCounts={tagCounts}
          onClose={() => setTagManagerOpen(false)}
          onCreateTag={createTag}
          onRenameTag={(oldTag, newTag) => runAction(() => renameTag(oldTag, newTag))}
          onMergeTag={(sourceTag, targetTag) => runAction(() => mergeTag(sourceTag, targetTag))}
          onDeleteTag={(tag) => runAction(() => deleteTag(tag))}
          onChangeTagColor={changeTagColor}
        />
      ) : null}
      {workspaceToast ? <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#111827] px-3 py-2 text-sm text-white shadow-[0_18px_45px_rgba(15,23,42,0.22)]">{workspaceToast}</div> : null}
    </div>
  );
}

function noteToSearchResult(note: Note) {
  return {
    id: note.id,
    title: note.title || 'Untitled note',
    preview: (note.rawContent || stripHtml(note.content)).slice(0, 96) || 'Blank note',
  };
}

function extractCodeBlocks(note: Note) {
  const doc = new DOMParser().parseFromString(note.content, 'text/html');
  return Array.from(doc.querySelectorAll('pre code, code'))
    .map((code) => {
      const element = code as HTMLElement;
      const language =
        Array.from(element.classList)
          .find((className) => className.startsWith('language-'))
          ?.replace('language-', '') || 'plain';
      return {
        language,
        text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((block) => block.text.length > 0);
}

function TagManagerDialog({
  tags,
  tagColors,
  tagCounts,
  onClose,
  onCreateTag,
  onRenameTag,
  onMergeTag,
  onDeleteTag,
  onChangeTagColor,
}: {
  tags: string[];
  tagColors: Record<string, string>;
  tagCounts: Record<string, number>;
  onClose: () => void;
  onCreateTag: (name: string, color: string) => void;
  onRenameTag: (oldTag: string, newTag: string) => void;
  onMergeTag: (sourceTag: string, targetTag: string) => void;
  onDeleteTag: (tag: string) => void;
  onChangeTagColor: (tag: string, color: string) => void;
}) {
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0]);
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/25 px-6" onMouseDown={onClose}>
      <section
        className="w-full max-w-[560px] rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_28px_80px_rgba(15,23,42,0.24)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-[#111827]">标签管理</h2>
            <p className="mt-1 text-sm text-[#6b7280]">新建、改色、合并和删除标签会立即同步到当前笔记库。</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#6b7280] hover:bg-[#f3f4f6]" aria-label="关闭">
            ×
          </button>
        </div>

        <div className="mb-5 grid grid-cols-[1fr_auto] gap-2">
          <label className="grid gap-2 text-sm font-medium text-[#374151]">
            新建标签
            <input
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              className="h-10 rounded-lg border border-[#e5e7eb] px-3 text-sm text-[#111827] outline-none focus:border-[#3b82f6]"
              placeholder="例如：研究"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-[#374151]">
            颜色
            <input
              type="color"
              value={newTagColor}
              onChange={(event) => setNewTagColor(event.target.value)}
              className="h-10 w-14 rounded-lg border border-[#e5e7eb] bg-white p-1"
              aria-label="新标签颜色"
            />
          </label>
          <div className="col-span-2 flex flex-wrap items-center gap-2">
            {TAG_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setNewTagColor(color)}
                className={`h-6 w-6 rounded-full border ${newTagColor === color ? 'border-[#111827]' : 'border-white'} shadow-[0_0_0_1px_rgba(17,24,39,0.12)]`}
                style={{ backgroundColor: color }}
                aria-label={`选择颜色 ${color}`}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                onCreateTag(newTagName, newTagColor);
                setNewTagName('');
              }}
              className="ml-auto h-9 rounded-lg bg-[#2563eb] px-3 text-sm font-semibold text-white hover:bg-[#1d4ed8] active:scale-[0.98]"
            >
              创建标签
            </button>
          </div>
        </div>

        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {tags.map((tag) => {
            const mergeTarget = mergeTargets[tag] || tags.find((item) => item !== tag) || '';
            return (
              <div key={tag} className="rounded-lg border border-[#e5e7eb] bg-[#f8fafc] p-3">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={tagColors[tag] || TAG_PALETTE[tags.indexOf(tag) % TAG_PALETTE.length]}
                    onChange={(event) => onChangeTagColor(tag, event.target.value)}
                    className="h-8 w-8 shrink-0 rounded-md border border-[#e5e7eb] bg-white p-1"
                    aria-label={`${tag} 颜色`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[#111827]">{tag}</div>
                    <div className="text-xs text-[#6b7280]">{tagCounts[tag] || 0} 条笔记</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = window.prompt('重命名标签', tag);
                      if (next) {
                        onRenameTag(tag, next);
                      }
                    }}
                    className="h-8 rounded-md border border-[#e5e7eb] bg-white px-2 text-xs text-[#374151] hover:bg-[#f3f4f6]"
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`删除标签「${tag}」？相关笔记会移除此标签。`)) {
                        onDeleteTag(tag);
                      }
                    }}
                    className="h-8 rounded-md border border-[#fee2e2] bg-white px-2 text-xs text-[#ef4444] hover:bg-[#fff1f2]"
                  >
                    删除
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <select
                    value={mergeTarget}
                    onChange={(event) => setMergeTargets((current) => ({ ...current, [tag]: event.target.value }))}
                    className="h-8 rounded-md border border-[#e5e7eb] bg-white px-2 text-xs text-[#374151] outline-none"
                    aria-label={`${tag} 合并目标`}
                  >
                    {tags
                      .filter((item) => item !== tag)
                      .map((item) => (
                        <option key={item} value={item}>
                          合并到：{item}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onMergeTag(tag, mergeTarget)}
                    disabled={!mergeTarget}
                    className="h-8 rounded-md border border-[#dbeafe] bg-white px-2 text-xs text-[#2563eb] hover:bg-[#eff6ff] disabled:opacity-40"
                  >
                    合并
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default NoteWorkspace;
