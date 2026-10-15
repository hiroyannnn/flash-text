export type SpeedMode = "low" | "mid" | "high" | "custom";
export type ReaderSettings = { speed: number; chunkSize: number; speedMode: SpeedMode };
export const SETTINGS_KEY = "flash-reader-settings:v1";
export const DEFAULT_SETTINGS: ReaderSettings = { speed: 300, chunkSize: 5, speedMode: "mid" };

function validSettings(value: ReaderSettings): boolean {
  if (!value || !Number.isInteger(value.speed) || value.speed < 100 || value.speed > 1000 || value.speed % 10 !== 0) return false;
  if (!Number.isInteger(value.chunkSize) || value.chunkSize < 1 || value.chunkSize > 10) return false;
  return value.speedMode === "custom" ||
    (value.speedMode === "low" && value.speed === 150) ||
    (value.speedMode === "mid" && value.speed === 300) ||
    (value.speedMode === "high" && value.speed === 600);
}

export function loadReaderSettings(): { settings: ReaderSettings; invalid: boolean } {
  // Access errors reach the UI, which must not overwrite unread preferences.
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw === null) return { settings: DEFAULT_SETTINGS, invalid: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion === 1 && validSettings(parsed)) {
      return { settings: { speed: parsed.speed, chunkSize: parsed.chunkSize, speedMode: parsed.speedMode }, invalid: false };
    }
  } catch { /* Invalid data uses safe defaults; it is not a successful restore. */ }
  return { settings: DEFAULT_SETTINGS, invalid: true };
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (!validSettings(settings)) throw new RangeError("Invalid reader settings");
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: 1, ...settings }));
}
