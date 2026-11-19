export type Chunk = {
  text: string;
  start: number;
  end: number;
  blockId?: string;
  review?: boolean;
};

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

// Keep offsets in code points so bookmarks are independent of the display size.
export function splitIntoChunks(
  text: string,
  size: number,
  anchor = 0
): Chunk[] {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError("Chunk size must be a positive integer");
  const chunks: Chunk[] = [];
  let start = 0;
  let end = 0;
  let count = 0;
  let chunk = "";
  for (const { segment } of segmenter.segment(
    text.replace(/\s+/g, " ").trim()
  )) {
    if (count && (count === size || end === anchor)) {
      chunks.push({ text: chunk, start, end });
      start = end;
      count = 0;
      chunk = "";
    }
    end += Array.from(segment).length;
    count++;
    chunk += segment;
  }
  if (count) chunks.push({ text: chunk, start, end });
  return chunks;
}

export function chunkIndexAt(chunks: Chunk[], offset: number): number {
  const index = chunks.findIndex((chunk) => chunk.end > offset);
  return index < 0 ? Math.max(0, chunks.length - 1) : index;
}

export function displayDurationMs(text: string, cpm: number): number {
  if (cpm <= 0) throw new RangeError("CPM must be positive");
  const graphemes = Array.from(segmenter.segment(text)).length;
  return (60_000 * graphemes) / cpm;
}

export function readingProgress(chunks: Chunk[], index: number): number {
  const length = chunks.at(-1)?.end;
  return length ? (chunks[index].start / length) * 100 : 0;
}
