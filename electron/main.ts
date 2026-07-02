import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEEP_LINK_PROTOCOL = 'marknote';

let mainWindow: BrowserWindow | null = null;
let pendingAuthCallbackUrl: string | null = null;

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1672,
    height: 941,
    minWidth: 1280,
    minHeight: 760,
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
    },
  });

  window.once('ready-to-show', () => {
    window.show();
    if (pendingAuthCallbackUrl) {
      sendAuthCallbackToRenderer(pendingAuthCallbackUrl);
      pendingAuthCallbackUrl = null;
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    url.searchParams.set('app', '1');
    void window.loadURL(url.toString());
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

ipcMain.handle('marknote:open-external', async (_event, url: string) => {
  if (!url.startsWith('https://')) {
    throw new Error('Only HTTPS URLs can be opened externally.');
  }
  await shell.openExternal(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function handleAuthCallbackUrl(url: string) {
  if (!url.startsWith(`${DEEP_LINK_PROTOCOL}://auth/callback`)) {
    return;
  }
  if (!mainWindow) {
    pendingAuthCallbackUrl = url;
    return;
  }
  sendAuthCallbackToRenderer(url);
}

function sendAuthCallbackToRenderer(url: string) {
  if (!mainWindow) {
    pendingAuthCallbackUrl = url;
    return;
  }
  mainWindow.webContents.send('marknote:auth-callback', url);
}
