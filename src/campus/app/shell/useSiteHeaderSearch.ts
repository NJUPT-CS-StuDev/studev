import { useEffect, useRef } from 'react';
import type { AppRoute } from '@/app/routing/useUrlState';
import { searchScopeForRoute } from '@/search/searchScopes';

const placeholderFor = (route: AppRoute): string => {
    if (route === 'exam') return '搜索班级或考试课程';
    if (route === 'timetable') return '搜索班级、课程或教师';
    if (route === 'classrooms') return '搜索校区、楼栋或教室';
    return searchScopeForRoute(route).placeholder;
};

/**
 * On campus pages the site header's search box is the product's search box:
 * it shows the current route's query and submits into the campus router
 * instead of reloading the page. The home route hides it in favour of its own.
 */
export function useSiteHeaderSearch(
    route: AppRoute,
    inputValue: string,
    onInputChange: (value: string) => void,
    onSubmit: (value: string) => void,
): void {
    const handlers = useRef({ onInputChange, onSubmit });
    handlers.current = { onInputChange, onSubmit };

    useEffect(() => {
        const form = document.querySelector<HTMLFormElement>('[data-header-search-form]');
        const input = document.querySelector<HTMLInputElement>('[data-header-search-input]');
        const clear = document.querySelector<HTMLButtonElement>('[data-header-search-clear]');
        if (!form || !input) return;
        const submit = (event: SubmitEvent) => {
            event.preventDefault();
            handlers.current.onSubmit(input.value);
        };
        const type = () => handlers.current.onInputChange(input.value);
        const reset = () => {
            input.value = '';
            if (clear) clear.hidden = true;
            handlers.current.onInputChange('');
            input.focus();
        };
        form.addEventListener('submit', submit);
        input.addEventListener('input', type);
        clear?.addEventListener('click', reset);
        return () => {
            form.removeEventListener('submit', submit);
            input.removeEventListener('input', type);
            clear?.removeEventListener('click', reset);
        };
    }, []);

    useEffect(() => {
        document.documentElement.dataset.searchRoute = route === 'home' ? 'home' : 'subpage';
        const input = document.querySelector<HTMLInputElement>('[data-header-search-input]');
        const clear = document.querySelector<HTMLButtonElement>('[data-header-search-clear]');
        if (!input) return;
        input.placeholder = placeholderFor(route);
        if (input.value !== inputValue) input.value = inputValue;
        if (clear) clear.hidden = !inputValue;
    }, [route, inputValue]);
}
