import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('marknoteDesktop', {
  platform: process.platform,
});
