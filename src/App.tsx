import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Folder, Note, ExportFormat, WorkspaceFilter } from './types';
import {
  createFolder,
  createNote,
  db,
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
import { EditorPane } from './components/EditorPane';
import { ContextMenu } from './components/ContextMenu';
import { FolderContextMenu } from './components/FolderContextMenu';
import { ImportDialog } from './components/ImportDialog';
import { ExportMenu } from './components/ExportMenu';
import { LandingPage } from './LandingPage';

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

function NoteWorkspace() {
  const folders = useLiveQuery(() => db.folders.orderBy('sortOrder').toArray(), [], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
  const [activeNoteId, setActiveNoteId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<WorkspaceFilter>(`folder:${DEFAULT_FOLDER_ID}`);
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query, 180);
  const activeNote = notes.find((note) => note.id === activeNoteId);
  const activeFolderId = activeFilter.startsWith('folder:') ? activeFilter.slice('folder:'.length) : DEFAULT_FOLDER_ID;
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || folders[0];

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
    setEditingFolderId('');
    setEditingFolderName('');
  }, [editingFolderId, folders]);

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
  }, [activeNote]);

  useEffect(() => {
    if (!activeNoteId || !dirty) {
      return;
    }

    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      await updateNote(activeNoteId, {
        title: draftTitle || '未命名笔记',
        content: draftContent,
      });
      setDirty(false);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 900);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeNoteId, dirty, draftTitle, draftContent]);

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return Number(b.pinned) - Number(a.pinned);
      }
      return b.updatedAt - a.updatedAt;
    });
  }, [notes]);

  const visibleNotes = useMemo(() => {
    return sortedNotes.filter((note) => {
      const inTrash = Boolean(note.deletedAt);
      if (activeFilter === 'trash') {
        return inTrash && noteMatches(note, debouncedQuery);
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
      return noteMatches(note, debouncedQuery);
    });
  }, [sortedNotes, activeFilter, debouncedQuery]);

  const trashCount = useMemo(() => notes.filter((note) => note.deletedAt).length, [notes]);
  const folderCounts = useMemo(() => {
    return notes.reduce<Record<string, number>>((counts, note) => {
      if (!note.deletedAt) {
        counts[note.folderId] = (counts[note.folderId] || 0) + 1;
      }
      return counts;
    }, {});
  }, [notes]);

  const listTitle = useMemo(() => {
    if (activeFilter === 'all') {
      return '全部笔记';
    }
    if (activeFilter === 'trash') {
      return '回收站';
    }
    if (activeFilter.startsWith('folder:')) {
      return activeFolder?.name || '文件夹';
    }
    if (activeFilter.startsWith('tag:')) {
      return `# ${activeFilter.slice('tag:'.length)}`;
    }
    return '笔记';
  }, [activeFilter, activeFolder?.name]);

  useEffect(() => {
    if (activeNoteId && visibleNotes.some((note) => note.id === activeNoteId)) {
      return;
    }
    setActiveNoteId(visibleNotes[0]?.id || '');
  }, [activeNoteId, visibleNotes]);

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
    setSaveState('saving');
    await updateNote(activeNoteId, {
      title: draftTitle || '未命名笔记',
      content: draftContent,
    });
    setDirty(false);
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 900);
  }, [activeNoteId, draftTitle, draftContent]);

  const createNewNote = useCallback(async () => {
    const folderId = activeFilter.startsWith('folder:') ? activeFilter.slice('folder:'.length) : DEFAULT_FOLDER_ID;
    const note = await createNote({ title: '未命名笔记', content: '<p></p>', folderId });
    setActiveFilter(`folder:${folderId}`);
    setActiveNoteId(note.id);
  }, [activeFilter]);

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
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')?.click();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('button[aria-label="插入代码块"]')?.click();
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

  async function togglePin(note: Note) {
    await updateNote(note.id, { pinned: !note.pinned });
    setContextMenu(null);
  }

  async function toggleTag(note: Note, tag: string) {
    const tags = note.tags.includes(tag) ? note.tags.filter((item) => item !== tag) : [...note.tags, tag];
    await updateNote(note.id, { tags });
    setContextMenu(null);
  }

  async function toggleActiveTag(tag: string) {
    if (!activeNote) {
      return;
    }
    await toggleTag(activeNote, tag);
  }

  async function handleDelete(note: Note) {
    await softDeleteNote(note.id);
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
          const convert = window.confirm('Markdown 中包含外链图片。是否下载并转存为 Base64？跨域失败的图片将保留原链接。');
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
    const folder = await createFolder('新建文件夹');
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
    const ok = window.confirm(`删除“${folder.name}”？其中的笔记会移动到“资料库”。`);
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

  function noteMatches(note: Note, searchQuery: string): boolean {
    const value = searchQuery.trim().toLowerCase();
    if (!value) {
      return true;
    }

    return `${note.title} ${note.rawContent || stripHtml(note.content)}`.toLowerCase().includes(value);
  }

  return (
    <div className="h-[100dvh] min-w-[1040px] overflow-hidden bg-paper text-ink">
      <div className="flex h-full">
        <Sidebar
          query={query}
          folders={folders}
          activeFilter={activeFilter}
          folderCounts={folderCounts}
          trashCount={trashCount}
          onQueryChange={setQuery}
          onFilterChange={setActiveFilter}
          onCreateFolder={() => void handleCreateFolder()}
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
          searchInputRef={searchInputRef}
        />
        <NoteList
          notes={visibleNotes}
          folders={folders}
          activeNoteId={activeNoteId}
          title={listTitle}
          isTrash={activeFilter === 'trash'}
          onSelectNote={setActiveNoteId}
          onContextMenu={(event, note) => {
            event.preventDefault();
            setFolderContextMenu(null);
            setShowExport(false);
            setContextMenu({ note, x: event.clientX, y: event.clientY });
          }}
          onRestoreNote={(id) => void restoreNote(id)}
          onDeleteForever={(id) => {
            if (window.confirm('确定要彻底删除这条笔记吗？')) {
              void permanentlyDeleteNote(id);
            }
          }}
        />
        <EditorPane
          note={activeNote ? { ...activeNote, title: draftTitle, content: draftContent } : undefined}
          saveState={saveState}
          onTitleChange={setTitle}
          onContentChange={setContent}
          onManualSave={() => void manualSave()}
          onToggleTag={(tag) => void toggleActiveTag(tag)}
        />
      </div>

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          folders={folders}
          onClose={() => setContextMenu(null)}
          onTogglePin={(note) => void togglePin(note)}
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
    </div>
  );
}

function shouldOpenWorkspace() {
  const params = new URLSearchParams(window.location.search);
  return params.get('app') === '1' || window.location.hash === '#app';
}

export default function App() {
  return shouldOpenWorkspace() ? <NoteWorkspace /> : <LandingPage />;
}
