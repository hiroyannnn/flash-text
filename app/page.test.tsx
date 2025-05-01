import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Page from "./page";

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
