import type { SyncDevice } from '../types';

const DEVICE_ID_KEY = 'marknote-sync-device-id';

export function getOrCreateDevice(provider: string): SyncDevice {
  const now = Date.now();
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }

  return {
    id,
    provider,
    name: deviceName(),
    createdAt: now,
    lastSeenAt: now,
  };
}

function deviceName(): string {
  const platform = navigator.platform || 'Unknown platform';
  const userAgent = navigator.userAgent.includes('Electron') ? 'Desktop' : 'Web';
  return `MarkNote ${userAgent} (${platform})`;
}
