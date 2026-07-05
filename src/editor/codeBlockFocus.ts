import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export function focusCodeBlockAtPoint(view: EditorView, event: MouseEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('pre')) {
    return false;
  }

  const resolvedPosition = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  if (!resolvedPosition) {
    return false;
  }

  event.preventDefault();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, resolvedPosition.pos)));
  view.focus();
  return true;
}
