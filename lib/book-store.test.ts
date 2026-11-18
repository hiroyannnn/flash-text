import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookDocument } from "./book";
import { loadPosition, savePosition } from "./book-store";

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

afterEach(() => window.localStorage.clear());

describe("reading position", () => {
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
