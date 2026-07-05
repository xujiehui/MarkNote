import type { Editor } from '@tiptap/react';

export function focusEditorEndFromCanvasClick(editor: Editor | null, target: EventTarget | null, canvas: HTMLElement | null): boolean {
  if (!editor || !canvas || target !== canvas) {
    return false;
  }

  editor.chain().focus('end').run();
  return true;
}
