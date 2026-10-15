import { afterEach, describe, expect, it, vi } from "vitest";
import { bookChunks } from "./book";
import {
  listSavedBooks,
  loadReadingState,
  renameTextBook,
  saveBook,
  savePosition,
  saveTextBook,
} from "./book-store";
import {
  createTextDocument,
  importTextFile,
  MAX_TEXT_BYTES,
  textTitle,
} from "./text-document";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function file(bytes: Uint8Array): File {
  return Object.assign(new File([bytes], "synthetic.txt"), {
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

describe("local plain-text documents", () => {
  it("preserves raw newlines and Unicode while sharing canonical reading coordinates", () => {
    const raw = "\uFEFF\n合成😀タイトル\r\nか\u3099\t本文";
    const a = createTextDocument(raw);
    const b = createTextDocument(raw);
    expect(a.documentId).not.toBe(b.documentId);
    expect(a.title).toBe("合成😀タイトル");
    expect(a.plainText).toBe(raw.slice(1));
    expect(
      bookChunks(a, 5)
        .map((chunk) => chunk.text)
        .join("")
    ).toBe("合成😀タイトル か\u3099 本文");
    expect(textTitle(" 😀 ")).toBe("😀");
    expect(Array.from(createTextDocument("😀".repeat(61)).title)).toHaveLength(
      60
    );
  });

  it.each([
    "",
    " \n\t",
    `a${String.fromCharCode(0)}b`,
    "a".repeat(MAX_TEXT_BYTES + 1),
    "あ".repeat(350_000),
  ])("rejects empty, binary, or oversized input (%#)", (value) => {
    expect(() => createTextDocument(value)).toThrow();
  });

  it("accepts valid UTF-8 and the exact byte limit, rejects unreadable bytes and read failures", async () => {
    expect(
      (
        await importTextFile(
          file(new TextEncoder().encode("\uFEFF合成😀\n本文"))
        )
      ).plainText
    ).toBe("合成😀\n本文");
    expect(
      createTextDocument("a".repeat(MAX_TEXT_BYTES)).plainText?.length
    ).toBe(MAX_TEXT_BYTES);
    await expect(
      importTextFile(file(new Uint8Array([0xff, 0xfe, 0x61])))
    ).rejects.toThrow("UTF-8");
    await expect(
      importTextFile(file(new Uint8Array(MAX_TEXT_BYTES + 1)))
    ).rejects.toThrow("1MiB");
    await expect(
      importTextFile(
        Object.assign(new File([], "x.txt"), {
          arrayBuffer: async () => {
            throw new Error("read failed");
          },
        })
      )
    ).rejects.toThrow("読み込めません");
  });

  it("stores independent inputs and renames without changing their identity, body, position or completion", async () => {
    const a = await saveTextBook(createTextDocument("同じ合成本文😀"));
    const b = await saveTextBook(createTextDocument("同じ合成本文😀"));
    savePosition(a, 8, true);
    savePosition(b, 2);
    const state = loadReadingState(a);
    const renamed = await renameTextBook(a.documentId, "新しい名前");
    expect(renamed).toEqual({ ...a, title: "新しい名前" });
    expect(loadReadingState(renamed)).toEqual(state);
    expect(loadReadingState(b)).toMatchObject({ offset: 2, completed: false });
    expect((await listSavedBooks()).books).toHaveLength(2);
    expect((await saveTextBook(a)).title).toBe("新しい名前");
    await expect(renameTextBook(a.documentId, " \n ")).rejects.toThrow(
      "タイトル"
    );
    await expect(renameTextBook(a.documentId, "x".repeat(61))).rejects.toThrow(
      "60文字"
    );
    await expect(renameTextBook("missing", "名前")).rejects.toThrow();
    expect((await listSavedBooks()).books).toHaveLength(2);
  });

  it("refuses a colliding identity and rolls back the transaction without overwriting the original", async () => {
    const a = await saveTextBook(createTextDocument("合成の元本文"));
    const b = createTextDocument("別の本文");
    await expect(
      saveTextBook({ ...b, documentId: a.documentId, revisionId: a.revisionId })
    ).rejects.toThrow("上書きしません");
    expect((await listSavedBooks()).books).toEqual([a]);
  });

  it("isolates corrupt records without deleting them or hiding healthy EPUB/text records", async () => {
    const a = await saveTextBook(createTextDocument("正常な合成本文"));
    const corrupt = { ...a, documentId: "text:broken", blocks: [null] };
    await saveBook(corrupt as unknown as typeof a);
    const epub = { ...a, documentId: "epub:ok", sourceKind: "epub" as const };
    await saveBook(epub);
    expect(await listSavedBooks()).toEqual({ books: [epub, a], unreadable: 1 });
    // Direct DB read verifies the invalid record has not been removed.
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open("flash-text-books", 2);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction("books").objectStore("books").getAll();
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
        read.onerror = () => reject(read.error);
      };
    });
    expect(records).toHaveLength(3);
  });
});
