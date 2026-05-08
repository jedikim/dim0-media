type CursorPosition = { x: number; y: number }

let lastCursorPosition: CursorPosition | undefined


/**
 * High-frequency cursor tracking lives outside the zustand store so that
 * mousemove writes don't notify every store subscriber on every pixel.
 * Read via getLastCursorPosition() at the moment you need it (e.g. paste).
 */
export function setLastCursorPosition(position: CursorPosition | undefined): void {
  lastCursorPosition = position
}


export function getLastCursorPosition(): CursorPosition | undefined {
  return lastCursorPosition
}


export function clearLastCursorPosition(): void {
  lastCursorPosition = undefined
}
