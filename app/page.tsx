"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Play, Pause, RotateCcw, Settings } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"

export default function FlashReader() {
  const [inputText, setInputText] = useState("")
  const [chunks, setChunks] = useState<string[]>([])
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(300) // words per minute
  const [chunkSize, setChunkSize] = useState(5) // characters per chunk
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const [progress, setProgress] = useState(0)
  const [speedMode, setSpeedMode] = useState<"low" | "mid" | "high" | "custom">("mid")

  // Split text into chunks by characters
  const processText = () => {
    if (!inputText.trim()) return

    const textChunks = []
    const text = inputText.replace(/\s+/g, " ").trim()

    for (let i = 0; i < text.length; i += chunkSize) {
      textChunks.push(text.substring(i, i + chunkSize))
    }

    setChunks(textChunks)
    setCurrentChunkIndex(0)
    setProgress(0)
  }

  // Calculate delay based on speed (characters per minute)
  const getDelayInMs = () => {
    // Convert characters per minute to milliseconds per chunk
    return (60 / speed) * 1000 * (chunkSize / 5) // Assuming average 5 chars per word
  }

  // Start the flash reading
  const startReading = () => {
    if (chunks.length === 0) {
      processText()
    }

    setIsPlaying(true)
  }

  // Pause the flash reading
  const pauseReading = () => {
    setIsPlaying(false)
  }

  // Reset the flash reading
  const resetReading = () => {
    setIsPlaying(false)
    setCurrentChunkIndex(0)
    setProgress(0)
  }

  // Handle text input change
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    setChunks([])
    setCurrentChunkIndex(0)
    setProgress(0)
    setIsPlaying(false)
  }

  // Handle speed preset change
  const handleSpeedPresetChange = (value: "low" | "mid" | "high" | "custom") => {
    setSpeedMode(value)

    // Set speed based on preset
    switch (value) {
      case "low":
        setSpeed(150)
        break
      case "mid":
        setSpeed(300)
        break
      case "high":
        setSpeed(600)
        break
      // For custom, keep the current speed
    }
  }

  // Update chunk index and progress
  useEffect(() => {
    if (isPlaying && chunks.length > 0) {
      timerRef.current = setTimeout(() => {
        if (currentChunkIndex < chunks.length - 1) {
          setCurrentChunkIndex((prev) => prev + 1)
          setProgress(((currentChunkIndex + 1) / (chunks.length - 1)) * 100)
        } else {
          setIsPlaying(false)
        }
      }, getDelayInMs())
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [isPlaying, currentChunkIndex, chunks.length, speed, chunkSize])

  // Process text when chunk size changes
  useEffect(() => {
    if (inputText.trim()) {
      processText()
    }
  }, [chunkSize])

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold text-center mb-6">速読フラッシュリーダー</h1>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>テキスト入力</CardTitle>
            <CardDescription>速読したいテキストを入力してください</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="ここに長文テキストを入力または貼り付けてください..."
              className="min-h-[150px]"
              value={inputText}
              onChange={handleTextChange}
            />
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setInputText(`「あれ、意外と読める」と気づきました。フラッシュテキストで文章を読んでみたら、普段より早く読めるんです。目線を左右に動かす必要がないから、自然と読むスピードが上がるみたい。

長文を読む時って、目線を右から左に動かすのが意外と時間を取るんですよね。でもフラッシュテキストなら、文字が目の前に表示されるから、その分だけ早く読める。最初は「こんな速さで読めるの？」って思ったけど、使ってみたら意外と自然に読めました。

友達と一緒に試してみたら、「確かに目線の移動がない分、読みやすいね」って言ってました。一度試してみると、その違いが分かるかもしれません。`)
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
                  <Button variant="outline" size="icon">
                    <Settings className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>設定</SheetTitle>
                    <SheetDescription>速度とチャンクサイズを調整します</SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium mb-3">速度設定</h3>
                      <RadioGroup
                        value={speedMode}
                        onValueChange={(value) => handleSpeedPresetChange(value as "low" | "mid" | "high" | "custom")}
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
                        <h3 className="text-sm font-medium">カスタム速度: {speed} CPM (文字/分)</h3>
                        <Slider
                          value={[speed]}
                          min={100}
                          max={1000}
                          step={10}
                          onValueChange={(value) => setSpeed(value[0])}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">チャンクサイズ: {chunkSize} 文字</h3>
                      <Slider
                        value={[chunkSize]}
                        min={1}
                        max={10}
                        step={1}
                        onValueChange={(value) => setChunkSize(value[0])}
                      />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center">
              <div className="h-32 flex items-center justify-center w-full mb-4 border rounded-lg">
                <p className="text-2xl font-medium text-center px-4">
                  {chunks.length > 0 ? chunks[currentChunkIndex] : "テキストを入力して開始ボタンを押してください"}
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
                {!isPlaying ? (
                  <Button onClick={startReading} disabled={!inputText.trim()}>
                    <Play className="mr-2 h-4 w-4" /> 開始
                  </Button>
                ) : (
                  <Button onClick={pauseReading}>
                    <Pause className="mr-2 h-4 w-4" /> 一時停止
                  </Button>
                )}
                <Button variant="outline" onClick={resetReading} disabled={chunks.length === 0}>
                  <RotateCcw className="mr-2 h-4 w-4" /> リセット
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
