import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Mark, Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bot,
  Bold,
  CheckSquare,
  ChevronDown,
  ChevronsUp,
  Code2,
  Copy,
  Columns2,
  Download,
  Ellipsis,
  Eye,
  File as FileIcon,
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
  Minus as MinusIcon,
  Music as AudioIcon,
  PanelTop as VideoIcon,
  Quote,
  RefreshCw,
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
import type { Note, SharePermission, ShareSettings, ShareType } from '../types';
import { createImageAttachment, updateImageAttachment } from '../lib/db';
import { dataUrlMimeType, dataUrlSizeBytes, fileToBase64Image } from '../lib/image';
import { formatFullDate, formatUpdatedAt } from '../lib/date';
import { focusCodeBlockAtPoint } from '../editor/codeBlockFocus';
import { focusEditorEndFromCanvasClick } from '../editor/editorCanvasFocus';
import { CODE_LANGUAGES, codeLanguageLabel, highlightCodeBlocks } from '../editor/codeBlockUtils';
import { ResizableImage } from '../editor/ResizableImage';
import { getTagDisplayName, useI18n } from '../i18n';
import { IconButton } from './IconButton';
import { tagPillStyle } from '../lib/tags';
import type { LocalSaveState } from '../lib/editorStatus';
import { EditorSyncStatus } from './EditorSyncStatus';

interface EditorPaneProps {
  note?: Note;
  saveState: LocalSaveState;
  syncConfigured: boolean;
  syncSessionActive: boolean;
  syncSyncing: boolean;
  syncCheckingBackend: boolean;
  syncError: string;
  syncLastResultOk: boolean;
  syncQueuePending: number;
  syncQueueFailed: number;
  snapshots: NoteSnapshot[];
  shareSettings?: ShareSettings;
  tags: string[];
  tagColors: Record<string, string>;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onManualSave: () => void;
  onSyncRetry: () => void;
  onSyncDiagnose: () => void;
  onToggleTag: (tag: string) => void;
  onTogglePin: () => void;
  onDeleteNote: () => void;
  onRestoreSnapshot: (snapshot: NoteSnapshot) => void;
  onShareSettingsChange: (changes: Partial<Pick<ShareSettings, 'type' | 'permission'>>) => void;
}

export interface NoteSnapshot {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

interface ImageBubble {
  src: string;
  attachmentId?: string;
  x: number;
  y: number;
  imageX: number;
  imageY: number;
  width: number;
  height: number;
}

interface ImageMenu {
  src: string;
  attachmentId?: string;
  x: number;
  y: number;
}

interface CodeCopyOverlay {
  text: string;
  x: number;
  y: number;
  language: string;
  collapsed: boolean;
}

const TASK_LIST_TEMPLATE = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Todo</p></li></ul>';

export function EditorPane({
  note,
  saveState,
  syncConfigured,
  syncSessionActive,
  syncSyncing,
  syncCheckingBackend,
  syncError,
  syncLastResultOk,
  syncQueuePending,
  syncQueueFailed,
  snapshots,
  shareSettings,
  tags,
  tagColors,
  onTitleChange,
  onContentChange,
  onManualSave,
  onSyncRetry,
  onSyncDiagnose,
  onToggleTag,
  onTogglePin,
  onDeleteNote,
  onRestoreSnapshot,
  onShareSettingsChange,
}: EditorPaneProps) {
  const { language, locale, setLanguage, t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const hoveredCodeBlockRef = useRef<HTMLPreElement | null>(null);
  const codeLanguage = 'javascript';
  const [imageBubble, setImageBubble] = useState<ImageBubble | null>(null);
  const [imageMenu, setImageMenu] = useState<ImageMenu | null>(null);
  const [imagePreviewSrc, setImagePreviewSrc] = useState('');
  const [imageUploadProgress, setImageUploadProgress] = useState<number | null>(null);
  const [codeCopyOverlay, setCodeCopyOverlay] = useState<CodeCopyOverlay | null>(null);
  const [collapsedCodeBlocks, setCollapsedCodeBlocks] = useState<Record<string, boolean>>({});
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [wideLayout, setWideLayout] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
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
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      UnderlineMark,
      VideoNode,
      AudioNode,
      FileAttachmentNode,
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
      handleDOMEvents: {
        mousedown: focusCodeBlockAtPoint,
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

      setImageUploadProgress(5);
      for (const [index, file] of files.entries()) {
        const src = await fileToBase64Image(file);
        const attachment = await createImageAttachment({
          noteId: note.id,
          data: src,
          mimeType: dataUrlMimeType(src),
          sizeBytes: dataUrlSizeBytes(src),
        });
        editor
          .chain()
          .focus()
          .setImage({ src, alt: file.name, width: '50%', align: 'left', attachmentId: attachment.id } as never)
          .run();
        setImageUploadProgress(Math.round(((index + 1) / files.length) * 100));
      }
      window.setTimeout(() => setImageUploadProgress(null), 650);
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
      attachmentId: selected.getAttribute('data-attachment-id') || undefined,
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
        attachmentId: image.getAttribute('data-attachment-id') || undefined,
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
      hoveredCodeBlockRef.current = null;
      return;
    }

    const rect = pre.getBoundingClientRect();
    const code = pre.querySelector('code');
    const text = code?.textContent || pre.textContent || '';
    const language =
      Array.from(code?.classList || [])
        .find((className) => className.startsWith('language-'))
        ?.replace('language-', '') || 'javascript';
    const blockId = codeBlockId(pre);
    hoveredCodeBlockRef.current = pre;
    const next = {
      text,
      x: Math.max(16, Math.min(rect.right - 236, window.innerWidth - 252)),
      y: Math.max(84, rect.top + 8),
      language,
      collapsed: Boolean(collapsedCodeBlocks[blockId]),
    };
    setCodeCopyOverlay((current) =>
      current &&
      current.text === next.text &&
      current.x === next.x &&
      current.y === next.y &&
      current.language === next.language &&
      current.collapsed === next.collapsed
        ? current
        : next,
    );
  }, [collapsedCodeBlocks]);

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

