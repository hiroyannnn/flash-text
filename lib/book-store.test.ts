import { afterEach, describe, expect, it } from "vitest";
import type { BookDocument } from "./book";
import { loadPosition, savePosition } from "./book-store";

const book: BookDocument = {
  schemaVersion: 1, documentId: "test-book", revisionId: "v1", title: "試験",
  language: "ja", sourceKind: "epub", coverage: "unknown", units: [],
  blocks: [
    { id: "b1", kind: "paragraph", canonicalText: "あいう", sourceSpans: [], quality: "unreviewed" },
    { id: "b2", kind: "paragraph", canonicalText: "えおか", sourceSpans: [], quality: "unreviewed" },
  ],
};

afterEach(() => localStorage.clear());

describe("reading position", () => {
  it("restores the same code point in the second block", () => {
    savePosition(book, 5); // 3 code points, a separator, then 1 code point.
    expect(loadPosition(book)).toBe(5);
    expect(JSON.parse(localStorage.getItem("flash-position:test-book") ?? "null")).toMatchObject({
      revisionId: "v1", blockId: "b2", offsetCp: 1,
    });
  });

  it("does not restore a position into a changed revision", () => {
    savePosition(book, 5);
    expect(loadPosition({ ...book, revisionId: "v2" })).toBe(0);
  });
});
