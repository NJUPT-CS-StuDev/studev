import { useCallback, useEffect, useState } from 'react';

export type AppRoute = 'home' | 'search' | 'community' | 'materials' | 'timetable' | 'classrooms' | 'exam';

export interface UrlState {
    route: AppRoute;
    search: string;
    classParam: string | null;
    qParam: string | null;
    dateParam: string | null;
    campusParam: string | null;
    buildingParam: string | null;
    floorParam: string | null;
    roomParam: string | null;
    weekParam: string | null;
    periodParam: string | null;
    untilParam: string | null;
}

export interface NavigateOptions {
    route: AppRoute;
    params?: Record<string, string | null>;
}

/** Where each product route lives in the site. */
export const ROUTE_PATHS: Record<AppRoute, string> = {
    home: '/search/',
    search: '/search/web/',
    community: '/search/community/',
    materials: '/search/materials/',
    exam: '/search/exam/',
    timetable: '/search/timetable/',
    classrooms: '/search/classrooms/',
};

export const routeFromPathname = (pathname: string): AppRoute => {
    const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
    const route = (Object.keys(ROUTE_PATHS) as AppRoute[]).find(key => ROUTE_PATHS[key] === normalized);
    if (!route) throw new Error(`Unsupported application route: ${pathname}`);
    return route;
};

export const parseUrlState = (pathname: string, search: string): UrlState => {
    const params = new URLSearchParams(search);
    return {
        route: routeFromPathname(pathname),
        search,
        classParam: params.get('class') || null,
        qParam: params.get('q') || null,
        dateParam: params.get('date') || null,
        campusParam: params.get('campus') || null,
        buildingParam: params.get('building') || null,
        floorParam: params.get('floor') || null,
        roomParam: params.get('room') || null,
        weekParam: params.get('week') || null,
        periodParam: params.get('period') || null,
        untilParam: params.get('until') || null,
    };
};

const readUrlState = (): UrlState => parseUrlState(window.location.pathname, window.location.search);

export const buildPath = ({ route, params = {} }: NavigateOptions): string => {
    const pathname = ROUTE_PATHS[route];
    const nextParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value) nextParams.set(key, value);
    });
    const query = nextParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
};

/**
 * The first render uses only the page's own route, so the server-rendered HTML
 * and the first client render agree; the real URL (with its query) is read
 * once mounted.
 */
export function useUrlState(initialRoute: AppRoute) {
    const [state, setState] = useState<UrlState>(() => parseUrlState(ROUTE_PATHS[initialRoute], ''));

    useEffect(() => {
        const handleLocationChange = () => setState(readUrlState());
        handleLocationChange();
        window.addEventListener('popstate', handleLocationChange);
        return () => window.removeEventListener('popstate', handleLocationChange);
    }, []);

    const navigate = useCallback((options: NavigateOptions, replace = false) => {
        const nextUrl = buildPath(options);
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (currentUrl === nextUrl) return;
        if (replace) {
            window.history.replaceState(null, '', nextUrl);
        } else {
            window.history.pushState(null, '', nextUrl);
        }
        setState(readUrlState());
    }, []);

    return { ...state, navigate };
}