  function insertCodeBlock() {
    editor?.chain().focus().toggleCodeBlock({ language: codeLanguage }).run();
  }

  function insertParagraphBlock(content: string) {
    editor?.chain().focus().insertContent(content).run();
  }

  async function insertMediaFile(file: File, kind: 'video' | 'audio' | 'file') {
    if (!editor || !note) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const attachment = await createImageAttachment({
      noteId: note.id,
      data: dataUrl,
      mimeType: file.type || dataUrlMimeType(dataUrl),
      sizeBytes: file.size || dataUrlSizeBytes(dataUrl),
    });
    const safeName = escapeHtml(file.name);
    const attachmentAttr = ` data-attachment-id="${escapeHtml(attachment.id)}"`;
    if (kind === 'video') {
      editor.chain().focus().insertContent(`<video controls src="${dataUrl}" title="${safeName}"${attachmentAttr}></video><p></p>`).run();
      showToast('视频已插入');
      return;
    }
    if (kind === 'audio') {
      editor.chain().focus().insertContent(`<audio controls src="${dataUrl}" title="${safeName}"${attachmentAttr}></audio><p></p>`).run();
      showToast('音频已插入');
      return;
    }
    editor.chain().focus().insertContent(`<file-attachment href="${dataUrl}" filename="${safeName}"${attachmentAttr}></file-attachment>`).run();
    showToast('文件已插入');
  }

  function showToast(message: string, duration = 1400) {
    setToast(message);
    window.setTimeout(() => setToast(''), duration);
  }

  function toggleUnderline() {
    editor?.chain().focus().toggleMark('underline').run();
  }

  async function copyCodeText(text: string) {
    await navigator.clipboard.writeText(text);
    showToast(t('editor.codeCopied'));
  }

  async function copySelectedImage() {
    const src = (editor?.getAttributes('image') as { src?: string })?.src;
    if (!src) {
      return;
    }
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showToast(t('editor.imageCopied'));
  }

  async function downloadSelectedImage() {
    const src = (editor?.getAttributes('image') as { src?: string })?.src;
    if (!src) {
      return;
    }
    const link = document.createElement('a');
    link.href = src;
    link.download = `${note?.title || 'marknote-image'}.png`;
    link.click();
    showToast('图片已下载');
  }

