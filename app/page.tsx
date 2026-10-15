"use client";

import type React from "react";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Play, Pause, RotateCcw, Settings } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { chunkIndexAt, displayDurationMs, readingProgress, splitIntoChunks, type Chunk } from "@/lib/reading";
import { bookChunks, importEpub, readingText, type BookDocument } from "@/lib/book";
import { bookLength, getSourceImage, listBooks, loadReadingState, saveBook, saveFlashbook, savePosition, type ReadingState } from "@/lib/book-store";
import { importFlashbook } from "@/lib/flashbook";
import { DEFAULT_SETTINGS, loadReaderSettings, saveReaderSettings, type ReaderSettings, type SpeedMode } from "@/lib/reader-settings";

export default function FlashReader() {
  const [inputText, setInputText] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftWarning, setDraftWarning] = useState(false);
  const [books, setBooks] = useState<BookDocument[]>([]);
  const [bookStates, setBookStates] = useState<Record<string, ReadingState | null>>({});
  const [activeBook, setActiveBook] = useState<BookDocument | null>(null);
  const [importError, setImportError] = useState("");
  const [positionReadError, setPositionReadError] = useState(false);
  const [positionSaveError, setPositionSaveError] = useState(false);
  const [positionNotice, setPositionNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SETTINGS.speed);
  const [chunkSize, setChunkSize] = useState(DEFAULT_SETTINGS.chunkSize);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [completed, setCompleted] = useState(false);
  const [speedMode, setSpeedMode] = useState<SpeedMode>(DEFAULT_SETTINGS.speedMode);
  const [settingsReadError, setSettingsReadError] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const readingEnd = chunks.at(-1)?.end ?? 0;
  const position = completed ? readingEnd : chunks[currentChunkIndex]?.start ?? 0;
  const progress = readingProgress(position, readingEnd, completed);
  const lengths = useMemo(() => new Map(books.map((book) => [book.documentId, bookLength(book)])), [books]);
  const sortedBooks = useMemo(() => [...books].sort((a, b) =>
    Date.parse(bookStates[b.documentId]?.updatedAt ?? "1970-01-01") -
    Date.parse(bookStates[a.documentId]?.updatedAt ?? "1970-01-01")), [books, bookStates]);
  const recentBook = sortedBooks.find((book) => bookStates[book.documentId]?.updatedAt);

  // Split text into Unicode code points, keeping stable text offsets.
  const processText = () => {
    if (!inputText.trim()) return;
    const offset = position;
    const textChunks = activeBook
      ? bookChunks(activeBook, chunkSize, offset)
      : splitIntoChunks(inputText, chunkSize, offset);
    const index = chunkIndexAt(textChunks, offset);
    setChunks(textChunks);
    setCurrentChunkIndex(index);
  };

  const startReading = () => {
    if (chunks.length === 0) {
      const initial = activeBook ? bookChunks(activeBook, chunkSize) : splitIntoChunks(inputText, chunkSize);
      setChunks(initial);
      setCurrentChunkIndex(0);
    }
    if (chunks[currentChunkIndex]?.review) {
      void openSource();
      return;
    }
    setIsPlaying(true);
  };

  // Pausing never advances to a chunk that has not been displayed.
  const pauseReading = () => setIsPlaying(false);

  // Reset the flash reading
  const resetReading = () => {
    setIsPlaying(false);
    setCurrentChunkIndex(0);
    setCompleted(false);
  };

  // Handle text input change
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    closeSource();
    setActiveBook(null);
    setInputText(e.target.value);
    setDraftText(e.target.value);
    setChunks([]);
    setCurrentChunkIndex(0);
    setCompleted(false);
    setIsPlaying(false);
  };

  const openBook = (book: BookDocument) => {
    closeSource();
    const text = readingText(book);
    let offset = 0;
    let isCompleted = false;
    setPositionNotice("");
    setDraftWarning(false);
    try {
      const saved = loadReadingState(book);
      offset = saved.offset;
      isCompleted = saved.completed;
      if (saved.resetReason === "revision") setPositionNotice("本文の版が変わったため、先頭から開きました。");
      if (saved.resetReason === "invalid") setPositionNotice("保存位置を使えないため、先頭から開きました。");
      setPositionReadError(false);
    } catch {
      setPositionReadError(true);
    }
    setPositionSaveError(false);
    const nextChunks = bookChunks(book, chunkSize, offset);
    const index = chunkIndexAt(nextChunks, offset);
    setActiveBook(book);
    setInputText(text);
    setChunks(nextChunks);
    setCurrentChunkIndex(index);
    setCompleted(isCompleted);
    setIsPlaying(false);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImporting(true);
    try {
      let book: BookDocument;
      if (file.name.toLowerCase().endsWith(".flashbook.zip")) {
        const imported = await importFlashbook(file);
        book = imported.book;
        await saveFlashbook(book, imported.images);
      } else if (file.name.toLowerCase().endsWith(".epub")) {
        book = await importEpub(file);
        await saveBook(book);
      } else throw new Error("EPUBまたは.flashbook.zipを選んでください");
      const savedBooks = await listBooks();
      setBooks(savedBooks);
      refreshBookStates(savedBooks);
      openBook(book);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "取り込みに失敗しました");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const currentBlock = activeBook?.blocks.find((block) => block.id === chunks[currentChunkIndex]?.blockId);
  const sourceUnitId = currentBlock?.kind === "review"
    ? currentBlock.sourceUnitIds[0]
    : currentBlock?.sourceSpans[0]?.unitId;
  const sourceBox = currentBlock?.kind === "review" ? undefined : currentBlock?.sourceSpans[0]?.bbox;

  const openSource = async () => {
    if (!activeBook || !sourceUnitId) return;
    setIsPlaying(false);
    try {
      const blob = await getSourceImage(activeBook, sourceUnitId);
      if (!blob) throw new Error("元画像が保存されていません");
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = URL.createObjectURL(blob);
      setSourceUrl(sourceUrlRef.current);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "元画像を開けませんでした");
    }
  };

  const closeSource = () => {
    setSourceUrl(null);
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
  };

  const openNewText = (text = draftText) => {
    closeSource();
    setDraftWarning(positionSaveError || positionReadError);
    setActiveBook(null);
    setInputText(text);
    setDraftText(text);
    setChunks([]);
    setCurrentChunkIndex(0);
    setCompleted(false);
    setIsPlaying(false);
    setPositionReadError(false);
    setPositionSaveError(false);
    setPositionNotice("");
  };

  const refreshBookStates = useCallback((savedBooks: BookDocument[]) => {
    const states: Record<string, ReadingState | null> = {};
    for (const book of savedBooks) {
      try { states[book.documentId] = loadReadingState(book); }
      catch { states[book.documentId] = null; }
    }
    setBookStates(states);
  }, []);

  const restoreSettings = useCallback(() => {
    try {
      const { settings, invalid } = loadReaderSettings();
      setSpeed(settings.speed);
      setChunkSize(settings.chunkSize);
      setSpeedMode(settings.speedMode);
      setSettingsReadError(false);
      setSettingsSaveError(false);
      setSettingsNotice(invalid ? "保存済みの設定を使えないため、標準設定で開きました。" : "");
    } catch { setSettingsReadError(true); }
  }, []);

  const persistSettings = (settings: ReaderSettings) => {
    try {
      saveReaderSettings(settings);
      setSettingsSaveError(false);
      setSettingsNotice("");
    } catch { setSettingsSaveError(true); }
  };

  const applySettings = (settings: ReaderSettings) => {
    setSpeed(settings.speed);
    setChunkSize(settings.chunkSize);
    setSpeedMode(settings.speedMode);
    if (!settingsReadError) persistSettings(settings);
  };

  useEffect(() => { restoreSettings(); }, [restoreSettings]);

  useEffect(() => () => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  useEffect(() => {
    if (!("indexedDB" in window)) return;
    let mounted = true;
    listBooks().then((saved) => {
      if (mounted) {
        setBooks(saved);
        refreshBookStates(saved);
      }
    }).catch(() => {
      if (mounted) setImportError("保存済みの本を開けませんでした");
    });
    return () => { mounted = false; };
  }, [refreshBookStates]);

  const persistPosition = useCallback((book: BookDocument, offset: number, isCompleted: boolean) => {
    try {
      const saved = savePosition(book, offset, isCompleted);
      setBookStates((states) => ({ ...states, [book.documentId]: saved }));
      setPositionSaveError(false);
    } catch {
      setPositionSaveError(true);
    }
  }, []);

  useEffect(() => {
    if (!activeBook) {
      setPositionSaveError(false);
    } else if (chunks.length && !positionReadError) {
      persistPosition(activeBook, position, completed);
    }
  }, [activeBook, chunks, position, completed, positionReadError, persistPosition]);

  // Handle speed preset change
  const handleSpeedPresetChange = (value: SpeedMode) => {
    const speeds = { low: 150, mid: 300, high: 600 };
    applySettings({ speed: value === "custom" ? speed : speeds[value], chunkSize, speedMode: value });
  };

  // Update chunk index and progress
  useEffect(() => {
    if (isPlaying && chunks.length > 0) {
      if (chunks[currentChunkIndex]?.review) {
        setIsPlaying(false);
        return;
      }
      timerRef.current = setTimeout(() => {
        if (currentChunkIndex < chunks.length - 1) {
          setCurrentChunkIndex((prev) => prev + 1);
        } else {
          setIsPlaying(false);
          setCompleted(true);
        }
      }, displayDurationMs(chunks[currentChunkIndex].text, speed));
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isPlaying, currentChunkIndex, chunks, speed]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setIsPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);

  // Process text when chunk size changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (inputText.trim()) {
      processText();
    }
  }, [chunkSize]);

  const settingsFeedback = <>
      {settingsReadError && (
        <div role="alert" className="mb-4 space-y-2 text-destructive">
          <p>設定を読み込めません。変更はこの画面だけに反映し、保存済みの設定は上書きしません。</p>
          <Button variant="outline" onClick={restoreSettings}>設定を再読込</Button>
        </div>
      )}
      {!settingsReadError && settingsSaveError && (
        <div role="alert" className="mb-4 space-y-2 text-destructive">
          <p>設定を保存できません。次回は最後に保存できた設定で開きます。</p>
          <Button variant="outline" onClick={() => persistSettings({ speed, chunkSize, speedMode })}>設定の保存を再試行</Button>
        </div>
      )}
      {settingsNotice && <output className="mb-4 block">{settingsNotice}</output>}
  </>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold text-center mb-6">速読フラッシュリーダー</h1>
      {settingsFeedback}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>本を取り込む</CardTitle>
            <CardDescription>公式EPUBまたは取得済み画面の読書用ZIPを端末内に保存します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input type="file" accept=".epub,.zip,application/epub+zip" aria-label="本のファイルを選ぶ"
              onChange={handleImport} disabled={importing} />
            {importing && <output className="block">取り込み中...</output>}
            {importError && <p role="alert" className="text-destructive">{importError}</p>}
            {recentBook && <p className="text-sm">最近読んだ本：{recentBook.title}</p>}
            {recentBook && <Button variant="outline" onClick={() => openBook(recentBook)}>最近の本の続きから</Button>}
            {sortedBooks.map((book) => {
              const saved = bookStates[book.documentId];
              return (
                <div key={book.documentId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <span className="truncate">{book.title}</span>
                  <Button variant="outline" onClick={() => openBook(book)}>続きから</Button>
                  <p className="col-span-2 text-sm text-muted-foreground">
                    {saved ? <>
                      {saved.completed ? "読了" : saved.updatedAt || saved.offset > 0 ? "読書中" : "未読"}
                      {` · ${readingProgress(saved.offset, lengths.get(book.documentId) ?? 0, saved.completed)}% · 最終読書：`}
                      {saved.updatedAt ? <time dateTime={saved.updatedAt}>{new Date(saved.updatedAt).toLocaleString("ja-JP")}</time> : "記録なし"}
                    </> : "保存情報を読み込めません"}
                  </p>
                </div>
              );
            })}
            {activeBook && <p className="text-sm text-muted-foreground">{activeBook.title}・取り込み済み範囲</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>テキスト入力</CardTitle>
            <CardDescription>
              {activeBook ? "取り込んだ本は読み取り専用です。新しい入力に戻っても本と保存済みの位置は本棚に残ります。" : "貼り付けたテキストはこの画面内だけで保持します。ページを閉じると失われます。"}
            </CardDescription>
            <Button variant="outline" onClick={() => openNewText()}>新しいテキスト</Button>
          </CardHeader>
          <CardContent>
            {draftWarning && <p role="alert" className="mb-2 text-destructive">直前の読書位置は保存を確認できていません。本棚からは最後に保存できた位置で再開します。</p>}
            <Textarea
              placeholder="ここに長文テキストを入力または貼り付けてください..."
              className="min-h-[150px]"
              value={inputText}
              onChange={handleTextChange}
              readOnly={activeBook !== null}
            />
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  const sample = `「あれ、意外と読める」と気づきました。フラッシュテキストで文章を読んでみたら、普段より早く読めるんです。目線を左右に動かす必要がないから、自然と読むスピードが上がるみたい。

長文を読む時って、目線を右から左に動かすのが意外と時間を取るんですよね。でもフラッシュテキストなら、文字が目の前に表示されるから、その分だけ早く読める。最初は「こんな速さで読めるの？」って思ったけど、使ってみたら意外と自然に読めました。

友達と一緒に試してみたら、「確かに目線の移動がない分、読みやすいね」って言ってました。一度試してみると、その違いが分かるかもしれません。`;
                  openNewText(sample);
                }}
              >
                サンプルのテキストを入力
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="relative">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>フラッシュ表示</CardTitle>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="読書設定">
                    <Settings className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>設定</SheetTitle>
                    <SheetDescription>
                      速度とチャンクサイズを調整します
                    </SheetDescription>
                  </SheetHeader>
                  {settingsFeedback}
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium mb-3">速度設定</h3>
                      <RadioGroup
                        value={speedMode}
                        onValueChange={(value) =>
                          handleSpeedPresetChange(
                            value as SpeedMode
                          )
                        }
                        className="flex flex-col space-y-2"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="low" id="low" />
                          <Label htmlFor="low">Low (150 CPM)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="mid" id="mid" />
                          <Label htmlFor="mid">Mid (300 CPM)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="high" id="high" />
                          <Label htmlFor="high">High (600 CPM)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="custom" id="custom" />
                          <Label htmlFor="custom">Custom</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    {speedMode === "custom" && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium">
                          カスタム速度: {speed} CPM (文字/分)
                        </h3>
                        <Slider
                          value={[speed]}
                          min={100}
                          max={1000}
                          step={10}
                          onValueChange={(value) => applySettings({ speed: value[0], chunkSize, speedMode })}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">
                        チャンクサイズ: {chunkSize} 文字
                      </h3>
                      <Slider
                        value={[chunkSize]}
                        min={1}
                        max={10}
                        step={1}
                        onValueChange={(value) => applySettings({ speed, chunkSize: value[0], speedMode })}
                      />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </CardHeader>
          <CardContent>
            {positionNotice && <output className="mb-4 block">{positionNotice}</output>}
            {completed && <output className="mb-4 block">{activeBook && (positionReadError || positionSaveError) ? "読了（未保存）" : "読了"}</output>}
            {activeBook && positionReadError && (
              <div role="alert" className="mb-4 space-y-2 text-destructive">
                <p>読書位置を読み込めません。先頭から一時的に開いています。保存済みの位置は上書きしません。</p>
                <Button variant="outline" onClick={() => openBook(activeBook)}>保存位置を再読込</Button>
              </div>
            )}
            {activeBook && !positionReadError && positionSaveError && (
              <div role="alert" className="mb-4 space-y-2 text-destructive">
                <p>読書位置を保存できません。別の本を開いたりページを閉じると、最後に保存できた位置に戻ります。</p>
                <Button variant="outline" onClick={() => persistPosition(activeBook, position, completed)}>保存を再試行</Button>
              </div>
            )}
            <div className="flex flex-col items-center">
              <div className="h-32 flex items-center justify-center w-full mb-4 border rounded-lg">
                <p className="text-2xl font-medium text-center px-4">
                  {chunks.length > 0
                    ? chunks[currentChunkIndex].review ? "原文の確認が必要です" : chunks[currentChunkIndex].text
                    : "テキストを入力して開始ボタンを押してください"}
                </p>
              </div>

              <div
                className="w-full bg-gray-200 rounded-full h-2.5 mb-6 dark:bg-gray-700"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                tabIndex={0}
              >
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="flex gap-2">
                {activeBook?.sourceKind === "kindle-capture" && currentBlock && (
                  <Button variant="outline" onClick={() => void openSource()}>元画像</Button>
                )}
                {chunks[currentChunkIndex]?.review && (
                  <Button onClick={() => {
                    closeSource();
                    if (currentChunkIndex < chunks.length - 1) {
                      setCurrentChunkIndex((index) => index + 1);
                      setIsPlaying(true);
                    } else {
                      setIsPlaying(false);
                      setCompleted(true);
                    }
                  }}>確認して続ける</Button>
                )}
                {!isPlaying ? (
                  <Button onClick={startReading} disabled={!inputText.trim() || completed}>
                    <Play className="mr-2 h-4 w-4" /> 開始
                  </Button>
                ) : (
                  <Button onClick={pauseReading}>
                    <Pause className="mr-2 h-4 w-4" /> 一時停止
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={resetReading}
                  disabled={chunks.length === 0}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> 最初から読む
                </Button>
              </div>
              {sourceUrl && (
                <div className="mt-6 w-full">
                  <Button variant="outline" onClick={closeSource}>元画像を閉じる</Button>
                  <div className="relative mt-2">
                    <img src={sourceUrl} alt="取り込み時の元画面" className="w-full h-auto" />
                    {sourceBox && <div className="absolute border-2 border-red-500 pointer-events-none" style={{
                      left: `${sourceBox[0] * 100}%`, top: `${sourceBox[1] * 100}%`,
                      width: `${sourceBox[2] * 100}%`, height: `${sourceBox[3] * 100}%`,
                    }} />}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
