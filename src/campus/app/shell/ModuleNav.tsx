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
        <div className="sticky top-0 z-30 border-b border-[#dadce0] dark:border-[#323a44] bg-white/95 dark:bg-[#14181d]/95 backdrop-blur">
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
                                ? 'shrink-0 rounded-full bg-[#e8f0fe] dark:bg-[#243850] px-2 py-1 sm:px-3.5 sm:py-1.5 font-medium text-[#1a73e8] dark:text-[#8ab4f8] transition-colors'
                                : 'shrink-0 rounded-full px-2 py-1 sm:px-3.5 sm:py-1.5 text-[#5f6368] dark:text-[#aeb8c5] hover:bg-[#f1f3f4] dark:hover:bg-[#1c232b] hover:text-[#202124] dark:hover:text-[#e8edf3] transition-colors'}
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>
            </div>
        </div>
    );
}
