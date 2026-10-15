import JSZip from "jszip";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import Page from "./page";
import { importEpub, readingText, type BookDocument } from "@/lib/book";
import { listBooks, saveBook } from "@/lib/book-store";

describe("FlashReader", () => {
  it("リセットボタンをクリックすると、再生状態と進捗がリセットされる", async () => {
    render(<Page />);

    // サンプルテキストを入力
    const sampleButton = screen.getByText("サンプルのテキストを入力");
    await act(async () => {
      fireEvent.click(sampleButton);
    });

    // 開始ボタンをクリック
    const startButton = screen.getByText("開始");
    await act(async () => {
      fireEvent.click(startButton);
    });

    // リセットボタンをクリック
    const resetButton = screen.getByText("リセット");
    await act(async () => {
      fireEvent.click(resetButton);
    });

    // 進捗バーが0%になっていることを確認
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "0");

    // 開始ボタンが有効になっていることを確認
    const startButtonAfterReset = screen.getByText("開始");
    expect(startButtonAfterReset).not.toBeDisabled();
  });

  it("テキストが入力されていない場合、リセットボタンは無効化されている", () => {
    render(<Page />);
    const resetButton = screen.getByText("リセット");
    expect(resetButton).toBeDisabled();
  });

  it("サンプルテキストを入力すると、以前の状態がリセットされる", async () => {
    render(<Page />);

    // テキストエリアに直接テキストを入力
    const textarea = screen.getByPlaceholderText(
      "ここに長文テキストを入力または貼り付けてください..."
    );
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "テスト文章" } });
    });

    // 開始ボタンをクリック
    const startButton = screen.getByText("開始");
    await act(async () => {
      fireEvent.click(startButton);
    });

    // サンプルテキストを入力
    const sampleButton = screen.getByText("サンプルのテキストを入力");
    await act(async () => {
      fireEvent.click(sampleButton);
    });

    // 進捗バーが0%になっていることを確認
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "0");

    // 開始ボタンが有効で、一時停止状態になっていることを確認
    const startButtonAfterSample = screen.getByText("開始");
    expect(startButtonAfterSample).not.toBeDisabled();
    expect(screen.queryByText("一時停止")).not.toBeInTheDocument();
  });
});

const BOOK_A = "絵文字😀の試験本";
const BOOK_B = "ふたつめの試験本";

type Chapter = { heading?: string; paragraphs: string[] };

