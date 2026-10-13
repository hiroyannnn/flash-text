import JSZip from "jszip";
import { z } from "zod";
import type { BookDocument } from "./book";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const span = z.object({
  unitId: z.string(), startCp: z.number().int().min(0), endCp: z.number().int().min(0),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
const textBlock = z.object({
  id: z.string(), kind: z.enum(["heading", "paragraph"]), canonicalText: z.string().min(1),
  sourceSpans: z.array(span).min(1), quality: z.enum(["unreviewed", "accepted", "needs-review"]),
});
const reviewBlock = z.object({
  id: z.string(), kind: z.literal("review"),
  reason: z.enum(["figure", "table", "code", "formula", "ocr", "reading-order"]),
  sourceUnitIds: z.array(z.string()).min(1),
});
const schema = z.object({
  schemaVersion: z.literal(1), documentId: hash, revisionId: hash,
  title: z.string().min(1), language: z.literal("ja"),
  sourceKind: z.literal("kindle-capture"), coverage: z.literal("partial"),
  units: z.array(z.object({
    id: z.string(), ordinal: z.number().int().positive(),
    imagePath: z.string().regex(/^assets\/pages\/\d{6}\.png$/), imageSha256: hash,
    widthPx: z.number().int().positive(), heightPx: z.number().int().positive(),
  })).min(1).max(20),
  blocks: z.array(z.union([textBlock, reviewBlock])).min(1),
});

export type FlashbookImport = { book: BookDocument; images: { unitId: string; blob: Blob }[] };

function maxSize(entry: JSZip.JSZipObject, limit: number): void {
  const data = entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
  if ((data._data?.uncompressedSize ?? limit + 1) > limit) {
    throw new Error("読書用ファイル内のデータが大きすぎます");
  }
}

export async function importFlashbook(file: File): Promise<FlashbookImport> {
  if (file.size > 100 * 1024 * 1024) throw new Error("100MB以下のファイルを選んでください");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files);
  if (names.length > 22 || !zip.file("book.json")) throw new Error("読書用ファイルの構成が不正です");
  maxSize(zip.file("book.json")!, 5 * 1024 * 1024);
  const parsed = schema.safeParse(JSON.parse(await zip.file("book.json")!.async("text")));
  if (!parsed.success) throw new Error("読書用ファイルの本文形式が不正です");
  const book = parsed.data as BookDocument;
  const unitIds = new Set(book.units.map((unit) => unit.id));
  if (unitIds.size !== book.units.length ||
      book.blocks.some((block) => block.kind === "review"
        ? block.sourceUnitIds.some((id) => !unitIds.has(id))
        : block.sourceSpans.some((source) => !unitIds.has(source.unitId) || source.endCp > Array.from(block.canonicalText).length))) {
    throw new Error("読書用ファイルの参照位置が不正です");
  }
  const images: FlashbookImport["images"] = [];
  for (const [index, unit] of book.units.entries()) {
    if (unit.ordinal !== index + 1 || unit.imagePath !== `assets/pages/${String(index + 1).padStart(6, "0")}.png`) {
      throw new Error("元画像の順序が不正です");
    }
    const entry = zip.file(unit.imagePath!);
    if (!entry) throw new Error("元画像が見つかりません");
    maxSize(entry, 10 * 1024 * 1024);
    const bytes = await entry.async("uint8array");
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    const actual = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== unit.imageSha256) throw new Error("元画像の内容が一致しません");
    images.push({ unitId: unit.id, blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }) });
  }
  return { book, images };
}
