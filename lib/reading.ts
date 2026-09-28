export type Chunk = { text: string; start: number; end: number };

/** Positions use Unicode code points, so a display change can keep its place. */
export function splitIntoChunks(text: string, size: number, anchor = 0): Chunk[] {
  if (size < 1) throw new RangeError("Chunk size must be positive");
  const points = Array.from(text.replace(/\s+/g, " ").trim());
  const chunks: Chunk[] = [];
  for (let start = 0; start < points.length;) {
    let end = Math.min(start + size, points.length);
    if (start < anchor && anchor < end) end = anchor;
    chunks.push({ text: points.slice(start, end).join(""), start, end });
    start = end;
  }
  return chunks;
}

export function chunkIndexAt(chunks: Chunk[], offset: number): number {
  const index = chunks.findIndex((chunk) => chunk.end > offset);
  return index < 0 ? Math.max(0, chunks.length - 1) : index;
}

export function displayDurationMs(text: string, cpm: number): number {
  if (cpm <= 0) throw new RangeError("CPM must be positive");
  const graphemes = Array.from(
    new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)
  ).length;
  return (60_000 * graphemes) / cpm;
}
