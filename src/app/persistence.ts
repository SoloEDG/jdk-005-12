export type FarmVersion = 1 | 2;
export interface StoredFarm<T> {
  version: FarmVersion;
  data: T;
}
const key = "meadow-post-v1";
export function saveFarm(data: unknown) {
  const stored: StoredFarm<unknown> = { version: 2, data };
  localStorage.setItem(key, JSON.stringify(stored));
}
export function loadFarm<T>(): StoredFarm<T> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { version?: number; data?: T };
  if (!parsed.data || parsed.version === undefined)
    throw new Error("存档格式不支持");
  if (parsed.version !== 1 && parsed.version !== 2)
    throw new Error("存档版本不支持");
  return { version: parsed.version, data: parsed.data };
}
