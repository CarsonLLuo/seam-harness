// 打开 Seam 时显示哪个会话：回到上次的位置。
const STORAGE_KEY = "seam.lastView";
/** 上次停在新会话页时保存的值 */
export const NEW_VIEW = "new";

/**
 * - 上次停在新会话页 → 新会话页
 * - 上次打开的会话还在 → 那个会话
 * - 第一次打开或上次的会话已不存在 → 最近的会话；一个会话都没有时是新会话页
 * 返回 null 表示新会话页。
 */
export function initialSelection(saved: string | null, sessionIds: string[]): string | null {
  if (saved === NEW_VIEW) return null;
  if (saved && sessionIds.includes(saved)) return saved;
  return sessionIds[0] ?? null;
}

export function loadLastView(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveLastView(selected: string | null): void {
  localStorage.setItem(STORAGE_KEY, selected ?? NEW_VIEW);
}
