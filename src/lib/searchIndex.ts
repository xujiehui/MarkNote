export interface SearchRecord {
  readonly id: string;
  readonly text: string;
  readonly version?: string | number;
}

export type SearchWorkerRequest =
  | { type: 'sync'; generation: number; upserts: SearchRecord[]; removed: string[] }
  | { type: 'query'; generation: number; sequence: number; query: string };

export interface SearchWorkerReply {
  type: 'result';
  generation: number;
  sequence: number;
  ids: string[];
}

export interface SearchWorkerPort {
  postMessage(message: SearchWorkerRequest): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void;
  terminate(): void;
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** A plain substring index: preserve Chinese, accents and partial-word matches. */
export class SearchIndex {
  private records = new Map<string, string>();
  private currentGeneration = 0;

  get generation(): number { return this.currentGeneration; }
  get size(): number { return this.records.size; }

  applySync(message: Extract<SearchWorkerRequest, { type: 'sync' }>): boolean {
    if (message.generation < this.currentGeneration) return false;
    for (const id of message.removed) this.records.delete(id);
    for (const record of message.upserts) this.records.set(record.id, record.text.toLowerCase());
    this.currentGeneration = message.generation;
    return true;
  }

  search(query: string): Set<string> {
    const normalized = normalizeSearchQuery(query);
    const matches = new Set<string>();
    for (const [id, text] of this.records) if (!normalized || text.includes(normalized)) matches.add(id);
    return matches;
  }

  async searchAsync(query: string, options: {
    shouldContinue?: () => boolean;
    yieldControl?: () => Promise<void>;
    batchSize?: number;
  } = {}): Promise<Set<string> | null> {
    const normalized = normalizeSearchQuery(query);
    const generation = this.currentGeneration;
    const matches = new Set<string>();
    const canContinue = () => generation === this.currentGeneration && (options.shouldContinue?.() ?? true);
    const yieldControl = options.yieldControl || (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const batchSize = Math.max(1, options.batchSize || 500);
    let scanned = 0;
    if (!canContinue()) return null;
    for (const [id, text] of this.records) {
      if (!normalized || text.includes(normalized)) matches.add(id);
      scanned += 1;
      if (scanned % batchSize === 0) {
        await yieldControl();
        if (!canContinue()) return null;
      }
    }
    return canContinue() ? matches : null;
  }
}

export interface IndexedSearchState {
  records: readonly SearchRecord[];
  query: string;
  matches: Set<string> | null;
  pending: boolean;
}

/** Owns indexing and correlation independently of React and browser globals. */
export class SearchController {
  private records = new Map<string, SearchRecord>();
  private input: readonly SearchRecord[] = [];
  private generation = 0;
  private sequence = 0;
  private query = '';
  private index: SearchIndex | null = null;
  private disposed = false;
  private onMessage: EventListener;
  private onError: EventListener;

  constructor(private worker: SearchWorkerPort | null, private publish: (state: IndexedSearchState) => void) {
    this.onMessage = (event) => {
      const reply = (event as MessageEvent<SearchWorkerReply>).data;
      if (this.disposed || reply?.type !== 'result' || reply.generation !== this.generation || reply.sequence !== this.sequence) return;
      if (!Array.isArray(reply.ids) || !reply.ids.every((id) => typeof id === 'string')) { this.useFallback(); return; }
      this.publish({ records: this.input, query: this.query, matches: new Set(reply.ids), pending: false });
    };
    this.onError = (event) => { event.preventDefault(); this.useFallback(); };
    if (worker) {
      worker.addEventListener('message', this.onMessage);
      worker.addEventListener('error', this.onError);
      worker.addEventListener('messageerror', this.onError);
    } else this.index = new SearchIndex();
  }

  update(input: readonly SearchRecord[], query: string): void {
    if (this.disposed) return;
    const changedInput = input !== this.input;
    this.input = input;
    this.query = normalizeSearchQuery(query);
    this.sequence += 1;
    if (changedInput) {
      const next = new Map(input.map((record) => [record.id, { ...record }]));
      const removed = [...this.records.keys()].filter((id) => !next.has(id));
      const upserts = [...next.values()].filter((record) => {
        const previous = this.records.get(record.id);
        return !previous || previous.text !== record.text || previous.version !== record.version;
      });
      this.records = next;
      if (upserts.length || removed.length) {
        this.generation += 1;
        const update: SearchWorkerRequest = { type: 'sync', generation: this.generation, upserts, removed };
        if (this.worker) {
          try { this.worker.postMessage(update); }
          catch { this.useFallback(); return; }
        } else this.index!.applySync(update);
      }
    }
    if (!this.query) { this.publish({ records: input, query: '', matches: null, pending: false }); return; }
    if (!this.worker) { this.publishFallback(); return; }
    this.publish({ records: input, query: this.query, matches: null, pending: true });
    try { this.worker.postMessage({ type: 'query', generation: this.generation, sequence: this.sequence, query: this.query }); }
    catch { this.useFallback(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseWorker();
    this.records.clear();
    this.input = [];
    this.index = null;
  }

  private releaseWorker(): void {
    this.worker?.removeEventListener('message', this.onMessage);
    this.worker?.removeEventListener('error', this.onError);
    this.worker?.removeEventListener('messageerror', this.onError);
    this.worker?.terminate();
    this.worker = null;
  }

  private useFallback(): void {
    if (this.disposed) return;
    this.releaseWorker();
    this.index = new SearchIndex();
    this.index.applySync({ type: 'sync', generation: this.generation, upserts: [...this.records.values()], removed: [] });
    this.publishFallback();
  }

  private publishFallback(): void {
    this.publish({ records: this.input, query: this.query, matches: this.query ? this.index!.search(this.query) : null, pending: false });
  }
}

let workerFactory: (() => SearchWorkerPort) | null = null;

/** Configure in the Vite bootstrap, where import.meta URLs are supported. */
export function configureSearchWorker(factory: (() => SearchWorkerPort) | null): void {
  workerFactory = factory;
}

export function createSearchController(publish: (state: IndexedSearchState) => void): SearchController {
  let worker: SearchWorkerPort | null = null;
  try { worker = workerFactory?.() || null; }
  catch { /* Unsupported Worker or blocked worker URL: keep search usable. */ }
  return new SearchController(worker, publish);
}
