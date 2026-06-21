import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Mark, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bot,
  Bold,
  CheckSquare,
  ChevronDown,
  Code2,
  Copy,
  File,
  Heading1,
  Heading2,
  Heading3,
  History,
  ImagePlus,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  Music,
  PanelTop,
  Quote,
  Save,
  Share2,
  Sigma,
  Sparkles,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Wand2,
} from 'lucide-react';
import type { Note } from '../types';
import { DEFAULT_TAGS } from '../lib/db';
import { fileToBase64Image } from '../lib/image';
import { formatFullDate } from '../lib/date';
import { CODE_LANGUAGES } from '../editor/codeBlockUtils';
import { ResizableImage } from '../editor/ResizableImage';
import { getTagDisplayName, useI18n } from '../i18n';
import { IconButton } from './IconButton';

interface EditorPaneProps {
  note?: Note;
  saveState: 'idle' | 'saving' | 'saved';
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onManualSave: () => void;
  onToggleTag: (tag: string) => void;
}

interface ImageBubble {
  src: string;
  x: number;
  y: number;
  imageX: number;
  imageY: number;
  width: number;
  height: number;
}

interface ImageMenu {
  src: string;
  x: number;
  y: number;
}

interface CodeCopyOverlay {
  text: string;
  x: number;
  y: number;
}

