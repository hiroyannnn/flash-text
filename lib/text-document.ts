import type { BookDocument } from "./book";

export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_TITLE_POINTS = 60;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Titles must stay on one line.
const TITLE_CONTROLS = /[\u0000-\u001f]/;

export function textTitle(value: string): string {
  const title = value.trim().normalize("NFC");
  if (
    !title ||
    TITLE_CONTROLS.test(title) ||
    Array.from(title).length > MAX_TITLE_POINTS
  ) {
    throw new Error("タイトルは空白以外の60文字以内で入力してください");
  }
  return title;
}

function textBody(value: string): { raw: string; canonical: string } {
  const raw = value.replace(/^\uFEFF/, "");
  if (
    raw.length > MAX_TEXT_BYTES ||
    new TextEncoder().encode(raw).byteLength > MAX_TEXT_BYTES
  ) {
    throw new Error("1MiB以下のテキストを選んでください");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject binary data while permitting tabs and newlines.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw))
    throw new Error("制御文字を含むデータは読み込めません");
  const canonical = raw.replace(/\s+/g, " ").trim();
  if (!canonical) throw new Error("空のテキストは保存できません");
  return { raw, canonical };
}

/** A new input is a distinct immutable document, even when its text is identical. */
export function createTextDocument(value: string): BookDocument {
  const { raw, canonical } = textBody(value);
  const firstLine =
    raw.split(/\r\n?|\n/).find((line) => line.trim()) ?? canonical;
  const title = textTitle(
    Array.from(firstLine.replace(/\s+/g, " ").trim())
      .slice(0, MAX_TITLE_POINTS)
      .join("")
  );
  const documentId = `text:${crypto.randomUUID()}`;
  return {
    schemaVersion: 1,
    documentId,
    revisionId: documentId,
    title,
    language: "ja",
    sourceKind: "text",
    plainText: raw,
    coverage: "unknown",
    units: [],
    blocks: [
      {
        id: "b1",
        kind: "paragraph",
        canonicalText: canonical,
        sourceSpans: [],
        quality: "unreviewed",
      },
    ],
  };
}

export async function importTextFile(file: File): Promise<BookDocument> {
  if (file.size > MAX_TEXT_BYTES)
    throw new Error("1MiB以下の.txtを選んでください");
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error("テキストファイルを読み込めませんでした");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("UTF-8形式の.txtを選んでください");
  }
  return createTextDocument(text);
}

export function validTextDocument(value: unknown): value is BookDocument {
  if (!value || typeof value !== "object") return false;
  const book = value as BookDocument;
  try {
    return (
      book.schemaVersion === 1 &&
      book.sourceKind === "text" &&
      typeof book.documentId === "string" &&
      book.documentId.startsWith("text:") &&
      book.revisionId === book.documentId &&
      typeof book.title === "string" &&
      textTitle(book.title) === book.title &&
      typeof book.plainText === "string" &&
      Array.isArray(book.units) &&
      book.units.length === 0 &&
      Array.isArray(book.blocks) &&
      book.blocks.length === 1 &&
      book.blocks[0].kind === "paragraph" &&
      book.blocks[0].id === "b1" &&
      Array.isArray(book.blocks[0].sourceSpans) &&
      book.blocks[0].sourceSpans.length === 0 &&
      book.blocks[0].canonicalText === textBody(book.plainText).canonical
    );
  } catch {
    return false;
  }
}
