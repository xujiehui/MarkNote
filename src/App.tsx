import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Note, ExportFormat, TagFilter } from './types';
import {
  createNote,
  db,
  ensureSeedNote,
  permanentlyDeleteNote,
  purgeExpiredTrash,
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
import { ImportDialog } from './components/ImportDialog';
import { ExportMenu } from './components/ExportMenu';

interface ContextState {
  note: Note;
  x: number;
  y: number;
}

type SaveState = 'idle' | 'saving' | 'saved';

export default function App() {
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
  const [activeNoteId, setActiveNoteId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<TagFilter>('all');
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query, 180);
  const activeNote = notes.find((note) => note.id === activeNoteId);

  useEffect(() => {
    void purgeExpiredTrash();
    void ensureSeedNote().then((id) => setActiveNoteId((current) => current || id));
  }, []);

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
      if (activeFilter !== 'all' && !note.tags.includes(activeFilter)) {
        return false;
      }
      return noteMatches(note, debouncedQuery);
    });
  }, [sortedNotes, activeFilter, debouncedQuery]);

  const trashCount = useMemo(() => notes.filter((note) => note.deletedAt).length, [notes]);

  useEffect(() => {
    if (activeNoteId && visibleNotes.some((note) => note.id === activeNoteId)) {
      return;
    }
    setActiveNoteId(visibleNotes[0]?.id || '');
  }, [activeNoteId, visibleNotes]);

  useEffect(() => {
    function closeMenus() {
      setContextMenu(null);
      setShowExport(false);
    }

    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
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
    const note = await createNote({ title: '未命名笔记', content: '<p></p>' });
    setActiveFilter('all');
    setActiveNoteId(note.id);
  }, []);

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
          tags: item.note?.tags || item.tags || [],
        };
        const note = item.note ? await upsertNote(noteInput) : await createNote(noteInput);
        setActiveFilter('all');
        setActiveNoteId(note.id);
      }
    }
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
          activeFilter={activeFilter}
          trashCount={trashCount}
          onQueryChange={setQuery}
          onFilterChange={setActiveFilter}
          onCreateNote={() => void createNewNote()}
          onImportClick={() => setShowImport(true)}
          onExportClick={() => setShowExport((value) => !value)}
          searchInputRef={searchInputRef}
        />
        <NoteList
          notes={visibleNotes}
          activeNoteId={activeNoteId}
          isTrash={activeFilter === 'trash'}
          onSelectNote={setActiveNoteId}
          onContextMenu={(event, note) => {
            event.preventDefault();
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
          onClose={() => setContextMenu(null)}
          onTogglePin={(note) => void togglePin(note)}
          onDelete={(note) => void handleDelete(note)}
          onToggleTag={(note, tag) => void toggleTag(note, tag)}
        />
      ) : null}
      {showImport ? <ImportDialog onClose={() => setShowImport(false)} onImportFiles={handleImport} /> : null}
      {showExport ? <ExportMenu onClose={() => setShowExport(false)} onExport={(format) => void handleExport(format)} /> : null}
    </div>
  );
}
