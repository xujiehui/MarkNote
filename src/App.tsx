import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  upsertNote,
  updateNote,
} from './lib/db';
import { stripHtml } from './lib/html';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { EditorPane, type NoteSnapshot } from './components/EditorPane';
import { ContextMenu } from './components/ContextMenu';
import { FolderContextMenu } from './components/FolderContextMenu';
import { ImportDialog } from './components/ImportDialog';
import { ExportMenu } from './components/ExportMenu';
import { LandingPage } from './LandingPage';
import { getFolderDisplayName, getTagDisplayName, useI18n } from './i18n';
import { useSyncSession } from './sync/useSyncSession';
import { normalizeTags, TAG_PALETTE } from './lib/tags';

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

type SaveState = 'idle' | 'saving' | 'saved';

const FIVE_MINUTES = 5 * 60 * 1000;
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

function usePersistentState<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function uniqueRecentNoteIds(noteIds: string[], nextId: string) {
  return [nextId, ...noteIds.filter((id) => id !== nextId)].slice(0, RECENT_NOTE_LIMIT);
}

function NoteWorkspace() {
  const { t } = useI18n();
  const folders = useLiveQuery(() => db.folders.orderBy('sortOrder').toArray(), [], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
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
  const [snapshotsByNoteId, setSnapshotsByNoteId] = usePersistentState<Record<string, NoteSnapshot[]>>('marknote-note-snapshots', {});
  const [customTags, setCustomTags] = usePersistentState<string[]>('marknote-custom-tags', []);
  const [hiddenTags, setHiddenTags] = usePersistentState<string[]>('marknote-hidden-tags', []);
  const [tagColors, setTagColors] = usePersistentState<Record<string, string>>('marknote-tag-colors', {});
  const [shareSettingsByNoteId, setShareSettingsByNoteId] = usePersistentState<Record<string, ShareSettings>>('marknote-share-settings', {});
  const [workspaceName, setWorkspaceName] = usePersistentState('marknote-active-workspace', 'Workspace Pro');
  const [recentNoteIds, setRecentNoteIds] = usePersistentState<string[]>('marknote-recent-notes', []);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const sync = useSyncSession();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query, 180);
  const activeNote = notes.find((note) => note.id === activeNoteId);
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

  useEffect(() => {
    void purgeExpiredTrash();
    void ensureSeedNote().then((id) => setActiveNoteId((current) => current || id));
  }, []);

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
    void db.folders.get(editingFolderId).then((folder) => {
      if (cancelled || folder) {
        return;
      }
      setEditingFolderId('');
      setEditingFolderName('');
    });
    return () => {
      cancelled = true;
    };
  }, [editingFolderId, folders]);

  const addSnapshot = useCallback(
    (noteId: string, title: string, content: string, options?: { force?: boolean; createdAt?: number }) => {
      const createdAt = options?.createdAt ?? Date.now();
      setSnapshotsByNoteId((current) => {
        const list = current[noteId] || [];
        const latest = list[0];
        if (!options?.force && latest && latest.title === title && latest.content === content) {
          return current;
        }
        if (!options?.force && latest && createdAt - latest.createdAt < FIVE_MINUTES) {
          return current;
        }

        return {
          ...current,
          [noteId]: [
            {
              id: `${noteId}-${createdAt}`,
              title,
              content,
              createdAt,
            },
            ...list,
          ].slice(0, 24),
        };
      });
    },
    [setSnapshotsByNoteId],
  );

  useEffect(() => {
    if (!activeNote) {
      setDraftTitle('');
      setDraftContent('');
      setDirty(false);
      return;
    }

    setDraftTitle(activeNote.title);
    setDraftContent(activeNote.content);
    setDirty(false);
    setSaveState('idle');
    setSnapshotsByNoteId((current) => {
      if (current[activeNote.id]?.length) {
        return current;
      }
      return {
        ...current,
        [activeNote.id]: [
          {
            id: `${activeNote.id}-${activeNote.updatedAt}`,
            title: activeNote.title,
            content: activeNote.content,
            createdAt: activeNote.updatedAt,
          },
        ],
      };
    });
  }, [activeNote, setSnapshotsByNoteId]);

  useEffect(() => {
    if (!activeNoteId || !dirty) {
      return;
    }

    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      const savedAt = Date.now();
      await updateNote(activeNoteId, {
        title: draftTitle || t('note.untitled'),
        content: draftContent,
        updatedAt: savedAt,
      });
      addSnapshot(activeNoteId, draftTitle || t('note.untitled'), draftContent, { createdAt: savedAt });
      setDirty(false);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 900);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [activeNoteId, addSnapshot, dirty, draftTitle, draftContent, t]);

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
        return inTrash && noteMatches(note, debouncedQuery, folderNameById[note.folderId]);
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
      return noteMatches(note, debouncedQuery, folderNameById[note.folderId]);
    });
  }, [sortedNotes, activeFilter, quickFilter, debouncedQuery, folderNameById]);

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
  const storageUsedBytes = useMemo(() => new Blob(notes.map((note) => `${note.title}${note.content}${note.tags.join('')}`)).size, [notes]);
  const storageQuotaBytes = 10 * 1024 * 1024;
  const storagePercent = Math.max(1, Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100)));
  const storageUsedLabel = `${formatBytes(storageUsedBytes)} / ${formatBytes(storageQuotaBytes)}`;

  const searchResults = useMemo<SearchResultGroups>(() => {
    const value = debouncedQuery.trim().toLowerCase();
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
      .filter((note) => {
        const localizedTags = note.tags.map((tag) => `${getTagDisplayName(tag, t)} ${TAG_SEARCH_ALIASES[tag] || ''}`).join(' ');
        return noteMatches(note, value, `${folderNameById[note.folderId]} ${localizedTags}`);
      })
      .slice(0, 6)
      .map((note) => noteToSearchResult(note));

    const matchingTags = allTags
      .filter((tag) => `${tag} ${getTagDisplayName(tag, t)} ${TAG_SEARCH_ALIASES[tag] || ''}`.toLowerCase().includes(value))
      .slice(0, 6)
      .map((tag) => ({
        tag,
        count: tagCounts[tag] || 0,
      }));

    const matchingCodeBlocks = liveNotes
      .flatMap((note) => extractCodeBlocks(note).map((block) => ({ ...block, note })))
      .filter((block) => `${block.language} ${block.text} ${block.note.title}`.toLowerCase().includes(value))
      .slice(0, 6)
      .map((block) => ({
        noteId: block.note.id,
        noteTitle: block.note.title || t('note.untitled'),
        language: block.language,
        preview: block.text.slice(0, 120) || t('note.emptyPreview'),
      }));

    return {
      recentNotes,
      notes: matchingNotes,
      tags: matchingTags,
      codeBlocks: matchingCodeBlocks,
    };
  }, [allTags, debouncedQuery, folderNameById, notes, recentNoteIds, t, tagCounts]);

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
    if (activeNoteId && visibleNotes.some((note) => note.id === activeNoteId)) {
      return;
    }
    setActiveNoteId(visibleNotes[0]?.id || '');
  }, [activeNoteId, visibleNotes]);

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

    window.addEventListener('keydown', closeMenusOnEscape);
    return () => window.removeEventListener('keydown', closeMenusOnEscape);
  }, []);

  const manualSave = useCallback(async () => {
    if (!activeNoteId) {
      return;
    }
    const savedAt = Date.now();
    setSaveState('saving');
    await updateNote(activeNoteId, {
      title: draftTitle || t('note.untitled'),
      content: draftContent,
      updatedAt: savedAt,
    });
    addSnapshot(activeNoteId, draftTitle || t('note.untitled'), draftContent, { force: true, createdAt: savedAt });
    setDirty(false);
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 900);
  }, [activeNoteId, addSnapshot, draftTitle, draftContent, t]);

  const createNewNote = useCallback(async () => {
    const folderId = activeFilter.startsWith('folder:') ? activeFilter.slice('folder:'.length) : DEFAULT_FOLDER_ID;
    const note = await createNote({ title: t('note.untitled'), content: '<p></p>', folderId });
    setActiveFilter(`folder:${folderId}`);
    setActiveNoteId(note.id);
  }, [activeFilter, t]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void createNewNote();
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void manualSave();
      }
      if (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
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
  }, [createNewNote, manualSave]);

  function setTitle(value: string) {
    setDraftTitle(value);
    setDirty(true);
  }

  function setContent(value: string) {
    setDraftContent(value);
    setDirty(true);
  }

  function showWorkspaceToast(message: string) {
    setWorkspaceToast(message);
    window.setTimeout(() => setWorkspaceToast(''), 1500);
  }

  async function togglePin(note: Note) {
    await updateNote(note.id, { pinned: !note.pinned });
    setContextMenu(null);
  }

  async function toggleTag(note: Note, tag: string) {
    const tags = note.tags.includes(tag) ? note.tags.filter((item) => item !== tag) : normalizeTags([...note.tags, tag]);
    await updateNote(note.id, { tags });
    setContextMenu(null);
  }

  async function toggleActiveTag(tag: string) {
    if (!activeNote) {
      return;
    }
    await toggleTag(activeNote, tag);
  }

  async function toggleActivePin() {
    if (!activeNote) {
      return;
    }
    await updateNote(activeNote.id, { pinned: !activeNote.pinned });
  }

  function restoreSnapshot(snapshot: NoteSnapshot) {
    setDraftTitle(snapshot.title);
    setDraftContent(snapshot.content);
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
    await Promise.all(
      notes
        .filter((note) => note.tags.includes(oldTag))
        .map((note) =>
          updateNote(note.id, {
            tags: normalizeTags(note.tags.map((tag) => (tag === oldTag ? newTag : tag))),
          }),
        ),
    );
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
    await Promise.all(
      notes
        .filter((note) => note.tags.includes(tag))
        .map((note) => updateNote(note.id, { tags: note.tags.filter((item) => item !== tag) })),
    );
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
    await softDeleteNote(note.id);
    if (note.id === activeNoteId) {
      const next = visibleNotes.find((item) => item.id !== note.id);
      setActiveNoteId(next?.id || '');
    }
    setContextMenu(null);
  }

  async function handleImport(files: File[]) {
    const { hasRemoteMarkdownImages, parseImportFile, remoteImagesToBase64 } = await import('./lib/importExport');
    for (const file of files) {
      const imports = await parseImportFile(file);
      for (const item of imports) {
        let content = item.content;
        const text = await file.text().catch(() => '');
        if (hasRemoteMarkdownImages(text)) {
          const convert = window.confirm(t('import.remoteImagesConfirm'));
          if (convert) {
            content = await remoteImagesToBase64(content);
          }
        }
        const noteInput = {
          ...(item.note || {}),
          title: item.note?.title || item.title,
          content,
          rawContent: stripHtml(content),
          folderId: activeFolderId,
          tags: item.note?.tags || item.tags || [],
        };
        const note = item.note ? await upsertNote(noteInput) : await createNote(noteInput);
        setActiveFilter(`folder:${activeFolderId}`);
        setActiveNoteId(note.id);
      }
    }
  }

  async function handleCreateFolder() {
    const folder = await createFolder(t('folder.new'));
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
      await renameFolder(editingFolderId, name);
    }
    setEditingFolderId('');
    setEditingFolderName('');
  }

  function handleCancelFolderRename() {
    setEditingFolderId('');
    setEditingFolderName('');
  }

  async function handleDeleteFolder(folder: Folder) {
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
    await deleteFolder(folder.id);
    setActiveFilter(`folder:${DEFAULT_FOLDER_ID}`);
    setFolderContextMenu(null);
  }

  async function handleMoveNoteToFolder(note: Note, folderId: string) {
    await moveNoteToFolder(note.id, folderId);
    setContextMenu(null);
  }

  function selectNoteFromSearch(noteId: string) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }
    setActiveFilter(note.deletedAt ? 'trash' : `folder:${note.folderId}`);
    setActiveNoteId(note.id);
    setQuery('');
  }

  function selectTagFromSearch(tag: string) {
    setActiveFilter(`tag:${tag}`);
    setQuery('');
  }

  async function handleCopyNote(note: Note) {
    await navigator.clipboard.writeText(`${note.title}\n\n${stripHtml(note.content)}`);
    setContextMenu(null);
    showWorkspaceToast('笔记内容已复制');
  }

  async function handleExportNote(note: Note, format: ExportFormat = 'markdown') {
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

  async function handleExport(format: ExportFormat) {
    const { exportAllAsJson, exportNoteAsHtml, exportNoteAsMarkdown, exportNoteAsPdf } = await import('./lib/importExport');
    setShowExport(false);
    const current = activeNote
      ? {
          ...activeNote,
          title: draftTitle || activeNote.title,
          content: draftContent || activeNote.content,
        }
      : undefined;

    if (format === 'json') {
      exportAllAsJson(notes);
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

  function noteMatches(note: Note, searchQuery: string, folderName = ''): boolean {
    const value = searchQuery.trim().toLowerCase();
    if (!value) {
      return true;
    }

    const codeText = Array.from(note.content.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi))
      .map((match) => stripHtml(match[1]))
      .join(' ');
    return `${note.title} ${note.rawContent || stripHtml(note.content)} ${note.tags.join(' ')} ${folderName} ${codeText}`.toLowerCase().includes(value);
  }

  return (
    <div className={`marknote-workspace h-[100dvh] min-w-[1180px] overflow-hidden bg-white text-[#111827] ${darkMode ? 'marknote-dark' : ''}`}>
      <div className="flex h-full min-h-0 overflow-hidden">
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
          onFilterChange={setActiveFilter}
          onWorkspaceChange={(name) => {
            setWorkspaceName(name);
            showWorkspaceToast(`已切换到 ${name}`);
          }}
          onSearchNoteSelect={selectNoteFromSearch}
          onSearchTagSelect={selectTagFromSearch}
          onSearchCodeSelect={selectNoteFromSearch}
          onCreateFolder={() => void handleCreateFolder()}
          onCreateTag={() => setTagManagerOpen(true)}
          editingFolderId={editingFolderId}
          editingFolderName={editingFolderName}
          onEditingFolderNameChange={setEditingFolderName}
          onCommitFolderRename={() => void handleCommitFolderRename()}
          onCancelFolderRename={handleCancelFolderRename}
          onFolderContextMenu={(event, folder) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenu(null);
            setShowExport(false);
            setActiveFilter(`folder:${folder.id}`);
            setFolderContextMenu({ folder, x: event.clientX, y: event.clientY });
          }}
          onCreateNote={() => void createNewNote()}
          onImportClick={() => setShowImport(true)}
          onExportClick={() => setShowExport((value) => !value)}
          onTogglePanel={() => {
            setSidebarCollapsed((value) => !value);
          }}
          onToggleTheme={() => setDarkMode((value) => !value)}
          collapsed={sidebarCollapsed}
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
          onSortModeChange={setSortMode}
          onQuickFilterChange={setQuickFilter}
          onCreateNote={() => void createNewNote()}
          onSelectNote={setActiveNoteId}
          onContextMenu={(event, note) => {
            event.preventDefault();
            setFolderContextMenu(null);
            setShowExport(false);
            setContextMenu({ note, x: event.clientX, y: event.clientY });
          }}
          onRestoreNote={(id) => void restoreNote(id)}
          onDeleteForever={(id) => {
            if (window.confirm(t('note.deleteForeverConfirm'))) {
              void permanentlyDeleteNote(id);
            }
          }}
        />
        <EditorPane
          note={activeNote ? { ...activeNote, title: draftTitle, content: draftContent } : undefined}
          saveState={saveState}
          snapshots={activeSnapshots}
          shareSettings={activeShareSettings}
          tags={allTags}
          tagColors={tagColors}
          onTitleChange={setTitle}
          onContentChange={setContent}
          onManualSave={() => void manualSave()}
          onToggleTag={(tag) => void toggleActiveTag(tag)}
          onTogglePin={() => void toggleActivePin()}
          onDeleteNote={() => {
            if (activeNote && window.confirm('删除当前笔记？可在回收站恢复。')) {
              void handleDelete(activeNote);
            }
          }}
          onRestoreSnapshot={restoreSnapshot}
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
          onTogglePin={(note) => void togglePin(note)}
          onCopy={(note) => void handleCopyNote(note)}
          onExport={(note) => void handleExportNote(note)}
          onDelete={(note) => void handleDelete(note)}
          onToggleTag={(note, tag) => void toggleTag(note, tag)}
          onMoveToFolder={(note, folderId) => void handleMoveNoteToFolder(note, folderId)}
        />
      ) : null}
      {folderContextMenu ? (
        <FolderContextMenu
          state={folderContextMenu}
          onCreateFolder={() => void handleCreateFolder()}
          onRenameFolder={handleStartRenameFolder}
          onDeleteFolder={(folder) => void handleDeleteFolder(folder)}
        />
      ) : null}
      {showImport ? <ImportDialog onClose={() => setShowImport(false)} onImportFiles={handleImport} /> : null}
      {showExport ? <ExportMenu onClose={() => setShowExport(false)} onExport={(format) => void handleExport(format)} /> : null}
      {tagManagerOpen ? (
        <TagManagerDialog
          tags={allTags}
          tagColors={tagColors}
          tagCounts={tagCounts}
          onClose={() => setTagManagerOpen(false)}
          onCreateTag={createTag}
          onRenameTag={(oldTag, newTag) => void renameTag(oldTag, newTag)}
          onMergeTag={(sourceTag, targetTag) => void mergeTag(sourceTag, targetTag)}
          onDeleteTag={(tag) => void deleteTag(tag)}
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
    preview: stripHtml(note.content).slice(0, 96) || 'Blank note',
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

function shouldOpenWorkspace() {
  const params = new URLSearchParams(window.location.search);
  return params.get('app') === '1' || window.location.hash === '#app';
}

export default function App() {
  const openWorkspace = shouldOpenWorkspace();
  useEffect(() => {
    document.documentElement.classList.toggle('marknote-shell', openWorkspace);
  }, [openWorkspace]);
  return openWorkspace ? <NoteWorkspace /> : <LandingPage />;
}
