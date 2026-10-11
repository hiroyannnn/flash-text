import "@testing-library/jest-dom";
import { beforeEach } from "vitest";

// jsdom has no IndexedDB, and this copy must not add fake-indexeddb, so tests use
// the small subset that lib/book-store.ts calls. Mocking book-store instead would
// skip the storage boundary the reader depends on after a reload.
// Events run on microtasks, not setTimeout, so reading tests can fake timers.
type FakeStore = { keyPath?: string; records: Map<string, unknown> };
type FakeDatabaseEntry = { version: number; stores: Map<string, FakeStore> };

const databases = new Map<string, FakeDatabaseEntry>();

function domError(name: string): DOMException {
  return new DOMException(name, name);
}

function cloneValue(value: unknown): unknown {
  // jsdom Blob is not structured-cloneable in Node; source images are kept by reference.
  return value instanceof Blob ? value : structuredClone(value);
}

class FakeRequest<T> {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(private transaction: FakeTransaction, private store: FakeStore) {}

  put(value: unknown, key?: IDBValidKey): FakeRequest<IDBValidKey> {
    if (this.transaction.mode === "readonly") throw domError("ReadOnlyError");
    const keyPath = this.store.keyPath;
    const resolvedKey = keyPath && typeof value === "object" && value !== null
      ? Reflect.get(value, keyPath)
      : key;
    if (resolvedKey === undefined) throw domError("DataError");
    const stored = cloneValue(value);
    return this.transaction.enqueue(() => {
      this.store.records.set(String(resolvedKey), stored);
      return resolvedKey;
    });
  }

  get(key: IDBValidKey): FakeRequest<unknown> {
    return this.transaction.enqueue(() => {
      const value = this.store.records.get(String(key));
      return value === undefined ? undefined : cloneValue(value);
    });
  }

  getAll(): FakeRequest<unknown[]> {
    return this.transaction.enqueue(() => Array.from(this.store.records.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, value]) => cloneValue(value)));
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private operations: (() => void)[] = [];

  constructor(private stores: Map<string, FakeStore>, private names: string[], readonly mode: IDBTransactionMode) {
    void Promise.resolve().then(() => this.run());
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.stores.get(name);
    if (!store || !this.names.includes(name)) throw domError("NotFoundError");
    return new FakeObjectStore(this, store);
  }

  enqueue<T>(operation: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.operations.push(() => {
      request.result = operation();
      request.onsuccess?.();
    });
    return request;
  }

  private run(): void {
    const snapshot = new Map(Array.from(this.stores, ([name, store]) => [name, new Map(store.records)]));
    try {
      while (this.operations.length) this.operations.shift()?.();
    } catch (error) {
      for (const [name, records] of snapshot) {
        const store = this.stores.get(name);
        if (store) store.records = records;
      }
      this.error = error instanceof DOMException ? error : domError("AbortError");
      this.onerror?.();
      this.onabort?.();
      return;
    }
    this.oncomplete?.();
  }
}

class FakeDatabase {
  private closed = false;

  constructor(private stores: Map<string, FakeStore>) {}

  get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name: string, options?: { keyPath?: string }): void {
    this.stores.set(name, { keyPath: options?.keyPath, records: new Map() });
  }

  transaction(names: string | string[], mode: IDBTransactionMode = "readonly"): FakeTransaction {
    if (this.closed) throw domError("InvalidStateError");
    return new FakeTransaction(this.stores, Array.isArray(names) ? names : [names], mode);
  }

  close(): void {
    this.closed = true;
  }
}

const fakeIndexedDB = {
  open(name: string, version = 1): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    void Promise.resolve().then(() => {
      const existing = databases.get(name);
      if (existing && version < existing.version) {
        request.error = domError("VersionError");
        request.onerror?.();
        return;
      }
      const entry = existing ?? { version: 0, stores: new Map<string, FakeStore>() };
      databases.set(name, entry);
      request.result = new FakeDatabase(entry.stores);
      if (version > entry.version) {
        entry.version = version;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  },
};

if (!("indexedDB" in globalThis)) {
  Object.defineProperty(globalThis, "indexedDB", { value: fakeIndexedDB, configurable: true });
}

beforeEach(() => databases.clear());
