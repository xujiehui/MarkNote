import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Quote,
  Save,
  Trash2,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
} from 'lucide-react';
import type { Note } from '../types';
import { DEFAULT_TAGS } from '../lib/db';
import { fileToBase64Image } from '../lib/image';
import { formatFullDate } from '../lib/date';
import { CODE_LANGUAGES } from '../editor/codeBlockUtils';
import { ResizableImage } from '../editor/ResizableImage';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const [imageBubble, setImageBubble] = useState<ImageBubble | null>(null);
  const [imageMenu, setImageMenu] = useState<ImageMenu | null>(null);
  const [codeCopyOverlay, setCodeCopyOverlay] = useState<CodeCopyOverlay | null>(null);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
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
        placeholder: '开始写作，粘贴图片，或输入 ``` 创建代码块',
      }),
      ResizableImage.configure({
        allowBase64: true,
        inline: false,
      }),
    ],
    [],
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
          <p className="text-base font-medium text-ink">选择或新建一条笔记</p>
          <p className="mt-2 text-sm">你的图文、代码和标签都会保存在本机 IndexedDB。</p>
        </div>
      </main>
    );
  }

  function insertCodeBlock() {
    editor?.chain().focus().toggleCodeBlock({ language: codeLanguage }).run();
  }

  async function copyCodeText(text: string) {
    await navigator.clipboard.writeText(text);
    setToast('代码已复制');
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
    setToast('图片已复制');
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
    <main className="grid min-w-0 flex-1 grid-rows-[auto_1fr] bg-paper">
      <header className="border-b border-stone-200 bg-paper px-5 py-3">
        <div className="flex items-center gap-3">
          <input
            value={note.title}
            onChange={(event) => onTitleChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-ink outline-none"
            placeholder="未命名笔记"
          />
          <div className="shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-500">
            {saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : '本地自动保存'}
          </div>
          <button
            type="button"
            onClick={onManualSave}
            className="grid h-8 w-8 place-items-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
            title="保存"
            aria-label="保存"
          >
            <Save size={16} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <IconButton icon={Bold} label="加粗" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
          <IconButton icon={Italic} label="斜体" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <IconButton icon={Heading1} label="H1" active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
          <IconButton icon={Heading2} label="H2" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
          <IconButton icon={Heading3} label="H3" active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
          <IconButton icon={Quote} label="引用" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <IconButton icon={List} label="无序列表" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
          <IconButton icon={ListOrdered} label="有序列表" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />

          <div className="ml-1 flex h-8 items-center overflow-hidden rounded-md border border-stone-300 bg-white">
            <select
              value={codeLanguage}
              onChange={(event) => setCodeLanguage(event.target.value)}
              className="h-full border-0 bg-white px-2 text-xs text-stone-700 outline-none"
              aria-label="代码语言"
            >
              {CODE_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={insertCodeBlock}
              className="grid h-full w-8 place-items-center border-l border-stone-300 text-stone-700 hover:bg-stone-100"
              aria-label="插入代码块"
              title="插入代码块"
            >
              <Code2 size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="grid h-8 w-8 place-items-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
            aria-label="插入图片"
            title="插入图片"
          >
            <ImagePlus size={16} />
          </button>

          <div className="ml-auto flex flex-wrap gap-1">
            {DEFAULT_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                className={`h-8 rounded-md border px-2.5 text-xs transition ${
                  note.tags.includes(tag)
                    ? 'border-moss bg-moss text-white'
                    : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-100'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 text-xs text-stone-400">更新于 {formatFullDate(note.updatedAt)}</div>
      </header>

      <section
        ref={editorShellRef}
        className={`relative min-h-0 overflow-y-auto px-8 py-6 transition ${
          isImageDragOver ? 'ring-2 ring-inset ring-moss/35' : ''
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
        {toast ? <div className="fixed bottom-5 right-5 rounded-md bg-ink px-3 py-2 text-sm text-white shadow-subtle">{toast}</div> : null}
        {codeCopyOverlay ? (
          <button
            type="button"
            data-code-copy-overlay="true"
            aria-label="复制代码"
            title="复制代码"
            onClick={(event) => {
              event.stopPropagation();
              void copyCodeText(codeCopyOverlay.text);
            }}
            className="fixed z-30 inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 text-xs text-white shadow-subtle backdrop-blur transition hover:bg-white/20"
            style={{ left: codeCopyOverlay.x, top: codeCopyOverlay.y }}
          >
            <Copy size={13} />
            复制
          </button>
        ) : null}
        {imageBubble ? (
          <div
            className="fixed z-30 flex items-center gap-1 rounded-md border border-stone-200 bg-white p-1 shadow-subtle"
            style={{ left: imageBubble.x, top: imageBubble.y }}
          >
            <IconButton icon={AlignLeft} label="图片左浮动" onClick={() => setImageAlign('left')} />
            <IconButton icon={AlignCenter} label="图片居中" onClick={() => setImageAlign('center')} />
            <IconButton icon={AlignRight} label="图片右浮动" onClick={() => setImageAlign('right')} />
            <button
              type="button"
              onClick={() => setImageWidth('50%')}
              className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:bg-stone-100"
            >
              50%
            </button>
            <button
              type="button"
              onClick={() => setImageWidth('100%')}
              className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:bg-stone-100"
            >
              100%
            </button>
            <IconButton icon={Copy} label="复制图片" onClick={() => void copySelectedImage()} />
            <IconButton icon={Trash2} label="删除图片" onClick={deleteSelectedImage} />
          </div>
        ) : null}
        {imageBubble ? (
          <button
            type="button"
            aria-label="拖拽缩放图片"
            title="拖拽缩放图片"
            onMouseDown={startImageResize}
            className="fixed z-30 h-4 w-4 rounded border border-white bg-moss shadow-subtle ring-1 ring-ink/20"
            style={{
              left: imageBubble.imageX + imageBubble.width - 8,
              top: imageBubble.imageY + imageBubble.height - 8,
              cursor: 'nwse-resize',
            }}
          />
        ) : null}
        {imageMenu ? (
          <div
            className="fixed z-40 w-52 overflow-hidden rounded-md border border-stone-200 bg-white py-1 text-sm shadow-subtle"
            style={{ left: imageMenu.x, top: imageMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => setImageAlign('left')} className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100">
              <AlignLeft size={15} />
              左浮动
            </button>
            <button type="button" onClick={() => setImageAlign('right')} className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100">
              <AlignRight size={15} />
              右浮动
            </button>
            <button type="button" onClick={() => setImageAlign('center')} className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100">
              <AlignCenter size={15} />
              居中独占
            </button>
            <div className="grid grid-cols-2 border-y border-stone-100">
              <button type="button" onClick={() => setImageWidth('50%')} className="h-9 text-xs text-stone-700 hover:bg-stone-100">
                宽度 50%
              </button>
              <button type="button" onClick={() => setImageWidth('100%')} className="h-9 border-l border-stone-100 text-xs text-stone-700 hover:bg-stone-100">
                宽度 100%
              </button>
            </div>
            <button type="button" onClick={() => void copySelectedImage()} className="flex h-9 w-full items-center gap-2 px-3 text-left text-stone-700 hover:bg-stone-100">
              <Copy size={15} />
              复制图片
            </button>
            <button type="button" onClick={deleteSelectedImage} className="flex h-9 w-full items-center gap-2 border-t border-stone-100 px-3 text-left text-clay hover:bg-stone-100">
              <Trash2 size={15} />
              删除图片
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