export function EditorPane({
  note,
  saveState,
  onTitleChange,
  onContentChange,
  onManualSave,
  onToggleTag,
}: EditorPaneProps) {
  const { locale, t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const [imageBubble, setImageBubble] = useState<ImageBubble | null>(null);
  const [imageMenu, setImageMenu] = useState<ImageMenu | null>(null);
  const [codeCopyOverlay, setCodeCopyOverlay] = useState<CodeCopyOverlay | null>(null);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState('');

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: 'hljs marknote-code',
          },
        },
      }),
      Placeholder.configure({
        placeholder: t('editor.placeholder'),
      }),
      UnderlineMark,
      ResizableImage.configure({
        allowBase64: true,
        inline: false,
      }),
    ],
    [t],
  );

  const editor = useEditor({
    extensions,
    content: note?.content || '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose-editor',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onContentChange(currentEditor.getHTML());
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const attrs = currentEditor.getAttributes('image') as { src?: string };
      if (!attrs.src || !editorShellRef.current) {
        setImageBubble(null);
        return;
      }

      updateImageOverlay(attrs.src);
    },
  });

  const insertImageFiles = useCallback(
    async (files: File[]) => {
      if (!editor || !note) {
        return;
      }

      for (const file of files) {
        const src = await fileToBase64Image(file);
        editor.chain().focus().setImage({ src, alt: file.name, width: '50%', align: 'left' } as never).run();
      }
    },
    [editor, note],
  );

  const updateImageOverlay = useCallback((src: string) => {
    if (!editorShellRef.current) {
      return;
    }

    const selected = editorShellRef.current.querySelector(`img[src="${cssEscape(src)}"]`);
    if (!selected) {
      setImageBubble(null);
      return;
    }

    const rect = selected.getBoundingClientRect();
    setImageBubble({
      src,
      x: Math.min(rect.left + rect.width - 212, window.innerWidth - 232),
      y: Math.max(rect.top - 44, 76),
      imageX: rect.left,
      imageY: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const selectImageElement = useCallback(
    (image: HTMLImageElement) => {
      if (!editor) {
        return;
      }

      const pos = editor.view.posAtDOM(image, 0);
      const selection = NodeSelection.create(editor.state.doc, pos);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.view.focus();
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = note?.content || '<p></p>';
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, false);
    }
    setImageBubble(null);
    setImageMenu(null);
    setCodeCopyOverlay(null);
    setIsImageDragOver(false);
  }, [editor, note?.id, note?.content]);

  useEffect(() => {
    const root = editorShellRef.current;
    if (!root) {
      return;
    }

    const clickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'IMG') {
        selectImageElement(target as HTMLImageElement);
        updateImageOverlay((target as HTMLImageElement).src);
        setImageMenu(null);
      }
    };

    const contextMenuHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== 'IMG') {
        return;
      }

      event.preventDefault();
      const image = target as HTMLImageElement;
      selectImageElement(image);
      updateImageOverlay(image.src);
      setImageMenu({
        src: image.src,
        x: Math.min(event.clientX, window.innerWidth - 210),
        y: Math.min(event.clientY, window.innerHeight - 238),
      });
    };
    const closeImageMenu = () => setImageMenu(null);

    root.addEventListener('click', clickHandler);
    root.addEventListener('contextmenu', contextMenuHandler);
    window.addEventListener('click', closeImageMenu);
    return () => {
      root.removeEventListener('click', clickHandler);
      root.removeEventListener('contextmenu', contextMenuHandler);
      window.removeEventListener('click', closeImageMenu);
    };
  }, [selectImageElement, updateImageOverlay]);

  const updateCodeCopyOverlay = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-code-copy-overlay]')) {
      return;
    }

    const pre = target.closest('pre') as HTMLPreElement | null;
    if (!pre || !editorShellRef.current?.contains(pre)) {
      setCodeCopyOverlay(null);
      return;
    }

    const rect = pre.getBoundingClientRect();
    const text = pre.querySelector('code')?.textContent || pre.textContent || '';
    const next = {
      text,
      x: Math.max(16, Math.min(rect.right - 82, window.innerWidth - 96)),
      y: Math.max(84, rect.top + 8),
    };
    setCodeCopyOverlay((current) =>
      current && current.text === next.text && current.x === next.x && current.y === next.y ? current : next,
    );
  }, []);

  if (!note) {
    return (
      <main className="grid min-w-0 flex-1 place-items-center bg-paper px-8 text-center text-stone-500">
        <div>
          <p className="text-base font-medium text-ink">{t('note.chooseOrCreate')}</p>
          <p className="mt-2 text-sm">{t('note.localStorageHint')}</p>
        </div>
      </main>
    );
  }

  function insertCodeBlock() {
    editor?.chain().focus().toggleCodeBlock({ language: codeLanguage }).run();
  }

  function insertParagraphBlock(content: string) {
    editor?.chain().focus().insertContent(content).run();
  }

  function toggleUnderline() {
    editor?.chain().focus().toggleMark('underline').run();
  }

  async function copyCodeText(text: string) {
    await navigator.clipboard.writeText(text);
    setToast(t('editor.codeCopied'));
    window.setTimeout(() => setToast(''), 1200);
  }

  async function copySelectedImage() {
    const src = (editor?.getAttributes('image') as { src?: string })?.src;
    if (!src) {
      return;
    }
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    setToast(t('editor.imageCopied'));
    window.setTimeout(() => setToast(''), 1200);
  }

  function deleteSelectedImage() {
    editor?.chain().focus().deleteSelection().run();
    setImageBubble(null);
    setImageMenu(null);
  }

  function setImageWidth(width: string) {
    editor?.chain().focus().setImageWidth(width).run();
    const src = (editor?.getAttributes('image') as { src?: string })?.src;
    window.requestAnimationFrame(() => {
      if (src) {
        updateImageOverlay(src);
      }
    });
  }

  function setImageAlign(align: 'left' | 'right' | 'center') {
    editor?.chain().focus().setImageAlign(align).run();
    const src = (editor?.getAttributes('image') as { src?: string })?.src;
    window.requestAnimationFrame(() => {
      if (src) {
        updateImageOverlay(src);
      }
    });
  }

  function startImageResize(event: React.MouseEvent<HTMLButtonElement>) {
    if (!editor || !imageBubble || !editorShellRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const prose = editorShellRef.current.querySelector('.prose-editor') as HTMLElement | null;
    const editorWidth = prose?.getBoundingClientRect().width || 920;
    const startX = event.clientX;
    const startWidth = imageBubble.width;
    const src = imageBubble.src;

    const onMove = (moveEvent: MouseEvent) => {
      const nextPixels = Math.max(160, Math.min(editorWidth, startWidth + moveEvent.clientX - startX));
      const nextPercent = Math.max(20, Math.min(100, Math.round((nextPixels / editorWidth) * 100)));
      editor.chain().focus().setImageWidth(`${nextPercent}%`).run();
      updateImageOverlay(src);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      updateImageOverlay(src);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <main className="grid min-w-0 flex-1 grid-rows-[auto_1fr] bg-white">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-[900px] items-start gap-3">
          <div className="min-w-0 flex-1">
            <input
              value={note.title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="min-w-0 w-full bg-transparent text-[28px] font-bold leading-tight text-gray-900 outline-none"
              placeholder={t('note.untitled')}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {DEFAULT_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`h-7 rounded-full border px-2.5 text-xs font-medium transition ${
                    note.tags.includes(tag)
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-white hover:text-gray-900'
                  }`}
                >
                  {getTagDisplayName(tag, t)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <div className="flex h-8 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-medium text-gray-500">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  saveState === 'saving' ? 'bg-warning' : saveState === 'saved' ? 'bg-success' : 'bg-primary-500'
                }`}
              />
              {saveState === 'saving' ? t('editor.saveSaving') : saveState === 'saved' ? t('editor.saveSaved') : t('editor.saveAuto')}
            </div>
            <button
              type="button"
              onClick={onManualSave}
              className="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
              title={t('editor.save')}
              aria-label={t('editor.save')}
            >
              <Save size={16} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShareOpen((value) => !value);
                  setHistoryOpen(false);
                  setAiOpen(false);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
              >
                <Share2 size={15} />
                {t('editor.share')}
              </button>
              {shareOpen ? (
                <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-subtle">
                  {[t('editor.sharePrivate'), t('editor.sharePublic'), t('editor.shareTeam')].map((item) => (
                    <button key={item} type="button" className="flex h-9 w-full items-center rounded-md px-2 text-left text-gray-600 hover:bg-gray-50">
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setHistoryOpen((value) => !value);
                  setShareOpen(false);
                  setAiOpen(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                title={t('editor.history')}
                aria-label={t('editor.history')}
              >
                <History size={16} />
              </button>
              {historyOpen ? (
                <div className="absolute right-0 top-10 z-40 w-64 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-subtle">
                  <div className="mb-2 text-xs font-semibold uppercase text-gray-400">{t('editor.versionToday')}</div>
                  <div className="rounded-md bg-gray-50 p-2">
                    <div className="text-xs font-medium text-gray-800">{formatFullDate(note.updatedAt, locale)}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                      {[t('editor.versionCompare'), t('editor.versionRestore'), t('editor.versionCopy')].map((item) => (
                        <button key={item} type="button" className="h-7 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAiOpen((value) => !value);
                  setShareOpen(false);
                  setHistoryOpen(false);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white transition hover:bg-primary-700 active:scale-[0.98]"
              >
                <Sparkles size={15} />
                {t('editor.ai')}
                <ChevronDown size={13} />
              </button>
              {aiOpen ? (
                <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-subtle">
                  {[
                    [t('editor.aiContinue'), Wand2],
                    [t('editor.aiSummarize'), Bot],
                    [t('editor.aiPolish'), Sparkles],
                    [t('editor.aiTranslate'), MessageSquareQuote],
                    [t('editor.aiTitle'), Heading1],
                    [t('editor.aiOutline'), ListChecks],
                    [t('editor.aiTodos'), CheckSquare],
                  ].map(([label, Icon]) => (
                    <button
                      key={String(label)}
                      type="button"
                      onClick={() => {
                        setToast(String(label));
                        setAiOpen(false);
                        window.setTimeout(() => setToast(''), 1200);
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-gray-700 hover:bg-primary-50 hover:text-primary-700"
                    >
                      <Icon size={15} />
                      {String(label)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-4 flex max-w-[900px] flex-wrap items-center gap-2">
          <ToolbarGroup label={t('editor.textStyle')}>
            <IconButton icon={Bold} label={t('editor.bold')} active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
            <IconButton icon={Italic} label={t('editor.italic')} active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
            <IconButton icon={Underline} label={t('editor.underline')} active={editor?.isActive('underline')} onClick={toggleUnderline} />
            <IconButton icon={Strikethrough} label={t('editor.strike')} active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.heading1')}>
            <IconButton icon={Heading1} label={t('editor.heading1')} active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
            <IconButton icon={Heading2} label={t('editor.heading2')} active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
            <IconButton icon={Heading3} label={t('editor.heading3')} active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.contentBlocks')}>
            <IconButton icon={List} label={t('editor.bulletList')} active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
            <IconButton icon={ListOrdered} label={t('editor.orderedList')} active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
            <IconButton icon={CheckSquare} label={t('editor.checklist')} onClick={() => insertParagraphBlock('<ul data-type="taskList"><li><p>Todo</p></li></ul>')} />
            <IconButton icon={Quote} label={t('editor.quote')} active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
            <IconButton icon={Minus} label={t('editor.divider')} onClick={() => insertParagraphBlock('<hr><p></p>')} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.mediaBlocks')}>
            <IconButton icon={ImagePlus} label={t('editor.insertImage')} onClick={() => fileInputRef.current?.click()} />
            <IconButton icon={PanelTop} label={t('editor.video')} onClick={() => insertParagraphBlock('<p>[Video]</p>')} />
            <IconButton icon={Music} label={t('editor.audio')} onClick={() => insertParagraphBlock('<p>[Audio]</p>')} />
            <IconButton icon={File} label={t('editor.file')} onClick={() => insertParagraphBlock('<p>[File]</p>')} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.dataBlocks')}>
            <div className="flex h-8 items-center overflow-hidden rounded-md border border-gray-200 bg-white">
              <select
                value={codeLanguage}
                onChange={(event) => setCodeLanguage(event.target.value)}
                className="h-full border-0 bg-white px-2 text-xs text-gray-700 outline-none"
                aria-label={t('editor.codeLanguage')}
              >
                {CODE_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-editor-insert-code="true"
                onClick={insertCodeBlock}
                className="grid h-full w-8 place-items-center border-l border-gray-200 text-gray-600 hover:bg-gray-50"
                aria-label={t('editor.insertCodeBlock')}
                title={t('editor.insertCodeBlock')}
              >
                <Code2 size={15} />
              </button>
            </div>
            <IconButton icon={Table2} label={t('editor.table')} onClick={() => insertParagraphBlock('<table><tbody><tr><td>Key</td><td>Value</td></tr></tbody></table><p></p>')} />
            <IconButton icon={Sigma} label={t('editor.math')} onClick={() => insertParagraphBlock('<p>$$ E = mc^2 $$</p>')} />
            <IconButton icon={Code2} label={t('editor.mermaid')} onClick={() => insertParagraphBlock('<pre><code class="language-mermaid">graph TD\\nA-->B</code></pre>')} />
          </ToolbarGroup>
          <div className="ml-auto text-xs text-gray-400">{t('editor.slashHint')}</div>
        </div>

        <div className="mx-auto mt-3 max-w-[900px] text-xs text-gray-400">{t('note.updatedAt', { date: formatFullDate(note.updatedAt, locale) })}</div>
      </header>

      <section
        ref={editorShellRef}
        className={`relative min-h-0 overflow-y-auto bg-white px-8 py-8 transition ${
          isImageDragOver ? 'ring-2 ring-inset ring-primary-300' : ''
        }`}
        onMouseMove={updateCodeCopyOverlay}
        onMouseLeave={() => {
          setCodeCopyOverlay(null);
          setIsImageDragOver(false);
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items || []).some((item) => item.type.startsWith('image/'))) {
            event.preventDefault();
            setIsImageDragOver(true);
          }
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
          if (!event.currentTarget.contains(nextTarget)) {
            setIsImageDragOver(false);
          }
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
          if (files.length > 0) {
            event.preventDefault();
            setIsImageDragOver(false);
            void insertImageFiles(files);
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith('image/'));
          if (files.length > 0) {
            event.preventDefault();
            void insertImageFiles(files);
          }
        }}
        onKeyDown={(event) => {
          const mod = event.ctrlKey || event.metaKey;
          if (mod && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            editor?.chain().focus().toggleBold().run();
          }
        }}
      >
        <EditorContent editor={editor} />
        {toast ? <div className="fixed bottom-5 right-5 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-subtle">{toast}</div> : null}
        {codeCopyOverlay ? (
          <button
            type="button"
            data-code-copy-overlay="true"
            aria-label={t('editor.copyCode')}
            title={t('editor.copyCode')}
            onClick={(event) => {
              event.stopPropagation();
              void copyCodeText(codeCopyOverlay.text);
            }}
            className="fixed z-30 inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 text-xs text-white shadow-subtle backdrop-blur transition hover:bg-white/20"
            style={{ left: codeCopyOverlay.x, top: codeCopyOverlay.y }}
          >
            <Copy size={13} />
            {t('editor.copyCode')}
          </button>
        ) : null}
        {imageBubble ? (
          <div
            className="fixed z-30 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-subtle"
            style={{ left: imageBubble.x, top: imageBubble.y }}
          >
            <IconButton icon={AlignLeft} label={t('editor.imageLeft')} onClick={() => setImageAlign('left')} />
            <IconButton icon={AlignCenter} label={t('editor.imageCenter')} onClick={() => setImageAlign('center')} />
            <IconButton icon={AlignRight} label={t('editor.imageRight')} onClick={() => setImageAlign('right')} />
            <button
              type="button"
              onClick={() => setImageWidth('50%')}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50"
            >
              50%
            </button>
            <button
              type="button"
              onClick={() => setImageWidth('100%')}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50"
            >
              100%
            </button>
            <IconButton icon={Copy} label={t('editor.copyImage')} onClick={() => void copySelectedImage()} />
            <IconButton icon={Trash2} label={t('editor.deleteImage')} onClick={deleteSelectedImage} />
          </div>
        ) : null}
        {imageBubble ? (
          <button
            type="button"
            aria-label={t('editor.resizeImage')}
            title={t('editor.resizeImage')}
            onMouseDown={startImageResize}
            className="fixed z-30 h-4 w-4 rounded border border-white bg-primary-600 shadow-subtle ring-1 ring-gray-900/20"
            style={{
              left: imageBubble.imageX + imageBubble.width - 8,
              top: imageBubble.imageY + imageBubble.height - 8,
              cursor: 'nwse-resize',
            }}
          />
        ) : null}
        {imageMenu ? (
          <div
            className="fixed z-40 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-subtle"
            style={{ left: imageMenu.x, top: imageMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => setImageAlign('left')} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <AlignLeft size={15} />
              {t('editor.leftFloat')}
            </button>
            <button type="button" onClick={() => setImageAlign('right')} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <AlignRight size={15} />
              {t('editor.rightFloat')}
            </button>
            <button type="button" onClick={() => setImageAlign('center')} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <AlignCenter size={15} />
              {t('editor.centerBlock')}
            </button>
            <div className="grid grid-cols-2 border-y border-gray-100">
              <button type="button" onClick={() => setImageWidth('50%')} className="h-9 text-xs text-gray-700 hover:bg-gray-50">
                {t('editor.width50')}
              </button>
              <button type="button" onClick={() => setImageWidth('100%')} className="h-9 border-l border-gray-100 text-xs text-gray-700 hover:bg-gray-50">
                {t('editor.width100')}
              </button>
            </div>
            <button type="button" onClick={() => void copySelectedImage()} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <Copy size={15} />
              {t('editor.copyImage')}
            </button>
            <button type="button" onClick={deleteSelectedImage} className="flex h-9 w-full items-center gap-2 border-t border-gray-100 px-3 text-left text-error hover:bg-gray-50">
              <Trash2 size={15} />
              {t('editor.deleteImage')}
            </button>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              void insertImageFiles(Array.from(event.target.files));
              event.target.value = '';
            }
          }}
        />
      </section>
    </main>
  );
}

function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5" aria-label={label}>
      {children}
    </div>
  );
}

const UnderlineMark = Mark.create({
  name: 'underline',

  parseHTML() {
    return [{ tag: 'u' }, { style: 'text-decoration-line=underline' }, { style: 'text-decoration=underline' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0];
  },

});
