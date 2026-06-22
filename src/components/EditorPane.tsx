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
  Columns2,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  History,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Quote,
  Redo2,
  Share2,
  Sigma,
  Sparkles,
  Star,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Wand2,
} from 'lucide-react';
import type { Note } from '../types';
import { fileToBase64Image } from '../lib/image';
import { formatFullDate } from '../lib/date';
import { highlightCodeBlocks } from '../editor/codeBlockUtils';
import { ResizableImage } from '../editor/ResizableImage';
import { useI18n } from '../i18n';
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
}: EditorPaneProps) {
  const { locale, t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const codeLanguage = 'javascript';
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

    let pendingFrame = 0;
    const runHighlight = () => {
      pendingFrame = 0;
      highlightCodeBlocks(root);
    };
    const scheduleHighlight = () => {
      if (!pendingFrame) {
        pendingFrame = window.requestAnimationFrame(runHighlight);
      }
    };
    const frame = window.requestAnimationFrame(runHighlight);
    const timer = window.setTimeout(scheduleHighlight, 120);
    const observer = new MutationObserver(scheduleHighlight);
    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (pendingFrame) {
        window.cancelAnimationFrame(pendingFrame);
      }
      window.clearTimeout(timer);
      observer.disconnect();
    };
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
      <main className="grid min-w-0 flex-1 place-items-center bg-white px-8 text-center text-[#6b7280]">
        <div>
          <p className="text-base font-medium text-[#111827]">{t('note.chooseOrCreate')}</p>
          <p className="mt-2 text-sm">{t('note.localStorageHint')}</p>
        </div>
      </main>
    );
  }

  const isReferenceWelcomeNote = note.id === 'marknote-welcome-note' || note.title === '欢迎使用 MarkNote';

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
    <main className="grid min-w-0 flex-1 grid-rows-[auto_1fr_48px] bg-white">
      <header className="bg-white px-8 pb-2 pt-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <input
              value={note.title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="min-w-0 bg-transparent text-[17px] font-semibold leading-tight text-[#111827] outline-none"
              placeholder={t('note.untitled')}
            />
            <div className="flex h-6 items-center gap-1.5 text-[13px] text-[#4b5563]">
              <span
                className={`h-2 w-2 rounded-full ${
                  saveState === 'saving' ? 'bg-[#f59e0b]' : saveState === 'saved' ? 'bg-[#22c55e]' : 'bg-[#22c55e]'
                }`}
              />
              {saveState === 'saving' ? t('editor.saveSaving') : saveState === 'saved' ? t('editor.saveSaved') : '已保存'}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-[#111827]">
            <TopIconButton label="撤销" onClick={() => editor?.chain().focus().undo().run()}>
              <Undo2 size={18} />
            </TopIconButton>
            <TopIconButton label="重做" onClick={() => editor?.chain().focus().redo().run()}>
              <Redo2 size={18} />
            </TopIconButton>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setHistoryOpen((value) => !value);
                  setShareOpen(false);
                  setAiOpen(false);
                }}
                className="grid h-9 w-9 place-items-center rounded-lg text-[#111827] hover:bg-[#f3f4f6]"
                title={t('editor.history')}
                aria-label={t('editor.history')}
              >
                <History size={19} />
              </button>
              {historyOpen ? (
                <div className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-[#e5e7eb] bg-white p-3 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  <div className="mb-2 text-xs font-semibold uppercase text-[#6b7280]">{t('editor.versionToday')}</div>
                  <div className="rounded-lg bg-[#f8fafc] p-2">
                    <div className="text-xs font-medium text-[#111827]">{formatFullDate(note.updatedAt, locale)}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                      {[t('editor.versionCompare'), t('editor.versionRestore'), t('editor.versionCopy')].map((item) => (
                        <button key={item} type="button" className="h-7 rounded border border-[#e5e7eb] bg-white text-[#4b5563] hover:bg-[#f3f4f6]">
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <TopIconButton label="收藏">
              <Star size={19} />
            </TopIconButton>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShareOpen((value) => !value);
                  setHistoryOpen(false);
                  setAiOpen(false);
                }}
                className="grid h-9 w-9 place-items-center rounded-lg text-[#111827] hover:bg-[#f3f4f6]"
                aria-label={t('editor.share')}
                title={t('editor.share')}
              >
                <Share2 size={19} />
              </button>
              {shareOpen ? (
                <div className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  {[t('editor.sharePrivate'), t('editor.sharePublic'), t('editor.shareTeam')].map((item) => (
                    <button key={item} type="button" className="flex h-9 w-full items-center rounded-lg px-2 text-left text-[#4b5563] hover:bg-[#f3f4f6]">
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <TopIconButton label="更多">
              <Ellipsis size={20} />
            </TopIconButton>
            <div className="h-8 w-px bg-[#e5e7eb]" />
            <TopIconButton label="布局">
              <Columns2 size={19} />
            </TopIconButton>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAiOpen((value) => !value);
                  setShareOpen(false);
                  setHistoryOpen(false);
                }}
                className="hidden h-9 items-center gap-1.5 rounded-lg bg-[#2f7df6] px-3 text-xs font-semibold text-white transition hover:bg-[#256ce0] active:scale-[0.98]"
              >
                <Sparkles size={15} />
                {t('editor.ai')}
                <ChevronDown size={13} />
              </button>
              {aiOpen ? (
                <div className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
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
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[#4b5563] hover:bg-[#eaf2ff] hover:text-[#2f7df6]"
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

        <div className="mt-4 inline-flex max-w-full items-center overflow-hidden rounded-lg border border-[#e5e7eb] bg-white px-2 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
          <ToolbarGroup label={t('editor.textStyle')}>
            <IconButton icon={Bold} label={t('editor.bold')} active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
            <IconButton icon={Italic} label={t('editor.italic')} active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
            <IconButton icon={Underline} label={t('editor.underline')} active={editor?.isActive('underline')} onClick={toggleUnderline} />
            <IconButton icon={Strikethrough} label={t('editor.strike')} active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()} />
            <IconButton icon={Code2} label={t('editor.insertCodeBlock')} onClick={insertCodeBlock} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.heading1')}>
            <IconButton icon={Heading1} label={t('editor.heading1')} active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
            <IconButton icon={Heading2} label={t('editor.heading2')} active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
            <IconButton icon={Heading3} label={t('editor.heading3')} active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.contentBlocks')}>
            <IconButton icon={List} label={t('editor.bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
            <IconButton icon={ListOrdered} label={t('editor.orderedList')} active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
            <IconButton icon={Quote} label={t('editor.quote')} active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
            <IconButton icon={Link} label="链接" onClick={() => insertParagraphBlock('<p><a href="#">链接</a></p>')} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.mediaBlocks')}>
            <IconButton icon={ImagePlus} label={t('editor.insertImage')} onClick={() => fileInputRef.current?.click()} />
            <IconButton icon={Table2} label={t('editor.table')} onClick={() => insertParagraphBlock('<table><tbody><tr><td>Key</td><td>Value</td></tr></tbody></table><p></p>')} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.dataBlocks')}>
            <IconButton icon={Sigma} label={t('editor.math')} onClick={() => insertParagraphBlock('<p>$$ E = mc^2 $$</p>')} />
            <IconButton icon={Code2} label={t('editor.mermaid')} onClick={() => insertParagraphBlock('<pre><code class="language-mermaid">graph TD\\nA-->B</code></pre>')} />
          </ToolbarGroup>
          <button type="button" className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-[#111827] hover:bg-[#f3f4f6]" title={t('editor.slashHint')}>
            /
          </button>
        </div>
      </header>

      <section
        ref={editorShellRef}
        className={`relative min-h-0 overflow-y-auto bg-white pb-10 pl-14 pr-10 pt-7 transition ${
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
        {isReferenceWelcomeNote ? <ReferenceWelcomeContent onCopyCode={() => void copyCodeText("const note = 'Write once, keep everywhere';\nconsole.log(note);\nexport default note;")} /> : <EditorContent editor={editor} />}
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
      <footer className="flex items-center justify-between border-t border-[#e5e7eb] px-9 text-[13px] text-[#6b7280]">
        <div className="flex items-center gap-7">
          <span>字数：152</span>
          <span>词数：32</span>
          <span>行数：12</span>
        </div>
        <div className="flex items-center gap-7">
          <span>最后编辑：刚刚</span>
          <span>?</span>
          <span>中</span>
          <span>↗</span>
        </div>
      </footer>
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
    <div className="flex min-h-8 items-center gap-1 border-r border-[#e5e7eb] px-1 last:border-r-0" aria-label={label}>
      {children}
    </div>
  );
}

function TopIconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-[#111827] transition hover:bg-[#f3f4f6]"
    >
      {children}
    </button>
  );
}

function ReferenceWelcomeContent({ onCopyCode }: { onCopyCode: () => void }) {
  return (
    <article className="reference-welcome-content">
      <div className="editor-hero mb-6 max-w-[936px]">
        <div className="mb-4 flex items-center gap-3">
          <span className="text-[32px] leading-none">👋</span>
          <h1 className="text-[34px] font-bold leading-tight text-[#111827]">欢迎使用 MarkNote</h1>
        </div>
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded-lg bg-[#dbeafe] px-3 py-1 text-[13px] font-semibold text-[#2f7df6]">资料库</span>
          <span className="rounded-lg bg-[#dcfce7] px-3 py-1 text-[13px] font-semibold text-[#16a34a]">个人</span>
          <button type="button" className="h-7 rounded-lg border border-[#e5e7eb] bg-white px-3 text-[13px] text-[#6b7280] hover:bg-[#f8fafc]">
            + 添加标签
          </button>
        </div>
        <div className="h-px bg-[#e5e7eb]" />
      </div>

      <p>
        这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用。
        <br />
        你可以拖拽粘贴图片，也可以使用工具栏插入代码块。
      </p>

      <h3>📌 快速开始</h3>
      <ul className="reference-bullets">
        <li>在左侧创建或选择笔记本</li>
        <li>在中间列表选择笔记</li>
        <li>在右侧开始编辑你的内容</li>
        <li>所有内容会自动保存到云端</li>
      </ul>

      <h3>💻 代码示例</h3>
      <div className="reference-code-block">
        <div className="reference-code-header">
          <span>▰ JavaScript</span>
          <button type="button" onClick={onCopyCode}>
            ▣ 复制
          </button>
        </div>
        <div className="reference-code-body">
          <span className="reference-line-numbers">1{'\n'}2{'\n'}3</span>
          <code>
            <span className="hljs-keyword">const</span> note = <span className="hljs-string">'Write once, keep everywhere'</span>;{'\n'}
            console.<span className="hljs-title">log</span>(note);{'\n'}
            <span className="hljs-keyword">export</span> <span className="hljs-keyword">default</span> note;
          </code>
        </div>
      </div>

      <h3>✨ 更多功能</h3>
      <ul className="reference-checklist">
        <li className="checked">支持 Markdown 语法</li>
        <li className="checked">支持代码高亮</li>
        <li>支持导入导出</li>
        <li>支持多端同步</li>
      </ul>
    </article>
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
