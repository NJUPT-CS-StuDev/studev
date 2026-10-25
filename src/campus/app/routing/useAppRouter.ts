import { useCallback, useMemo, useState } from 'react';
import { readPreferences, writePreferences } from '@/shared/lib/preferences';
import { useUrlState } from './useUrlState';
import type { AppRoute } from './useUrlState';
import type { ProductIntent } from './intents';
import {
    resolveQuickIntent,
    resolveRouteSubmission,
    resolveSubmission,
} from './routeContract';

const number = (value: string | null, pattern = /^\d+$/): number | null => value && pattern.test(value) ? Number(value) : null;

export function useAppRouter(initialRoute: AppRoute) {
    const url = useUrlState(initialRoute);
    const {
        route,
        qParam,
        classParam,
        dateParam,
        campusParam,
        buildingParam,
        roomParam,
        weekParam,
        weekdayParam,
        periodParam,
        untilParam,
        navigate,
    } = url;
    const routeInput = useMemo(() => {
        if (route === 'exam') return classParam || qParam || '';
        if (route === 'timetable') return qParam || classParam || '';
        if (route === 'search' || route === 'community' || route === 'materials' || route === 'classrooms') return qParam || '';
        return '';
    }, [classParam, qParam, route]);
    const [inputDraft, setInputDraft] = useState(() => ({ routeInput, value: routeInput }));
    const inputValue = inputDraft.routeInput === routeInput ? inputDraft.value : routeInput;
    const onInputChange = useCallback((value: string) => {
        setInputDraft({ routeInput, value });
    }, [routeInput]);

    const submit = useCallback((value: string, replace = false) => {
        const resolved = route === 'home' ? resolveSubmission(value) : resolveRouteSubmission(route, value);
        // A course typed while a timetable is open searches courses for that timetable.
        const destination = route === 'timetable' && classParam && resolved.params?.q
            ? { ...resolved, params: { class: classParam, week: weekParam, q: resolved.params.q } }
            : resolved;
        // The first class someone looks up becomes their class.
        const className = destination.params?.class;
        if (className && (destination.route === 'exam' || destination.route === 'timetable') && !readPreferences().class) {
            writePreferences(current => ({ ...current, class: className }));
        }
        navigate(destination, replace);
    }, [classParam, navigate, route, weekParam]);

    const quickSearch = useCallback((intent: ProductIntent) => {
        navigate(resolveQuickIntent(intent));
    }, [navigate]);

    const navigateTimetable = useCallback((params: Record<string, string | null>, replace = false) => {
        navigate({ route: 'timetable', params }, replace);
    }, [navigate]);
    const navigateClassrooms = useCallback((params: Record<string, string | null>, replace = false) => {
        navigate({ route: 'classrooms', params }, replace);
    }, [navigate]);
    const navigateSearchScope = useCallback((nextRoute: 'search' | 'community' | 'materials') => {
        navigate({ route: nextRoute, params: { q: qParam } });
    }, [navigate, qParam]);

    return {
        route,
        hasQueryParams: url.search.length > 1,
        inputValue,
        onInputChange,
        onSubmit: submit,
        onQuickSearch: quickSearch,
        onGoHome: () => navigate({ route: 'home' }),
        onNavigateRoute: (next: AppRoute) => navigate({ route: next }),
        search: { query: qParam || '' },
        exam: { query: qParam || '', className: classParam },
        timetable: {
            query: qParam || '',
            className: classParam,
            week: number(weekParam),
        },
        classrooms: {
            campus: campusParam,
            date: dateParam,
            week: number(weekParam),
            weekday: number(weekdayParam, /^[1-7]$/),
            period: number(periodParam),
            until: number(untilParam),
            room: roomParam,
            building: buildingParam,
        },
        navigateTimetable,
        navigateClassrooms,
        navigateSearchScope,
    };
}
