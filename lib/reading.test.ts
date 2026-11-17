import { describe, expect, it } from "vitest";
import { chunkIndexAt, displayDurationMs, splitIntoChunks } from "./reading";

describe("flash reading positions and timing", () => {
  it("uses actual displayed graphemes for CPM", () => {
    expect(displayDurationMs("あいうえおかきくけこ", 600)).toBe(1000);
    expect(displayDurationMs("👨‍👩‍👧‍👦", 60)).toBe(1000);
  });

  it("keeps the source offset when display length changes", () => {
    const text = "あいうえおかきくけこ";
    const oldChunks = splitIntoChunks(text, 5);
    const newChunks = splitIntoChunks(text, 3, oldChunks[1].start);
    expect(newChunks[chunkIndexAt(newChunks, oldChunks[1].start)].text).toBe(
      "かきく"
    );
    expect(newChunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("does not split a surrogate pair", () => {
    expect(splitIntoChunks("あ😀い", 2).map((chunk) => chunk.text)).toEqual([
      "あ😀",
      "い",
    ]);
  });

  it("keeps joined emoji and combining marks together at a chunk boundary", () => {
    const chunks = splitIntoChunks("あ👨‍👩‍👧‍👦e\u0301い", 1, 2);
    expect(chunks.map(({ text }) => text)).toEqual([
      "あ",
      "👨‍👩‍👧‍👦",
      "e\u0301",
      "い",
    ]);
    expect(chunks.map(({ start }) => start)).toEqual([0, 1, 8, 10]);
  });
});
