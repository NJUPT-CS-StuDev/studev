type RoomIntent = { kind: 'entry' } | { kind: 'candidate'; input: string };
const ENTRY_TERMS = new Set(['考试占用教室', '考试教室', '教室']);

export const parseRoomIntent = (query: string): RoomIntent | null => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    if (ENTRY_TERMS.has(trimmed)) return { kind: 'entry' };
    const looksLikeSpace = /楼$|^教(?:\d|东|西)$|^[^\s]+-[^\s]+$|^(?:图|无)[^\s]+$/.test(trimmed);
    return looksLikeSpace ? { kind: 'candidate', input: trimmed } : null;
};
