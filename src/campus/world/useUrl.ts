import { useCallback, useEffect, useMemo, useState } from 'react';

/** The address is the state: anything on screen is a link someone can send. */
export function useUrl() {
    const [search, setSearch] = useState(() => location.search);
    useEffect(() => {
        const sync = () => setSearch(location.search);
        addEventListener('popstate', sync);
        return () => removeEventListener('popstate', sync);
    }, []);
    const set = useCallback((patch: Record<string, string | number | null | undefined>, options: { push?: boolean } = {}) => {
        const params = new URLSearchParams(location.search);
        for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '') params.delete(key);
            else params.set(key, String(value));
        }
        const query = params.toString().replaceAll('%2F', '/').replaceAll('%3A', ':');
        const next = `${location.pathname}${query ? `?${query}` : ''}`;
        if (options.push) history.pushState(null, '', next); else history.replaceState(null, '', next);
        setSearch(location.search);
    }, []);
    // The same object until the address changes, so effects that depend on it settle.
    const params = useMemo(() => new URLSearchParams(search), [search]);
    return { params, set };
}

export function useWide() {
    const [wide, setWide] = useState(() => matchMedia('(min-width: 1000px)').matches);
    useEffect(() => {
        const media = matchMedia('(min-width: 1000px)');
        const change = () => setWide(media.matches);
        media.addEventListener('change', change);
        return () => media.removeEventListener('change', change);
    }, []);
    return wide;
}
