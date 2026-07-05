import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('marknoteDesktop', {
  platform: process.platform,
  getAuthCallback() {
    return ipcRenderer.invoke('marknote:get-auth-callback') as Promise<string | null>;
  },
  clearAuthCallback(url: string) {
    return ipcRenderer.invoke('marknote:clear-auth-callback', url) as Promise<void>;
  },
  onAuthCallback(callback: (url: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on('marknote:auth-callback', listener);
    return () => {
      ipcRenderer.removeListener('marknote:auth-callback', listener);
    };
  },
  openExternal(url: string) {
    return ipcRenderer.invoke('marknote:open-external', url) as Promise<void>;
  },
});
