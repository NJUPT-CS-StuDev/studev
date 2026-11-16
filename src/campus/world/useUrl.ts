import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { replaceSheetRoute } from './ui';

const URL_CHANGE = 'studev:url-change';
const subscribeUrl = (change: () => void) => {
    addEventListener('popstate', change);
    addEventListener(URL_CHANGE, change);
    return () => { removeEventListener('popstate', change); removeEventListener(URL_CHANGE, change); };
};
const searchNow = () => location.search;
const serverSearch = () => '';

/** The address is the state: anything on screen is a link someone can send. */
export function useUrl() {
    const search = useSyncExternalStore(subscribeUrl, searchNow, serverSearch);
    const set = useCallback((patch: Record<string, string | number | null | undefined>, options: { push?: boolean } = {}) => {
        const params = new URLSearchParams(location.search);
        for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '') params.delete(key);
            else params.set(key, String(value));
        }
        const query = params.toString().replaceAll('%2F', '/').replaceAll('%3A', ':');
        const next = `${location.pathname}${query ? `?${query}` : ''}`;
        if (options.push) { if (!replaceSheetRoute(next)) history.pushState(null, '', next); }
        else history.replaceState(history.state, '', next);
        dispatchEvent(new Event(URL_CHANGE));
    }, []);
    // The same object until the address changes, so effects that depend on it settle.
    const params = useMemo(() => new URLSearchParams(search), [search]);
    return { params, set };
}

const wideNow = () => matchMedia('(min-width: 1000px)').matches;
const serverWide = () => false;
const subscribeWide = (change: () => void) => {
    const media = matchMedia('(min-width: 1000px)');
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
};
export function useWide() { return useSyncExternalStore(subscribeWide, wideNow, serverWide); }