// Self-made DRM-free EPUBs only. No real book, server, or network is involved.
async function epubFile(name: string, title: string, chapters: Chapter[], options: {
  encrypted?: boolean; missingChapter?: boolean;
} = {}): Promise<File> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  if (options.encrypted) zip.file("META-INF/encryption.xml", "<encryption/>");
  const ids = chapters.map((_, index) => `c${index + 1}`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>ja</dc:language></metadata>
  <manifest>${ids.map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>
  <spine>${ids.map((id) => `<itemref idref="${id}"/>`).join("")}</spine>
</package>`);
  chapters.forEach((chapter, index) => {
    if (options.missingChapter && index === chapters.length - 1) return;
    const heading = chapter.heading ? `<h1>${chapter.heading}</h1>` : "";
    zip.file(`OEBPS/${ids[index]}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body>${heading}${chapter.paragraphs.map((text) => `<p>${text}</p>`).join("")}</body></html>`);
  });
  return fileFromBytes(name, await zip.generateAsync({ type: "uint8array" }));
}

function fileFromBytes(name: string, bytes: Uint8Array): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // jsdom's File lacks arrayBuffer; browsers supply it.
  return Object.assign(new File([bytes], name), { arrayBuffer: async () => buffer });
}

const bookA = () => epubFile("emoji.epub", BOOK_A, [
  { heading: "第一章🌸はじまり", paragraphs: ["あ😀いうえおか🍣きくけこさしす", "たちつ🐱てと"] },
  { paragraphs: ["なにぬねの😀はひふへほ"] },
]);
const bookB = () => epubFile("second.epub", BOOK_B, [
  { paragraphs: ["まみむめもやゆよらりるれろわをん", "がぎぐげご🎌ざじずぜぞ"] },
]);

const flashText = () => document.querySelector("p.text-2xl")?.textContent;
const savedPosition = (book: BookDocument) =>
  JSON.parse(localStorage.getItem(`flash-position:${book.documentId}`) ?? "null");

async function importFile(file: File) {
  const input = screen.getByLabelText("本のファイルを選ぶ");
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(input).not.toBeDisabled());
}

async function storedBook(title: string): Promise<BookDocument> {
  const book = (await listBooks()).find((candidate) => candidate.title === title);
  if (!book) throw new Error(`${title} is not stored`);
  return book;
}

function resumeButton(title: string) {
  const row = screen.getByText(title, { selector: "span" }).parentElement;
  if (!row) throw new Error(`${title} has no shelf row`);
  return within(row).getByRole("button", { name: "続きから" });
}

// Plays with fake timers, then pauses. Every 5-code-point chunk lasts at most 1000ms at 300 CPM.
async function readChunks(count: number) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    fireEvent.click(screen.getByText("開始"));
    for (let index = 0; index < count; index++) {
      await act(async () => { vi.advanceTimersByTime(1000); });
    }
    fireEvent.click(screen.getByText("一時停止"));
  } finally {
    vi.useRealTimers();
  }
}

async function reload(unmount: () => void) {
  unmount();
  const view = render(<Page />);
  await screen.findAllByRole("button", { name: "続きから" });
  return view;
}

function expectStopped() {
  expect(screen.getByText("開始")).toBeInTheDocument();
  expect(screen.queryByText("一時停止")).not.toBeInTheDocument();
}

describe("EPUB取り込みから続きからまでの統合受入", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("日本語と絵文字のEPUBを取り込むと、本棚に題名が出てIndexedDBに残る", async () => {
    render(<Page />);
    await importFile(await bookA());

    expect(await screen.findByText(BOOK_A, { selector: "span" })).toBeInTheDocument();
    expect(resumeButton(BOOK_A)).toBeInTheDocument();
    const book = await storedBook(BOOK_A);
    expect(readingText(book)).toBe("第一章🌸はじまり あ😀いうえおか🍣きくけこさしす たちつ🐱てと なにぬねの😀はひふへほ");
    expect(flashText()).toBe("第一章🌸は");
  });

  it("途中まで読んで再マウントしても、続きからで同じ版・block・code-point位置に停止状態で戻る", async () => {
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(3);
    const book = await storedBook(BOOK_A);

    expect(flashText()).toBe("おか🍣きく");
    // "あ😀いうえ" is 5 code points but 6 UTF-16 units.
    expect(savedPosition(book)).toMatchObject({ revisionId: book.revisionId, blockId: "b2", offsetCp: 5 });

    await reload(unmount);
    expect(flashText()).toBe("テキストを入力して開始ボタンを押してください");
    fireEvent.click(resumeButton(BOOK_A));

    expect(flashText()).toBe("おか🍣きく");
    expectStopped();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(savedPosition(book)).toMatchObject({ revisionId: book.revisionId, blockId: "b2", offsetCp: 5 });

    // Stopped means the position does not move until the reader presses 開始.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { vi.advanceTimersByTime(5000); });
    vi.useRealTimers();
    expect(flashText()).toBe("おか🍣きく");
  });

  it("本A→本B→本Aと切り替えても、それぞれの位置を混同しない", async () => {
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(2);
    await importFile(await bookB());
    await screen.findByText(BOOK_B, { selector: "span" });
    expect(flashText()).toBe("まみむめも");
    await readChunks(5);
    const a = await storedBook(BOOK_A);
    const b = await storedBook(BOOK_B);
    expect(savedPosition(a)).toMatchObject({ blockId: "b2", offsetCp: 0 });
    expect(savedPosition(b)).toMatchObject({ blockId: "b2", offsetCp: 5 });

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expect(flashText()).toBe("あ😀いうえ");
    fireEvent.click(resumeButton(BOOK_B));
    expect(flashText()).toBe("🎌ざじずぜ");
    fireEvent.click(resumeButton(BOOK_A));
    expect(flashText()).toBe("あ😀いうえ");
    expectStopped();
    expect(savedPosition(a)).toMatchObject({ blockId: "b2", offsetCp: 0 });
    expect(savedPosition(b)).toMatchObject({ blockId: "b2", offsetCp: 5 });
  });

  it.each(["QuotaExceededError", "SecurityError"])("位置保存の%sでも画面と直前の保存値を保ち、現在位置を再保存できる", async (errorName) => {
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(2);
    const book = await storedBook(BOOK_A);
    const key = `flash-position:${book.documentId}`;
    const before = localStorage.getItem(key);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === key) throw new DOMException("storage unavailable", errorName);
      originalSetItem.call(this, storageKey, value);
    });

    await readChunks(1);
    expect(screen.getByRole("alert")).toHaveTextContent("読書位置を保存できません");
    expect(localStorage.getItem(key)).toBe(before);
    expect(flashText()).toBe("おか🍣きく");
    fireEvent.click(screen.getByRole("button", { name: "保存を再試行" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(localStorage.getItem(key)).toBe(before);

    await readChunks(1);
    expect(flashText()).toBe("けこさしす");
    write.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "保存を再試行" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(savedPosition(book)).toMatchObject({ blockId: "b2", offsetCp: 10 });

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expect(flashText()).toBe("けこさしす");
    expectStopped();
  });

  it("保存位置の読取拒否中は既存値を上書きせず、再読込で保存位置へ戻れる", async () => {
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(3);
    const book = await storedBook(BOOK_A);
    const key = `flash-position:${book.documentId}`;
    const before = localStorage.getItem(key);
    const originalGetItem = Storage.prototype.getItem;
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey) {
      if (storageKey === key) throw new DOMException("storage unavailable", "SecurityError");
      return originalGetItem.call(this, storageKey);
    });
    const write = vi.spyOn(Storage.prototype, "setItem");

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expect(screen.getByRole("alert")).toHaveTextContent("読書位置を読み込めません");
    expect(flashText()).toBe("第一章🌸は");
    await readChunks(1);
    fireEvent.click(screen.getByRole("button", { name: "保存位置を再読込" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(write).not.toHaveBeenCalledWith(key, expect.anything());

    read.mockRestore();
    expect(localStorage.getItem(key)).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "保存位置を再読込" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(flashText()).toBe("おか🍣きく");
    expectStopped();
    expect(savedPosition(book)).toMatchObject({ blockId: "b2", offsetCp: 5 });
  });

  it("本Aの保存失敗を本Bに持ち越さず、それぞれの保存位置を保つ", async () => {
    render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(3);
    await importFile(await bookB());
    await screen.findByText(BOOK_B, { selector: "span" });
    await readChunks(1);
    const a = await storedBook(BOOK_A);
    const b = await storedBook(BOOK_B);
    const beforeA = savedPosition(a);
    const beforeB = savedPosition(b);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === `flash-position:${a.documentId}`) throw new DOMException("storage unavailable", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    });

    fireEvent.click(resumeButton(BOOK_A));
    expect(screen.getByRole("alert")).toHaveTextContent("読書位置を保存できません");
    await readChunks(1);
    fireEvent.click(resumeButton(BOOK_B));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(flashText()).toBe("やゆよらり");
    expectStopped();
    expect(savedPosition(a)).toMatchObject(beforeA);
    expect(savedPosition(b)).toMatchObject({ ...beforeB, updatedAt: expect.any(String) });
  });

  it("表示文字数を変えても読書位置を保持する", async () => {
    // Radix Slider measures its thumb; jsdom has no ResizeObserver.
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(3);
    const book = await storedBook(BOOK_A);

    const settings = document.querySelector('button[aria-haspopup="dialog"]');
    if (!settings) throw new Error("settings trigger is missing");
    fireEvent.click(settings);
    fireEvent.keyDown(await screen.findByRole("slider"), { key: "ArrowRight" });

    expect(await screen.findByText("チャンクサイズ: 6 文字")).toBeInTheDocument();
    expect(flashText()).toBe("おか🍣きくけ");
    expect(savedPosition(book)).toMatchObject({ blockId: "b2", offsetCp: 5 });

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expect(flashText()).toBe("おか🍣きく");
  });

  it("版が変わった本は保存位置を使わず先頭から停止状態で開く", async () => {
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(3);
    const book = await storedBook(BOOK_A);
    await act(async () => { await saveBook({ ...book, revisionId: "next-edition" }); });

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));

    expect(flashText()).toBe("第一章🌸は");
    expectStopped();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(savedPosition(book)).toMatchObject({ revisionId: "next-edition", blockId: "b1", offsetCp: 0 });
  });

  it.each([
    ["JSONでない", "{壊れた"],
    ["オブジェクトでない", "42"],
    ["存在しないblock", JSON.stringify({ revisionId: "$rev", blockId: "b999", offsetCp: 1 })],
    ["負のoffset", JSON.stringify({ revisionId: "$rev", blockId: "b2", offsetCp: -1 })],
    ["整数でないoffset", JSON.stringify({ revisionId: "$rev", blockId: "b2", offsetCp: 1.5 })],
    ["文字列のoffset", JSON.stringify({ revisionId: "$rev", blockId: "b2", offsetCp: "5" })],
    ["blockより長いoffset", JSON.stringify({ revisionId: "$rev", blockId: "b2", offsetCp: 9999 })],
  ])("壊れた保存値(%s)は先頭から停止状態で開く", async (_, raw) => {
    const book = await importEpub(await bookA());
    await saveBook(book);
    localStorage.setItem(`flash-position:${book.documentId}`, raw.replace("$rev", book.revisionId));

    render(<Page />);
    await screen.findByText(BOOK_A, { selector: "span" });
    fireEvent.click(resumeButton(BOOK_A));

    expect(flashText()).toBe("第一章🌸は");
    expectStopped();
    expect(savedPosition(book)).toMatchObject({ revisionId: book.revisionId, blockId: "b1", offsetCp: 0 });
  });

  it("暗号化・不正なEPUBはエラーを表示し、既存の本と読書位置を失わない", async () => {
    const { unmount } = render(<Page />);
    await importFile(await bookA());
    await screen.findByText(BOOK_A, { selector: "span" });
    await readChunks(3);
    const book = await storedBook(BOOK_A);
    const before = localStorage.getItem(`flash-position:${book.documentId}`);

    const broken = [
      { file: await epubFile("locked.epub", "暗号化された本", [{ paragraphs: ["秘密"] }], { encrypted: true }), message: /暗号化/ },
      { file: fileFromBytes("broken.epub", new TextEncoder().encode("これはZIPではありません")), message: /./ },
      { file: await epubFile("missing.epub", "欠けた本", [{ paragraphs: ["一"] }, { paragraphs: ["二"] }], { missingChapter: true }), message: /本文ファイルが見つかりません/ },
    ];
    for (const { file, message } of broken) {
      await importFile(file);
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(screen.getAllByRole("button", { name: "続きから" })).toHaveLength(1);
      expect(flashText()).toBe("おか🍣きく");
    }
    expect((await listBooks()).map((stored) => stored.title)).toEqual([BOOK_A]);
    expect(localStorage.getItem(`flash-position:${book.documentId}`)).toBe(before);

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expect(flashText()).toBe("おか🍣きく");
    expectStopped();
  });
});