  async function replaceSelectedImage(file: File) {
    if (!editor || !file.type.startsWith('image/')) {
      return;
    }
    setImageUploadProgress(10);
    const src = await fileToBase64Image(file);
    const attrs = editor.getAttributes('image') as { attachmentId?: string };
    let attachmentId = attrs.attachmentId;
    if (attachmentId) {
      await updateImageAttachment(attachmentId, {
        data: src,
        mimeType: dataUrlMimeType(src),
        sizeBytes: dataUrlSizeBytes(src),
      });
    } else if (note) {
      const attachment = await createImageAttachment({
        noteId: note.id,
        data: src,
        mimeType: dataUrlMimeType(src),
        sizeBytes: dataUrlSizeBytes(src),
      });
      attachmentId = attachment.id;
    }
    editor.chain().focus().updateAttributes('image', { src, alt: file.name, attachmentId }).run();
    setImageUploadProgress(100);
    setImageBubble(null);
    setImageMenu(null);
    window.setTimeout(() => setImageUploadProgress(null), 650);
    showToast('图片已替换');
  }

  function previewSelectedImage() {
    const src = (editor?.getAttributes('image') as { src?: string })?.src;
    if (src) {
      setImagePreviewSrc(src);
    }
  }

  function toggleHoveredCodeBlock() {
    const pre = hoveredCodeBlockRef.current;
    if (!pre) {
      return;
    }
    const id = codeBlockId(pre);
    setCollapsedCodeBlocks((current) => {
      const collapsed = !current[id];
      pre.classList.toggle('is-collapsed', collapsed);
      return { ...current, [id]: collapsed };
    });
    setCodeCopyOverlay((current) => (current ? { ...current, collapsed: !current.collapsed } : current));
  }

  function setHoveredCodeLanguage(language: string) {
    const pre = hoveredCodeBlockRef.current;
    if (!pre || !editor) {
      return;
    }
    const position = editor.view.posAtDOM(pre, 0);
    const selection = NodeSelection.create(editor.state.doc, position);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.chain().focus().updateAttributes('codeBlock', { language }).run();
    setCodeCopyOverlay((current) => (current ? { ...current, language } : current));
    showToast(`代码语言：${codeLanguageLabel(language)}`);
  }

  function runAiAction(action: string) {
    if (!editor || !note) {
      return;
    }

    const { from, to, empty } = editor.state.selection;
    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '\n').trim();
    const wholeText = editor.state.doc.textContent.trim();
    const source = selectedText || wholeText || note.title;
    const snippets: Record<string, string> = {
      continue: `<p>${source}。接下来可以继续补充背景、关键结论和下一步行动。</p>`,
      summarize: `<blockquote><p>总结：${source.slice(0, 96)}${source.length > 96 ? '...' : ''}</p></blockquote>`,
      polish: `<p>${source.replace(/这是一个/g, '这是一个更加清晰的')}</p>`,
      translate: `<p>Translation: ${source}</p>`,
      title: `<h2>${source.split(/[。.!?\n]/)[0].slice(0, 28) || '新的标题'}</h2>`,
      outline: '<ul><li>背景与目标</li><li>关键内容</li><li>下一步行动</li></ul>',
      todos:
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>整理重点</p></li><li data-type="taskItem" data-checked="false"><p>确认下一步</p></li></ul>',
    };

