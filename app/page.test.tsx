import JSZip from "jszip";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import Page from "./page";
import { importEpub, readingText, type BookDocument } from "@/lib/book";
import { bookLength, listBooks, saveBook, savePosition } from "@/lib/book-store";
import { SETTINGS_KEY, saveReaderSettings } from "@/lib/reader-settings";

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
    const resetButton = screen.getByText("最初から読む");
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
    const resetButton = screen.getByText("最初から読む");
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

function shelfRow(title: string) {
  const row = screen.getByText(title, { selector: "span" }).parentElement;
  if (!row) throw new Error("Missing bookshelf row");
  return row;
}

async function renderReadyPage() {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => { view = render(<Page />); });
  if (!view) throw new Error("Page did not mount");
  return view;
}

function openSettings() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  fireEvent.click(screen.getByRole("button", { name: "読書設定" }));
}

async function advanceReading(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
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
    expect(flashText()).toBe("おか🍣きくけ");
  });

  it("1チャンクの結合文字と絵文字は表示時間後にだけ読了となり、再起動と最初から読むに対応する", async () => {
    const file = await epubFile("single.epub", "短い本", [{ paragraphs: ["か\u3099😀"] }]);
    const { unmount } = await renderReadyPage();
    await importFile(file);
    const book = await storedBook("短い本");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    await advanceReading(399);
    expect(savedPosition(book).completed).toBe(false);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await advanceReading(1);
    expect(savedPosition(book)).toMatchObject({ completed: true, offsetCp: 2 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    vi.useRealTimers();

    await reload(unmount);
    fireEvent.click(resumeButton("短い本"));
    expectStopped();
    expect(screen.getByRole("button", { name: "開始" })).toBeDisabled();
    expect(shelfRow("短い本")).toHaveTextContent("読了 · 100%");
    openSettings();
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
    expect(savedPosition(book)).toMatchObject({ completed: true, offsetCp: 2 });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "最初から読む" }));
    expect(savedPosition(book)).toMatchObject({ completed: false, offsetCp: 0 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("button", { name: "開始" })).not.toBeDisabled();
  });

  it("最終チャンクへの移動は読了ではなく、停止と再起動後にも残りを表示してから読了にする", async () => {
    const file = await epubFile("boundary.epub", "境界の本", [{ paragraphs: ["あいうえおか"] }]);
    const { unmount } = await renderReadyPage();
    await importFile(file);
    const book = await storedBook("境界の本");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByText("開始"));
    await advanceReading(1000);
    expect(flashText()).toBe("か");
    expect(savedPosition(book)).toMatchObject({ completed: false, offsetCp: 5 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "83");
    fireEvent.click(screen.getByText("一時停止"));
    vi.useRealTimers();
    await reload(unmount);
    fireEvent.click(resumeButton("境界の本"));
    expectStopped();
    expect(flashText()).toBe("か");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByText("開始"));
    await advanceReading(199);
    expect(savedPosition(book).completed).toBe(false);
    await advanceReading(1);
    expect(savedPosition(book).completed).toBe(true);
  });

  it("読了の保存拒否を未保存と表示し、本棚の確定済み状態を保って再試行できる", async () => {
    const file = await epubFile("blocked.epub", "保存拒否の本", [{ paragraphs: ["短😀"] }]);
    await renderReadyPage();
    await importFile(file);
    const book = await storedBook("保存拒否の本");
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === `flash-position:${book.documentId}`) throw new DOMException("full", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByText("開始"));
    await advanceReading(400);
    expect(screen.getByText("読了（未保存）")).toBeInTheDocument();
    expect(savedPosition(book).completed).toBe(false);
    expect(shelfRow("保存拒否の本")).not.toHaveTextContent("読了");
    vi.useRealTimers();
    write.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "保存を再試行" }));
    expect(savedPosition(book).completed).toBe(true);
    expect(shelfRow("保存拒否の本")).toHaveTextContent("読了 · 100%");
  });

  it("速度と表示文字数を共通設定として復元し、設定の保存拒否と再試行でも本の位置を保つ", async () => {
    const { unmount } = await renderReadyPage();
    await importFile(await bookA());
    await readChunks(3);
    const book = await storedBook(BOOK_A);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === SETTINGS_KEY) throw new DOMException("full", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    });
    openSettings();
    fireEvent.click(screen.getByRole("radio", { name: "High (600 CPM)" }));
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("設定を保存できません");
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(savedPosition(book)).toMatchObject({ blockId: "b2", offsetCp: 5 });
    write.mockRestore();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "設定の保存を再試行" }));
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null")).toMatchObject({ speed: 600, chunkSize: 6 });
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const speedSlider = screen.getAllByRole("slider").find((slider) => slider.getAttribute("aria-valuemax") === "1000");
    if (!speedSlider) throw new Error("Missing speed slider");
    fireEvent.keyDown(speedSlider, { key: "ArrowRight" });

    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expectStopped();
    expect(flashText()).toBe("おか🍣きくけ");
    expect(savedPosition(book)).toMatchObject({ blockId: "b2", offsetCp: 5 });
    openSettings();
    expect(screen.getByText("カスタム速度: 610 CPM (文字/分)")).toBeInTheDocument();
    expect(screen.getByText("チャンクサイズ: 6 文字")).toBeInTheDocument();
  });

  it("設定の読取拒否では変更しても既存値を上書きせず、再読込で復元する", async () => {
    saveReaderSettings({ speed: 150, chunkSize: 3, speedMode: "low" });
    const before = localStorage.getItem(SETTINGS_KEY);
    const originalGetItem = Storage.prototype.getItem;
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (key === SETTINGS_KEY) throw new DOMException("denied", "SecurityError");
      return originalGetItem.call(this, key);
    });
    await renderReadyPage();
    openSettings();
    fireEvent.click(screen.getByRole("radio", { name: "High (600 CPM)" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("設定を読み込めません");
    read.mockRestore();
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "設定を再読込" }));
    expect(screen.getByRole("radio", { name: "Low (150 CPM)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("チャンクサイズ: 3 文字")).toBeInTheDocument();
  });

  it("破損した設定は標準値と通知で開き、利用者が変更するまで書き換えない", async () => {
    localStorage.setItem(SETTINGS_KEY, "{broken");
    await renderReadyPage();
    expect(screen.getByText("保存済みの設定を使えないため、標準設定で開きました。")).toBeInTheDocument();
    expect(localStorage.getItem(SETTINGS_KEY)).toBe("{broken");
    openSettings();
    expect(screen.getByRole("radio", { name: "Mid (300 CPM)" })).toHaveAttribute("aria-checked", "true");
  });

  it("本棚は保存済みの進捗と読了・日時を示して最近の本を先頭に置き、入力へ戻っても本を失わない", async () => {
    const a = await importEpub(await bookA());
    const b = await importEpub(await bookB());
    await saveBook(a);
    await saveBook(b);
    savePosition(a, bookLength(a), true);
    savePosition(b, 5);
    const keyA = `flash-position:${a.documentId}`;
    const keyB = `flash-position:${b.documentId}`;
    localStorage.setItem(keyA, JSON.stringify({ ...savedPosition(a), updatedAt: "2026-10-01T00:00:00.000Z" }));
    localStorage.setItem(keyB, JSON.stringify({ ...savedPosition(b), updatedAt: "2026-10-02T00:00:00.000Z" }));
    const { unmount } = await renderReadyPage();
    await screen.findByText(BOOK_A, { selector: "span" });
    expect(screen.getByText(`最近読んだ本：${BOOK_B}`)).toBeInTheDocument();
    expect(shelfRow(BOOK_A)).toHaveTextContent("読了 · 100%");
    expect(shelfRow(BOOK_B)).toHaveTextContent("読書中");
    expect(shelfRow(BOOK_B).querySelector("time")).toHaveAttribute("dateTime", "2026-10-02T00:00:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "最近の本の続きから" }));
    expect(flashText()).toBe("やゆよらり");
    expectStopped();
    fireEvent.click(resumeButton(BOOK_A));
    expect(screen.getByRole("button", { name: "開始" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "新しいテキスト" }));
    const input = screen.getByPlaceholderText("ここに長文テキストを入力または貼り付けてください...");
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "画面内の下書き😀" } });
    fireEvent.click(resumeButton(BOOK_B));
    expect(input).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "新しいテキスト" }));
    expect(input).toHaveValue("画面内の下書き😀");
    expect((await listBooks()).map((book) => book.title).sort()).toEqual([BOOK_A, BOOK_B].sort());
    expect(savedPosition(a).completed).toBe(true);
    expect(savedPosition(b)).toMatchObject({ completed: false, offsetCp: 5 });
    await reload(unmount);
    fireEvent.click(resumeButton(BOOK_A));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    fireEvent.click(resumeButton(BOOK_B));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).not.toBe("100");
    expectStopped();
  });

  it("位置の保存拒否中に新しい入力へ戻っても、EPUBと最後の保存位置を残す", async () => {
    await renderReadyPage();
    await importFile(await bookA());
    await readChunks(3);
    const book = await storedBook(BOOK_A);
    const key = `flash-position:${book.documentId}`;
    const before = localStorage.getItem(key);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === key) throw new DOMException("full", "QuotaExceededError");
      originalSetItem.call(this, storageKey, value);
    });
    await readChunks(1);
    fireEvent.click(screen.getByRole("button", { name: "新しいテキスト" }));
    expect(screen.getByRole("alert")).toHaveTextContent("保存を確認できていません");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "別の入力" } });
    expect(localStorage.getItem(key)).toBe(before);
    expect(await storedBook(BOOK_A)).toMatchObject({ documentId: book.documentId, revisionId: book.revisionId });
    write.mockRestore();
    fireEvent.click(resumeButton(BOOK_A));
    expect(flashText()).toBe("おか🍣きく");
    expectStopped();
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
    expect(screen.getByText("本文の版が変わったため、先頭から開きました。")).toBeInTheDocument();
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
