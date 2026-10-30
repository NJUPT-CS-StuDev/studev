import { catalogId } from '@/timetable/model/courseCatalog';
import { CalendarRange } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProductLandingCard } from '@/shared/ui/ProductLandingCard';
import { timetableEdits, updateTimetableEdits } from '@/shared/lib/preferences';
import { usePreferences } from '@/shared/lib/usePreferences';
import type { TeachingScheduleClient } from './model/TeachingScheduleClient';
import { searchCatalog, type CatalogCourse } from './model/courseCatalog';
import { CourseResults } from './ui/CourseResults';
import './timetable.css';

interface TimetableLandingProps {
    client: TeachingScheduleClient;
    savedClass: string | null;
    onOpenClass: (className: string) => void;
    initialQuery?: string;
}

export function TimetableLanding({ client, savedClass, onOpenClass, initialQuery = '' }: TimetableLandingProps) {
    const [query, setQuery] = useState(initialQuery);
    useEffect(() => setQuery(initialQuery), [initialQuery]);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const visibleSuggestions = query.trim().length >= 2 ? suggestions : [];
    const [catalog, setCatalog] = useState<{ term: string; courses: CatalogCourse[] } | null>(null);
    const { prefs } = usePreferences();
    // Anything that is not a class number searches courses as well.
    const courseQuery = query.trim().length >= 2 && !/^[A-Za-z]\d{2,}/.test(query.trim()) ? query.trim() : '';

    useEffect(() => {
        if (!courseQuery || catalog) return;
        const controller = new AbortController();
        Promise.all([client.initialize(controller.signal), client.loadCatalog(controller.signal)])
            .then(([index, courses]) => setCatalog({ term: index.term.term, courses }))
            .catch(() => undefined);
        return () => controller.abort();
    }, [catalog, client, courseQuery]);
    const courses = useMemo(() => catalog && courseQuery ? searchCatalog(catalog.courses, courseQuery, 30) : [], [catalog, courseQuery]);
    const added = useMemo(() => new Set(catalog ? timetableEdits(prefs, catalog.term).added : []), [catalog, prefs]);

    useEffect(() => {
        if (query.trim().length < 2) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            client.suggest(query, controller.signal).then(setSuggestions).catch(reason => {
                if (reason instanceof DOMException && reason.name === 'AbortError') return;
                setError(reason instanceof Error ? reason.message : '班级列表加载失败');
            });
        }, 160);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [client, query]);

    const submit = () => {
        const target = visibleSuggestions.find(item => item.toUpperCase() === query.trim().toUpperCase()) ?? query.trim();
        if (!target) return;
        onOpenClass(target);
    };

    return (
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 sm:py-12">
            <ProductLandingCard
                icon={<CalendarRange className="h-7 w-7" aria-hidden="true" />}
                title="查询班级课表"
                description="输入班级号，按周查看课程、时间和教室。"
            >
                <form className="mt-7" onSubmit={event => { event.preventDefault(); submit(); }}>
                    <label htmlFor="timetable-class" className="sr-only">班级号</label>
                    <div className="mx-auto grid max-w-[440px] grid-cols-[minmax(0,1fr)_88px] gap-2 sm:grid-cols-[minmax(0,1fr)_96px] sm:gap-3">
                        <input
                            id="timetable-class"
                            value={query}
                            onChange={event => { setQuery(event.target.value); setError(null); }}
                            placeholder="输入班级号"
                            autoComplete="off"
                            className="h-12 min-w-0 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-[15px] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 dark:border-[var(--line)] dark:bg-[var(--paper)]"
                            aria-controls="timetable-suggestions"
                        />
                        <button type="submit" className="h-12 w-full rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-[var(--on-brand)] transition hover:bg-[var(--brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">查询</button>
                    </div>
                    {visibleSuggestions.length ? (
                        <div id="timetable-suggestions" className="mx-auto mt-2 max-w-[440px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] text-left dark:border-[var(--line)] dark:bg-[var(--paper)]">
                            {visibleSuggestions.slice(0, 6).map(item => (
                                <button key={item} type="button" onClick={() => { setQuery(item); onOpenClass(item); }} className="block w-full px-4 py-2.5 text-sm hover:bg-[var(--surface-sunken)] focus:bg-[var(--surface-sunken)] dark:hover:bg-[var(--surface)] dark:focus:bg-[var(--surface)]">
                                    {item}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </form>
                {error ? <p className="mt-3 text-sm text-[var(--danger)] dark:text-[var(--danger)]">{error}</p> : null}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[13px]">
                    {savedClass ? (
                        <button type="button" onClick={() => onOpenClass(savedClass)} className="inline-flex h-9 items-center rounded-full border border-[var(--brand-container)] bg-[var(--paper)] px-3 font-medium text-[var(--brand)] hover:bg-[var(--mark)] dark:border-[var(--brand-container)] dark:bg-[var(--paper)] dark:text-[var(--brand)] dark:hover:bg-[var(--mark)]">
                            继续查看 {savedClass}
                        </button>
                    ) : null}
                    <button type="button" onClick={() => onOpenClass('B240402')} className="inline-flex h-9 items-center rounded-full px-3 text-[var(--muted)] hover:bg-[var(--paper)] dark:text-[var(--muted)] dark:hover:bg-[var(--surface-sunken)]">
                        试一试&nbsp;<span className="font-mono text-[var(--brand)] dark:text-[var(--brand)]">B240402</span>
                    </button>
                </div>
            </ProductLandingCard>
            {courseQuery ? (
                <section className="mx-auto mt-8 max-w-[760px]" aria-label="课程搜索结果">
                    <h2 className="mb-3 text-[15px] font-semibold">课程「{courseQuery}」{catalog ? `· ${courses.length} 个教学班` : ' · 正在加载全校课程…'}</h2>
                    {catalog && !courses.length ? <p className="text-sm text-[var(--muted)] dark:text-[var(--muted)]">没有匹配的课程。</p> : null}
                    {catalog ? <p className="mb-3 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">加入的课程会出现在你的课表里{prefs.class ? `（${prefs.class}）` : '；先打开你的班级课表，它就会成为你的课表'}。</p> : null}
                    <CourseResults
                        courses={courses}
                        inTimetable={added}
                        onAdd={course => catalog && updateTimetableEdits(catalog.term, edits => ({ ...edits, added: [...edits.added, catalogId(course)] }))}
                        onRemove={course => catalog && updateTimetableEdits(catalog.term, edits => ({ ...edits, added: edits.added.filter(id => id !== catalogId(course)) }))}
                    />
                </section>
            ) : null}
        </main>
    );
}
