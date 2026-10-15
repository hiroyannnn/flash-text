import { describe, expect, it } from "vitest";
import { chunkIndexAt, displayDurationMs, readingProgress, splitIntoChunks } from "./reading";

describe("flash reading positions and timing", () => {
  it("never displays 100 percent before confirmed completion", () => {
    expect(readingProgress(5, 6, false)).toBe(83);
    expect(readingProgress(6, 6, false)).toBe(99);
    expect(readingProgress(0, 2, false)).toBe(0);
    expect(readingProgress(2, 2, true)).toBe(100);
  });

  it("uses actual displayed graphemes for CPM", () => {
    expect(displayDurationMs("あいうえおかきくけこ", 600)).toBe(1000);
    expect(displayDurationMs("👨‍👩‍👧‍👦", 60)).toBe(1000);
  });

  it("keeps the source offset when display length changes", () => {
    const text = "あいうえおかきくけこ";
    const oldChunks = splitIntoChunks(text, 5);
    const newChunks = splitIntoChunks(text, 3, oldChunks[1].start);
    expect(newChunks[chunkIndexAt(newChunks, oldChunks[1].start)].text).toBe("かきく");
    expect(newChunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("does not split a surrogate pair", () => {
    expect(splitIntoChunks("あ😀い", 2).map((chunk) => chunk.text)).toEqual(["あ😀", "い"]);
  });
});
