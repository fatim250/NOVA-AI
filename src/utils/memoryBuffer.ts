import type { MemoryInteraction, SandboxRoot } from "../types/notch";

export const MEMORY_WINDOW_SIZE = 20;

export interface MemorySummary {
  entries: MemoryInteraction[];
  totalRecorded: number;
  evictedCount: number;
  lastAppOpened: string | null;
  lastFolderTouched: { name: string; root: SandboxRoot } | null;
  lastSongPlayed: string | null;
  lastExecutableAction: MemoryInteraction | null;
}

/**
 * Pure sliding-window state reducer that preserves up to the last 20 interactions.
 */
export function appendMemoryInteraction(
  current: MemoryInteraction[],
  next: Omit<MemoryInteraction, "id" | "turnNumber">,
  totalRecordedSoFar: number
): { entries: MemoryInteraction[]; totalRecorded: number; evictedCount: number } {
  const turnNumber = totalRecordedSoFar + 1;
  const record: MemoryInteraction = {
    ...next,
    id: `mem-${turnNumber}-${Date.now()}`,
    turnNumber,
  };
  const combined = [...current, record];
  const entries = combined.slice(-MEMORY_WINDOW_SIZE);
  const evictedCount = Math.max(0, turnNumber - entries.length);
  return {
    entries,
    totalRecorded: turnNumber,
    evictedCount,
  };
}

export function deriveMemorySummary(
  entries: MemoryInteraction[],
  totalRecorded: number
): MemorySummary {
  let lastAppOpened: string | null = null;
  let lastFolderTouched: { name: string; root: SandboxRoot } | null = null;
  let lastSongPlayed: string | null = null;
  let lastExecutableAction: MemoryInteraction | null = null;

  for (let i = entries.length - 1; i >= 0; i--) {
    const item = entries[i];
    if (!lastAppOpened && item.action === "app_open" && item.target && item.outcome === "executed") {
      lastAppOpened = item.target;
    }
    if (
      !lastFolderTouched &&
      (item.action === "folder_create" || item.action === "folder_rename") &&
      item.outcome === "executed"
    ) {
      const folderName = item.action === "folder_rename" && item.newName ? item.newName : item.target;
      if (folderName) {
        lastFolderTouched = {
          name: folderName,
          root: item.root ?? "Desktop",
        };
      }
    }
    if (!lastSongPlayed && item.action === "song_play" && item.target && item.outcome === "executed") {
      lastSongPlayed = item.target;
    }
    if (
      !lastExecutableAction &&
      item.action !== "memory_recall" &&
      item.action !== "general_qa"
    ) {
      lastExecutableAction = item;
    }
  }

  return {
    entries,
    totalRecorded,
    evictedCount: Math.max(0, totalRecorded - entries.length),
    lastAppOpened,
    lastFolderTouched,
    lastSongPlayed,
    lastExecutableAction,
  };
}
