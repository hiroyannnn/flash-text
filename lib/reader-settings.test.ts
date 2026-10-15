import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadReaderSettings, saveReaderSettings } from "./reader-settings";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("shared reader settings", () => {
  it("uses defaults without writing on a first visit", () => {
    expect(loadReaderSettings()).toEqual({ settings: DEFAULT_SETTINGS, invalid: false });
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });

  it.each([
    { speed: 150, chunkSize: 1, speedMode: "low" as const },
    { speed: 600, chunkSize: 10, speedMode: "high" as const },
    { speed: 470, chunkSize: 6, speedMode: "custom" as const },
  ])("restores validated settings %j", (settings) => {
    saveReaderSettings(settings);
    expect(loadReaderSettings()).toEqual({ settings, invalid: false });
  });

  it.each([
    "{broken", "null", "42",
    JSON.stringify({ schemaVersion: 2, ...DEFAULT_SETTINGS }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, speed: 0 }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, speed: 1001 }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, speed: "300" }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, chunkSize: 0 }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, chunkSize: 11 }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, chunkSize: 1.5 }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, speedMode: "unknown" }),
    JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, speedMode: "low" }),
  ])("reports invalid data and keeps it unchanged: %s", (raw) => {
    localStorage.setItem(SETTINGS_KEY, raw);
    expect(loadReaderSettings()).toEqual({ settings: DEFAULT_SETTINGS, invalid: true });
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(raw);
  });

  it("surfaces denied reads instead of overwriting preferences", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(() => loadReaderSettings()).toThrow("denied");
  });

  it("keeps last saved settings after a rejected write", () => {
    saveReaderSettings(DEFAULT_SETTINGS);
    const before = localStorage.getItem(SETTINGS_KEY);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(() => saveReaderSettings({ speed: 600, chunkSize: 6, speedMode: "high" })).toThrow("full");
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before);
  });
});
