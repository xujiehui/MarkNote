import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('marknoteDesktop', {
  platform: process.platform,
  getAuthCallback() {
    return ipcRenderer.invoke('marknote:get-auth-callback') as Promise<string | null>;
  },
  clearAuthCallback(url: string) {
    if (typeof url !== 'string') return Promise.reject(new TypeError('Invalid callback URL.'));
    return ipcRenderer.invoke('marknote:clear-auth-callback', url) as Promise<void>;
  },
  onAuthCallback(callback: (url: string) => void) {
    if (typeof callback !== 'function') throw new TypeError('An auth callback listener is required.');
    const listener = (_event: Electron.IpcRendererEvent, url: string) => {
      if (typeof url === 'string') callback(url);
    };
    ipcRenderer.on('marknote:auth-callback', listener);
    return () => {
      ipcRenderer.removeListener('marknote:auth-callback', listener);
    };
  },
  openExternal(url: string) {
    if (typeof url !== 'string') return Promise.reject(new TypeError('Invalid external URL.'));
    return ipcRenderer.invoke('marknote:open-external', url) as Promise<void>;
  },
});
