export interface ContextMenuPositionOptions {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
}

export function clampContextMenuPosition({
  x,
  y,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  gap = 8,
}: ContextMenuPositionOptions): { left: number; top: number } {
  const availableWidth = Math.max(0, viewportWidth - menuWidth - gap);
  const availableHeight = Math.max(0, viewportHeight - menuHeight - gap);
  return {
    left: Math.max(gap, Math.min(x, availableWidth)),
    top: Math.max(gap, Math.min(y, availableHeight)),
  };
}
