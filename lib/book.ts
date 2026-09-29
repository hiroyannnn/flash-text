import JSZip from "jszip";

export type BookDocument = {
  schemaVersion: 1;
  documentId: string;
  revisionId: string;
  title: string;
  language: "ja";
  sourceKind: "epub";
  coverage: "full-user-confirmed" | "unknown";
  units: { id: string; ordinal: number; epubHref: string }[];
  blocks: {
    id: string;
    kind: "heading" | "paragraph";
    canonicalText: string;
    sourceSpans: { unitId: string; startCp: number; endCp: number }[];
    quality: "unreviewed";
  }[];
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_CHAPTER_CHARS = 500_000;
const MAX_BOOK_CHARS = 5_000_000;

async function readText(entry: JSZip.JSZipObject, limit: number): Promise<string> {
  // JSZip exposes the ZIP header's uncompressed size here. Check before inflating.
  const data = entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
  if ((data._data?.uncompressedSize ?? 0) > limit) throw new Error("EPUB内のファイルが大きすぎます");
  const text = await entry.async("text");
  if (text.length > limit) throw new Error("EPUB内のファイルが大きすぎます");
  return text;
}

function parseXml(source: string): Document {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("EPUBのXMLを解析できません");
  return document;
}

function childElements(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

function safePath(base: string, href: string): string {
  const path = decodeURIComponent(href.split("#")[0]);
  if (!path || path.startsWith("/") || path.includes("\\") || /^[a-z]+:/i.test(path)) {
    throw new Error("EPUB内に不正な参照があります");
  }
  const segments: string[] = [];
  for (const segment of `${base}${path}`.split("/")) {
    if (segment === "..") {
      if (!segments.length) throw new Error("EPUB内に不正な参照があります");
      segments.pop();
    } else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

function paragraphs(source: string): { kind: "heading" | "paragraph"; text: string }[] {
  const doc = new DOMParser().parseFromString(source, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) throw new Error("本文のXHTMLを解析できません");
  const body = doc.getElementsByTagName("body")[0];
  if (!body) return [];
  // Only plain text leaves this parser. No EPUB markup is rendered in the app.
  const selected = Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote"))
    .filter((element) => !element.querySelector("h1,h2,h3,h4,h5,h6,p,li,blockquote"))
    .map((element) => ({
      kind: /^h[1-6]$/.test(element.localName) ? "heading" as const : "paragraph" as const,
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim().normalize("NFC"),
    }))
    .filter((item) => item.text);
  if (selected.length) return selected;
  const text = (body.textContent ?? "").replace(/\s+/g, " ").trim().normalize("NFC");
  return text ? [{ kind: "paragraph", text }] : [];
}

export async function importEpub(file: File): Promise<BookDocument> {
  if (file.size > MAX_FILE_BYTES) throw new Error("20MB以下のEPUBを選んでください");
  const bytes = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new Error("EPUB内のファイル数が多すぎます");
  const declaredSize = Object.values(zip.files).reduce((sum, entry) => {
    const data = entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
    return sum + (data._data?.uncompressedSize ?? 0);
  }, 0);
  if (declaredSize > 25 * 1024 * 1024) throw new Error("EPUBの展開サイズが大きすぎます");
  if (zip.file("META-INF/encryption.xml")) {
    throw new Error("暗号化されたEPUBには対応していません");
  }
  const container = zip.file("META-INF/container.xml");
  if (!container) throw new Error("EPUBの目次情報がありません");
  const containerXml = parseXml(await readText(container, 100_000));
  const root = Array.from(containerXml.getElementsByTagName("rootfile"))[0];
  const opfPath = root?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUBの書籍情報がありません");
  const opf = zip.file(safePath("", opfPath));
  if (!opf) throw new Error("EPUBの書籍情報を開けません");
  const packageXml = parseXml(await readText(opf, 1_000_000));
  const title = Array.from(packageXml.getElementsByTagName("*"))
    .find((element) => element.localName === "title")?.textContent?.trim() || file.name;
  const manifest = Array.from(packageXml.getElementsByTagName("*"))
    .find((element) => element.localName === "manifest");
  const spine = Array.from(packageXml.getElementsByTagName("*"))
    .find((element) => element.localName === "spine");
  if (!manifest || !spine) throw new Error("EPUBの本文順序がありません");
  const items = new Map(childElements(manifest, "item")
    .map((item) => [item.getAttribute("id"), item]));
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const documentId = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const book: BookDocument = {
    schemaVersion: 1, documentId, revisionId: documentId, title,
    language: "ja", sourceKind: "epub", coverage: "unknown", units: [], blocks: [],
  };
  let total = 0;
  for (const reference of childElements(spine, "itemref")) {
    if (reference.getAttribute("linear") === "no") continue;
    const item = items.get(reference.getAttribute("idref"));
    if (!item || !["application/xhtml+xml", "text/html"].includes(item.getAttribute("media-type") ?? "")) {
      throw new Error("未対応の本文形式があります");
    }
    const href = safePath(base, item.getAttribute("href") ?? "");
    const entry = zip.file(href);
    if (!entry) throw new Error(`本文ファイルが見つかりません: ${href}`);
    const unitId = `u${book.units.length + 1}`;
    book.units.push({ id: unitId, ordinal: book.units.length + 1, epubHref: href });
    const chapter = await readText(entry, MAX_CHAPTER_CHARS);
    for (const part of paragraphs(chapter)) {
      total += Array.from(part.text).length;
      if (total > MAX_BOOK_CHARS) throw new Error("本文が大きすぎます");
      book.blocks.push({
        id: `b${book.blocks.length + 1}`, kind: part.kind, canonicalText: part.text,
        sourceSpans: [{ unitId, startCp: 0, endCp: Array.from(part.text).length }],
        quality: "unreviewed",
      });
    }
  }
  if (!book.blocks.length) throw new Error("読める本文がありません");
  return book;
}

export function readingText(book: BookDocument): string {
  return book.blocks.map((block) => block.canonicalText).join(" ");
}
