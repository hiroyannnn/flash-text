import type JSZip from "jszip";

export function readZipEntry(
  entry: JSZip.JSZipObject,
  limit: number,
  errorMessage: string
): Promise<Uint8Array<ArrayBuffer>> {
  const archiveEntry = entry as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
    internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
  };
  const tooLarge = () => new Error(errorMessage);
  if ((archiveEntry._data?.uncompressedSize ?? 0) > limit)
    return Promise.reject(tooLarge());

  // ZIP headers can understate the expanded size.
  return new Promise((resolve, reject) => {
    const stream = archiveEntry.internalStream("uint8array");
    const parts: Uint8Array[] = [];
    let size = 0;
    stream
      .on("data", (part) => {
        size += part.byteLength;
        if (size > limit) {
          stream.pause();
          reject(tooLarge());
          return;
        }
        parts.push(part);
      })
      .on("error", reject)
      .on("end", () => {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        resolve(bytes);
      })
      .resume();
  });
}
