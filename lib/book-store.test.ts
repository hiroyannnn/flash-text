import { afterEach, describe, expect, it, vi } from "vitest";
import { type BookDocument, bookChunks } from "./book";
import {
  bookLength,
  loadPosition,
  loadReadingState,
  savePosition,
} from "./book-store";

const book: BookDocument = {
  schemaVersion: 1,
  documentId: "test-book",
  revisionId: "v1",
  title: "試験",
  language: "ja",
  sourceKind: "epub",
  coverage: "unknown",
  units: [],
  blocks: [
    {
      id: "b1",
      kind: "paragraph",
      canonicalText: "あいう",
      sourceSpans: [],
      quality: "unreviewed",
    },
    {
      id: "b2",
      kind: "paragraph",
      canonicalText: "えおか",
      sourceSpans: [],
      quality: "unreviewed",
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("reading position", () => {
  it("uses the actual displayed end while retaining legacy coordinates for whitespace", () => {
    const spaced: BookDocument = {
      ...book,
      blocks: [
        {
          id: "b1",
          kind: "paragraph",
          canonicalText: " あ  い ",
          sourceSpans: [],
          quality: "unreviewed",
        },
      ],
    };
    const end = bookChunks(spaced, 5).at(-1)?.end ?? 0;
    expect(bookLength(spaced)).toBe(end);
    savePosition(spaced, end, true);
    expect(loadReadingState(spaced).completed).toBe(true);
  });

  it("reads legacy bookmarks without inventing completion or dates", () => {
    localStorage.setItem(
      "flash-position:test-book",
      JSON.stringify({ revisionId: "v1", blockId: "b2", offsetCp: 1 })
    );
    expect(loadReadingState(book)).toEqual({
      offset: 5,
      completed: false,
      updatedAt: null,
      resetReason: null,
    });
  });

  it("persists completion at the end and explicitly resets it", () => {
    const saved = savePosition(book, bookLength(book), true);
    expect(saved).toMatchObject({
      offset: 7,
      completed: true,
      updatedAt: expect.any(String),
    });
    expect(loadReadingState(book)).toEqual(saved);
    savePosition(book, 0, false);
    expect(loadReadingState(book)).toMatchObject({
      offset: 0,
      completed: false,
    });
  });

  it("does not trust completion before the end", () => {
    savePosition(book, 5, true);
    expect(loadReadingState(book)).toMatchObject({
      offset: 5,
      completed: false,
    });
  });

  it("reports a changed revision and drops its completion and date", () => {
    savePosition(book, 7, true);
    expect(loadReadingState({ ...book, revisionId: "v2" })).toEqual({
      offset: 0,
      completed: false,
      updatedAt: null,
      resetReason: "revision",
    });
  });

  it("invalid metadata cannot manufacture completion or crash date display", () => {
    localStorage.setItem(
      "flash-position:test-book",
      JSON.stringify({
        revisionId: "v1",
        blockId: "b2",
        offsetCp: 1,
        completed: "true",
        updatedAt: "broken",
      })
    );
    expect(loadReadingState(book)).toMatchObject({
      offset: 5,
      completed: false,
      updatedAt: null,
    });
    localStorage.setItem("flash-position:test-book", "{broken");
    expect(loadReadingState(book)).toMatchObject({
      offset: 0,
      completed: false,
      resetReason: "invalid",
    });
  });

  it("failed completion writes leave the last saved bookmark intact", () => {
    savePosition(book, 5);
    const before = localStorage.getItem("flash-position:test-book");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => savePosition(book, 7, true)).toThrow("full");
    expect(localStorage.getItem("flash-position:test-book")).toBe(before);
  });

  it("rejects an invalid write without replacing a bookmark", () => {
    savePosition(book, 5);
    expect(() => savePosition(book, bookLength(book) + 1)).toThrow(RangeError);
    expect(() => savePosition(book, 999)).toThrow(RangeError);
    expect(loadPosition(book)).toBe(5);
  });

  it("restores the same code point in the second block", () => {
    savePosition(book, 5);
    expect(loadPosition(book)).toBe(5);
    expect(
      JSON.parse(
        window.localStorage.getItem("flash-position:test-book") ?? "null"
      )
    ).toMatchObject({
      revisionId: "v1",
      blockId: "b2",
      offsetCp: 1,
    });
  });

  it("does not restore a position into a changed revision", () => {
    savePosition(book, 5);
    expect(loadPosition({ ...book, revisionId: "v2" })).toBe(0);
  });

  it("does not treat a failed storage read as an empty bookmark", () => {
    savePosition(book, 5);
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new DOMException("Unavailable", "SecurityError");
      });
    try {
      expect(() => loadPosition(book)).toThrow(/Unavailable/);
      expect(loadPosition(book)).toBe(5);
    } finally {
      read.mockRestore();
    }
  });

  it("starts from the beginning when the saved offset is past its block", () => {
    window.localStorage.setItem(
      "flash-position:test-book",
      JSON.stringify({
        revisionId: "v1",
        blockId: "b1",
        offsetCp: 4,
      })
    );
    expect(loadPosition(book)).toBe(0);
  });

  it("keeps an offset at the end of its block", () => {
    window.localStorage.setItem(
      "flash-position:test-book",
      JSON.stringify({
        revisionId: "v1",
        blockId: "b2",
        offsetCp: 3,
      })
    );
    expect(loadPosition(book)).toBe(7);
  });
});