    editor.chain().focus().insertContent(snippets[action] || '').run();
    setAiOpen(false);
    showToast('AI 已生成内容');
  }

  async function copyShareLink(type: string) {
    if (!note) {
      return;
    }
    const linkId = shareSettings?.linkId || note.id;
    const url = `https://marknote.app/share/${linkId}`;
    await navigator.clipboard.writeText(url);
    setShareOpen(false);
    showToast(`${type}链接已复制`);
  }

  function deleteSelectedImage() {
    const attachmentId =
      (editor?.getAttributes('image') as { attachmentId?: string } | undefined)?.attachmentId ||
      imageBubble?.attachmentId ||
      imageMenu?.attachmentId;
    if (attachmentId) {
      void updateImageAttachment(attachmentId, { deletedAt: Date.now() });
    }
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

  const stats = noteStats(editor?.state.doc.textContent || '');
  const snapshotGroups = groupSnapshots(snapshots);
  const shareTypes: Array<{ type: ShareType; label: string }> = [
    { type: 'private', label: t('editor.sharePrivate') },
    { type: 'public', label: t('editor.sharePublic') },
    { type: 'team', label: t('editor.shareTeam') },
  ];
  const sharePermissions: Array<{ permission: SharePermission; label: string }> = [
    { permission: 'read', label: t('editor.shareRead') },
    { permission: 'comment', label: t('editor.shareComment') },
    { permission: 'edit', label: t('editor.shareEdit') },
  ];
  const currentShareSettings = shareSettings || {
    type: 'private' as const,
    permission: 'read' as const,
    linkId: note.id,
    updatedAt: note.updatedAt,
  };
  const slashCommands: Array<{ label: string; content: string | null; inputRef: React.RefObject<HTMLInputElement> | null }> = [
    { label: 'Text', content: '<p>Text</p>', inputRef: null },
    { label: 'Heading', content: '<h2>Heading</h2>', inputRef: null },
    { label: 'Todo', content: TASK_LIST_TEMPLATE, inputRef: null },
    { label: 'Image', content: null, inputRef: fileInputRef },
    { label: 'Video', content: null, inputRef: videoInputRef },
    { label: 'Audio', content: null, inputRef: audioInputRef },
    { label: 'File', content: null, inputRef: attachmentInputRef },
    { label: 'Table', content: '<p>| Key | Value |</p><p>| --- | --- |</p>', inputRef: null },
    { label: 'Code', content: '<pre><code class="language-javascript">console.log()</code></pre>', inputRef: null },
    { label: 'Quote', content: '<blockquote><p>Quote</p></blockquote>', inputRef: null },
    { label: 'Callout', content: '<blockquote><p>Callout</p></blockquote>', inputRef: null },
    { label: 'Divider', content: '<hr><p></p>', inputRef: null },
    { label: 'Mermaid', content: '<pre><code class="language-mermaid">graph TD\\nA-->B</code></pre>', inputRef: null },
    { label: 'Math', content: '<p>$$ E = mc^2 $$</p>', inputRef: null },
  ];

  return (
    <main className={`grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_48px] bg-white ${focusMode ? 'marknote-focus-mode' : ''}`}>
      <header className={`bg-white px-8 pb-2 pt-5 ${focusMode ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <input
              value={note.title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="min-w-0 bg-transparent text-[17px] font-semibold leading-tight text-[#111827] outline-none"
              placeholder={t('note.untitled')}
            />
            <EditorSyncStatus
              saveState={saveState}
              syncConfigured={syncConfigured}
              syncSessionActive={syncSessionActive}
              syncSyncing={syncSyncing}
              syncCheckingBackend={syncCheckingBackend}
              syncError={syncError}
              syncLastResultOk={syncLastResultOk}
              syncQueuePending={syncQueuePending}
              syncQueueFailed={syncQueueFailed}
              onSyncRetry={onSyncRetry}
              onSyncDiagnose={onSyncDiagnose}
            />
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
                <div className="absolute right-0 top-11 z-40 max-h-[520px] w-80 overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white p-3 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase text-[#6b7280]">历史版本</div>
                    <span className="text-xs text-[#9ca3af]">{snapshots.length} 个快照</span>
                  </div>
                  <div className="space-y-3">
                    {snapshots.length === 0 ? (
                      <div className="rounded-lg bg-[#f8fafc] p-3 text-xs text-[#6b7280]">暂无历史快照</div>
                    ) : (
                      snapshotGroups.map((group) => (
                        <div key={group.label}>
                          <div className="mb-1.5 text-xs font-semibold text-[#6b7280]">{group.label}</div>
                          <div className="space-y-2">
                            {group.snapshots.map((snapshot) => (
                              <div key={snapshot.id} className="rounded-lg bg-[#f8fafc] p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 text-xs font-medium text-[#111827]">{formatFullDate(snapshot.createdAt, locale)}</div>
                                  <span className="text-[11px] text-[#9ca3af]">{stripText(snapshot.content).length} 字</span>
                                </div>
                                <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                                  <button type="button" onClick={() => showToast(`与当前版本相差 ${Math.abs(stripText(editor?.getHTML() || '').length - stripText(snapshot.content).length)} 字`)} className="h-7 rounded border border-[#e5e7eb] bg-white text-[#4b5563] hover:bg-[#f3f4f6]">
                                    {t('editor.versionCompare')}
                                  </button>
                                  <button type="button" onClick={() => onRestoreSnapshot(snapshot)} className="h-7 rounded border border-[#e5e7eb] bg-white text-[#4b5563] hover:bg-[#f3f4f6]">
                                    {t('editor.versionRestore')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(snapshot.content);
                                      showToast('版本内容已复制');
                                    }}
                                    className="h-7 rounded border border-[#e5e7eb] bg-white text-[#4b5563] hover:bg-[#f3f4f6]"
                                  >
                                    {t('editor.versionCopy')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <TopIconButton label="收藏" active={note.pinned} onClick={onTogglePin}>
              <Star size={19} className={note.pinned ? 'fill-[#2f7df6] text-[#2f7df6]' : ''} />
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
                <div className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-[#e5e7eb] bg-white p-3 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  <div className="mb-3 text-xs font-semibold uppercase text-[#6b7280]">{t('editor.shareType')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {shareTypes.map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => onShareSettingsChange({ type: item.type })}
                        className={`h-8 rounded-md text-xs ${currentShareSettings.type === item.type ? 'bg-[#eaf2ff] font-semibold text-[#2563eb]' : 'text-[#4b5563] hover:bg-[#f3f4f6]'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="mb-2 mt-4 text-xs font-semibold uppercase text-[#6b7280]">{t('editor.sharePermission')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {sharePermissions.map((item) => (
                      <button
                        key={item.permission}
                        type="button"
                        onClick={() => onShareSettingsChange({ permission: item.permission })}
                        className={`h-8 rounded-md text-xs ${currentShareSettings.permission === item.permission ? 'bg-[#eaf2ff] font-semibold text-[#2563eb]' : 'text-[#4b5563] hover:bg-[#f3f4f6]'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 rounded-lg bg-[#f8fafc] p-2 text-xs text-[#6b7280]">
                    <div className="truncate text-[#374151]">marknote.app/share/{currentShareSettings.linkId}</div>
                    <div className="mt-1">{t('editor.shareCurrent')}：{shareTypes.find((item) => item.type === currentShareSettings.type)?.label} · {sharePermissions.find((item) => item.permission === currentShareSettings.permission)?.label}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyShareLink(shareTypes.find((item) => item.type === currentShareSettings.type)?.label || '分享')}
                    className="mt-3 h-9 w-full rounded-lg bg-[#2563eb] text-sm font-semibold text-white hover:bg-[#1d4ed8] active:scale-[0.98]"
                  >
                    {t('editor.shareCopyLink')}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen((value) => !value);
                  setShareOpen(false);
                  setHistoryOpen(false);
                  setAiOpen(false);
                }}
                className="grid h-9 w-9 place-items-center rounded-lg text-[#111827] hover:bg-[#f3f4f6]"
                title="更多"
                aria-label="更多"
              >
                <Ellipsis size={20} />
              </button>
              {moreOpen ? (
                <div className="absolute right-0 top-11 z-40 w-44 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white py-1 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  <MenuAction label={t('editor.save')} onClick={onManualSave} />
                  <MenuAction label="复制标题" onClick={() => void navigator.clipboard.writeText(note.title)} />
                  <MenuAction label="删除笔记" danger onClick={onDeleteNote} />
                </div>
              ) : null}
            </div>
            <div className="h-8 w-px bg-[#e5e7eb]" />
            <TopIconButton label="布局" active={wideLayout} onClick={() => {
              setWideLayout((value) => !value);
            }}>
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
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#2f7df6] px-3 text-xs font-semibold text-white transition hover:bg-[#256ce0] active:scale-[0.98]"
                aria-label={t('editor.ai')}
                title={t('editor.ai')}
              >
                <Sparkles size={15} />
                {t('editor.ai')}
                <ChevronDown size={13} />
              </button>
              {aiOpen ? (
                <div className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  {[
                    ['continue', t('editor.aiContinue'), Wand2],
                    ['summarize', t('editor.aiSummarize'), Bot],
                    ['polish', t('editor.aiPolish'), Sparkles],
                    ['translate', t('editor.aiTranslate'), MessageSquareQuote],
                    ['title', t('editor.aiTitle'), Heading1],
                    ['outline', t('editor.aiOutline'), ListChecks],
                    ['todos', t('editor.aiTodos'), CheckSquare],
                  ].map(([action, label, Icon]) => (
                    <button
                      key={String(label)}
                      type="button"
                      onClick={() => runAiAction(String(action))}
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tags.slice(0, 10).map((tag) => {
            const active = note.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                style={active ? tagPillStyle(tag, tagColors, 'solid') : tagPillStyle(tag, tagColors)}
                className="h-7 rounded-lg border px-3 text-[13px] font-medium transition hover:-translate-y-0.5"
              >
                {active ? getTagDisplayName(tag, t) : `+ ${getTagDisplayName(tag, t)}`}
              </button>
            );
          })}
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
            <IconButton icon={CheckSquare} label={t('editor.checklist')} onClick={() => insertParagraphBlock(TASK_LIST_TEMPLATE)} />
            <IconButton icon={Quote} label={t('editor.quote')} active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
            <IconButton icon={MinusIcon} label={t('editor.divider')} onClick={() => insertParagraphBlock('<hr><p></p>')} />
            <IconButton icon={Link} label="链接" onClick={() => insertParagraphBlock('<p><a href="#">链接</a></p>')} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.mediaBlocks')}>
            <IconButton icon={ImagePlus} label={t('editor.insertImage')} onClick={() => fileInputRef.current?.click()} />
            <IconButton icon={VideoIcon} label={t('editor.video')} onClick={() => videoInputRef.current?.click()} />
            <IconButton icon={AudioIcon} label={t('editor.audio')} onClick={() => audioInputRef.current?.click()} />
            <IconButton icon={FileIcon} label={t('editor.file')} onClick={() => attachmentInputRef.current?.click()} />
            <IconButton icon={Table2} label={t('editor.table')} onClick={() => insertParagraphBlock('<p>| Key | Value |</p><p>| --- | --- |</p>')} />
          </ToolbarGroup>
          <ToolbarGroup label={t('editor.dataBlocks')}>
            <IconButton icon={Sigma} label={t('editor.math')} onClick={() => insertParagraphBlock('<p>$$ E = mc^2 $$</p>')} />
            <IconButton icon={Code2} label={t('editor.mermaid')} onClick={() => insertParagraphBlock('<pre><code class="language-mermaid">graph TD\\nA-->B</code></pre>')} />
          </ToolbarGroup>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setSlashOpen((value) => !value);
                setSlashQuery('');
              }}
              className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-[#111827] hover:bg-[#f3f4f6]"
              title={t('editor.slashHint')}
              aria-label={t('editor.slashHint')}
            >
              /
            </button>
            {slashOpen ? (
              <div className="absolute left-0 top-10 z-40 w-56 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                <input
                  value={slashQuery}
                  onChange={(event) => setSlashQuery(event.target.value)}
                  className="mb-1 h-8 w-full rounded-lg border border-[#e5e7eb] px-2 text-xs text-[#111827] outline-none focus:border-[#3b82f6]"
                  placeholder="搜索命令"
                  autoFocus
                />
                {slashCommands
                  .filter((command) => fuzzyMatch(command.label, slashQuery))
                  .map((command) => (
                    <button
                      key={command.label}
                      type="button"
                      onClick={() => {
                        if (command.content) {
                          insertParagraphBlock(command.content);
                        } else {
                          command.inputRef?.current?.click();
                        }
                        setSlashOpen(false);
                        setSlashQuery('');
                      }}
                      className="flex h-9 w-full items-center rounded-lg px-3 text-left text-[#374151] hover:bg-[#f3f4f6]"
                    >
                      {command.label}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section
        ref={editorShellRef}
        className={`relative min-h-0 overflow-y-auto bg-white pb-20 pl-14 pr-10 pt-7 transition ${wideLayout ? 'marknote-wide-editor' : ''} ${
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
        onClick={(event) => {
          focusEditorEndFromCanvasClick(editor, event.target, event.currentTarget);
        }}
      >
        {imageUploadProgress !== null ? (
          <div className="fixed left-1/2 top-24 z-40 w-64 -translate-x-1/2 overflow-hidden rounded-lg border border-[#bfdbfe] bg-white p-2 text-xs text-[#2563eb] shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
            <div className="mb-1 flex items-center justify-between">
              <span>图片上传中</span>
              <span>{imageUploadProgress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#dbeafe]">
              <div className="h-full rounded-full bg-[#2563eb] transition-all" style={{ width: `${imageUploadProgress}%` }} />
            </div>
          </div>
        ) : null}
        <EditorContent editor={editor} />
        {toast ? <div className="fixed bottom-5 right-5 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-subtle">{toast}</div> : null}
        {codeCopyOverlay ? (
          <div
            data-code-copy-overlay="true"
            className="fixed z-30 inline-flex h-8 items-center gap-1 rounded-md border border-white/15 bg-white/10 px-1.5 text-xs text-white shadow-subtle backdrop-blur"
            style={{ left: codeCopyOverlay.x, top: codeCopyOverlay.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <select
              value={codeCopyOverlay.language}
              onChange={(event) => setHoveredCodeLanguage(event.target.value)}
              className="h-6 max-w-[104px] rounded border border-white/15 bg-[#111827] px-1 text-[11px] text-white outline-none"
              aria-label="代码语言"
            >
              {CODE_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {codeLanguageLabel(language)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('editor.copyCode')}
              title={t('editor.copyCode')}
              onClick={() => void copyCodeText(codeCopyOverlay.text)}
              className="grid h-6 w-6 place-items-center rounded hover:bg-white/20"
            >
              <Copy size={13} />
            </button>
            <button
              type="button"
              aria-label={codeCopyOverlay.collapsed ? '展开代码块' : '折叠代码块'}
              title={codeCopyOverlay.collapsed ? '展开代码块' : '折叠代码块'}
              onClick={toggleHoveredCodeBlock}
              className="grid h-6 w-6 place-items-center rounded hover:bg-white/20"
            >
              <ChevronsUp size={13} className={codeCopyOverlay.collapsed ? 'rotate-180' : ''} />
            </button>
          </div>
        ) : null}
        {imageBubble ? (
          <div
            className="fixed z-30 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-subtle"
            style={{ left: imageBubble.x, top: imageBubble.y }}
          >
            <IconButton icon={AlignLeft} label={t('editor.imageLeft')} onClick={() => setImageAlign('left')} />
            <IconButton icon={AlignCenter} label={t('editor.imageCenter')} onClick={() => setImageAlign('center')} />
            <IconButton icon={AlignRight} label={t('editor.imageRight')} onClick={() => setImageAlign('right')} />
            <IconButton icon={Eye} label="预览图片" onClick={previewSelectedImage} />
            <IconButton icon={RefreshCw} label="替换图片" onClick={() => replaceImageInputRef.current?.click()} />
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
            <IconButton icon={Download} label="下载图片" onClick={() => void downloadSelectedImage()} />
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
            <button type="button" onClick={previewSelectedImage} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <Eye size={15} />
              预览
            </button>
            <button type="button" onClick={() => replaceImageInputRef.current?.click()} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <RefreshCw size={15} />
              替换
            </button>
            <button type="button" onClick={() => void downloadSelectedImage()} className="flex h-9 w-full items-center gap-2 px-3 text-left text-gray-700 hover:bg-gray-50">
              <Download size={15} />
              下载
            </button>
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
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void insertMediaFile(file, 'video');
              event.target.value = '';
            }
          }}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void insertMediaFile(file, 'audio');
              event.target.value = '';
            }
          }}
        />
        <input
          ref={attachmentInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void insertMediaFile(file, 'file');
              event.target.value = '';
            }
          }}
        />
        <input
          ref={replaceImageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void replaceSelectedImage(file);
              event.target.value = '';
            }
          }}
        />
        {imagePreviewSrc ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-[#0f172a]/72 p-8" onClick={() => setImagePreviewSrc('')}>
            <div className="relative max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
              <img src={imagePreviewSrc} alt="图片预览" className="max-h-[82vh] max-w-[82vw] rounded-lg bg-white object-contain shadow-[0_28px_80px_rgba(0,0,0,0.4)]" />
              <button
                type="button"
                onClick={() => setImagePreviewSrc('')}
                className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#111827] shadow hover:bg-white"
                aria-label="关闭预览"
              >
                ×
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <footer className="flex h-12 items-center justify-between border-t border-[#e5e7eb] px-9 text-[13px] text-[#6b7280]">
        <div className="flex items-center gap-7">
          <span>字数：{stats.characters}</span>
          <span>词数：{stats.words}</span>
          <span>行数：{stats.lines}</span>
        </div>
        <div className="flex items-center gap-7">
          <span>最后编辑：{formatUpdatedAt(note.updatedAt, locale)}</span>
          <button type="button" onClick={() => showToast('帮助：选中文字后可使用 AI 或工具栏处理')} className="hover:text-[#111827]">?</button>
          <button type="button" onClick={() => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN')} className="hover:text-[#111827]">{language === 'zh-CN' ? '中' : 'EN'}</button>
          <button type="button" onClick={() => setFocusMode((value) => !value)} className="hover:text-[#111827]">{focusMode ? '↙' : '↗'}</button>
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

function TopIconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-9 w-9 place-items-center rounded-lg transition hover:bg-[#f3f4f6] ${
        active ? 'bg-[#eaf2ff] text-[#2f7df6]' : 'text-[#111827]'
      }`}
    >
      {children}
    </button>
  );
}

function MenuAction({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-9 w-full items-center px-3 text-left hover:bg-[#f3f4f6] ${danger ? 'text-[#ef4444]' : 'text-[#374151]'}`}>
      {label}
    </button>
  );
}

function noteStats(text: string) {
  const normalized = text.trim();
  return {
    characters: normalized.length,
    words: normalized ? normalized.split(/\s+/).length : 0,
    lines: Math.max(1, normalized.split(/\n+/).length),
  };
}

function stripText(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] || char;
  });
}

function fuzzyMatch(label: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  let cursor = 0;
  const haystack = label.toLowerCase();
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

function groupSnapshots(snapshots: NoteSnapshot[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const groups = [
    { label: '今天', snapshots: [] as NoteSnapshot[] },
    { label: '昨天', snapshots: [] as NoteSnapshot[] },
    { label: '7天内', snapshots: [] as NoteSnapshot[] },
    { label: '30天内', snapshots: [] as NoteSnapshot[] },
  ];

  for (const snapshot of snapshots) {
    if (snapshot.createdAt >= startOfToday) {
      groups[0].snapshots.push(snapshot);
    } else if (snapshot.createdAt >= startOfYesterday) {
      groups[1].snapshots.push(snapshot);
    } else if (snapshot.createdAt >= startOfToday - 7 * 24 * 60 * 60 * 1000) {
      groups[2].snapshots.push(snapshot);
    } else {
      groups[3].snapshots.push(snapshot);
    }
  }

  return groups.filter((group) => group.snapshots.length > 0);
}

function codeBlockId(pre: HTMLPreElement): string {
  const existing = pre.dataset.codeBlockId;
  if (existing) {
    return existing;
  }
  const id = `code-${Math.random().toString(36).slice(2)}`;
  pre.dataset.codeBlockId = id;
  return id;
}

const VideoNode = TiptapNode.create({
  name: 'video',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      controls: { default: true },
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? {
                'data-attachment-id': attributes.attachmentId,
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'video' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true' })];
  },
});

const AudioNode = TiptapNode.create({
  name: 'audio',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      controls: { default: true },
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? {
                'data-attachment-id': attributes.attachmentId,
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'audio' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true' })];
  },
});

const FileAttachmentNode = TiptapNode.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      href: { default: null },
      filename: { default: '下载文件' },
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? {
                'data-attachment-id': attributes.attachmentId,
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'file-attachment' }, { tag: 'a[download]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const filename = HTMLAttributes.filename || HTMLAttributes.download || '下载文件';
    return ['a', mergeAttributes(HTMLAttributes, { download: filename, href: HTMLAttributes.href, class: 'marknote-file-attachment' }), filename];
  },
});

const UnderlineMark = Mark.create({
  name: 'underline',

  parseHTML() {
    return [{ tag: 'u' }, { style: 'text-decoration-line=underline' }, { style: 'text-decoration=underline' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0];
  },

});
