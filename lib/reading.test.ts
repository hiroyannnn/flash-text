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
    expect(newChunks[chunkIndexAt(newChunks, oldChunks[1].start)].text).toBe("かきく");
    expect(newChunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("does not split a surrogate pair", () => {
    expect(splitIntoChunks("あ😀い", 2).map((chunk) => chunk.text)).toEqual(["あ😀", "い"]);
  });
});
