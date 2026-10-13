export interface OfflineState {
  offlineReady: boolean;
  updateAvailable: boolean;
  error: boolean;
}

let state: OfflineState = { offlineReady: false, updateAvailable: false, error: false };
const listeners = new Set<(state: OfflineState) => void>();
let registration: ServiceWorkerRegistration | null = null;
let reloadAfterActivation = false;
let reloadAvailable = false;
let started = false;
let readinessCheck = 0;
let activation: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;

export function getOfflineState(): OfflineState {
  return state;
}

export function subscribeOfflineState(listener: (state: OfflineState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(patch: Partial<OfflineState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

async function checkOfflineReadiness(worker: ServiceWorker | null): Promise<void> {
  const check = ++readinessCheck;
  if (!worker) { publish({ offlineReady: false }); return; }
  const ready = await new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (value: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 1500);
    channel.port1.onmessage = (event: MessageEvent) => finish(event.data?.type === 'MARKNOTE_OFFLINE_STATUS' && event.data.ready === true);
    try { worker.postMessage({ type: 'MARKNOTE_OFFLINE_STATUS' }, [channel.port2]); }
    catch { finish(false); }
  });
  if (check === readinessCheck) publish({ offlineReady: ready });
}

export async function registerOfflineWorker(baseUrl: string): Promise<void> {
  if (started || !('serviceWorker' in navigator) || !['https:', 'http:'].includes(window.location.protocol)) return;
  started = true;
  const container = navigator.serviceWorker;
  let hadController = Boolean(container.controller);
  container.addEventListener('controllerchange', () => {
    void checkOfflineReadiness(container.controller);
    if (reloadAfterActivation) {
      if (activation) { clearTimeout(activation.timer); activation.resolve(); activation = null; }
      window.location.reload();
    } else if (hadController) {
      // A different tab accepted the update. This tab retains its draft and
      // offers its own save-and-reload action instead of reloading silently.
      reloadAvailable = true;
      publish({ updateAvailable: true });
    }
    hadController = true;
  });
  try {
    registration = await container.register(`${baseUrl}sw.js`, { scope: baseUrl, updateViaCache: 'none' });
    const refresh = async () => {
      publish({ updateAvailable: Boolean(registration?.waiting) || reloadAvailable, error: false });
      await checkOfflineReadiness(registration?.active || null);
    };
    const initiallyActive = Boolean(registration.active);
    const initialReadiness = refresh();
    const observeInstallingWorker = () => {
      const installing = registration?.installing;
      installing?.addEventListener('statechange', () => {
        void refresh();
        if (installing.state === 'redundant' && !registration?.active) publish({ error: true });
      });
    };
    registration.addEventListener('updatefound', observeInstallingWorker);
    // If registration returned during the first installation, its transition
    // predates updatefound subscription. Observe that worker as well.
    observeInstallingWorker();
    if (!initiallyActive) void container.ready.then((ready) => checkOfflineReadiness(ready.active));
    await initialReadiness;
  } catch {
    publish({ error: true });
  }
}

/** Call only after the user's explicit update action has committed all drafts. */
export async function activateOfflineUpdate(): Promise<void> {
  if (reloadAvailable) {
    window.location.reload();
    return;
  }
  const waiting = registration?.waiting;
  if (!waiting) throw new Error('The update is no longer available. Try again after reconnecting.');
  if (activation) throw new Error('An update is already in progress.');
  reloadAfterActivation = true;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      activation = null;
      reloadAfterActivation = false;
      reject(new Error('The update did not activate. Your editor remains open; please retry.'));
    }, 10_000);
    activation = { resolve, reject, timer };
    try { waiting.postMessage({ type: 'MARKNOTE_ACTIVATE_UPDATE' }); }
    catch {
      clearTimeout(timer);
      activation = null;
      reloadAfterActivation = false;
      reject(new Error('The update could not be activated.'));
    }
  });
}
