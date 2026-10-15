import { blockText, type BookDocument } from "./book";
import { textTitle, validTextDocument } from "./text-document";

const DB_NAME = "flash-text-books";
const STORE_NAME = "books";
const IMAGE_STORE = "images";

export type ReadingState = {
  offset: number;
  completed: boolean;
  updatedAt: string | null;
  resetReason: "revision" | "invalid" | null;
};

export function bookLength(book: BookDocument): number {
  let offset = 0;
  let end = 0;
  for (const block of book.blocks) {
    const text = blockText(block);
    const displayedLength = Array.from(text.replace(/\s+/g, " ").trim()).length;
    if (displayedLength) end = offset + displayedLength;
    // Preserve the legacy block coordinates, including gaps that are not displayed.
    offset += Array.from(text).length + 1;
  }
  return end;
}

function emptyReadingState(resetReason: ReadingState["resetReason"] = null): ReadingState {
  return { offset: 0, completed: false, updatedAt: null, resetReason };
}

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
      transaction.onabort = () => reject(transaction.error ?? new Error("保存処理が中断されました"));
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

function readableBook(value: unknown): value is BookDocument {
  if (!value || typeof value !== "object") return false;
  const book = value as BookDocument;
  if (book.sourceKind === "text") return validTextDocument(book);
  return book.schemaVersion === 1 && ["epub", "kindle-capture"].includes(book.sourceKind) &&
    typeof book.documentId === "string" && !!book.documentId && typeof book.revisionId === "string" && !!book.revisionId &&
    typeof book.title === "string" && !!book.title && Array.isArray(book.units) &&
    Array.isArray(book.blocks) && book.blocks.length > 0 && book.blocks.every((block) =>
      block && typeof block.id === "string" && (block.kind === "review"
        ? Array.isArray(block.sourceUnitIds)
        : ["paragraph", "heading"].includes(block.kind) && typeof block.canonicalText === "string" && Array.isArray(block.sourceSpans)));
}

export async function listSavedBooks(): Promise<{ books: BookDocument[]; unreadable: number }> {
  const records = await request<unknown[]>("readonly", (store) => store.getAll());
  const books = records.filter(readableBook);
  return { books, unreadable: records.length - books.length };
}

export async function listBooks(): Promise<BookDocument[]> {
  return (await listSavedBooks()).books;
}

async function changeTextBook(id: string, change: (stored: unknown) => BookDocument): Promise<BookDocument> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const lookup = store.get(id);
      let result: BookDocument | undefined;
      let failure: unknown;
      lookup.onsuccess = () => {
        try {
          result = change(lookup.result);
          if (lookup.result === undefined) store.add(result);
          else if (result !== lookup.result) store.put(result);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => result ? resolve(result) : reject(new Error("本文を確認できませんでした"));
      transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("保存処理が中断されました"));
    });
  } finally { db.close(); }
}

export async function saveTextBook(book: BookDocument): Promise<BookDocument> {
  if (!validTextDocument(book)) throw new Error("テキストの保存データを確認できません");
  return changeTextBook(book.documentId, (stored) => {
    if (stored === undefined) return book;
    if (validTextDocument(stored) && stored.revisionId === book.revisionId && stored.plainText === book.plainText) return stored;
    throw new Error("別の保存済み文書は上書きしません");
  });
}

export async function renameTextBook(id: string, title: string): Promise<BookDocument> {
  const nextTitle = textTitle(title);
  return changeTextBook(id, (stored) => {
    if (!validTextDocument(stored)) throw new Error("保存済みの本文を確認できません");
    return stored.title === nextTitle ? stored : { ...stored, title: nextTitle };
  });
}

export function savePosition(book: BookDocument, offset: number, completed = false): ReadingState {
  if (!Number.isInteger(offset) || offset < 0 || !book.blocks.length) throw new RangeError("Invalid reading position");
  let remaining = offset;
  let block = book.blocks[0];
  for (const candidate of book.blocks) {
    block = candidate;
    const length = Array.from(blockText(candidate)).length;
    if (remaining <= length) break;
    remaining -= length + 1;
  }
  if (remaining > Array.from(blockText(block)).length) throw new RangeError("Invalid reading position");
  const isCompleted = completed && offset === bookLength(book);
  const updatedAt = new Date().toISOString();
  localStorage.setItem(`flash-position:${book.documentId}`, JSON.stringify({
    revisionId: book.revisionId, blockId: block.id,
    offsetCp: Math.max(0, remaining), completed: isCompleted, updatedAt,
  }));
  return { offset, completed: isCompleted, updatedAt, resetReason: null };
}

export function loadReadingState(book: BookDocument): ReadingState {
  // Storage access failures must reach the UI so it cannot overwrite an unread bookmark.
  const raw = localStorage.getItem(`flash-position:${book.documentId}`);
  if (raw === null) return emptyReadingState();
  try {
    const saved = JSON.parse(raw);
    if (saved?.revisionId !== book.revisionId) {
      return emptyReadingState(typeof saved?.revisionId === "string" ? "revision" : "invalid");
    }
    if (!Number.isInteger(saved.offsetCp) || saved.offsetCp < 0) return emptyReadingState("invalid");
    let offset = 0;
    for (const block of book.blocks) {
      if (block.id === saved.blockId) {
        // Same revision means the same blocks, so an offset past this block is corrupt.
        // Clamping it would resume at the next block instead of the beginning.
        if (saved.offsetCp > Array.from(blockText(block)).length) return emptyReadingState("invalid");
        const position = offset + saved.offsetCp;
        return {
          offset: position,
          completed: saved.completed === true && position === bookLength(book),
          updatedAt: typeof saved.updatedAt === "string" && Number.isFinite(Date.parse(saved.updatedAt)) ? saved.updatedAt : null,
          resetReason: null,
        };
      }
      offset += Array.from(blockText(block)).length + 1;
    }
    return emptyReadingState("invalid");
  } catch {
    return emptyReadingState("invalid");
  }
}

/** Compatibility for callers that only need the legacy numeric position. */
export function loadPosition(book: BookDocument): number {
  return loadReadingState(book).offset;
}
