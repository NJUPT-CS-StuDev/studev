/** null means all (also future buildings); [] explicitly means none. */
export const selectedBuilding = (ids: readonly string[] | null, id: string): boolean => ids === null || ids.includes(id);
export const toggleBuilding = (ids: string[] | null, all: string[], id: string): string[] => selectedBuilding(ids, id)
    ? (ids ?? all).filter(item => item !== id) : [...(ids ?? all), id];
const key = (campus: string) => `studev:room-buildings:${campus}`;
export const readBuildings = (campus: string): string[] | null => {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(key(campus)) ?? 'null');
        return Array.isArray(raw) && raw.every(id => typeof id === 'string') ? raw : null;
    } catch { return null; }
};
export const saveBuildings = (campus: string, ids: string[] | null): void => {
    try { localStorage.setItem(key(campus), JSON.stringify(ids)); } catch { /* Keep the current page usable without storage. */ }
};
