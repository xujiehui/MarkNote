# MarkNote PRD Audit

This audit maps the requested PRD to current implementation evidence.

## Delivery Shape

- Cross-platform delivery: implemented as a PWA and Electron desktop app.
- macOS desktop artifacts generated under `release/`: `MarkNote.app`, `MarkNote-0.1.0.dmg`, and `MarkNote-0.1.0-mac.zip`.
- Windows desktop build scripts are configured through electron-builder: `npm run dist:win`.
- Local install path: documented in `README.md`.
- PWA assets: `public/manifest.webmanifest`, `public/sw.js`, and service worker registration in `src/main.tsx`.
- Electron main/preload process: `electron/main.ts`, `electron/preload.cts`, `tsconfig.electron.json`.

## Technology Stack

- React + TypeScript + Tailwind CSS: `package.json`, `src/main.tsx`, `src/styles.css`, `tailwind.config.js`.
- Tiptap editor: `src/components/EditorPane.tsx`, `src/editor/ResizableImage.ts`.
- Syntax highlighting: `highlight.js` via `src/editor/codeBlockUtils.ts` and `src/lib/html.ts`.
- IndexedDB through Dexie: `src/lib/db.ts`.
- Export libraries: `file-saver`, `html2canvas`, and `jspdf` in `src/lib/importExport.ts`.

## Data Model

- `Note` and `ImageAttachment` interfaces: `src/types.ts`.
- Soft-delete support adds `deletedAt` to satisfy trash retention.
- Data-layer tests: `tests/db.test.ts`.

## UI Layout

- 240px sidebar: `src/components/Sidebar.tsx`.
- 300px virtual note list: `src/components/NoteList.tsx`.
- Editor pane with title input and formatting toolbar: `src/components/EditorPane.tsx`.
- Default tags: `src/lib/db.ts`.
- Right-click note menu for pin, delete, tag toggle: `src/components/ContextMenu.tsx`.

## Images

- Toolbar image upload, paste, and drag/drop insertion: `src/components/EditorPane.tsx`.
- Base64 conversion and >2MB compression to 1200px width at quality 0.8: `src/lib/image.ts`.
- Default left float, left/right/center alignment controls, 50%/100% width controls, copy/delete controls, and drag resize handle: `src/components/EditorPane.tsx`, `src/editor/ResizableImage.ts`.

## Code Blocks

- Toolbar language selector and code button: `src/components/EditorPane.tsx`.
- Markdown-style triple-backtick input is provided by Tiptap StarterKit input rules.
- Dark theme, syntax highlighting, copy button, and line numbers: `src/styles.css`, `src/editor/codeBlockUtils.ts`.
- Exported HTML/PDF pre-renders highlighted code and line numbers: `src/lib/html.ts`.

## Import And Export

- HTML export with inline CSS and Base64 images: `src/lib/importExport.ts`, `src/lib/html.ts`.
- PDF export via lazy-loaded `html2canvas` and `jspdf`: `src/lib/importExport.ts`.
- Markdown export preserving Base64 images and fenced language code: `src/lib/importExport.ts`.
- Markdown, HTML, and JSON import: `src/lib/importExport.ts`, `src/App.tsx`.
- JSON backup import preserves full note metadata and upserts by note id: `src/lib/importExport.ts`, `src/lib/db.ts`, `src/App.tsx`.
- Remote Markdown image prompt and best-effort CORS fetch to Base64: `src/App.tsx`, `src/lib/importExport.ts`.
- Import/export regression tests: `tests/importExport.test.ts`.
- Data persistence, backup upsert, raw-text extraction, and trash purge tests: `tests/db.test.ts`.

## Search And Organization

- Full-text filtering across title and stripped HTML body: `src/App.tsx`, `src/lib/html.ts`.
- Tag filtering: `src/App.tsx`, `src/components/Sidebar.tsx`.
- Trash restore, permanent delete, and 30-day purge: `src/App.tsx`, `src/lib/db.ts`, `tests/db.test.ts`.

## Shortcuts

- New note, save, search focus, image insert, and code block insert shortcuts: `src/App.tsx`.
- Bold uses the browser/editor standard Ctrl+B through Tiptap and contenteditable behavior, plus toolbar control.

## Performance

- 500ms debounced autosave: `src/App.tsx`.
- Search debounce: `src/hooks/useDebouncedValue.ts`.
- Virtualized note list for large note counts: `src/components/NoteList.tsx`.
- Import/export and PDF libraries are lazy-loaded from `src/App.tsx` and `src/lib/importExport.ts`.

## Verification

Latest verified commands:

```bash
npm run lint
npm test
npm run desktop:build
npm run dist:mac
npm audit
```

Current audit status: `found 0 vulnerabilities`.
Latest build confirms separate lazy chunks for `importExport`, `html2canvas`, and `jspdf`.
Packaged app launch check: `open release/mac/MarkNote.app` succeeded, and System Events reported a running `MarkNote` process.

## Known Caveats

- macOS artifacts are unsigned because no valid Developer ID certificate is available in this environment. Public distribution requires signing and notarization.
- Windows artifacts are configured but not built in this macOS environment; run `npm run dist:win` on Windows or Windows CI.
- Browser automation was intermittently unstable in the Codex in-app browser, so final validation relies on command-level tests, build output, audit output, and HTTP 200 checks from the local dev server.
- The main app chunk is still larger than ideal because the rich editor stack loads on first screen, but export/PDF-heavy dependencies are split into lazy chunks.
