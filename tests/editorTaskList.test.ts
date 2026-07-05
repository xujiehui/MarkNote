import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
installDomGlobals({
  document: dom.window.document,
  navigator: dom.window.navigator,
  window: dom.window,
});

const editor = new Editor({
  extensions: [
    StarterKit,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
  ],
  content:
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>支持 Markdown 语法</p></li><li data-type="taskItem" data-checked="false"><p>支持多端同步</p></li></ul>',
});

const taskItems: Array<{ checked: boolean; text: string }> = [];
editor.state.doc.descendants((node) => {
  if (node.type.name === 'taskItem') {
    taskItems.push({
      checked: Boolean(node.attrs.checked),
      text: node.textContent,
    });
  }
});

assert.deepEqual(taskItems, [
  { checked: true, text: '支持 Markdown 语法' },
  { checked: false, text: '支持多端同步' },
]);

const html = editor.getHTML();
assert.match(html, /<ul data-type="taskList">/);
assert.match(html, /<li data-checked="true" data-type="taskItem">/);
assert.match(html, /<input type="checkbox" checked="checked">/);

editor.destroy();

console.log('editor task list tests passed');
