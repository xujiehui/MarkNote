import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { focusCodeBlockAtPoint } from '../src/editor/codeBlockFocus';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body><pre><code>const value = 1;</code></pre><p>outside</p></body></html>');
installDomGlobals({
  document: dom.window.document,
  Element: dom.window.Element,
  MouseEvent: dom.window.MouseEvent,
  navigator: dom.window.navigator,
  window: dom.window,
});

const editor = new Editor({
  extensions: [StarterKit],
  content: '<pre><code>const value = 1;</code></pre><p>outside</p>',
});

let dispatched = false;
let focused = false;
editor.view.posAtCoords = () => ({ pos: 3, inside: -1 });
editor.view.dispatch = () => {
  dispatched = true;
};
editor.view.focus = () => {
  focused = true;
};

const code = document.querySelector('code');
assert.ok(code);
const codeEvent = new dom.window.MouseEvent('mousedown', {
  clientX: 10,
  clientY: 20,
  bubbles: true,
  cancelable: true,
});
code.dispatchEvent(codeEvent);

assert.equal(focusCodeBlockAtPoint(editor.view, codeEvent), true);
assert.equal(codeEvent.defaultPrevented, true);
assert.equal(dispatched, true);
assert.equal(focused, true);

dispatched = false;
focused = false;
const paragraph = document.querySelector('p');
assert.ok(paragraph);
const paragraphEvent = new dom.window.MouseEvent('mousedown', {
  clientX: 10,
  clientY: 20,
  bubbles: true,
  cancelable: true,
});
paragraph.dispatchEvent(paragraphEvent);

assert.equal(focusCodeBlockAtPoint(editor.view, paragraphEvent), false);
assert.equal(paragraphEvent.defaultPrevented, false);
assert.equal(dispatched, false);
assert.equal(focused, false);

editor.destroy();

console.log('code block focus tests passed');
