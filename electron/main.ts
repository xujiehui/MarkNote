import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEEP_LINK_PROTOCOL, createAuthCallbackState, findAuthCallbackUrl, isAuthCallbackUrl } from './authCallbackState.js';
import { isAllowedPreviewFrame, isAllowedRendererPermission, isTrustedIpcSender, isTrustedRendererUrl, PRODUCTION_CSP, safeExternalUrl, trustedDevelopmentUrl } from './securityPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererUrl = isDev
  ? trustedDevelopmentUrl(process.env.VITE_DEV_SERVER_URL!)
  : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;

let mainWindow: BrowserWindow | null = null;
const authCallbackState = createAuthCallbackState(findAuthCallbackUrl(process.argv));

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1672,
    height: 941,
    minWidth: 840,
    minHeight: 560,
    title: 'MarkNote',
    backgroundColor: '#ffffff',
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openAllowedExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => {
    if (!isTrustedRendererUrl(event.url, rendererUrl)) {
      event.preventDefault();
      void openAllowedExternal(event.url);
    }
  });
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isAllowedPreviewFrame(event.url,
      event.frame?.parent === window.webContents.mainFrame,
      event.initiator?.url || '', rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const browserSession = window.webContents.session;
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === window.webContents && isAllowedRendererPermission(permission,
      details.isMainFrame, details.requestingUrl, rendererUrl));
  });
  browserSession.setPermissionCheckHandler((contents, permission, _origin, details) => (
    contents === window.webContents && isAllowedRendererPermission(permission,
      details.isMainFrame, details.requestingUrl || '', rendererUrl)
  ));
  if (!isDev) {
    browserSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType === 'mainFrame' && isTrustedRendererUrl(details.url, rendererUrl)) {
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [PRODUCTION_CSP] } });
      } else {
        callback({ responseHeaders: details.responseHeaders });
      }
    });
  }

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(rendererUrl);
    if (process.env.MARKNOTE_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'), { search: 'app=1' });
  }

  mainWindow = window;
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const callbackUrl = argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`));
    if (callbackUrl) {
      handleAuthCallbackUrl(callbackUrl);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallbackUrl(url);
});

ipcMain.handle('marknote:get-auth-callback', async (event) => {
  requireTrustedSender(event);
  return authCallbackState.peek();
});

ipcMain.handle('marknote:clear-auth-callback', async (event, url: unknown) => {
  requireTrustedSender(event);
  if (typeof url !== 'string' || !isAuthCallbackUrl(url)) throw new Error('Invalid auth callback URL.');
  authCallbackState.clear(url);
});

ipcMain.handle('marknote:open-external', async (event, url: unknown) => {
  requireTrustedSender(event);
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) throw new Error('Only HTTP(S) and mailto links can be opened externally.');
  await shell.openExternal(safeUrl);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function handleAuthCallbackUrl(url: string) {
  if (!isAuthCallbackUrl(url)) {
    return;
  }
  authCallbackState.setPending(url);
  if (!mainWindow) {
    return;
  }
  sendAuthCallbackToRenderer(url);
}

function sendAuthCallbackToRenderer(url: string) {
  if (!mainWindow) {
    authCallbackState.setPending(url);
    return;
  }
  mainWindow.webContents.send('marknote:auth-callback', url);
}

function requireTrustedSender(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || !isTrustedIpcSender({
    webContentsId: event.sender.id,
    expectedWebContentsId: mainWindow.webContents.id,
    frameId: event.senderFrame?.frameTreeNodeId ?? null,
    mainFrameId: mainWindow.webContents.mainFrame.frameTreeNodeId,
    frameUrl: event.senderFrame?.url || '',
  }, rendererUrl)) {
    throw new Error('Untrusted IPC sender.');
  }
}

async function openAllowedExternal(value: unknown) {
  const url = safeExternalUrl(value);
  if (!url) return;
  try {
    await shell.openExternal(url);
  } catch {
    // A rejected/missing OS handler must not become an unhandled rejection.
    console.warn('Unable to open external link.');
  }
}
