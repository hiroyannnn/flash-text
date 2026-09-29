import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { importEpub, readingText } from "./book";

async function fixture(encrypted = false): Promise<File> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  if (encrypted) zip.file("META-INF/encryption.xml", "<encryption/>");
  zip.file("OPS/book.opf", `<package><metadata><title>試験の本</title></metadata><manifest>
    <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
    <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`);
  zip.file("OPS/a.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>後の章です。</p></body></html>');
  zip.file("OPS/b.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>見出し</h1><p>先の章です。</p><script>evil()</script></body></html>');
  const bytes = await zip.generateAsync({ type: "uint8array" });
  // jsdom's File lacks arrayBuffer; browsers supply it.
  return {
    name: "fixture.epub", size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as File;
}

describe("EPUB import", () => {
  it("uses spine reading order and extracts only plain text", async () => {
    const book = await importEpub(await fixture());
    expect(book.title).toBe("試験の本");
    expect(book.blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(readingText(book)).toBe("見出し 先の章です。 後の章です。");
    expect(readingText(book)).not.toContain("evil");
    expect(book.blocks[0].sourceSpans[0].unitId).toBe(book.units[0].id);
  });

  it("rejects encrypted EPUB", async () => {
    await expect(importEpub(await fixture(true))).rejects.toThrow("暗号化");
  });
});
