export interface WorkspaceSnapshot {
  id: string;
  kind: 'guest' | 'account';
  databaseName: string;
  userId: string | null;
  provider: string | null;
  epoch: number;
}

const listeners = new Set<() => void>();
let workspace: WorkspaceSnapshot = workspaceForAccount(null, 'supabase', 0);
let workspaceEpoch = 0;

export function workspaceForAccount(userId: string | null, provider = 'supabase', epoch = workspace?.epoch ?? 0): WorkspaceSnapshot {
  if (userId === null) {
    return { id: 'guest', kind: 'guest', databaseName: 'marknote', userId: null, provider: null, epoch };
  }
  if (!userId.trim() || !provider.trim()) {
    throw new Error('Account workspace requires a nonempty user ID and provider.');
  }
  // Encoding each component separately prevents IDs containing separators from sharing a database.
  const id = `account:${encodeURIComponent(provider)}:${encodeURIComponent(userId)}`;
  return { id, kind: 'account', databaseName: `marknote-${id}`, userId, provider, epoch };
}

export function getWorkspaceSnapshot(): WorkspaceSnapshot {
  return workspace;
}

export function getWorkspaceEpoch(): number {
  return workspaceEpoch;
}

export function isWorkspaceCurrent(epoch: number): boolean {
  return workspaceEpoch === epoch;
}

/** Invalidate in-flight network work before asynchronous draft flushing starts. */
export function invalidateWorkspaceEpoch(): number {
  return ++workspaceEpoch;
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called only after the target database is open and old drafts have been persisted. */
export function publishWorkspace(snapshot: WorkspaceSnapshot): void {
  workspace = snapshot;
  workspaceEpoch = snapshot.epoch;
  for (const listener of listeners) {
    listener();
  }
}

export function workspaceStorageKey(key: string, snapshot = workspace): string {
  // Legacy UI data stays accessible to the guest, never copied into authenticated spaces.
  return snapshot.kind === 'guest' ? key : `${key}:${snapshot.id}`;
}
