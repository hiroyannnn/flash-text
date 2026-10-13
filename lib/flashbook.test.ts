import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bookChunks } from "./book";
import { importFlashbook } from "./flashbook";

async function fixture(): Promise<File> {
  const zip = new JSZip();
  const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const digest = await crypto.subtle.digest("SHA-256", image);
  const sha = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  zip.file("assets/pages/000001.png", image);
  zip.file("book.json", JSON.stringify({
    schemaVersion: 1, documentId: sha, revisionId: sha, title: "試験", language: "ja",
    sourceKind: "kindle-capture", coverage: "partial",
    units: [{ id: "u1", ordinal: 1, imagePath: "assets/pages/000001.png",
      imageSha256: sha, widthPx: 100, heightPx: 200 }],
    blocks: [
      { id: "b1", kind: "paragraph", canonicalText: "あいうえお", quality: "unreviewed",
        sourceSpans: [{ unitId: "u1", startCp: 0, endCp: 5 }] },
      { id: "b2", kind: "review", reason: "table", sourceUnitIds: ["u1"] },
      { id: "b3", kind: "paragraph", canonicalText: "続きです", quality: "unreviewed",
        sourceSpans: [{ unitId: "u1", startCp: 0, endCp: 4 }] },
    ],
  }));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { name: "test.flashbook.zip", size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File;
}

describe("flashbook import", () => {
  it("checks image integrity and stops at review blocks", async () => {
    const { book, images } = await importFlashbook(await fixture());
    expect(images).toHaveLength(1);
    const chunks = bookChunks(book, 3);
    expect(chunks.map((chunk) => chunk.review ?? false)).toEqual([false, false, true, false, false]);
    expect(chunks[2].blockId).toBe("b2");
  });
});
