import { ROUTE_PATHS } from '@/app/routing/useUrlState';
import type { AppRoute } from '@/app/routing/useUrlState';

const MODULES: Array<{ route: Exclude<AppRoute, 'home'>; label: string }> = [
    { route: 'search', label: '校内通知' },
    { route: 'community', label: '生存手册' },
    { route: 'materials', label: '历年资料' },
    { route: 'timetable', label: '课表' },
    { route: 'classrooms', label: '空教室' },
    { route: 'exam', label: '考试安排' },
];

/** Switches between the campus modules; the site header keeps the search box. */
export function ModuleNav({ route, onNavigate }: { route: AppRoute; onNavigate: (route: AppRoute) => void }) {
    return (
        <div className="sticky top-0 z-30 border-b border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)]/95 dark:bg-[var(--paper)]/95 backdrop-blur">
            <div className="max-w-[1080px] mx-auto px-3 sm:px-6">
                <nav aria-label="studev-search 模块切换" className="flex items-center justify-between gap-0.5 sm:justify-start sm:gap-1.5 overflow-x-auto py-2 text-[12px] sm:text-[13px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    {MODULES.map(item => (
                        <a
                            key={item.route}
                            href={ROUTE_PATHS[item.route]}
                            aria-current={item.route === route ? 'page' : undefined}
                            onClick={event => {
                                event.preventDefault();
                                onNavigate(item.route);
                            }}
                            className={item.route === route
                                ? 'shrink-0 rounded-full bg-[var(--mark)] dark:bg-[var(--mark)] px-2 py-1 sm:px-3.5 sm:py-1.5 font-medium text-[var(--brand)] dark:text-[var(--brand)] transition-colors'
                                : 'shrink-0 rounded-full px-2 py-1 sm:px-3.5 sm:py-1.5 text-[var(--muted)] dark:text-[var(--muted)] hover:bg-[var(--surface-sunken)] dark:hover:bg-[var(--surface)] hover:text-[var(--ink)] dark:hover:text-[var(--ink)] transition-colors'}
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>
            </div>
        </div>
    );
}
