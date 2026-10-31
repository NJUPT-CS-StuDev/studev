export type MapSheetState = 'collapsed' | 'half' | 'full';

const SHEET_STATES: readonly MapSheetState[] = ['collapsed', 'half', 'full'];

export function sheetHeight(state: MapSheetState, viewport: number, safeBottom = 0): number {
  const available = Math.max(320, viewport - safeBottom);
  const collapsed = Math.min(112, Math.max(72, available * 0.14));
  if (state === 'collapsed') return collapsed;
  const half = Math.min(560, Math.max(collapsed + 48, Math.min(available * 0.52, available * 0.78)));
  if (state === 'half') return half;
  return Math.max(half + 24, Math.min(available - 12, Math.max(half + 24, available * 0.88)));
}

function sheetIndex(state: MapSheetState): number { return SHEET_STATES.indexOf(state); }

/** Resolve a drag release. `deltaY` is negative when the finger moved upwards. */
export function snapSheet(current: MapSheetState, deltaY: number, velocityY: number): MapSheetState {
  const index = sheetIndex(current);
  const fast = Math.abs(velocityY) > 650;
  if (fast) {
    const direction = velocityY < 0 ? 1 : -1;
    return SHEET_STATES[Math.max(0, Math.min(SHEET_STATES.length - 1, index + direction))]!;
  }
  if (Math.abs(deltaY) < 48) return current;
  const direction = deltaY < 0 ? 1 : -1;
  return SHEET_STATES[Math.max(0, Math.min(SHEET_STATES.length - 1, index + direction))]!;
}

