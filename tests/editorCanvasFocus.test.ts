import assert from 'node:assert/strict';
import { focusEditorEndFromCanvasClick } from '../src/editor/editorCanvasFocus';

function main() {
  const canvas = {} as HTMLElement;
  const child = {} as HTMLElement;
  const calls: string[] = [];
  const editor = {
    chain: () => ({
      focus: (position: string) => {
        calls.push(`focus:${position}`);
        return {
          run: () => calls.push('run'),
        };
      },
    }),
  };

  assert.equal(focusEditorEndFromCanvasClick(editor as never, canvas, canvas), true);
  assert.deepEqual(calls, ['focus:end', 'run']);

  calls.length = 0;
  assert.equal(focusEditorEndFromCanvasClick(editor as never, child, canvas), false);
  assert.deepEqual(calls, []);

  assert.equal(focusEditorEndFromCanvasClick(null, canvas, canvas), false);

  console.log('editor canvas focus tests passed');
}

main();
