import { blockText, type BookDocument } from "./book";

const DB_NAME = "flash-text-books";
const STORE_NAME = "books";
const IMAGE_STORE = "images";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
        request.result.createObjectStore(IMAGE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const action = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      action.onsuccess = () => { result = action.result; };
      action.onerror = () => reject(action.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    db.close();
  }
}

export function saveBook(book: BookDocument): Promise<IDBValidKey> {
  return request("readwrite", (store) => store.put(book));
}

export async function saveFlashbook(book: BookDocument, images: { unitId: string; blob: Blob }[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, IMAGE_STORE], "readwrite");
      transaction.objectStore(STORE_NAME).put(book);
      for (const image of images) {
        transaction.objectStore(IMAGE_STORE).put(image.blob, `${book.documentId}:${image.unitId}`);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function getSourceImage(book: BookDocument, unitId: string): Promise<Blob | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE, "readonly");
      const action = transaction.objectStore(IMAGE_STORE).get(`${book.documentId}:${unitId}`);
      action.onsuccess = () => resolve(action.result as Blob | undefined);
      action.onerror = () => reject(action.error);
    });
  } finally {
    db.close();
  }
}

export function listBooks(): Promise<BookDocument[]> {
  return request("readonly", (store) => store.getAll());
}

export function savePosition(book: BookDocument, offset: number): void {
  let remaining = offset;
  let block = book.blocks[0];
  for (const candidate of book.blocks) {
    block = candidate;
    const length = Array.from(blockText(candidate)).length;
    if (remaining <= length) break;
    remaining -= length + 1;
  }
  localStorage.setItem(`flash-position:${book.documentId}`, JSON.stringify({
    revisionId: book.revisionId, blockId: block.id,
    offsetCp: Math.max(0, remaining), updatedAt: new Date().toISOString(),
  }));
}

export function loadPosition(book: BookDocument): number {
  try {
    const saved = JSON.parse(localStorage.getItem(`flash-position:${book.documentId}`) ?? "null");
    if (saved?.revisionId !== book.revisionId || !Number.isInteger(saved.offsetCp) || saved.offsetCp < 0) return 0;
    let offset = 0;
    for (const block of book.blocks) {
      if (block.id === saved.blockId) {
        return offset + Math.min(saved.offsetCp, Array.from(blockText(block)).length);
      }
      offset += Array.from(blockText(block)).length + 1;
    }
    return 0;
  } catch {
    return 0;
  }
}
