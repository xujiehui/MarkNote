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

## Desktop App

```bash
npm run desktop:build
npm run desktop:pack
npm run dist:mac
npm run dist:win
```

`desktop:pack` creates an unpacked app under `release/mac/MarkNote.app` on macOS. `dist:mac` creates distributable macOS archives. `dist:win` is configured for Windows NSIS and portable builds and should be run on Windows or a CI runner with Windows packaging support.

Current macOS outputs:

- `release/mac/MarkNote.app`
- `release/MarkNote-0.1.0.dmg`
- `release/MarkNote-0.1.0-mac.zip`

The local macOS build is unsigned because no valid Developer ID certificate is available in this environment. For public distribution, sign and notarize with an active Apple Developer ID certificate.

## GitHub Actions Packaging

The repository includes `.github/workflows/desktop-build.yml`.

It runs on pushes, pull requests, version tags (`v*`), and manual workflow dispatch. The workflow builds and uploads:

- macOS Intel artifacts from `macos-15-intel`
- macOS Apple Silicon artifacts from `macos-15`
- Windows x64 artifacts from `windows-latest`

Artifacts are available from the workflow run page for 14 days.

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
