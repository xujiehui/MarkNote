# MarkNote

MarkNote is a cross-platform rich note workspace built with React, TypeScript, Tailwind CSS, Tiptap, Dexie/IndexedDB, html2canvas, jsPDF, and FileSaver.

It runs as a local web app and can be installed as a PWA on macOS and Windows from any modern Chromium-based browser.

## Run Locally

```bash
npm install --cache ./.npm-cache
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Build

```bash
npm run lint
npm test
npm run build
```

## Features

- Three-column note workspace with a 240px sidebar and 300px virtualized note list.
- Local-first persistence through IndexedDB via Dexie.
- Full-text search across note titles and stripped HTML content.
- Default tags: `工作`, `个人`, `代码片段`.
- Soft-delete trash with restore and permanent delete actions.
- Tiptap rich text editor with headings, bold, italic, quotes, ordered lists, and unordered lists.
- Base64 image insertion through toolbar upload, paste, and drag/drop.
- Image alignment controls for left float, right float, and centered block layout.
- Image right-click menu with copy, delete, 50% width, and 100% width actions.
- Drag handle for proportional image resizing.
- Dark code blocks with syntax highlighting, line numbers, language selection, and copy-code buttons.
- Export current notes as HTML, PDF, and Markdown.
- Export all notes as JSON backup.
- Import Markdown, HTML, and JSON backups.
- Markdown import/export regression test covering Base64 images and fenced code blocks.
- Keyboard shortcuts for new note, save, search, image insert, and code block insert.

## PWA Install

On macOS or Windows, open the app URL in Chrome or Edge and use the browser install action from the address bar or browser menu. Installed data remains local to that browser profile through IndexedDB.
