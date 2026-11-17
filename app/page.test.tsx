import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Page from "./page";

describe("FlashReader", () => {
  it("reaches 100% only after the final chunk has finished displaying", async () => {
    vi.useFakeTimers();
    try {
      render(<Page />);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "あいうえおか" },
      });
      fireEvent.click(screen.getByRole("button", { name: "開始" }));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(screen.getByText("か")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).not.toHaveAttribute(
        "aria-valuenow",
        "100"
      );
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "100"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("リセットボタンをクリックすると、再生状態と進捗がリセットされる", async () => {
    render(<Page />);

    const sampleButton = screen.getByText("サンプルのテキストを入力");
    await act(async () => {
      fireEvent.click(sampleButton);
    });

    const startButton = screen.getByText("開始");
    await act(async () => {
      fireEvent.click(startButton);
    });

    const resetButton = screen.getByText("リセット");
    await act(async () => {
      fireEvent.click(resetButton);
    });

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "0");

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

    const textarea = screen.getByPlaceholderText(
      "ここに長文テキストを入力または貼り付けてください..."
    );
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "テスト文章" } });
    });

    const startButton = screen.getByText("開始");
    await act(async () => {
      fireEvent.click(startButton);
    });

    const sampleButton = screen.getByText("サンプルのテキストを入力");
    await act(async () => {
      fireEvent.click(sampleButton);
    });

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "0");

    const startButtonAfterSample = screen.getByText("開始");
    expect(startButtonAfterSample).not.toBeDisabled();
    expect(screen.queryByText("一時停止")).not.toBeInTheDocument();
  });
});
